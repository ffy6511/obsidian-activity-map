import type { DistributionQuery, DistributionResult } from '../query/distribution-query';
import { BrowserExportDestination, type ExportDestinationResult, type SvgRasterizer } from './export-destination';
import {
	posterMimeType,
	renderPoster,
	safePosterFilename,
	type PosterFormat,
	type PosterLayout,
	type PosterRenderResult,
} from './poster-exporter';

export interface PosterSnapshot {
	query: DistributionQuery;
	distribution: DistributionResult;
}

export interface PosterExportSessionDependencies {
	wordmarkDataUrl: string;
	destination: Pick<BrowserExportDestination, 'download'>;
	rasterizer: SvgRasterizer;
}

export interface PosterExportAttempt {
	poster: PosterRenderResult;
	result: ExportDestinationResult;
}

/**
 * Runtime-only export state for one modal instance. The constructor copies the
 * query result because the live Popover may tick or navigate while the user is
 * editing the caption; exported bytes must remain tied to the opened preview.
 */
export class PosterExportSession {
	private readonly snapshot: PosterSnapshot;
	private layout: PosterLayout = 'portrait';
	private format: PosterFormat = 'svg';
	private caption = '';

	constructor(snapshot: PosterSnapshot, private readonly dependencies: PosterExportSessionDependencies) {
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

	setLayout(layout: PosterLayout): void {
		this.layout = layout;
	}

	setFormat(format: PosterFormat): void {
		this.format = format;
	}

	setCaption(caption: string): void {
		this.caption = caption;
	}

	preview(): PosterRenderResult {
		return renderPoster({
			layout: this.layout,
			query: this.snapshot.query,
			distribution: this.snapshot.distribution,
			caption: this.caption,
			wordmarkDataUrl: this.dependencies.wordmarkDataUrl,
		});
	}

	async download(): Promise<PosterExportAttempt> {
		const poster = this.preview();
		const blob = this.format === 'svg'
			? new Blob([poster.svg], { type: posterMimeType('svg') })
			: await this.dependencies.rasterizer.rasterize({
				svg: poster.svg,
				width: poster.width,
				height: poster.height,
				format: this.format,
			});
		return {
			poster,
			result: this.dependencies.destination.download(
				blob,
				safePosterFilename(this.snapshot.query, this.layout, this.format),
			),
		};
	}
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

function copyItem(item: DistributionResult['chartItems'][number]): DistributionResult['chartItems'][number] {
	return { ...item, memberIds: [...item.memberIds] };
}
