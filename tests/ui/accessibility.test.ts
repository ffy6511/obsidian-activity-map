import { readFile } from 'node:fs/promises';
import { describe, expect, it } from '../helpers/test-harness';

async function source(path: string): Promise<string> {
	return readFile(new URL(`../../${path}`, import.meta.url), 'utf8');
}

describe('automated accessibility and platform presentation checks', () => {
	it('keeps chart keyboard behavior, text alternatives, and equivalent detail text', async () => {
		const chart = await source('src/ui/components/donut-chart.ts');
		const legend = await source('src/ui/components/chart-legend.ts');
		expect(chart.includes("setAttribute('tabindex', '0')")).toBeTrue();
		expect(chart.includes("event.key === 'Enter' || event.key === ' '")).toBeTrue();
		expect(chart.includes("setAttribute('aria-label'")).toBeTrue();
		expect(chart.includes("createSvg('title')")).toBeTrue();
		expect(legend.includes("'Activity chart legend'")).toBeTrue();
		expect(legend.includes('formatMetric(item.value')).toBeTrue();
		expect(legend.includes('formatPercent(item.percentOfScope)')).toBeTrue();
	});

	it('preserves focus across header interactions and names transient controls', async () => {
		const popover = await source('src/ui/summary-popover.ts');
		const posterModal = await source('src/ui/poster-export-modal.ts');
		const captionEditor = await source('src/ui/poster-caption-editor.ts');
		const miniDonut = await source('src/ui/header-mini-donut.ts');
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
		expect(posterModal.includes('renderPosterCaptionEditor')).toBeTrue();
		expect(posterModal.includes("cls: 'activity-map-poster-preview-frame'")).toBeTrue();
		expect(posterModal.includes("cls: 'activity-map-poster-preview'" )).toBeFalse();
		expect(posterModal.includes('WIDE_POSTER_CAPTION_PREVIEW')).toBeTrue();
		expect(captionEditor.includes("'aria-label': 'Optional poster caption'")).toBeTrue();
		expect(captionEditor.includes("createEl('textarea'")).toBeTrue();
		expect(captionEditor.includes("rows: '1'")).toBeTrue();
		expect(captionEditor.includes('ensurePosterCaptionFont')).toBeFalse();
		expect(posterModal.includes("'aria-live': 'polite'")).toBeTrue();
		expect(posterModal.includes('caption.focus()')).toBeFalse();
		expect(posterModal.includes('this.trigger.focus()')).toBeTrue();
		expect(posterModal.includes('ConfirmationModal')).toBeFalse();
		expect(posterModal.includes('activity-map-poster-export-button')).toBeTrue();
		expect(posterModal.includes('getExportLabel()')).toBeTrue();
		expect(posterModal.includes("text: 'Download'")).toBeTrue();
		expect(posterModal.includes("text: 'Cancel'")).toBeTrue();
		expect(posterModal.indexOf("const frame = this.contentEl.createDiv")).toBeLessThan(posterModal.indexOf("const footer = this.contentEl.createDiv"));
		expect(posterModal.includes("data-activity-map-id': 'poster-layout'")).toBeFalse();
		expect(posterModal.includes("data-activity-map-id': 'poster-format'")).toBeFalse();
		expect(posterModal.includes('renderPosterExportDetails')).toBeFalse();
		expect(posterModal.includes('Frozen result:')).toBeFalse();
		expect(miniDonut.includes("setAttribute('aria-hidden', 'true')")).toBeTrue();
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
