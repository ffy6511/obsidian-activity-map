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

/** Deletion scope. */
export type DeletionScope =
	| { kind: 'all' }
	| { kind: 'date'; localDate: string }
	| { kind: 'file'; fileId: string };

/** Frozen shard pair selected during deletion preview. */
export interface DeletionShardTarget {
	deviceId: string;
	localDate: string;
	/** Null for retained summary-only history whose raw shard has expired. */
	sessionPath: string | null;
	summaryPath: string;
}

/** Immutable deletion preview returned by planDeletion. */
export interface DeletionPlan {
	planId: string;
	scope: DeletionScope;
	affectedPaths: string[];
	affectedShards: DeletionShardTarget[];
	affectedRecordCount: number;
	affectedSummaryCount: number;
	createdAt: string;
	/** A content hash of the source set, used to detect drift before execution. */
	sourceFingerprint: string;
	/** Per-path preview fingerprints checked immediately before mutation. */
	pathFingerprints: Record<string, string>;
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
		const affectedPaths: string[] = [];
		const affectedShards = new Map<string, DeletionShardTarget>();
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
			affectedRecordCount += scopedRecords.length;
			affectedPaths.push(sessionPath, dailyPath);
			affectedShards.set(shardKey(shard), {
				deviceId: shard.deviceId,
				localDate: shard.localDate,
				sessionPath,
				summaryPath: dailyPath,
			});
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
					affectedShards.set(shardKey(shard), {
						deviceId: shard.deviceId,
						localDate: shard.localDate,
						sessionPath: null,
						summaryPath: dailySummaryPath(this.pathAdapter, shard.deviceId, shard.localDate),
					});
				}
			}
		}
		if (scope.kind === 'all') {
			affectedPaths.push(checkpointPath(this.pathAdapter), filesRegistryPath(this.pathAdapter));
		}
		const uniqueAffectedPaths = [...new Set(affectedPaths)].sort();
		const pathFingerprints = await this.fingerprintPaths(uniqueAffectedPaths);
		return {
			planId: newPlanId(),
			scope: args.scope,
			affectedPaths: uniqueAffectedPaths,
			affectedShards: [...affectedShards.values()].sort((a, b) => shardKey(a).localeCompare(shardKey(b))),
			affectedRecordCount,
			affectedSummaryCount,
			createdAt: args.nowIso,
			sourceFingerprint: fingerprintEntries(pathFingerprints),
			pathFingerprints,
		};
	}

	/** Fingerprint every path the plan may mutate, including summary-only data. */
	private async fingerprintPaths(paths: readonly string[]): Promise<Record<string, string>> {
		const entries: Record<string, string> = {};
		for (const path of paths) {
			entries[path] = await this.fingerprintPath(path);
		}
		return entries;
	}

	private async fingerprintPath(path: string): Promise<string> {
		if (!(await this.fileAdapter.exists(path))) return 'missing';
		try {
			const contents = await this.fileAdapter.read(path);
			return `${contents.length}:${fingerprintText(contents)}`;
		} catch {
			return 'unreadable';
		}
	}

	private async pathsMatchPlan(plan: DeletionPlan, paths: readonly string[] = plan.affectedPaths): Promise<boolean> {
		for (const path of paths) {
			if (await this.fingerprintPath(path) !== plan.pathFingerprints[path]) return false;
		}
		return true;
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
		// Re-plan once to reject both new scope paths and changed preview paths.
		// All mutations below iterate the frozen plan targets, never a fresh
		// inventory, so a later discovery cannot widen the destructive scope.
		const recheck = await this.planDeletion({ scope: args.plan.scope, nowIso: args.nowIso });
		if (
			recheck.sourceFingerprint !== args.plan.sourceFingerprint ||
			JSON.stringify(recheck.affectedPaths) !== JSON.stringify(args.plan.affectedPaths) ||
			JSON.stringify(recheck.affectedShards) !== JSON.stringify(args.plan.affectedShards) ||
			!(await this.pathsMatchPlan(args.plan))
		) {
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
		const scope = args.plan.scope;
		const scopeFileId = scope.kind === 'file' ? scope.fileId : null;
		for (const [index, shard] of args.plan.affectedShards.entries()) {
			const sessionPath = shard.sessionPath;
			const dailyPath = shard.summaryPath;
			try {
				// Check the complete shard pair immediately before its first write.
				// If earlier targets already changed, this becomes a visible partial
				// failure without touching the drifted or any plan-external path.
				const targetPaths = sessionPath === null ? [dailyPath] : [sessionPath, dailyPath];
				if (!(await this.pathsMatchPlan(args.plan, targetPaths))) {
					if (removedPaths.length === 0) {
						return {
							planId: args.plan.planId,
							outcome: 'aborted-drift',
							removedPaths: [],
							remainingRecordCount: recheck.affectedRecordCount,
							errors: [],
						};
					}
					errors.push({ path: sessionPath ?? dailyPath, message: 'deletion-plan-path-drift' });
					break;
				}
				if (scopeFileId !== null && sessionPath !== null) {
					// File scope rewrites only this previewed shard and then replaces
					// its derived summary from the surviving raw evidence.
					const targetFileId = scopeFileId;
					const before = (await this.shardStore.read(sessionPath)).records.length;
					const rewrite = await this.shardStore.rewrite(
						sessionPath,
						(r) => r.fileId !== targetFileId,
					);
					if (rewrite.after < before) {
						removedPaths.push(sessionPath);
					}
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
					// Date/all scope removes exactly the previewed shard pair.
					if (sessionPath !== null) await this.shardStore.remove(sessionPath);
					await this.summaries.remove({ deviceId: shard.deviceId, localDate: shard.localDate });
					if (sessionPath !== null) removedPaths.push(sessionPath);
					removedPaths.push(dailyPath);
				}
			} catch (error) {
				errors.push({
					path: sessionPath ?? dailyPath,
					message: error instanceof Error ? error.message : String(error),
				});
			}
			args.onProgress?.({
				operation: 'deletion',
				completed: index + 1,
				total: args.plan.affectedShards.length,
				deviceId: shard.deviceId,
				localDate: shard.localDate,
			});
		}
		// 'all' also clears the checkpoint and registry files.
		if (scope.kind === 'all' && errors.length === 0) {
			const cp = checkpointPath(this.pathAdapter);
			const registryPath = filesRegistryPath(this.pathAdapter);
			try {
				if (!(await this.pathsMatchPlan(args.plan, [cp, registryPath]))) {
					return removedPaths.length === 0
						? {
								planId: args.plan.planId,
								outcome: 'aborted-drift',
								removedPaths: [],
								remainingRecordCount: recheck.affectedRecordCount,
								errors: [],
							}
						: {
								planId: args.plan.planId,
								outcome: 'partial-failure',
								removedPaths: [...new Set(removedPaths)],
								remainingRecordCount: recheck.affectedRecordCount,
								errors: [{ path: cp, message: 'deletion-plan-path-drift' }],
							};
				}
				if (await this.fileAdapter.exists(cp)) {
					await this.fileAdapter.remove(cp);
					removedPaths.push(cp);
				}
				await this.registry.clear();
				removedPaths.push(registryPath);
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

function fingerprintEntries(entries: Record<string, string>): string {
	return Object.entries(entries)
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([path, fingerprint]) => `${path}:${fingerprint}`)
		.join('||');
}

/** Stable bounded content fingerprint for destructive-plan drift detection. */
function fingerprintText(contents: string): string {
	let first = 0x811c9dc5;
	let second = 0x9e3779b9;
	for (let index = 0; index < contents.length; index += 1) {
		const code = contents.charCodeAt(index);
		first = Math.imul(first ^ code, 0x01000193) >>> 0;
		second = Math.imul(second ^ (code + index), 0x85ebca6b) >>> 0;
	}
	return `${first.toString(16).padStart(8, '0')}${second.toString(16).padStart(8, '0')}`;
}
