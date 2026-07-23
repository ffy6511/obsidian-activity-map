import type {
	DistributionQuery,
	DistributionResult,
} from '../query/distribution-query';
import {
	buildChartModel,
	donutPath,
	stableColor,
	type ChartItem,
	type ChartModel,
} from '../ui/components/donut-chart';
import { formatMetric, formatPercent, metricLabel } from '../ui/format';
import { completePosterTheme, type PosterTheme } from './poster-theme';

/** Poster compositions supported by the serializer. */
export type PosterLayout = 'portrait' | 'wide' | 'compact';

/** File encodings supported by the serializer. */
export type PosterFormat = 'svg' | 'png' | 'jpg';

export interface PosterRenderRequest {
	layout: PosterLayout;
	query: DistributionQuery;
	distribution: DistributionResult;
	/** Optional user-authored text; no placeholder is emitted when it is empty. */
	caption?: string;
	/** Bundled data URL, never a runtime vault or network path. */
	wordmarkDataUrl: string;
	/** Resolved current-theme tokens, inlined so downloaded files match preview. */
	theme?: PosterTheme;
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
	wordmark: { x: number; y: number; width: number; height: number };
	header: {
		x: number;
		metricY: number;
		rangeY: number;
		metricSize: number;
		rangeSize: number;
	};
	donut: { x: number; y: number; outer: number; inner: number };
	path: { x: number; y: number; anchor: 'start' | 'middle'; size: number };
	legend: {
		x: number;
		y: number;
		valueX: number;
		percentX: number;
		rowHeight: number;
		labelSize: number;
		valueSize: number;
		swatchRadius: number;
		labelMaxLength: number;
	};
	caption: {
		y: number;
		maxWidth: number;
		fontSize: number;
		lineHeight: number;
	};
	footerY: number;
}

const MAX_CAPTION_LENGTH = 280;
const MAX_CAPTION_LINES = 3;
const POSTER_LEGEND_MAX_ITEMS = 7;
const POSTER_CONTEXT_FONT =
	'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
const POSTER_FOOTER_FONT = 'ui-sans-serif, system-ui, sans-serif';
const POSTER_FOOTER_INSET = 48;
// This stack is intentionally system-only: the downloaded SVG carries no font
// payload and the PNG/JPG rasterization uses the same family available to Obsidian.
const POSTER_CAPTION_FONT =
	"Georgia, 'Times New Roman', 'Songti SC', STSong, SimSun, serif";

/**
 * Shared Wide-caption metrics for the DOM editor and standalone SVG. Keeping
 * both surfaces on this single scale prevents a three-line editor from drifting
 * upward into the chart when the preview frame shrinks.
 */
export const WIDE_POSTER_CAPTION_PREVIEW = {
	sourceWidth: 1440,
	/** Horizontal space reserved for the caption inside the Wide poster. */
	widthPercent: 70,
	/** Caption glyph size relative to the Wide poster's source width. */
	fontSizePercent: 2,
	/** Unitless line height shared by the SVG and responsive preview. */
	lineHeightMultiplier: 1.3,
	editorBottomPercent: 12,
} as const;

export function inlineChartColor(color: string, theme?: PosterTheme): string {
	const resolved = completePosterTheme(theme);
	return resolved.chartColors[color] ?? resolved.muted;
}

/** Escapes every user-derived SVG text or attribute value. */
export function escapeXml(value: string): string {
	return toWellFormedUnicode(value)
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&apos;');
}

export function posterMimeType(format: PosterFormat): string {
	return format === 'svg'
		? 'image/svg+xml'
		: format === 'png'
			? 'image/png'
			: 'image/jpeg';
}

