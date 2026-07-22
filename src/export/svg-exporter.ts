import type { DistributionQuery, DistributionResult } from '../query/distribution-query';
import { buildChartModel, donutPath, type ChartModel } from '../ui/components/donut-chart';
import { formatMetric, formatPercent, metricLabel } from '../ui/format';

export type SvgExportMode = 'infographic' | 'chart-only';

export interface SvgExportRequest {
	mode: SvgExportMode;
	title: string;
	query: DistributionQuery;
	distribution: DistributionResult;
}

export interface SvgExportResult {
	svg: string;
	filename: string;
	chart: ChartModel;
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

export function inlineChartColor(color: string): string {
	return INLINE_COLORS[color] ?? '#6b7280';
}

export function escapeXml(value: string): string {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&apos;');
}

export function safeSvgFilename(query: DistributionQuery, mode: SvgExportMode): string {
	const range = query.range.mode === 'day' ? query.range.localDate : query.range.mode === 'all' ? 'all' : `${query.range.days}-day-average`;
	const path = query.path || 'vault';
	const safePath = path.normalize('NFKD').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'vault';
	return `activity-map-${query.metric}-${range}-${safePath}-${mode}.svg`;
}

/** Serializes the immutable live chart model; no live DOM is inspected. */
export function exportSvg(request: SvgExportRequest): SvgExportResult {
	const chart = buildChartModel(request.distribution);
	const infographic = request.mode === 'infographic';
	const width = infographic ? 760 : 480;
	const legendHeight = infographic ? Math.max(0, chart.items.length * 34) : 0;
	const height = infographic ? Math.max(520, 360 + legendHeight) : 480;
	const cx = infographic ? 230 : 240;
	const cy = infographic ? 240 : 240;
	const outer = infographic ? 145 : 180;
	const inner = infographic ? 88 : 112;
	const metric = request.query.metric;
	const total = formatMetric(chart.total, metric, request.distribution.denominatorDays);
	const description = chart.items.length === 0
		? `${request.title}. No activity in this range.`
		: `${request.title}. ${chart.items.map((item) => `${item.label}: ${formatMetric(item.value, metric, request.distribution.denominatorDays)} (${formatPercent(item.percentOfScope)})`).join('; ')}.`;
	const paths = chart.items.map((item) => {
		const label = `${item.label}, ${formatPercent(item.percentOfScope)}, ${formatMetric(item.value, metric, request.distribution.denominatorDays)}`;
		return `<path d="${donutPath(cx, cy, outer, inner, item.startAngle, item.endAngle)}" fill="${inlineChartColor(item.color)}" stroke="#ffffff" stroke-width="2" role="listitem" aria-label="${escapeXml(label)}"><title>${escapeXml(label)}</title></path>`;
	}).join('');
	const center = `<text x="${cx}" y="${cy + 5}" text-anchor="middle" fill="#111827" font-family="system-ui, sans-serif" font-size="24" font-weight="700">${escapeXml(total)}</text>`;
	const header = infographic
		? `<text x="40" y="52" fill="#111827" font-family="system-ui, sans-serif" font-size="28" font-weight="700">${escapeXml(request.title)}</text><text x="40" y="82" fill="#4b5563" font-family="system-ui, sans-serif" font-size="16">${escapeXml(metricLabel(metric))} · ${escapeXml(rangeLabel(request.query))} · ${escapeXml(request.query.path || 'Vault')}</text>`
		: '';
	const legend = infographic ? chart.items.map((item, index) => {
		const y = 136 + index * 34;
		return `<g><circle cx="460" cy="${y}" r="7" fill="${inlineChartColor(item.color)}"/><text x="478" y="${y + 5}" fill="#111827" font-family="system-ui, sans-serif" font-size="15">${escapeXml(item.label)}</text><text x="720" y="${y + 5}" text-anchor="end" fill="#4b5563" font-family="system-ui, sans-serif" font-size="14">${escapeXml(formatMetric(item.value, metric, request.distribution.denominatorDays))} · ${escapeXml(formatPercent(item.percentOfScope))}</text></g>`;
	}).join('') : '';
	const empty = chart.items.length === 0
		? `<text x="${cx}" y="${cy}" text-anchor="middle" fill="#4b5563" font-family="system-ui, sans-serif" font-size="18">No activity in this range</text>`
		: '';
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="activity-map-title activity-map-desc"><title id="activity-map-title">${escapeXml(request.title)}</title><desc id="activity-map-desc">${escapeXml(description)}</desc><rect width="100%" height="100%" fill="#ffffff"/>${header}<g role="list" aria-label="Activity distribution">${paths}</g>${chart.items.length > 0 ? center : empty}${legend}</svg>`;
	return { svg, filename: safeSvgFilename(request.query, request.mode), chart };
}

function rangeLabel(query: DistributionQuery): string {
	if (query.range.mode === 'day') return query.range.localDate;
	if (query.range.mode === 'all') return 'All history';
	return query.range.days === 'all' ? 'All-history daily average' : `${query.range.days}-day average`;
}
