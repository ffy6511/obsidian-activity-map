import { describe, expect, it } from '../helpers/test-harness';

import type { DistributionItem, DistributionResult } from '../../src/query/distribution-query';
import {
	POSTER_PNG_RASTER_SCALE,
	PosterExportSession,
} from '../../src/export/poster-export-session';
import { DEFAULT_POSTER_THEME } from '../../src/export/poster-theme';

function distribution(): DistributionResult {
	const item: DistributionItem = {
		id: 'dir:projects',
		kind: 'directory',
		label: 'Projects',
		path: 'projects',
		value: 90_000,
		percentOfScope: 1,
		memberIds: ['file-a'],
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
		scopeTotal: 90_000,
		vaultTotal: 90_000,
		percentOfVault: 1,
		denominatorDays: null,
		coverage: { firstDate: '2026-07-21', lastDate: '2026-07-21' },
		chartItems: [item],
		detailItems: [item],
		warnings: [],
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

	it('defaults to a high-resolution Wide PNG while retaining SVG and JPG export support', async () => {
		const source = distribution();
		const downloads: Array<{ blob: Blob; filename: string }> = [];
		const rasterized: Array<{
			svg: string;
			width: number;
			height: number;
			format: 'png' | 'jpg';
		}> = [];
		const session = new PosterExportSession(
			{ query: source.query, distribution: source },
			{
				wordmarkDataUrl: 'data:image/png;base64,d29yZG1hcms=',
				theme: DEFAULT_POSTER_THEME,
				destination: {
					download(blob, filename) {
						downloads.push({ blob, filename });
						return { outcome: 'downloaded', message: `Downloaded ${filename}` };
					},
				},
				rasterizer: {
					async rasterize(args) {
						rasterized.push(args);
						return new Blob([args.format], {
							type: args.format === 'png' ? 'image/png' : 'image/jpeg',
						});
					},
				},
			},
		);
		expect(session.getLayout()).toBe('wide');
		expect(session.getFormat()).toBe('png');
		expect(session.getExportLabel()).toBe('Wide PNG');
		session.setCaption('A focused caption');
		const pngPreview = session.preview();
		await session.download();
		expect(rasterized[0]).toEqual({
			svg: pngPreview.svg,
			width: pngPreview.width * POSTER_PNG_RASTER_SCALE,
			height: pngPreview.height * POSTER_PNG_RASTER_SCALE,
			format: 'png',
		});
		expect(downloads[0]?.filename.endsWith('-wide.png')).toBeTrue();
		expect(pngPreview.width * POSTER_PNG_RASTER_SCALE).toBe(2_880);
		expect(pngPreview.height * POSTER_PNG_RASTER_SCALE).toBe(1_520);

		session.setFormat('svg');
		const svgPreview = session.preview().svg;
		await session.download();
		expect(await downloads[1]?.blob.text()).toBe(svgPreview);
		expect(downloads[1]?.filename.endsWith('.svg')).toBeTrue();

		session.setLayout('compact');
		session.setFormat('jpg');
		const jpgPreview = session.preview().svg;
		await session.download();
		expect(rasterized[1]).toEqual({ svg: jpgPreview, width: 820, height: 1160, format: 'jpg' });
		expect(downloads[2]?.filename.endsWith('-compact.jpg')).toBeTrue();
		expect(downloads).toHaveLength(3);
	});

	it('omits the SVG caption only for the live editor preview, never the downloaded poster', () => {
		const session = createSession(distribution());
		session.setCaption('One visible caption');
		expect(
			session.preview({ includeCaption: false }).svg.includes('One visible caption'),
		).toBeFalse();
		expect(session.preview().svg.includes('One visible caption')).toBeTrue();
	});

	it('keeps an editable safe file stem while its extension follows the selected format', () => {
		const session = createSession(distribution());
		expect(session.getFilename().endsWith('-wide.png')).toBeTrue();
		session.setFilename('weekly\\activity/poster.png');
		expect(session.getFilename()).toBe('weekly-activity-poster.png');
		session.setFormat('jpg');
		expect(session.getFilename()).toBe('weekly-activity-poster.jpg');
	});
});

function createSession(source: DistributionResult): PosterExportSession {
	return new PosterExportSession(
		{ query: source.query, distribution: source },
		{
			wordmarkDataUrl: 'data:image/png;base64,d29yZG1hcms=',
			theme: DEFAULT_POSTER_THEME,
			destination: { download: () => ({ outcome: 'downloaded', message: 'Downloaded' }) },
			rasterizer: {
				async rasterize() {
					return new Blob();
				},
			},
		},
	);
}