/** Produces a bounded ASCII filename without user-controlled path segments. */
export function safePosterFilename(
	query: DistributionQuery,
	layout: PosterLayout,
	format: PosterFormat,
): string {
	const range =
		query.range.mode === 'day'
			? query.range.localDate
			: query.range.mode === 'all'
				? 'all'
				: `${String(query.range.days)}-day-average`;
	const safePath =
		toWellFormedUnicode(query.path || 'vault')
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
	const chart = posterChartModel(request.distribution);
	const geometry = layoutGeometry(request.layout, chart.items.length);
	const theme = completePosterTheme(request.theme);
	const query = request.query;
	const pathLabel = query.path ? `Vault / ${query.path}` : 'Vault';
	const title = `Activity Map ${metricLabel(query.metric)} poster`;
	const description =
		chart.items.length === 0
			? `${title}. No activity in ${rangeLabel(query)}.`
			: `${title}. ${chart.items.map((item) => `${item.label}: ${formatMetric(item.value, query.metric, request.distribution.denominatorDays)} (${formatPercent(item.percentOfScope)})`).join('; ')}.`;
	const donut = renderDonut(
		chart,
		geometry,
		query,
		request.distribution.denominatorDays,
		theme,
	);
	const legend = renderLegend(
		chart,
		geometry,
		query,
		request.distribution.denominatorDays,
		theme,
	);
	const header = renderHeader(geometry, query, theme);
	const caption = normalizedCaption(request.caption);
	const captionMarkup = renderCaption(caption, geometry, theme);
	const emptyState =
		chart.items.length === 0
			? `<text x="${geometry.donut.x}" y="${geometry.donut.y}" text-anchor="middle" fill="${escapeXml(theme.muted)}" font-family="${escapeXml(theme.fontFamily)}" font-size="18">No activity in this range</text>`
			: '';
	const footer = `<text x="${geometry.width - POSTER_FOOTER_INSET}" y="${geometry.footerY}" text-anchor="end" fill="${escapeXml(theme.muted)}" font-family="${POSTER_FOOTER_FONT}" font-size="15" letter-spacing="0.3">Activity Map · Local-first activity insight</text>`;
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${geometry.width}" height="${geometry.height}" viewBox="0 0 ${geometry.width} ${geometry.height}" role="img" aria-labelledby="activity-map-poster-title activity-map-poster-desc"><title id="activity-map-poster-title">${escapeXml(title)}</title><desc id="activity-map-poster-desc">${escapeXml(description)}</desc><rect width="${geometry.width}" height="${geometry.height}" fill="${escapeXml(theme.background)}"/><image href="${escapeXml(request.wordmarkDataUrl)}" x="${geometry.wordmark.x}" y="${geometry.wordmark.y}" width="${geometry.wordmark.width}" height="${geometry.wordmark.height}" preserveAspectRatio="xMinYMid meet"/>${header}<g role="list" aria-label="Activity distribution">${donut}</g>${emptyState}<text x="${geometry.path.x}" y="${geometry.path.y}" text-anchor="${geometry.path.anchor}" fill="${escapeXml(theme.muted)}" font-family="${escapeXml(theme.fontFamily)}" font-size="${geometry.path.size}" font-weight="400">${escapeXml(truncate(pathLabel, request.layout === 'compact' ? 30 : 48))}</text>${legend}${captionMarkup}${footer}</svg>`;
	return {
		layout: request.layout,
		width: geometry.width,
		height: geometry.height,
		svg,
		filename: safePosterFilename(query, request.layout, 'svg'),
		chart,
	};
}

function renderHeader(
	geometry: PosterGeometry,
	query: DistributionQuery,
	theme: PosterTheme,
): string {
	const metric = metricLabel(query.metric).toUpperCase();
	const range = rangeLabel(query);
	return `<text x="${geometry.header.x}" y="${geometry.header.metricY}" text-anchor="end" fill="${escapeXml(theme.muted)}" font-family="${POSTER_CONTEXT_FONT}" font-size="${geometry.header.metricSize}" letter-spacing="1.6">${escapeXml(metric)}</text><text x="${geometry.header.x}" y="${geometry.header.rangeY}" text-anchor="end" fill="${escapeXml(theme.text)}" font-family="${escapeXml(theme.fontFamily)}" font-size="${geometry.header.rangeSize}" font-weight="600">${escapeXml(range)}</text>`;
}

function renderCaption(
	caption: string,
	geometry: PosterGeometry,
	theme: PosterTheme,
): string {
	if (!caption) return '';
	const lines = wrapCaption(
		caption,
		geometry.caption.maxWidth,
		geometry.caption.fontSize,
	);
	const firstLineY =
		geometry.caption.y - (lines.length - 1) * geometry.caption.lineHeight;
	const centerX = geometry.width / 2;
	const spans = lines
		.map(
			(line, index) =>
				`<tspan x="${centerX}"${index === 0 ? '' : ` dy="${geometry.caption.lineHeight}"`}>${escapeXml(line)}</tspan>`,
		)
		.join('');
	return `<text x="${centerX}" y="${firstLineY}" text-anchor="middle" fill="${escapeXml(theme.text)}" font-family="${POSTER_CAPTION_FONT}" font-size="${geometry.caption.fontSize}" font-weight="600">${spans}</text>`;
}

