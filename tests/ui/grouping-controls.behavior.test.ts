import { describe, expect, it } from '../helpers/test-harness';

import { normalizeSettings } from '../../src/domain/settings';
import type { DistributionQuery } from '../../src/query/distribution-query';
import { ActivityMapController, type QueryService, type TrackingControl } from '../../src/ui/activity-map-controller';
import { renderRangeControls } from '../../src/ui/components/range-controls';
import { createDistributionGroupingAction } from '../../src/ui/summary-popover';
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
});
