/**
 * Raw JSON export.
 *
 * Streams retained session and adjustment records by selected scope (all, one
 * date, or one file), including schema/device/file/path metadata. Export never
 * reads note content, selected text, or typed strings — only the metric-bearing
 * envelopes already persisted in shards.
 */

import type { NdjsonShardStore } from './ndjson-shard-store';
import type { PathAdapter } from './paths';
import { sessionShardPath } from './paths';
import type { ShardInventory } from './retention-service';
import type { DataOperationProgress } from './retention-service';
import type { ValidatedEventEnvelope } from './schema';

/** Export scope. */
export type ExportScope =
	| { kind: 'all' }
	| { kind: 'date'; localDate: string }
	| { kind: 'file'; fileId: string };

/** Export result: metadata + records, ready to serialize. */
export interface RawExportResult {
	schemaVersion: 1;
	exportedAt: string;
	scope: ExportScope;
	deviceId: string | null;
	recordCount: number;
	records: ValidatedEventEnvelope[];
	warnings: { path: string; code: string; message: string }[];
}

/**
 * Raw export service. Construct one per plugin instance.
 */
export class RawExportService {
	constructor(
		private readonly inventory: ShardInventory,
		private readonly shardStore: NdjsonShardStore,
		private readonly pathAdapter: PathAdapter,
	) {}

	/** Collect records for the scope. `deviceId` filters to one device when set. */
	async export(args: {
		scope: ExportScope;
		nowIso: string;
		deviceId?: string;
		onProgress?: (progress: DataOperationProgress) => void;
	}): Promise<RawExportResult> {
		const shards = await this.inventory.listSessionShards();
		const filtered = shards.filter((s) =>
			args.deviceId ? s.deviceId === args.deviceId : true,
		);
		const records: ValidatedEventEnvelope[] = [];
		const warnings: RawExportResult['warnings'] = [];
		let exportDeviceId: string | null = null;
		const scopeFileId = args.scope.kind === 'file' ? args.scope.fileId : null;
		for (const [index, shard] of filtered.entries()) {
			if (args.scope.kind === 'date' && shard.localDate !== args.scope.localDate) {
				continue;
			}
			const path = sessionShardPath(this.pathAdapter, shard.deviceId, shard.localDate);
			const read = await this.shardStore.read(path);
			warnings.push(...read.diagnostics.map((warning) => ({ path, code: warning.code, message: warning.message })));
			const kept =
				scopeFileId !== null
					? read.records.filter((r) => r.fileId === scopeFileId)
					: read.records;
			records.push(...kept);
			if (exportDeviceId === null && shard.deviceId) {
				exportDeviceId = shard.deviceId;
			}
			args.onProgress?.({ operation: 'export', completed: index + 1, total: filtered.length, ...shard });
		}
		return {
			schemaVersion: 1,
			exportedAt: args.nowIso,
			scope: args.scope,
			deviceId: exportDeviceId,
			recordCount: records.length,
			records,
			warnings,
		};
	}
}
