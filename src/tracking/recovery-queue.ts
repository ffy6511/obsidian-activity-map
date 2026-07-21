/**
 * Recovery-decision queue.
 *
 * Idle exclusion never blocks a resumed session. An eligible uncertain interval
 * becomes a pending {@link RecoveryCandidate}; the user includes or excludes it
 * later as an explicit, auditable {@link RecoveryDecision}.
 *
 * Rules (Constitution "Attribution and session semantics" + PRD "空闲恢复"):
 * - Gaps at or below `recoveryLimitMs` caused by ordinary inactivity stay
 *   pending until resolved.
 * - Longer gaps, and detected lock/sleep gaps, are auto-excluded with a short
 *   undo deadline. Undo returns the interval to the pending queue; it never
 *   includes time without a second explicit decision.
 * - Each candidate has a stable ID; resolving one cannot mutate another.
 * - A decision submitted twice (same candidateId) is idempotent.
 */

import type { RecoveryCandidate, RecoveryDecision } from '../domain/activity';

/** Default undo window for an automatic exclusion (PRD: "短暂撤销入口"). */
export const AUTO_EXCLUSION_UNDO_MS = 10_000;

/** Maximum number of recent decisions retained for UI display. */
const MAX_RECENT_DECISIONS = 50;

/** A pending candidate plus its undo metadata when it was auto-excluded. */
export interface PendingCandidate {
	candidate: RecoveryCandidate;
	/** When non-null, this candidate was auto-excluded and can be undone until this deadline. */
	autoExclusion: { undoDeadlineMs: number; decidedAt: string } | null;
	/** True once a decision (include/exclude/undo) has resolved it. */
	resolved: boolean;
}

/**
 * Creates and tracks recovery candidates and decisions. Pure with respect to
 * the clock: all timestamps are passed in so tests stay deterministic.
 */
export class RecoveryQueue {
	private readonly pending = new Map<string, PendingCandidate>();
	private readonly recentDecisions: RecoveryDecision[] = [];

	constructor(private recoveryLimitMs: number) {}

	/** Update the recovery limit when settings change. */
	setRecoveryLimit(recoveryLimitMs: number): void {
		this.recoveryLimitMs = recoveryLimitMs;
	}

	/**
	 * Create a candidate for an uncertain ordinary gap if it is eligible
	 * (within the recovery limit and not a detected sleep gap). Returns the
	 * candidate, or null if the gap should be auto-excluded without surfacing
	 * a pending decision.
	 */
	createOrdinaryCandidate(args: {
		candidateId: string;
		fileId: string;
		pathAtEvent: string;
		startedAt: string;
		endedAt: string;
		gapMs: number;
	}): RecoveryCandidate | null {
		if (args.gapMs > this.recoveryLimitMs) {
			return null;
		}
		const candidate: RecoveryCandidate = {
			candidateId: args.candidateId,
			fileId: args.fileId,
			pathAtEvent: args.pathAtEvent,
			startedAt: args.startedAt,
			endedAt: args.endedAt,
			gapMs: args.gapMs,
			defaultDecision: 'exclude',
		};
		this.pending.set(args.candidateId, {
			candidate,
			autoExclusion: null,
			resolved: false,
		});
		return candidate;
	}

	/**
	 * Record an automatic exclusion (sleep/lock or gap > recovery limit). The
	 * interval becomes undoable until `undoDeadlineMs`. Returns the decision
	 * recorded, plus a synthetic candidate so the UI can show the excluded
	 * interval and offer undo. Returns null if `gapMs` is below the auto-exclude
	 * threshold (caller should use createOrdinaryCandidate instead).
	 */
	recordAutomaticExclusion(args: {
		candidateId: string;
		fileId: string;
		pathAtEvent: string;
		startedAt: string;
		endedAt: string;
		gapMs: number;
		decidedAt: string;
		undoDeadlineMs: number;
	}): { candidate: RecoveryCandidate; decision: RecoveryDecision } | null {
		if (args.gapMs <= this.recoveryLimitMs) {
			return null;
		}
		const candidate: RecoveryCandidate = {
			candidateId: args.candidateId,
			fileId: args.fileId,
			pathAtEvent: args.pathAtEvent,
			startedAt: args.startedAt,
			endedAt: args.endedAt,
			gapMs: args.gapMs,
			defaultDecision: 'exclude',
		};
		this.pending.set(args.candidateId, {
			candidate,
			autoExclusion: { undoDeadlineMs: args.undoDeadlineMs, decidedAt: args.decidedAt },
			resolved: true,
		});
		const decision: RecoveryDecision = {
			candidateId: args.candidateId,
			kind: 'exclude',
			deltaMs: 0,
			reason: 'auto-exclude-long-or-sleep',
			decidedAt: args.decidedAt,
			automatic: true,
		};
		this.pushDecision(decision);
		return { candidate, decision };
	}

