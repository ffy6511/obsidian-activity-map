/**
 * Pure activity-tracking state machine.
 *
 * The engine converts a sequence of {@link EngineInput}s into closed domain
 * records ({@link ClosedSessionSegment}) and immutable {@link TrackingSnapshot}s.
 * It owns time semantics only: clock samples, ports, and observers are injected.
 *
 * Invariants enforced here (and tested in tests/tracking/activity-engine.test.ts):
 * - At most one target receives activeMs at any instant.
 * - Idle confirmation closes at lastTrustedActivity, never at the timer callback.
 * - A file switch closes the old target and opens the new one at one sample.
 * - editingMs is clamped to [0, activeMs].
 * - openCount is 1 only on the first segment of a session that started from a
 *   switch/untrackable; 0 on application-refocus of the same file.
 * - Closed intervals split at local midnight after their final endpoint is known.
 */

import type {
	ClosedSessionSegment,
	RecoveryCandidate,
	RecoveryDecision,
	RuntimeCheckpoint,
	RuntimeStateName,
	SessionClosureReason,
	SnapshotReason,
	TrackingSnapshot,
	TrackingTarget,
} from '../domain/activity';
import type { ActivityMapSettings } from '../domain/settings';
import {
	localDateFor,
	monotonicDelta,
	splitAtLocalMidnight,
	toIso,
	type ClockSample,
} from '../platform/clock';
import { EditingBurst, unionLengthMs, type BurstInterval } from './editing-burst';
import {
	RecoveryQueue,
	AUTO_EXCLUSION_UNDO_MS,
	type PendingCandidate,
} from './recovery-queue';

/**
 * Inputs the coordinator normalizes from Obsidian/DOM events. Each carries one
 * immutable clock sample so a transition never samples the clock twice.
 */
export type EngineInput =
	| { kind: 'start'; sample: ClockSample }
	| { kind: 'stop'; sample: ClockSample }
	| { kind: 'focus-target'; sample: ClockSample; target: TrackingTarget }
	| { kind: 'blur'; sample: ClockSample }
	| { kind: 'untrackable'; sample: ClockSample; reason?: string }
	| { kind: 'activity'; sample: ClockSample }
	| { kind: 'edit'; sample: ClockSample }
	| { kind: 'idle-confirm'; sample: ClockSample }
	| { kind: 'heartbeat'; sample: ClockSample; expectedGapMs: number }
	| { kind: 'pause'; sample: ClockSample; reason?: string }
	| { kind: 'resume'; sample: ClockSample }
	| { kind: 'settings'; sample: ClockSample; settings: ActivityMapSettings };

/** Emitted records pending persistence; the engine caller flushes these to the sink. */
export interface EngineEmissions {
	segments: ClosedSessionSegment[];
	decisions: RecoveryDecision[];
}

export interface EngineCallbacks {
	onEmit: (emissions: EngineEmissions) => void;
	onSnapshot: (snapshot: TrackingSnapshot) => void;
	onCheckpoint: (checkpoint: RuntimeCheckpoint) => void;
}

interface OpenSession {
	target: TrackingTarget;
	startedSample: ClockSample;
	startedAtMs: number;
	lastTrustedActivityMs: number;
	lastTrustedActivitySample: ClockSample;
	editBurst: EditingBurst;
	openCount: 0 | 1;
}

/**
 * The activity engine. Construct with callbacks and call {@link submit} for
 * each normalized input. All public methods are synchronous and pure with
 * respect to the injected clock samples.
 */
export class ActivityEngine {
	private state: RuntimeStateName = 'stopped';
	private stateReason: SnapshotReason = 'start';
	private open: OpenSession | null = null;
	private lastTarget: TrackingTarget | null = null;
	private degradedReason: string | null = null;
	private settings: ActivityMapSettings;
	private readonly recovery: RecoveryQueue;
	private readonly callbacks: EngineCallbacks;
	/** Whether the most-recent transition was an app-blur (affects refocus openCount). */
	private blurred = false;
	private stopped = false;

	constructor(settings: ActivityMapSettings, callbacks: EngineCallbacks) {
		this.settings = settings;
		this.callbacks = callbacks;
		this.recovery = new RecoveryQueue(settings.recoveryLimitMs);
	}

	/** Current runtime state name. */
	getState(): RuntimeStateName {
		return this.state;
	}

