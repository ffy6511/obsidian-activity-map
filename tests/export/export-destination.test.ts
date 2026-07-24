import { describe, expect, it } from '../helpers/test-harness';

import {
	BrowserExportDestination,
	BrowserSvgRasterizer,
} from '../../src/export/export-destination';

describe('browser export destination', () => {
	it('reports unavailable without a standard download-capable window', () => {
		const destination = new BrowserExportDestination({ defaultView: null } as Document);
		expect(destination.download(new Blob(['x']), 'x.svg')).toEqual({
			outcome: 'unavailable',
			message: 'Local download is unavailable on this platform.',
		});
	});

	it('downloads through a temporary object URL and revokes it', () => {
		let clicked = 0;
		let removed = 0;
		let revoked = '';
		const anchor = {
			href: '',
			download: '',
			hidden: false,
			click: () => {
				clicked += 1;
			},
			remove: () => {
				removed += 1;
			},
		};
		const document = {
			defaultView: {
				URL: {
					createObjectURL: () => 'blob:activity-map',
					revokeObjectURL: (url: string) => {
						revoked = url;
					},
				},
			},
			body: { createEl: () => anchor },
		} as unknown as Document;
		const result = new BrowserExportDestination(document).download(
			new Blob(['<svg/>'], { type: 'image/svg+xml' }),
			'chart.svg',
		);
		expect(result.outcome).toBe('downloaded');
		expect(anchor.download).toBe('chart.svg');
		expect(clicked).toBe(1);
		expect(removed).toBe(1);
		expect(revoked).toBe('blob:activity-map');
	});

	it('rejects raster formats when canvas APIs are unavailable', async () => {
		const rasterizer = new BrowserSvgRasterizer({ defaultView: null } as Document);
		let message = '';
		try {
			await rasterizer.rasterize({ svg: '<svg/>', width: 10, height: 10, format: 'png' });
		} catch (error) {
			message = error instanceof Error ? error.message : String(error);
		}
		expect(message).toBe('Poster rasterization is unavailable on this platform.');
	});
});
