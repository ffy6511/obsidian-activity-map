import {
	FileView,
	MarkdownView,
	Plugin,
	TFolder,
	type EventRef,
	type MarkdownFileInfo,
	type TAbstractFile,
	type WorkspaceLeaf,
} from 'obsidian';

import { SystemClock, localDateFor } from './platform/clock';
import { ObsidianDataAdapter, ObsidianShardInventory } from './platform/obsidian-data-adapter';
import { SettingsRepository } from './data/settings-repository';
import { SafeJsonStore } from './data/safe-json-store';
import { checkpointPath, filesRegistryPath } from './data/paths';
import { FileRegistry } from './data/file-registry';
import { CheckpointRepository } from './data/checkpoint-repository';
import { DataServices } from './data/data-services';
import { DailySummaryRepository } from './data/daily-summary-repository';
import { ExclusionMatcher } from './data/exclusions';
import { TrackingCoordinator, type ActivityEventSource, type WorkspaceSource } from './tracking/tracking-coordinator';
import type { TrackingObserver } from './tracking/ports';
import type { ResolvedLeaf } from './tracking/target-resolver';
import { LocalQueryService } from './query/query-service';
import { ActivityMapController } from './ui/activity-map-controller';
import { ActivityMapSettingsTab } from './ui/settings-tab';
import { HeaderActionManager } from './ui/header-action-manager';
import { ACTIVITY_MAP_HOVER_SOURCE } from './ui/file-hover-preview';
import { belongsToMarkdownEditor, createCodeMirrorTypedInputExtension } from './platform/codemirror-typed-input';

export default class ActivityMapPlugin extends Plugin {
	private controller: ActivityMapController | null = null;
	private coordinator: TrackingCoordinator | null = null;
	private headerActions: HeaderActionManager | null = null;
	private readonly windowById = new Map<string, Window>();
	private readonly leafIds = new WeakMap<WorkspaceLeaf, string>();
	private nextLeafId = 1;
	private nextWindowId = 1;

