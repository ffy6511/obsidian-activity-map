import { describe, expect, it } from '../helpers/test-harness';

import { lastNDays, naturalDayRange, resolveRange } from '../../src/query/date-range';
import { sampleRecordedDates } from '../fixtures/activity-history';

describe('date range resolution', () => {
	it('day mode contributes exactly one date with no denominator', () => {
		const r = resolveRange({
			range: { mode: 'day', localDate: '2026-07-20' },
			recordedDates: sampleRecordedDates(),
		});
		expect(r.dates).toEqual(['2026-07-20']);
		expect(r.denominatorDays).toBeNull();
	});

	it('7-day average includes the zero-use day in the denominator', () => {
		// today = 2026-07-20, window = 7 days => 2026-07-14..2026-07-20 (7 days),
		// including the zero-use 2026-07-17.
		const r = resolveRange({
			range: { mode: 'average', days: 7, today: '2026-07-20' },
			recordedDates: sampleRecordedDates(),
		});
		expect(r.denominatorDays).toBe(7);
		expect(r.dates).toHaveLength(7);
		expect(r.dates).toContain('2026-07-17');
		expect(r.coverage).toEqual({ firstDate: '2026-07-14', lastDate: '2026-07-20' });
	});

	it('30-day average shortens the denominator when recording started later', () => {
		// First recorded date is 2026-07-14; a 30-day window would start
		// 2026-06-21, but effective start is 2026-07-14.
		const r = resolveRange({
			range: { mode: 'average', days: 30, today: '2026-07-20' },
			recordedDates: sampleRecordedDates(),
		});
		// Denominator = days from 2026-07-14 to 2026-07-20 inclusive = 7.
		expect(r.denominatorDays).toBe(7);
	});

	it('all-history total contributes all recorded dates with no denominator', () => {
		const r = resolveRange({
			range: { mode: 'all' },
			recordedDates: sampleRecordedDates(),
		});
		expect(r.denominatorDays).toBeNull();
		expect(r.dates).toEqual(sampleRecordedDates());
	});

	it('no data yields empty dates, null denominator, and null coverage', () => {
		const r = resolveRange({
			range: { mode: 'average', days: 30, today: '2026-07-20' },
			recordedDates: [],
		});
		expect(r.dates).toEqual([]);
		expect(r.denominatorDays).toBeNull();
		expect(r.coverage).toBeNull();
	});

	it('all-history average divides by natural days from firstDate to today', () => {
		const r = resolveRange({
			range: { mode: 'average', days: 'all', today: '2026-07-20' },
			recordedDates: sampleRecordedDates(),
		});
		// 2026-07-14 .. 2026-07-20 inclusive = 7 natural days.
		expect(r.denominatorDays).toBe(7);
	});
});

describe('date range helpers', () => {
	it('lastNDays returns the window ending today, oldest first', () => {
		expect(lastNDays('2026-07-20', 3)).toEqual(['2026-07-18', '2026-07-19', '2026-07-20']);
	});

	it('naturalDayRange is inclusive of both endpoints', () => {
		expect(naturalDayRange('2026-07-19', '2026-07-21')).toEqual([
			'2026-07-19',
			'2026-07-20',
			'2026-07-21',
		]);
	});
});
