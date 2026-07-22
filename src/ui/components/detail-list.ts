import type { DistributionItem, DistributionResult } from '../../query/distribution-query';
import { formatMetric, formatPercent } from '../format';
import { stableColor } from './donut-chart';
import { isTrustedPrimaryClick } from '../file-hover-preview';

export function renderDetailList(args: {
	container: HTMLElement;
	distribution: DistributionResult;
	items?: DistributionItem[];
	onActivate: (item: DistributionItem) => void;
	onHighlight?: (item: DistributionItem | null) => void;
	onFileHover?: (event: MouseEvent, targetEl: HTMLElement, filePath: string) => void;
}): { highlight(itemId: string | null): void } {
	const list = args.container.createDiv({ cls: 'activity-map-detail-list', attr: { role: 'list', 'aria-label': 'Complete activity details' } });
	const rows = new Map<string, HTMLButtonElement>();
	for (const item of args.items ?? args.distribution.detailItems) {
		const row = list.createEl('button', { cls: 'activity-map-detail-row', attr: { role: 'listitem', 'data-activity-map-id': item.id } });
		rows.set(item.id, row);
		const swatch = row.createSpan({ cls: 'activity-map-detail-swatch' });
		swatch.style.setProperty('--activity-map-item-color', stableColor(item.id));
		row.createSpan({ text: item.label, cls: 'activity-map-detail-label' });
		row.createSpan({ text: formatMetric(item.value, args.distribution.query.metric, args.distribution.denominatorDays), cls: 'activity-map-detail-value' });
		row.createSpan({ text: formatPercent(item.percentOfScope), cls: 'activity-map-detail-percent' });
		const setRowHighlight = (current: DistributionItem | null): void => {
			setHighlight(rows, current?.id ?? null);
			args.onHighlight?.(current);
		};
		row.addEventListener('pointerenter', () => setRowHighlight(item));
		row.addEventListener('pointerleave', () => setRowHighlight(null));
		row.addEventListener('focus', () => setRowHighlight(item));
		row.addEventListener('blur', () => setRowHighlight(null));
		row.addEventListener('mouseenter', (event) => {
			if (item.kind === 'file' && item.path) args.onFileHover?.(event, row, item.path);
		});
		row.addEventListener('click', (event) => {
			if (isTrustedPrimaryClick(event)) args.onActivate(item);
		});
	}
	return {
		highlight(itemId) {
			setHighlight(rows, itemId);
		},
	};
}

function setHighlight(rows: Map<string, HTMLButtonElement>, itemId: string | null): void {
	for (const [id, row] of rows) {
		row.toggleClass('is-highlighted', id === itemId);
		row.toggleClass('is-dimmed', itemId !== null && id !== itemId);
	}
}
