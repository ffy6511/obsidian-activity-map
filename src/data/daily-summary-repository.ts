/**
 * Daily summary repository.
 *
 * Daily summaries are derived, replaceable projections: one file per device and
 * local date, holding metricsByFileId aggregated from the retained raw shard.
 * They are rebuildable from raw evidence and verified after replacement before
 * any query or cache invalidation uses them. Raw retention may delete the
 * underlying shard; the last verified summary remains authoritative and records
 * that raw rebuild is unavailable.
 */

import { SafeJsonStore, type JsonFileAdapter } from './safe-json-store';
import type { NdjsonShardStore } from './ndjson-shard-store';
import type { PathAdapter } from './paths';
import { dailySummaryPath, sessionShardPath } from './paths';
import type { ValidatedEventEnvelope } from './schema';

/** Per-file metrics for one day. */
export interface DailyFileMetrics {
	activeMs: number;
	editingMs: number;
	openCount: number;
}

/** The persisted daily summary (schema version 1). */
export interface DailySummary {
	schemaVersion: 1;
	deviceId: string;
	localDate: string;
	generatedAt: string;
	sourceRecordCount: number;
	/** Sorted record-id fingerprint proving which raw evidence was aggregated. */
	sourceFingerprint: string;
	metricsByFileId: Record<string, DailyFileMetrics>;
	/** Non-finite values, unknown references, or other source problems. */
	warnings: DataWarning[];
}

/** A stable diagnostic code with context, surfaced to the UI. */
export interface DataWarning {
	code: string;
	message: string;
}

/** Load and rebuild result, including whether raw evidence was unavailable. */
export interface SummaryResult {
	summary: DailySummary;
	/** True when the rebuild could not read the raw shard (e.g. post-retention). */
	rawUnavailable: boolean;
}

/**
 * Rebuildable daily-summary store. Construct one per plugin instance.
 */
export class DailySummaryRepository {
	private readonly shardStore: NdjsonShardStore;
	private readonly pathAdapter: PathAdapter;
	private readonly fileAdapter: JsonFileAdapter;

	constructor(args: { shardStore: NdjsonShardStore; pathAdapter: PathAdapter; fileAdapter: JsonFileAdapter }) {
		this.shardStore = args.shardStore;
		this.pathAdapter = args.pathAdapter;
		this.fileAdapter = args.fileAdapter;
	}

	/**
	 * Rebuild a device/date summary from its complete retained shard. Applies
	 * adjustments by recordId and rejects non-finite/negative values. When the
	 * raw shard is missing or unreadable, returns `rawUnavailable` so the caller
	 * keeps the last verified summary as authoritative.
	 */
	async rebuild(args: {
		deviceId: string;
		localDate: string;
		nowIso: string;
	}): Promise<SummaryResult> {
		// Rebuild reads the retained raw session shard (not the daily summary).
		const path = sessionShardPath(this.pathAdapter, args.deviceId, args.localDate);
		const read = await this.shardStore.read(path);
		const warnings: DataWarning[] = [...read.diagnostics.map((d) => ({
			code: d.code,
			message: `line ${d.lineNumber}: ${d.message}`,
		}))];
		const metricsByFileId = aggregateMetrics(read.records, args.localDate, warnings);
		const summary: DailySummary = {
			schemaVersion: 1,
			deviceId: args.deviceId,
			localDate: args.localDate,
			generatedAt: args.nowIso,
			sourceRecordCount: read.records.length,
			sourceFingerprint: fingerprintRecords(read.records),
			metricsByFileId,
			warnings,
		};
		// A missing shard file (no records and no diagnostics) means the raw
		// evidence has expired or never existed; the caller keeps the prior
		// verified summary.
		const rawUnavailable = read.records.length === 0 && read.diagnostics.length === 0;
		return { summary, rawUnavailable };
	}

	/**
	 * Persist a summary through a verified replacement and return when readable.
	 * Uses a safe inline write + read-back verify; the full .next/.bak protocol
	 * is provided by SafeJsonStore for callers that prefer it.
	 */
	async save(args: {
		deviceId: string;
		localDate: string;
		summary: DailySummary;
	}): Promise<void> {
		const store = this.storeFor(args);
		await store.save(args.summary, (value) => JSON.stringify(value));
		const verified = await this.load(args);
		if (!verified || verified.sourceFingerprint !== args.summary.sourceFingerprint) {
			throw new Error('daily-summary-verify-failed');
		}
	}

