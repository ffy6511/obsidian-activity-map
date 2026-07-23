import { Modal, type App } from 'obsidian';

import { BrowserExportDestination, BrowserSvgRasterizer } from '../export/export-destination';
import { PosterExportSession, type PosterSnapshot } from '../export/poster-export-session';
import { POSTER_WORDMARK_DATA_URL } from '../export/poster-wordmark';
import type { PosterFormat, PosterLayout } from '../export/poster-exporter';
import { renderPosterExportDetails, type PosterExportDetailsHandle } from './poster-export-details';

/** A single-use export modal with volatile layout, format, and caption state. */
export class PosterExportModal extends Modal {
	private readonly session: PosterExportSession;
	private previewImage: HTMLImageElement | null = null;
	private exportDetails: PosterExportDetailsHandle | null = null;

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
			destination: new BrowserExportDestination(document),
			rasterizer: new BrowserSvgRasterizer(document),
		});
	}

	onOpen(): void {
		this.modalEl.addClass('activity-map-poster-modal');
		this.setTitle('Export activity poster');
		this.contentEl.empty();
		const controls = this.contentEl.createDiv({ cls: 'activity-map-poster-controls' });
		const layout = controls.createEl('select', { attr: { 'aria-label': 'Poster layout', 'data-activity-map-id': 'poster-layout' } });
		for (const [value, label] of [['portrait', 'Portrait'], ['wide', 'Wide'], ['compact', 'Compact']] as const) {
			layout.createEl('option', { value, text: label });
		}
		layout.value = this.session.getLayout();
		layout.addEventListener('change', () => {
			this.session.setLayout(layout.value as PosterLayout);
			this.refreshPreview();
		});

		const format = controls.createEl('select', { attr: { 'aria-label': 'Export format', 'data-activity-map-id': 'poster-format' } });
		for (const [value, label] of [['svg', 'SVG'], ['png', 'PNG'], ['jpg', 'JPG']] as const) {
			format.createEl('option', { value, text: label });
		}
		format.value = this.session.getFormat();
		format.addEventListener('change', () => {
			this.session.setFormat(format.value as PosterFormat);
			this.exportDetails?.update();
		});

		const preview = this.contentEl.createDiv({ cls: 'activity-map-poster-preview' });
		const image = preview.createEl('img', { cls: 'activity-map-poster-preview-image', attr: { alt: 'Activity poster preview' } });
		this.previewImage = image;
		const caption = preview.createEl('input', {
			cls: 'activity-map-poster-caption-input',
			attr: {
				type: 'text',
				maxlength: '280',
				placeholder: 'Optional caption',
				'aria-label': 'Optional poster caption',
				'data-activity-map-id': 'poster-caption',
			},
		});
		caption.value = this.session.getCaption();
		caption.addEventListener('input', () => {
			this.session.setCaption(caption.value);
			this.refreshPreview();
		});
		this.refreshPreview();
		this.exportDetails = renderPosterExportDetails({ container: this.contentEl, session: this.session });

		const actions = this.contentEl.createDiv({ cls: 'activity-map-poster-actions' });
		const status = actions.createSpan({ cls: 'activity-map-poster-status', attr: { 'aria-live': 'polite' } });
		const close = actions.createEl('button', { text: 'Close' });
		close.addEventListener('click', () => this.close());
		const exportButton = actions.createEl('button', {
			text: 'Export',
			cls: 'mod-cta',
			attr: { 'data-activity-map-id': 'poster-export' },
		});
		exportButton.addEventListener('click', () => {
			void this.export(exportButton, close, status);
		});
		caption.focus();
	}

	onClose(): void {
		this.contentEl.empty();
		this.modalEl.removeClass('activity-map-poster-modal');
		this.previewImage = null;
		this.exportDetails = null;
		this.onClosed?.();
		if (this.trigger.isConnected) this.trigger.focus();
	}

	private refreshPreview(): void {
		const image = this.previewImage;
		if (!image) return;
		const poster = this.session.preview();
		image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(poster.svg)}`;
		this.exportDetails?.update();
	}

	private async export(exportButton: HTMLButtonElement, closeButton: HTMLButtonElement, status: HTMLElement): Promise<void> {
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
