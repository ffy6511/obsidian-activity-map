import { describe, expect, it } from '../helpers/test-harness';

import {
	localDateFor,
	monotonicDelta,
	splitAtLocalMidnight,
	startOfLocalDayMs,
	toIso,
	type ClockSample,
} from '../../src/platform/clock';

const UTC = 'UTC';
// Asia/Shanghai is UTC+8 with no DST; stable offsets make midnight math readable.
const SHANGHAI = 'Asia/Shanghai';
// America/New_York observes DST, exercising offset transitions.
const NEW_YORK = 'America/New_York';

describe('clock samples and formatting', () => {
	it('computes monotonic deltas between samples', () => {
		const a: ClockSample = { wallMs: 0, monotonicMs: 100, timeZone: UTC };
		const b: ClockSample = { wallMs: 5_000, monotonicMs: 600, timeZone: UTC };
		expect(monotonicDelta(a, b)).toBe(500);
	});

	it('formats wall-ms as ISO timestamps', () => {
		expect(toIso(Date.UTC(2026, 5, 21, 10, 30, 0))).toBe('2026-06-21T10:30:00.000Z');
	});

	it('resolves the local date for a wall-ms epoch', () => {
		// 2026-06-21T18:00:00Z is 2026-06-22 02:00 in Shanghai (+8).
		const ms = Date.UTC(2026, 5, 21, 18, 0, 0);
		expect(localDateFor(ms, UTC)).toBe('2026-06-21');
		expect(localDateFor(ms, SHANGHAI)).toBe('2026-06-22');
	});
});

describe('startOfLocalDayMs', () => {
	it('returns the epoch at local midnight in a fixed-offset zone', () => {
		// 2026-06-21 12:00 UTC is 2026-06-21 20:00 Shanghai. Its local midnight
		// is 2026-06-21 00:00 Shanghai = 2026-06-20 16:00 UTC.
		const ms = Date.UTC(2026, 5, 21, 12, 0, 0);
		expect(startOfLocalDayMs(ms, SHANGHAI)).toBe(Date.UTC(2026, 5, 20, 16, 0, 0));
	});

	it('handles UTC midnight as a no-op', () => {
		const ms = Date.UTC(2026, 5, 21, 12, 0, 0);
		expect(startOfLocalDayMs(ms, UTC)).toBe(Date.UTC(2026, 5, 21, 0, 0, 0));
	});

	it('is consistent across the spring-forward DST gap in New York', () => {
		// 2026-03-08 is the US spring-forward day (02:00 -> 03:00). Midnight in
		// New York is 05:00 UTC before the transition.
		const justBeforeMidnightNY = Date.UTC(2026, 2, 8, 4, 59, 0);
		const midnight = startOfLocalDayMs(justBeforeMidnightNY + 3_600_000, NEW_YORK);
		// 2026-03-08 00:00 EST = 05:00 UTC.
		expect(midnight).toBe(Date.UTC(2026, 2, 8, 5, 0, 0));
	});
});

