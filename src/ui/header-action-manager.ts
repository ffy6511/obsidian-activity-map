import type { EventRef, FileView, Workspace, WorkspaceLeaf } from 'obsidian';

import type { ActivityMapController } from './activity-map-controller';
import { statusPresentation } from './status-presentation';
import { SummaryPopover } from './summary-popover';
import { HeaderMiniDonut, type HeaderMiniDonutPort } from './header-mini-donut';
import { liveTodayMs } from './live-today';

interface HeaderEntry {
	view: FileView;
	action: HTMLElement;
	filePath: string;
	popover: SummaryPopover;
	miniDonut: HeaderMiniDonutPort;
	summary: { fileActiveMs: number; vaultActiveMs: number };
	summaryGeneration: number;
	summaryLoading: boolean;
}

export interface HeaderActionDependencies {
	workspace: Workspace;
	controller: ActivityMapController;
	openView: () => Promise<void>;
	openFile: (filePath: string) => Promise<void>;
	isFileView(view: WorkspaceLeaf['view']): view is FileView;
	createMiniDonut?: (element: HTMLElement) => HeaderMiniDonutPort;
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
		let popover: SummaryPopover | null = null;
		const action = view.addAction('chart-pie', 'Activity Map: starting', () => popover?.togglePinned());
		action.addClass('activity-map-header-action');
		action.setAttr('data-activity-map-owner', 'activity-map');
		action.setAttr('aria-expanded', 'false');
		const miniDonut = this.dependencies.createMiniDonut?.(action) ?? new HeaderMiniDonut(action);
		popover = new SummaryPopover(
			action,
			this.dependencies.controller,
			filePath,
			this.dependencies.openView,
			this.dependencies.openFile,
		);
		const ownerWindow = action.ownerDocument.defaultView;
		const supportsHover = ownerWindow?.matchMedia?.('(hover: hover) and (pointer: fine)').matches === true;
		if (supportsHover) {
			action.addEventListener('pointerenter', () => popover.open());
			action.addEventListener('pointerleave', () => popover.scheduleClose());
		}
		action.addEventListener('focus', () => popover.open());
		action.addEventListener('blur', () => popover.scheduleClose());
		return {
			view,
			action,
			filePath,
			popover,
			miniDonut,
			summary: { fileActiveMs: 0, vaultActiveMs: 0 },
			summaryGeneration: -1,
			summaryLoading: false,
		};
	}

	private refreshPresentations(): void {
		const model = this.dependencies.controller.getViewModel();
		const snapshot = model.tracking;
		for (const entry of this.entries) {
			const presentation = statusPresentation(snapshot, entry.filePath);
			entry.action.setAttr('aria-label', presentation.label);
			entry.action.setAttr('title', presentation.label);
			entry.action.removeClasses(['is-active', 'is-idle', 'is-pending', 'is-paused', 'is-untrackable', 'is-degraded']);
			entry.action.addClass(presentation.className);
			this.updateMiniDonut(entry);
			this.refreshSummary(entry, model.queryGeneration);
		}
	}

	private updateMiniDonut(entry: HeaderEntry): void {
		const snapshot = this.dependencies.controller.getViewModel().tracking;
		const fileActiveMs = entry.summary.fileActiveMs + liveTodayMs(snapshot, entry.filePath);
		const vaultActiveMs = entry.summary.vaultActiveMs + liveTodayMs(snapshot);
		entry.miniDonut.update(vaultActiveMs > 0 ? fileActiveMs / vaultActiveMs : 0);
	}

	private refreshSummary(entry: HeaderEntry, generation: number): void {
		if (entry.summaryLoading || entry.summaryGeneration === generation) return;
		entry.summaryLoading = true;
		entry.summaryGeneration = generation;
		void this.dependencies.controller.getStatusSummary(entry.filePath).then((summary) => {
			if (!this.entries.has(entry)) return;
			entry.summary = summary;
			this.updateMiniDonut(entry);
		}).catch((error: unknown) => {
			this.dependencies.reportWarning(`Header activity ratio unavailable: ${error instanceof Error ? error.message : String(error)}`);
		}).finally(() => {
			entry.summaryLoading = false;
		});
	}

	private remove(entry: HeaderEntry): void {
		entry.popover.close(false);
		entry.action.remove();
	}
}
