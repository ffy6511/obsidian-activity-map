import { describe, expect, it } from '../helpers/test-harness';

import { RecoveryQueue, AUTO_EXCLUSION_UNDO_MS } from '../../src/tracking/recovery-queue';

const RECOVERY_LIMIT = 1_800_000; // 30 min

function queue(limit = RECOVERY_LIMIT): RecoveryQueue {
	return new RecoveryQueue(limit);
}

describe('recovery queue ordinary candidates', () => {
	it('creates a pending candidate for gaps under the recovery limit', () => {
		const q = queue();
		const c = q.createOrdinaryCandidate({
			candidateId: 'c1',
			fileId: 'f',
			pathAtEvent: 'p.md',
			startedAt: '2026-01-01T00:00:00.000Z',
			endedAt: '2026-01-01T00:01:00.000Z',
			gapMs: 60_000,
		});
		expect(c).not.toBeNull();
		expect(q.pendingCandidates()).toHaveLength(1);
		expect(q.pendingCandidates()[0]?.candidateId).toBe('c1');
	});

	it('returns null for gaps over the recovery limit (auto-exclude path)', () => {
		const q = queue(60_000);
		const c = q.createOrdinaryCandidate({
			candidateId: 'c1',
			fileId: 'f',
			pathAtEvent: 'p.md',
			startedAt: '2026-01-01T00:00:00.000Z',
			endedAt: '2026-01-01T00:02:00.000Z',
			gapMs: 120_000,
		});
		expect(c).toBeNull();
		expect(q.pendingCandidates()).toHaveLength(0);
	});
});

describe('recovery queue automatic exclusion', () => {
	it('records an automatic exclude decision with an undo window', () => {
		const q = queue(60_000);
		const result = q.recordAutomaticExclusion({
			candidateId: 'c1',
			fileId: 'f',
			pathAtEvent: 'p.md',
			startedAt: '2026-01-01T00:00:00.000Z',
			endedAt: '2026-01-01T00:02:00.000Z',
			gapMs: 120_000,
			decidedAt: '2026-01-01T00:02:00.000Z',
			undoDeadlineMs: Date.parse('2026-01-01T00:02:00.000Z') + AUTO_EXCLUSION_UNDO_MS,
		});
		expect(result).not.toBeNull();
		expect(result?.decision.kind).toBe('exclude');
		expect(result?.decision.automatic).toBeTrue();
		expect(result?.decision.deltaMs).toBe(0);
		// Auto-excluded candidates are not in pendingCandidates (resolved).
		expect(q.pendingCandidates()).toHaveLength(0);
		// But appear as undoable within the deadline.
		expect(
			q.undoableExclusions({ nowMs: Date.parse('2026-01-01T00:02:05.000Z') }),
		).toHaveLength(1);
	});

	it('undo before the deadline returns the interval to pending', () => {
		const q = queue(60_000);
		const ended = Date.parse('2026-01-01T00:02:00.000Z');
		q.recordAutomaticExclusion({
			candidateId: 'c1',
			fileId: 'f',
			pathAtEvent: 'p.md',
			startedAt: '2026-01-01T00:00:00.000Z',
			endedAt: '2026-01-01T00:02:00.000Z',
			gapMs: 120_000,
			decidedAt: '2026-01-01T00:02:00.000Z',
			undoDeadlineMs: ended + AUTO_EXCLUSION_UNDO_MS,
		});
		const undone = q.undoAutomaticExclusion({ candidateId: 'c1', nowMs: ended + 5_000 });
		expect(undone).toBeTrue();
		expect(q.pendingCandidates()).toHaveLength(1);
	});

	it('undo after the deadline fails', () => {
		const q = queue(60_000);
		const ended = Date.parse('2026-01-01T00:02:00.000Z');
		q.recordAutomaticExclusion({
			candidateId: 'c1',
			fileId: 'f',
			pathAtEvent: 'p.md',
			startedAt: '2026-01-01T00:00:00.000Z',
			endedAt: '2026-01-01T00:02:00.000Z',
			gapMs: 120_000,
			decidedAt: '2026-01-01T00:02:00.000Z',
			undoDeadlineMs: ended + AUTO_EXCLUSION_UNDO_MS,
		});
		const undone = q.undoAutomaticExclusion({ candidateId: 'c1', nowMs: ended + 20_000 });
		expect(undone).toBeFalse();
	});

	it('recordAutomaticExclusion returns null for gaps at or below the limit', () => {
		const q = queue(60_000);
		const result = q.recordAutomaticExclusion({
			candidateId: 'c1',
			fileId: 'f',
			pathAtEvent: 'p.md',
			startedAt: '2026-01-01T00:00:00.000Z',
			endedAt: '2026-01-01T00:00:30.000Z',
			gapMs: 30_000,
			decidedAt: '2026-01-01T00:00:30.000Z',
			undoDeadlineMs: 0,
		});
		expect(result).toBeNull();
	});
});

