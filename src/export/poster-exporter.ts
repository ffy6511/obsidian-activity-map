import type { DistributionQuery, DistributionResult } from '../query/distribution-query';
import { buildChartModel, donutPath, type ChartModel } from '../ui/components/donut-chart';
import { formatMetric, formatPercent, metricLabel } from '../ui/format';

/** User-selectable poster compositions. */
export type PosterLayout = 'portrait' | 'wide' | 'compact';

/** File encodings available from the export modal. */
export type PosterFormat = 'svg' | 'png' | 'jpg';

export interface PosterRenderRequest {
	layout: PosterLayout;
	query: DistributionQuery;
	distribution: DistributionResult;
	/** Optional user-authored text; no placeholder is emitted when it is empty. */
	caption?: string;
	/** Bundled data URL, never a runtime vault or network path. */
	wordmarkDataUrl: string;
}

export interface PosterRenderResult {
	layout: PosterLayout;
	width: number;
	height: number;
	svg: string;
	filename: string;
	chart: ChartModel;
}

interface PosterGeometry {
	width: number;
	height: number;
	accent: string;
	wordmark: { x: number; y: number; width: number; height: number };
	context: { x: number; y: number; anchor: 'start' | 'middle' | 'end'; size: number };
	dividerY: number;
	donut: { x: number; y: number; outer: number; inner: number };
	path: { x: number; y: number; anchor: 'start' | 'middle'; size: number };
	metricY: number;
	legend: { x: number; y: number; width: number; valueX: number; percentX: number; rowHeight: number; labelSize: number };
	captionY: number;
	footerY: number;
}

const INLINE_COLORS: Record<string, string> = {
	'var(--color-base-50)': '#6b7280',
	'var(--color-blue)': '#3b82f6',
	'var(--color-purple)': '#8b5cf6',
	'var(--color-green)': '#22c55e',
	'var(--color-orange)': '#f97316',
	'var(--color-pink)': '#ec4899',
	'var(--color-yellow)': '#ca8a04',
	'var(--color-cyan)': '#0891b2',
	'var(--color-red)': '#dc2626',
};

const FONT = 'Inter, ui-sans-serif, system-ui, sans-serif';
const MAX_CAPTION_LENGTH = 280;

export function inlineChartColor(color: string): string {
	return INLINE_COLORS[color] ?? '#6b7280';
}

/** Escapes every user-derived SVG text or attribute value. */
export function escapeXml(value: string): string {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&apos;');
}

export function posterMimeType(format: PosterFormat): string {
	return format === 'svg' ? 'image/svg+xml' : format === 'png' ? 'image/png' : 'image/jpeg';
}

/** Produces a bounded ASCII filename without user-controlled path segments. */
export function safePosterFilename(query: DistributionQuery, layout: PosterLayout, format: PosterFormat): string {
	const range = query.range.mode === 'day'
		? query.range.localDate
		: query.range.mode === 'all'
			? 'all'
			: `${String(query.range.days)}-day-average`;
	const safePath = (query.path || 'vault')
		.normalize('NFKD')
		.replace(/[^a-zA-Z0-9._-]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 48) || 'vault';
	return `activity-map-${query.metric}-${range}-${safePath}-${layout}.${format}`;
}

/** A human-readable description of the immutable aggregate disclosed before download. */
export function posterScopeDescription(query: DistributionQuery): string {
	const path = query.path ? `Vault / ${query.path}` : 'Vault';
	return `${metricLabel(query.metric)} · ${rangeLabel(query)} · ${path}`;
}

/**
 * Serializes a full poster from an immutable distribution snapshot. It shares
 * chart math with the Popover but never examines the mounted chart or page DOM.
 */
