import { setIcon } from 'obsidian';

import type { RangeMode } from '../../query/date-range';
import type { MetricKey } from '../../query/path-projection';

export interface RangeControlAction {
	icon: string;
	label: string;
	id: string;
	pressed?: boolean;
	disabled?: boolean;
	onActivate(): void;
}

/**
 * An icon button with a resting `icon` and an `activeIcon` that its owner can
 * cross-fade between. Used by locate so `locate-fixed` stays visible for the
 * same transient interval as the chart and legend highlight.
 */
export interface LeadingQueryAction extends RangeControlAction {
	/** Icon shown while the action's owner applies its active presentation state. */
	activeIcon?: string;
}

export interface RangeControlsHandle {
	/** Updates an existing action without replacing its focused DOM node. */
	updateAction(action: RangeControlAction): boolean;
	/** Removes owner-document listeners installed by the custom query listboxes. */
	destroy(): void;
}

interface DropdownOption<T extends string> {
	value: T;
	label: string;
}

interface DropdownHandle {
	destroy(): void;
}

type RangeChoice = 'day' | 'average-7' | 'average-30' | 'average-90' | 'average-all' | 'all';

const METRIC_OPTIONS: readonly DropdownOption<MetricKey>[] = [
	{ value: 'activeMs', label: 'Activity' },
	{ value: 'editingMs', label: 'Editing' },
	{ value: 'typedChars', label: 'Chars' },
	{ value: 'openCount', label: 'Opens' },
];

const RANGE_OPTIONS: readonly DropdownOption<RangeChoice>[] = [
	{ value: 'day', label: '1 day' },
	{ value: 'average-7', label: '7d Avg' },
	{ value: 'average-30', label: '30d Avg' },
	{ value: 'average-90', label: '90d Avg' },
	{ value: 'average-all', label: 'All Avg' },
	{ value: 'all', label: 'All history' },
];

let nextDropdownId = 0;

