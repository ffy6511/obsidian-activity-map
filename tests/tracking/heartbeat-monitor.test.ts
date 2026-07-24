import { describe, expect, it } from '../helpers/test-harness';

import { HeartbeatMonitor } from '../../src/tracking/heartbeat-monitor';
import type { ClockSample } from '../../src/platform/clock';

function monitor(
	opts?: Partial<{
		expectedIntervalMs: number;
		idleThresholdMs: number;
		jitterTolerance: number;
	}>,
): HeartbeatMonitor {
	return new HeartbeatMonitor({
		expectedIntervalMs: opts?.expectedIntervalMs ?? 30_000,
		idleThresholdMs: opts?.idleThresholdMs ?? 180_000,
		jitterTolerance: opts?.jitterTolerance ?? 2,
	});
}

function sample(monotonicMs: number): ClockSample {
	return { wallMs: monotonicMs, monotonicMs, timeZone: 'UTC' };
}

describe('heartbeat monitor', () => {
	it('classifies an on-schedule heartbeat as normal', () => {
		const m = monitor();
		expect(m.classify(sample(0), sample(30_000))).toMatchObject({ kind: 'normal' });
	});

	it('classifies jitter within tolerance as normal', () => {
		const m = monitor({ expectedIntervalMs: 30_000, jitterTolerance: 2 });
		// 60s actual = exactly 2x expected, still within tolerance (<=).
		expect(m.classify(sample(0), sample(60_000))).toMatchObject({ kind: 'normal' });
	});

	it('detects drift beyond tolerance', () => {
		const m = monitor({
			expectedIntervalMs: 30_000,
			jitterTolerance: 2,
			idleThresholdMs: 180_000,
		});
		const v = m.classify(sample(0), sample(120_000));
		expect(v.kind).toBe('drift');
		if (v.kind === 'drift') {
			expect(v.actualMs).toBe(120_000);
			// 120s is below the 180s idle threshold, so not sleep-like yet.
			expect(v.sleepLike).toBeFalse();
		}
	});

	it('flags drift beyond the idle threshold as sleep-like', () => {
		const m = monitor({
			expectedIntervalMs: 30_000,
			jitterTolerance: 2,
			idleThresholdMs: 180_000,
		});
		const v = m.classify(sample(0), sample(600_000));
		expect(v.kind).toBe('drift');
		if (v.kind === 'drift') {
			expect(v.sleepLike).toBeTrue();
		}
	});

	it('rejects non-finite or non-positive deltas as normal', () => {
		const m = monitor();
		expect(m.classify(sample(0), sample(NaN))).toMatchObject({ kind: 'normal' });
		expect(m.classify(sample(10), sample(5))).toMatchObject({ kind: 'normal' });
	});
});
