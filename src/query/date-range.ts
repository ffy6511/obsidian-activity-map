/**
 * Query date-range resolution.
 *
 * A query picks one of three range modes and this module turns it into the set
 * of local dates that contribute, plus the average denominator. Daily averages
 * include zero-use natural days after the first recorded date; an installation
 * shorter than the requested window shortens the denominator. No data yields a
 * null coverage and null denominator so the UI renders an empty state.
 */

export type RangeMode =
	| { mode: 'day'; localDate: string }
	| { mode: 'average'; days: 7 | 30 | 90 | 'all'; today: string }
	| { mode: 'all' };

/** Resolved date range for a query. */
export interface ResolvedRange {
	/** Inclusive dates that contribute metrics (may include zero-use days). */
	dates: string[];
	/** Natural-day denominator for averages; null for day/all-total queries. */
	denominatorDays: number | null;
	/** Earliest/latest recorded dates across retained summaries. */
	coverage: { firstDate: string; lastDate: string } | null;
}

/**
 * Resolve a range against the set of recorded dates. `recordedDates` is the
 * sorted unique set of local dates that have at least one retained summary.
 */
export function resolveRange(args: {
	range: RangeMode;
	recordedDates: readonly string[];
}): ResolvedRange {
	const { range, recordedDates } = args;
	const sorted = [...recordedDates].sort();
	const coverage =
		sorted.length > 0
			? { firstDate: sorted[0] as string, lastDate: sorted[sorted.length - 1] as string }
			: null;

	if (range.mode === 'day') {
		return {
			dates: [range.localDate],
			denominatorDays: null,
			coverage,
		};
	}

	if (range.mode === 'all') {
		// All-history total performs no division. The contributing dates are all
		// recorded dates; the average view computes a denominator separately.
		return { dates: sorted, denominatorDays: null, coverage };
	}

	// Rolling average: window of N natural days ending today (inclusive). The
	// denominator shortens when the first recorded date is newer than the window.
	const today = range.today;
	const windowDays = range.days === 'all' ? null : range.days;
	if (windowDays === null) {
		// all-history average: denominator = natural days from firstDate..today.
		if (!coverage) {
			return { dates: [], denominatorDays: null, coverage: null };
		}
		const dates = naturalDayRange(coverage.firstDate, today);
		return { dates, denominatorDays: dates.length, coverage };
	}
	// No recorded data: contribute nothing and expose a null denominator so the
	// UI renders an empty state rather than a misleading single-day average.
	if (!coverage) {
		return { dates: [], denominatorDays: null, coverage: null };
	}
	// The contributing window is the last `windowDays` natural days ending today.
	const window = lastNDays(today, windowDays);
	// Shorten the denominator if recording started inside the window.
	const firstRecorded = coverage?.firstDate ?? today;
	const windowStart = window[0] as string;
	const effectiveStart = firstRecorded > windowStart ? firstRecorded : windowStart;
	const effectiveDates = window.filter((d) => d >= effectiveStart);
	return {
		dates: effectiveDates,
		denominatorDays: effectiveDates.length,
		coverage,
	};
}

/** All natural days in [start, end] inclusive, as YYYY-MM-DD strings. */
export function naturalDayRange(start: string, end: string): string[] {
	const out: string[] = [];
	let cursor = new Date(`${start}T00:00:00.000Z`);
	const endMs = new Date(`${end}T00:00:00.000Z`).getTime();
	while (cursor.getTime() <= endMs) {
		out.push(cursor.toISOString().slice(0, 10));
		cursor = new Date(cursor.getTime() + 86_400_000);
	}
	return out;
}

/** The last N natural days ending on `today` (inclusive), oldest first. */
export function lastNDays(today: string, days: number): string[] {
	const end = new Date(`${today}T00:00:00.000Z`);
	const out: string[] = [];
	for (let i = days - 1; i >= 0; i -= 1) {
		const d = new Date(end.getTime() - i * 86_400_000);
		out.push(d.toISOString().slice(0, 10));
	}
	return out;
}
