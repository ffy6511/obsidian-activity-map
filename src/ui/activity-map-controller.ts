import type { TrackingSnapshot } from '../domain/activity';
import type { ActivityMapSettings, HeaderPopoverRange } from '../domain/settings';
import type { TrackingObserver } from '../tracking/ports';
import type {
	DistributionGrouping,
	DistributionQuery,
	DistributionResult,
} from '../query/distribution-query';
import type { MetricKey } from '../query/path-projection';
import type { RangeMode } from '../query/date-range';
import {
	headerPopoverDefaultQuery,
	initialViewModel,
	type ActivityMapViewModel,
} from './view-model';
import { localDateFor } from '../platform/clock';

export interface QueryService {
	run(query: DistributionQuery): Promise<DistributionResult>;
	getStatusSummary?(
		filePath: string,
		today: string,
	): Promise<{ fileActiveMs: number; vaultActiveMs: number }>;
}

export interface SettingsService {
	update(patch: Partial<ActivityMapSettings>): Promise<ActivityMapSettings>;
}

export interface TrackingControl {
	pause(reason?: string): void;
	resume(): void;
	updateSettings(settings: ActivityMapSettings): void;
	resolveRecovery(args: { candidateId: string; kind: 'include' | 'exclude' }): Promise<unknown>;
	undoAutomaticExclusion(candidateId: string): boolean;
}

export type ActivityMapIntent =
	| { kind: 'refresh' }
	| { kind: 'set-range'; range: RangeMode }
	| { kind: 'set-path'; path: string; view?: 'children' | 'local-files' }
	| { kind: 'set-grouping'; groupBy: DistributionGrouping }
	| { kind: 'set-metric'; metric: MetricKey }
	| { kind: 'set-query'; query: DistributionQuery }
	| { kind: 'pause' }
	| { kind: 'resume' }
	| { kind: 'resolve-recovery'; candidateId: string; decision: 'include' | 'exclude' }
	| { kind: 'undo-automatic-exclusion'; candidateId: string }
	| { kind: 'update-settings'; patch: Partial<ActivityMapSettings> };

/** Serializes UI intent effects and rejects stale query generations. */
export class ActivityMapController implements TrackingObserver {
	private model: ActivityMapViewModel;
	private readonly listeners = new Set<(model: ActivityMapViewModel) => void>();
	private generation = 0;
	private groupingRevision = 0;
	private popoverPreferenceQueue: Promise<void> = Promise.resolve();
	private stopped = false;
	private today: string;

	constructor(
		settings: ActivityMapSettings,
		private readonly queryService: QueryService,
		private readonly settingsService: SettingsService,
		private readonly tracking: TrackingControl,
		today: string,
	) {
		this.model = initialViewModel(settings, today);
		this.today = today;
	}

	getViewModel(): ActivityMapViewModel {
		return this.model;
	}

	/** Default query for a newly opened header chart popover. */
	getHeaderDefaultQuery(): DistributionQuery {
		return headerPopoverDefaultQuery(this.model.settings, this.today);
	}

	/** Dedicated data read for the persistent header miniature. */
	getHeaderDistribution(): Promise<DistributionResult> {
		return this.queryService.run(this.getHeaderDefaultQuery());
	}

	subscribe(listener: (model: ActivityMapViewModel) => void): () => void {
		if (this.stopped) return () => {};
		this.listeners.add(listener);
		listener(this.model);
		return () => this.listeners.delete(listener);
	}

	onSnapshot(snapshot: TrackingSnapshot): void {
		if (this.stopped) return;
		const nextToday = localDateFor(
			Date.parse(snapshot.sampledAt),
			Intl.DateTimeFormat().resolvedOptions().timeZone,
		);
		const previousToday = this.today;
		this.today = nextToday;

		if (
			nextToday !== previousToday &&
			this.model.query.range.mode === 'day' &&
			this.model.query.range.localDate === previousToday
		) {
			// The default day query follows the local clock. Without a new query
			// generation, header surfaces retain yesterday's result and the live
			// projection correctly refuses to add today's unclosed interval to it.
			this.model = {
				...this.model,
				tracking: snapshot,
				query: {
					...this.model.query,
					range: { mode: 'day', localDate: nextToday },
				},
			};
			void this.refresh();
			return;
		}

		this.publish({ ...this.model, tracking: snapshot });
	}

	async getStatusSummary(
		filePath: string,
	): Promise<{ fileActiveMs: number; vaultActiveMs: number }> {
		if (!this.queryService.getStatusSummary) return { fileActiveMs: 0, vaultActiveMs: 0 };
		return this.queryService.getStatusSummary(filePath, this.today);
	}

	reportWarning(message: string): void {
		if (this.stopped || this.model.warnings.includes(message)) return;
		this.publish({ ...this.model, warnings: [...this.model.warnings, message] });
	}

