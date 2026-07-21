import { describe, expect, it } from '../helpers/test-harness';

import type {
	ClosedSessionSegment,
	RecoveryDecision,
	RuntimeCheckpoint,
	TrackingSnapshot,
	TrackingTarget,
} from '../../src/domain/activity';
import { DEFAULT_SETTINGS, normalizeSettings } from '../../src/domain/settings';
import type { ClockSample } from '../../src/platform/clock';
import { ActivityEngine, type EngineCallbacks } from '../../src/tracking/activity-engine';

const TZ = 'UTC';

function baseSettings(overrides: Record<string, unknown> = {}) {
	return normalizeSettings({
		...DEFAULT_SETTINGS,
		deviceId: 'device-1',
		...overrides,
	});
}

function target(fileId: string, path = `notes/${fileId}.md`): TrackingTarget {
	return {
		fileId,
		path,
		windowId: 'win-main',
		leafId: 'leaf-1',
	};
}

function sample(wallMs: number, monotonicMs = wallMs): ClockSample {
	return { wallMs, monotonicMs, timeZone: TZ };
}

interface Harness {
	engine: ActivityEngine;
	sessions: ClosedSessionSegment[];
	decisions: RecoveryDecision[];
	snapshots: TrackingSnapshot[];
	checkpoints: RuntimeCheckpoint[];
}

function createEngine(settings = baseSettings()): Harness {
	const sessions: ClosedSessionSegment[] = [];
	const decisions: RecoveryDecision[] = [];
	const snapshots: TrackingSnapshot[] = [];
	const checkpoints: RuntimeCheckpoint[] = [];
	const callbacks: EngineCallbacks = {
		onEmit: (e) => {
			sessions.push(...e.segments);
			decisions.push(...e.decisions);
		},
		onSnapshot: (s) => snapshots.push(s),
		onCheckpoint: (c) => checkpoints.push(c),
	};
	return { engine: new ActivityEngine(settings, callbacks), sessions, decisions, snapshots, checkpoints };
}

describe('activity engine startup', () => {
	it('starts untrackable and emits a snapshot with no target', () => {
		const h = createEngine();
		h.engine.submit({ kind: 'start', sample: sample(0) });
		expect(h.snapshots.at(-1)?.state).toBe('untrackable');
		expect(h.snapshots.at(-1)?.currentTarget).toBeNull();
	});

	it('starts paused when settings have manuallyPaused true', () => {
		const h = createEngine(baseSettings({ manuallyPaused: true }));
		h.engine.submit({ kind: 'start', sample: sample(0) });
		expect(h.snapshots.at(-1)?.state).toBe('paused');
	});

	it('starts paused when trackingEnabled is false', () => {
		const h = createEngine(baseSettings({ trackingEnabled: false }));
		h.engine.submit({ kind: 'start', sample: sample(0) });
		expect(h.snapshots.at(-1)?.state).toBe('paused');
	});
});

