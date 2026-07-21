import type { RangeMode } from '../../query/date-range';
import type { MetricKey } from '../../query/path-projection';

export function renderRangeControls(args: {
	container: HTMLElement;
	metric: MetricKey;
	range: RangeMode;
	onMetric: (metric: MetricKey) => void;
	onRange: (range: RangeMode) => void;
}): void {
	const controls = args.container.createDiv({ cls: 'activity-map-controls' });
	const metric = controls.createEl('select', { attr: { 'aria-label': 'Metric' } });
	for (const [value, label] of [['activeMs', 'Activity'], ['editingMs', 'Editing'], ['openCount', 'Open count']] as const) {
		metric.createEl('option', { value, text: label });
	}
	metric.value = args.metric;
	metric.addEventListener('change', () => args.onMetric(metric.value as MetricKey));

	const mode = controls.createEl('select', { attr: { 'aria-label': 'Date range' } });
	for (const [value, label] of [['day', 'Selected day'], ['average-7', '7-day average'], ['average-30', '30-day average'], ['average-90', '90-day average'], ['average-all', 'All-history average'], ['all', 'All history']] as const) {
		mode.createEl('option', { value, text: label });
	}
	mode.value = rangeValue(args.range);
	mode.addEventListener('change', () => {
		const today = new Date().toISOString().slice(0, 10);
		if (mode.value === 'day') args.onRange({ mode: 'day', localDate: args.range.mode === 'day' ? args.range.localDate : today });
		else if (mode.value === 'all') args.onRange({ mode: 'all' });
		else args.onRange({ mode: 'average', days: mode.value === 'average-all' ? 'all' : Number(mode.value.slice(8)) as 7 | 30 | 90, today });
	});
	if (args.range.mode === 'day') {
		const date = controls.createEl('input', { type: 'date', attr: { 'aria-label': 'Selected date' } });
		date.value = args.range.localDate;
		date.addEventListener('change', () => {
			if (date.value) args.onRange({ mode: 'day', localDate: date.value });
		});
	}
}

function rangeValue(range: RangeMode): string {
	if (range.mode === 'day' || range.mode === 'all') return range.mode;
	return `average-${String(range.days)}`;
}
