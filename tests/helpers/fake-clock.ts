/**
 * Deterministic fake clock for runtime tests.
 *
 * Tests advance wall and monotonic time explicitly so idle rollback, midnight
 * splitting, and sleep-like heartbeat gaps are reproducible. The fake also
 * supports simulating DST jumps and non-24h days by letting tests set an
 * arbitrary time zone and move wall time across a boundary.
 */

import type { Clock, ClockSample } from '../../src/platform/clock';

export interface FakeClock extends Clock {
	/** Advance both clocks by the same delta (ms). Most transitions behave this way. */
	advance(ms: number): void;
	/** Advance wall only (simulates a clock change or DST jump with no elapsed monotonic time). */
	advanceWall(ms: number): void;
	/** Advance monotonic only (simulates throttled callbacks with elapsed time but no new wall sample). */
	advanceMonotonic(ms: number): void;
	/** Set the time zone used by samples (affects local-date and midnight math). */
	setTimeZone(timeZone: string): void;
	setWall(ms: number): void;
	sample(): ClockSample;
}

export function createFakeClock(
	opts: { wallMs?: number; monotonicMs?: number; timeZone?: string } = {},
): FakeClock {
	let wallMs = opts.wallMs ?? Date.UTC(2026, 0, 1, 12, 0, 0);
	let monotonicMs = opts.monotonicMs ?? 0;
	let timeZone = opts.timeZone ?? 'UTC';

	return {
		advance(ms: number) {
			wallMs += ms;
			monotonicMs += ms;
		},
		advanceWall(ms: number) {
			wallMs += ms;
		},
		advanceMonotonic(ms: number) {
			monotonicMs += ms;
		},
		setTimeZone(tz: string) {
			timeZone = tz;
		},
		setWall(ms: number) {
			wallMs = ms;
		},
		sample() {
			return { wallMs, monotonicMs, timeZone };
		},
		now() {
			return { wallMs, monotonicMs, timeZone };
		},
	};
}
