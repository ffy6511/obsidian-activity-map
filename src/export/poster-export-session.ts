import type { DistributionQuery, DistributionResult } from '../query/distribution-query';
import {
	BrowserExportDestination,
	type ExportDestinationResult,
	type SvgRasterizer,
} from './export-destination';
import {
	posterMimeType,
	renderPoster,
	safePosterFilename,
	type PosterFormat,
	type PosterLayout,
	type PosterRenderResult,
} from './poster-exporter';
import type { PosterTheme } from './poster-theme';

export interface PosterSnapshot {
	query: DistributionQuery;
	distribution: DistributionResult;
}

export interface PosterExportSessionDependencies {
	wordmarkDataUrl: string;
	theme: PosterTheme;
	destination: Pick<BrowserExportDestination, 'download'>;
	rasterizer: SvgRasterizer;
}

export interface PosterExportAttempt {
	poster: PosterRenderResult;
	result: ExportDestinationResult;
}

/** Retains crisp text at ordinary Retina density without producing oversized files. */
export const POSTER_PNG_RASTER_SCALE = 2;

/**
 * Runtime-only export state for one modal instance. The constructor copies the
 * query result because the live Popover may tick or navigate while the user is
 * editing the caption; exported bytes must remain tied to the opened preview.
 */
export class PosterExportSession {
	private readonly snapshot: PosterSnapshot;
	private layout: PosterLayout = 'wide';
	private format: PosterFormat = 'png';
	private caption = '';
	private filenameInput = '';

	constructor(
		snapshot: PosterSnapshot,
		private readonly dependencies: PosterExportSessionDependencies,
	) {
		this.snapshot = copySnapshot(snapshot);
	}

	getLayout(): PosterLayout {
		return this.layout;
	}

	getFormat(): PosterFormat {
		return this.format;
	}

	getCaption(): string {
		return this.caption;
	}

	/** Filename shown in the modal before the browser download begins. */
	getFilename(): string {
		return this.filenameInput
			? editablePosterFilename(this.filenameInput, this.format)
			: safePosterFilename(this.snapshot.query, this.layout, this.format);
	}

	/** Accessible label of the primary download action for the selected export. */
	getExportLabel(): string {
		const labels: Record<PosterLayout, string> = {
			portrait: 'Portrait',
			wide: 'Wide',
			compact: 'Compact',
		};
		return `${labels[this.layout]} ${this.format.toUpperCase()}`;
	}

	setLayout(layout: PosterLayout): void {
		this.layout = layout;
	}

	setFormat(format: PosterFormat): void {
		this.format = format;
	}

	setCaption(caption: string): void {
		this.caption = caption;
	}

	/** The file stem is user-editable; its safe extension always matches format. */
	setFilename(filename: string): void {
		this.filenameInput = filename;
	}

	preview(options: { includeCaption?: boolean } = {}): PosterRenderResult {
		return renderPoster({
			layout: this.layout,
			query: this.snapshot.query,
			distribution: this.snapshot.distribution,
			caption: options.includeCaption === false ? undefined : this.caption,
			wordmarkDataUrl: this.dependencies.wordmarkDataUrl,
			theme: this.dependencies.theme,
		});
	}

	async download(): Promise<PosterExportAttempt> {
		const poster = this.preview();
		const rasterScale = this.format === 'png' ? POSTER_PNG_RASTER_SCALE : 1;
		const blob =
			this.format === 'svg'
				? new Blob([poster.svg], { type: posterMimeType('svg') })
				: await this.dependencies.rasterizer.rasterize({
						svg: poster.svg,
						width: poster.width * rasterScale,
						height: poster.height * rasterScale,
						format: this.format,
					});
		return {
			poster,
			result: this.dependencies.destination.download(blob, this.getFilename()),
		};
	}
}

function editablePosterFilename(value: string, format: PosterFormat): string {
	const stem =
		Array.from(value, (character) => {
			const codePoint = character.codePointAt(0) ?? 0;
			return codePoint >= 0x20 && codePoint !== 0x7f ? character : '';
		})
			.join('')
			.normalize('NFC')
			.replace(/[\\/]/g, '-')
			.replace(/[<>:"|?*]/g, '')
			.replace(/\.(?:svg|png|jpe?g)$/i, '')
			.replace(/^\.+|[. ]+$/g, '')
			.trim()
			.slice(0, 96) || 'activity-map-export';
	return `${stem}.${format}`;
}

function copySnapshot(snapshot: PosterSnapshot): PosterSnapshot {
	return {
		query: copyQuery(snapshot.query),
		distribution: {
			...snapshot.distribution,
			query: copyQuery(snapshot.distribution.query),
			coverage: snapshot.distribution.coverage ? { ...snapshot.distribution.coverage } : null,
			chartItems: snapshot.distribution.chartItems.map(copyItem),
			detailItems: snapshot.distribution.detailItems.map(copyItem),
			warnings: snapshot.distribution.warnings.map((warning) => ({ ...warning })),
		},
	};
}

function copyQuery(query: DistributionQuery): DistributionQuery {
	return { ...query, range: { ...query.range } };
}

function copyItem(
	item: DistributionResult['chartItems'][number],
): DistributionResult['chartItems'][number] {
	return { ...item, memberIds: [...item.memberIds] };
}
