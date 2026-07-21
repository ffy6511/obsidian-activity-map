/**
 * Editing-burst model.
 *
 * `editingMs` is an activity-subset metric: it is the union of edit bursts and
 * must always satisfy `editingMs <= activeMs`. A burst opens at the first
 * qualifying editor event and extends to `silenceMs` after the latest edit,
 * clipped by session end, target change, idle rollback, pause, or blur.
 *
 * Bursts are represented as half-open wall-ms intervals `[start, end)`. The
 * union length is computed on demand so callers (the engine) can clip it to
 * the session's `[0, activeMs]` range before persisting.
 */

/**
 * Immutable wall-ms interval. `end` is exclusive. `end < start` is invalid and
 * rejected at insertion.
 */
export interface BurstInterval {
	start: number;
	end: number;
}

/** Mutable editing-burst accumulator for one in-flight session/target. */
export class EditingBurst {
	private readonly intervals: BurstInterval[] = [];
	/** Open burst's latest edit time; null when no burst is open. */
	private openSince: number | null = null;
	private openLastEdit: number | null = null;

	constructor(private readonly silenceMs: number) {}

	/** Returns true when at least one burst is currently open. */
	isOpen(): boolean {
		return this.openSince !== null;
	}

	/** Wall-ms of the most recent edit, or null if no edit happened this burst. */
	lastEditAt(): number | null {
		return this.openLastEdit;
	}

	/**
	 * Record an edit at `editAtMs`. Opens a burst if none is open; otherwise
	 * extends the open burst's last-edit time. If the open burst's silence
	 * window has already expired before this edit, the previous burst is
	 * closed (at its natural end) and a new burst starts here — edits are
	 * grouped into bursts separated by `silenceMs` gaps, not merged across
	 * them. Rejects non-finite or negative deltas silently.
	 */
	recordEdit(editAtMs: number): void {
		if (!Number.isFinite(editAtMs) || editAtMs < 0) {
			return;
		}
		if (
			this.openSince !== null &&
			this.openLastEdit !== null &&
			editAtMs > this.openLastEdit + this.silenceMs
		) {
			// Previous burst's silence window elapsed: close it at its natural
			// end (lastEdit + silence) before opening a new one.
			const naturalEnd = this.openLastEdit + this.silenceMs;
			this.intervals.push({ start: this.openSince, end: naturalEnd });
			this.openSince = null;
			this.openLastEdit = null;
		}
		if (this.openSince === null) {
			this.openSince = editAtMs;
		}
		this.openLastEdit = editAtMs;
	}

	/**
	 * Close the open burst at `closeAtMs` (e.g. session end, idle, target
	 * change). The burst end is the later of last-edit + silenceMs and closeAt,
	 * but never before the burst start, and never after closeAt when a hard
	 * boundary (blur/pause/idle) clips it.
	 *
	 * `hardClip: true` means the close is a hard boundary (blur/idle/pause/end):
	 * the burst ends at `min(lastEdit + silence, closeAt)`. `false` (silence
	 * timeout) lets it end at `lastEdit + silence`.
	 */
	close(closeAtMs: number, hardClip: boolean): void {
		if (this.openSince === null || this.openLastEdit === null) {
			return;
		}
		const naturalEnd = this.openLastEdit + this.silenceMs;
		const end = hardClip ? Math.min(naturalEnd, closeAtMs) : naturalEnd;
		// A burst must cover at least its first edit; guard against clock skew.
		const clampedEnd = Math.max(end, this.openSince);
		this.intervals.push({ start: this.openSince, end: clampedEnd });
		this.openSince = null;
		this.openLastEdit = null;
	}

	/** Close any open burst using a hard clip at `closeAtMs` (shutdown/idle). */
	closeHard(closeAtMs: number): void {
		this.close(closeAtMs, true);
	}

	/**
	 * Total union length of all recorded (closed) bursts plus the open burst's
	 * current extent up to `asOfMs`. Open-burst extent is `lastEdit + silence`,
	 * hard-clipped to `asOfMs` so it never extends past the query instant.
	 */
	totalMs(asOfMs: number): number {
		const all: BurstInterval[] = [...this.intervals];
		if (this.openSince !== null && this.openLastEdit !== null) {
			const naturalEnd = this.openLastEdit + this.silenceMs;
			all.push({
				start: this.openSince,
				end: Math.min(naturalEnd, asOfMs),
			});
		}
		return unionLengthMs(all);
	}

	/** Snapshot the closed intervals for checkpoint recovery. */
	snapshotIntervals(): readonly BurstInterval[] {
		return [...this.intervals];
	}

	/** Restore from a checkpoint snapshot of intervals. */
	restore(intervals: readonly BurstInterval[], openSince: number | null, openLastEdit: number | null): void {
		this.intervals.length = 0;
		for (const iv of intervals) {
			this.intervals.push({ start: iv.start, end: iv.end });
		}
		this.openSince = openSince;
		this.openLastEdit = openLastEdit;
	}
}

/**
 * Length of the union of (possibly overlapping) intervals. Used for both
 * persisted editingMs and the invariant check `editingMs <= activeMs`.
 */
export function unionLengthMs(intervals: readonly BurstInterval[]): number {
	if (intervals.length === 0) {
		return 0;
	}
	const sorted = [...intervals]
		.filter((iv) => Number.isFinite(iv.start) && Number.isFinite(iv.end) && iv.end >= iv.start)
		.sort((a, b) => a.start - b.start);
	let total = 0;
	let cursor = -Infinity;
	for (const iv of sorted) {
		if (iv.end <= cursor) {
			continue; // wholly contained in the running union
		}
		const start = Math.max(iv.start, cursor);
		total += iv.end - start;
		cursor = iv.end;
	}
	return Math.max(0, Math.round(total));
}

/**
 * Clip a set of burst intervals to `[sessionStart, sessionEnd]`. Used when the
 * session closes so persisted editingMs cannot include edits outside the
 * session's active window.
 */
export function clipToIntervals(
	bursts: readonly BurstInterval[],
	clip: BurstInterval,
): BurstInterval[] {
	const out: BurstInterval[] = [];
	for (const b of bursts) {
		const start = Math.max(b.start, clip.start);
		const end = Math.min(b.end, clip.end);
		if (end > start) {
			out.push({ start, end });
		}
	}
	return out;
}
