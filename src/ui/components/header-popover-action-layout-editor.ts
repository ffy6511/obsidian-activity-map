import { setIcon } from 'obsidian';

import {
	headerPopoverActionDefinition,
	moveHeaderPopoverAction,
	normalizeHeaderPopoverActionLayout,
	projectHeaderPopoverActionLayout,
	type HeaderPopoverActionId,
	type HeaderPopoverActionLayoutItem,
	type HeaderPopoverLayoutDestination,
} from '../../domain/header-popover-action-layout';

export interface HeaderPopoverActionLayoutEditorHandle {
	setLayout(layout: readonly HeaderPopoverActionLayoutItem[]): void;
	setDisabled(disabled: boolean): void;
	destroy(): void;
}

export interface HeaderPopoverActionLayoutEditorOptions {
	container: HTMLElement;
	layout: readonly HeaderPopoverActionLayoutItem[];
	onChange(layout: HeaderPopoverActionLayoutItem[]): void;
	/** The Settings preview is intentionally inert; callers own persistence. */
	renderIcon?: (container: HTMLElement, icon: string) => void;
	selectedDate?: string;
	/** Render the recovery controls outside the row, for the Popover edit footer. */
	footerContainer?: HTMLElement;
	/** The direct Popover editor shares the row chrome instead of the Settings card. */
	presentation?: 'settings' | 'popover';
	/** Non-day Popover ranges have no fixed previous/date/next control. */
	showFixedNavigation?: boolean;
}

interface ActionVisual {
	readonly icon: string;
	readonly label: string;
	readonly text?: string;
}

const ACTION_VISUALS: Record<HeaderPopoverActionId, ActionVisual> = {
	'tracking-toggle': { icon: 'pause', label: 'Pause activity tracking' },
	'distribution-grouping-toggle': { icon: 'files', label: 'Show all files' },
	'poster-export': { icon: 'image-down', label: 'Export activity poster' },
	'locate-current-file': { icon: 'locate', label: 'Locate current file' },
	metric: { icon: 'clock-3', label: 'Metric: Activity' },
	'date-range': { icon: 'calendar-range', label: 'Date range: 1 day', text: '1 day' },
};

/**
 * Inert, shared layout editor for Settings and the Header Popover's future
 * direct-manipulation mode. It owns only a volatile draft; callers decide
 * whether and when a changed layout becomes durable.
 */
