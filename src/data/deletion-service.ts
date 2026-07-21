/**
 * Scoped deletion.
 *
 * Destructive operations run in two phases: `planDeletion` performs read-only
 * discovery and returns an immutable preview; `executeDeletion` accepts the
 * exact plan id, revalidates that the source set has not drifted, and aborts on
 * drift. Date/all deletion removes only Activity Map-owned paths. File deletion
 * rewrites affected raw shards and summaries through recoverable replacement,
 * then updates the registry. "All" preserves validated user settings and the
 * stable device id so clearing history does not reset configuration or create a
 * second device shard. A failed transaction retains recoverable state and
 * reports affected paths; it never reports success after partial deletion.
 */

import type { NdjsonShardStore } from './ndjson-shard-store';
import type { DailySummaryRepository } from './daily-summary-repository';
import type { PathAdapter } from './paths';
import { sessionShardPath, dailySummaryPath, checkpointPath, filesRegistryPath } from './paths';
import type { JsonFileAdapter } from './safe-json-store';
import type { DataOperationProgress, ShardInventory } from './retention-service';
import type { FileRegistry } from './file-registry';
import { fingerprintRecords } from './daily-summary-repository';

/** Deletion scope. */
export type DeletionScope =
	| { kind: 'all' }
	| { kind: 'date'; localDate: string }
	| { kind: 'file'; fileId: string };

/** Immutable deletion preview returned by planDeletion. */
export interface DeletionPlan {
	planId: string;
	scope: DeletionScope;
	affectedPaths: string[];
	affectedRecordCount: number;
	affectedSummaryCount: number;
	createdAt: string;
	/** A content hash of the source set, used to detect drift before execution. */
	sourceFingerprint: string;
}

/** Result of executing a plan. */
export interface DeletionResult {
	planId: string;
	outcome: 'completed' | 'aborted-drift' | 'partial-failure';
	removedPaths: string[];
	remainingRecordCount: number;
	errors: { path: string; message: string }[];
}

