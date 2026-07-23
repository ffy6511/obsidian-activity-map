import type { MetricKey } from '../query/path-projection';

export function formatMetric(value: number, metric: MetricKey, denominatorDays: number | null = null): string {
	const normalized = denominatorDays && denominatorDays > 0 ? value / denominatorDays : value;
	if (metric === 'openCount') return `${formatCompactCount(normalized, denominatorDays !== null)} opens`;
	if (metric === 'typedChars') return `${formatCompactCount(normalized, denominatorDays !== null)} chars`;
	return formatDuration(normalized);
}

/** Full numeric text for accessible names and other space-unconstrained surfaces. */
export function formatMetricFull(value: number, metric: MetricKey, denominatorDays: number | null = null): string {
	const normalized = denominatorDays && denominatorDays > 0 ? value / denominatorDays : value;
	if (metric === 'openCount') return `${normalized.toFixed(denominatorDays ? 1 : 0)} opens`;
	if (metric === 'typedChars') return `${normalized.toFixed(denominatorDays ? 1 : 0)} chars`;
	return formatDuration(normalized);
}

function formatDuration(normalized: number): string {
	const seconds = Math.round(normalized / 1000);
	const hours = Math.floor(seconds / 3600);
	const minutes = Math.floor((seconds % 3600) / 60);
	const remainder = seconds % 60;
	if (hours > 0) return `${hours}h ${minutes}m`;
	if (minutes > 0) return `${minutes}m ${remainder}s`;
	return `${remainder}s`;
}

function formatCompactCount(value: number, keepOneDecimalBelowThousand: boolean): string {
	if (!Number.isFinite(value)) return '—';
	const sign = value < 0 ? '-' : '';
	let scaled = Math.abs(value);
	if (scaled < 1_000) return `${sign}${scaled.toFixed(keepOneDecimalBelowThousand ? 1 : 0)}`;

	const units = ['k', 'M', 'B'] as const;
	let unitIndex = -1;
	while (scaled >= 1_000 && unitIndex < units.length - 1) {
		scaled /= 1_000;
		unitIndex += 1;
	}
	let digits = scaled < 100 ? 2 : 0;
	// Rounding 999.9k to 1000k is less readable than its next compact unit.
	if (scaled >= 1_000 - 0.5 * 10 ** -digits && unitIndex < units.length - 1) {
		scaled /= 1_000;
		unitIndex += 1;
		digits = scaled < 100 ? 2 : 0;
	}
	return `${sign}${trimTrailingZeros(scaled.toFixed(digits))}${units[unitIndex]}`;
}

function trimTrailingZeros(value: string): string {
	return value.includes('.') ? value.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1') : value;
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
