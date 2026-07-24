import { describe, expect, it } from '../helpers/test-harness';

import type { DistributionItem, DistributionResult } from '../../src/query/distribution-query';
import { PosterExportSession } from '../../src/export/poster-export-session';
import { DEFAULT_POSTER_THEME } from '../../src/export/poster-theme';
import { renderPosterExportDetails } from '../../src/ui/poster-export-details';
import { installDomEnvironment } from '../helpers/dom-environment';

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

describe('poster export filename', () => {
	it('edits the download name without displaying an export path or frozen-result summary', () => {
		const { document } = installDomEnvironment();
		const source = distribution();
		const session = new PosterExportSession(
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
		const container = document.createElement('div');
		document.body.appendChild(container);
		const details = renderPosterExportDetails({ container, session });
		const filename = container.querySelector<HTMLInputElement>(
			'[data-activity-map-id="poster-filename"]',
		);
		if (!filename) throw new Error('filename input missing');
		expect(container.textContent?.includes('Frozen result:')).toBeFalse();
		expect(filename.getAttribute('aria-label')).toBe('Export file name');
		expect(filename.value).toBe('activity-map-activeMs-2026-07-21-work-projects-wide.png');

		filename.value = 'weekly\\activity/poster.svg';
		filename.dispatchEvent(new Event('input'));
		expect(session.getFilename()).toBe('weekly-activity-poster.png');

		session.setFormat('svg');
		details.update();
		expect(filename.value).toBe('weekly-activity-poster.svg');
	});
});