function renderDonut(
	chart: ChartModel,
	geometry: PosterGeometry,
	query: DistributionQuery,
	denominatorDays: number | null,
	theme: PosterTheme,
): string {
	const { x, y, outer, inner } = geometry.donut;
	const slices = chart.items
		.map((item) => {
			const label = `${item.label}, ${formatPercent(item.percentOfScope)}, ${formatMetric(item.value, query.metric, denominatorDays)}`;
			return `<path d="${donutPath(x, y, outer, inner, item.startAngle, item.endAngle)}" fill="${escapeXml(inlineChartColor(item.color, theme))}" stroke="${escapeXml(theme.background)}" stroke-width="3" role="listitem" aria-label="${escapeXml(label)}"><title>${escapeXml(label)}</title></path>`;
		})
		.join('');
	const center =
		chart.items.length > 0
			? `<text x="${x}" y="${y + geometry.donut.inner * 0.16}" text-anchor="middle" fill="${escapeXml(theme.text)}" font-family="Georgia, Times New Roman, serif" font-size="${geometry.donut.inner > 100 ? 46 : 32}" font-weight="600">${escapeXml(formatMetric(chart.total, query.metric, denominatorDays))}</text>`
			: '';
	return `${slices}${center}`;
}

function renderLegend(
	chart: ChartModel,
	geometry: PosterGeometry,
	query: DistributionQuery,
	denominatorDays: number | null,
	theme: PosterTheme,
): string {
	return chart.items
		.map((item, index) => {
			const y = geometry.legend.y + index * geometry.legend.rowHeight;
			const color = inlineChartColor(item.color, theme);
			const label = truncate(item.label, geometry.legend.labelMaxLength);
			const value = formatMetric(
				item.value,
				query.metric,
				denominatorDays,
			);
			return `<g><circle cx="${geometry.legend.x}" cy="${y}" r="${geometry.legend.swatchRadius}" fill="${escapeXml(color)}" stroke="${escapeXml(theme.border)}" stroke-width="1"/><text x="${geometry.legend.x + geometry.legend.swatchRadius * 2 + 16}" y="${y + geometry.legend.labelSize * 0.34}" fill="${escapeXml(theme.muted)}" font-family="${escapeXml(theme.fontFamily)}" font-size="${geometry.legend.labelSize}" font-weight="400">${escapeXml(label)}</text><text x="${geometry.legend.valueX}" y="${y + geometry.legend.valueSize * 0.34}" text-anchor="end" fill="${escapeXml(theme.muted)}" font-family="${escapeXml(theme.fontFamily)}" font-size="${geometry.legend.valueSize}" font-weight="400">${escapeXml(value)}</text><text x="${geometry.legend.percentX}" y="${y + geometry.legend.valueSize * 0.34}" text-anchor="end" fill="${escapeXml(theme.muted)}" font-family="${escapeXml(theme.fontFamily)}" font-size="${geometry.legend.valueSize}" font-weight="400">${escapeXml(formatPercent(item.percentOfScope))}</text></g>`;
		})
		.join('');
}

function posterChartModel(distribution: DistributionResult): ChartModel {
	const chart = buildChartModel(distribution);
	if (chart.items.length <= POSTER_LEGEND_MAX_ITEMS) return chart;
	const visible = chart.items.slice(0, POSTER_LEGEND_MAX_ITEMS - 1);
	const remainder = chart.items.slice(POSTER_LEGEND_MAX_ITEMS - 1);
	const remainderValue = remainder.reduce(
		(total, item) => total + item.value,
		0,
	);
	const items = [
		...visible,
		{
			...remainder[0]!,
			id: 'group:other',
			kind: 'other' as const,
			label: 'Other',
			path: null,
			value: remainderValue,
			percentOfScope: chart.total > 0 ? remainderValue / chart.total : 0,
			memberIds: remainder.flatMap((item) => item.memberIds),
			color: stableColor('group:other'),
		},
	];
	let cursor = -Math.PI / 2;
	return {
		total: chart.total,
		items: items.map((item): ChartItem => {
			const startAngle = cursor;
			const endAngle =
				startAngle +
				(chart.total > 0
					? (item.value / chart.total) * Math.PI * 2
					: 0);
			cursor = endAngle;
			return { ...item, startAngle, endAngle };
		}),
	};
}