	/** Apply one input. Synchronous; emits segments/snapshots/checkpoint via callbacks. */
	submit(input: EngineInput): void {
		switch (input.kind) {
			case 'start':
				this.handleStart(input.sample);
				break;
			case 'stop':
				this.handleStop(input.sample);
				break;
			case 'focus-target':
				this.handleFocusTarget(input.sample, input.target);
				break;
			case 'blur':
				this.handleBlur(input.sample);
				break;
			case 'untrackable':
				this.handleUntrackable(input.sample, input.reason);
				break;
			case 'activity':
				this.handleActivity(input.sample);
				break;
			case 'edit':
				this.handleEdit(input.sample);
				break;
			case 'idle-confirm':
				this.handleIdleConfirm(input.sample);
				break;
			case 'heartbeat':
				this.handleHeartbeat(input.sample, input.expectedGapMs);
				break;
			case 'pause':
				this.handlePause(input.sample, input.reason);
				break;
			case 'resume':
				this.handleResume(input.sample);
				break;
			case 'settings':
				this.handleSettings(input.sample, input.settings);
				break;
		}
		this.publishSnapshot(input.sample);
	}

	// --- input handlers -------------------------------------------------

	private handleStart(sample: ClockSample): void {
		if (this.stopped) {
			return;
		}
		if (this.settings.manuallyPaused) {
			this.enterState('paused', 'start', sample);
			return;
		}
		if (!this.settings.trackingEnabled) {
			this.enterState('paused', 'start', sample);
			return;
		}
		// No target known yet at start; remain untrackable until focus arrives.
		this.enterState('untrackable', 'start', sample);
	}

	private handleStop(sample: ClockSample): void {
		this.stopped = true;
		if (this.open) {
			this.closeOpen(sample, 'shutdown');
		}
		this.state = 'stopped';
		this.stateReason = 'shutdown';
		this.flushCheckpoint(sample);
	}

	private handleFocusTarget(sample: ClockSample, target: TrackingTarget): void {
		if (this.stopped || !this.canTrack()) {
			return;
		}
		// Reject impossible clock deltas: a sample before the open session's
		// start cannot extend it and is treated as a no-op to protect metrics.
		if (this.open && sample.monotonicMs < this.open.lastTrustedActivitySample.monotonicMs) {
			return;
		}
		const sameFile =
			this.open !== null && this.open.target.fileId === target.fileId;
		if (this.open === null) {
			// Opening from untrackable/idle/resume. openCount is 1 unless this is
			// an app-refocus of the same file we last tracked (blur -> refocus).
			const isRefocus = this.blurred && sameFileAfterBlur(this.lastTarget, target);
			this.openSession(sample, target, isRefocus ? 0 : 1);
			this.blurred = false;
			return;
		}
		if (sameFile) {
			// Refresh trusted activity on the same target; no new session, no openCount bump.
			this.refreshActivity(sample);
			this.blurred = false;
			return;
		}
		// File switch: close old at this sample, open new at this sample, no overlap.
		this.closeOpen(sample, 'file-switch');
		this.openSession(sample, target, 1);
	}

	private handleBlur(sample: ClockSample): void {
		if (this.stopped || !this.open) {
			return;
		}
		// Close at the blur sample when idle has not already been confirmed.
		this.closeOpen(sample, 'blur');
		this.blurred = true;
		this.enterState('untrackable', 'untrackable', sample);
	}

	private handleUntrackable(sample: ClockSample, _reason?: string): void {
		if (this.stopped) {
			return;
		}
		if (this.open) {
			this.closeOpen(sample, 'untrackable');
		}
		this.enterState('untrackable', 'untrackable', sample);
	}

	private handleActivity(sample: ClockSample): void {
		if (this.stopped || !this.canTrack()) {
			return;
		}
		if (this.open) {
			this.refreshActivity(sample);
		}
		// Activity without a target does not open a session; a focus-target is required.
	}

	private handleEdit(sample: ClockSample): void {
		if (this.stopped || !this.open) {
			return;
		}
		// editor-change only counts when its file matches the active target.
		const editMs = sample.wallMs;
		this.open.editBurst.recordEdit(editMs);
		this.refreshActivity(sample);
	}

	private handleIdleConfirm(sample: ClockSample): void {
		if (this.stopped || !this.open) {
			return;
		}
		// Close at the last trusted activity sample, not at the timer callback.
		// The trailing uncertain interval becomes a recovery candidate.
		const session = this.open;
		const gapMs = monotonicDelta(session.lastTrustedActivitySample, sample);
		this.closeOpenAt(session.lastTrustedActivitySample, 'idle');
		this.maybeCreateRecoveryCandidate(session, session.lastTrustedActivitySample, sample);
		void gapMs;
		this.enterState('idle', 'idle', session.lastTrustedActivitySample);
	}

