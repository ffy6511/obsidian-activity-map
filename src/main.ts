import { ItemView, Plugin, WorkspaceLeaf } from 'obsidian';

const ACTIVITY_MAP_VIEW_TYPE = 'activity-map-view';

class ActivityMapView extends ItemView {
	constructor(leaf: WorkspaceLeaf) {
		super(leaf);
	}

	getViewType(): string {
		return ACTIVITY_MAP_VIEW_TYPE;
	}

	getDisplayText(): string {
		return 'Activity map';
	}

	getIcon(): string {
		return 'chart-pie';
	}

	onOpen(): Promise<void> {
		this.contentEl.empty();
		this.contentEl.addClass('activity-map-view');

		const emptyState = this.contentEl.createDiv({
			cls: 'activity-map-empty-state',
		});
		emptyState.createEl('h2', { text: 'Activity map' });
		emptyState.createEl('p', {
			text: 'The plugin foundation is ready. Activity tracking and charts are not implemented yet.',
		});

		return Promise.resolve();
	}

	onClose(): Promise<void> {
		this.contentEl.empty();
		return Promise.resolve();
	}
}

export default class ActivityMapPlugin extends Plugin {
	onload(): void {
		this.registerView(
			ACTIVITY_MAP_VIEW_TYPE,
			(leaf) => new ActivityMapView(leaf),
		);

		this.addRibbonIcon('chart-pie', 'Open activity map', () => {
			void this.activateView();
		});

		this.addCommand({
			id: 'open-view',
			name: 'Open view',
			callback: () => {
				void this.activateView();
			},
		});
	}

	private async activateView(): Promise<void> {
		let leaf = this.app.workspace.getLeavesOfType(
			ACTIVITY_MAP_VIEW_TYPE,
		)[0];

		if (!leaf) {
			leaf =
				this.app.workspace.getRightLeaf(false) ??
				this.app.workspace.getLeaf(true);

			await leaf.setViewState({
				type: ACTIVITY_MAP_VIEW_TYPE,
				active: true,
			});
		}

		await this.app.workspace.revealLeaf(leaf);
	}
}
