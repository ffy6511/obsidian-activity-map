import type { EventRef, FileView, IconName, Workspace, WorkspaceLeaf } from 'obsidian';

import type { ActivityMapController } from './activity-map-controller';
import { statusPresentation } from './status-presentation';
import { SummaryPopover } from './summary-popover';

interface HeaderEntry {
	view: FileView;
	action: HTMLElement;
	filePath: string;
	popover: SummaryPopover;
}

export interface HeaderActionDependencies {
	workspace: Workspace;
	controller: ActivityMapController;
	openView: () => Promise<void>;
	isFileView(view: WorkspaceLeaf['view']): view is FileView;
	setIcon(element: HTMLElement, icon: IconName): void;
	reportWarning(message: string): void;
}

/** Owns exactly one Activity Map action for each live file-backed view. */
export class HeaderActionManager {
	private readonly entriesByView = new WeakMap<FileView, HeaderEntry>();
	private readonly entries = new Set<HeaderEntry>();
	private readonly eventRefs: EventRef[] = [];
	private unsubscribe: (() => void) | null = null;
	private stopped = false;

	constructor(private readonly dependencies: HeaderActionDependencies) {}

	start(): void {
		if (this.stopped || this.unsubscribe) return;
		const workspace = this.dependencies.workspace;
		this.eventRefs.push(workspace.on('layout-change', () => this.synchronize()));
		this.eventRefs.push(workspace.on('active-leaf-change', () => this.synchronize()));
		this.eventRefs.push(workspace.on('file-open', () => this.synchronize()));
		this.eventRefs.push(workspace.on('window-open', () => this.synchronize()));
		this.eventRefs.push(workspace.on('window-close', () => this.synchronize()));
		this.unsubscribe = this.dependencies.controller.subscribe(() => this.refreshPresentations());
		this.synchronize();
	}

	stop(): void {
		if (this.stopped) return;
		this.stopped = true;
		for (const ref of this.eventRefs) this.dependencies.workspace.offref(ref);
		this.eventRefs.length = 0;
		this.unsubscribe?.();
		this.unsubscribe = null;
		for (const entry of this.entries) this.remove(entry);
		this.entries.clear();
	}

	/** Public for deterministic lifecycle tests and layout-ready composition. */
	synchronize(): void {
		if (this.stopped) return;
		const live = new Set<FileView>();
		try {
			this.dependencies.workspace.iterateAllLeaves((leaf) => {
				if (!this.dependencies.isFileView(leaf.view) || !leaf.view.file) return;
				const view = leaf.view;
				live.add(view);
				const path = leaf.view.file.path;
				const existing = this.entriesByView.get(view);
				if (existing?.filePath === path && existing.action.isConnected) return;
				if (existing) {
					this.remove(existing);
					this.entries.delete(existing);
				}
				const created = this.create(view, path);
				this.entriesByView.set(view, created);
				this.entries.add(created);
			});
			for (const entry of this.entries) {
				if (live.has(entry.view)) continue;
				this.remove(entry);
				this.entries.delete(entry);
			}
			this.refreshPresentations();
		} catch (error) {
			this.dependencies.reportWarning(`File-header integration unavailable: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	private create(view: FileView, filePath: string): HeaderEntry {
		const action = view.addAction('chart-pie', 'Activity Map: starting', () => void this.dependencies.openView());
		action.addClass('activity-map-header-action');
		action.setAttr('data-activity-map-owner', 'activity-map');
		const popover = new SummaryPopover(action, this.dependencies.controller, filePath, this.dependencies.openView);
		const ownerWindow = action.ownerDocument.defaultView;
		const supportsHover = ownerWindow?.matchMedia?.('(hover: hover) and (pointer: fine)').matches === true;
		if (supportsHover) {
			action.addEventListener('pointerenter', () => popover.open());
			action.addEventListener('pointerleave', () => popover.scheduleClose());
		}
		action.addEventListener('focus', () => popover.open());
		action.addEventListener('blur', () => popover.scheduleClose());
		action.addEventListener('click', () => popover.close(false));
		return { view, action, filePath, popover };
	}

	private refreshPresentations(): void {
		const snapshot = this.dependencies.controller.getViewModel().tracking;
		for (const entry of this.entries) {
			const presentation = statusPresentation(snapshot, entry.filePath);
			this.dependencies.setIcon(entry.action, presentation.icon);
			entry.action.setAttr('aria-label', presentation.label);
			entry.action.setAttr('title', presentation.label);
			entry.action.removeClasses(['is-active', 'is-idle', 'is-pending', 'is-paused', 'is-untrackable', 'is-degraded']);
			entry.action.addClass(presentation.className);
		}
	}

	private remove(entry: HeaderEntry): void {
		entry.popover.close(false);
		entry.action.remove();
	}
}