describe('activity engine foreground exclusivity', () => {
	it('opens one session on focus-target and accumulates activeMs', () => {
		const h = createEngine();
		h.engine.submit({ kind: 'start', sample: sample(0) });
		h.engine.submit({ kind: 'focus-target', sample: sample(0), target: target('a') });
		h.engine.submit({ kind: 'activity', sample: sample(5_000) });
		h.engine.submit({ kind: 'blur', sample: sample(10_000) });
		expect(h.sessions).toHaveLength(1);
		expect(h.sessions[0]?.activeMs).toBe(10_000);
		expect(h.sessions[0]?.target.fileId).toBe('a');
		expect(h.sessions[0]?.closureReason).toBe('blur');
	});

	it('does not double-count when focus-target arrives twice for the same file', () => {
		const h = createEngine();
		h.engine.submit({ kind: 'start', sample: sample(0) });
		h.engine.submit({ kind: 'focus-target', sample: sample(0), target: target('a') });
		h.engine.submit({ kind: 'focus-target', sample: sample(2_000), target: target('a') });
		h.engine.submit({ kind: 'blur', sample: sample(10_000) });
		expect(h.sessions).toHaveLength(1);
		expect(h.sessions[0]?.activeMs).toBe(10_000);
		expect(h.sessions[0]?.openCount).toBe(1);
	});

	it('file switch closes the old and opens the new at one sample with no overlap', () => {
		const h = createEngine();
		h.engine.submit({ kind: 'start', sample: sample(0) });
		h.engine.submit({ kind: 'focus-target', sample: sample(0), target: target('a') });
		h.engine.submit({ kind: 'focus-target', sample: sample(10_000), target: target('b') });
		h.engine.submit({ kind: 'blur', sample: sample(20_000) });
		expect(h.sessions).toHaveLength(2);
		expect(h.sessions[0]?.activeMs).toBe(10_000);
		expect(h.sessions[0]?.target.fileId).toBe('a');
		expect(h.sessions[0]?.closureReason).toBe('file-switch');
		expect(h.sessions[1]?.activeMs).toBe(10_000);
		expect(h.sessions[1]?.target.fileId).toBe('b');
		expect(h.sessions[1]?.openCount).toBe(1);
		// Foreground exclusivity: total accumulated time never exceeds elapsed.
		const totalActive = h.sessions.reduce((sum, s) => sum + s.activeMs, 0);
		expect(totalActive).toBe(20_000);
	});
});

describe('activity engine idle clipping', () => {
	it('idle-confirm closes at last trusted activity, not the timer callback', () => {
		const h = createEngine();
		h.engine.submit({ kind: 'start', sample: sample(0) });
		h.engine.submit({ kind: 'focus-target', sample: sample(0), target: target('a') });
		h.engine.submit({ kind: 'activity', sample: sample(5_000) });
		// Simulate idle: timer fires at 200s, but last activity was at 5s.
		h.engine.submit({ kind: 'idle-confirm', sample: sample(200_000) });
		expect(h.sessions).toHaveLength(1);
		expect(h.sessions[0]?.activeMs).toBe(5_000);
		expect(h.sessions[0]?.closureReason).toBe('idle');
	});

	it('creates a pending recovery candidate for an ordinary gap under the limit', () => {
		const h = createEngine(baseSettings({ recoveryLimitMs: 1_800_000 }));
		h.engine.submit({ kind: 'start', sample: sample(0) });
		h.engine.submit({ kind: 'focus-target', sample: sample(0), target: target('a') });
		h.engine.submit({ kind: 'activity', sample: sample(5_000) });
		// 60s gap — within the 30min recovery limit.
		h.engine.submit({ kind: 'idle-confirm', sample: sample(65_000) });
		const pending = h.engine.pendingRecovery();
		expect(pending).toHaveLength(1);
		expect(pending[0]?.gapMs).toBe(60_000);
		expect(pending[0]?.fileId).toBe('a');
	});
});

