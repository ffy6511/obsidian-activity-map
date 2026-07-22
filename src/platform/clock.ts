/**
 * Injectable clock and time utilities.
 *
 * A transition never samples the clock twice: one callback produces one
 * {@link ClockSample} shared by every state change it triggers. Wall time owns
 * timestamps, local-date selection, and midnight boundaries; monotonic time
 * owns elapsed durations and delayed-heartbeat detection. Keeping these
 * concerns separate is what lets a fake clock make idle rollback and sleep
 * deterministic in tests.
 */

/** One immutable time sample. All state changes caused by one callback share one sample. */
export interface ClockSample {
	/** Epoch milliseconds (Date.now()). Owns ISO timestamps and local-date boundaries. */
	wallMs: number;
	/**
	 * Monotonic milliseconds (performance.now()-like). Owns elapsed durations
	 * and delayed-heartbeat detection; never affected by wall-clock changes.
	 */
	monotonicMs: number;
	/** IANA time zone name at sample time, e.g. "Asia/Shanghai". */
	timeZone: string;
}

/** Clock abstraction so deterministic tests can replace wall + monotonic time. */
export interface Clock {
	now(): ClockSample;
}

/** Production wall/monotonic clock backed by standard Web APIs. */
export class SystemClock implements Clock {
	now(): ClockSample {
		return {
			wallMs: Date.now(),
			monotonicMs: performance.now(),
			timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
		};
	}
}

/**
 * Elapsed time between two monotonic samples. Negative or non-finite deltas are
 * rejected by callers (the engine reports them without increasing metrics), so
 * this helper is the single place that defines "how much time passed".
 */
export function monotonicDelta(
	start: ClockSample,
	end: ClockSample,
): number {
	return end.monotonicMs - start.monotonicMs;
}

/**
 * Format a wall-ms epoch as an ISO 8601 string. Kept here so every persisted
 * timestamp uses the same representation.
 */
export function toIso(wallMs: number): string {
	return new Date(wallMs).toISOString();
}

/**
 * Resolve the local natural date (YYYY-MM-DD) for a wall-ms epoch in the given
 * time zone. Historical dates are computed in the time zone that was effective
 * at event time and never repartitioned by later moves.
 */
export function localDateFor(wallMs: number, timeZone: string): string {
	// Format parts in the target zone so DST and non-24h days resolve correctly.
	const dtf = new Intl.DateTimeFormat('en-CA', {
		timeZone,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
	});
	// en-CA yields the YYYY-MM-DD shape directly.
	return dtf.format(new Date(wallMs));
}

/**
 * Wall-ms epoch of local midnight that begins the natural day containing
 * `wallMs` in `timeZone`. Used to split closed sessions at event-time midnight
 * after their final endpoint is known.
 */
export function startOfLocalDayMs(wallMs: number, timeZone: string): number {
	const date = localDateFor(wallMs, timeZone);
	const year = Number(date.slice(0, 4));
	const month = Number(date.slice(5, 7)) - 1;
	const day = Number(date.slice(8, 10));
	// Interpret the calendar date as UTC midnight first, then subtract the
	// zone's UTC offset at that instant so the result is the epoch at which the
	// zone's wall clock reads 00:00:00.
	const asUtcMidnight = Date.UTC(year, month, day, 0, 0, 0);
	const offsetMs = zoneOffsetMs(asUtcMidnight, timeZone);
	return asUtcMidnight - offsetMs;
}

/**
 * Epoch of the first local midnight strictly after `wallMs` in `timeZone`.
 *
 * Naive `startOfLocalDayMs + 86400000` is wrong on DST days: a 23h or 25h
 * calendar day makes the next local midnight land at a non-24h offset, and at
 * exactly a midnight boundary it returns the same instant (stalling the split
 * loop). We probe forward in minute granularity to find the first instant whose
 * calendar date differs from `wallMs`'s date. Probing is bounded by 28h, which
 * covers every possible wall-clock day length (23h..25h).
 */
export function nextLocalMidnightMs(wallMs: number, timeZone: string): number {
	const startDate = localDateFor(wallMs, timeZone);
	// Start probing just after the current instant's day-start; the next
	// midnight is at most 25 wall-hours away, so 28h of minute steps is safe.
	const earliest = startOfLocalDayMs(wallMs, timeZone) + 1;
	const limit = wallMs + 28 * 3_600_000;
	for (let t = earliest; t <= limit; t += 60_000) {
		if (localDateFor(t, timeZone) !== startDate) {
			// `t` is the first minute whose calendar date differs. Local midnight
			// always falls on a minute boundary, so snap down to it. This keeps
			// persisted segment endpoints exact (no sub-minute drift).
			return Math.floor(t / 60_000) * 60_000;
		}
	}
	// Fallback: should be unreachable given the 28h bound. Use the 24h add so
	// callers still make progress rather than looping forever.
	return wallMs + 86_400_000;
}