export function renderHeaderPopoverActionLayoutEditor(
	args: HeaderPopoverActionLayoutEditorOptions,
): HeaderPopoverActionLayoutEditorHandle {
	const presentation = args.presentation ?? 'settings';
	const root = args.container.createDiv({
		cls: `activity-map-action-layout-editor activity-map-action-layout-editor-${presentation}`,
	});
	const content = root.createDiv({ cls: 'activity-map-action-layout-editor-content' });
	const liveRegion = root.createDiv({
		cls: 'activity-map-action-layout-live-region',
		attr: { 'aria-live': 'polite', 'aria-atomic': 'true' },
	});
	const renderIcon = args.renderIcon ?? setIcon;
	const document = root.ownerDocument;
	let layout = normalizeHeaderPopoverActionLayout(args.layout);
	let disabled = false;
	let pointerAction: HeaderPopoverActionId | null = null;
	let keyboardAction: HeaderPopoverActionId | null = null;

	const clearPointer = () => {
		pointerAction = null;
		root.removeClass('is-action-layout-pointer-dragging');
		for (const target of Array.from(root.querySelectorAll('.is-action-layout-drop-target')))
			target.removeClass('is-action-layout-drop-target');
		document.removeEventListener('pointermove', onPointerMove, true);
		document.removeEventListener('pointerup', onPointerUp, true);
		document.removeEventListener('pointercancel', clearPointer, true);
	};

	const applyMove = (
		id: HeaderPopoverActionId,
		destination: HeaderPopoverLayoutDestination,
		source: 'pointer' | 'keyboard',
	): void => {
		const result = moveHeaderPopoverAction(layout, id, destination);
		if (result.kind === 'rejected') {
			announce(rejectionMessage(id, result.reason));
			return;
		}
		layout = result.layout;
		args.onChange(layout);
		render();
		announce(moveMessage(id, destination));
		if (source === 'keyboard') focusAction(id);
	};

	const onPointerMove = (event: PointerEvent): void => {
		const destination = destinationForEvent(event);
		for (const target of Array.from(root.querySelectorAll('.is-action-layout-drop-target')))
			target.removeClass('is-action-layout-drop-target');
		if (!destination) return;
		const target = targetForEvent(event);
		target?.addClass('is-action-layout-drop-target');
	};

	const onPointerUp = (event: PointerEvent): void => {
		const action = pointerAction;
		const destination = destinationForEvent(event);
		clearPointer();
		if (action && destination) applyMove(action, destination, 'pointer');
	};

	function render(): void {
		content.empty();
		args.footerContainer?.empty();
		root.toggleClass('is-action-layout-disabled', disabled);
		const projection = projectHeaderPopoverActionLayout(layout);
		const row = content.createDiv({ cls: 'activity-map-action-layout-row' });
		renderSide(row, 'left', projection.left);
		if (args.showFixedNavigation !== false) renderFixedNavigation(row);
		renderSide(row, 'right', projection.right);

		const disabledArea = (args.footerContainer ?? content).createDiv({
			cls: 'activity-map-action-layout-disabled-area',
			attr: {
				'data-header-popover-layout-destination': 'disabled',
				'aria-label': 'Disabled Header Popover controls',
			},
		});
		disabledArea.createSpan({
			cls: 'activity-map-action-layout-disabled-label',
			text: 'Disabled',
		});
		const disabledItems = disabledArea.createDiv({
			cls: 'activity-map-action-layout-disabled-items',
		});
		if (projection.disabled.length === 0) {
			disabledItems.createSpan({
				cls: 'activity-map-action-layout-empty',
				text: 'Drop a control here to disable it',
			});
		} else {
			for (const item of projection.disabled) renderAction(disabledItems, item, undefined);
		}
	}

	function renderSide(
		row: HTMLElement,
		side: 'left' | 'right',
		items: readonly HeaderPopoverActionLayoutItem[],
	): void {
		const region = row.createDiv({
			cls: `activity-map-action-layout-side activity-map-action-layout-side-${side}`,
			attr: {
				'data-header-popover-layout-destination': 'side',
				'data-header-popover-layout-side': side,
				'data-header-popover-layout-index': String(items.length),
			},
		});
		if (items.length === 0) {
			region.addClass('is-action-layout-empty-side');
			region.createSpan({
				cls: 'activity-map-action-layout-empty',
				text: `Drop ${side} controls here`,
			});
			return;
		}
		for (const [index, item] of items.entries()) renderAction(region, item, index);
	}

	function renderFixedNavigation(row: HTMLElement): void {
		const navigation = row.createDiv({
			cls: 'activity-map-action-layout-fixed-navigation',
			attr: {
				'aria-label': 'Fixed selected-day navigation',
				'data-header-popover-layout-fixed': 'day-navigation',
			},
		});
		fixedButton(navigation, 'chevron-left', 'Previous day');
		navigation.createEl('button', {
			text: args.selectedDate ?? new Date().toISOString().slice(0, 10),
			cls: 'activity-map-action-layout-date-button',
			attr: { type: 'button', disabled: 'true', 'aria-label': 'Selected date' },
		});
		fixedButton(navigation, 'chevron-right', 'Next day');
	}

	function fixedButton(parent: HTMLElement, icon: string, label: string): void {
		const button = parent.createEl('button', {
			cls: 'activity-map-action-layout-fixed-button',
			attr: { type: 'button', disabled: 'true', 'aria-label': label },
		});
		renderIcon(button, icon);
	}

	function renderAction(
		parent: HTMLElement,
		item: HeaderPopoverActionLayoutItem,
		index: number | undefined,
	): void {
		const visual = ACTION_VISUALS[item.id];
		const side = headerPopoverActionDefinition(item.id).side;
		const button = parent.createEl('button', {
			cls: 'activity-map-action-layout-control clickable-icon',
			attr: {
				type: 'button',
				'aria-label': `${visual.label}. Press Space to move this control.`,
				'data-header-popover-layout-action': item.id,
				'data-header-popover-layout-side': side,
				...(index === undefined
					? {}
					: { 'data-header-popover-layout-index': String(index) }),
			},
		});
		button.disabled = disabled;
		if (visual.text) button.createSpan({ text: visual.text });
		else renderIcon(button, visual.icon);
		button.addEventListener('click', (event) => event.preventDefault());
		button.addEventListener('pointerdown', (event) => {
			if (disabled || (event.button !== undefined && event.button !== 0)) return;
			event.preventDefault();
			pointerAction = item.id;
			root.addClass('is-action-layout-pointer-dragging');
			document.addEventListener('pointermove', onPointerMove, true);
			document.addEventListener('pointerup', onPointerUp, true);
			document.addEventListener('pointercancel', clearPointer, true);
		});
		button.addEventListener('keydown', (event) => onKeydown(event, item.id));
	}

	function onKeydown(event: KeyboardEvent, id: HeaderPopoverActionId): void {
		if (disabled) return;
		if (event.key === ' ') {
			event.preventDefault();
			if (keyboardAction === id) {
				keyboardAction = null;
				root.removeClass('is-action-layout-keyboard-dragging');
				announce(`Dropped ${ACTION_VISUALS[id].label}.`);
			} else {
				keyboardAction = id;
				root.addClass('is-action-layout-keyboard-dragging');
				announce(`Moving ${ACTION_VISUALS[id].label}. Use arrow keys to place it.`);
			}
			return;
		}
		if (keyboardAction !== id) return;
		if (event.key === 'Escape') {
			event.preventDefault();
			event.stopPropagation();
			keyboardAction = null;
			root.removeClass('is-action-layout-keyboard-dragging');
			announce(`Stopped moving ${ACTION_VISUALS[id].label}.`);
			return;
		}

		const projection = projectHeaderPopoverActionLayout(layout);
		const definition = headerPopoverActionDefinition(id);
		const sideItems = definition.side === 'left' ? projection.left : projection.right;
		const currentIndex = sideItems.findIndex((item) => item.id === id);
		if (event.key === 'ArrowDown' && currentIndex >= 0) {
			event.preventDefault();
			applyMove(id, { kind: 'disabled' }, 'keyboard');
			return;
		}
		if (event.key === 'ArrowUp' && projection.disabled.some((item) => item.id === id)) {
			event.preventDefault();
			applyMove(
				id,
				{ kind: 'side', side: definition.side, index: sideItems.length },
				'keyboard',
			);
			return;
		}
		if (currentIndex < 0 || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return;
		event.preventDefault();
		const offset = event.key === 'ArrowLeft' ? -1 : 1;
		applyMove(
			id,
			{ kind: 'side', side: definition.side, index: Math.max(0, currentIndex + offset) },
			'keyboard',
		);
	}

	function destinationForEvent(event: PointerEvent): HeaderPopoverLayoutDestination | null {
		const target = targetForEvent(event);
		if (!target) return null;
		const destination = target.closest<HTMLElement>('[data-header-popover-layout-destination]');
		if (destination?.dataset.headerPopoverLayoutDestination === 'disabled') {
			return { kind: 'disabled' };
		}
		const action = target.closest<HTMLElement>('[data-header-popover-layout-action]');
		const side =
			action?.dataset.headerPopoverLayoutSide ?? destination?.dataset.headerPopoverLayoutSide;
		const index = Number(
			action?.dataset.headerPopoverLayoutIndex ??
				destination?.dataset.headerPopoverLayoutIndex,
		);
		if ((side !== 'left' && side !== 'right') || !Number.isSafeInteger(index)) return null;
		return { kind: 'side', side, index };
	}

	function targetForEvent(event: PointerEvent): HTMLElement | null {
		const target = event.target;
		if (target && typeof (target as Element).closest === 'function') {
			return target as HTMLElement;
		}
		return null;
	}

	function focusAction(id: HeaderPopoverActionId): void {
		root.querySelector<HTMLButtonElement>(
			`[data-header-popover-layout-action='${id}']`,
		)?.focus();
	}

	function announce(message: string): void {
		liveRegion.textContent = message;
	}

	render();
	return {
		setLayout(nextLayout) {
			layout = normalizeHeaderPopoverActionLayout(nextLayout);
			keyboardAction = null;
			clearPointer();
			render();
		},
		setDisabled(nextDisabled) {
			disabled = nextDisabled;
			render();
		},
		destroy() {
			keyboardAction = null;
			clearPointer();
			root.remove();
		},
	};
}

function moveMessage(
	id: HeaderPopoverActionId,
	destination: HeaderPopoverLayoutDestination,
): string {
	if (destination.kind === 'disabled') return `Disabled ${ACTION_VISUALS[id].label}.`;
	return `Moved ${ACTION_VISUALS[id].label} in the ${destination.side} controls.`;
}

function rejectionMessage(
	id: HeaderPopoverActionId,
	reason: 'wrong-side' | 'invalid-index' | 'already-disabled',
): string {
	if (reason === 'wrong-side') {
		return `${ACTION_VISUALS[id].label} stays on the ${headerPopoverActionDefinition(id).side} side.`;
	}
	if (reason === 'already-disabled') return `${ACTION_VISUALS[id].label} is already disabled.`;
	return `Choose a valid position for ${ACTION_VISUALS[id].label}.`;
}
