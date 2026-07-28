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

/** The pointer-only state that renders a lifted control without mutating the draft. */
interface PointerDrag {
	readonly id: HeaderPopoverActionId;
	readonly avatar: HTMLElement;
	preview: HeaderPopoverLayoutDestination | null;
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
	let pointerDrag: PointerDrag | null = null;
	let keyboardAction: HeaderPopoverActionId | null = null;

	const clearPointer = (restorePreview = true) => {
		const drag = pointerDrag;
		pointerDrag = null;
		root.removeClass('is-action-layout-pointer-dragging');
		document.body.classList.remove('is-activity-map-action-layout-pointer-dragging');
		drag?.avatar.remove();
		document.removeEventListener('pointermove', onPointerMove, true);
		document.removeEventListener('pointerup', onPointerUp, true);
		document.removeEventListener('pointercancel', onPointerCancel, true);
		if (restorePreview && root.isConnected) render();
	};

	const applyMove = (
		id: HeaderPopoverActionId,
		destination: HeaderPopoverLayoutDestination,
		source: 'pointer' | 'keyboard',
	): void => {
		const result = moveHeaderPopoverAction(layout, id, destination);
		if (result.kind === 'rejected') {
			announce(rejectionMessage(id, result.reason));
			// Pointerup has already removed the lifted preview. Restore the unchanged
			// draft so an invalid cross-boundary drop cannot leave a false vacancy.
			render();
			return;
		}
		layout = result.layout;
		args.onChange(layout);
		render();
		announce(moveMessage(id, destination));
		if (source === 'keyboard') focusAction(id);
	};

	const onPointerMove = (event: PointerEvent): void => {
		const drag = pointerDrag;
		if (!drag) return;
		event.preventDefault();
		positionDragAvatar(drag.avatar, event);
		const destination = destinationForEvent(event);
		const preview =
			destination && acceptsPointerDestination(drag.id, destination) ? destination : null;
		if (sameDestination(drag.preview, preview)) return;
		drag.preview = preview;
		render();
	};

	const onPointerUp = (event: PointerEvent): void => {
		const drag = pointerDrag;
		if (!drag) return;
		const destination = destinationForEvent(event);
		const action = drag.id;
		clearPointer(false);
		if (destination) {
			applyMove(action, destination, 'pointer');
			return;
		}
		render();
	};