export function renderPoster(request: PosterRenderRequest): PosterRenderResult {
	const chart = buildChartModel(request.distribution);
	const geometry = layoutGeometry(request.layout, chart.items.length);
	const query = request.query;
	const total = formatMetric(chart.total, query.metric, request.distribution.denominatorDays);
	const pathLabel = query.path ? `Vault / ${query.path}` : 'Vault';
	const title = `Activity Map ${metricLabel(query.metric)} poster`;
	const description = chart.items.length === 0
		? `${title}. No activity in ${rangeLabel(query)}.`
		: `${title}. ${chart.items.map((item) => `${item.label}: ${formatMetric(item.value, query.metric, request.distribution.denominatorDays)} (${formatPercent(item.percentOfScope)})`).join('; ')}.`;
	const donut = renderDonut(chart, geometry, query, request.distribution.denominatorDays);
	const legend = renderLegend(chart, geometry, query, request.distribution.denominatorDays);
	const caption = normalizedCaption(request.caption);
	const captionMarkup = caption
		? `<text x="${geometry.width / 2}" y="${geometry.captionY}" text-anchor="middle" fill="#475569" font-family="${FONT}" font-size="18">${escapeXml(caption)}</text>`
		: '';
	const emptyState = chart.items.length === 0
		? `<text x="${geometry.donut.x}" y="${geometry.donut.y}" text-anchor="middle" fill="#64748b" font-family="${FONT}" font-size="18">No activity in this range</text>`
		: '';
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${geometry.width}" height="${geometry.height}" viewBox="0 0 ${geometry.width} ${geometry.height}" role="img" aria-labelledby="activity-map-poster-title activity-map-poster-desc"><title id="activity-map-poster-title">${escapeXml(title)}</title><desc id="activity-map-poster-desc">${escapeXml(description)}</desc><rect width="100%" height="100%" fill="#f8fafc"/><rect x="1" y="1" width="${geometry.width - 2}" height="${geometry.height - 2}" fill="none" stroke="${geometry.accent}" stroke-width="3"/><image href="${escapeXml(request.wordmarkDataUrl)}" x="${geometry.wordmark.x}" y="${geometry.wordmark.y}" width="${geometry.wordmark.width}" height="${geometry.wordmark.height}" preserveAspectRatio="xMinYMid meet"/><text x="${geometry.context.x}" y="${geometry.context.y}" text-anchor="${geometry.context.anchor}" fill="#64748b" font-family="${FONT}" font-size="${geometry.context.size}" font-weight="650">${escapeXml(`${metricLabel(query.metric)} · ${rangeLabel(query)} · ${pathLabel}`)}</text><line x1="48" y1="${geometry.dividerY}" x2="${geometry.width - 48}" y2="${geometry.dividerY}" stroke="#94a3b8" stroke-width="4"/><g role="list" aria-label="Activity distribution">${donut}</g>${emptyState}<text x="${geometry.path.x}" y="${geometry.path.y}" text-anchor="${geometry.path.anchor}" fill="#111827" font-family="${FONT}" font-size="${geometry.path.size}" font-weight="700">${escapeXml(truncate(pathLabel, request.layout === 'compact' ? 30 : 48))}</text><text x="${geometry.path.x}" y="${geometry.metricY}" text-anchor="${geometry.path.anchor}" fill="#64748b" font-family="${FONT}" font-size="17" font-weight="650">${escapeXml(`${metricLabel(query.metric)} · ${total}`)}</text>${legend}${captionMarkup}<line x1="48" y1="${geometry.footerY - 34}" x2="${geometry.width - 48}" y2="${geometry.footerY - 34}" stroke="#cbd5e1" stroke-width="2"/><text x="${geometry.width / 2}" y="${geometry.footerY}" text-anchor="middle" fill="#94a3b8" font-family="${FONT}" font-size="15">Activity Map · Local-first activity insight</text></svg>`;
	return {
		layout: request.layout,
		width: geometry.width,
		height: geometry.height,
		svg,
		filename: safePosterFilename(query, request.layout, 'svg'),
		chart,
	};
}

function renderDonut(chart: ChartModel, geometry: PosterGeometry, query: DistributionQuery, denominatorDays: number | null): string {
	const { x, y, outer, inner } = geometry.donut;
	const slices = chart.items.map((item) => {
		const label = `${item.label}, ${formatPercent(item.percentOfScope)}, ${formatMetric(item.value, query.metric, denominatorDays)}`;
		return `<path d="${donutPath(x, y, outer, inner, item.startAngle, item.endAngle)}" fill="${inlineChartColor(item.color)}" stroke="#f8fafc" stroke-width="3" role="listitem" aria-label="${escapeXml(label)}"><title>${escapeXml(label)}</title></path>`;
	}).join('');
	const center = chart.items.length > 0
		? `<text x="${x}" y="${y - 7}" text-anchor="middle" fill="#111827" font-family="${FONT}" font-size="${geometry.donut.inner > 100 ? 25 : 22}" font-weight="750">${escapeXml(formatMetric(chart.total, query.metric, denominatorDays))}</text><text x="${x}" y="${y + 22}" text-anchor="middle" fill="#64748b" font-family="${FONT}" font-size="14" font-weight="650">${escapeXml(metricLabel(query.metric))}</text>`
		: '';
	return `${slices}${center}`;
}