describe('recovery queue user decisions', () => {
	it('include emits a positive delta equal to the gap', () => {
		const q = queue();
		q.createOrdinaryCandidate({
			candidateId: 'c1',
			fileId: 'f',
			pathAtEvent: 'p.md',
			startedAt: '2026-01-01T00:00:00.000Z',
			endedAt: '2026-01-01T00:01:00.000Z',
			gapMs: 60_000,
		});
		const d = q.include({ candidateId: 'c1', decidedAt: '2026-01-01T00:02:00.000Z' });
		expect(d?.kind).toBe('include');
		expect(d?.deltaMs).toBe(60_000);
		expect(d?.automatic).toBeFalse();
	});

	it('exclude emits a zero-delta auditable decision', () => {
		const q = queue();
		q.createOrdinaryCandidate({
			candidateId: 'c1',
			fileId: 'f',
			pathAtEvent: 'p.md',
			startedAt: '2026-01-01T00:00:00.000Z',
			endedAt: '2026-01-01T00:01:00.000Z',
			gapMs: 60_000,
		});
		const d = q.exclude({ candidateId: 'c1', decidedAt: '2026-01-01T00:02:00.000Z' });
		expect(d?.kind).toBe('exclude');
		expect(d?.deltaMs).toBe(0);
	});

	it('a decision on an unknown candidate returns null', () => {
		const q = queue();
		const d = q.include({ candidateId: 'nope', decidedAt: 'x' });
		expect(d).toBeNull();
	});

	it('resolving one candidate does not mutate another', () => {
		const q = queue();
		q.createOrdinaryCandidate({
			candidateId: 'c1',
			fileId: 'f',
			pathAtEvent: 'a.md',
			startedAt: 's',
			endedAt: 'e',
			gapMs: 10_000,
		});
		q.createOrdinaryCandidate({
			candidateId: 'c2',
			fileId: 'f',
			pathAtEvent: 'b.md',
			startedAt: 's',
			endedAt: 'e',
			gapMs: 20_000,
		});
		q.include({ candidateId: 'c1', decidedAt: 'now' });
		expect(q.pendingCandidates()).toHaveLength(1);
		expect(q.pendingCandidates()[0]?.candidateId).toBe('c2');
	});

	it('a second decision on the same candidate is idempotent at the queue level', () => {
		const q = queue();
		q.createOrdinaryCandidate({
			candidateId: 'c1',
			fileId: 'f',
			pathAtEvent: 'a.md',
			startedAt: 's',
			endedAt: 'e',
			gapMs: 10_000,
		});
		const first = q.include({ candidateId: 'c1', decidedAt: 't1' });
		const second = q.include({ candidateId: 'c1', decidedAt: 't2' });
		expect(first).toEqual(second);
		expect(q.recentDecisionsView().filter((d) => d.candidateId === 'c1')).toHaveLength(1);
	});
});

describe('recovery queue restore', () => {
	it('restore reconstructs pending and recent decisions', () => {
		const q = queue();
		q.createOrdinaryCandidate({
			candidateId: 'c1',
			fileId: 'f',
			pathAtEvent: 'a.md',
			startedAt: 's',
			endedAt: 'e',
			gapMs: 10_000,
		});
		q.include({ candidateId: 'c1', decidedAt: 'now' });
		const pending = q.allCandidates();
		const decisions = q.recentDecisionsView();
		const q2 = queue();
		q2.restore(pending, decisions);
		expect(q2.recentDecisionsView()).toHaveLength(1);
	});
});