	private handleHeartbeat(sample: ClockSample, expectedGapMs: number): void {
		if (this.stopped || !this.open) {
			return;
		}
		// A heartbeat delay consistent with sleep closes at lastTrustedActivity
		// and auto-excludes the gap. expectedGapMs is the scheduler's expected
		// interval; a much larger actual delta implies the machine slept.
		const actualGap = monotonicDelta(this.open.lastTrustedActivitySample, sample);
		if (actualGap > expectedGapMs * 2 && actualGap > this.settings.idleThresholdMs) {
			const session = this.open;
			this.closeOpenAt(session.lastTrustedActivitySample, 'sleep');
			this.autoExcludeGap(session, session.lastTrustedActivitySample, sample);
			this.enterState('idle', 'idle', session.lastTrustedActivitySample);
		}
	}

	private handlePause(sample: ClockSample, _reason?: string): void {
		if (this.stopped) {
			return;
		}
		if (this.open) {
			this.closeOpen(sample, 'pause');
		}
		this.settings = { ...this.settings, manuallyPaused: true };
		this.enterState('paused', 'paused', sample);
	}

	private handleResume(sample: ClockSample): void {
		if (this.stopped) {
			return;
		}
		this.settings = { ...this.settings, manuallyPaused: false };
		// Resume does not open a session by itself; the next focus-target does.
		this.enterState('untrackable', 'start', sample);
	}

	private handleSettings(sample: ClockSample, settings: ActivityMapSettings): void {
		this.settings = settings;
		this.recovery.setRecoveryLimit(settings.recoveryLimitMs);
	}

	// --- session lifecycle ---------------------------------------------

	private canTrack(): boolean {
		return this.settings.trackingEnabled && !this.settings.manuallyPaused;
	}

	private openSession(sample: ClockSample, target: TrackingTarget, openCount: 0 | 1): void {
		this.open = {
			target,
			startedSample: sample,
			startedAtMs: sample.wallMs,
			lastTrustedActivityMs: sample.wallMs,
			lastTrustedActivitySample: sample,
			editBurst: new EditingBurst(this.settings.editSilenceMs),
			openCount,
		};
		this.lastTarget = target;
		this.enterState('active', 'active', sample);
	}

	private refreshActivity(sample: ClockSample): void {
		if (!this.open) {
			return;
		}
		// Guard against monotonic regressions from clock skew.
		if (sample.monotonicMs < this.open.lastTrustedActivitySample.monotonicMs) {
			return;
		}
		this.open.lastTrustedActivityMs = sample.wallMs;
		this.open.lastTrustedActivitySample = sample;
	}

	private closeOpen(closeSample: ClockSample, reason: SessionClosureReason): void {
		if (!this.open) {
			return;
		}
		this.closeOpenAt(closeSample, reason);
	}

	/**
	 * Close the open session at `closeSample`. activeMs is the monotonic delta
	 * from session start to close; idle rollback passes lastTrustedActivity so
	 * the uncertain trailing interval is excluded. Editing bursts are clipped
	 * to the session window and their union clamps to [0, activeMs].
	 */
	private closeOpenAt(closeSample: ClockSample, reason: SessionClosureReason): void {
		const session = this.open;
		if (!session) {
			return;
		}
		const activeMs = Math.max(
			0,
			Math.round(
				monotonicDelta(session.startedSample, closeSample),
			),
		);
		// Close any open edit burst with a hard clip at the close instant.
		session.editBurst.closeHard(closeSample.wallMs);
		const burstIntervals = session.editBurst.snapshotIntervals();
		const clipped = clipBurstsToSession(burstIntervals, session.startedAtMs, closeSample.wallMs);
		let editingMs = unionLengthMs(clipped);
		if (!Number.isFinite(editingMs) || editingMs < 0) {
			editingMs = 0;
		}
		// editingMs must never exceed activeMs (Constitution invariant).
		editingMs = Math.min(editingMs, activeMs);
		// Zero-duration sessions are not emitted unless they carry openCount.
		if (activeMs === 0 && session.openCount === 0) {
			this.open = null;
			return;
		}
		const segments = this.splitAndEmit(session, closeSample, activeMs, editingMs, reason);
		this.open = null;
		void segments;
	}

