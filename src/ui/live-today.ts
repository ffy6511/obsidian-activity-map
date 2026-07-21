import type { TrackingSnapshot } from '../domain/activity';
import { startOfLocalDayMs } from '../platform/clock';

/** Current unclosed activity clipped to today's local boundary. */
export function liveTodayMs(snapshot: TrackingSnapshot | null, filePath?: string): number {
	if (
		snapshot?.state !== 'active' ||
		!snapshot.currentTarget ||
		!snapshot.sessionStartedAt ||
		(filePath !== undefined && snapshot.currentTarget.path !== filePath)
	) {
		return 0;
	}
	const sampledAt = Date.parse(snapshot.sampledAt);
	const startedAt = Date.parse(snapshot.sessionStartedAt);
	if (!Number.isFinite(sampledAt) || !Number.isFinite(startedAt)) return 0;
	const dayStart = startOfLocalDayMs(sampledAt, Intl.DateTimeFormat().resolvedOptions().timeZone);
	return Math.max(0, sampledAt - Math.max(startedAt, dayStart));
}
