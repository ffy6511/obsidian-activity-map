import { describe, expect, it } from '../helpers/test-harness';

import { defaultHeaderPopoverActionLayout } from '../../src/domain/header-popover-action-layout';
import { renderHeaderPopoverActionLayoutEditor } from '../../src/ui/components/header-popover-action-layout-editor';
import { installDomEnvironment } from '../helpers/dom-environment';

function pointer(
	type: 'pointerdown' | 'pointermove' | 'pointerup',
	coordinates: { x?: number; y?: number } = {},
): PointerEvent {
	const event = new Event(type, { bubbles: true }) as PointerEvent;
	Object.defineProperties(event, {
		button: { value: 0 },
		clientX: { value: coordinates.x ?? 0 },
		clientY: { value: coordinates.y ?? 0 },
	});
	return event;
}

function keydown(key: string): KeyboardEvent {
	const event = new Event('keydown', { bubbles: true }) as KeyboardEvent;
	Object.defineProperty(event, 'key', { value: key });
	return event;
}

describe('Header Popover action layout editor', () => {
	it('renders one complete row with a fixed center navigation and recoverable disabled area', () => {
		const { document } = installDomEnvironment();
		const container = document.createElement('div');
		document.body.appendChild(container);
		renderHeaderPopoverActionLayoutEditor({
			container,
			layout: defaultHeaderPopoverActionLayout(),
			onChange: () => {},
			renderIcon: () => {},
		});

		expect(
			container.querySelector('[data-header-popover-layout-fixed="day-navigation"]'),
		).toBeDefined();
		expect(
			Array.from(container.querySelectorAll('[data-header-popover-layout-action]')).map(
				(element) => element.getAttribute('data-header-popover-layout-action'),
			),
		).toEqual([
			'tracking-toggle',
			'distribution-grouping-toggle',
			'poster-export',
			'locate-current-file',
			'metric',
			'date-range',
		]);
		expect(container.textContent).toContain('Drop a control here to disable it');
	});

	it('uses pointer drag targets to disable an action and restore it only to its own side', () => {
		const { document } = installDomEnvironment();
		const container = document.createElement('div');
		document.body.appendChild(container);
		const drafts: unknown[] = [];
		renderHeaderPopoverActionLayoutEditor({
			container,
			layout: defaultHeaderPopoverActionLayout(),
			onChange: (layout) => drafts.push(layout),
			renderIcon: () => {},
		});

		const exportButton = container.querySelector<HTMLButtonElement>(
			"[data-header-popover-layout-action='poster-export']",
		);
		if (!exportButton) throw new Error('layout drag source missing');
		exportButton.dispatchEvent(pointer('pointerdown'));
		const disabled = container.querySelector<HTMLElement>(
			"[data-header-popover-layout-destination='disabled']",
		);
		if (!disabled) throw new Error('layout disabled target missing');
		disabled.dispatchEvent(pointer('pointerup'));
		expect(drafts).toHaveLength(1);
		expect(
			container
				.querySelector("[data-header-popover-layout-action='poster-export']")
				?.parentElement?.classList.contains('activity-map-action-layout-disabled-items'),
		).toBeTrue();

		const restored = container.querySelector<HTMLButtonElement>(
			"[data-header-popover-layout-action='poster-export']",
		);
		if (!restored) throw new Error('recovery source missing');
		restored.dispatchEvent(pointer('pointerdown'));
		const left = container.querySelector<HTMLElement>(
			"[data-header-popover-layout-side='left']",
		);
		if (!left) throw new Error('recovery left target missing');
		left.dispatchEvent(pointer('pointerup'));
		expect(drafts).toHaveLength(2);
		expect(
			Array.from(
				container.querySelectorAll(
					'.activity-map-action-layout-side-left [data-header-popover-layout-action]',
				),
			).map((element) => element.getAttribute('data-header-popover-layout-action')),
		).toEqual(['tracking-toggle', 'distribution-grouping-toggle', 'poster-export']);
	});

	it('rejects a pointer drop across the fixed center boundary', () => {
		const { document } = installDomEnvironment();
		const container = document.createElement('div');
		document.body.appendChild(container);
		let changes = 0;
		renderHeaderPopoverActionLayoutEditor({
			container,
			layout: defaultHeaderPopoverActionLayout(),
			onChange: () => {
				changes += 1;
			},
			renderIcon: () => {},
		});

		const metric = container.querySelector<HTMLButtonElement>(
			"[data-header-popover-layout-action='metric']",
		);
		if (!metric) throw new Error('cross-side drag source missing');
		metric.dispatchEvent(pointer('pointerdown'));
		const left = container.querySelector<HTMLElement>(
			"[data-header-popover-layout-side='left']",
		);
		if (!left) throw new Error('cross-side left target missing');
		left.dispatchEvent(pointer('pointerup'));
		expect(changes).toBe(0);
		expect(container.querySelector('[aria-live="polite"]')?.textContent).toContain(
			'right side',
		);
		expect(
			container.querySelector("[data-header-popover-layout-action='metric']"),
		).toBeDefined();
	});

	it('uses the destination action index when pointer-reordering within a side', () => {
		const { document } = installDomEnvironment();
		const container = document.createElement('div');
		document.body.appendChild(container);
		renderHeaderPopoverActionLayoutEditor({
			container,
			layout: defaultHeaderPopoverActionLayout(),
			onChange: () => {},
			renderIcon: () => {},
		});

		const poster = container.querySelector<HTMLButtonElement>(
			"[data-header-popover-layout-action='poster-export']",
		);
		if (!poster) throw new Error('same-side drag source missing');
		poster.dispatchEvent(pointer('pointerdown'));
		const tracking = container.querySelector<HTMLButtonElement>(
			"[data-header-popover-layout-action='tracking-toggle']",
		);
		if (!tracking) throw new Error('same-side tracking target missing');
		tracking.dispatchEvent(pointer('pointerup'));
		expect(
			Array.from(
				container.querySelectorAll(
					'.activity-map-action-layout-side-left [data-header-popover-layout-action]',
				),
			).map((element) => element.getAttribute('data-header-popover-layout-action')),
		).toEqual(['poster-export', 'tracking-toggle', 'distribution-grouping-toggle']);
	});

	it('lifts the dragged control into a cursor-following avatar and previews an insertion slot', () => {
		const { document } = installDomEnvironment();
		const container = document.createElement('div');
		document.body.appendChild(container);
		renderHeaderPopoverActionLayoutEditor({
			container,
			layout: defaultHeaderPopoverActionLayout(),
			onChange: () => {},
			renderIcon: () => {},
		});

		const tracking = container.querySelector<HTMLButtonElement>(
			"[data-header-popover-layout-action='tracking-toggle']",
		);
		if (!tracking) throw new Error('drag source control missing');

		tracking.dispatchEvent(pointer('pointerdown', { x: 4, y: 8 }));
		const grouping = container.querySelector<HTMLButtonElement>(
			"[data-header-popover-layout-action='distribution-grouping-toggle']",
		);
		if (!grouping) throw new Error('drag destination control missing');
		grouping.getBoundingClientRect = () =>
			({ left: 10, width: 20, top: 0, height: 20 }) as DOMRect;
		const avatar = document.body.querySelector<HTMLElement>(
			'.activity-map-action-layout-drag-avatar',
		);
		if (!avatar) throw new Error('drag avatar missing');
		expect(avatar.style.left).toBe('4px');
		expect(avatar.style.top).toBe('8px');
		expect(
			document.body.classList.contains('is-activity-map-action-layout-pointer-dragging'),
		).toBeTrue();
		expect(
			container.querySelector(
				".activity-map-action-layout-drop-slot[data-header-popover-layout-dragged-action='tracking-toggle']",
			),
		).toBeDefined();

		grouping.dispatchEvent(pointer('pointermove', { x: 29, y: 16 }));
		const left = container.querySelector<HTMLElement>('.activity-map-action-layout-side-left');
		if (!left) throw new Error('left action side missing');
		expect(
			Array.from(left.children).map(
				(element) =>
					element.getAttribute('data-header-popover-layout-action') ??
					(element.classList.contains('activity-map-action-layout-drop-slot')
						? 'drop-slot'
						: ''),
			),
		).toEqual(['distribution-grouping-toggle', 'drop-slot', 'poster-export']);
		const slot = left.querySelector<HTMLElement>('.activity-map-action-layout-drop-slot');
		if (!slot) throw new Error('insertion slot missing');
		expect(slot.getAttribute('data-header-popover-layout-index')).toBe('1');
		expect(avatar.style.left).toBe('29px');
		expect(avatar.style.top).toBe('16px');

		slot.dispatchEvent(pointer('pointerup', { x: 29, y: 16 }));
		expect(
			Array.from(
				container.querySelectorAll(
					'.activity-map-action-layout-side-left [data-header-popover-layout-action]',
				),
			).map((element) => element.getAttribute('data-header-popover-layout-action')),
		).toEqual(['distribution-grouping-toggle', 'tracking-toggle', 'poster-export']);
		expect(document.body.querySelector('.activity-map-action-layout-drag-avatar')).toBeNull();
		expect(
			document.body.classList.contains('is-activity-map-action-layout-pointer-dragging'),
		).toBeFalse();
	});

	it('supports keyboard reordering through the same local draft reducer', () => {
		const { document } = installDomEnvironment();
		const container = document.createElement('div');
		document.body.appendChild(container);
		let lastDraft = defaultHeaderPopoverActionLayout();
		renderHeaderPopoverActionLayoutEditor({
			container,
			layout: lastDraft,
			onChange: (layout) => {
				lastDraft = layout;
			},
			renderIcon: () => {},
		});

		const metric = container.querySelector<HTMLButtonElement>(
			"[data-header-popover-layout-action='metric']",
		);
		if (!metric) throw new Error('metric action missing');
		metric.dispatchEvent(keydown(' '));
		metric.dispatchEvent(keydown('ArrowLeft'));
		expect(lastDraft.filter((item) => item.enabled && item.id !== 'metric')[0]).toBeDefined();
		expect(
			container
				.querySelector(
					'.activity-map-action-layout-side-right [data-header-popover-layout-action]',
				)
				?.getAttribute('data-header-popover-layout-action'),
		).toBe('metric');
	});
});
