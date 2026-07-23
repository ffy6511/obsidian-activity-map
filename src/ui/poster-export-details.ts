import type { PosterExportSession } from '../export/poster-export-session';

export interface PosterExportDetailsHandle {
	/** Reflect the selected layout and format in the editable filename. */
	update(): void;
}

/** Renders an editable, path-free filename for the browser's default download folder. */
export function renderPosterExportDetails(args: {
	container: HTMLElement;
	session: Pick<PosterExportSession, 'getFilename' | 'setFilename'>;
}): PosterExportDetailsHandle {
	const details = args.container.createDiv({ cls: 'activity-map-poster-details' });
	const label = details.createEl('label', {
		text: 'File name',
		cls: 'activity-map-poster-filename-label',
	});
	const filename = label.createEl('input', {
		type: 'text',
		attr: {
			'aria-label': 'Export file name',
			'data-activity-map-id': 'poster-filename',
		},
	});
	filename.addEventListener('input', () => args.session.setFilename(filename.value));
	filename.addEventListener('change', () => { filename.value = args.session.getFilename(); });
	const update = () => { filename.value = args.session.getFilename(); };
	update();
	return { update };
}
