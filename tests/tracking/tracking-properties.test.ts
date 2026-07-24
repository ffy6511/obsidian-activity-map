import { describe, expect, it } from '../helpers/test-harness';

import type {
	ClosedSessionSegment,
	RecoveryDecision,
	RuntimeCheckpoint,
	TrackingSnapshot,
} from '../../src/domain/activity';
import { DEFAULT_SETTINGS, normalizeSettings } from '../../src/domain/settings';
import type { ClockSample } from '../../src/platform/clock';
import { ActivityEngine, type EngineInput } from '../../src/tracking/activity-engine';

/**
 * Deterministic pseudo-random generator (mulberry32) so property tests are
 * reproducible across runs. Seeded once; sequences repeat on every CI run.
 */
function mulberry32(seed: number): () => number {
	let a = seed;
	return () => {
		a |= 0;
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function sample(wallMs: number): ClockSample {
	return { wallMs, monotonicMs: wallMs, timeZone: 'UTC' };
}

interface Harness {
	engine: ActivityEngine;
	sessions: ClosedSessionSegment[];
}

function makeEngine(): Harness {
	const sessions: ClosedSessionSegment[] = [];
	const decisions: RecoveryDecision[] = [];
	const snapshots: TrackingSnapshot[] = [];
	const checkpoints: RuntimeCheckpoint[] = [];
	const engine = new ActivityEngine(normalizeSettings({ ...DEFAULT_SETTINGS, deviceId: 'd1' }), {
		onEmit: (e) => {
			sessions.push(...e.segments);
			decisions.push(...e.decisions);
		},
		onSnapshot: (s) => snapshots.push(s),
		onCheckpoint: (c) => checkpoints.push(c),
	});
	return { engine, sessions };
}

const FILES = ['a', 'b', 'c'];

/** Build a random but monotonic, clock-respecting input sequence. */
function generateSequence(rand: () => number, steps: number): EngineInput[] {
	const inputs: EngineInput[] = [];
	let t = 0;
	inputs.push({ kind: 'start', sample: sample(t) });
	for (let i = 0; i < steps; i += 1) {
		t += 1_000 + Math.floor(rand() * 10_000);
		const roll = rand();
		if (roll < 0.4) {
			const f = FILES[Math.floor(rand() * FILES.length)] ?? 'a';
			inputs.push({
				kind: 'focus-target',
				sample: sample(t),
				target: { fileId: f, path: `${f}.md`, windowId: 'main', leafId: 'l1' },
			});
		} else if (roll < 0.55) {
			inputs.push({ kind: 'activity', sample: sample(t) });
		} else if (roll < 0.7) {
			inputs.push({ kind: 'edit', sample: sample(t) });
		} else if (roll < 0.8) {
			inputs.push({ kind: 'blur', sample: sample(t) });
		} else if (roll < 0.88) {
			inputs.push({ kind: 'idle-confirm', sample: sample(t) });
		} else if (roll < 0.93) {
			inputs.push({ kind: 'pause', sample: sample(t) });
		} else if (roll < 0.98) {
			inputs.push({ kind: 'resume', sample: sample(t) });
		} else {
			inputs.push({ kind: 'untrackable', sample: sample(t) });
		}
	}
	t += 1_000;
	inputs.push({ kind: 'stop', sample: sample(t) });
	return inputs;
}

describe('tracking randomized invariants', () => {
	it('preserves foreground exclusivity: emitted segments never overlap in time', () => {
		const rand = mulberry32(42);
		const inputs = generateSequence(rand, 400);
		const { engine, sessions } = makeEngine();
		for (const input of inputs) {
			engine.submit(input);
		}
		// Sort by start; no two segments from different files may overlap.
		const sorted = [...sessions].sort(
			(a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt),
		);
		for (let i = 1; i < sorted.length; i += 1) {
			const prev = sorted[i - 1];
			const cur = sorted[i];
			if (prev && cur) {
				// Different files must not overlap; same file segments are split, also non-overlapping.
				expect(Date.parse(cur.startedAt)).toBeGreaterThanOrEqual(Date.parse(prev.endedAt));
			}
		}
	});

	it('keeps all metrics non-negative and editingMs <= activeMs on every segment', () => {
		for (let seed = 1; seed <= 8; seed += 1) {
			const rand = mulberry32(seed * 1000);
			const inputs = generateSequence(rand, 200);
			const { engine, sessions } = makeEngine();
			for (const input of inputs) {
				engine.submit(input);
			}
			for (const s of sessions) {
				expect(s.activeMs).toBeGreaterThanOrEqual(0);
				expect(s.editingMs).toBeGreaterThanOrEqual(0);
				expect(s.editingMs).toBeLessThanOrEqual(s.activeMs);
				expect(s.openCount === 0 || s.openCount === 1).toBeTrue();
			}
		}
	});

	it('replays the same sequence deterministically (idempotency of the engine)', () => {
		const rand1 = mulberry32(7);
		const rand2 = mulberry32(7);
		const a = generateSequence(rand1, 150);
		const b = generateSequence(rand2, 150);
		const h1 = makeEngine();
		const h2 = makeEngine();
		for (const input of a) h1.engine.submit(input);
		for (const input of b) h2.engine.submit(input);
		expect(h1.sessions.length).toBe(h2.sessions.length);
		for (let i = 0; i < h1.sessions.length; i += 1) {
			expect(h1.sessions[i]?.activeMs).toBe(h2.sessions[i]?.activeMs);
			expect(h1.sessions[i]?.editingMs).toBe(h2.sessions[i]?.editingMs);
		}
	});
});
