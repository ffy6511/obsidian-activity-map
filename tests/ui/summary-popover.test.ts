import { describe, expect, it } from '../helpers/test-harness';

import { readFile } from 'node:fs/promises';

describe('summary popover fixed layout', () => {
	it('keeps controls, chart, path, and scroll legend without duplicate rows', async () => {
		const source = await readFile(
			new URL('../../src/ui/summary-popover.ts', import.meta.url),
			'utf8',
		);
		const controls = await readFile(
			new URL('../../src/ui/components/range-controls.ts', import.meta.url),
			'utf8',
		);
		const donut = await readFile(
			new URL('../../src/ui/components/donut-chart.ts', import.meta.url),
			'utf8',
		);
		const legend = await readFile(
			new URL('../../src/ui/components/chart-legend.ts', import.meta.url),
			'utf8',
		);
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
		expect(source.includes("id: 'poster-export'")).toBeTrue();
		expect(source.includes("icon: 'image-down'")).toBeTrue();
		expect(source.includes("id: 'distribution-grouping-toggle'")).toBeTrue();
		const leadingActions = source.slice(
			source.indexOf('leadingActions:'),
			source.indexOf('],', source.indexOf('leadingActions:')),
		);
		expect(leadingActions.indexOf('this.trackingAction(model)')).toBeLessThan(
			leadingActions.indexOf('this.groupingAction(model)'),
		);
		expect(leadingActions.indexOf('this.groupingAction(model)')).toBeLessThan(
			leadingActions.indexOf('this.posterExportAction(model)'),
		);
		expect(source.includes("void import('./poster-export-modal')")).toBeTrue();
		expect(source.includes('model.settings.posterCaptionFont')).toBeFalse();
		expect(source.includes('withLiveActivity(model.distribution')).toBeTrue();
		expect(
			source.includes("args.getCurrentGrouping() === 'path' ? 'file' : 'path'"),
		).toBeTrue();
		expect(source.includes("pressed: args.groupBy === 'file'")).toBeTrue();
		expect(source.includes("args.groupBy === 'file' ? 'folder-tree' : 'files'")).toBeTrue();
		expect(
			source.includes('this.controlsView?.updateAction(this.groupingAction(model))'),
		).toBeTrue();
		expect(/\},\s*true\s*,?\s*\)/.test(source)).toBeTrue();
		expect(source.includes('activity-map-popover-path')).toBeTrue();
		expect(source.includes("cls: 'activity-map-popover-result'")).toBeTrue();
		expect(source.includes("cls: 'activity-map-popover-chart-column'")).toBeTrue();
		expect(source.includes("icon: args.paused ? 'play' : 'pause'")).toBeTrue();
		expect(
			source.includes('this.controlsView?.updateAction(this.trackingAction(model))'),
		).toBeTrue();
		expect(source.includes('this.renderIfChanged(model, true);')).toBeTrue();
		expect(
			source.includes('if (isLiveTodayQuery(model)) this.updateLiveDistribution(model);'),
		).toBeTrue();
		expect(
			source.includes("model.loadState === 'loading' && this.distributionView"),
		).toBeTrue();
		expect(source.includes('distribution.detailItems.length === 0')).toBeTrue();
		expect(source.includes("popover.matches(':hover')")).toBeTrue();
		expect(source.includes('openView')).toBeFalse();
		for (const rejected of [
			'activity-map-popover-header',
			'activity-map-popover-summary',
			'renderTrackingAuxiliary',
			'This file today',
			'Chart area',
			'List area',
		]) {
			expect(source.includes(rejected)).toBeFalse();
		}
		for (const expected of [
			'activity-map-control-button',
			'activity-map-icon-button',
			'activity-map-day-navigation',
			'activity-map-control-actions',
			'activity-map-control-leading',
			'leadingActions',
			'activity-map-query-controls',
			'activity-map-dropdown-menu',
			"role: 'listbox'",
			'aria-pressed',
			'iconForMetric',
		]) {
			expect(controls.includes(expected)).toBeTrue();
		}
		expect(donut.includes('update(nextDistribution)')).toBeTrue();
		expect(
			donut.includes("args.tightBounds === true ? '28 28 184 184' : '0 0 240 240'"),
		).toBeTrue();
		expect(donut.includes("center.setAttribute('dominant-baseline', 'middle')")).toBeTrue();
		expect(donut.includes('nextModel.items.some((item) => !paths.has(item.id))')).toBeTrue();
		expect(legend.includes('update(nextDistribution, nextItems')).toBeTrue();
		expect(source.includes('tightBounds: true')).toBeTrue();
		expect(
			css.includes('--activity-map-popover-chart-size: min(13.2rem, calc(40vw - 2.5rem))'),
		).toBeTrue();
		expect(css.includes('width: min(40rem, calc(100vw - 1rem))')).toBeTrue();
		expect(css.includes('grid-template-columns: minmax(0, 2fr) minmax(0, 3fr)')).toBeTrue();
		expect(css.includes('width: min(100%, 36rem)')).toBeTrue();
		expect(css.includes('margin-inline: auto')).toBeTrue();
		expect(css.includes('padding-inline: var(--size-4-4)')).toBeTrue();
		expect(css.includes('max-height: var(--activity-map-popover-chart-size)')).toBeTrue();
		expect(css.includes('overflow-y: auto')).toBeTrue();
		expect(
			css.includes('grid-template-columns: minmax(0, 1fr) max-content minmax(0, 1fr)'),
		).toBeTrue();
		expect(css.includes("grid-template-areas: 'actions date query'")).toBeTrue();
		expect(css.includes("[data-activity-map-id='previous-day']")).toBeTrue();
		expect(css.includes("[data-activity-map-id='calendar-day']")).toBeTrue();
		expect(css.includes("[data-activity-map-id='next-day']")).toBeTrue();
		const dayNavigationButtons = css.slice(
			css.indexOf('.activity-map-day-navigation > .activity-map-icon-button'),
			css.indexOf('.activity-map-popover .activity-map-hidden-date'),
		);
		expect(css.includes('.activity-map-popover button.activity-map-control-button')).toBeTrue();
		expect(css.includes('box-sizing: border-box')).toBeTrue();
		expect(css.includes('.activity-map-dropdown-menu')).toBeTrue();
		expect(css.includes('.activity-map-dropdown-option')).toBeTrue();
		expect(css.includes('background: transparent !important')).toBeTrue();
		expect(css.includes('box-shadow: var(--shadow-input-active) !important')).toBeTrue();
		expect(
			css.includes('.activity-map-popover button.activity-map-dropdown-option:hover'),
		).toBeTrue();
		expect(css.includes('display: flex !important')).toBeTrue();
		expect(css.includes('justify-content: flex-start !important')).toBeTrue();
		expect(css.includes('text-align: left !important')).toBeTrue();
		expect(css.includes('transform: scale(1.04)')).toBeTrue();
		expect(css.includes('transform: scale(0.96)')).toBeTrue();
		expect(css.includes('.activity-map-query-button.activity-map-icon-button')).toBeTrue();
		expect(css.includes('grid-template-columns: max-content max-content')).toBeTrue();
		expect(dayNavigationButtons.includes('inline-size: 100%')).toBeTrue();
		expect(dayNavigationButtons.includes('block-size: 100%')).toBeTrue();
		expect(css.includes('width: calc(10ch + var(--size-4-3))')).toBeTrue();
		expect(css.includes('.activity-map-control-leading')).toBeTrue();
		expect(css.includes('.activity-map-query-controls')).toBeTrue();
		expect(css.includes('justify-self: end')).toBeTrue();
		expect(css.includes('text-overflow: ellipsis')).toBeTrue();
		expect(css.includes("font-family: Georgia, 'Times New Roman', serif")).toBeTrue();
		expect(css.includes('background: transparent !important')).toBeTrue();
		expect(css.includes('cursor: pointer')).toBeTrue();
		expect(css.includes('margin-bottom: var(--size-4-2)')).toBeTrue();
		expect(css.includes('padding: var(--size-2-1) var(--size-4-2)')).toBeTrue();
		expect(
			css.includes(
				'grid-template-columns: 0.75rem minmax(0, 1fr) minmax(7ch, max-content) 4ch',
			),
		).toBeTrue();
		expect(css.includes('font-variant-numeric: tabular-nums')).toBeTrue();
		expect(
			css.includes('.activity-map-popover-path .activity-map-breadcrumb:disabled'),
		).toBeTrue();
		expect(
			css.includes('.activity-map-chart-legend-row:hover .activity-map-chart-legend-label'),
		).toBeTrue();
		expect(css.includes('.activity-map-chart-popover.is-query-pending')).toBeTrue();
		expect(css.includes('@keyframes activity-map-query-result-in')).toBeTrue();
		expect(css.includes('.activity-map-poster-preview-frame')).toBeTrue();
		expect(css.includes('.activity-map-poster-preview {')).toBeFalse();
		expect(css.includes('.activity-map-poster-caption-editor')).toBeTrue();
		expect(css.includes("'Songti SC'")).toBeTrue();
		expect(css.includes('width: min(90vw, 48rem)')).toBeTrue();
		expect(css.includes('width: min(100%, 42rem)')).toBeTrue();
		expect(css.includes('bottom: var(--activity-map-poster-caption-bottom, 4.25%)')).toBeTrue();
		expect(css.includes('aspect-ratio: 1440 / 760')).toBeTrue();
		expect(css.includes('container-type: inline-size')).toBeTrue();
		expect(css.includes('.activity-map-poster-modal .modal-title')).toBeTrue();
		expect(css.includes('font-size: var(--font-ui-medium)')).toBeTrue();
		expect(css.includes('border-bottom: 1px dashed var(--text-faint)')).toBeTrue();
		expect(
			css.includes('width: var(--activity-map-poster-caption-width, 41.6666666667%)'),
		).toBeTrue();
		expect(css.includes('@supports (field-sizing: content)')).toBeTrue();
		expect(css.includes('field-sizing: content')).toBeTrue();
		expect(
			css.includes(
				'max-width: min(var(--activity-map-poster-caption-width, 41.6666666667%), calc(100% - 3rem))',
			),
		).toBeTrue();
		expect(
			css.includes(
				'font-size: var(--activity-map-poster-caption-font-size, 3.3333333333cqw)',
			),
		).toBeTrue();
		expect(css.includes('max-width: calc(100% - 3rem)')).toBeTrue();
		expect(css.includes('resize: none')).toBeTrue();
		expect(css.includes('overflow-wrap: anywhere')).toBeTrue();
		expect(css.includes('border-bottom: 2px solid var(--text-muted)')).toBeTrue();
		expect(css.includes('.activity-map-poster-caption-line-count')).toBeTrue();
		expect(css.includes('color: var(--text-error)')).toBeTrue();
		expect(controls.includes("value: 'day', label: '1 day'")).toBeTrue();
	});
});
