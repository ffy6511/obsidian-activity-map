import type { TrackingSnapshot } from '../domain/activity';
import type { ActivityMapSettings } from '../domain/settings';
import type { TrackingObserver } from '../tracking/ports';
import type { DistributionQuery, DistributionResult } from '../query/distribution-query';
import type { MetricKey } from '../query/path-projection';
import type { RangeMode } from '../query/date-range';
import { initialViewModel, type ActivityMapViewModel } from './view-model';
import { localDateFor } from '../platform/clock';
import type { DeletionScope } from '../data/deletion-service';
import type { ExportScope } from '../data/raw-export-service';
import type { SvgExportMode } from '../export/svg-exporter';
import type { DataOperationPort } from './data-controls';
import type { DataOperationProgress } from '../data/retention-service';

export interface QueryService {
	run(query: DistributionQuery): Promise<DistributionResult>;
	getStatusSummary?(filePath: string, today: string): Promise<{ fileActiveMs: number; vaultActiveMs: number }>;
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
	| { kind: 'set-metric'; metric: MetricKey }
	| { kind: 'pause' }
	| { kind: 'resume' }
	| { kind: 'resolve-recovery'; candidateId: string; decision: 'include' | 'exclude' }
	| { kind: 'undo-automatic-exclusion'; candidateId: string }
	| { kind: 'export-svg'; mode: SvgExportMode }
	| { kind: 'export-raw'; scope: ExportScope }
	| { kind: 'rebuild-summaries' }
	| { kind: 'plan-deletion'; scope: DeletionScope }
	| { kind: 'execute-deletion'; planId: string }
	| { kind: 'dismiss-operation' }
	| { kind: 'update-settings'; patch: Partial<ActivityMapSettings> };

/** Serializes UI intent effects and rejects stale query generations. */
export class ActivityMapController implements TrackingObserver {
	private model: ActivityMapViewModel;
	private readonly listeners = new Set<(model: ActivityMapViewModel) => void>();
	private generation = 0;
	private stopped = false;
	private today: string;

	constructor(
		settings: ActivityMapSettings,
		private readonly queryService: QueryService,
		private readonly settingsService: SettingsService,
		private readonly tracking: TrackingControl,
		today: string,
		private readonly dataOperations?: DataOperationPort,
	) {
		this.model = initialViewModel(settings, today);
		this.today = today;
	}

	getViewModel(): ActivityMapViewModel {
		return this.model;
	}

	subscribe(listener: (model: ActivityMapViewModel) => void): () => void {
		if (this.stopped) return () => {};
		this.listeners.add(listener);
		listener(this.model);
		return () => this.listeners.delete(listener);
	}

	onSnapshot(snapshot: TrackingSnapshot): void {
		if (this.stopped) return;
		this.today = localDateFor(Date.parse(snapshot.sampledAt), Intl.DateTimeFormat().resolvedOptions().timeZone);
		this.publish({ ...this.model, tracking: snapshot });
	}

