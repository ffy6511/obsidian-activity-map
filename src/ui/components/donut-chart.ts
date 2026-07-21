import type { DistributionItem, DistributionResult } from '../../query/distribution-query';
import { formatMetric, formatPercent } from '../format';

export interface ChartItem extends DistributionItem {
	color: string;
	startAngle: number;
	endAngle: number;
}

export interface ChartModel {
	items: ChartItem[];
	total: number;
}

export interface DonutChartHandle {
	highlight(itemId: string | null): void;
	/** Updates values and geometry in place. Returns false when slice identity changed. */
	update(distribution: DistributionResult): boolean;
}

const SEMANTIC_COLORS: Record<string, string> = {
	'group:other': 'var(--color-base-50)',
	'group:deleted': 'var(--color-red)',
	'group:local-files': 'var(--color-cyan)',
};

const PALETTE = ['var(--color-blue)', 'var(--color-purple)', 'var(--color-green)', 'var(--color-orange)', 'var(--color-pink)', 'var(--color-yellow)', 'var(--color-cyan)', 'var(--color-red)'];

export function stableColor(id: string): string {
	if (SEMANTIC_COLORS[id]) return SEMANTIC_COLORS[id];
	let hash = 2166136261;
	for (const char of id) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
	return PALETTE[Math.abs(hash) % PALETTE.length] ?? PALETTE[0] as string;
}

export function buildChartModel(distribution: DistributionResult): ChartModel {
	let items = distribution.chartItems.map((item) => ({ ...item }));
	const hasDirectory = distribution.detailItems.some((item) => item.kind === 'directory');
	if (hasDirectory) {
		const directFiles = distribution.detailItems.filter((item) => item.kind === 'file');
		if (directFiles.length > 0) {
			const fileIds = new Set(directFiles.map((item) => item.id));
			items = items.filter((item) => !fileIds.has(item.id));
			const value = directFiles.reduce((sum, item) => sum + item.value, 0);
			items.push({
				id: 'group:local-files',
				kind: 'local-files',
				label: 'Local files',
				path: distribution.query.path,
				value,
				percentOfScope: distribution.scopeTotal > 0 ? value / distribution.scopeTotal : 0,
				memberIds: directFiles.flatMap((item) => item.memberIds),
			});
		}
	}
	let cursor = -Math.PI / 2;
	return {
		total: distribution.scopeTotal,
		items: items.filter((item) => item.value > 0).map((item) => {
			const angle = distribution.scopeTotal > 0 ? (item.value / distribution.scopeTotal) * Math.PI * 2 : 0;
			const chartItem = { ...item, color: stableColor(item.id), startAngle: cursor, endAngle: cursor + angle };
			cursor += angle;
			return chartItem;
		}),
	};
}

