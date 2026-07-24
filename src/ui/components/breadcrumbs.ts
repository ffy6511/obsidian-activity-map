export function renderBreadcrumbs(
	container: HTMLElement,
	path: string,
	view: 'children' | 'local-files',
	onNavigate: (path: string) => void,
	allowCurrentActivation = false,
): void {
	const nav = container.createEl('nav', {
		cls: 'activity-map-breadcrumbs',
		attr: { 'aria-label': 'Activity path' },
	});
	const parts = path.split('/').filter(Boolean);
	const entries = [{ label: 'Vault', path: '' }];
	let current = '';
	for (const part of parts) {
		current = current ? `${current}/${part}` : part;
		entries.push({ label: part, path: current });
	}
	if (view === 'local-files') entries.push({ label: 'Local files', path: `${path}#local-files` });
	for (const [index, entry] of entries.entries()) {
		if (index > 0) nav.createSpan({ text: '/', cls: 'activity-map-breadcrumb-separator' });
		const button = nav.createEl('button', {
			text: entry.label,
			cls: 'clickable-icon activity-map-breadcrumb',
			attr: { 'data-activity-map-id': `breadcrumb-${entry.path || 'vault'}` },
		});
		button.disabled =
			!allowCurrentActivation &&
			entry.path === (view === 'local-files' ? `${path}#local-files` : path);
		button.addEventListener('click', () => onNavigate(entry.path.replace(/#local-files$/, '')));
	}
}
