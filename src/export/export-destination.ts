import type { PosterFormat } from './poster-exporter';

export interface ExportDestinationResult {
	outcome: 'downloaded' | 'unavailable';
	message: string;
}

export interface SvgRasterizer {
	rasterize(args: {
		svg: string;
		width: number;
		height: number;
		format: Exclude<PosterFormat, 'svg'>;
	}): Promise<Blob>;
}

/** Standard-Web-API download boundary, capability-gated per owner document. */
export class BrowserExportDestination {
	constructor(private readonly document: Document) {}

	download(blob: Blob, filename: string): ExportDestinationResult {
		const win = this.document.defaultView;
		if (!win || typeof win.URL?.createObjectURL !== 'function') {
			return {
				outcome: 'unavailable',
				message: 'Local download is unavailable on this platform.',
			};
		}
		const url = win.URL.createObjectURL(blob);
		try {
			const anchor = this.document.body.createEl('a');
			anchor.href = url;
			anchor.download = filename;
			anchor.hidden = true;
			anchor.click();
			anchor.remove();
			return { outcome: 'downloaded', message: `Downloaded ${filename}` };
		} finally {
			win.URL.revokeObjectURL(url);
		}
	}
}

/**
 * Converts the already-generated standalone SVG into a raster file. This is a
 * byte conversion boundary: it never reads or captures mounted application UI.
 */
export class BrowserSvgRasterizer implements SvgRasterizer {
	constructor(private readonly document: Document) {}

	async rasterize(args: {
		svg: string;
		width: number;
		height: number;
		format: Exclude<PosterFormat, 'svg'>;
	}): Promise<Blob> {
		const win = this.document.defaultView;
		if (!win || typeof win.URL?.createObjectURL !== 'function') {
			throw new Error('Poster rasterization is unavailable on this platform.');
		}
		const canvas = this.document.body.createEl('canvas');
		canvas.remove();
		const context = canvas.getContext('2d');
		if (!context || typeof canvas.toBlob !== 'function') {
			throw new Error('Poster rasterization is unavailable on this platform.');
		}
		canvas.width = args.width;
		canvas.height = args.height;
		const svgUrl = win.URL.createObjectURL(
			new Blob([args.svg], { type: 'image/svg+xml;charset=utf-8' }),
		);
		try {
			const image = await loadImage(this.document, svgUrl);
			context.drawImage(image, 0, 0, args.width, args.height);
			return await new Promise<Blob>((resolve, reject) => {
				canvas.toBlob(
					(blob) => {
						if (blob) resolve(blob);
						else reject(new Error('Poster rasterization did not produce an image.'));
					},
					args.format === 'png' ? 'image/png' : 'image/jpeg',
				);
			});
		} finally {
			win.URL.revokeObjectURL(svgUrl);
		}
	}
}

function loadImage(document: Document, src: string): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const image = document.body.createEl('img');
		image.remove();
		image.onload = () => resolve(image);
		image.onerror = () => reject(new Error('Poster SVG could not be rasterized.'));
		image.src = src;
	});
}