export function renderRangeControls(args: {
	container: HTMLElement;
	metric: MetricKey;
	range: RangeMode;
	onMetric: (metric: MetricKey) => void;
	onRange: (range: RangeMode) => void;
	leadingActions?: readonly RangeControlAction[];
	/** Action rendered immediately left of the metric dropdown, inside the query area. */
	leadingQueryAction?: LeadingQueryAction;
	renderIcon?: (container: HTMLElement, icon: string) => void;
}): RangeControlsHandle {
	const controls = args.container.createDiv({ cls: 'activity-map-controls' });
	const actionButtons = new Map<string, HTMLButtonElement>();
	const dropdowns: DropdownHandle[] = [];
	const renderIcon = args.renderIcon ?? setIcon;

	if (args.leadingActions?.length) {
		const actionGroup = controls.createDiv({
			cls: 'activity-map-control-actions activity-map-control-leading',
		});
		for (const action of args.leadingActions) {
			const button = iconButton(
				actionGroup,
				action.icon,
				action.label,
				action.id,
				() => action.onActivate(),
				'',
				action.pressed,
				renderIcon,
			);
			button.disabled = action.disabled === true;
			actionButtons.set(action.id, button);
		}
	}

	if (args.range.mode === 'day') {
		const dayNavigation = controls.createDiv({ cls: 'activity-map-day-navigation' });
		iconButton(
			dayNavigation,
			'chevron-left',
			'Previous day',
			'previous-day',
			() => {
				args.onRange({
					mode: 'day',
					localDate: shiftLocalDate(
						args.range.mode === 'day' ? args.range.localDate : '',
						-1,
					),
				});
			},
			'',
			undefined,
			renderIcon,
		);
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
			cls: 'clickable-icon activity-map-control-button activity-map-date-button',
			attr: {
				'aria-label': `Choose date, ${args.range.localDate}`,
				'data-activity-map-id': 'calendar-day',
			},
		});
		dateButton.addEventListener('click', () => {
			try {
				date.showPicker();
			} catch {
				date.focus();
				date.click();
			}
		});
		iconButton(
			dayNavigation,
			'chevron-right',
			'Next day',
			'next-day',
			() => {
				args.onRange({
					mode: 'day',
					localDate: shiftLocalDate(
						args.range.mode === 'day' ? args.range.localDate : '',
						1,
					),
				});
			},
			'',
			undefined,
			renderIcon,
		);
	}

	const queryControls = controls.createDiv({ cls: 'activity-map-query-controls' });
	if (args.leadingQueryAction) {
		const action = args.leadingQueryAction;
		// When an activeIcon is set, render the button empty and stack the two
		// glyphs ourselves so its owner can cross-fade them with a state class.
		// Otherwise fall back to the shared single-icon button.
		const button = iconButton(
			queryControls,
			'',
			action.label,
			action.id,
			() => action.onActivate(),
			'',
			action.pressed,
			// Empty container; icons are stacked below.
			() => {},
		);
		if (action.activeIcon) {
			const stack = button.createDiv({
				cls: 'activity-map-control-icon',
				attr: { 'aria-hidden': 'true', 'data-activity-map-icon-stack': '' },
			});
			const rest = stack.createSpan({ cls: 'activity-map-locate-icon' });
			const pressed = stack.createSpan({ cls: 'activity-map-locate-icon-fixed' });
			renderIcon(rest, action.icon);
			renderIcon(pressed, action.activeIcon);
		} else {
			renderIcon(button, action.icon);
		}
		button.disabled = action.disabled === true;
		actionButtons.set(action.id, button);
	}
	const metricControl = queryControls.createDiv({ cls: 'activity-map-metric-control' });
	dropdowns.push(
		renderDropdownControl({
			container: metricControl,
			id: 'metric',
			label: 'Metric',
			selected: args.metric,
			options: METRIC_OPTIONS,
			icon: iconForMetric(args.metric),
			iconOnly: true,
			onSelect: args.onMetric,
			renderIcon,
		}),
	);

	dropdowns.push(
		renderDropdownControl({
			container: queryControls,
			id: 'date-range',
			label: 'Date range',
			selected: rangeValue(args.range),
			options: RANGE_OPTIONS,
			onSelect: (value) => args.onRange(rangeForValue(value, args.range)),
			renderIcon,
		}),
	);

	return {
		updateAction(action) {
			const button = actionButtons.get(action.id);
			if (!button) return false;
			// An active-icon action owns a stable two-glyph stack. Loading retention
			// updates only its accessible state; re-rendering through setIcon would
			// empty the button and collapse the transition back to one glyph.
			if (!button.querySelector('[data-activity-map-icon-stack]')) {
				renderIcon(button, action.icon);
			}
			button.setAttribute('aria-label', action.label);
			button.disabled = action.disabled === true;
			if (action.pressed === undefined) button.removeAttribute('aria-pressed');
			else button.setAttribute('aria-pressed', String(action.pressed));
			return true;
		},
		destroy() {
			for (const dropdown of dropdowns) dropdown.destroy();
		},
	};
}

