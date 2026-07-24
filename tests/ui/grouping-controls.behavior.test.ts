import { describe, expect, it } from '../helpers/test-harness';

import type { TrackingSnapshot } from '../../src/domain/activity';
import { normalizeSettings } from '../../src/domain/settings';
import type { DistributionQuery } from '../../src/query/distribution-query';
import {
	ActivityMapController,
	type QueryService,
	type TrackingControl,
} from '../../src/ui/activity-map-controller';
import { renderRangeControls } from '../../src/ui/components/range-controls';
import {
	createDistributionGroupingAction,
	createPosterExportAction,
	createTrackingAction,
} from '../../src/ui/summary-popover';
import { installDomEnvironment } from '../helpers/dom-environment';

function tracking(): TrackingControl {
	return {
		pause: () => {},
		resume: () => {},
		updateSettings: () => {},
		resolveRecovery: async () => null,
		undoAutomaticExclusion: () => true,
	};
}

function snapshot(state: 'active' | 'paused'): TrackingSnapshot {
	return {
		state,
		reason: state,
		currentTarget: null,
		sessionStartedAt: null,
		lastTrustedActivityAt: null,
		pendingRecovery: [],
		recentDecisions: [],
		degradedReason: null,
		sampledAt: '2026-07-22T10:00:00.000Z',
	};
}

function keydown(key: string): KeyboardEvent {
	const event = new Event('keydown', { bubbles: true }) as KeyboardEvent;
	Object.defineProperty(event, 'key', { value: key });
	return event;
}

