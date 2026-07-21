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
	const metric = controls.createEl('select', { attr: { 'aria-label': 'Metric', 'data-activity-map-id': 'metric' } });
	for (const [value, label] of [['activeMs', 'Activity'], ['editingMs', 'Editing'], ['openCount', 'Open count']] as const) {
		metric.createEl('option', { value, text: label });
	}
	metric.value = args.metric;
	metric.addEventListener('change', () => args.onMetric(metric.value as MetricKey));

	const mode = controls.createEl('select', { attr: { 'aria-label': 'Date range', 'data-activity-map-id': 'date-range' } });
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
		const previous = controls.createEl('button', { text: '‹', attr: { 'aria-label': 'Previous day', 'data-activity-map-id': 'previous-day' } });
		previous.addEventListener('click', () => args.onRange({ mode: 'day', localDate: shiftLocalDate(args.range.mode === 'day' ? args.range.localDate : '', -1) }));
		const date = controls.createEl('input', { type: 'date', attr: { 'aria-label': 'Selected date', 'data-activity-map-id': 'selected-date' } });
		date.value = args.range.localDate;
		date.addEventListener('change', () => {
			if (date.value) args.onRange({ mode: 'day', localDate: date.value });
		});
		const next = controls.createEl('button', { text: '›', attr: { 'aria-label': 'Next day', 'data-activity-map-id': 'next-day' } });
		next.addEventListener('click', () => args.onRange({ mode: 'day', localDate: shiftLocalDate(args.range.mode === 'day' ? args.range.localDate : '', 1) }));
	}
}

function rangeValue(range: RangeMode): string {
	if (range.mode === 'day' || range.mode === 'all') return range.mode;
	return `average-${String(range.days)}`;
}

export function shiftLocalDate(localDate: string, days: number): string {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(localDate);
	if (!match) return localDate;
	const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days));
	return date.toISOString().slice(0, 10);
}
