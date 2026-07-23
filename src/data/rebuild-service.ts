/**
 * Aggregate rebuild service.
 *
 * Recomputes daily summaries from retained raw evidence, per date/device. Each
 * date reports rebuilt, unchanged, unavailable (raw evidence expired or absent),
 * or failed, without hiding partial results. Rebuild never silently overwrites
 * a verified summary when raw evidence is unavailable: the prior summary stays
 * authoritative for that date.
 */

import type { NdjsonShardStore } from './ndjson-shard-store';
import type { DailySummaryRepository, SummaryResult } from './daily-summary-repository';
import type { ShardInventory } from './retention-service';
import type { DataOperationProgress } from './retention-service';

/** Per-date rebuild outcome, surfaced to the UI. */
export interface RebuildDateOutcome {
	deviceId: string;
	localDate: string;
	outcome: 'rebuilt' | 'unchanged' | 'unavailable' | 'failed';
	warnings?: number;
}

/** Result of a rebuild pass. */
export interface RebuildResult {
	outcomes: RebuildDateOutcome[];
}

/**
 * Rebuild service. Construct one per plugin instance.
 */
export class RebuildService {
	constructor(
		private readonly inventory: ShardInventory,
		private readonly shardStore: NdjsonShardStore,
		private readonly summaries: DailySummaryRepository,
	) {}

	/**
	 * Rebuild summaries for the listed device/date pairs (or all known shards
	 * when `dates` is null). Verifies each replacement before publishing.
	 */
	async rebuild(args: {
		dates?: readonly { deviceId: string; localDate: string }[] | null;
		nowIso: string;
		onProgress?: (progress: DataOperationProgress) => void;
	}): Promise<RebuildResult> {
		const targets = args.dates ?? (await this.inventory.listSessionShards());
		const outcomes: RebuildDateOutcome[] = [];
		for (const [index, target] of targets.entries()) {
			const existing = await this.summaries.load(target);
			let rebuilt: SummaryResult;
			try {
				rebuilt = await this.summaries.rebuild({
					deviceId: target.deviceId,
					localDate: target.localDate,
					nowIso: args.nowIso,
				});
			} catch {
				outcomes.push({ ...target, outcome: 'failed' });
				args.onProgress?.({ operation: 'rebuild', completed: index + 1, total: targets.length, ...target });
				continue;
			}
			if (rebuilt.rawUnavailable) {
				// Raw evidence gone: keep the prior verified summary, report unavailable.
				outcomes.push({ ...target, outcome: 'unavailable' });
				args.onProgress?.({ operation: 'rebuild', completed: index + 1, total: targets.length, ...target });
				continue;
			}
			if (existing && sameMetrics(existing.metricsByFileId, rebuilt.summary.metricsByFileId)) {
				outcomes.push({ ...target, outcome: 'unchanged' });
				args.onProgress?.({ operation: 'rebuild', completed: index + 1, total: targets.length, ...target });
				continue;
			}
			try {
				await this.summaries.save({
					deviceId: target.deviceId,
					localDate: target.localDate,
					summary: rebuilt.summary,
				});
				outcomes.push({
					...target,
					outcome: 'rebuilt',
					warnings: rebuilt.summary.warnings.length,
				});
			} catch {
				outcomes.push({ ...target, outcome: 'failed' });
			}
			args.onProgress?.({ operation: 'rebuild', completed: index + 1, total: targets.length, ...target });
		}
		return { outcomes };
	}
}

/** Structural equality of two metrics maps (used to detect no-op rebuilds). */
function sameMetrics(
	a: Record<string, { activeMs: number; editingMs: number; openCount: number; typedChars: number }>,
	b: Record<string, { activeMs: number; editingMs: number; openCount: number; typedChars: number }>,
): boolean {
	const aKeys = Object.keys(a);
	const bKeys = Object.keys(b);
	if (aKeys.length !== bKeys.length) {
		return false;
	}
	for (const key of aKeys) {
		const av = a[key];
		const bv = b[key];
		if (!av || !bv) {
			return false;
		}
		if (av.activeMs !== bv.activeMs || av.editingMs !== bv.editingMs || av.openCount !== bv.openCount || av.typedChars !== bv.typedChars) {
			return false;
		}
	}
	return true;
}