describe('activity engine automatic exclusion', () => {
	it('auto-excludes gaps over the recovery limit and records an undoable decision', () => {
		const h = createEngine(baseSettings({ recoveryLimitMs: 60_000 }));
		h.engine.submit({ kind: 'start', sample: sample(0) });
		h.engine.submit({ kind: 'focus-target', sample: sample(0), target: target('a') });
		h.engine.submit({ kind: 'activity', sample: sample(5_000) });
		// 120s gap exceeds the 60s limit -> auto-exclude.
		h.engine.submit({ kind: 'idle-confirm', sample: sample(125_000) });
		expect(h.decisions).toHaveLength(1);
		expect(h.decisions[0]?.kind).toBe('exclude');
		expect(h.decisions[0]?.automatic).toBeTrue();
		// A pending candidate remains undoable.
		expect(h.engine.pendingRecovery()).toHaveLength(0);
	});

	it('undo returns the auto-excluded interval to pending and never includes time', () => {
		const h = createEngine(baseSettings({ recoveryLimitMs: 60_000 }));
		h.engine.submit({ kind: 'start', sample: sample(0) });
		h.engine.submit({ kind: 'focus-target', sample: sample(0), target: target('a') });
		h.engine.submit({ kind: 'activity', sample: sample(5_000) });
		h.engine.submit({ kind: 'idle-confirm', sample: sample(125_000) });
		const decision = h.decisions[0];
		expect(decision).toBeDefined();
		const undone = h.engine.undoAutomaticExclusion(
			`${decision?.candidateId ?? ''}`,
			130_000,
		);
		expect(undone).toBeTrue();
		expect(h.engine.pendingRecovery()).toHaveLength(1);
		// No include decision was emitted by undo.
		expect(h.decisions.filter((d) => d.kind === 'include')).toHaveLength(0);
	});

	it('undo fails after the deadline', () => {
		const h = createEngine(baseSettings({ recoveryLimitMs: 60_000 }));
		h.engine.submit({ kind: 'start', sample: sample(0) });
		h.engine.submit({ kind: 'focus-target', sample: sample(0), target: target('a') });
		h.engine.submit({ kind: 'activity', sample: sample(5_000) });
		h.engine.submit({ kind: 'idle-confirm', sample: sample(125_000) });
		const decision = h.decisions[0];
		// 20s later exceeds the 10s undo window.
		const undone = h.engine.undoAutomaticExclusion(
			`${decision?.candidateId ?? ''}`,
			145_000,
		);
		expect(undone).toBeFalse();
	});
});

describe('activity engine recovery decisions', () => {
	it('include emits a positive delta equal to the gap', () => {
		const h = createEngine(baseSettings({ recoveryLimitMs: 1_800_000 }));
		h.engine.submit({ kind: 'start', sample: sample(0) });
		h.engine.submit({ kind: 'focus-target', sample: sample(0), target: target('a') });
		h.engine.submit({ kind: 'activity', sample: sample(5_000) });
		h.engine.submit({ kind: 'idle-confirm', sample: sample(65_000) });
		const pending = h.engine.pendingRecovery();
		const decision = h.engine.resolveRecovery({
			candidateId: pending[0]?.candidateId ?? '',
			kind: 'include',
			decidedAt: '2026-01-01T00:01:05.000Z',
		});
		expect(decision?.kind).toBe('include');
		expect(decision?.deltaMs).toBe(60_000);
	});

	it('exclude emits a zero-delta auditable decision', () => {
		const h = createEngine(baseSettings({ recoveryLimitMs: 1_800_000 }));
		h.engine.submit({ kind: 'start', sample: sample(0) });
		h.engine.submit({ kind: 'focus-target', sample: sample(0), target: target('a') });
		h.engine.submit({ kind: 'activity', sample: sample(5_000) });
		h.engine.submit({ kind: 'idle-confirm', sample: sample(65_000) });
		const pending = h.engine.pendingRecovery();
		const decision = h.engine.resolveRecovery({
			candidateId: pending[0]?.candidateId ?? '',
			kind: 'exclude',
			decidedAt: '2026-01-01T00:01:05.000Z',
		});
		expect(decision?.kind).toBe('exclude');
		expect(decision?.deltaMs).toBe(0);
	});

	it('a duplicate decision on a resolved candidate is idempotent', () => {
		const h = createEngine(baseSettings({ recoveryLimitMs: 1_800_000 }));
		h.engine.submit({ kind: 'start', sample: sample(0) });
		h.engine.submit({ kind: 'focus-target', sample: sample(0), target: target('a') });
		h.engine.submit({ kind: 'activity', sample: sample(5_000) });
		h.engine.submit({ kind: 'idle-confirm', sample: sample(65_000) });
		const id = h.engine.pendingRecovery()[0]?.candidateId ?? '';
		const first = h.engine.resolveRecovery({ candidateId: id, kind: 'include', decidedAt: 'x' });
		const second = h.engine.resolveRecovery({ candidateId: id, kind: 'include', decidedAt: 'y' });
		expect(first).toBeDefined();
		expect(second).toEqual(first);
		// Only one include decision recorded.
		expect(h.decisions.filter((d) => d.kind === 'include')).toHaveLength(1);
	});
});

