/**
 * Heartbeat monitor.
 *
 * Browser timers are throttled when a tab or window is hidden or the machine
 * sleeps. A delayed callback that fires long after its scheduled time must not
 * turn the sleep gap into attributed work. The monitor compares the actual
 * monotonic gap between scheduled heartbeats against the expected interval; a
 * large positive drift signals sleep-like conditions.
 *
 * The monitor only *detects* the gap and reports it. The engine closes the
 * session at the last trusted activity sample and auto-excludes the gap. This
 * keeps "settled time" authoritative and prevents timer jitter from inflating
 * metrics.
 */

import type { ClockSample } from '../platform/clock';
import { monotonicDelta } from '../platform/clock';

/** Outcome of comparing an actual heartbeat interval against the schedule. */
export type HeartbeatVerdict =
	| { kind: 'normal' }
	| { kind: 'drift'; expectedMs: number; actualMs: number; sleepLike: boolean };

export interface HeartbeatMonitorOptions {
	/** Expected scheduler interval (ms). */
	expectedIntervalMs: number;
	/** Idle threshold from settings (ms); a drift beyond this is sleep-like. */
	idleThresholdMs: number;
	/** Multiplier over the expected interval that still counts as jitter, not sleep. */
	jitterTolerance: number;
}

/**
 * Stateless heartbeat detector. The host holds the previous sample; the monitor
 * classifies the gap between two samples.
 */
export class HeartbeatMonitor {
	constructor(private readonly options: HeartbeatMonitorOptions) {}

	/** Classify the gap between two consecutive heartbeat samples. */
	classify(previous: ClockSample, current: ClockSample): HeartbeatVerdict {
		const actual = monotonicDelta(previous, current);
		if (!Number.isFinite(actual) || actual <= 0) {
			return { kind: 'normal' };
		}
		const jitterLimit = this.options.expectedIntervalMs * this.options.jitterTolerance;
		if (actual <= jitterLimit) {
			return { kind: 'normal' };
		}
		const sleepLike = actual > this.options.idleThresholdMs;
		return {
			kind: 'drift',
			expectedMs: this.options.expectedIntervalMs,
			actualMs: actual,
			sleepLike,
		};
	}
}