export function renderDonutChart(args: {
	container: HTMLElement;
	distribution: DistributionResult;
	onActivate: (item: ChartItem) => void;
	onHighlight?: (item: ChartItem | null) => void;
	showTooltip?: boolean;
}): DonutChartHandle {
	let distribution = args.distribution;
	let model = buildChartModel(distribution);
	const svg = args.container.createSvg('svg');
	svg.setAttribute('class', 'activity-map-donut');
	svg.setAttribute('viewBox', '0 0 240 240');
	svg.setAttribute('role', 'list');
	svg.setAttribute('aria-label', 'Activity distribution');
	const paths = new Map<string, { path: SVGPathElement; title: SVGTitleElement }>();
	let highlightedId: string | null = null;
	const tooltip = args.showTooltip === false ? null : args.container.createDiv({
		cls: 'activity-map-chart-tooltip',
		attr: { 'aria-live': 'polite' },
	});
	const highlight = (item: ChartItem | null): void => {
		highlightedId = item?.id ?? null;
		for (const [id, candidate] of paths) {
			candidate.path.classList.toggle('is-highlighted', item?.id === id);
			candidate.path.classList.toggle('is-dimmed', item !== null && item.id !== id);
		}
		if (item && tooltip) {
			tooltip.textContent = `${item.label} · ${formatPercent(item.percentOfScope)} · ${formatMetric(item.value, distribution.query.metric, distribution.denominatorDays)}`;
			tooltip.removeAttribute('hidden');
		} else if (tooltip) {
			tooltip.textContent = '';
			tooltip.setAttribute('hidden', '');
		}
	};
	const currentItem = (id: string): ChartItem | null => model.items.find((item) => item.id === id) ?? null;
	const updatePath = (item: ChartItem, entry: { path: SVGPathElement; title: SVGTitleElement }): void => {
		entry.path.setAttribute('d', donutPath(120, 120, 92, 56, item.startAngle, item.endAngle));
		entry.path.setAttribute('fill', item.color);
		const label = `${item.label}, ${formatPercent(item.percentOfScope)}, ${formatMetric(item.value, distribution.query.metric, distribution.denominatorDays)}`;
		entry.path.setAttribute('aria-label', label);
		entry.title.textContent = label;
	};
	for (const item of model.items) {
		const path = svg.createSvg('path');
		path.setAttribute('tabindex', '0');
		path.setAttribute('role', 'listitem');
		path.setAttribute('data-activity-map-id', item.id);
		const title = path.createSvg('title');
		const entry = { path, title };
		paths.set(item.id, entry);
		updatePath(item, entry);
		path.addEventListener('pointerenter', () => { const current = currentItem(item.id); highlight(current); args.onHighlight?.(current); });
		path.addEventListener('pointerleave', () => { highlight(null); args.onHighlight?.(null); });
		path.addEventListener('focus', () => { const current = currentItem(item.id); highlight(current); args.onHighlight?.(current); });
		path.addEventListener('blur', () => { highlight(null); args.onHighlight?.(null); });
		path.addEventListener('click', () => { const current = currentItem(item.id); if (!current) return; highlight(current); args.onHighlight?.(current); args.onActivate(current); });
		path.addEventListener('keydown', (event) => {
			if (event.key === 'Enter' || event.key === ' ') {
				event.preventDefault();
				const current = currentItem(item.id);
				if (current) args.onActivate(current);
			}
		});
		svg.appendChild(path);
	}
	const center = svg.createSvg('text');
	center.setAttribute('x', '120');
	center.setAttribute('y', '120');
	center.setAttribute('text-anchor', 'middle');
	center.setAttribute('dominant-baseline', 'middle');
	center.setAttribute('class', 'activity-map-donut-total');
	center.textContent = formatMetric(model.total, args.distribution.query.metric, args.distribution.denominatorDays);
	svg.appendChild(center);
	args.container.appendChild(svg);
	if (tooltip) args.container.appendChild(tooltip);
	return {
		highlight(itemId) {
			highlight(model.items.find((item) => item.id === itemId) ?? null);
		},
		update(nextDistribution) {
			const nextModel = buildChartModel(nextDistribution);
			if (nextModel.items.length !== paths.size || nextModel.items.some((item) => !paths.has(item.id))) return false;
			distribution = nextDistribution;
			model = nextModel;
			for (const item of model.items) {
				const entry = paths.get(item.id);
				if (entry) updatePath(item, entry);
			}
			center.textContent = formatMetric(model.total, distribution.query.metric, distribution.denominatorDays);
			if (highlightedId) highlight(currentItem(highlightedId));
			return true;
		},
	};
}

export function donutPath(cx: number, cy: number, outer: number, inner: number, start: number, end: number): string {
	const span = Math.max(0, Math.min(Math.PI * 2 - 0.0001, end - start));
	const actualEnd = start + span;
	const large = span > Math.PI ? 1 : 0;
	const point = (radius: number, angle: number) => `${cx + radius * Math.cos(angle)} ${cy + radius * Math.sin(angle)}`;
	return `M ${point(outer, start)} A ${outer} ${outer} 0 ${large} 1 ${point(outer, actualEnd)} L ${point(inner, actualEnd)} A ${inner} ${inner} 0 ${large} 0 ${point(inner, start)} Z`;
}
