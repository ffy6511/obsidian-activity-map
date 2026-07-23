import { describe, expect, it } from '../helpers/test-harness';

import type { DistributionItem, DistributionResult } from '../../src/query/distribution-query';
import { inlineChartColor, posterMimeType, renderPoster, safePosterFilename } from '../../src/export/poster-exporter';

const wordmark = 'data:image/png;base64,d29yZG1hcms=';

function distribution(label = 'Projects'): DistributionResult {
	const item: DistributionItem = {
		id: 'dir:projects', kind: 'directory', label, path: 'projects', value: 90_000,
		percentOfScope: 0.75, memberIds: ['file-a'],
	};
	const other: DistributionItem = {
		id: 'group:other', kind: 'other', label: 'Other', path: null, value: 30_000,
		percentOfScope: 0.25, memberIds: ['file-b'],
	};
	return {
		query: { metric: 'activeMs', range: { mode: 'day', localDate: '2026-07-21' }, path: 'work/projects', view: 'children', groupBy: 'path' },
		maxChartItems: 8,
		scopeTotal: 120_000, vaultTotal: 150_000, percentOfVault: 0.8, denominatorDays: null,
		coverage: { firstDate: '2026-07-20', lastDate: '2026-07-21' }, chartItems: [item, other], detailItems: [item, other], warnings: [],
	};
}

describe('poster exporter', () => {
	it('renders every layout as an accessible complete poster with the supplied wordmark', () => {
		for (const layout of ['portrait', 'wide', 'compact'] as const) {
			const source = distribution();
			const result = renderPoster({ layout, query: source.query, distribution: source, wordmarkDataUrl: wordmark });
			expect(result.svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBeTrue();
			expect(result.svg.endsWith('</svg>')).toBeTrue();
			expect(result.svg.includes('<title id="activity-map-poster-title">Activity Map Activity poster</title>')).toBeTrue();
			expect(result.svg.includes('<desc id="activity-map-poster-desc">')).toBeTrue();
			expect(result.svg.includes(`href="${wordmark}"`)).toBeTrue();
			expect(result.svg.includes('Vault / work/projects')).toBeTrue();
			expect(result.svg.includes('1m 30s')).toBeTrue();
			expect(result.svg.includes('75%')).toBeTrue();
			for (const item of result.chart.items) expect(result.svg.includes(`fill="${inlineChartColor(item.color)}"`)).toBeTrue();
			expect(result.svg.includes('var(--')).toBeFalse();
			expect(result.filename.endsWith(`-${layout}.svg`)).toBeTrue();
		}
	});

	it('escapes all user-derived strings and omits an absent caption', () => {
		const source = distribution('</text><script>alert("x")</script><text>');
		source.query.path = '../../<svg onload="alert(1)">';
		const result = renderPoster({
			layout: 'portrait', query: source.query, distribution: source, wordmarkDataUrl: wordmark,
			caption: '<img src=x onerror=alert(1)>',
		});
		expect(result.svg.includes('<script>')).toBeFalse();
		expect(result.svg.includes('<img')).toBeFalse();
		expect(result.svg.includes('onload="alert(1)"')).toBeFalse();
		expect(result.svg.includes('&lt;script&gt;')).toBeTrue();
		expect(result.svg.includes('&lt;img')).toBeTrue();
		expect(result.filename.includes('/')).toBeFalse();
		const withoutCaption = renderPoster({ layout: 'compact', query: source.query, distribution: source, wordmarkDataUrl: wordmark });
		expect(withoutCaption.svg.includes('Optional caption')).toBeFalse();
	});

	it('uses bounded layout-aware filenames and matching MIME types', () => {
		const query = distribution().query;
		query.path = '项目 / Quarterly Review';
		expect(safePosterFilename(query, 'wide', 'jpg')).toBe('activity-map-activeMs-2026-07-21-Quarterly-Review-wide.jpg');
		expect(safePosterFilename({ ...query, path: 'x'.repeat(200) }, 'portrait', 'png').length).toBeLessThanOrEqual(120);
		expect(posterMimeType('svg')).toBe('image/svg+xml');
		expect(posterMimeType('png')).toBe('image/png');
		expect(posterMimeType('jpg')).toBe('image/jpeg');
	});
});
