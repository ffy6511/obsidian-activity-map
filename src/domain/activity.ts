/**
 * Pure domain contracts for activity tracking.
 *
 * This module owns the trusted shapes the runtime produces and consumes. It
 * imports nothing from Obsidian, Electron, Node, or the DOM. Persistence-only
 * fields (schemaVersion, recordId, deviceId) are layered on by Spec 02's
 * {@link EventEnvelope}; the types here describe what the runtime itself emits.
 */

/**
 * Identifies the file that owns an in-flight or closed session.
 *
 * `fileId` is the stable internal identity. `path` is the event-time path at
 * the moment the target was resolved and is retained verbatim on closed
 * evidence; rename handling lives in the registry, not here.
 */
export interface TrackingTarget {
	fileId: string;
	path: string;
	/** Owner {@link Window} of the leaf, never assumed to be the global window. */
	windowId: string;
	leafId: string;
}

/**
 * Why a session closed. The reason is part of durable evidence and drives
 * recovery-decision eligibility, so it must be distinguishable, not implicit.
 */
export type SessionClosureReason =
	| 'file-switch'
	| 'blur'
	| 'idle'
	| 'sleep'
	| 'pause'
	| 'shutdown'
	| 'untrackable'
	| 'degraded';

/**
 * An immutable, persisted-as-evidence session fragment.
 *
 * Local-midnight splitting keeps total metrics exact: only the first segment of
 * a split carries {@link openCount}. The runtime emits one or more segments per
 * closed session; downstream persistence treats each as its own record.
 */
export interface ClosedSessionSegment {
	sessionId: string;
	target: TrackingTarget;
	startedAt: string;
	endedAt: string;
	localDate: string;
	activeMs: number;
	editingMs: number;
	openCount: 0 | 1;
	closureReason: SessionClosureReason;
}

/** Numeric evidence of one committed human text-input action. */
export interface TypedInputRecord {
	/** Process-unique key retained so an uncertain append can be retried safely. */
	recordId: string;
	fileId: string;
	pathAtEvent: string;
	occurredAt: string;
	localDate: string;
	typedChars: number;
	/** Semantic browser source; never carries the committed string. */
	source: 'insert-text' | 'ime-commit';
}

/**
 * A short, uncertain idle interval the user may explicitly re-include.
 *
 * Created only for ordinary gaps at or below the recovery limit. Longer,
 * locked, or sleeping gaps become automatic exclusions (see {@link RecoveryDecision}).
 */
export interface RecoveryCandidate {
	candidateId: string;
	fileId: string;
	pathAtEvent: string;
	startedAt: string;
	endedAt: string;
	gapMs: number;
	defaultDecision: 'exclude';
}

/** What a recovery decision does to metrics. Excludes record a zero delta so the decision is auditable. */
export type RecoveryDecisionKind = 'include' | 'exclude';

/**
 * An explicit, auditable recovery decision. Includes are positive deltas;
 * excludes carry a zero delta so recent decisions can be shown without erasing
 * the original session evidence.
 */
export interface RecoveryDecision {
	candidateId: string;
	/** Source identity is retained so the adjustment never becomes unattributed. */
	fileId: string;
	pathAtEvent: string;
	intervalStartedAt: string;
	kind: RecoveryDecisionKind;
	deltaMs: number;
	reason: string;
	decidedAt: string;
	/**
	 * True for gaps that the runtime auto-excluded (sleep/lock or > recovery
	 * limit). Auto exclusions expose a short undo window that returns the
	 * interval to the pending queue; they never include time by themselves.
	 */
	automatic: boolean;
}

/** Lifecycle states of the tracking runtime. See ARCHITECTURE.md Tracking Runtime. */
export type RuntimeStateName =
	| 'stopped'
	| 'untrackable'
	| 'active'
	| 'idle'
	| 'paused'
	| 'degraded';

/** Why a snapshot was published. UI surfaces map these to status text and icons. */
export type SnapshotReason =
	| 'start'
	| 'active'
	| 'idle'
	| 'pending-recovery'
	| 'paused'
	| 'untrackable'
	| 'degraded'
	| 'recovery-resolved'
	| 'shutdown';

/**
 * The immutable view the runtime publishes after each externally visible
 * transition. UI observers receive this; they never read engine internals.
 */
export interface TrackingSnapshot {
	state: RuntimeStateName;
	reason: SnapshotReason;
	currentTarget: TrackingTarget | null;
	/** Session start of the in-flight session, when state is active. */
	sessionStartedAt: string | null;
	/** Wall time of the last trusted activity signal across all targets. */
	lastTrustedActivityAt: string | null;
	pendingRecovery: readonly RecoveryCandidate[];
	recentDecisions: readonly RecoveryDecision[];
	/** Present only when the runtime cannot guarantee evidence persistence. */
	degradedReason: string | null;
	sampledAt: string;
}

/**
 * A recoverable in-flight runtime snapshot. Loaded once on startup and passed
 * through the same transition rules as live tracking; quarantined when invalid.
 */
export interface RuntimeCheckpoint {
	schemaVersion: 1;
	state: RuntimeStateName;
	currentTarget: TrackingTarget | null;
	sessionStartedAt: string | null;
	lastTrustedActivityAt: string | null;
	editBurst: EditingBurstCheckpoint | null;
	pendingRecovery: RecoveryCandidate[];
	recentDecisions: RecoveryDecision[];
	savedAt: string;
}

/** Minimal editing-burst recovery shape; the engine owns the live burst model. */
export interface EditingBurstCheckpoint {
	fileId: string;
	lastEditAt: string;
	silenceMs: number;
	/** Duration of fully closed bursts before the currently open burst. */
	completedMs?: number;
	/** Start of the currently open burst; absent in older schema-1 checkpoints. */
	openSince?: string | null;
}