	private splitAndEmit(
		session: OpenSession,
		closeSample: ClockSample,
		activeMs: number,
		editingMs: number,
		reason: SessionClosureReason,
	): ClosedSessionSegment[] {
		const tz = closeSample.timeZone;
		const partitions = splitAtLocalMidnight({
			startedAtMs: session.startedAtMs,
			endedAtMs: closeSample.wallMs,
			activeMs,
			editingMs,
			timeZone: tz,
		});
		const segments: ClosedSessionSegment[] = partitions.map((p, index) => ({
			sessionId: `${session.target.fileId}-${session.startedAtMs}`,
			target: session.target,
			startedAt: toIso(p.startedAtMs),
			endedAt: toIso(p.endedAtMs),
			localDate: p.localDate,
			activeMs: p.activeMs,
			editingMs: p.editingMs,
			// Only the first segment retains openCount across a midnight split.
			openCount: index === 0 ? session.openCount : 0,
			closureReason: reason,
		}));
		this.callbacks.onEmit({ segments, decisions: [] });
		return segments;
	}

	// --- recovery ------------------------------------------------------

	private maybeCreateRecoveryCandidate(
		session: OpenSession,
		lastTrusted: ClockSample,
		resumeSample: ClockSample,
	): void {
		const gapMs = Math.max(0, monotonicDelta(lastTrusted, resumeSample));
		if (gapMs <= 0) {
			return;
		}
		if (gapMs <= this.settings.recoveryLimitMs) {
			this.recovery.createOrdinaryCandidate({
				candidateId: `${session.target.fileId}-${lastTrusted.wallMs}`,
				fileId: session.target.fileId,
				pathAtEvent: session.target.path,
				startedAt: toIso(lastTrusted.wallMs),
				endedAt: toIso(resumeSample.wallMs),
				gapMs,
			});
		}
		// Longer gaps from ordinary idle-confirm are NOT auto-excluded here:
		// they exceed the recovery limit but were not detected as sleep, so the
		// PRD rule "intervals over 30 min auto-exclude" applies. We surface them
		// via auto-exclusion with an undo window.
		if (gapMs > this.settings.recoveryLimitMs) {
			this.autoExcludeGap(session, lastTrusted, resumeSample);
		}
	}

	private autoExcludeGap(
		session: OpenSession,
		lastTrusted: ClockSample,
		resumeSample: ClockSample,
	): void {
		const gapMs = Math.max(0, monotonicDelta(lastTrusted, resumeSample));
		const result = this.recovery.recordAutomaticExclusion({
			candidateId: `${session.target.fileId}-${lastTrusted.wallMs}`,
			fileId: session.target.fileId,
			pathAtEvent: session.target.path,
			startedAt: toIso(lastTrusted.wallMs),
			endedAt: toIso(resumeSample.wallMs),
			gapMs,
			decidedAt: toIso(resumeSample.wallMs),
			undoDeadlineMs: resumeSample.wallMs + AUTO_EXCLUSION_UNDO_MS,
		});
		if (result) {
			this.callbacks.onEmit({ segments: [], decisions: [result.decision] });
		}
	}

	/** Resolve a recovery candidate. Called by the coordinator (user intent). */
	resolveRecovery(args: {
		candidateId: string;
		kind: 'include' | 'exclude';
		decidedAt: string;
	}): RecoveryDecision | null {
		// Idempotency: if the candidate is already resolved, return its prior
		// decision without re-emitting, so duplicate UI clicks cannot duplicate
		// the adjustment evidence.
		const alreadyDecided = this.recovery.recentDecisionsView().find(
			(d) => d.candidateId === args.candidateId && !d.automatic,
		);
		if (alreadyDecided) {
			return alreadyDecided;
		}
		const decision =
			args.kind === 'include'
				? this.recovery.include(args)
				: this.recovery.exclude(args);
		if (decision) {
			this.callbacks.onEmit({ segments: [], decisions: [decision] });
		}
		return decision;
	}

	/** Undo an automatic exclusion before its deadline. */
	undoAutomaticExclusion(candidateId: string, nowMs: number): boolean {
		return this.recovery.undoAutomaticExclusion({ candidateId, nowMs });
	}

	// --- snapshots and checkpoint -------------------------------------

	private enterState(state: RuntimeStateName, reason: SnapshotReason, sample: ClockSample): void {
		this.state = state;
		this.stateReason = reason;
		// Entering a new top-level state is a checkpoint-worthy transition.
		this.flushCheckpoint(sample);
	}