describe('grouping control behavior', () => {
	it('uses an icon-only metric trigger and textual custom listbox options', () => {
		const { document } = installDomEnvironment();
		const container = document.createElement('div');
		document.body.appendChild(container);
		let renderedIcon = '';
		let selectedMetric = '';
		renderRangeControls({
			container,
			metric: 'typedChars',
			range: { mode: 'all' },
			onMetric: (metric) => {
				selectedMetric = metric;
			},
			onRange: () => {},
			renderIcon: (_element, icon) => {
				renderedIcon = icon;
			},
		});
		const metric = container.querySelector<HTMLButtonElement>(
			'[data-activity-map-id="metric"]',
		);
		if (!metric) throw new Error('metric trigger missing');
		expect(metric.textContent).toBe('');
		expect(metric.getAttribute('aria-label')).toBe('Metric: Chars');
		expect(renderedIcon).toBe('keyboard');
		metric.click();
		expect(metric.getAttribute('aria-expanded')).toBe('true');
		const chars = container.querySelector<HTMLButtonElement>(
			'[data-activity-map-option="typedChars"]',
		);
		if (!chars) throw new Error('Chars option missing');
		expect(chars.textContent).toBe('Chars');
		chars.click();
		expect(selectedMetric).toBe('typedChars');
	});

	it('selects a custom range option with ArrowDown and Enter', () => {
		const { document } = installDomEnvironment();
		const container = document.createElement('div');
		document.body.appendChild(container);
		let selectedRange = '';
		renderRangeControls({
			container,
			metric: 'activeMs',
			range: { mode: 'all' },
			onMetric: () => {},
			onRange: (range) => {
				selectedRange = range.mode;
			},
			renderIcon: () => {},
		});
		const range = container.querySelector<HTMLButtonElement>(
			'[data-activity-map-id="date-range"]',
		);
		if (!range) throw new Error('range trigger missing');
		range.dispatchEvent(keydown('ArrowDown'));
		expect(range.getAttribute('aria-expanded')).toBe('true');
		const allHistory = container.querySelector<HTMLButtonElement>(
			'[data-activity-map-option="all"]',
		);
		if (!allHistory) throw new Error('All history option missing');
		allHistory.dispatchEvent(keydown('Enter'));
		expect(selectedRange).toBe('all');
		expect(range.getAttribute('aria-expanded')).toBe('false');
	});

	it('places poster export immediately after tracking and disables it without a ready snapshot', () => {
		const { document } = installDomEnvironment();
		const container = document.createElement('div');
		document.body.appendChild(container);
		let exports = 0;
		renderRangeControls({
			container,
			metric: 'activeMs',
			range: { mode: 'all' },
			onMetric: () => {},
			onRange: () => {},
			renderIcon: () => {},
			leadingActions: [
				createTrackingAction({
					paused: false,
					getCurrentPaused: () => false,
					onTracking: () => {},
				}),
				createPosterExportAction({
					available: true,
					onExport: () => {
						exports += 1;
					},
				}),
			],
		});
		const actions = container.querySelectorAll<HTMLButtonElement>(
			'.activity-map-control-actions > button',
		);
		expect(Array.from(actions).map((button) => button.dataset.activityMapId)).toEqual([
			'tracking-toggle',
			'poster-export',
		]);
		const exportButton = actions[1];
		if (!exportButton) throw new Error('poster export button missing');
		expect(exportButton.disabled).toBeFalse();
		exportButton.click();
		expect(exports).toBe(1);

		const unavailable = document.createElement('div');
		document.body.appendChild(unavailable);
		renderRangeControls({
			container: unavailable,
			metric: 'activeMs',
			range: { mode: 'all' },
			onMetric: () => {},
			onRange: () => {},
			renderIcon: () => {},
			leadingActions: [
				createPosterExportAction({
					available: false,
					onExport: () => {
						exports += 1;
					},
				}),
			],
		});
		expect(
			unavailable.querySelector<HTMLButtonElement>('[data-activity-map-id="poster-export"]')
				?.disabled,
		).toBeTrue();
	});

	it('keeps one focused native toggle current across two delayed grouping queries', () => {
		const { document } = installDomEnvironment();
		const pending: DistributionQuery[] = [];
		const service: QueryService = {
			run(query) {
				pending.push(query);
				return new Promise(() => {});
			},
		};
		const settings = normalizeSettings({ deviceId: 'd1' });
		const controller = new ActivityMapController(
			settings,
			service,
			{ update: async () => settings },
			tracking(),
			'2026-07-22',
		);
		const container = document.createElement('div');
		document.body.appendChild(container);
		let cleared = 0;
		const groupingAction = () =>
			createDistributionGroupingAction({
				groupBy: controller.getViewModel().query.groupBy,
				getCurrentGrouping: () => controller.getViewModel().query.groupBy,
				onBeforeActivate: () => {
					cleared += 1;
				},
				onGrouping: (groupBy) => {
					void controller.dispatch({ kind: 'set-grouping', groupBy });
				},
			});
		const handle = renderRangeControls({
			container,
			metric: 'activeMs',
			range: { mode: 'all' },
			onMetric: () => {},
			onRange: () => {},
			renderIcon: () => {},
			leadingActions: [
				groupingAction(),
				{
					icon: 'pause',
					label: 'Pause activity tracking',
					id: 'tracking-toggle',
					onActivate: () => {},
				},
			],
		});
		const actions = container.querySelectorAll<HTMLButtonElement>(
			'.activity-map-control-actions > button',
		);
		expect(Array.from(actions).map((button) => button.dataset.activityMapId)).toEqual([
			'distribution-grouping-toggle',
			'tracking-toggle',
		]);
		const grouping = actions[0];
		if (!grouping) throw new Error('grouping toggle missing');
		expect(grouping.tagName).toBe('BUTTON');
		expect(grouping.getAttribute('aria-pressed')).toBe('false');
		grouping.focus();
		grouping.click();
		expect(controller.getViewModel().query.groupBy).toBe('file');
		expect(controller.getViewModel().loadState).toBe('loading');
		expect(handle.updateAction(groupingAction())).toBeTrue();
		expect(grouping.getAttribute('aria-label')).toBe('Group by path');
		expect(grouping.getAttribute('aria-pressed')).toBe('true');
		expect(
			container.querySelector('[data-activity-map-id="distribution-grouping-toggle"]'),
		).toBe(grouping);

		// The retained button still owns its original listener. Its callback must
		// read current controller state so a second pointer/native-key activation
		// can reverse the pending selection instead of dispatching file again.
		grouping.click();
		expect(controller.getViewModel().query.groupBy).toBe('path');
		expect(handle.updateAction(groupingAction())).toBeTrue();
		expect(grouping.getAttribute('aria-label')).toBe('Show all files');
		expect(grouping.getAttribute('aria-pressed')).toBe('false');
		expect(
			container.querySelector('[data-activity-map-id="distribution-grouping-toggle"]'),
		).toBe(grouping);
		expect(cleared).toBe(2);
		expect(pending.map((query) => query.groupBy)).toEqual(['file', 'path']);
	});

	it('keeps pause and resume current on the retained row during a delayed grouping query', () => {
		const { document } = installDomEnvironment();
		const service: QueryService = { run: () => new Promise(() => {}) };
		const settings = normalizeSettings({ deviceId: 'd1' });
		let controller: ActivityMapController;
		let pauses = 0;
		let resumes = 0;
		const runtime: TrackingControl = {
			pause: () => {
				pauses += 1;
				controller.onSnapshot(snapshot('paused'));
			},
			resume: () => {
				resumes += 1;
				controller.onSnapshot(snapshot('active'));
			},
			updateSettings: () => {},
			resolveRecovery: async () => null,
			undoAutomaticExclusion: () => true,
		};
		controller = new ActivityMapController(
			settings,
			service,
			{ update: async () => settings },
			runtime,
			'2026-07-22',
		);
		controller.onSnapshot(snapshot('active'));
		void controller.dispatch({ kind: 'set-grouping', groupBy: 'file' });
		const container = document.createElement('div');
		document.body.appendChild(container);
		const action = () =>
			createTrackingAction({
				paused: controller.getViewModel().tracking?.state === 'paused',
				getCurrentPaused: () => controller.getViewModel().tracking?.state === 'paused',
				onTracking: (kind) => {
					void controller.dispatch({ kind });
				},
			});
		const handle = renderRangeControls({
			container,
			metric: 'activeMs',
			range: { mode: 'all' },
			onMetric: () => {},
			onRange: () => {},
			renderIcon: (element, icon) => {
				element.setAttribute('data-icon', icon);
			},
			leadingActions: [action()],
		});
		const button = container.querySelector<HTMLButtonElement>(
			'[data-activity-map-id="tracking-toggle"]',
		);
		if (!button) throw new Error('tracking toggle missing');
		button.focus();
		button.click();
		expect(pauses).toBe(1);
		expect(handle.updateAction(action())).toBeTrue();
		expect(button.getAttribute('aria-label')).toBe('Resume activity tracking');
		expect(button.getAttribute('data-icon')).toBe('play');
		expect(container.querySelector('[data-activity-map-id="tracking-toggle"]')).toBe(button);
		// Linkedom's activeElement getter does not settle under Node 26. The
		// retained native node is the browser-level focus invariant here: this
		// update mutates attributes only and never replaces or refocuses it.
		button.click();
		expect(resumes).toBe(1);
		expect(handle.updateAction(action())).toBeTrue();
		expect(button.getAttribute('aria-label')).toBe('Pause activity tracking');
		expect(button.getAttribute('data-icon')).toBe('pause');
		expect(container.querySelector('[data-activity-map-id="tracking-toggle"]')).toBe(button);
	});

	it('renders leading actions, one-day navigation, then query controls', () => {
		const { document } = installDomEnvironment();
		const container = document.createElement('div');
		document.body.appendChild(container);
		renderRangeControls({
			container,
			metric: 'activeMs',
			range: { mode: 'day', localDate: '2026-07-23' },
			onMetric: () => {},
			onRange: () => {},
			renderIcon: () => {},
			leadingActions: [
				{
					icon: 'pause',
					label: 'Pause activity tracking',
					id: 'tracking-toggle',
					onActivate: () => {},
				},
				{
					icon: 'files',
					label: 'Group by path',
					id: 'distribution-grouping-toggle',
					onActivate: () => {},
				},
				{
					icon: 'image-down',
					label: 'Export activity poster',
					id: 'poster-export',
					onActivate: () => {},
				},
			],
		});

		const controls = container.querySelector('.activity-map-controls');
		if (!controls) throw new Error('controls missing');
		expect(Array.from(controls.children).map((element) => element.className)).toEqual([
			'activity-map-control-actions activity-map-control-leading',
			'activity-map-day-navigation',
			'activity-map-query-controls',
		]);
		expect(
			Array.from(
				controls.querySelectorAll<HTMLButtonElement>(
					'.activity-map-control-leading > button',
				),
			).map((button) => button.dataset.activityMapId),
		).toEqual(['tracking-toggle', 'distribution-grouping-toggle', 'poster-export']);
	});
});