describe('splitAtLocalMidnight', () => {
	it('returns one segment when the interval is within a day', () => {
		const start = Date.UTC(2026, 5, 21, 10, 0, 0);
		const end = start + 3_600_000;
		const segments = splitAtLocalMidnight({
			startedAtMs: start,
			endedAtMs: end,
			activeMs: 3_600_000,
			editingMs: 1_800_000,
			timeZone: UTC,
		});
		expect(segments).toHaveLength(1);
		expect(segments[0]).toMatchObject({
			localDate: '2026-06-21',
			activeMs: 3_600_000,
			editingMs: 1_800_000,
			first: true,
		});
	});

	it('splits an interval crossing exactly one midnight into two proportional pieces', () => {
		// 23:00 -> 01:00 UTC = 2h total, split 1h / 1h.
		const start = Date.UTC(2026, 5, 21, 23, 0, 0);
		const end = Date.UTC(2026, 5, 22, 1, 0, 0);
		const segments = splitAtLocalMidnight({
			startedAtMs: start,
			endedAtMs: end,
			activeMs: 2_000_000,
			editingMs: 1_000_000,
			timeZone: UTC,
		});
		expect(segments).toHaveLength(2);
		expect(segments.map((s) => s.localDate)).toEqual(['2026-06-21', '2026-06-22']);
		expect(segments[0]).toMatchObject({
			startedAtMs: start,
			endedAtMs: Date.UTC(2026, 5, 22, 0, 0, 0),
			activeMs: 1_000_000,
			editingMs: 500_000,
			first: true,
		});
		expect(segments[1]).toMatchObject({
			startedAtMs: Date.UTC(2026, 5, 22, 0, 0, 0),
			endedAtMs: end,
			activeMs: 1_000_000,
			editingMs: 500_000,
			first: false,
		});
	});

	it('preserves exact totals across an uneven split (drift correction)', () => {
		// 3h total split into 1h + 2h with a metric not divisible cleanly by 3.
		// 23:00 UTC -> 02:00 UTC crosses exactly one midnight (two segments).
		const start = Date.UTC(2026, 5, 21, 23, 0, 0);
		const end = Date.UTC(2026, 5, 22, 2, 0, 0);
		const activeMs = 1_000; // 1000/3 rounds awkwardly
		const editingMs = 700;
		const segments = splitAtLocalMidnight({
			startedAtMs: start,
			endedAtMs: end,
			activeMs,
			editingMs,
			timeZone: UTC,
		});
		expect(segments).toHaveLength(2);
		const activeSum = segments.reduce((a, s) => a + s.activeMs, 0);
		const editingSum = segments.reduce((a, s) => a + s.editingMs, 0);
		expect(activeSum).toBe(activeMs);
		expect(editingSum).toBe(editingMs);
		expect(segments[0]?.first).toBe(true);
		expect(segments[1]?.first).toBe(false);
	});

	it('only the first segment carries first=true across multiple splits', () => {
		// 47h crossing two midnights.
		const start = Date.UTC(2026, 5, 21, 1, 0, 0);
		const end = start + 47 * 3_600_000;
		const segments = splitAtLocalMidnight({
			startedAtMs: start,
			endedAtMs: end,
			activeMs: 47 * 3_600_000,
			editingMs: 0,
			timeZone: UTC,
		});
		expect(segments.filter((s) => s.first)).toHaveLength(1);
		expect(segments[0]?.first).toBe(true);
	});

	it('returns one segment for a zero-duration interval', () => {
		const start = Date.UTC(2026, 5, 21, 12, 0, 0);
		const segments = splitAtLocalMidnight({
			startedAtMs: start,
			endedAtMs: start,
			activeMs: 0,
			editingMs: 0,
			timeZone: UTC,
		});
		expect(segments).toHaveLength(1);
		expect(segments[0]?.activeMs).toBe(0);
	});

	it('splits correctly on a DST-long day (fall-back 25h day in New York)', () => {
		// US fall-back 2026-11-01: New York repeats the 01:00-02:00 wall hour.
		// A session 2026-11-01 23:00 EDT -> 2026-11-02 01:30 EST. In UTC that
		// is 2026-11-02 03:00 UTC -> 2026-11-02 06:30 UTC (1h real + 2.5h real
		// = 3.5h wall because of the repeated hour). It crosses local midnight.
		const start = Date.UTC(2026, 10, 2, 3, 0, 0);
		const end = Date.UTC(2026, 10, 2, 6, 30, 0);
		const segments = splitAtLocalMidnight({
			startedAtMs: start,
			endedAtMs: end,
			activeMs: 1_000_000,
			editingMs: 0,
			timeZone: NEW_YORK,
		});
		expect(segments.length).toBeGreaterThanOrEqual(2);
		const activeSum = segments.reduce((a, s) => a + s.activeMs, 0);
		expect(activeSum).toBe(1_000_000);
	});

	it('splits correctly on a DST-short day (spring-forward in New York)', () => {
		// 2026-03-08 spring-forward: 23h wall day. A session crossing midnight.
		const start = Date.UTC(2026, 2, 8, 4, 0, 0); // 2026-03-08 04:00 UTC = before midnight EST
		const end = Date.UTC(2026, 2, 9, 0, 0, 0); // 2026-03-09 00:00 UTC
		const segments = splitAtLocalMidnight({
			startedAtMs: start,
			endedAtMs: end,
			activeMs: 1_000_000,
			editingMs: 0,
			timeZone: NEW_YORK,
		});
		const activeSum = segments.reduce((a, s) => a + s.activeMs, 0);
		expect(activeSum).toBe(1_000_000);
		expect(segments.length).toBeGreaterThanOrEqual(2);
	});
});

describe('clock invariants under elapsed-time validation', () => {
	it('rejects non-finite monotonic deltas by leaving them undefined for callers', () => {
		// The helper does not guard non-finite; callers (the engine) must reject.
		const a: ClockSample = { wallMs: 0, monotonicMs: 0, timeZone: UTC };
		const b: ClockSample = { wallMs: 0, monotonicMs: NaN, timeZone: UTC };
		const delta = monotonicDelta(a, b);
		expect(Number.isFinite(delta)).toBe(false);
	});
});
