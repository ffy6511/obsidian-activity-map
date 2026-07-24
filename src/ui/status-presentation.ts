import type { TrackingSnapshot } from '../domain/activity';

export interface StatusPresentation {
	icon: string;
	label: string;
	className: string;
}

export function statusPresentation(
	snapshot: TrackingSnapshot | null,
	filePath: string,
): StatusPresentation {
	if (!snapshot)
		return { icon: 'chart-pie', label: 'Activity Map: starting', className: 'is-untrackable' };
	if (snapshot.state === 'degraded')
		return {
			icon: 'triangle-alert',
			label: `Activity Map: storage problem${snapshot.degradedReason ? ` — ${snapshot.degradedReason}` : ''}`,
			className: 'is-degraded',
		};
	if (snapshot.pendingRecovery.length > 0)
		return {
			icon: 'history',
			label: `Activity Map: ${snapshot.pendingRecovery.length} interval${snapshot.pendingRecovery.length === 1 ? '' : 's'} need review`,
			className: 'is-pending',
		};
	if (snapshot.state === 'paused')
		return { icon: 'pause', label: 'Activity Map: tracking paused', className: 'is-paused' };
	if (snapshot.state === 'idle')
		return {
			icon: 'clock-3',
			label: 'Activity Map: idle, time clipped to last activity',
			className: 'is-idle',
		};
	if (snapshot.state === 'active' && snapshot.currentTarget?.path === filePath)
		return {
			icon: 'circle-dot',
			label: 'Activity Map: tracking this file',
			className: 'is-active',
		};
	return {
		icon: 'chart-pie',
		label: 'Activity Map: this file is not currently tracked',
		className: 'is-untrackable',
	};
}