function layoutGeometry(
	layout: PosterLayout,
	itemCount: number,
): PosterGeometry {
	if (layout === 'wide') {
		return {
			width: WIDE_POSTER_CAPTION_PREVIEW.sourceWidth,
			height: 760,
			wordmark: { x: 56, y: 28, width: 172, height: 80 },
			header: {
				x: 1372,
				metricY: 55,
				rangeY: 83,
				metricSize: 15,
				rangeSize: 22,
			},
			// Keep the legend's first swatch on the donut's top edge. The tighter
			// seven-row block leaves a dedicated lower band for three caption lines.
			donut: { x: 330, y: 317, outer: 165, inner: 104 },
			path: { x: 330, y: 526, anchor: 'middle', size: 27 },
			legend: {
				x: 590,
				y: 161,
				valueX: 1110,
				percentX: 1240,
				rowHeight: 53,
				labelSize: 23,
				valueSize: 22,
				swatchRadius: 9,
				labelMaxLength: 24,
			},
			caption: {
				y: 704,
				maxWidth: wideCaptionSourceWidth(),
				fontSize: wideCaptionSourceFontSize(),
				lineHeight: wideCaptionSourceLineHeight(),
			},
			footerY: 742,
		};
	}
	if (layout === 'compact') {
		const height = Math.max(1160, 620 + itemCount * 66 + 190);
		return {
			width: 820,
			height,
			wordmark: { x: 44, y: 28, width: 150, height: 70 },
			header: {
				x: 768,
				metricY: 55,
				rangeY: 79,
				metricSize: 12,
				rangeSize: 16,
			},
			donut: { x: 410, y: 370, outer: 170, inner: 98 },
			path: { x: 410, y: 594, anchor: 'middle', size: 27 },
			legend: {
				x: 78,
				y: 684,
				valueX: 606,
				percentX: 742,
				rowHeight: 66,
				labelSize: 21,
				valueSize: 20,
				swatchRadius: 8,
				labelMaxLength: 20,
			},
			caption: {
				y: height - 86,
				maxWidth: 520,
				fontSize: 44,
				lineHeight: 52,
			},
			footerY: height - 30,
		};
	}
	const height = Math.max(1220, 600 + itemCount * 68 + 220);
	return {
		width: 960,
		height,
		wordmark: { x: 48, y: 28, width: 160, height: 74 },
		header: {
			x: 912,
			metricY: 58,
			rangeY: 84,
			metricSize: 13,
			rangeSize: 18,
		},
		donut: { x: 280, y: 338, outer: 188, inner: 110 },
		path: { x: 280, y: 590, anchor: 'middle', size: 26 },
		legend: {
			x: 540,
			y: 198,
			valueX: 820,
			percentX: 920,
			rowHeight: 68,
			labelSize: 21,
			valueSize: 20,
			swatchRadius: 8,
			labelMaxLength: 20,
		},
		caption: {
			y: height - 86,
			maxWidth: 620,
			fontSize: 46,
			lineHeight: 54,
		},
		footerY: height - 30,
	};
}

function wideCaptionSourceWidth(): number {
	return Math.round(
		(WIDE_POSTER_CAPTION_PREVIEW.sourceWidth *
			WIDE_POSTER_CAPTION_PREVIEW.widthPercent) /
			100,
	);
}

function wideCaptionSourceFontSize(): number {
	return Math.round(
		(WIDE_POSTER_CAPTION_PREVIEW.sourceWidth *
			WIDE_POSTER_CAPTION_PREVIEW.fontSizePercent) /
			100,
	);
}

function wideCaptionSourceLineHeight(): number {
	return Math.round(
		wideCaptionSourceFontSize() *
			WIDE_POSTER_CAPTION_PREVIEW.lineHeightMultiplier,
	);
}

