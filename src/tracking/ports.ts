/**
 * Tracking runtime ports.
 *
 * The engine is pure and dependency-free; adapters implement these ports.
 * Spec 01 verifies the runtime against in-memory fakes; Spec 02 provides the
 * durable NDJSON/checkpoint implementations. Keeping these contracts narrow is
 * what makes the boundary between time semantics and persistence testable.
 */

import type {
	ClosedSessionSegment,
	RecoveryDecision,
	RuntimeCheckpoint,
	TrackingSnapshot,
} from '../domain/activity';

/**
 * Append-only sink for closed sessions and auditable recovery decisions. Append
 * must succeed before the related checkpoint is cleared; a failure transitions
 * the runtime to `degraded` rather than dropping evidence.
 */
export interface TrackingRecordSink {
	appendSessions(records: readonly ClosedSessionSegment[]): Promise<void>;
	appendRecoveryDecision(decision: RecoveryDecision): Promise<void>;
}

/** Recoverable in-flight snapshot store. Used once at startup and on each flush. */
export interface TrackingCheckpointPort {
	write(snapshot: RuntimeCheckpoint): Promise<void>;
	clear(): Promise<void>;
}

/**
 * Resolves a vault file to its stable identity and current path. Spec 02 owns
 * the durable registry; the runtime never assigns IDs itself.
 */
export interface FileIdentityPort {
	resolve(file: {
		path: string;
	}): Promise<{ fileId: string; currentPath: string }>;
}

/** Observer notified after every externally visible transition. */
export interface TrackingObserver {
	onSnapshot(snapshot: TrackingSnapshot): void;
}

/** A sink that records every emitted session/decision; useful for tests and the controller. */
export class InMemoryTrackingSink implements TrackingRecordSink {
	readonly sessions: ClosedSessionSegment[] = [];
	readonly decisions: RecoveryDecision[] = [];
	private readonly failures: ReadonlyArray<keyof TrackingRecordSink> | null;
	private calls = 0;

	constructor(opts: { failAppendSessionsAfter?: number } = {}) {
		this.failures =
			opts.failAppendSessionsAfter !== undefined
				? (['appendSessions'] as const)
				: null;
		this.failThreshold = opts.failAppendSessionsAfter ?? Infinity;
	}
	private failThreshold: number;

	async appendSessions(records: readonly ClosedSessionSegment[]): Promise<void> {
		if (
			this.failures?.includes('appendSessions') &&
			this.calls >= this.failThreshold
		) {
			throw new Error('injected appendSessions failure');
		}
		this.calls += 1;
		for (const record of records) {
			this.sessions.push(record);
		}
	}

	async appendRecoveryDecision(decision: RecoveryDecision): Promise<void> {
		this.decisions.push(decision);
	}
}

/** Checkpoint store backed by a single mutable slot; used by tests. */
export class InMemoryCheckpointPort implements TrackingCheckpointPort {
	snapshot: RuntimeCheckpoint | null = null;
	writeCount = 0;
	clearCount = 0;
	async write(snapshot: RuntimeCheckpoint): Promise<void> {
		this.snapshot = snapshot;
		this.writeCount += 1;
	}
	async clear(): Promise<void> {
		this.snapshot = null;
		this.clearCount += 1;
	}
}
