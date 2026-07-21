import { describe, expect, it } from '../helpers/test-harness';

import { readFile } from 'node:fs/promises';

describe('summary popover fixed layout', () => {
	it('keeps controls, chart, path, and scroll legend without duplicate rows', async () => {
		const source = await readFile(new URL('../../src/ui/summary-popover.ts', import.meta.url), 'utf8');
		const controls = await readFile(new URL('../../src/ui/components/range-controls.ts', import.meta.url), 'utf8');
		const css = await readFile(new URL('../../styles.css', import.meta.url), 'utf8');
		expect(source.includes('togglePinned()')).toBeTrue();
		expect(source.includes('getHeaderDefaultQuery()')).toBeTrue();
		expect(source.includes('renderDonutChart({')).toBeTrue();
		expect(source.includes('renderChartLegend({')).toBeTrue();
		expect(source.includes('showTooltip: false')).toBeTrue();
		expect(source.includes('activity-map-popover-path')).toBeTrue();
		expect(source.includes("icon: 'expand'")).toBeTrue();
		for (const rejected of ['activity-map-popover-header', 'activity-map-popover-summary', 'renderTrackingAuxiliary', 'This file today']) {
			expect(source.includes(rejected)).toBeFalse();
		}
		for (const expected of ['activity-map-icon-button', 'activity-map-day-navigation', 'activity-map-control-trailing', 'iconForMetric']) {
			expect(controls.includes(expected)).toBeTrue();
		}
		expect(css.includes('max-height: 11rem')).toBeTrue();
		expect(css.includes('overflow-y: auto')).toBeTrue();
	});
});
