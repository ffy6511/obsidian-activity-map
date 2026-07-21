import { describe, expect, it } from '../helpers/test-harness';

import type {
	ClosedSessionSegment,
	RecoveryDecision,
	RuntimeCheckpoint,
	TrackingSnapshot,
} from '../../src/domain/activity';
import { DEFAULT_SETTINGS, normalizeSettings } from '../../src/domain/settings';
import type { ClockSample } from '../../src/platform/clock';
import { ActivityEngine, type EngineCallbacks } from '../../src/tracking/activity-engine';
import { reconcileCheckpoint } from '../../src/tracking/checkpoint-reconciler';

function sample(monotonicMs: number): ClockSample {
	return { wallMs: monotonicMs, monotonicMs, timeZone: 'UTC' };
}

function makeEngine() {
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
	const engine = new ActivityEngine(
		normalizeSettings({ ...DEFAULT_SETTINGS, deviceId: 'd1' }),
		callbacks,
	);
	return { engine, sessions, decisions, snapshots, checkpoints };
}

describe('checkpoint reconciliation', () => {
	it('returns empty for a null checkpoint (clean shutdown)', () => {
		const { engine } = makeEngine();
		const result = reconcileCheckpoint({
			checkpoint: null,
			engine,
			clock: { now: () => sample(0) },
			nowSample: sample(0),
		});
		expect(result.outcome).toBe('empty');
	});

	it('quarantines a checkpoint with an unsupported schema version', () => {
		const { engine } = makeEngine();
		const checkpoint = {
			schemaVersion: 99,
			state: 'active',
			currentTarget: null,
			sessionStartedAt: null,
			lastTrustedActivityAt: null,
			editBurst: null,
			pendingRecovery: [],
			recentDecisions: [],
			savedAt: 'x',
		} as unknown as RuntimeCheckpoint;
		const result = reconcileCheckpoint({
			checkpoint,
			engine,
			clock: { now: () => sample(0) },
			nowSample: sample(0),
		});
		expect(result.outcome).toBe('quarantined');
		expect(result.reason).toContain('unsupported-schema-version');
	});

	it('quarantines an active checkpoint missing its target', () => {
		const { engine } = makeEngine();
		const checkpoint = {
			schemaVersion: 1,
			state: 'active',
			currentTarget: null,
			sessionStartedAt: '2026-01-01T00:00:00.000Z',
			lastTrustedActivityAt: null,
			editBurst: null,
			pendingRecovery: [],
			recentDecisions: [],
			savedAt: 'x',
		} as RuntimeCheckpoint;
		const result = reconcileCheckpoint({
			checkpoint,
			engine,
			clock: { now: () => sample(0) },
			nowSample: sample(0),
		});
		expect(result.outcome).toBe('quarantined');
		expect(result.reason).toBe('active-checkpoint-missing-target');
	});

	it('restores a valid active checkpoint without emitting duplicate sessions', () => {
		const h = makeEngine();
		h.engine.submit({ kind: 'start', sample: sample(0) });
		h.engine.submit({
			kind: 'focus-target',
			sample: sample(0),
			target: { fileId: 'f', path: 'a.md', windowId: 'main', leafId: 'l1' },
		});
		// Capture the checkpoint produced for the active session.
		const active = h.checkpoints.at(-1);
		expect(active).toBeDefined();
		// Simulate restart into a fresh engine.
		const h2 = makeEngine();
		const r1 = reconcileCheckpoint({
			checkpoint: active ?? null,
			engine: h2.engine,
			clock: { now: () => sample(0) },
			nowSample: sample(0),
		});
		expect(r1.outcome).toBe('restored');
		// Restoring the same checkpoint again must not duplicate emissions.
		const before = h2.sessions.length;
		const r2 = reconcileCheckpoint({
			checkpoint: active ?? null,
			engine: h2.engine,
			clock: { now: () => sample(0) },
			nowSample: sample(0),
		});
		expect(r2.outcome).toBe('restored');
		expect(h2.sessions.length).toBe(before);
	});

	it('shutdown after any transition persists a closed record or leaves a recoverable checkpoint', () => {
		const h = makeEngine();
		h.engine.submit({ kind: 'start', sample: sample(0) });
		h.engine.submit({
			kind: 'focus-target',
			sample: sample(0),
			target: { fileId: 'f', path: 'a.md', windowId: 'main', leafId: 'l1' },
		});
		h.engine.submit({ kind: 'activity', sample: sample(5_000) });
		// Stop with an open session: emits a shutdown segment.
		h.engine.submit({ kind: 'stop', sample: sample(10_000) });
		expect(h.sessions).toHaveLength(1);
		expect(h.sessions[0]?.closureReason).toBe('shutdown');
		// A final checkpoint exists for recovery.
		expect(h.checkpoints.length).toBeGreaterThan(0);
	});
});