	const onPointerCancel = (): void => clearPointer();

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
		const disabledItemsWithoutDrag = projection.disabled.filter(
			(item) => item.id !== pointerDrag?.id,
		);
		const disabledPreview = pointerDrag?.preview?.kind === 'disabled';
		if (disabledItemsWithoutDrag.length === 0 && !disabledPreview) {
			disabledItems.createSpan({
				cls: 'activity-map-action-layout-empty',
				text: 'Drop a control here to disable it',
			});
		} else {
			for (const item of disabledItemsWithoutDrag)
				renderAction(disabledItems, item, undefined);
			if (disabledPreview) renderDropSlot(disabledItems, { kind: 'disabled' });
		}
	}

	function renderSide(
		row: HTMLElement,
		side: 'left' | 'right',
		items: readonly HeaderPopoverActionLayoutItem[],
	): void {
		const visibleItems = items.filter((item) => item.id !== pointerDrag?.id);
		const preview =
			pointerDrag?.preview?.kind === 'side' && pointerDrag.preview.side === side
				? pointerDrag.preview
				: null;
		const region = row.createDiv({
			cls: `activity-map-action-layout-side activity-map-action-layout-side-${side}`,
			attr: {
				'data-header-popover-layout-destination': 'side',
				'data-header-popover-layout-side': side,
				'data-header-popover-layout-index': String(visibleItems.length),
			},
		});
		if (visibleItems.length === 0 && !preview) {
			region.addClass('is-action-layout-empty-side');
			region.createSpan({
				cls: 'activity-map-action-layout-empty',
				text: `Drop ${side} controls here`,
			});
			return;
		}
		for (let index = 0; index <= visibleItems.length; index += 1) {
			if (preview?.index === index) renderDropSlot(region, { kind: 'side', side, index });
			const item = visibleItems[index];
			if (item) renderAction(region, item, index);
		}
	}

	function renderDropSlot(
		parent: HTMLElement,
		destination: HeaderPopoverLayoutDestination,
	): void {
		const slot = parent.createSpan({
			cls: 'activity-map-action-layout-drop-slot',
			attr: {
				'aria-hidden': 'true',
				'data-header-popover-layout-destination': destination.kind,
				'data-header-popover-layout-dragged-action': pointerDrag?.id ?? '',
				...(destination.kind === 'side'
					? {
							'data-header-popover-layout-side': destination.side,
							'data-header-popover-layout-index': String(destination.index),
						}
					: {}),
			},
		});
		if (pointerDrag?.id === 'date-range')
			slot.textContent = ACTION_VISUALS['date-range'].text ?? '';
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
			// The editor owns this gesture. Keep the Popover's ordinary long-press and
			// outside-close listeners from interpreting a control that this render will
			// immediately replace as a new interaction.
			event.stopPropagation();
			const projection = projectHeaderPopoverActionLayout(layout);
			const visibleItems = side === 'left' ? projection.left : projection.right;
			const sourceIndex = visibleItems.findIndex((candidate) => candidate.id === item.id);
			const preview: HeaderPopoverLayoutDestination = item.enabled
				? { kind: 'side', side, index: Math.max(0, sourceIndex) }
				: { kind: 'disabled' };
			const avatar = createDragAvatar(button, event);
			pointerDrag = { id: item.id, avatar, preview };
			root.addClass('is-action-layout-pointer-dragging');
			document.body.classList.add('is-activity-map-action-layout-pointer-dragging');
			document.addEventListener('pointermove', onPointerMove, true);
			document.addEventListener('pointerup', onPointerUp, true);
			document.addEventListener('pointercancel', onPointerCancel, true);
			render();
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
		const actionIndex = action?.dataset.headerPopoverLayoutIndex;
		const index = Number(
			actionIndex === undefined || !action
				? destination?.dataset.headerPopoverLayoutIndex
				: insertionIndexForAction(action, Number(actionIndex), event),
		);
		if ((side !== 'left' && side !== 'right') || !Number.isSafeInteger(index)) return null;
		return { kind: 'side', side, index };
	}

	function insertionIndexForAction(
		action: HTMLElement,
		index: number,
		event: PointerEvent,
	): number {
		const rect = action.getBoundingClientRect();
		if (
			Number.isFinite(rect.left) &&
			Number.isFinite(rect.width) &&
			rect.width > 0 &&
			Number.isFinite(event.clientX) &&
			event.clientX > rect.left + rect.width / 2
		) {
			return index + 1;
		}
		return index;
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
			clearPointer(false);
			render();
		},
		setDisabled(nextDisabled) {
			clearPointer(false);
			disabled = nextDisabled;
			render();
		},
		destroy() {
			keyboardAction = null;
			clearPointer(false);
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

function acceptsPointerDestination(
	id: HeaderPopoverActionId,
	destination: HeaderPopoverLayoutDestination,
): boolean {
	return (
		destination.kind === 'disabled' ||
		destination.side === headerPopoverActionDefinition(id).side
	);
}

function sameDestination(
	left: HeaderPopoverLayoutDestination | null,
	right: HeaderPopoverLayoutDestination | null,
): boolean {
	if (left === right) return true;
	if (!left || !right || left.kind !== right.kind) return false;
	if (left.kind === 'disabled' && right.kind === 'disabled') return true;
	return (
		left.kind === 'side' &&
		right.kind === 'side' &&
		left.side === right.side &&
		left.index === right.index
	);
}

function createDragAvatar(source: HTMLButtonElement, event: PointerEvent): HTMLElement {
	const avatar = source.cloneNode(true) as HTMLElement;
	avatar.classList.add('activity-map-action-layout-drag-avatar');
	avatar.removeAttribute('id');
	avatar.removeAttribute('disabled');
	avatar.removeAttribute('aria-label');
	avatar.setAttribute('aria-hidden', 'true');
	avatar.tabIndex = -1;
	const rect = source.getBoundingClientRect();
	if (Number.isFinite(rect.width) && rect.width > 0)
		avatar.style.inlineSize = `${String(rect.width)}px`;
	if (Number.isFinite(rect.height) && rect.height > 0)
		avatar.style.blockSize = `${String(rect.height)}px`;
	positionDragAvatar(avatar, event);
	source.ownerDocument.body.appendChild(avatar);
	return avatar;
}

function positionDragAvatar(avatar: HTMLElement, event: PointerEvent): void {
	avatar.style.left = `${String(pointerCoordinate(event.clientX))}px`;
	avatar.style.top = `${String(pointerCoordinate(event.clientY))}px`;
}

function pointerCoordinate(value: unknown): number {
	return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}
