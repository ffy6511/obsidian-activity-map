import type { MetricKey } from '../query/path-projection';

export function formatMetric(value: number, metric: MetricKey, denominatorDays: number | null = null): string {
	const normalized = denominatorDays && denominatorDays > 0 ? value / denominatorDays : value;
	if (metric === 'openCount') return `${normalized.toFixed(denominatorDays ? 1 : 0)} opens`;
	if (metric === 'typedChars') return `${normalized.toFixed(denominatorDays ? 1 : 0)} chars`;
	const seconds = Math.round(normalized / 1000);
	const hours = Math.floor(seconds / 3600);
	const minutes = Math.floor((seconds % 3600) / 60);
	const remainder = seconds % 60;
	if (hours > 0) return `${hours}h ${minutes}m`;
	if (minutes > 0) return `${minutes}m ${remainder}s`;
	return `${remainder}s`;
}

export function formatPercent(value: number): string {
	return `${(value * 100).toFixed(value > 0 && value < 0.01 ? 1 : 0)}%`;
}

export function metricLabel(metric: MetricKey): string {
	return metric === 'activeMs'
		? 'Activity'
		: metric === 'editingMs'
			? 'Editing'
			: metric === 'typedChars'
				? 'Typed chars'
				: 'Open count';
}