	async getStatusSummary(filePath: string): Promise<{ fileActiveMs: number; vaultActiveMs: number }> {
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
				await this.tracking.resolveRecovery({ candidateId: intent.candidateId, kind: intent.decision });
				return;
			case 'undo-automatic-exclusion':
				this.tracking.undoAutomaticExclusion(intent.candidateId);
				return;
			case 'export-svg':
				await this.exportSvg(intent.mode);
				return;
			case 'export-raw':
				await this.exportRaw(intent.scope);
				return;
			case 'rebuild-summaries':
				await this.rebuildSummaries();
				return;
			case 'plan-deletion':
				await this.planDeletion(intent.scope);
				return;
			case 'execute-deletion':
				await this.executeDeletion(intent.planId);
				return;
			case 'dismiss-operation':
				if (this.model.operation.kind !== 'running') this.publish({ ...this.model, operation: { kind: 'idle' } });
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
				this.model = { ...this.model, query: { ...this.model.query, range: intent.range } };
				break;
			case 'set-path':
				this.model = {
					...this.model,
					query: { ...this.model.query, path: intent.path, view: intent.view ?? 'children' },
				};
				break;
			case 'set-metric':
				this.model = { ...this.model, query: { ...this.model.query, metric: intent.metric } };
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
		this.publish({ ...this.model, loadState: 'loading', error: null, queryGeneration: generation });
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

	private publish(model: ActivityMapViewModel): void {
		this.model = model;
		for (const listener of this.listeners) listener(model);
	}

	private async exportSvg(mode: SvgExportMode): Promise<void> {
		if (!this.beginOperation('svg-export', 'Exporting SVG')) return;
		try {
			if (!this.dataOperations || !this.model.distribution) throw new Error('No distribution is available to export.');
			const result = await this.dataOperations.exportSvg({ mode, query: this.model.query, distribution: this.model.distribution });
			this.publish({ ...this.model, operation: result.outcome === 'downloaded' ? { kind: 'completed', message: result.message } : { kind: 'error', message: result.message } });
		} catch (error) {
			this.operationError(error);
		}
	}

	private async exportRaw(scope: ExportScope): Promise<void> {
		if (!this.beginOperation('export', 'Exporting raw JSON')) return;
		try {
			if (!this.dataOperations) throw new Error('Raw export is unavailable.');
			const result = await this.dataOperations.exportRaw({ scope, onProgress: (progress) => this.onOperationProgress('Exporting raw JSON', progress) });
			const message = `${result.destination.message}; ${result.records} record${result.records === 1 ? '' : 's'}, ${result.warnings} warning${result.warnings === 1 ? '' : 's'}.`;
			this.publish({ ...this.model, operation: result.destination.outcome === 'downloaded' ? { kind: 'completed', message } : { kind: 'error', message } });
		} catch (error) {
			this.operationError(error);
		}
	}

	private async rebuildSummaries(): Promise<void> {
		if (!this.beginOperation('rebuild', 'Rebuilding summaries')) return;
		try {
			if (!this.dataOperations) throw new Error('Summary rebuild is unavailable.');
			const result = await this.dataOperations.rebuild((progress) => this.onOperationProgress('Rebuilding summaries', progress));
			const counts = { rebuilt: 0, unchanged: 0, unavailable: 0, failed: 0 };
			for (const outcome of result.outcomes) counts[outcome.outcome] += 1;
			const message = `Rebuild finished: ${counts.rebuilt} rebuilt, ${counts.unchanged} unchanged, ${counts.unavailable} unavailable, ${counts.failed} failed.`;
			this.publish({ ...this.model, operation: counts.failed > 0 ? { kind: 'error', message } : { kind: 'completed', message } });
			await this.refresh();
		} catch (error) {
			this.operationError(error);
		}
	}

	private async planDeletion(scope: DeletionScope): Promise<void> {
		if (this.model.operation.kind === 'running') return;
		try {
			if (!this.dataOperations) throw new Error('Data deletion is unavailable.');
			const plan = await this.dataOperations.planDeletion(scope);
			if (this.stopped) return;
			this.publish({ ...this.model, operation: { kind: 'deletion-preview', plan } });
		} catch (error) {
			this.operationError(error);
		}
	}

	private async executeDeletion(planId: string): Promise<void> {
		if (!this.dataOperations || this.model.operation.kind !== 'deletion-preview' || this.model.operation.plan.planId !== planId || !isDeletionPlanFresh(this.model.operation.plan)) {
			this.publish({ ...this.model, operation: { kind: 'error', message: 'Deletion plan is missing or stale. Create a new preview.' } });
			return;
		}
		const plan = this.model.operation.plan;
		if (!this.beginOperation('deletion', 'Deleting activity data')) return;
		try {
			const result = await this.dataOperations.executeDeletion(plan, (progress) => this.onOperationProgress('Deleting activity data', progress));
			const message = result.outcome === 'completed'
				? `Deletion completed for plan ${result.planId}.`
				: result.outcome === 'aborted-drift'
					? `Deletion aborted because plan ${result.planId} became stale; no data was removed.`
					: `Deletion partially failed for plan ${result.planId}: ${result.errors.map((error) => `${error.path}: ${error.message}`).join('; ')}`;
			this.publish({ ...this.model, operation: result.outcome === 'completed' ? { kind: 'completed', message } : { kind: 'error', message } });
			await this.refresh();
		} catch (error) {
			this.operationError(error);
		}
	}

	private beginOperation(operation: DataOperationProgress['operation'] | 'svg-export', label: string): boolean {
		if (this.stopped || this.model.operation.kind === 'running') return false;
		this.publish({ ...this.model, operation: { kind: 'running', operation, label, completed: 0, total: 0 } });
		return true;
	}

	private onOperationProgress(label: string, progress: DataOperationProgress): void {
		if (this.stopped || this.model.operation.kind !== 'running') return;
		this.publish({ ...this.model, operation: { kind: 'running', operation: progress.operation, label, completed: progress.completed, total: progress.total } });
	}

	private operationError(error: unknown): void {
		if (this.stopped) return;
		this.publish({ ...this.model, operation: { kind: 'error', message: error instanceof Error ? error.message : String(error) } });
	}
}

const DELETION_PLAN_MAX_AGE_MS = 5 * 60_000;

export function isDeletionPlanFresh(plan: { createdAt: string }, nowMs = Date.now()): boolean {
	const ageMs = nowMs - Date.parse(plan.createdAt);
	return Number.isFinite(ageMs) && ageMs >= 0 && ageMs <= DELETION_PLAN_MAX_AGE_MS;
}