	async dispatch(intent: ActivityMapIntent): Promise<void> {
		if (this.stopped) return;
		switch (intent.kind) {
			case 'pause':
				this.tracking.pause('user');
				return;
			case 'resume':
				this.tracking.resume();
				return;
			case 'resolve-recovery':
				await this.tracking.resolveRecovery({
					candidateId: intent.candidateId,
					kind: intent.decision,
				});
				return;
			case 'undo-automatic-exclusion':
				this.tracking.undoAutomaticExclusion(intent.candidateId);
				return;
			case 'update-settings': {
				// Persistence is the commit point. Runtime behavior changes only after
				// the repository confirms the new settings are durable.
				const settings = await this.settingsService.update(intent.patch);
				this.tracking.updateSettings(settings);
				this.publish({ ...this.model, settings });
				await this.refresh();
				return;
			}
			case 'set-range':
				await this.queuePopoverPreference(
					{ headerPopoverRange: preferenceForRange(intent.range) },
					(query) => ({ ...query, range: intent.range }),
				);
				return;
			case 'set-path':
				this.model = {
					...this.model,
					query: {
						...this.model.query,
						path: intent.path,
						view: intent.view ?? 'children',
					},
				};
				break;
			case 'set-grouping':
				await this.setGrouping(intent.groupBy);
				return;
			case 'set-metric':
				await this.queuePopoverPreference(
					{ headerPopoverMetric: intent.metric },
					(query) => ({ ...query, metric: intent.metric }),
				);
				return;
			case 'set-query':
				this.model = {
					...this.model,
					query: { ...intent.query, range: { ...intent.query.range } },
				};
				break;
			case 'refresh':
				break;
		}
		await this.refresh();
	}

	stop(): void {
		this.stopped = true;
		this.generation += 1;
		this.listeners.clear();
	}

	private async refresh(): Promise<void> {
		const generation = ++this.generation;
		const query = this.model.query;
		this.publish({
			...this.model,
			loadState: 'loading',
			error: null,
			queryGeneration: generation,
		});
		try {
			const distribution = await this.queryService.run(query);
			if (this.stopped || generation !== this.generation) return;
			this.publish({
				...this.model,
				loadState: distribution.detailItems.length === 0 ? 'empty' : 'ready',
				distribution,
				warnings: distribution.warnings.map((warning) => warning.message),
				error: null,
				queryGeneration: generation,
			});
		} catch (error) {
			if (this.stopped || generation !== this.generation) return;
			this.publish({
				...this.model,
				loadState: 'error',
				error: error instanceof Error ? error.message : String(error),
				queryGeneration: generation,
			});
		}
	}

	private async setGrouping(groupBy: DistributionGrouping): Promise<void> {
		const revision = ++this.groupingRevision;
		const previousQuery = this.model.query;
		const previousSettings = this.model.settings;
		this.model = {
			...this.model,
			query: { ...this.model.query, groupBy, view: 'children' },
			settings: { ...this.model.settings, headerPopoverGrouping: groupBy },
		};
		const refresh = this.refresh();
		try {
			const settings = await this.settingsService.update({ headerPopoverGrouping: groupBy });
			if (revision === this.groupingRevision) this.model = { ...this.model, settings };
			await refresh;
		} catch (error) {
			if (revision === this.groupingRevision) {
				// Invalidate the optimistic query so a late result cannot restore a
				// grouping preference that failed its persistence commit point.
				this.generation += 1;
				this.publish({
					...this.model,
					query: previousQuery,
					settings: previousSettings,
					loadState: 'error',
					error: error instanceof Error ? error.message : String(error),
				});
			}
		}
	}

	private queuePopoverPreference(
		patch:
			| Pick<ActivityMapSettings, 'headerPopoverMetric'>
			| Pick<ActivityMapSettings, 'headerPopoverRange'>,
		updateQuery: (query: DistributionQuery) => DistributionQuery,
	): Promise<void> {
		// Popover controls dispatch without awaiting the previous change. Serialize
		// their settings commits so a quick metric/range pair cannot write two
		// patches derived from the same stale settings snapshot.
		const operation = this.popoverPreferenceQueue.then(() =>
			this.setPopoverPreference(patch, updateQuery),
		);
		this.popoverPreferenceQueue = operation.catch(() => undefined);
		return operation;
	}

	private async setPopoverPreference(
		patch:
			| Pick<ActivityMapSettings, 'headerPopoverMetric'>
			| Pick<ActivityMapSettings, 'headerPopoverRange'>,
		updateQuery: (query: DistributionQuery) => DistributionQuery,
	): Promise<void> {
		const previousQuery = this.model.query;
		const previousSettings = this.model.settings;
		this.model = {
			...this.model,
			query: updateQuery(this.model.query),
			settings: { ...this.model.settings, ...patch },
		};
		const refresh = this.refresh();
		try {
			const settings = await this.settingsService.update(patch);
			this.publish({ ...this.model, settings });
			await refresh;
		} catch (error) {
			// A persisted preference is the only reopening default. Invalidate the
			// optimistic query before restoring the last durable selection.
			this.generation += 1;
			this.publish({
				...this.model,
				query: previousQuery,
				settings: previousSettings,
				loadState: 'error',
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}

	private publish(model: ActivityMapViewModel): void {
		this.model = model;
		for (const listener of this.listeners) listener(model);
	}
}

function preferenceForRange(range: RangeMode): HeaderPopoverRange {
	if (range.mode === 'day') return 'day';
	if (range.mode === 'all') return 'all';
	if (range.days === 7) return 'average-7';
	if (range.days === 30) return 'average-30';
	if (range.days === 90) return 'average-90';
	return 'average-all';
}
