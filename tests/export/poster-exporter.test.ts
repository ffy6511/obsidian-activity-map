import { describe, expect, it } from '../helpers/test-harness';

import type { DistributionItem, DistributionResult } from '../../src/query/distribution-query';
import {
	WIDE_POSTER_CAPTION_PREVIEW,
	escapeXml,
	inlineChartColor,
	posterMimeType,
	renderPoster,
	safePosterFilename,
} from '../../src/export/poster-exporter';
import { DEFAULT_POSTER_THEME, type PosterTheme } from '../../src/export/poster-theme';

const wordmark = 'data:image/png;base64,d29yZG1hcms=';

function wideCaptionMetrics(): { fontSize: number; lineHeight: number } {
	const fontSize = Math.round(
		(WIDE_POSTER_CAPTION_PREVIEW.sourceWidth * WIDE_POSTER_CAPTION_PREVIEW.fontSizePercent) /
			100,
	);
	return {
		fontSize,
		lineHeight: Math.round(fontSize * WIDE_POSTER_CAPTION_PREVIEW.lineHeightMultiplier),
	};
}

function distribution(label = 'Projects'): DistributionResult {
	const item: DistributionItem = {
		id: 'dir:projects',
		kind: 'directory',
		label,
		path: 'projects',
		value: 90_000,
		percentOfScope: 0.75,
		memberIds: ['file-a'],
	};
	const other: DistributionItem = {
		id: 'group:other',
		kind: 'other',
		label: 'Other',
		path: null,
		value: 30_000,
		percentOfScope: 0.25,
		memberIds: ['file-b'],
	};
	return {
		query: {
			metric: 'activeMs',
			range: { mode: 'day', localDate: '2026-07-21' },
			path: 'work/projects',
			view: 'children',
			groupBy: 'path',
		},
		maxChartItems: 8,
		scopeTotal: 120_000,
		vaultTotal: 150_000,
		percentOfVault: 0.8,
		denominatorDays: null,
		coverage: { firstDate: '2026-07-20', lastDate: '2026-07-21' },
		chartItems: [item, other],
		detailItems: [item, other],
		warnings: [],
	};
}

