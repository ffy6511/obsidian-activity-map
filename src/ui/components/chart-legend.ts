import type { DistributionItem, DistributionResult } from '../../query/distribution-query';
import { formatMetric, formatMetricFull, formatPercent } from '../format';
import { stableColor } from './donut-chart';
import { isTrustedPrimaryClick } from '../file-hover-preview';

export interface ChartLegendHandle {
	highlight(itemId: string | null): void;
	/** Updates row values in place. Returns false when row identity changed. */
	update(distribution: DistributionResult, items?: DistributionItem[]): boolean;
}

/** Compact Webtime-style legend used by the header chart popover. */
export function renderChartLegend(args: {
	container: HTMLElement;
	distribution: DistributionResult;
	items?: DistributionItem[];
	onActivate: (item: DistributionItem) => void;
	onHighlight?: (item: DistributionItem | null) => void;
	onFileHover?: (event: MouseEvent, targetEl: HTMLElement, filePath: string) => void;
}): ChartLegendHandle {
	const list = args.container.createDiv({
		cls: 'activity-map-chart-legend',
		attr: { role: 'list', 'aria-label': 'Activity chart legend' },
	});
	let distribution = args.distribution;
	let currentItems = args.items ?? distribution.detailItems;
	let itemsById = new Map(currentItems.map((item) => [item.id, item]));
	const rows = new Map<string, {
		row: HTMLButtonElement;
		swatch: HTMLSpanElement;
		label: HTMLSpanElement;
		percent: HTMLSpanElement;
		value: HTMLSpanElement;
	}>();
	for (const item of currentItems) {
		const row = list.createEl('button', {
			cls: 'activity-map-chart-legend-row',
			attr: {
				role: 'listitem',
				'data-activity-map-id': `legend-${item.id}`,
				'aria-label': legendRowLabel(item, distribution),
			},
		});
		const swatch = row.createSpan({ cls: 'activity-map-detail-swatch' });
		swatch.style.setProperty('--activity-map-item-color', stableColor(item.id));
		const label = row.createSpan({ text: item.label, cls: 'activity-map-chart-legend-label' });
		const value = row.createSpan({
			text: formatMetric(item.value, args.distribution.query.metric, args.distribution.denominatorDays),
			cls: 'activity-map-chart-legend-value',
		});
		const percent = row.createSpan({ text: formatPercent(item.percentOfScope), cls: 'activity-map-chart-legend-percent' });
		rows.set(item.id, { row, swatch, label, percent, value });
		const setRowHighlight = (current: DistributionItem | null): void => {
			setHighlight(rows, current?.id ?? null);
			args.onHighlight?.(current);
		};
		row.addEventListener('pointerenter', () => setRowHighlight(itemsById.get(item.id) ?? null));
		row.addEventListener('pointerleave', () => setRowHighlight(null));
		row.addEventListener('focus', () => setRowHighlight(itemsById.get(item.id) ?? null));
		row.addEventListener('blur', () => setRowHighlight(null));
		row.addEventListener('mouseenter', (event) => {
			const current = itemsById.get(item.id);
			if (current?.kind === 'file' && current.path) args.onFileHover?.(event, row, current.path);
		});
		row.addEventListener('click', (event) => {
			if (!isTrustedPrimaryClick(event)) return;
			const current = itemsById.get(item.id);
			if (current) args.onActivate(current);
		});
	}
	return {
		highlight(itemId) {
			setHighlight(rows, itemId);
		},
		update(nextDistribution, nextItems = nextDistribution.detailItems) {
			if (nextItems.length !== rows.size || nextItems.some((item) => !rows.has(item.id))) return false;
			distribution = nextDistribution;
			currentItems = nextItems;
			itemsById = new Map(currentItems.map((item) => [item.id, item]));
			for (const item of currentItems) {
				const entry = rows.get(item.id);
				if (!entry) continue;
				entry.swatch.style.setProperty('--activity-map-item-color', stableColor(item.id));
				entry.label.textContent = item.label;
				entry.percent.textContent = formatPercent(item.percentOfScope);
				entry.value.textContent = formatMetric(item.value, distribution.query.metric, distribution.denominatorDays);
				entry.row.setAttribute('aria-label', legendRowLabel(item, distribution));
			}
			return true;
		},
	};
}

function legendRowLabel(item: DistributionItem, distribution: DistributionResult): string {
	return `${item.label}, ${formatMetricFull(item.value, distribution.query.metric, distribution.denominatorDays)}, ${formatPercent(item.percentOfScope)}`;
}

function setHighlight(
	rows: Map<string, { row: HTMLButtonElement }>,
	itemId: string | null,
): void {
	for (const [id, entry] of rows) {
		entry.row.toggleClass('is-highlighted', id === itemId);
		entry.row.toggleClass('is-dimmed', itemId !== null && id !== itemId);
	}
}