/** Generate a plan id using a short random suffix. */
function newPlanId(): string {
	return `plan-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Fingerprint a set of (deviceId, localDate, recordCount) tuples for drift detection. */
function shardKey(shard: { deviceId: string; localDate: string }): string {
	return `${shard.deviceId}/${shard.localDate}`;
}

/**
 * Deletion service. Construct one per plugin instance.
 */
export class DeletionService {
	constructor(
		private readonly inventory: ShardInventory,
		private readonly shardStore: NdjsonShardStore,
		private readonly summaries: DailySummaryRepository,
		private readonly pathAdapter: PathAdapter,
		private readonly fileAdapter: JsonFileAdapter,
		private readonly registry: FileRegistry,
	) {}

	/** Read-only planning: returns an immutable preview without mutating anything. */
	async planDeletion(args: { scope: DeletionScope; nowIso: string }): Promise<DeletionPlan> {
		const scope = args.scope;
		const scopeFileId = scope.kind === 'file' ? scope.fileId : null;
		const scopeDate = scope.kind === 'date' ? scope.localDate : null;
		const sessionShards = await this.inventory.listSessionShards();
		const summaryShards = await this.inventory.listDailySummaries();
		const shardFingerprints: string[] = [];
		const affectedPaths: string[] = [];
		let affectedRecordCount = 0;
		let affectedSummaryCount = 0;
		for (const shard of sessionShards) {
			if (scopeDate !== null && shard.localDate !== scopeDate) {
				continue;
			}
			const sessionPath = sessionShardPath(this.pathAdapter, shard.deviceId, shard.localDate);
			const dailyPath = dailySummaryPath(this.pathAdapter, shard.deviceId, shard.localDate);
			const read = await this.shardStore.read(sessionPath);
			const scopedRecords =
				scopeFileId !== null
					? read.records.filter((r) => r.fileId === scopeFileId)
					: read.records;
			if (scopedRecords.length === 0 && scopeFileId !== null) {
				continue;
			}
			shardFingerprints.push(`${shardKey(shard)}:${fingerprintRecords(read.records)}`);
			affectedRecordCount += scopedRecords.length;
			affectedPaths.push(sessionPath, dailyPath);
			affectedSummaryCount += 1;
		}
		if (scopeFileId === null) {
			for (const shard of summaryShards) {
				if (scopeDate !== null && shard.localDate !== scopeDate) {
					continue;
				}
				affectedPaths.push(dailySummaryPath(this.pathAdapter, shard.deviceId, shard.localDate));
				if (!sessionShards.some((session) => shardKey(session) === shardKey(shard))) {
					affectedSummaryCount += 1;
				}
			}
		}
		if (scope.kind === 'all') {
			affectedPaths.push(checkpointPath(this.pathAdapter), filesRegistryPath(this.pathAdapter));
		}
		return {
			planId: newPlanId(),
			scope: args.scope,
			affectedPaths: [...new Set(affectedPaths)],
			affectedRecordCount,
			affectedSummaryCount,
			createdAt: args.nowIso,
			sourceFingerprint: shardFingerprints.sort().join('||'),
		};
	}

	/**
	 * Execute a plan by id. Revalidates the source fingerprint; aborts on drift.
	 * Mutates one shard at a time through recoverable rewrite; a partial failure
	 * leaves recoverable state and never reports success.
	 */
	async executeDeletion(args: {
		plan: DeletionPlan;
		nowIso: string;
		onProgress?: (progress: DataOperationProgress) => void;
	}): Promise<DeletionResult> {
		// Re-plan to detect drift against the same scope.
		const recheck = await this.planDeletion({ scope: args.plan.scope, nowIso: args.nowIso });
		if (recheck.sourceFingerprint !== args.plan.sourceFingerprint) {
			return {
				planId: args.plan.planId,
				outcome: 'aborted-drift',
				removedPaths: [],
				remainingRecordCount: recheck.affectedRecordCount,
				errors: [],
			};
		}
		const removedPaths: string[] = [];
		const errors: DeletionResult['errors'] = [];
		const sessionShards = await this.inventory.listSessionShards();
		const summaryShards = await this.inventory.listDailySummaries();
		const scope = args.plan.scope;
		const scopeFileId = scope.kind === 'file' ? scope.fileId : null;
		const scopeDate = scope.kind === 'date' ? scope.localDate : null;
		for (const [index, shard] of sessionShards.entries()) {
			if (scopeDate !== null && shard.localDate !== scopeDate) {
				continue;
			}
			const sessionPath = sessionShardPath(this.pathAdapter, shard.deviceId, shard.localDate);
			const dailyPath = dailySummaryPath(this.pathAdapter, shard.deviceId, shard.localDate);
			try {
			if (scopeFileId !== null) {
				// File scope: rewrite the shard dropping the file's records. The
				// predicate keeps every record whose fileId is NOT the target.
				const targetFileId = scopeFileId;
				const before = (await this.shardStore.read(sessionPath)).records.length;
				const rewrite = await this.shardStore.rewrite(
					sessionPath,
					(r) => r.fileId !== targetFileId,
				);
				if (rewrite.after < before) {
					removedPaths.push(sessionPath);
				}
				// Rebuild the affected summary from the rewritten shard.
				const rebuilt = await this.summaries.rebuild({
						deviceId: shard.deviceId,
						localDate: shard.localDate,
						nowIso: args.nowIso,
					});
				if (!rebuilt.rawUnavailable) {
					await this.summaries.save({
							deviceId: shard.deviceId,
							localDate: shard.localDate,
							summary: rebuilt.summary,
					});
				}
			} else {
				// date/all scope: remove the shard and summary outright.
				await this.shardStore.remove(sessionPath);
				await this.summaries.remove({ deviceId: shard.deviceId, localDate: shard.localDate });
				removedPaths.push(sessionPath, dailyPath);
			}
			} catch (error) {
				errors.push({ path: sessionPath, message: error instanceof Error ? error.message : String(error) });
			}
			args.onProgress?.({ operation: 'deletion', completed: index + 1, total: sessionShards.length, ...shard });
		}
		if (scopeFileId === null) {
			for (const summary of summaryShards) {
				if (scopeDate !== null && summary.localDate !== scopeDate) {
					continue;
				}
				const path = dailySummaryPath(this.pathAdapter, summary.deviceId, summary.localDate);
				if (removedPaths.includes(path)) {
					continue;
				}
				try {
					await this.summaries.remove(summary);
					removedPaths.push(path);
				} catch (error) {
					errors.push({ path, message: error instanceof Error ? error.message : String(error) });
				}
			}
		}
		// 'all' also clears the checkpoint and registry files.
		if (scope.kind === 'all') {
			const cp = checkpointPath(this.pathAdapter);
			try {
				if (await this.fileAdapter.exists(cp)) {
					await this.fileAdapter.remove(cp);
					removedPaths.push(cp);
				}
				await this.registry.clear();
				removedPaths.push(filesRegistryPath(this.pathAdapter));
			} catch (error) {
				errors.push({ path: cp, message: error instanceof Error ? error.message : String(error) });
			}
		}
		return {
			planId: args.plan.planId,
			outcome: errors.length === 0 ? 'completed' : 'partial-failure',
			removedPaths: [...new Set(removedPaths)],
			remainingRecordCount: errors.length === 0 ? 0 : recheck.affectedRecordCount,
			errors,
		};
	}
}
