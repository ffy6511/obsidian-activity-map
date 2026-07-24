import { Modal, type App } from 'obsidian';

import { BrowserExportDestination, BrowserSvgRasterizer } from '../export/export-destination';
import { WIDE_POSTER_CAPTION_PREVIEW } from '../export/poster-exporter';
import { PosterExportSession, type PosterSnapshot } from '../export/poster-export-session';
import { POSTER_WORDMARK_DATA_URL } from '../export/poster-wordmark';
import { posterThemeFromDocument } from '../export/poster-theme';
import { renderPosterCaptionEditor, type PosterCaptionEditorHandle } from './poster-caption-editor';

/** A single-use Wide PNG modal with volatile caption state. */
export class PosterExportModal extends Modal {
	private readonly session: PosterExportSession;
	private previewImage: HTMLImageElement | null = null;
	private captionEditor: PosterCaptionEditorHandle | null = null;

	constructor(
		app: App,
		private readonly trigger: HTMLElement,
		snapshot: PosterSnapshot,
		private readonly onClosed?: () => void,
	) {
		super(app);
		const document = trigger.ownerDocument;
		this.session = new PosterExportSession(snapshot, {
			wordmarkDataUrl: POSTER_WORDMARK_DATA_URL,
			theme: posterThemeFromDocument(document),
			destination: new BrowserExportDestination(document),
			rasterizer: new BrowserSvgRasterizer(document),
		});
	}

	onOpen(): void {
		this.modalEl.addClass('activity-map-poster-modal');
		this.setTitle('Export activity poster');
		this.contentEl.empty();
		const frame = this.contentEl.createDiv({ cls: 'activity-map-poster-preview-frame' });
		frame.setCssProps({
			'--activity-map-poster-caption-width': `${String(WIDE_POSTER_CAPTION_PREVIEW.widthPercent)}%`,
			'--activity-map-poster-caption-font-size': `${String(WIDE_POSTER_CAPTION_PREVIEW.fontSizePercent)}cqw`,
			'--activity-map-poster-caption-line-height': String(
				WIDE_POSTER_CAPTION_PREVIEW.lineHeightMultiplier,
			),
			'--activity-map-poster-caption-bottom': `${String(WIDE_POSTER_CAPTION_PREVIEW.editorBottomPercent)}%`,
		});
		const image = frame.createEl('img', {
			cls: 'activity-map-poster-preview-image',
			attr: { alt: 'Activity poster preview' },
		});
		this.previewImage = image;
		const caption = renderPosterCaptionEditor({
			container: frame,
			value: this.session.getCaption(),
			onCaption: (value) => {
				this.session.setCaption(value);
				this.refreshPreview();
			},
		});
		this.captionEditor = caption;
		this.refreshPreview();

		const footer = this.contentEl.createDiv({ cls: 'activity-map-poster-footer' });
		const actions = footer.createDiv({ cls: 'activity-map-poster-actions' });
		const exportButton = actions.createEl('button', {
			text: 'Download',
			cls: 'mod-cta activity-map-poster-export-button',
			attr: {
				'data-activity-map-id': 'poster-export',
				'aria-label': `Download ${this.session.getExportLabel()}`,
			},
		});
		const close = actions.createEl('button', {
			text: 'Cancel',
			cls: 'activity-map-poster-close-button',
		});
		close.addEventListener('click', () => this.close());
		const status = footer.createSpan({
			cls: 'activity-map-poster-status',
			attr: { 'aria-live': 'polite' },
		});
		exportButton.addEventListener('click', () => {
			void this.export(exportButton, close, status);
		});
	}

	onClose(): void {
		this.captionEditor?.destroy();
		this.captionEditor = null;
		this.contentEl.empty();
		this.modalEl.removeClass('activity-map-poster-modal');
		this.previewImage = null;
		this.onClosed?.();
		if (this.trigger.isConnected) this.trigger.focus();
	}

	private refreshPreview(): void {
		const image = this.previewImage;
		if (!image) return;
		const poster = this.session.preview({ includeCaption: false });
		image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(poster.svg)}`;
	}

	private async export(
		exportButton: HTMLButtonElement,
		closeButton: HTMLButtonElement,
		status: HTMLElement,
	): Promise<void> {
		exportButton.disabled = true;
		closeButton.disabled = true;
		status.textContent = 'Preparing download…';
		try {
			const attempt = await this.session.download();
			if (attempt.result.outcome === 'downloaded') {
				this.close();
				return;
			}
			status.textContent = attempt.result.message;
		} catch (error) {
			status.textContent = error instanceof Error ? error.message : String(error);
		} finally {
			if (this.contentEl.isConnected) {
				exportButton.disabled = false;
				closeButton.disabled = false;
			}
		}
	}
}