describe('activity engine editing bursts', () => {
	it('editingMs never exceeds activeMs', () => {
		const h = createEngine();
		h.engine.submit({ kind: 'start', sample: sample(0) });
		h.engine.submit({ kind: 'focus-target', sample: sample(0), target: target('a') });
		// Many edits across the session.
		for (let t = 0; t <= 10_000; t += 1_000) {
			h.engine.submit({ kind: 'edit', sample: sample(t) });
		}
		h.engine.submit({ kind: 'blur', sample: sample(10_000) });
		expect(h.sessions).toHaveLength(1);
		expect(h.sessions[0]?.editingMs).toBeLessThanOrEqual(h.sessions[0]?.activeMs ?? 0);
	});

	it('edits in a background leaf (no open session) do not create a burst', () => {
		const h = createEngine();
		h.engine.submit({ kind: 'start', sample: sample(0) });
		h.engine.submit({ kind: 'edit', sample: sample(1_000) });
		expect(h.sessions).toHaveLength(0);
	});

	it('editingMs is the union of bursts clipped to the session end', () => {
		const h = createEngine(baseSettings({ editSilenceMs: 15_000 }));
		h.engine.submit({ kind: 'start', sample: sample(0) });
		h.engine.submit({ kind: 'focus-target', sample: sample(0), target: target('a') });
		// Edit burst 1: 0-1s, then silence. Burst 2: 30-31s.
		h.engine.submit({ kind: 'edit', sample: sample(0) });
		h.engine.submit({ kind: 'edit', sample: sample(1_000) });
		h.engine.submit({ kind: 'edit', sample: sample(30_000) });
		h.engine.submit({ kind: 'edit', sample: sample(31_000) });
		h.engine.submit({ kind: 'blur', sample: sample(40_000) });
		const seg = h.sessions[0];
		expect(seg).toBeDefined();
		// Burst 1: [0, 1000+15000=16000] = 16s. Burst 2: [30000, 31000+15000=46000] clipped to 40000 = 10s. Total 26s.
		expect(seg?.editingMs).toBe(26_000);
		expect(seg?.editingMs).toBeLessThanOrEqual(seg?.activeMs ?? 0);
	});
});

describe('activity engine pause and resume', () => {
	it('pause closes the session and suppresses new attribution until resume', () => {
		const h = createEngine();
		h.engine.submit({ kind: 'start', sample: sample(0) });
		h.engine.submit({ kind: 'focus-target', sample: sample(0), target: target('a') });
		h.engine.submit({ kind: 'activity', sample: sample(5_000) });
		h.engine.submit({ kind: 'pause', sample: sample(10_000) });
		expect(h.snapshots.at(-1)?.state).toBe('paused');
		expect(h.sessions).toHaveLength(1);
		expect(h.sessions[0]?.closureReason).toBe('pause');
		// While paused, focus-target does not open a session.
		h.engine.submit({ kind: 'focus-target', sample: sample(12_000), target: target('a') });
		expect(h.sessions).toHaveLength(1);
	});

	it('resume returns to untrackable and a subsequent focus opens a fresh session', () => {
		const h = createEngine();
		h.engine.submit({ kind: 'start', sample: sample(0) });
		h.engine.submit({ kind: 'focus-target', sample: sample(0), target: target('a') });
		h.engine.submit({ kind: 'pause', sample: sample(10_000) });
		h.engine.submit({ kind: 'resume', sample: sample(15_000) });
		expect(h.snapshots.at(-1)?.state).toBe('untrackable');
		h.engine.submit({ kind: 'focus-target', sample: sample(15_000), target: target('a') });
		expect(h.snapshots.at(-1)?.state).toBe('active');
		// Close the resumed session so it is emitted; pause already emitted the first.
		h.engine.submit({ kind: 'blur', sample: sample(20_000) });
		expect(h.sessions).toHaveLength(2);
	});
});

