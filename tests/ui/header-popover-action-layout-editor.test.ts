import { describe, expect, it } from '../helpers/test-harness';

import { defaultHeaderPopoverActionLayout } from '../../src/domain/header-popover-action-layout';
import { renderHeaderPopoverActionLayoutEditor } from '../../src/ui/components/header-popover-action-layout-editor';
import { installDomEnvironment } from '../helpers/dom-environment';

function pointer(type: 'pointerdown' | 'pointerup'): PointerEvent {
	const event = new Event(type, { bubbles: true }) as PointerEvent;
	Object.defineProperty(event, 'button', { value: 0 });
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
		const disabled = container.querySelector<HTMLElement>(
			"[data-header-popover-layout-destination='disabled']",
		);
		if (!exportButton || !disabled) throw new Error('layout drag targets missing');
		exportButton.dispatchEvent(pointer('pointerdown'));
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
		const left = container.querySelector<HTMLElement>(
			"[data-header-popover-layout-side='left']",
		);
		if (!restored || !left) throw new Error('recovery targets missing');
		restored.dispatchEvent(pointer('pointerdown'));
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
		const left = container.querySelector<HTMLElement>(
			"[data-header-popover-layout-side='left']",
		);
		if (!metric || !left) throw new Error('cross-side drag targets missing');
		metric.dispatchEvent(pointer('pointerdown'));
		left.dispatchEvent(pointer('pointerup'));
		expect(changes).toBe(0);
		expect(container.querySelector('[aria-live="polite"]')?.textContent).toContain(
			'right side',
		);
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
		const tracking = container.querySelector<HTMLButtonElement>(
			"[data-header-popover-layout-action='tracking-toggle']",
		);
		if (!poster || !tracking) throw new Error('same-side drag targets missing');
		poster.dispatchEvent(pointer('pointerdown'));
		tracking.dispatchEvent(pointer('pointerup'));
		expect(
			Array.from(
				container.querySelectorAll(
					'.activity-map-action-layout-side-left [data-header-popover-layout-action]',
				),
			).map((element) => element.getAttribute('data-header-popover-layout-action')),
		).toEqual(['poster-export', 'tracking-toggle', 'distribution-grouping-toggle']);
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
