import { describe, expect, it } from '../helpers/test-harness';

import type { DistributionItem, DistributionResult } from '../../src/query/distribution-query';
import { PosterExportSession } from '../../src/export/poster-export-session';

function distribution(): DistributionResult {
	const item: DistributionItem = {
		id: 'dir:projects', kind: 'directory', label: 'Projects', path: 'projects', value: 90_000,
		percentOfScope: 1, memberIds: ['file-a'],
	};
	return {
		query: { metric: 'activeMs', range: { mode: 'day', localDate: '2026-07-21' }, path: 'work/projects', view: 'children', groupBy: 'path' },
		maxChartItems: 8,
		scopeTotal: 90_000, vaultTotal: 90_000, percentOfVault: 1, denominatorDays: null,
		coverage: { firstDate: '2026-07-21', lastDate: '2026-07-21' }, chartItems: [item], detailItems: [item], warnings: [],
	};
}

describe('poster export session', () => {
	it('freezes the opened query snapshot while the source model later changes', () => {
		const source = distribution();
		const session = createSession(source);
		source.query.path = 'later-navigation';
		source.chartItems[0]!.label = 'Later label';
		const preview = session.preview().svg;
		expect(preview.includes('Vault / work/projects')).toBeTrue();
		expect(preview.includes('Later label')).toBeFalse();
	});

	it('downloads exactly the current preview SVG for SVG, PNG, and JPG', async () => {
		const source = distribution();
		const downloads: Array<{ blob: Blob; filename: string }> = [];
		const rasterized: Array<{ svg: string; format: 'png' | 'jpg' }> = [];
		const session = new PosterExportSession({ query: source.query, distribution: source }, {
			wordmarkDataUrl: 'data:image/png;base64,d29yZG1hcms=',
			destination: {
				download(blob, filename) {
					downloads.push({ blob, filename });
					return { outcome: 'downloaded', message: `Downloaded ${filename}` };
				},
			},
			rasterizer: {
				async rasterize(args) {
					rasterized.push({ svg: args.svg, format: args.format });
					return new Blob([args.format], { type: args.format === 'png' ? 'image/png' : 'image/jpeg' });
				},
			},
		});
		session.setCaption('A focused caption');
		const svgPreview = session.preview().svg;
		await session.download();
		expect(await downloads[0]?.blob.text()).toBe(svgPreview);
		expect(downloads[0]?.filename.endsWith('.svg')).toBeTrue();

		session.setLayout('wide');
		session.setFormat('png');
		const pngPreview = session.preview().svg;
		await session.download();
		expect(rasterized[0]).toEqual({ svg: pngPreview, format: 'png' });
		expect(downloads[1]?.filename.endsWith('-wide.png')).toBeTrue();

		session.setLayout('compact');
		session.setFormat('jpg');
		const jpgPreview = session.preview().svg;
		await session.download();
		expect(rasterized[1]).toEqual({ svg: jpgPreview, format: 'jpg' });
		expect(downloads[2]?.filename.endsWith('-compact.jpg')).toBeTrue();
		expect(downloads).toHaveLength(3);
	});
});

function createSession(source: DistributionResult): PosterExportSession {
	return new PosterExportSession({ query: source.query, distribution: source }, {
		wordmarkDataUrl: 'data:image/png;base64,d29yZG1hcms=',
		destination: { download: () => ({ outcome: 'downloaded', message: 'Downloaded' }) },
		rasterizer: { async rasterize() { return new Blob(); } },
	});
}