describe('activity engine openCount semantics', () => {
	it('openCount is 1 when opening from untrackable or a different file', () => {
		const h = createEngine();
		h.engine.submit({ kind: 'start', sample: sample(0) });
		h.engine.submit({ kind: 'focus-target', sample: sample(0), target: target('a') });
		h.engine.submit({ kind: 'blur', sample: sample(10_000) });
		expect(h.sessions[0]?.openCount).toBe(1);
	});

	it('openCount is 0 on application refocus of the same file after blur', () => {
		const h = createEngine();
		h.engine.submit({ kind: 'start', sample: sample(0) });
		h.engine.submit({ kind: 'focus-target', sample: sample(0), target: target('a') });
		h.engine.submit({ kind: 'blur', sample: sample(10_000) });
		// Refocus the same file: app regained focus, same file -> openCount 0.
		h.engine.submit({ kind: 'focus-target', sample: sample(15_000), target: target('a') });
		h.engine.submit({ kind: 'blur', sample: sample(20_000) });
		expect(h.sessions).toHaveLength(2);
		expect(h.sessions[1]?.openCount).toBe(0);
	});
});

describe('activity engine midnight splitting', () => {
	it('splits a session crossing UTC midnight and only the first keeps openCount', () => {
		const h = createEngine();
		// Use UTC; 23:00 -> 01:00 crosses one midnight.
		const startMs = Date.UTC(2026, 5, 21, 23, 0, 0);
		const focusMs = startMs;
		const endMs = Date.UTC(2026, 5, 22, 1, 0, 0);
		h.engine.submit({ kind: 'start', sample: sample(startMs) });
		h.engine.submit({ kind: 'focus-target', sample: sample(focusMs), target: target('a') });
		h.engine.submit({ kind: 'blur', sample: sample(endMs) });
		expect(h.sessions).toHaveLength(2);
		expect(h.sessions.map((s) => s.localDate)).toEqual(['2026-06-21', '2026-06-22']);
		expect(h.sessions[0]?.openCount).toBe(1);
		expect(h.sessions[1]?.openCount).toBe(0);
		const totalActive = h.sessions.reduce((sum, s) => sum + s.activeMs, 0);
		expect(totalActive).toBe(2 * 3_600_000);
	});
});

describe('activity engine degraded state', () => {
	it('enterDegraded closes the open session and sets degradedReason', () => {
		const h = createEngine();
		h.engine.submit({ kind: 'start', sample: sample(0) });
		h.engine.submit({ kind: 'focus-target', sample: sample(0), target: target('a') });
		h.engine.submit({ kind: 'activity', sample: sample(5_000) });
		h.engine.enterDegraded('sink-failure', sample(10_000));
		expect(h.snapshots.at(-1)?.state).toBe('degraded');
		expect(h.snapshots.at(-1)?.degradedReason).toBe('sink-failure');
		expect(h.sessions[0]?.closureReason).toBe('degraded');
	});

	it('clearDegraded returns to untrackable when not paused', () => {
		const h = createEngine();
		h.engine.submit({ kind: 'start', sample: sample(0) });
		h.engine.enterDegraded('sink-failure', sample(10_000));
		h.engine.clearDegraded(sample(15_000));
		expect(h.snapshots.at(-1)?.state).toBe('untrackable');
		expect(h.snapshots.at(-1)?.degradedReason).toBeNull();
	});
});

describe('activity engine shutdown', () => {
	it('stop closes the open session with shutdown reason and prevents further transitions', () => {
		const h = createEngine();
		h.engine.submit({ kind: 'start', sample: sample(0) });
		h.engine.submit({ kind: 'focus-target', sample: sample(0), target: target('a') });
		h.engine.submit({ kind: 'activity', sample: sample(5_000) });
		h.engine.submit({ kind: 'stop', sample: sample(10_000) });
		expect(h.sessions).toHaveLength(1);
		expect(h.sessions[0]?.closureReason).toBe('shutdown');
		// After stop, a focus-target is ignored.
		h.engine.submit({ kind: 'focus-target', sample: sample(15_000), target: target('b') });
		expect(h.sessions).toHaveLength(1);
	});
});
