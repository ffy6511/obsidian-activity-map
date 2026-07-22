import { describe, expect, it } from '../helpers/test-harness';

import type { DistributionItem, DistributionResult } from '../../src/query/distribution-query';
import { exportSvg, inlineChartColor, safeSvgFilename } from '../../src/export/svg-exporter';

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
		scopeTotal: 120_000, vaultTotal: 150_000, percentOfVault: 0.8, denominatorDays: null,
		coverage: { firstDate: '2026-07-20', lastDate: '2026-07-21' }, chartItems: [item, other], detailItems: [item, other], warnings: [],
	};
}

describe('standalone SVG exporter', () => {
	it('renders both modes with accessible metadata, inline colors, and exact values', () => {
		for (const mode of ['infographic', 'chart-only'] as const) {
			const source = distribution();
			const result = exportSvg({ mode, title: 'Activity Map', query: source.query, distribution: source });
			expect(result.svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBeTrue();
			expect(result.svg.endsWith('</svg>')).toBeTrue();
			expect(result.svg.includes('<title id="activity-map-title">Activity Map</title>')).toBeTrue();
			expect(result.svg.includes('<desc id="activity-map-desc">')).toBeTrue();
			expect(result.svg.includes('1m 30s')).toBeTrue();
			expect(result.svg.includes('75%')).toBeTrue();
			for (const item of result.chart.items) expect(result.svg.includes(`fill="${inlineChartColor(item.color)}"`)).toBeTrue();
			expect(result.svg.includes('var(--')).toBeFalse();
		}
	});

	it('escapes adversarial labels and paths so markup cannot be injected', () => {
		const source = distribution('</text><script>alert("x")</script><text>');
		source.query.path = '../../<svg onload="alert(1)">';
		const result = exportSvg({ mode: 'infographic', title: '<img src=x onerror=alert(1)>', query: source.query, distribution: source });
		expect(result.svg.includes('<script>')).toBeFalse();
		expect(result.svg.includes('<img')).toBeFalse();
		expect(result.svg.includes('onload="alert(1)"')).toBeFalse();
		expect(result.svg.includes('&lt;script&gt;')).toBeTrue();
		expect(result.filename.includes('/')).toBeFalse();
		expect(result.filename.endsWith('.svg')).toBeTrue();
	});

	it('builds bounded filenames from metric, range, and path', () => {
		const query = distribution().query;
		query.path = '项目 / Quarterly Review';
		expect(safeSvgFilename(query, 'chart-only')).toBe('activity-map-activeMs-2026-07-21-Quarterly-Review-chart-only.svg');
	});
});