	private publishSnapshot(sample: ClockSample): void {
		const snapshot: TrackingSnapshot = {
			state: this.state,
			reason: this.stateReason,
			currentTarget: this.open?.target ?? null,
			sessionStartedAt: this.open ? toIso(this.open.startedAtMs) : null,
			lastTrustedActivityAt: this.open
				? toIso(this.open.lastTrustedActivityMs)
				: null,
			pendingRecovery: this.recovery.pendingCandidates(),
			recentDecisions: this.recovery.recentDecisionsView(),
			degradedReason: this.degradedReason,
			sampledAt: toIso(sample.wallMs),
		};
		this.callbacks.onSnapshot(snapshot);
	}

	/** Mark the runtime degraded; no new attribution until recovery. */
	enterDegraded(reason: string, sample: ClockSample): void {
		if (this.open) {
			this.closeOpen(sample, 'degraded');
		}
		this.degradedReason = reason;
		this.state = 'degraded';
		this.stateReason = 'degraded';
		this.flushCheckpoint(sample);
		this.publishSnapshot(sample);
	}

	/** Clear degraded after the sink/checkpoint reports recovery. */
	clearDegraded(sample: ClockSample): void {
		this.degradedReason = null;
		if (this.settings.manuallyPaused) {
			this.state = 'paused';
			this.stateReason = 'paused';
		} else {
			this.state = 'untrackable';
			this.stateReason = 'start';
		}
		this.flushCheckpoint(sample);
		this.publishSnapshot(sample);
	}

	private flushCheckpoint(sample: ClockSample): void {
		const checkpoint: RuntimeCheckpoint = {
			schemaVersion: 1,
			state: this.state,
			currentTarget: this.open?.target ?? null,
			sessionStartedAt: this.open ? toIso(this.open.startedAtMs) : null,
			lastTrustedActivityAt: this.open
				? toIso(this.open.lastTrustedActivityMs)
				: null,
			editBurst: this.open
				? {
						fileId: this.open.target.fileId,
						lastEditAt: toIso(this.open.editBurst.lastEditAt() ?? this.open.lastTrustedActivityMs),
						silenceMs: this.settings.editSilenceMs,
					}
				: null,
			pendingRecovery: [...this.recovery.pendingCandidates()],
			recentDecisions: [...this.recovery.recentDecisionsView()],
			savedAt: toIso(sample.wallMs),
		};
		this.callbacks.onCheckpoint(checkpoint);
	}

	/** Restore from a checkpoint. Applies the same rules as live tracking. */
	restore(checkpoint: RuntimeCheckpoint, sample: ClockSample): void {
		if (checkpoint.state === 'active' && checkpoint.currentTarget) {
			const target = checkpoint.currentTarget;
			const startSample: ClockSample = {
				// We cannot reconstruct the original monotonic time; use a
				// zero-relative baseline so subsequent deltas measure from now.
				wallMs: checkpoint.sessionStartedAt
					? Date.parse(checkpoint.sessionStartedAt)
					: sample.wallMs,
				monotonicMs: sample.monotonicMs,
				timeZone: sample.timeZone,
			};
			this.openSession(startSample, target, 0);
		} else {
			this.state = checkpoint.state;
		}
		this.recovery.restore(
			checkpoint.pendingRecovery.map((c) => ({
				candidate: c,
				autoExclusion: null,
				resolved: false,
			})),
			checkpoint.recentDecisions,
		);
	}

	/** Expose pending candidates for snapshot/testing. */
	pendingRecovery(): readonly RecoveryCandidate[] {
		return this.recovery.pendingCandidates();
	}

	pendingForCheckpoint(): readonly PendingCandidate[] {
		return this.recovery.allCandidates();
	}

	/** Expose local date helper for coordinator/test use. */
	localDateFor(wallMs: number, timeZone: string): string {
		return localDateFor(wallMs, timeZone);
	}
}

// --- helpers -----------------------------------------------------------

function sameFileAfterBlur(
	last: TrackingTarget | null,
	current: TrackingTarget,
): boolean {
	return last !== null && last.fileId === current.fileId;
}

function clipBurstsToSession(
	bursts: readonly BurstInterval[],
	sessionStartMs: number,
	sessionEndMs: number,
): BurstInterval[] {
	const out: BurstInterval[] = [];
	for (const b of bursts) {
		const start = Math.max(b.start, sessionStartMs);
		const end = Math.min(b.end, sessionEndMs);
		if (end > start) {
			out.push({ start, end });
		}
	}
	return out;
}
