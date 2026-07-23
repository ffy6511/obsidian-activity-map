import type { PosterExportSession } from '../export/poster-export-session';

export interface PosterExportDetailsHandle {
	/** Reflect the selected layout and format without changing the frozen query. */
	update(): void;
}

/** Renders the frozen query scope and actual filename before a download begins. */
export function renderPosterExportDetails(args: {
	container: HTMLElement;
	session: Pick<PosterExportSession, 'getFilename' | 'getScopeDescription'>;
}): PosterExportDetailsHandle {
	const details = args.container.createDiv({ cls: 'activity-map-poster-details' });
	const scope = details.createEl('p', {
		attr: { 'data-activity-map-id': 'poster-scope' },
	});
	const filename = details.createEl('p', {
		attr: { 'data-activity-map-id': 'poster-filename' },
	});
	const update = () => {
		scope.textContent = `Frozen result: ${args.session.getScopeDescription()}.`;
		filename.textContent = `Download: ${args.session.getFilename()}`;
	};
	update();
	return { update };
}
