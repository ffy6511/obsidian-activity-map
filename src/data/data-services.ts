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

import type { ClosedSessionSegment, RecoveryDecision, TypedInputRecord } from '../domain/activity';
import type { ActivityMapSettings } from '../domain/settings';
import type { FileIdentityPort, TrackingRecordSink } from '../tracking/ports';
import { localDateFor } from '../platform/clock';
import {
	buildAdjustmentEnvelope,
	buildSessionEnvelope,
	buildTypedInputEnvelope,
} from './event-envelope';
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
		/** Rebuild derived state after a durable shard append. */
		onShardChanged?: (deviceId: string, localDate: string) => Promise<void>;
	}) {
		this.registry = args.registry;
		this.pathAdapter = args.pathAdapter;
		this.shardStore = new NdjsonShardStore(args.fileAdapter);
		this.deviceId = args.settings.deviceId;
		this.timeZone = args.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
		this.onShardChanged = args.onShardChanged;
	}

	private readonly registry: FileRegistry;
	private readonly pathAdapter: PathAdapter;
	private readonly onShardChanged:
		((deviceId: string, localDate: string) => Promise<void>) | undefined;

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
			const envelopes = bucket.map((segment) => buildSessionEnvelope(segment, this.deviceId));
			const path = sessionShardPath(this.pathAdapter, this.deviceId, localDate);
			await this.shardStore.append(path, envelopes);
			await this.onShardChanged?.(this.deviceId, localDate);
		}
	}

	async appendRecoveryDecision(decision: RecoveryDecision): Promise<void> {
		// Adjustments stay with the candidate's source file and event-time date;
		// decision time can be on a later day after a prompt remained pending.
		const localDate = localDateFor(Date.parse(decision.intervalStartedAt), this.timeZone);
		const envelopes = [
			buildAdjustmentEnvelope(
				decision,
				this.deviceId,
				decision.fileId,
				decision.pathAtEvent,
				localDate,
			),
		];
		const path = sessionShardPath(this.pathAdapter, this.deviceId, localDate);
		await this.shardStore.append(path, envelopes);
		await this.onShardChanged?.(this.deviceId, localDate);
	}

	async appendTypedInputs(records: readonly TypedInputRecord[]): Promise<void> {
		const byDate = new Map<string, TypedInputRecord[]>();
		for (const record of records) {
			const bucket = byDate.get(record.localDate) ?? [];
			bucket.push(record);
			byDate.set(record.localDate, bucket);
		}
		for (const [localDate, bucket] of byDate) {
			const path = sessionShardPath(this.pathAdapter, this.deviceId, localDate);
			await this.shardStore.append(
				path,
				bucket.map((record) => buildTypedInputEnvelope(record, this.deviceId)),
			);
			await this.onShardChanged?.(this.deviceId, localDate);
		}
	}

	// --- FileIdentityPort ----------------------------------------------

	async resolve(file: { path: string }): Promise<{ fileId: string; currentPath: string }> {
		const nowIso = new Date().toISOString();
		const identity = await this.registry.resolve(file.path, nowIso);
		await this.registry.save();
		return identity;
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
