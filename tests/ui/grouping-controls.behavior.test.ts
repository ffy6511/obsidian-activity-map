import { describe, expect, it } from '../helpers/test-harness';

import type { TrackingSnapshot } from '../../src/domain/activity';
import { normalizeSettings } from '../../src/domain/settings';
import type { DistributionQuery } from '../../src/query/distribution-query';
import { ActivityMapController, type QueryService, type TrackingControl } from '../../src/ui/activity-map-controller';
import { renderRangeControls } from '../../src/ui/components/range-controls';
import { createDistributionGroupingAction, createTrackingAction } from '../../src/ui/summary-popover';
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
		state, reason: state, currentTarget: null, sessionStartedAt: null, lastTrustedActivityAt: null,
		pendingRecovery: [], recentDecisions: [], degradedReason: null, sampledAt: '2026-07-22T10:00:00.000Z',
	};
}

describe('grouping control behavior', () => {
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
		const groupingAction = () => createDistributionGroupingAction({
			groupBy: controller.getViewModel().query.groupBy,
			getCurrentGrouping: () => controller.getViewModel().query.groupBy,
			onBeforeActivate: () => { cleared += 1; },
			onGrouping: (groupBy) => { void controller.dispatch({ kind: 'set-grouping', groupBy }); },
		});
		const handle = renderRangeControls({
			container,
			metric: 'activeMs',
			range: { mode: 'all' },
			onMetric: () => {},
			onRange: () => {},
			renderIcon: () => {},
			trailingActions: [
				groupingAction(),
				{ icon: 'pause', label: 'Pause activity tracking', id: 'tracking-toggle', onActivate: () => {} },
			],
		});
		const actions = container.querySelectorAll<HTMLButtonElement>('.activity-map-control-actions > button');
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
		expect(handle.updateTrailingAction(groupingAction())).toBeTrue();
		expect(grouping.getAttribute('aria-label')).toBe('Group by path');
		expect(grouping.getAttribute('aria-pressed')).toBe('true');
		expect(container.querySelector('[data-activity-map-id="distribution-grouping-toggle"]')).toBe(grouping);

		// The retained button still owns its original listener. Its callback must
		// read current controller state so a second pointer/native-key activation
		// can reverse the pending selection instead of dispatching file again.
		grouping.click();
		expect(controller.getViewModel().query.groupBy).toBe('path');
		expect(handle.updateTrailingAction(groupingAction())).toBeTrue();
		expect(grouping.getAttribute('aria-label')).toBe('Show all files');
		expect(grouping.getAttribute('aria-pressed')).toBe('false');
		expect(container.querySelector('[data-activity-map-id="distribution-grouping-toggle"]')).toBe(grouping);
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
			pause: () => { pauses += 1; controller.onSnapshot(snapshot('paused')); },
			resume: () => { resumes += 1; controller.onSnapshot(snapshot('active')); },
			updateSettings: () => {}, resolveRecovery: async () => null, undoAutomaticExclusion: () => true,
		};
		controller = new ActivityMapController(settings, service, { update: async () => settings }, runtime, '2026-07-22');
		controller.onSnapshot(snapshot('active'));
		void controller.dispatch({ kind: 'set-grouping', groupBy: 'file' });
		const container = document.createElement('div');
		document.body.appendChild(container);
		const action = () => createTrackingAction({
			paused: controller.getViewModel().tracking?.state === 'paused',
			getCurrentPaused: () => controller.getViewModel().tracking?.state === 'paused',
			onTracking: (kind) => { void controller.dispatch({ kind }); },
		});
		const handle = renderRangeControls({
			container, metric: 'activeMs', range: { mode: 'all' }, onMetric: () => {}, onRange: () => {},
			renderIcon: (element, icon) => { element.setAttribute('data-icon', icon); },
			trailingActions: [action()],
		});
		const button = container.querySelector<HTMLButtonElement>('[data-activity-map-id="tracking-toggle"]');
		if (!button) throw new Error('tracking toggle missing');
		button.focus();
		button.click();
		expect(pauses).toBe(1);
		expect(handle.updateTrailingAction(action())).toBeTrue();
		expect(button.getAttribute('aria-label')).toBe('Resume activity tracking');
		expect(button.getAttribute('data-icon')).toBe('play');
		expect(container.querySelector('[data-activity-map-id="tracking-toggle"]')).toBe(button);
		// Linkedom's activeElement getter does not settle under Node 26. The
		// retained native node is the browser-level focus invariant here: this
		// update mutates attributes only and never replaces or refocuses it.
		button.click();
		expect(resumes).toBe(1);
		expect(handle.updateTrailingAction(action())).toBeTrue();
		expect(button.getAttribute('aria-label')).toBe('Pause activity tracking');
		expect(button.getAttribute('data-icon')).toBe('pause');
		expect(container.querySelector('[data-activity-map-id="tracking-toggle"]')).toBe(button);
	});
});