	async onload(): Promise<void> {
		const clock = new SystemClock();
		const adapter = new ObsidianDataAdapter(this.app.vault.adapter, this.manifest, this.app.vault.configDir);
		const settingsRepository = new SettingsRepository(this);
		let settings = (await settingsRepository.load()).settings;
		let exclusions = new ExclusionMatcher(adapter, settings.excludedPathGlobs);

		const registry = await FileRegistry.load(new SafeJsonStore(adapter, filesRegistryPath(adapter)));
		const checkpoint = new CheckpointRepository(new SafeJsonStore(adapter, checkpointPath(adapter)));
		const inventory = new ObsidianShardInventory(adapter);
		const observers: TrackingObserver[] = [];
		const summariesHolder: { value: DailySummaryRepository | null } = { value: null };
		const controllerHolder: { value: ActivityMapController | null } = { value: null };
		const dataServices = new DataServices({
			registry,
			fileAdapter: adapter,
			pathAdapter: adapter,
			settings,
			onShardChanged: async (deviceId, localDate) => {
				const repository = summariesHolder.value;
				if (!repository) return;
				const rebuilt = await repository.rebuild({ deviceId, localDate, nowIso: new Date().toISOString() });
				if (!rebuilt.rawUnavailable) {
					await repository.save({ deviceId, localDate, summary: rebuilt.summary });
					await controllerHolder.value?.dispatch({ kind: 'refresh' });
				}
			},
		});
		const summaries = new DailySummaryRepository({ shardStore: dataServices.getShardStore(), pathAdapter: adapter, fileAdapter: adapter });
		summariesHolder.value = summaries;
		this.windowById.set('main', window);
		const workspaceSource = this.createWorkspaceSource();
		const coordinator = new TrackingCoordinator({
			settings,
			clock,
			sink: dataServices,
			checkpoint,
			identity: dataServices,
			isExcluded: (path) => exclusions.isExcluded(path),
			workspace: workspaceSource,
			attachWindowEvents: (windowId) => this.createActivityEventSource(windowId),
			observers,
		});
		this.coordinator = coordinator;
		this.registerEditorExtension(createCodeMirrorTypedInputExtension({
			resolveTarget: (info) => this.resolveTypedInputTarget(info),
			onTypedInput: (commit) => coordinator.onTypedInputCommit(commit),
		}));
		const queryService = new LocalQueryService(inventory, summaries, registry, () => settings);
		const controller = new ActivityMapController(
			settings,
			queryService,
			{
				update: async (patch) => {
					const persisted = await settingsRepository.update(patch);
					settings = persisted;
					exclusions = new ExclusionMatcher(adapter, persisted.excludedPathGlobs);
					dataServices.setDeviceId(persisted.deviceId);
					return persisted;
				},
			},
			coordinator,
			localDateFor(Date.now(), Intl.DateTimeFormat().resolvedOptions().timeZone),
		);
		controllerHolder.value = controller;
		observers.push(controller);
		this.controller = controller;

		const loadedCheckpoint = await checkpoint.load();
		if (loadedCheckpoint.checkpoint) {
			const reconciliation = await coordinator.restore(loadedCheckpoint.checkpoint);
			if (reconciliation.outcome === 'quarantined') {
				coordinator.degrade(reconciliation.reason ?? 'checkpoint-quarantined');
			}
		}
		if (loadedCheckpoint.quarantined) coordinator.degrade(loadedCheckpoint.reason ?? 'checkpoint-quarantined');
		this.registerHoverLinkSource(ACTIVITY_MAP_HOVER_SOURCE, {
			display: 'Activity Map',
			defaultMod: true,
		});
		this.addSettingTab(new ActivityMapSettingsTab(this.app, this, controller));
		this.registerVaultIdentityEvents(registry);
		this.registerPopoutEvents(coordinator);
		const headerActions = new HeaderActionManager({
			app: this.app,
			workspace: this.app.workspace,
			controller,
			openFile: (filePath) => this.app.workspace.openLinkText(filePath, '', false),
			isFileView: (view): view is FileView => view instanceof FileView,
			reportWarning: (message) => controller.reportWarning(message),
		});
		this.headerActions = headerActions;
		this.app.workspace.onLayoutReady(() => headerActions.start());

		const heartbeatMs = 30_000;
		this.registerInterval(window.setInterval(() => coordinator.onHeartbeat(heartbeatMs), heartbeatMs));
		this.registerInterval(window.setInterval(() => coordinator.onIdleTimer(), Math.min(30_000, settings.idleThresholdMs)));
		coordinator.start();
	}

	onunload(): void {
		this.headerActions?.stop();
		this.controller?.stop();
		void this.coordinator?.stop();
		this.windowById.clear();
	}

	private createWorkspaceSource(): WorkspaceSource {
		const workspace = this.app.workspace;
		const subscribe = (ref: EventRef): (() => void) => () => workspace.offref(ref);
		return {
			getActiveLeaf: () => this.resolveLeaf(workspace.getMostRecentLeaf()),
			onActiveLeafChange: (callback) => subscribe(workspace.on('active-leaf-change', callback)),
			onFileOpen: (callback) => subscribe(workspace.on('file-open', () => {
				const leaf = this.resolveLeaf(workspace.getMostRecentLeaf());
				if (leaf) callback(leaf);
			})),
			onEditorChange: (callback) => subscribe(workspace.on('editor-change', (_editor, info) => {
				const file = info.file;
				if (!file) return;
				const resolved = info instanceof FileView ? this.resolveLeaf(info.leaf) : null;
				callback({
					path: file.path,
					leafId: resolved?.leafId,
					windowId: resolved?.windowId,
				});
			})),
		};
	}

