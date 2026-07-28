import { describe, expect, it } from '../helpers/test-harness';

import {
	defaultHeaderPopoverActionLayout,
	moveHeaderPopoverAction,
} from '../../src/domain/header-popover-action-layout';
import { normalizeSettings } from '../../src/domain/settings';
import type { TrackingSnapshot } from '../../src/domain/activity';
import type { DistributionQuery, DistributionResult } from '../../src/query/distribution-query';
import {
	ActivityMapController,
	type QueryService,
	type TrackingControl,
} from '../../src/ui/activity-map-controller';
import { renderRangeControls } from '../../src/ui/components/range-controls';
import { SummaryPopover } from '../../src/ui/summary-popover';
import { installDomEnvironment } from '../helpers/dom-environment';

function activeSnapshot(): TrackingSnapshot {
	return {
		state: 'active',
		reason: 'active',
		currentTarget: null,
		sessionStartedAt: null,
		lastTrustedActivityAt: null,
		pendingRecovery: [],
		recentDecisions: [],
		degradedReason: null,
		sampledAt: '2026-07-28T10:00:00.000Z',
	};
}

function result(query: DistributionQuery): DistributionResult {
	const item = {
		id: 'notes/a.md',
		kind: 'file' as const,
		label: 'a.md',
		path: 'notes/a.md',
		value: 10,
		percentOfScope: 1,
		memberIds: ['notes/a.md'],
	};
	return {
		query,
		maxChartItems: 8,
		scopeTotal: 10,
		vaultTotal: 10,
		percentOfVault: 1,
		denominatorDays: null,
		coverage: null,
		chartItems: [item],
		detailItems: [item],
		warnings: [],
	};
}

function pointer(
	type: 'pointerdown' | 'pointermove' | 'pointerup',
	coordinates: { x?: number; y?: number } = {},
): PointerEvent {
	const event = new Event(type, { bubbles: true }) as PointerEvent;
	Object.defineProperties(event, {
		button: { value: 0 },
		pointerId: { value: 1 },
		clientX: { value: coordinates.x ?? 0 },
		clientY: { value: coordinates.y ?? 0 },
	});
	return event;
}

async function settle(): Promise<void> {
	for (let index = 0; index < 5; index += 1) await Promise.resolve();
}

function makePopover(args: { failSave?: boolean } = {}): {
	document: Document;
	popover: SummaryPopover;
	controller: ActivityMapController;
	writes: unknown[];
	timers: Map<number, () => void>;
	pauses: () => number;
} {
	const { document, window } = installDomEnvironment();
	const timers = new Map<number, () => void>();
	let nextTimer = 1;
	window.setTimeout = (callback: () => void) => {
		const id = nextTimer++;
		timers.set(id, callback);
		return id;
	};
	window.clearTimeout = (id: number) => {
		timers.delete(id);
	};
	window.setInterval = () => 0;
	window.clearInterval = () => {};

	let settings = normalizeSettings({ deviceId: 'd1' });
	const writes: unknown[] = [];
	let pauseCount = 0;
	const queryService: QueryService = { run: async (query) => result(query) };
	const tracking: TrackingControl = {
		pause: () => {
			pauseCount += 1;
		},
		resume: () => {},
		updateSettings: () => {},
		resolveRecovery: async () => null,
		undoAutomaticExclusion: () => true,
	};
	const controller = new ActivityMapController(
		settings,
		queryService,
		{
			update: async (patch) => {
				writes.push(patch);
				if (args.failSave) throw new Error('save-failed');
				settings = normalizeSettings({ ...settings, ...patch });
				return settings;
			},
		},
		tracking,
		'2026-07-28',
	);
	controller.onSnapshot(activeSnapshot());
	const trigger = document.createElement('button');
	document.body.appendChild(trigger);
	const popover = new SummaryPopover(
		trigger,
		controller,
		async () => {},
		undefined,
		undefined,
		undefined,
		undefined,
		() => {},
	);
	popover.open();
	return { document, popover, controller, writes, timers, pauses: () => pauseCount };
}

function enterEdit(fixture: ReturnType<typeof makePopover>): void {
	const control = fixture.document.querySelector<HTMLButtonElement>(
		'[data-activity-map-id="tracking-toggle"]',
	);
	if (!control) throw new Error('tracking control missing');
	control.dispatchEvent(pointer('pointerdown'));
	const nextTimer = fixture.timers.values().next();
	const timer = nextTimer.done ? undefined : nextTimer.value;
	if (!timer) throw new Error('long-press timer missing');
	timer();
}

