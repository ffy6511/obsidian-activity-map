import { setIcon } from 'obsidian';

import type { RangeMode } from '../../query/date-range';
import type { MetricKey } from '../../query/path-projection';

export interface RangeTrailingAction {
	icon: string;
	label: string;
	id: string;
	pressed?: boolean;
	onActivate(): void;
}

export interface RangeControlsHandle {
	/** Updates an existing action without replacing its focused DOM node. */
	updateTrailingAction(action: RangeTrailingAction): boolean;
}

export function renderRangeControls(args: {
	container: HTMLElement;
	metric: MetricKey;
	range: RangeMode;
	onMetric: (metric: MetricKey) => void;
	onRange: (range: RangeMode) => void;
	trailingActions?: readonly RangeTrailingAction[];
	renderIcon?: (container: HTMLElement, icon: string) => void;
}): RangeControlsHandle {
	const controls = args.container.createDiv({ cls: 'activity-map-controls' });
	const actionButtons = new Map<string, HTMLButtonElement>();
	const renderIcon = args.renderIcon ?? setIcon;
	const metricControl = controls.createDiv({ cls: 'activity-map-metric-control' });
	const metricIcon = metricControl.createSpan({ cls: 'activity-map-control-icon', attr: { 'aria-hidden': 'true' } });
	renderIcon(metricIcon, iconForMetric(args.metric));
	const metric = metricControl.createEl('select', { attr: { 'aria-label': 'Metric', 'data-activity-map-id': 'metric' } });
	for (const [value, label] of [['activeMs', 'Activity'], ['editingMs', 'Editing'], ['typedChars', 'Typed chars'], ['openCount', 'Open count']] as const) {
		metric.createEl('option', { value, text: label });
	}
	metric.value = args.metric;
	metric.addEventListener('change', () => {
		const selected = metric.value as MetricKey;
		renderIcon(metricIcon, iconForMetric(selected));
		args.onMetric(selected);
	});

	const mode = controls.createEl('select', { cls: 'activity-map-range-mode', attr: { 'aria-label': 'Date range', 'data-activity-map-id': 'date-range' } });
	for (const [value, label] of [['day', 'One Day'], ['average-7', '7-day average'], ['average-30', '30-day average'], ['average-90', '90-day average'], ['average-all', 'All-history average'], ['all', 'All history']] as const) {
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
		const dayNavigation = controls.createDiv({ cls: 'activity-map-day-navigation' });
		iconButton(dayNavigation, 'chevron-left', 'Previous day', 'previous-day', () => {
			args.onRange({ mode: 'day', localDate: shiftLocalDate(args.range.mode === 'day' ? args.range.localDate : '', -1) });
		});
		const date = dayNavigation.createEl('input', {
			type: 'date',
			cls: 'activity-map-hidden-date',
			attr: { 'aria-label': 'Selected date', 'data-activity-map-id': 'selected-date' },
		});
		date.value = args.range.localDate;
		date.tabIndex = -1;
		date.addEventListener('change', () => {
			if (date.value) args.onRange({ mode: 'day', localDate: date.value });
		});
		const dateButton = dayNavigation.createEl('button', {
			text: args.range.localDate,
			cls: 'clickable-icon activity-map-date-button',
			attr: { 'aria-label': `Choose date, ${args.range.localDate}`, 'data-activity-map-id': 'calendar-day' },
		});
		dateButton.addEventListener('click', () => {
			try {
				date.showPicker();
			} catch {
				date.focus();
				date.click();
			}
		});
		iconButton(dayNavigation, 'chevron-right', 'Next day', 'next-day', () => {
			args.onRange({ mode: 'day', localDate: shiftLocalDate(args.range.mode === 'day' ? args.range.localDate : '', 1) });
		});
	}

	if (args.trailingActions?.length) {
		const actionGroup = controls.createDiv({ cls: 'activity-map-control-actions activity-map-control-trailing' });
		for (const action of args.trailingActions) {
			actionButtons.set(action.id, iconButton(actionGroup, action.icon, action.label, action.id, () => action.onActivate(), '', action.pressed, renderIcon));
		}
	}
	return {
		updateTrailingAction(action) {
			const button = actionButtons.get(action.id);
			if (!button) return false;
			renderIcon(button, action.icon);
			button.setAttribute('aria-label', action.label);
			if (action.pressed === undefined) button.removeAttribute('aria-pressed');
			else button.setAttribute('aria-pressed', String(action.pressed));
			return true;
		},
	};
}

function iconButton(
	container: HTMLElement,
	icon: string,
	label: string,
	id: string,
	onActivate: () => void,
	extraClass = '',
	pressed?: boolean,
	renderIcon: (container: HTMLElement, icon: string) => void = setIcon,
): HTMLButtonElement {
	const button = container.createEl('button', {
		cls: `clickable-icon activity-map-icon-button ${extraClass}`.trim(),
		attr: {
			'aria-label': label,
			'data-activity-map-id': id,
			...(pressed === undefined ? {} : { 'aria-pressed': String(pressed) }),
		},
	});
	renderIcon(button, icon);
	button.addEventListener('click', onActivate);
	return button;
}

function iconForMetric(metric: MetricKey): string {
	if (metric === 'editingMs') return 'pencil';
	if (metric === 'typedChars') return 'keyboard';
	if (metric === 'openCount') return 'folder-open';
	return 'clock-3';
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