function normalizedCaption(caption: string | undefined): string {
	return takeUnicodeScalars(
		toWellFormedUnicode(caption ?? '')
			.replace(/\r\n?/g, '\n')
			.trim(),
		MAX_CAPTION_LENGTH,
	);
}

/**
 * Keeps the DOM-independent SVG renderer within the preview's caption column.
 * SVG serialization cannot measure the host font, so this intentionally
 * conservative width model favors an earlier wrap over text spilling into the
 * chart. The textarea remains the only editable layer in the mounted preview.
 */
function wrapCaption(
	caption: string,
	maxWidth: number,
	fontSize: number,
): string[] {
	const lines: string[] = [];
	for (const paragraph of caption.split('\n')) {
		const wrapped = wrapCaptionParagraph(paragraph, maxWidth, fontSize);
		if (wrapped.length > 0) lines.push(...wrapped);
	}
	if (lines.length <= MAX_CAPTION_LINES) return lines;
	const visible = lines.slice(0, MAX_CAPTION_LINES);
	visible[MAX_CAPTION_LINES - 1] = truncateCaptionLine(
		visible[MAX_CAPTION_LINES - 1] ?? '',
		maxWidth,
		fontSize,
	);
	return visible;
}

function wrapCaptionParagraph(
	paragraph: string,
	maxWidth: number,
	fontSize: number,
): string[] {
	const tokens = paragraph.trim().match(/\S+/gu) ?? [];
	const lines: string[] = [];
	let line = '';
	for (const token of tokens) {
		const candidate = line ? `${line} ${token}` : token;
		if (captionWidth(candidate, fontSize) <= maxWidth) {
			line = candidate;
			continue;
		}
		if (line) lines.push(line);
		if (captionWidth(token, fontSize) <= maxWidth) {
			line = token;
			continue;
		}
		const characters = Array.from(token);
		line = '';
		for (const character of characters) {
			if (
				line &&
				captionWidth(`${line}${character}`, fontSize) > maxWidth
			) {
				lines.push(line);
				line = character;
			} else {
				line += character;
			}
		}
	}
	if (line) lines.push(line);
	return lines;
}

function truncateCaptionLine(
	value: string,
	maxWidth: number,
	fontSize: number,
): string {
	const characters = Array.from(value.trimEnd());
	while (
		characters.length > 0 &&
		captionWidth(`${characters.join('')}…`, fontSize) > maxWidth
	)
		characters.pop();
	return `${characters.join('').trimEnd()}…`;
}

function captionWidth(value: string, fontSize: number): number {
	return Array.from(value).reduce(
		(width, character) =>
			width + captionCharacterWidth(character) * fontSize,
		0,
	);
}

function captionCharacterWidth(character: string): number {
	if (/\s/u.test(character)) return 0.34;
	const codePoint = character.codePointAt(0) ?? 0;
	if (codePoint >= 0x2e80) return 1;
	if (/[ilI|!.,'`:;]/u.test(character)) return 0.31;
	if (/[MW@%&]/u.test(character)) return 0.86;
	return 0.55;
}

function truncate(value: string, maxLength: number): string {
	const characters = Array.from(toWellFormedUnicode(value));
	return characters.length <= maxLength
		? characters.join('')
		: `${characters.slice(0, Math.max(0, maxLength - 1)).join('')}…`;
}

/** Replaces malformed UTF-16 so later URI encoding cannot throw in the preview. */
function toWellFormedUnicode(value: string): string {
	let normalized = '';
	for (let index = 0; index < value.length; index += 1) {
		const codeUnit = value.charCodeAt(index);
		if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
			const next = value.charCodeAt(index + 1);
			if (next >= 0xdc00 && next <= 0xdfff) {
				normalized += value[index]! + value[index + 1]!;
				index += 1;
			} else {
				normalized += '\uFFFD';
			}
			continue;
		}
		if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
			normalized += '\uFFFD';
			continue;
		}
		normalized += value[index]!;
	}
	return normalized;
}

function takeUnicodeScalars(value: string, maximum: number): string {
	return Array.from(value).slice(0, maximum).join('');
}

function rangeLabel(query: DistributionQuery): string {
	if (query.range.mode === 'day') return query.range.localDate;
	if (query.range.mode === 'all') return 'All history';
	return query.range.days === 'all'
		? 'All-history daily average'
		: `${String(query.range.days)}-day average`;
}