describe('Header Popover action layout projection and edit session', () => {
	it('projects the committed layout into the live left and right action groups', () => {
		const { document } = installDomEnvironment();
		const container = document.createElement('div');
		document.body.appendChild(container);
		const moved = moveHeaderPopoverAction(defaultHeaderPopoverActionLayout(), 'poster-export', {
			kind: 'disabled',
		});
		if (moved.kind !== 'moved') throw new Error('expected disabled poster layout');
		renderRangeControls({
			container,
			metric: 'activeMs',
			range: { mode: 'day', localDate: '2026-07-28' },
			onMetric: () => {},
			onRange: () => {},
			actionLayout: moved.layout,
			leadingActions: [
				{ id: 'tracking-toggle', icon: 'pause', label: 'Pause', onActivate: () => {} },
				{
					id: 'distribution-grouping-toggle',
					icon: 'files',
					label: 'Group',
					onActivate: () => {},
				},
				{ id: 'poster-export', icon: 'image-down', label: 'Export', onActivate: () => {} },
			],
			leadingQueryAction: {
				id: 'locate-current-file',
				icon: 'locate',
				label: 'Locate',
				onActivate: () => {},
			},
			renderIcon: () => {},
		});

		expect(
			Array.from(
				container.querySelectorAll('.activity-map-control-leading [data-activity-map-id]'),
			).map((element) => element.getAttribute('data-activity-map-id')),
		).toEqual(['tracking-toggle', 'distribution-grouping-toggle']);
		expect(container.querySelector('[data-activity-map-id="poster-export"]')).toBeNull();
		expect(
			Array.from(
				container.querySelectorAll('.activity-map-query-controls [data-activity-map-id]'),
			).map((element) => element.getAttribute('data-activity-map-id')),
		).toEqual(['locate-current-file', 'metric', 'date-range']);
	});

	it('enters edit mode after a long press without replacing result nodes and Cancel restores normal controls', async () => {
		const fixture = makePopover();
		await settle();
		const shortPress = fixture.document.querySelector<HTMLButtonElement>(
			'[data-activity-map-id="tracking-toggle"]',
		);
		if (!shortPress) throw new Error('tracking control missing');
		shortPress.dispatchEvent(pointer('pointerdown'));
		shortPress.dispatchEvent(pointer('pointerup'));
		shortPress.click();
		await settle();
		expect(fixture.pauses()).toBe(1);
		expect(
			fixture.document
				.querySelector('.activity-map-chart-popover')
				?.classList.contains('is-action-layout-editing'),
		).toBeFalse();
		const chart = fixture.document.querySelector('.activity-map-popover-chart');
		const legend = fixture.document.querySelector('.activity-map-popover-legend');
		if (!chart || !legend) throw new Error('result nodes missing');

		enterEdit(fixture);
		expect(
			fixture.document
				.querySelector('.activity-map-chart-popover')
				?.classList.contains('is-action-layout-editing'),
		).toBeTrue();
		expect(
			fixture.document.querySelector('.activity-map-popover-layout-disabled'),
		).toBeDefined();
		expect(
			fixture.document.querySelector('.activity-map-popover-layout-actions')?.textContent,
		).toContain('Cancel');
		expect(fixture.document.querySelector('.activity-map-popover-chart')).toBe(chart);
		expect(fixture.document.querySelector('.activity-map-popover-legend')).toBe(legend);

		const cancel = Array.from(
			fixture.document.querySelectorAll<HTMLButtonElement>('button'),
		).find((button) => button.textContent === 'Cancel');
		if (!cancel) throw new Error('cancel button missing');
		cancel.click();
		expect(fixture.writes).toHaveLength(0);
		expect(fixture.document.querySelector('.activity-map-popover-chart')).toBe(chart);
		expect(
			fixture.document.querySelector('[data-activity-map-id="tracking-toggle"]'),
		).toBeDefined();
		fixture.popover.close(false);
	});

	it('saves a direct draft only after Save and retains an editable draft after a failed save', async () => {
		const successful = makePopover();
		await settle();
		enterEdit(successful);
		const poster = successful.document.querySelector<HTMLButtonElement>(
			"[data-header-popover-layout-action='poster-export']",
		);
		if (!poster) throw new Error('edit drag source missing');
		poster.dispatchEvent(pointer('pointerdown'));
		const disabled = successful.document.querySelector<HTMLElement>(
			"[data-header-popover-layout-destination='disabled']",
		);
		if (!disabled) throw new Error('edit disabled target missing');
		disabled.dispatchEvent(pointer('pointerup'));
		const save = Array.from(
			successful.document.querySelectorAll<HTMLButtonElement>('button'),
		).find((button) => button.textContent === 'Save');
		if (!save) throw new Error('save button missing');
		save.click();
		await settle();
		expect(successful.writes).toHaveLength(1);
		expect(
			successful.controller
				.getViewModel()
				.settings.headerPopoverActionLayout.find((item) => item.id === 'poster-export')
				?.enabled,
		).toBeFalse();
		expect(successful.document.querySelector('.activity-map-popover-layout-footer')).toBeNull();
		successful.popover.close(false);

		const failing = makePopover({ failSave: true });
		await settle();
		enterEdit(failing);
		const failedSave = Array.from(
			failing.document.querySelectorAll<HTMLButtonElement>('button'),
		).find((button) => button.textContent === 'Save');
		if (!failedSave) throw new Error('failed-save button missing');
		failedSave.click();
		await settle();
		expect(
			failing.document
				.querySelector('.activity-map-chart-popover')
				?.classList.contains('is-action-layout-editing'),
		).toBeTrue();
		expect(
			failing.document.querySelector('.activity-map-popover-layout-status')?.textContent,
		).toContain('Retry or Cancel');
		expect(
			failing.controller
				.getViewModel()
				.settings.headerPopoverActionLayout.find((item) => item.id === 'poster-export')
				?.enabled,
		).toBeTrue();
		failing.popover.close(false);
	});
});
