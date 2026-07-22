import { readFile } from 'node:fs/promises';
import { describe, expect, it } from '../helpers/test-harness';

async function source(path: string): Promise<string> {
	return readFile(new URL(`../../${path}`, import.meta.url), 'utf8');
}

describe('automated accessibility and platform presentation checks', () => {
	it('keeps chart keyboard behavior, text alternatives, and equivalent detail text', async () => {
		const chart = await source('src/ui/components/donut-chart.ts');
		const details = await source('src/ui/components/detail-list.ts');
		expect(chart.includes("setAttribute('tabindex', '0')")).toBeTrue();
		expect(chart.includes("event.key === 'Enter' || event.key === ' '")).toBeTrue();
		expect(chart.includes("setAttribute('aria-label'")).toBeTrue();
		expect(chart.includes("createSvg('title')")).toBeTrue();
		expect(details.includes("'Complete activity details'")).toBeTrue();
		expect(details.includes('formatMetric(item.value')).toBeTrue();
		expect(details.includes('formatPercent(item.percentOfScope)')).toBeTrue();
	});

	it('preserves focus across rerenders and names transient and destructive controls', async () => {
		const view = await source('src/ui/activity-map-view.ts');
		const popover = await source('src/ui/summary-popover.ts');
		const miniDonut = await source('src/ui/header-mini-donut.ts');
		const deletion = await source('src/ui/deletion-confirmation.ts');
		expect(view.includes('data-activity-map-id')).toBeTrue();
		expect(view.includes('?.focus()')).toBeTrue();
		expect(popover.includes("event.key === 'Escape'")).toBeTrue();
		expect(popover.includes('this.trigger.focus()')).toBeTrue();
		expect(popover.includes('togglePinned()')).toBeTrue();
		expect(popover.includes("'aria-label': 'Activity Map chart'")).toBeTrue();
		expect(popover.includes("id: 'distribution-grouping-toggle'")).toBeTrue();
		expect(popover.includes("pressed: args.groupBy === 'file'")).toBeTrue();
		expect(popover.includes('getCurrentGrouping()')).toBeTrue();
		expect(popover.includes("cls: 'activity-map-popover-result'")).toBeTrue();
		expect(popover.includes('Chart area')).toBeFalse();
		expect(popover.includes('List area')).toBeFalse();
		expect(miniDonut.includes("setAttribute('aria-hidden', 'true')")).toBeTrue();
		expect(deletion.includes("role: 'alertdialog'")).toBeTrue();
		expect(deletion.includes('Delete planned data')).toBeTrue();
	});

	it('uses non-color status text, theme tokens, reduced motion, and a touch-safe hover gate', async () => {
		const status = await source('src/ui/status-presentation.ts');
		const header = await source('src/ui/header-action-manager.ts');
		const css = await source('styles.css');
		for (const state of ['tracking this file', 'idle', 'paused', 'need review', 'storage problem']) expect(status.includes(state)).toBeTrue();
		expect(header.includes('(hover: hover) and (pointer: fine)')).toBeTrue();
		expect(css.includes('var(--background-primary)')).toBeTrue();
		expect(css.includes('@media (prefers-reduced-motion: reduce)')).toBeTrue();
		expect(css.includes('.activity-map-header-action.is-degraded')).toBeTrue();
	});
});