	/** Load a verified daily summary, or null if absent/invalid. */
	async load(args: { deviceId: string; localDate: string }): Promise<DailySummary | null> {
		const path = dailySummaryPath(this.pathAdapter, args.deviceId, args.localDate);
		try {
			if (!(await this.fileAdapter.exists(path))) {
				return null;
			}
			const text = await this.fileAdapter.read(path);
			const parsed = JSON.parse(text) as unknown;
			return validateSummary(parsed);
		} catch {
			return null;
		}
	}

	/** Remove a daily summary file (used by deletion/retention). */
	async remove(args: { deviceId: string; localDate: string }): Promise<void> {
		const path = dailySummaryPath(this.pathAdapter, args.deviceId, args.localDate);
		if (await this.fileAdapter.exists(path)) {
			await this.fileAdapter.remove(path);
		}
	}

	/** A SafeJsonStore for callers that want the full recoverable protocol. */
	storeFor(args: { deviceId: string; localDate: string }): SafeJsonStore {
		const path = dailySummaryPath(this.pathAdapter, args.deviceId, args.localDate);
		return new SafeJsonStore(this.fileAdapter, path);
	}
}

/**
 * Aggregate session and adjustment records into per-file metrics. Adjustments
 * apply signed deltas by candidateId/fileId; unknown or duplicate references
 * become warnings rather than blocking the summary.
 */
export function aggregateMetrics(
	records: readonly ValidatedEventEnvelope[],
	_localDate: string,
	warnings: DataWarning[],
): Record<string, DailyFileMetrics> {
	const byFile: Record<string, DailyFileMetrics> = {};
	const seenAdjustments = new Set<string>();
	for (const record of records) {
		const bucket = (byFile[record.fileId] ??= { activeMs: 0, editingMs: 0, openCount: 0 });
		if (record.type === 'session') {
			const payload = record.payload;
			if (payload.kind === 'session') {
				bucket.activeMs += payload.activeMs;
				bucket.editingMs += payload.editingMs;
				bucket.openCount += payload.openCount;
			}
		} else if (record.type === 'adjustment') {
			const payload = record.payload;
			if (payload.kind === 'adjustment') {
				const adjustmentKey = `${payload.candidateId}:${payload.automatic ? 'automatic' : 'user'}`;
				if (seenAdjustments.has(adjustmentKey)) {
					warnings.push({
						code: 'duplicate-adjustment',
						message: `duplicate recovery adjustment ignored for ${payload.candidateId}`,
					});
					continue;
				}
				seenAdjustments.add(adjustmentKey);
				bucket.activeMs += payload.deltaMs;
			}
		}
	}
	// Invariant enforcement: editingMs must not exceed activeMs; reject negatives.
	for (const [fileId, metrics] of Object.entries(byFile)) {
		if (!Number.isFinite(metrics.activeMs) || metrics.activeMs < 0) {
			warnings.push({ code: 'invalid-metrics', message: `non-finite/negative activeMs for ${fileId}` });
			metrics.activeMs = 0;
		}
		if (!Number.isFinite(metrics.editingMs) || metrics.editingMs < 0) {
			warnings.push({ code: 'invalid-metrics', message: `non-finite/negative editingMs for ${fileId}` });
			metrics.editingMs = 0;
		}
		if (metrics.editingMs > metrics.activeMs) {
			warnings.push({ code: 'invalid-metrics', message: `editingMs>activeMs for ${fileId}; clamping` });
			metrics.editingMs = metrics.activeMs;
		}
		metrics.activeMs = Math.round(metrics.activeMs);
		metrics.editingMs = Math.round(metrics.editingMs);
	}
	return byFile;
}

/** Structural validation of a daily summary. */
function validateSummary(raw: unknown): DailySummary {
	if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
		throw new Error('summary-not-object');
	}
	const obj = raw as Record<string, unknown>;
	if (obj.schemaVersion !== 1) {
		throw new Error(`summary-unsupported-schema-${String(obj.schemaVersion)}`);
	}
	if (
		typeof obj.deviceId !== 'string' ||
		typeof obj.localDate !== 'string' ||
		typeof obj.generatedAt !== 'string' ||
		typeof obj.sourceRecordCount !== 'number' ||
		!Number.isInteger(obj.sourceRecordCount) ||
		obj.sourceRecordCount < 0 ||
		typeof obj.sourceFingerprint !== 'string' ||
		typeof obj.metricsByFileId !== 'object' ||
		obj.metricsByFileId === null ||
		!Array.isArray(obj.warnings)
	) {
		throw new Error('summary-invalid-fields');
	}
	return raw as DailySummary;
}

/** Stable evidence fingerprint used by retention and deletion drift checks. */
export function fingerprintRecords(records: readonly ValidatedEventEnvelope[]): string {
	return records.map((record) => record.recordId).sort().join('|');
}