/**
 * Zone UTC offset (ms east of UTC) at a given epoch. Uses `longOffset`
 * ("GMT+08:00") for a consistent parseable shape across runtimes.
 */
function zoneOffsetMs(epochMs: number, timeZone: string): number {
	const dtf = new Intl.DateTimeFormat('en-US', {
		timeZone,
		timeZoneName: 'longOffset',
	});
	const parts = dtf.formatToParts(new Date(epochMs));
	const tz = parts.find((p) => p.type === 'timeZoneName')?.value ?? 'GMT';
	// Matches "GMT+08:00", "GMT-05", "GMT" (UTC), and the rare "UTC+08:00".
	const match = /(?:GMT|UTC)([+-])(\d{1,2})(?::(\d{2}))?/.exec(tz);
	if (!match) return 0;
	const sign = match[1] === '-' ? -1 : 1;
	const hours = Number(match[2]);
	const minutes = match[3] ? Number(match[3]) : 0;
	return sign * (hours * 3_600_000 + minutes * 60_000);
}

/**
 * Segment describing one piece of a closed interval after midnight splitting.
 * Metrics are partitioned so their sum equals the original; only the first
 * segment retains openCount.
 */
export interface SessionSegmentPartition {
	localDate: string;
	startedAtMs: number;
	endedAtMs: number;
	activeMs: number;
	editingMs: number;
	/** Whether this is the leading segment (carries openCount). */
	first: boolean;
}

/**
 * Split a closed interval at each local-midnight boundary it crosses, dividing
 * activeMs and editingMs proportionally to wall-clock duration so totals stay
 * exact. Splitting happens after the final endpoint is known, so an idle
 * rollback that pulls the end back across midnight cannot leave an already
 * persisted post-midnight fragment.
 *
 * Returns a single segment when the interval lies wholly within one natural day.
 */
export function splitAtLocalMidnight(args: {
	startedAtMs: number;
	endedAtMs: number;
	activeMs: number;
	editingMs: number;
	timeZone: string;
}): SessionSegmentPartition[] {
	const { startedAtMs, endedAtMs, activeMs, editingMs, timeZone } = args;
	const totalMs = endedAtMs - startedAtMs;
	if (totalMs <= 0) {
		return [
			{
				localDate: localDateFor(startedAtMs, timeZone),
				startedAtMs,
				endedAtMs,
				activeMs,
				editingMs,
				first: true,
			},
		];
	}
	const segments: SessionSegmentPartition[] = [];
	let cursor = startedAtMs;
	let first = true;
	while (cursor < endedAtMs) {
		// nextLocalMidnightMs handles 23h/25h DST days; dayStart+24h does not.
		const nextMidnight = nextLocalMidnightMs(cursor, timeZone);
		const segEnd = Math.min(nextMidnight, endedAtMs);
		// Guard: segEnd must always advance past cursor or the loop would not
		// terminate. nextLocalMidnightMs guarantees this in practice; the guard
		// converts any future edge case into a clean single-segment result.
		if (segEnd <= cursor) {
			break;
		}
		const segDur = segEnd - cursor;
		const ratio = segDur / totalMs;
		segments.push({
			localDate: localDateFor(cursor, timeZone),
			startedAtMs: cursor,
			endedAtMs: segEnd,
			// Proportional split keeps totals exact under floating point; round
			// to integer ms so persisted metrics stay whole numbers.
			activeMs: Math.round(activeMs * ratio),
			editingMs: Math.round(editingMs * ratio),
			first,
		});
		cursor = segEnd;
		first = false;
	}
	// Correct rounding drift onto the first segment so the sum is exact.
	const activeSum = segments.reduce((a, s) => a + s.activeMs, 0);
	const editingSum = segments.reduce((a, s) => a + s.editingMs, 0);
	const activeDrift = activeMs - activeSum;
	const editingDrift = editingMs - editingSum;
	if (segments[0] && activeDrift !== 0) {
		segments[0].activeMs += activeDrift;
	}
	if (segments[0] && editingDrift !== 0) {
		segments[0].editingMs += editingDrift;
	}
	return segments;
}