function renderDropdownControl<T extends string>(args: {
	container: HTMLElement;
	id: string;
	label: string;
	selected: T;
	options: readonly DropdownOption<T>[];
	icon?: string;
	iconOnly?: boolean;
	onSelect(value: T): void;
	renderIcon: (container: HTMLElement, icon: string) => void;
}): DropdownHandle {
	const selectedIndex = Math.max(
		0,
		args.options.findIndex((option) => option.value === args.selected),
	);
	const selected = args.options[selectedIndex];
	if (!selected) throw new Error('Dropdown controls require at least one option.');
	const dropdown = args.container.createDiv({ cls: 'activity-map-dropdown' });
	const listboxId = `activity-map-listbox-${String(++nextDropdownId)}`;
	const trigger = dropdown.createEl('button', {
		cls: `clickable-icon activity-map-control-button activity-map-query-button ${args.iconOnly ? 'activity-map-icon-button' : ''}`.trim(),
		attr: {
			'aria-label': `${args.label}: ${selected.label}`,
			'aria-controls': listboxId,
			'aria-expanded': 'false',
			'aria-haspopup': 'listbox',
			'data-activity-map-id': args.id,
			title: `${args.label}: ${selected.label}`,
			type: 'button',
		},
	});
	if (args.icon) {
		const icon = trigger.createSpan({
			cls: 'activity-map-control-icon',
			attr: { 'aria-hidden': 'true' },
		});
		args.renderIcon(icon, args.icon);
	}
	if (!args.iconOnly)
		trigger.createSpan({ cls: 'activity-map-query-button-label', text: selected.label });

	const listbox = dropdown.createDiv({
		cls: 'activity-map-dropdown-menu',
		attr: { id: listboxId, role: 'listbox', 'aria-label': args.label },
	});
	listbox.hidden = true;
	const optionButtons = args.options.map((option, index) => {
		const button = listbox.createEl('button', {
			cls: 'activity-map-dropdown-option',
			text: option.label,
			attr: {
				'aria-selected': String(index === selectedIndex),
				'data-activity-map-option': option.value,
				role: 'option',
				type: 'button',
			},
		});
		button.addEventListener('click', () => select(index));
		return button;
	});

	function setOpen(open: boolean, focusIndex?: number): void {
		listbox.hidden = !open;
		trigger.setAttribute('aria-expanded', String(open));
		if (open && focusIndex !== undefined) optionButtons[focusIndex]?.focus();
	}

	function select(index: number): void {
		const option = args.options[index];
		if (!option) return;
		setOpen(false);
		trigger.focus();
		args.onSelect(option.value);
	}

	trigger.addEventListener('click', () => setOpen(listbox.hidden));
	trigger.addEventListener('keydown', (event) => {
		if (event.key === 'ArrowDown') {
			event.preventDefault();
			setOpen(true, Math.min(selectedIndex + 1, optionButtons.length - 1));
		} else if (event.key === 'ArrowUp') {
			event.preventDefault();
			setOpen(true, Math.max(selectedIndex - 1, 0));
		} else if (event.key === 'Home') {
			event.preventDefault();
			setOpen(true, 0);
		} else if (event.key === 'End') {
			event.preventDefault();
			setOpen(true, optionButtons.length - 1);
		} else if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault();
			setOpen(listbox.hidden, listbox.hidden ? selectedIndex : undefined);
		} else if (event.key === 'Escape') {
			setOpen(false);
		}
	});

	listbox.addEventListener('keydown', (event) => {
		const index = optionButtons.indexOf(event.target as HTMLButtonElement);
		if (index < 0) return;
		if (event.key === 'ArrowDown') {
			event.preventDefault();
			optionButtons[Math.min(index + 1, optionButtons.length - 1)]?.focus();
		} else if (event.key === 'ArrowUp') {
			event.preventDefault();
			optionButtons[Math.max(index - 1, 0)]?.focus();
		} else if (event.key === 'Home') {
			event.preventDefault();
			optionButtons[0]?.focus();
		} else if (event.key === 'End') {
			event.preventDefault();
			optionButtons[optionButtons.length - 1]?.focus();
		} else if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault();
			select(index);
		} else if (event.key === 'Escape') {
			event.preventDefault();
			setOpen(false);
			trigger.focus();
		}
	});

	dropdown.addEventListener('focusout', (event) => {
		const nextTarget = event.relatedTarget as Node | null;
		if (!nextTarget || !dropdown.contains(nextTarget)) setOpen(false);
	});
	const document = dropdown.ownerDocument;
	const closeOnOutsidePointerDown = (event: PointerEvent) => {
		const target = event.target as Node | null;
		if (!target || !dropdown.contains(target)) setOpen(false);
	};
	document.addEventListener('pointerdown', closeOnOutsidePointerDown, true);
	return {
		destroy: () => document.removeEventListener('pointerdown', closeOnOutsidePointerDown, true),
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
		cls: `clickable-icon activity-map-control-button activity-map-icon-button ${extraClass}`.trim(),
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

function rangeValue(range: RangeMode): RangeChoice {
	if (range.mode === 'day' || range.mode === 'all') return range.mode;
	return `average-${String(range.days)}` as RangeChoice;
}

function rangeForValue(value: RangeChoice, currentRange: RangeMode): RangeMode {
	const today = new Date().toISOString().slice(0, 10);
	if (value === 'day')
		return {
			mode: 'day',
			localDate: currentRange.mode === 'day' ? currentRange.localDate : today,
		};
	if (value === 'all') return { mode: 'all' };
	return {
		mode: 'average',
		days: value === 'average-all' ? 'all' : (Number(value.slice(8)) as 7 | 30 | 90),
		today,
	};
}

export function shiftLocalDate(localDate: string, days: number): string {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(localDate);
	if (!match) return localDate;
	const date = new Date(
		Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days),
	);
	return date.toISOString().slice(0, 10);
}