function renderLegend(chart: ChartModel, geometry: PosterGeometry, query: DistributionQuery, denominatorDays: number | null): string {
	return chart.items.map((item, index) => {
		const y = geometry.legend.y + index * geometry.legend.rowHeight;
		const color = inlineChartColor(item.color);
		const label = truncate(item.label, geometry.legend.labelSize > 20 ? 26 : 20);
		const value = formatMetric(item.value, query.metric, denominatorDays);
		return `<g><circle cx="${geometry.legend.x}" cy="${y}" r="8" fill="${color}"/><text x="${geometry.legend.x + 20}" y="${y + 6}" fill="#111827" font-family="${FONT}" font-size="${geometry.legend.labelSize}" font-weight="650">${escapeXml(label)}</text><line x1="${geometry.legend.x + 20}" y1="${y + 21}" x2="${geometry.legend.x + geometry.legend.width}" y2="${y + 21}" stroke="${color}" stroke-width="4"/><text x="${geometry.legend.valueX}" y="${y + 6}" text-anchor="end" fill="#111827" font-family="${FONT}" font-size="${geometry.legend.labelSize - 1}" font-weight="650">${escapeXml(value)}</text><text x="${geometry.legend.percentX}" y="${y + 6}" text-anchor="end" fill="${color}" font-family="${FONT}" font-size="${geometry.legend.labelSize - 1}" font-weight="750">${escapeXml(formatPercent(item.percentOfScope))}</text></g>`;
	}).join('');
}

function layoutGeometry(layout: PosterLayout, itemCount: number): PosterGeometry {
	if (layout === 'wide') {
		const height = Math.max(760, 430 + itemCount * 62 + 180);
		return {
			width: 1440, height, accent: '#4568e8',
			wordmark: { x: 58, y: 42, width: 300, height: 100 },
			context: { x: 1380, y: 98, anchor: 'end', size: 18 }, dividerY: 152,
			donut: { x: 280, y: 412, outer: 185, inner: 108 },
			path: { x: 510, y: 250, anchor: 'start', size: 28 }, metricY: 284,
			legend: { x: 520, y: 350, width: 490, valueX: 1180, percentX: 1340, rowHeight: 62, labelSize: 22 },
			captionY: height - 76, footerY: height - 24,
		};
	}
	if (layout === 'compact') {
		const height = Math.max(1160, 760 + itemCount * 66 + 190);
		return {
			width: 820, height, accent: '#059669',
			wordmark: { x: 60, y: 42, width: 250, height: 92 },
			context: { x: 410, y: 196, anchor: 'middle', size: 20 }, dividerY: 238,
			donut: { x: 410, y: 490, outer: 170, inner: 98 },
			path: { x: 410, y: 730, anchor: 'middle', size: 27 }, metricY: 762,
			legend: { x: 78, y: 842, width: 300, valueX: 606, percentX: 742, rowHeight: 66, labelSize: 21 },
			captionY: height - 76, footerY: height - 24,
		};
	}
	const height = Math.max(1220, 700 + itemCount * 68 + 200);
	return {
		width: 960, height, accent: '#4568e8',
		wordmark: { x: 58, y: 42, width: 300, height: 100 },
		context: { x: 58, y: 186, anchor: 'start', size: 22 }, dividerY: 228,
		donut: { x: 280, y: 535, outer: 188, inner: 110 },
		path: { x: 540, y: 330, anchor: 'start', size: 26 }, metricY: 364,
		legend: { x: 540, y: 435, width: 250, valueX: 820, percentX: 920, rowHeight: 68, labelSize: 21 },
		captionY: height - 76, footerY: height - 24,
	};
}

function normalizedCaption(caption: string | undefined): string {
	return (caption ?? '').trim().slice(0, MAX_CAPTION_LENGTH);
}

function truncate(value: string, maxLength: number): string {
	return value.length <= maxLength ? value : `${value.slice(0, Math.max(0, maxLength - 1))}…`;
}

function rangeLabel(query: DistributionQuery): string {
	if (query.range.mode === 'day') return query.range.localDate;
	if (query.range.mode === 'all') return 'All history';
	return query.range.days === 'all' ? 'All-history daily average' : `${String(query.range.days)}-day average`;
}