	/**
	 * User includes a pending candidate. Returns the positive-delta decision,
	 * or null if the candidate is unknown or already resolved. Idempotent on a
	 * resolved candidate: returns the prior decision without recording again.
	 */
	include(args: {
		candidateId: string;
		decidedAt: string;
	}): RecoveryDecision | null {
		return this.decide(args.candidateId, 'include', args.decidedAt);
	}

	/** User excludes a pending candidate. Same idempotency as include. */
	exclude(args: {
		candidateId: string;
		decidedAt: string;
	}): RecoveryDecision | null {
		return this.decide(args.candidateId, 'exclude', args.decidedAt);
	}

	/**
	 * Undo an automatic exclusion before its deadline. Moves the interval back
	 * to the pending queue without including it. Returns true if undone, false
	 * if unknown, already resolved by the user, or past the deadline.
	 */
	undoAutomaticExclusion(args: {
		candidateId: string;
		nowMs: number;
	}): boolean {
		const entry = this.pending.get(args.candidateId);
		if (!entry || !entry.autoExclusion) {
			return false;
		}
		if (args.nowMs > entry.autoExclusion.undoDeadlineMs) {
			return false;
		}
		// Return to pending: clear the auto-exclusion marker and resolution.
		entry.autoExclusion = null;
		entry.resolved = false;
		return true;
	}

	/** Pending (unresolved, non-auto-excluded) candidates for UI display. */
	pendingCandidates(): readonly RecoveryCandidate[] {
		const out: RecoveryCandidate[] = [];
		for (const entry of this.pending.values()) {
			if (!entry.resolved && !entry.autoExclusion) {
				out.push(entry.candidate);
			}
		}
		return out;
	}

	/** Undoable automatic exclusions (still within their deadline). */
	undoableExclusions(args: { nowMs: number }): readonly {
		candidate: RecoveryCandidate;
		deadlineMs: number;
	}[] {
		const out: { candidate: RecoveryCandidate; deadlineMs: number }[] = [];
		for (const entry of this.pending.values()) {
			if (entry.autoExclusion && args.nowMs <= entry.autoExclusion.undoDeadlineMs) {
				out.push({
					candidate: entry.candidate,
					deadlineMs: entry.autoExclusion.undoDeadlineMs,
				});
			}
		}
		return out;
	}

	recentDecisionsView(): readonly RecoveryDecision[] {
		return [...this.recentDecisions];
	}

	/** All candidates (pending + auto-excluded + resolved), for checkpointing. */
	allCandidates(): readonly PendingCandidate[] {
		return [...this.pending.values()];
	}

	/** Restore the queue from a checkpoint snapshot. */
	restore(pending: readonly PendingCandidate[], decisions: readonly RecoveryDecision[]): void {
		this.pending.clear();
		for (const p of pending) {
			this.pending.set(p.candidate.candidateId, {
				candidate: p.candidate,
				autoExclusion: p.autoExclusion
					? { ...p.autoExclusion }
					: null,
				resolved: p.resolved,
			});
		}
		this.recentDecisions.length = 0;
		for (const d of decisions) {
			this.recentDecisions.push(d);
		}
	}

	private decide(
		candidateId: string,
		kind: 'include' | 'exclude',
		decidedAt: string,
	): RecoveryDecision | null {
		const entry = this.pending.get(candidateId);
		if (!entry) {
			return null;
		}
		if (entry.resolved && !entry.autoExclusion) {
			// Already user-resolved; return the most recent matching decision if any.
			const existing = [...this.recentDecisions]
				.reverse()
				.find((d) => d.candidateId === candidateId && !d.automatic);
			if (existing) {
				return existing;
			}
		}
		const deltaMs = kind === 'include' ? entry.candidate.gapMs : 0;
		const decision: RecoveryDecision = {
			candidateId,
			kind,
			deltaMs,
			reason: kind === 'include' ? 'user-include' : 'user-exclude',
			decidedAt,
			automatic: false,
		};
		entry.resolved = true;
		entry.autoExclusion = null;
		this.pushDecision(decision);
		return decision;
	}

	private pushDecision(decision: RecoveryDecision): void {
		this.recentDecisions.push(decision);
		if (this.recentDecisions.length > MAX_RECENT_DECISIONS) {
			this.recentDecisions.splice(
				0,
				this.recentDecisions.length - MAX_RECENT_DECISIONS,
			);
		}
	}
}
