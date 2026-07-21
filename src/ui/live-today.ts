import type { TrackingSnapshot } from '../domain/activity';
import { startOfLocalDayMs } from '../platform/clock';

export interface LiveTodayOptions {
	filePath?: string;
	nowMs?: number;
	idleThresholdMs?: number;
	timeZone?: string;
}

/**
 * Current unclosed activity clipped to today's local boundary and the last
 * trusted interaction plus the idle threshold. UI timers may advance `nowMs`
 * between runtime snapshots, but can never turn an unattended interval into
 * activity.
 */
export function liveTodayMs(snapshot: TrackingSnapshot | null, options: LiveTodayOptions = {}): number {
	if (
		snapshot?.state !== 'active' ||
		!snapshot.currentTarget ||
		!snapshot.sessionStartedAt ||
		(options.filePath !== undefined && snapshot.currentTarget.path !== options.filePath)
	) {
		return 0;
	}
	const sampledAt = Date.parse(snapshot.sampledAt);
	const startedAt = Date.parse(snapshot.sessionStartedAt);
	const trustedAt = Date.parse(snapshot.lastTrustedActivityAt ?? snapshot.sampledAt);
	if (!Number.isFinite(sampledAt) || !Number.isFinite(startedAt) || !Number.isFinite(trustedAt)) return 0;
	const requestedNow = Number.isFinite(options.nowMs) ? options.nowMs as number : sampledAt;
	const idleBoundary = Number.isFinite(options.idleThresholdMs)
		? trustedAt + Math.max(0, options.idleThresholdMs as number)
		: requestedNow;
	const endpoint = Math.min(Math.max(sampledAt, requestedNow), idleBoundary);
	const timeZone = options.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
	const dayStart = startOfLocalDayMs(endpoint, timeZone);
	return Math.max(0, endpoint - Math.max(startedAt, dayStart));
}
