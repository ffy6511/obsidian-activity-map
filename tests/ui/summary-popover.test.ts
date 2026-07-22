import { describe, expect, it } from '../helpers/test-harness';

import { readFile } from 'node:fs/promises';

describe('summary popover fixed layout', () => {
	it('keeps controls, chart, path, and scroll legend without duplicate rows', async () => {
		const source = await readFile(new URL('../../src/ui/summary-popover.ts', import.meta.url), 'utf8');
		const controls = await readFile(new URL('../../src/ui/components/range-controls.ts', import.meta.url), 'utf8');
		const donut = await readFile(new URL('../../src/ui/components/donut-chart.ts', import.meta.url), 'utf8');
		const legend = await readFile(new URL('../../src/ui/components/chart-legend.ts', import.meta.url), 'utf8');
		const css = await readFile(new URL('../../styles.css', import.meta.url), 'utf8');
		expect(source.includes('togglePinned()')).toBeTrue();
		expect(source.includes('getHeaderDefaultQuery()')).toBeTrue();
		expect(source.includes('renderDonutChart({')).toBeTrue();
		expect(source.includes('renderChartLegend({')).toBeTrue();
		expect(source.includes('showTooltip: false')).toBeTrue();
		expect(source.includes('withLiveActivity')).toBeTrue();
		expect(source.includes('setInterval')).toBeTrue();
		expect(source.includes('clearInterval')).toBeTrue();
		expect(source.includes('updateLiveDistribution')).toBeTrue();
		expect(source.includes("id: 'tracking-toggle'")).toBeTrue();
		expect(source.includes('}, true);')).toBeTrue();
		expect(source.includes('activity-map-popover-path')).toBeTrue();
		expect(source.includes("cls: 'activity-map-popover-result'")).toBeTrue();
		expect(source.includes("cls: 'activity-map-popover-chart-column'")).toBeTrue();
		expect(source.includes("icon: paused ? 'play' : 'pause'")).toBeTrue();
		expect(source.includes('this.renderIfChanged(model, true);')).toBeTrue();
		expect(source.includes('if (isLiveTodayQuery(model)) this.updateLiveDistribution(model);')).toBeTrue();
		expect(source.includes("model.loadState === 'loading' && this.distributionView")).toBeTrue();
		expect(source.includes('distribution.detailItems.length === 0')).toBeTrue();
		expect(source.includes('popover.matches(\':hover\')')).toBeTrue();
		expect(source.includes('openView')).toBeFalse();
		for (const rejected of ['activity-map-popover-header', 'activity-map-popover-summary', 'renderTrackingAuxiliary', 'This file today', 'Chart area', 'List area']) {
			expect(source.includes(rejected)).toBeFalse();
		}
		for (const expected of ['activity-map-icon-button', 'activity-map-day-navigation', 'activity-map-control-trailing', 'iconForMetric']) {
			expect(controls.includes(expected)).toBeTrue();
		}
		expect(donut.includes('update(nextDistribution)')).toBeTrue();
		expect(donut.includes("center.setAttribute('dominant-baseline', 'middle')")).toBeTrue();
		expect(donut.includes('nextModel.items.some((item) => !paths.has(item.id))')).toBeTrue();
		expect(legend.includes('update(nextDistribution, nextItems')).toBeTrue();
		expect(css.includes('--activity-map-popover-chart-size: min(20rem, calc(60vw - 2.4rem))')).toBeTrue();
		expect(css.includes('grid-template-columns: minmax(0, 3fr) minmax(0, 2fr)')).toBeTrue();
		expect(css.includes('max-height: var(--activity-map-popover-chart-size)')).toBeTrue();
		expect(css.includes('overflow-y: auto')).toBeTrue();
		expect(css.includes('grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) max-content max-content')).toBeTrue();
		expect(css.includes("[data-activity-map-id='previous-day']")).toBeTrue();
		expect(css.includes("[data-activity-map-id='calendar-day']")).toBeTrue();
		expect(css.includes("[data-activity-map-id='next-day']")).toBeTrue();
		expect(css.includes('width: calc(10ch + var(--size-4-3))')).toBeTrue();
		expect(css.includes('grid-template-columns: 0.75rem minmax(0, 1fr) 7ch 4ch')).toBeTrue();
		expect(css.includes('background: transparent !important')).toBeTrue();
		expect(css.includes('cursor: pointer')).toBeTrue();
		expect(css.includes('margin-bottom: calc(-1 * var(--size-4-5))')).toBeTrue();
		expect(css.includes('padding: var(--size-2-1) var(--size-4-3)')).toBeTrue();
		expect(css.includes('.activity-map-popover-path .activity-map-breadcrumb:disabled')).toBeTrue();
		expect(css.includes('.activity-map-chart-legend-row:hover .activity-map-chart-legend-label')).toBeTrue();
		expect(css.includes('.activity-map-chart-popover.is-query-pending')).toBeTrue();
		expect(css.includes('@keyframes activity-map-query-result-in')).toBeTrue();
		expect(controls.includes("['day', 'One Day']")).toBeTrue();
	});
});
