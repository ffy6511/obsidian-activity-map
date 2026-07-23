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
	TypedInputRecord,
} from '../domain/activity';

/**
 * Append-only sink for closed sessions and auditable recovery decisions. Append
 * must succeed before the related checkpoint is cleared; a failure transitions
 * the runtime to `degraded` rather than dropping evidence.
 */
export interface TrackingRecordSink {
	appendSessions(records: readonly ClosedSessionSegment[]): Promise<void>;
	appendRecoveryDecision(decision: RecoveryDecision): Promise<void>;
	appendTypedInputs(records: readonly TypedInputRecord[]): Promise<void>;
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
	readonly typedInputs: TypedInputRecord[] = [];
	private readonly failures: ReadonlyArray<keyof TrackingRecordSink> | null;
	private calls = 0;

	constructor(opts: { failAppendSessionsAfter?: number; failAppendTypedInputsAfter?: number } = {}) {
		this.failures =
			opts.failAppendSessionsAfter !== undefined || opts.failAppendTypedInputsAfter !== undefined
				? ([
					...(opts.failAppendSessionsAfter !== undefined ? ['appendSessions'] : []),
					...(opts.failAppendTypedInputsAfter !== undefined ? ['appendTypedInputs'] : []),
				] as Array<keyof TrackingRecordSink>)
				: null;
		this.failThreshold = opts.failAppendSessionsAfter ?? Infinity;
		this.typedFailThreshold = opts.failAppendTypedInputsAfter ?? Infinity;
	}
	private failThreshold: number;
	private typedFailThreshold: number;
	private typedCalls = 0;

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

	async appendTypedInputs(records: readonly TypedInputRecord[]): Promise<void> {
		if (this.failures?.includes('appendTypedInputs') && this.typedCalls >= this.typedFailThreshold) {
			throw new Error('injected appendTypedInputs failure');
		}
		this.typedCalls += 1;
		this.typedInputs.push(...records);
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
