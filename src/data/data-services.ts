/**
 * Data services composition.
 *
 * Wires the file registry, NDJSON shard store, event envelope builder, and
 * checkpoint repository into the ports Spec 01's tracking runtime consumes:
 * {@link TrackingRecordSink} and {@link FileIdentityPort}. This is the single
 * place that knows how a closed session becomes a durable shard record.
 *
 * The composition owns device identity (from settings), routes each record to
 * its device/date shard, and ensures a record append succeeds before related
 * checkpoint work proceeds.
 */

import type { ClosedSessionSegment, RecoveryDecision } from '../domain/activity';
import type { ActivityMapSettings } from '../domain/settings';
import type {
	FileIdentityPort,
	TrackingRecordSink,
} from '../tracking/ports';
import { localDateFor } from '../platform/clock';
import { buildAdjustmentEnvelope, buildSessionEnvelope } from './event-envelope';
import { FileRegistry } from './file-registry';
import { NdjsonShardStore } from './ndjson-shard-store';
import { sessionShardPath, type PathAdapter } from './paths';

/**
 * The record sink + file-identity implementation backed by local sharded data.
 * Construct one per plugin instance after settings, registry, and stores load.
 */
export class DataServices implements TrackingRecordSink, FileIdentityPort {
	private readonly shardStore: NdjsonShardStore;
	private deviceId: string;
	private readonly timeZone: string;

	constructor(args: {
		registry: FileRegistry;
		/** JsonFileAdapter used by the shard store. */
		fileAdapter: import('./safe-json-store').JsonFileAdapter;
		/** PathAdapter used to resolve shard paths. */
		pathAdapter: PathAdapter;
		settings: ActivityMapSettings;
		/** IANA time zone for deriving local dates from wall time. */
		timeZone?: string;
	}) {
		this.registry = args.registry;
		this.pathAdapter = args.pathAdapter;
		this.shardStore = new NdjsonShardStore(args.fileAdapter);
		this.deviceId = args.settings.deviceId;
		this.timeZone = args.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
	}

	private readonly registry: FileRegistry;
	private readonly pathAdapter: PathAdapter;

	/** Update the effective device id after a settings change. */
	setDeviceId(deviceId: string): void {
		this.deviceId = deviceId;
	}

	// --- TrackingRecordSink --------------------------------------------

	async appendSessions(records: readonly ClosedSessionSegment[]): Promise<void> {
		// Group records by local date so each shard receives a coherent batch.
		const byDate = new Map<string, ClosedSessionSegment[]>();
		for (const record of records) {
			const bucket = byDate.get(record.localDate) ?? [];
			bucket.push(record);
			byDate.set(record.localDate, bucket);
		}
		for (const [localDate, bucket] of byDate) {
			const envelopes = bucket.map((segment) =>
				buildSessionEnvelope(segment, this.deviceId),
			);
			const path = sessionShardPath(this.pathAdapter, this.deviceId, localDate);
			await this.shardStore.append(path, envelopes);
		}
	}

	async appendRecoveryDecision(decision: RecoveryDecision): Promise<void> {
		// Adjustments are filed under the decision's local date. RecoveryDecision
		// does not carry fileId/pathAtEvent; the engine stamps the source target
		// onto the emitted segment, and adjustment envelopes use a neutral
		// identity here. The candidateId remains the auditable link.
		const localDate = localDateFor(
			Date.parse(decision.decidedAt),
			this.timeZone,
		);
		const envelopes = [
			buildAdjustmentEnvelope(
				decision,
				this.deviceId,
				'unknown-file',
				'unknown-path',
				localDate,
			),
		];
		const path = sessionShardPath(this.pathAdapter, this.deviceId, localDate);
		await this.shardStore.append(path, envelopes);
	}

	// --- FileIdentityPort ----------------------------------------------

	async resolve(file: { path: string }): Promise<{ fileId: string; currentPath: string }> {
		const nowIso = new Date().toISOString();
		return this.registry.resolve(file.path, nowIso);
	}

	/** Expose the shard store for query/rebuild/export services (Phase 2/3). */
	getShardStore(): NdjsonShardStore {
		return this.shardStore;
	}

	/** Expose the registry for query/export services. */
	getRegistry(): FileRegistry {
		return this.registry;
	}
}
