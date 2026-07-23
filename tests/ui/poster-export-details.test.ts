import { describe, expect, it } from '../helpers/test-harness';

import type { DistributionItem, DistributionResult } from '../../src/query/distribution-query';
import { PosterExportSession } from '../../src/export/poster-export-session';
import { renderPosterExportDetails } from '../../src/ui/poster-export-details';
import { installDomEnvironment } from '../helpers/dom-environment';

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

describe('poster export disclosure', () => {
	it('shows the frozen scope and updates the actual filename before download', () => {
		const { document } = installDomEnvironment();
		const source = distribution();
		const session = new PosterExportSession({ query: source.query, distribution: source }, {
			wordmarkDataUrl: 'data:image/png;base64,d29yZG1hcms=',
			destination: { download: () => ({ outcome: 'downloaded', message: 'Downloaded' }) },
			rasterizer: { async rasterize() { return new Blob(); } },
		});
		const container = document.createElement('div');
		document.body.appendChild(container);
		const details = renderPosterExportDetails({ container, session });
		expect(container.querySelector('[data-activity-map-id="poster-scope"]')?.textContent)
			.toBe('Frozen result: Activity · 2026-07-21 · Vault / work/projects.');
		expect(container.querySelector('[data-activity-map-id="poster-filename"]')?.textContent)
			.toBe('Download: activity-map-activeMs-2026-07-21-work-projects-portrait.svg');

		session.setLayout('wide');
		session.setFormat('png');
		details.update();
		expect(container.querySelector('[data-activity-map-id="poster-filename"]')?.textContent)
			.toBe('Download: activity-map-activeMs-2026-07-21-work-projects-wide.png');
	});
});