describe('poster exporter', () => {
	it('renders every layout as an accessible complete poster with the supplied wordmark', () => {
		for (const layout of ['portrait', 'wide', 'compact'] as const) {
			const source = distribution();
			const result = renderPoster({
				layout,
				query: source.query,
				distribution: source,
				wordmarkDataUrl: wordmark,
			});
			expect(result.svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBeTrue();
			expect(result.svg.endsWith('</svg>')).toBeTrue();
			expect(
				result.svg.includes(
					'<title id="activity-map-poster-title">Activity Map Activity poster</title>',
				),
			).toBeTrue();
			expect(result.svg.includes('<desc id="activity-map-poster-desc">')).toBeTrue();
			expect(result.svg.includes(`href="${wordmark}"`)).toBeTrue();
			expect(result.svg.includes('Vault / work/projects')).toBeTrue();
			expect(result.svg.includes('1m 30s')).toBeTrue();
			expect(result.svg.includes('75%')).toBeTrue();
			for (const item of result.chart.items)
				expect(result.svg.includes(`fill="${inlineChartColor(item.color)}"`)).toBeTrue();
			expect(result.svg.includes('var(--')).toBeFalse();
			expect(result.filename.endsWith(`-${layout}.svg`)).toBeTrue();
		}
	});

	it('escapes all user-derived strings and omits an absent caption', () => {
		const source = distribution('</text><script>alert("x")</script><text>');
		source.query.path = '../../<svg onload="alert(1)">';
		const result = renderPoster({
			layout: 'portrait',
			query: source.query,
			distribution: source,
			wordmarkDataUrl: wordmark,
			caption: '<img src=x onerror=alert(1)>',
		});
		expect(result.svg.includes('<script>')).toBeFalse();
		expect(result.svg.includes('<img')).toBeFalse();
		expect(result.svg.includes('onload="alert(1)"')).toBeFalse();
		expect(result.svg.includes('&lt;script&gt;')).toBeTrue();
		expect(result.svg.includes('&lt;img')).toBeTrue();
		expect(result.filename.includes('/')).toBeFalse();
		const withoutCaption = renderPoster({
			layout: 'compact',
			query: source.query,
			distribution: source,
			wordmarkDataUrl: wordmark,
		});
		expect(withoutCaption.svg.includes('Optional caption')).toBeFalse();
	});

	it('keeps SVG text URI-safe at Unicode truncation boundaries', () => {
		const source = distribution(`${'l'.repeat(18)}😀z`);
		source.query.path = `${'p'.repeat(28)}😀z`;
		const result = renderPoster({
			layout: 'compact',
			query: source.query,
			distribution: source,
			wordmarkDataUrl: wordmark,
			caption: `${'c'.repeat(279)}😀`,
		});
		const encoded = encodeURIComponent(result.svg);
		expect(encoded.length).toBeGreaterThan(0);
		expect(result.svg.includes('\uD800')).toBeFalse();
		expect(escapeXml('\uD800')).toBe('\uFFFD');
	});

	it('inlines the current theme into the standalone SVG instead of exporting a fixed light poster', () => {
		const theme: PosterTheme = {
			background: '#15171d',
			border: '#353b49',
			text: '#f5f7fb',
			muted: '#aab4c7',
			accent: '#8ba7ff',
			fontFamily: 'Aptos, sans-serif',
			chartColors: Object.fromEntries(
				Object.keys(DEFAULT_POSTER_THEME.chartColors).map((token) => [token, '#4ee0b3']),
			),
		};
		const result = renderPoster({
			layout: 'wide',
			query: distribution().query,
			distribution: distribution(),
			wordmarkDataUrl: wordmark,
			theme,
		});
		for (const color of [theme.background, theme.border, theme.text, theme.muted, '#4ee0b3']) {
			expect(result.svg.includes(color)).toBeTrue();
		}
		expect(result.svg.includes(theme.accent)).toBeFalse();
		expect(result.svg.includes('font-family="Aptos, sans-serif"')).toBeTrue();
		expect(result.svg.includes('#f8fafc')).toBeFalse();
		expect(result.svg.includes('var(--')).toBeFalse();
	});

	it('matches the Popover visual structure: seven legend rows, no underlines, and a path below the donut', () => {
		const source = distribution();
		const items = Array.from({ length: 9 }, (_, index): DistributionItem => ({
			id: `file:${String(index)}`,
			kind: 'file',
			label: `Activity ${String(index + 1)}`,
			path: `activity-${String(index + 1)}.md`,
			value: 9 - index,
			percentOfScope: (9 - index) / 45,
			memberIds: [`file-${String(index)}`],
		}));
		source.scopeTotal = 45;
		source.vaultTotal = 45;
		source.chartItems = items;
		source.detailItems = items;
		const result = renderPoster({
			layout: 'wide',
			query: source.query,
			distribution: source,
			wordmarkDataUrl: wordmark,
		});
		expect(result.chart.items).toHaveLength(7);
		expect(result.chart.items.at(-1)?.label).toBe('Other');
		expect(result.svg.includes('<line ')).toBeFalse();
		expect(result.svg.includes('text-anchor="middle" fill="#64748b"')).toBeTrue();
		expect(result.svg.includes('font-weight="400">Other</text>')).toBeTrue();
	});

	it('uses the Wide poster hierarchy: top wordmark and context, caption above the lower-right local-first footer', () => {
		const captionMetrics = wideCaptionMetrics();
		const result = renderPoster({
			layout: 'wide',
			query: distribution().query,
			distribution: distribution(),
			wordmarkDataUrl: wordmark,
			caption: 'A quiet week of focused writing',
		});
		const wordmarkPosition = result.svg.indexOf('<image href=');
		const context = result.svg.indexOf('ACTIVITY</text>');
		const caption = result.svg.indexOf('A quiet week of focused');
		const footer = result.svg.indexOf('Activity Map · Local-first activity insight</text>');
		expect(wordmarkPosition).toBeGreaterThanOrEqual(0);
		expect(context).toBeGreaterThan(wordmarkPosition);
		expect(caption).toBeGreaterThan(context);
		expect(footer).toBeGreaterThan(caption);
		expect(
			result.svg.includes(
				`font-family="Georgia, 'Times New Roman', 'Songti SC', STSong, SimSun, serif" font-size="${String(captionMetrics.fontSize)}" font-weight="600"`,
			),
		).toBeTrue();
		expect(result.svg.includes('<text x="1392" y="742" text-anchor="end"')).toBeTrue();
		expect(result.svg.includes('@font-face')).toBeFalse();
		expect(result.svg.includes('data:font/')).toBeFalse();
		expect(
			result.svg.includes('ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'),
		).toBeTrue();
	});

	it('bounds captions to three wrapped lines and marks truncated overflow', () => {
		const captionMetrics = wideCaptionMetrics();
		const caption = Array.from({ length: 36 }, () => 'focused').join(' ');
		const result = renderPoster({
			layout: 'wide',
			query: distribution().query,
			distribution: distribution(),
			wordmarkDataUrl: wordmark,
			caption,
		});
		const captionMarkup =
			result.svg.match(
				/<text x="720" y="[^"]+" text-anchor="middle"[^>]*>(.*?)<\/text>/u,
			)?.[1] ?? '';
		expect(captionMarkup.match(/<tspan /gu) ?? []).toHaveLength(3);
		expect(captionMarkup.endsWith('…</tspan>')).toBeTrue();
		expect(captionMarkup.includes(`dy="${String(captionMetrics.lineHeight)}"`)).toBeTrue();
	});

	it('keeps the Wide legend top-aligned with the donut and reserves a lower caption band', () => {
		const captionMetrics = wideCaptionMetrics();
		const result = renderPoster({
			layout: 'wide',
			query: distribution().query,
			distribution: distribution(),
			wordmarkDataUrl: wordmark,
		});
		expect(result.svg.includes('<circle cx="590" cy="161" r="9"')).toBeTrue();
		expect(result.svg.includes('x="330" y="526"')).toBeTrue();
		expect(result.svg.includes('x="1110"')).toBeTrue();
		expect(result.svg.includes('x="1240"')).toBeTrue();
		const caption = renderPoster({
			layout: 'wide',
			query: distribution().query,
			distribution: distribution(),
			wordmarkDataUrl: wordmark,
			caption: Array.from({ length: 36 }, () => 'focused').join(' '),
		});
		expect(
			caption.svg.includes(
				`<text x="720" y="${String(704 - 2 * captionMetrics.lineHeight)}" text-anchor="middle"`,
			),
		).toBeTrue();
	});

	it('uses bounded layout-aware filenames and matching MIME types', () => {
		const query = distribution().query;
		query.path = '项目 / Quarterly Review';
		expect(safePosterFilename(query, 'wide', 'jpg')).toBe(
			'activity-map-activeMs-2026-07-21-Quarterly-Review-wide.jpg',
		);
		expect(
			safePosterFilename({ ...query, path: 'x'.repeat(200) }, 'portrait', 'png').length,
		).toBeLessThanOrEqual(120);
		expect(posterMimeType('svg')).toBe('image/svg+xml');
		expect(posterMimeType('png')).toBe('image/png');
		expect(posterMimeType('jpg')).toBe('image/jpeg');
	});
});
