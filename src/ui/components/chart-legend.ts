import type { DistributionItem, DistributionResult } from '../../query/distribution-query';
import { formatMetric, formatPercent } from '../format';
import { stableColor } from './donut-chart';

export interface ChartLegendHandle {
	highlight(itemId: string | null): void;
}

/** Compact Webtime-style legend used by the header chart popover. */
export function renderChartLegend(args: {
	container: HTMLElement;
	distribution: DistributionResult;
	items?: DistributionItem[];
	onActivate: (item: DistributionItem) => void;
	onHighlight?: (item: DistributionItem | null) => void;
}): ChartLegendHandle {
	const list = args.container.createDiv({
		cls: 'activity-map-chart-legend',
		attr: { role: 'list', 'aria-label': 'Activity chart legend' },
	});
	const rows = new Map<string, HTMLButtonElement>();
	for (const item of args.items ?? args.distribution.detailItems) {
		const row = list.createEl('button', {
			cls: 'activity-map-chart-legend-row',
			attr: { role: 'listitem', 'data-activity-map-id': `legend-${item.id}` },
		});
		rows.set(item.id, row);
		const swatch = row.createSpan({ cls: 'activity-map-detail-swatch' });
		swatch.style.setProperty('--activity-map-item-color', stableColor(item.id));
		row.createSpan({ text: item.label, cls: 'activity-map-chart-legend-label' });
		row.createSpan({ text: formatPercent(item.percentOfScope), cls: 'activity-map-chart-legend-percent' });
		row.createSpan({
			text: formatMetric(item.value, args.distribution.query.metric, args.distribution.denominatorDays),
			cls: 'activity-map-chart-legend-value',
		});
		row.addEventListener('pointerenter', () => args.onHighlight?.(item));
		row.addEventListener('pointerleave', () => args.onHighlight?.(null));
		row.addEventListener('focus', () => args.onHighlight?.(item));
		row.addEventListener('blur', () => args.onHighlight?.(null));
		row.addEventListener('click', () => args.onActivate(item));
	}
	return {
		highlight(itemId) {
			for (const [id, row] of rows) row.toggleClass('is-highlighted', id === itemId);
		},
	};
}
