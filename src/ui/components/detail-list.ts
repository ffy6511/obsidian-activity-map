import type { DistributionItem, DistributionResult } from '../../query/distribution-query';
import { formatMetric, formatPercent } from '../format';
import { stableColor } from './donut-chart';

export function renderDetailList(args: {
	container: HTMLElement;
	distribution: DistributionResult;
	items?: DistributionItem[];
	onActivate: (item: DistributionItem) => void;
}): void {
	const list = args.container.createDiv({ cls: 'activity-map-detail-list', attr: { role: 'list', 'aria-label': 'Complete activity details' } });
	for (const item of args.items ?? args.distribution.detailItems) {
		const row = list.createEl('button', { cls: 'activity-map-detail-row', attr: { role: 'listitem', 'data-activity-map-id': item.id } });
		const swatch = row.createSpan({ cls: 'activity-map-detail-swatch' });
		swatch.style.setProperty('--activity-map-item-color', stableColor(item.id));
		row.createSpan({ text: item.label, cls: 'activity-map-detail-label' });
		row.createSpan({ text: formatMetric(item.value, args.distribution.query.metric, args.distribution.denominatorDays), cls: 'activity-map-detail-value' });
		row.createSpan({ text: formatPercent(item.percentOfScope), cls: 'activity-map-detail-percent' });
		row.addEventListener('click', () => args.onActivate(item));
	}
}