	private resolveLeaf(leaf: WorkspaceLeaf | null): ResolvedLeaf | null {
		if (!leaf) return null;
		let leafId = this.leafIds.get(leaf);
		if (!leafId) {
			leafId = `leaf-${this.nextLeafId++}`;
			this.leafIds.set(leaf, leafId);
		}
		const win = leaf.getContainer().win;
		let windowId = [...this.windowById].find(([, candidate]) => candidate === win)?.[0];
		if (!windowId) {
			windowId = `window-${this.nextWindowId++}`;
			this.windowById.set(windowId, win);
		}
		const file = leaf.view instanceof FileView ? leaf.view.file : null;
		return { leafId, windowId, file: file ? { path: file.path } : null };
	}

	/**
	 * Obsidian's editorInfoField can identify a MarkdownEditView rather than the
	 * enclosing MarkdownView. Match that public editor object to the active leaf
	 * before minting provenance; a same-file background editor still cannot count.
	 */
	private resolveTypedInputTarget(info: MarkdownFileInfo): ResolvedLeaf | null {
		const leaf = this.app.workspace.getMostRecentLeaf();
		if (!(leaf?.view instanceof MarkdownView)) return null;
		return belongsToMarkdownEditor(info, leaf.view) ? this.resolveLeaf(leaf) : null;
	}

	private createActivityEventSource(windowId: string): ActivityEventSource {
		const win = this.windowById.get(windowId) ?? window;
		return {
			attachActivityListeners: (callback) => {
				const events = ['keydown', 'compositionend', 'pointerdown', 'pointermove', 'wheel', 'touchstart', 'focus'] as const;
				let pointerFrame: number | null = null;
				let latestPointerEvent: Event | null = null;
				const handler = (event: Event) => {
					if (event.type !== 'pointermove' || typeof win.requestAnimationFrame !== 'function') {
						callback(event);
						return;
					}
					latestPointerEvent = event;
					if (pointerFrame !== null) return;
					pointerFrame = win.requestAnimationFrame(() => {
						pointerFrame = null;
						const latest = latestPointerEvent;
						latestPointerEvent = null;
						if (latest) callback(latest);
					});
				};
				for (const event of events) win.addEventListener(event, handler, { capture: true, passive: true });
				return () => {
					if (pointerFrame !== null) win.cancelAnimationFrame(pointerFrame);
					pointerFrame = null;
					latestPointerEvent = null;
					for (const event of events) win.removeEventListener(event, handler, { capture: true });
				};
			},
			onBlur: (callback) => {
				win.addEventListener('blur', callback);
				return () => win.removeEventListener('blur', callback);
			},
		};
	}

	private registerPopoutEvents(coordinator: TrackingCoordinator): void {
		const unsubs = new WeakMap<Window, () => void>();
		this.registerEvent(this.app.workspace.on('window-open', (_workspaceWindow, win) => {
			const id = `window-${this.nextWindowId++}`;
			this.windowById.set(id, win);
			unsubs.set(win, coordinator.registerWindow(id));
		}));
		this.registerEvent(this.app.workspace.on('window-close', (_workspaceWindow, win) => {
			unsubs.get(win)?.();
			for (const [id, candidate] of this.windowById) if (candidate === win) this.windowById.delete(id);
		}));
	}

	private registerVaultIdentityEvents(registry: FileRegistry): void {
		this.app.workspace.onLayoutReady(() => {
			this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
				void (file instanceof TFolder ? registry.renameFolder(oldPath, file.path) : registry.rename(oldPath, file.path));
			}));
			this.registerEvent(this.app.vault.on('delete', (file) => void this.markDeleted(registry, file)));
		});
	}

	private async markDeleted(registry: FileRegistry, file: TAbstractFile): Promise<void> {
		if (!(file instanceof TFolder)) {
			await registry.delete(file.path);
			return;
		}
		const prefix = `${file.path}/`;
		for (const path of Object.keys(registry.snapshot().pathIndex)) {
			if (path === file.path || path.startsWith(prefix)) await registry.delete(path);
		}
	}
}
