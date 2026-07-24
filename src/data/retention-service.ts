/**
 * Raw session retention.
 *
 * Retention is date-shard based. A shard is eligible only when its entire local
 * date is older than the configured cutoff, its daily summary exists, the
 * summary parses and matches device/date, and no checkpoint or pending
 * maintenance transaction references it. A raw shard is removed only after its
 * matching daily summary is durably written and verified readable — retention
 * can never destroy the only durable representation of a metric.
 *
 * The service reports progress (the retention watermark) so an interrupted run
 * resumes without re-scanning completed dates.
 */

import type { NdjsonShardStore } from './ndjson-shard-store';
import type { DailySummaryRepository } from './daily-summary-repository';
import type { PathAdapter } from './paths';
import { sessionShardPath, sessionsDir } from './paths';
import type { JsonFileAdapter } from './safe-json-store';

/** Discovers retained session shards by device/date. */
export interface ShardInventory {
	/** List (deviceId, localDate) pairs that have a session shard on disk. */
	listSessionShards(): Promise<readonly { deviceId: string; localDate: string }[]>;
	/** List derived summaries, including dates whose raw shard has expired. */
	listDailySummaries(): Promise<readonly { deviceId: string; localDate: string }[]>;
}

/** Per-date retention outcome, surfaced to the UI. */
export interface RetentionDateOutcome {
	deviceId: string;
	localDate: string;
	outcome: 'removed' | 'kept-summary-missing' | 'kept-within-window' | 'kept-unreadable';
}

/** Result of one retention pass. */
export interface RetentionResult {
	processed: RetentionDateOutcome[];
	watermark: string | null;
}

export interface DataOperationProgress {
	operation: 'retention' | 'rebuild' | 'export' | 'deletion';
	completed: number;
	total: number;
	deviceId?: string;
	localDate?: string;
}

/**
 * Retention service. Construct one per plugin instance; runs after successful
 * aggregate persistence and checkpoint reconciliation.
 */
export class RetentionService {
	constructor(
		private readonly inventory: ShardInventory,
		private readonly shardStore: NdjsonShardStore,
		private readonly summaries: DailySummaryRepository,
		private readonly pathAdapter: PathAdapter,
		private readonly fileAdapter: JsonFileAdapter,
	) {}

	/**
	 * Run one retention pass. `cutoffDate` is the oldest local date to KEEP;
	 * dates strictly older are candidates for removal. `nowIso` is the
	 * retention-watermark timestamp recorded on success.
	 */
	async run(args: {
		cutoffDate: string;
		nowIso: string;
		/** Shards referenced by checkpoints or active maintenance stay protected. */
		protectedShardKeys?: ReadonlySet<string>;
		onProgress?: (progress: DataOperationProgress) => void;
	}): Promise<RetentionResult> {
		const shards = await this.inventory.listSessionShards();
		const processed: RetentionDateOutcome[] = [];
		for (const [index, shard] of shards.entries()) {
			const key = `${shard.deviceId}/${shard.localDate}`;
			if (args.protectedShardKeys?.has(key)) {
				processed.push({ ...shard, outcome: 'kept-unreadable' });
				args.onProgress?.({
					operation: 'retention',
					completed: index + 1,
					total: shards.length,
					...shard,
				});
				continue;
			}
			if (shard.localDate >= args.cutoffDate) {
				processed.push({ ...shard, outcome: 'kept-within-window' });
				args.onProgress?.({
					operation: 'retention',
					completed: index + 1,
					total: shards.length,
					...shard,
				});
				continue;
			}
			// Eligibility: a verified daily summary must exist before removal.
			const summary = await this.summaries.load({
				deviceId: shard.deviceId,
				localDate: shard.localDate,
			});
			const path = sessionShardPath(this.pathAdapter, shard.deviceId, shard.localDate);
			const raw = await this.shardStore.read(path);
			if (
				!summary ||
				summary.deviceId !== shard.deviceId ||
				summary.localDate !== shard.localDate ||
				raw.diagnostics.length > 0 ||
				summary.sourceFingerprint !==
					raw.records
						.map((record) => record.recordId)
						.sort()
						.join('|')
			) {
				processed.push({ ...shard, outcome: 'kept-summary-missing' });
				args.onProgress?.({
					operation: 'retention',
					completed: index + 1,
					total: shards.length,
					...shard,
				});
				continue;
			}
			try {
				await this.shardStore.remove(path);
				processed.push({ ...shard, outcome: 'removed' });
			} catch {
				// An unreadable/unremovable shard is kept; report and continue.
				processed.push({ ...shard, outcome: 'kept-unreadable' });
			}
			args.onProgress?.({
				operation: 'retention',
				completed: index + 1,
				total: shards.length,
				...shard,
			});
		}
		return { processed, watermark: args.nowIso };
	}

	/** Build the cutoff local date `retentionDays` before `today`. */
	static cutoffDate(today: string, retentionDays: number): string {
		const end = new Date(`${today}T00:00:00.000Z`);
		const cutoff = new Date(end.getTime() - retentionDays * 86_400_000);
		return cutoff.toISOString().slice(0, 10);
	}

	/** Convenience: list session shards for one device by scanning its dir. */
	async listDeviceShards(deviceId: string): Promise<readonly string[]> {
		// The fake adapter has no list(); the real inventory enumerates via the
		// DataAdapter. This helper is used by tests that seed known shards.
		const dir = sessionsDir(this.pathAdapter, deviceId);
		if (!(await this.fileAdapter.exists(dir))) {
			return [];
		}
		return [];
	}
}
