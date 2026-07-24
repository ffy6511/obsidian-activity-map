import { setIcon, type App } from 'obsidian';

import type { DistributionGrouping, DistributionItem } from '../query/distribution-query';
import type { ActivityMapController } from './activity-map-controller';
import type { ActivityMapViewModel } from './view-model';
import { distributionActivation } from './distribution-activation';
import { renderBreadcrumbs } from './components/breadcrumbs';
import { renderChartLegend, type ChartLegendHandle } from './components/chart-legend';
import { renderDonutChart, type ChartItem } from './components/donut-chart';
import {
	renderRangeControls,
	type RangeControlAction,
	type RangeControlsHandle,
} from './components/range-controls';
import { withLiveActivity } from './live-distribution';
import {
	LOCATE_HIGHLIGHT_MS,
	findLocateItem,
	isFileVisibleUnderScope,
	parentDirectory,
} from './locate-file';

export function createDistributionGroupingAction(args: {
	groupBy: DistributionGrouping;
	getCurrentGrouping(): DistributionGrouping;
	onBeforeActivate(): void;
	onGrouping(groupBy: DistributionGrouping): void;
}): RangeControlAction {
	return {
		icon: args.groupBy === 'file' ? 'folder-tree' : 'files',
		label: args.groupBy === 'file' ? 'Group by path' : 'Show all files',
		id: 'distribution-grouping-toggle',
		pressed: args.groupBy === 'file',
		onActivate: () => {
			args.onBeforeActivate();
			args.onGrouping(args.getCurrentGrouping() === 'path' ? 'file' : 'path');
		},
	};
}

export function createTrackingAction(args: {
	paused: boolean;
	getCurrentPaused(): boolean;
	onTracking(intent: 'pause' | 'resume'): void;
}): RangeControlAction {
	return {
		icon: args.paused ? 'play' : 'pause',
		label: args.paused ? 'Resume activity tracking' : 'Pause activity tracking',
		id: 'tracking-toggle',
		onActivate: () => {
			args.onTracking(args.getCurrentPaused() ? 'resume' : 'pause');
		},
	};
}

export function createPosterExportAction(args: {
	available: boolean;
	onExport(): void;
}): RangeControlAction {
	return {
		icon: 'image-down',
		label: 'Export activity poster',
		id: 'poster-export',
		disabled: !args.available,
		onActivate: () => args.onExport(),
	};
}

/** Interactive, pinnable header chart sharing the controller's query state. */
export class SummaryPopover {
	private element: HTMLElement | null = null;
	private closeTimer: number | null = null;
	private outsideHandler: ((event: PointerEvent) => void) | null = null;
	private unsubscribe: (() => void) | null = null;
	private liveTimer: number | null = null;
	private pinned = false;
	private expandedOther: string[] | null = null;
	private lastRenderKey = '';
	private distributionView: {
		update(distribution: import('../query/distribution-query').DistributionResult): boolean;
	} | null = null;
	private controlsView: RangeControlsHandle | null = null;
	private posterModal: { close(): void } | null = null;
	private openingPoster = false;
	// Live highlight handles for the mounted chart/legend, so locate can drive
	// the same bidirectional highlight path as pointer hover. Cleared on re-render.
	private chartHandle: import('./components/donut-chart').DonutChartHandle | null = null;
	private legendHandle: ChartLegendHandle | null = null;
	// Pending locate highlight clear timer. A single owner: each activation
	// restarts the window; re-render and close cancel it.
	private locateTimer: number | null = null;
	// When locate narrows the path scope, this records the pending target so the
	// next ready model of a newer generation can complete the highlight.
	private pendingLocatePath: string | null = null;

	constructor(
		private readonly trigger: HTMLElement,
		private readonly controller: ActivityMapController,
		private readonly openFile: (filePath: string) => Promise<void>,
		private readonly previewFile?: (
			event: MouseEvent,
			targetEl: HTMLElement,
			filePath: string,
		) => void,
		private readonly getNativePreview?: () => HTMLElement | null,
		private readonly app?: App,
		/**
		 * Vault-relative path of the file whose header owns this Popover, read
		 * fresh on each locate. `null`/omitted disables the locate button.
		 */
		private readonly getActiveFilePath?: () => string | null,
		/**
		 * Icon renderer for the control row. Defaults to Obsidian's `setIcon`;
		 * tests inject a no-op so the Popover renders without Obsidian at runtime.
		 */
		private readonly renderIcon: (container: HTMLElement, icon: string) => void = setIcon,
	) {}

	open(): void {
		this.cancelClose();
		if (this.element) return;
		const doc = this.trigger.ownerDocument;
		const popover = doc.body.createDiv({
			cls: 'activity-map-popover activity-map-chart-popover',
			attr: { role: 'dialog', 'aria-label': 'Activity Map chart' },
		});
		this.element = popover;
		this.trigger.setAttr('aria-expanded', 'true');
		popover.addEventListener('pointerenter', () => this.cancelClose());
		popover.addEventListener('pointerleave', () => this.scheduleClose());
		popover.addEventListener('focusin', () => this.cancelClose());
		popover.addEventListener('focusout', (event) => {
			const next = event.relatedTarget;
			const OwnerNode = doc.defaultView?.Node;
			if (
				!OwnerNode ||
				!(next instanceof OwnerNode) ||
				(!popover.contains(next) && !this.trigger.contains(next))
			) {
				this.scheduleClose();
			}
		});
		popover.addEventListener('keydown', (event) => {
			if (event.key === 'Escape') {
				event.preventDefault();
				this.close(true);
			}
		});
		this.outsideHandler = (event) => {
			const target = event.target;
			const OwnerNode = doc.defaultView?.Node;
			const nativePreview = this.nativePreview();
			if (
				OwnerNode &&
				target instanceof OwnerNode &&
				!popover.contains(target) &&
				!this.trigger.contains(target) &&
				!nativePreview?.contains(target)
			) {
				this.close(false);
			}
		};
		doc.addEventListener('pointerdown', this.outsideHandler, true);
		void this.controller.dispatch({
			kind: 'set-query',
			query: this.controller.getHeaderDefaultQuery(),
		});
		this.unsubscribe = this.controller.subscribe((model) => this.renderIfChanged(model));
		this.liveTimer =
			doc.defaultView?.setInterval(() => {
				const model = this.controller.getViewModel();
				if (isLiveTodayQuery(model)) this.updateLiveDistribution(model);
			}, 1_000) ?? null;
		this.position();
	}

	togglePinned(): void {
		if (!this.element) this.open();
		this.pinned = !this.pinned;
		this.trigger.toggleClass('is-pinned', this.pinned);
		this.trigger.setAttr('aria-pressed', String(this.pinned));
		this.element?.toggleClass('is-pinned', this.pinned);
		if (
			this.pinned ||
			this.trigger.matches(':hover') ||
			this.trigger.ownerDocument.activeElement === this.trigger
		) {
			this.cancelClose();
		} else {
			this.scheduleClose();
		}
	}

	scheduleClose(): void {
		if (this.pinned) return;
		this.cancelClose();
		this.closeTimer =
			this.trigger.ownerDocument.defaultView?.setTimeout(() => {
				this.closeTimer = null;
				if (!this.shouldStayOpen()) {
					this.close(false);
				} else if (!this.pinned && this.nativePreview()) {
					// Page Preview is mounted outside this Popover. Recheck after its own
					// hover lifecycle finishes so the source row remains connected meanwhile.
					this.scheduleClose();
				}
			}, 180) ?? null;
	}

	cancelClose(): void {
		if (this.closeTimer !== null)
			this.trigger.ownerDocument.defaultView?.clearTimeout(this.closeTimer);
		this.closeTimer = null;
	}

	close(restoreFocus: boolean): void {
		this.cancelClose();
		this.cancelLocate();
		if (this.outsideHandler)
			this.trigger.ownerDocument.removeEventListener(
				'pointerdown',
				this.outsideHandler,
				true,
			);
		this.outsideHandler = null;
		this.unsubscribe?.();
		this.unsubscribe = null;
		if (this.liveTimer !== null)
			this.trigger.ownerDocument.defaultView?.clearInterval(this.liveTimer);
		this.liveTimer = null;
		this.controlsView?.destroy();
		this.element?.remove();
		this.element = null;
		this.pinned = false;
		this.expandedOther = null;
		this.lastRenderKey = '';
		this.distributionView = null;
		this.controlsView = null;
		this.chartHandle = null;
		this.legendHandle = null;
		this.pendingLocatePath = null;
		this.trigger.removeClass('is-pinned');
		this.trigger.setAttr('aria-expanded', 'false');
		this.trigger.setAttr('aria-pressed', 'false');
		if (restoreFocus && this.trigger.isConnected) this.trigger.focus();
	}

	private position(): void {
		const popover = this.element;
		if (!popover) return;
		const viewport = this.trigger.ownerDocument.defaultView;
		const triggerRect = this.trigger.getBoundingClientRect();
		const popoverRect = popover.getBoundingClientRect();
		const margin = 8;
		const width = popoverRect.width || 440;
		const height = popoverRect.height || 620;
		const left = Math.max(
			margin,
			Math.min(
				triggerRect.left,
				(viewport?.innerWidth ?? triggerRect.right + width) - width - margin,
			),
		);
		const below = triggerRect.bottom + 6;
		const top =
			below + height <= (viewport?.innerHeight ?? below + height)
				? below
				: Math.max(margin, triggerRect.top - height - 6);
		popover.style.left = `${String(left)}px`;
		popover.style.top = `${String(top)}px`;
	}

	private renderIfChanged(model: ActivityMapViewModel, force = false): void {
		const paused = model.tracking?.state === 'paused';
		const key = `${String(model.queryGeneration)}:${model.loadState}:${String(paused)}:${this.expandedOther?.join(',') ?? ''}`;
		if (!force && key === this.lastRenderKey) {
			this.updateLiveDistribution(model);
			return;
		}
		this.lastRenderKey = key;
		// Navigation publishes a loading model before the new query resolves. Keep
		// the previous chart mounted so removing the clicked slice cannot synthesize
		// a pointer-leave and close the Popover while the request is in flight.
		if (!force && model.loadState === 'loading' && this.distributionView) {
			this.element?.addClass('is-query-pending');
			this.controlsView?.updateAction(this.groupingAction(model));
			this.controlsView?.updateAction(this.trackingAction(model));
			this.controlsView?.updateAction(this.posterExportAction(model));
			this.controlsView?.updateAction(this.locateAction(model));
			return;
		}
		this.render(model);
		this.completePendingLocate(model);
	}

	/**
	 * When locate narrowed the scope, complete the highlight on the first ready
	 * model after the navigation. The fresh chart/legend handles are mounted by
	 * render() just above. Clears the pending intent regardless of outcome so a
	 * later unrelated navigation cannot resurrect it.
	 */
	private completePendingLocate(model: ActivityMapViewModel): void {
		const pendingPath = this.pendingLocatePath;
		if (pendingPath === null) return;
		this.pendingLocatePath = null;
		if (model.loadState !== 'ready' || !model.distribution) return;
		const distribution = withLiveActivity(model.distribution, model.tracking, {
			nowMs: Date.now(),
			idleThresholdMs: model.settings.idleThresholdMs,
		});
		const item = findLocateItem(distribution, pendingPath);
		if (item) this.applyLocateHighlight(item.id);
	}

	private render(model: ActivityMapViewModel): void {
		const popover = this.element;
		if (!popover) return;
		const focusedId = (popover.ownerDocument.activeElement as HTMLElement | null)?.dataset
			.activityMapId;
		this.controlsView?.destroy();
		this.controlsView = null;
		// A rebuild replaces the chart/legend DOM. The old highlight handles are
		// dead, so any pending locate clear cannot target them; cancel it. A
		// locate-triggered scope change re-applies the highlight after the new
		// result settles (see locateCurrentFile / renderIfChanged).
		this.cancelLocate();
		this.chartHandle = null;
		this.legendHandle = null;
		popover.empty();
		popover.removeClass('is-query-pending');
		this.distributionView = null;
		const distribution = model.distribution
			? withLiveActivity(model.distribution, model.tracking, {
					nowMs: Date.now(),
					idleThresholdMs: model.settings.idleThresholdMs,
				})
			: null;

		this.controlsView = renderRangeControls({
			container: popover,
			metric: model.query.metric,
			range: model.query.range,
			onMetric: (metric) => {
				this.expandedOther = null;
				void this.controller.dispatch({ kind: 'set-metric', metric });
			},
			onRange: (range) => {
				this.expandedOther = null;
				void this.controller.dispatch({ kind: 'set-range', range });
			},
			leadingActions: [
				this.trackingAction(model),
				this.groupingAction(model),
				this.posterExportAction(model),
			],
			leadingQueryAction: this.locateAction(model),
			renderIcon: this.renderIcon,
		});

		if (model.loadState === 'loading') {
			popover.createEl('p', {
				text: 'Loading activity…',
				cls: 'activity-map-state',
				attr: { 'aria-live': 'polite' },
			});
		} else if (model.loadState === 'error') {
			popover.createEl('p', {
				text: model.error ?? 'Activity query failed.',
				cls: 'activity-map-state mod-error',
				attr: { role: 'alert' },
			});
		} else if (!distribution || distribution.detailItems.length === 0) {
			popover.createEl('p', {
				text: 'No activity was recorded for this range.',
				cls: 'activity-map-state',
			});
		} else {
			this.renderDistribution(popover, model, distribution);
		}
		if (!distribution || distribution.detailItems.length === 0)
			this.renderCurrentPath(popover, model);
		const css = popover.ownerDocument.defaultView?.CSS;
		if (focusedId && css)
			popover
				.querySelector<HTMLElement>(`[data-activity-map-id="${css.escape(focusedId)}"]`)
				?.focus();
		this.position();
	}

	private groupingAction(model: ActivityMapViewModel): RangeControlAction {
		return createDistributionGroupingAction({
			groupBy: model.query.groupBy,
			getCurrentGrouping: () => this.controller.getViewModel().query.groupBy,
			onBeforeActivate: () => {
				this.expandedOther = null;
			},
			onGrouping: (groupBy) => {
				void this.controller.dispatch({ kind: 'set-grouping', groupBy });
			},
		});
	}

	private trackingAction(model: ActivityMapViewModel): RangeControlAction {
		return createTrackingAction({
			paused: model.tracking?.state === 'paused',
			getCurrentPaused: () => this.controller.getViewModel().tracking?.state === 'paused',
			onTracking: (kind) => {
				void this.controller.dispatch({ kind });
			},
		});
	}

	private posterExportAction(model: ActivityMapViewModel): RangeControlAction {
		return createPosterExportAction({
			available:
				this.app !== undefined &&
				model.loadState === 'ready' &&
				model.distribution !== null,
			onExport: () => this.openPosterExport(),
		});
	}

	private locateAction(model: ActivityMapViewModel): RangeControlAction {
		const hasFile = this.getActiveFilePath?.() != null;
		return {
			icon: 'locate-fixed',
			label: 'Locate current file',
			id: 'locate-current-file',
			disabled: !hasFile || model.loadState !== 'ready',
			onActivate: () => {
				this.locateCurrentFile();
			},
		};
	}

	/**
	 * Locate the owning header's file in the current distribution and highlight
	 * its slice and legend row for {@link LOCATE_HIGHLIGHT_MS}. In path grouping,
	 * first narrows the scope to the file's parent directory if the file is not
	 * already a visible child; the highlight completes on the next ready model.
	 * Returns whether a highlight (immediate or pending) was started.
	 */
	locateCurrentFile(): boolean {
		const activeFilePath = this.getActiveFilePath?.() ?? null;
		if (!activeFilePath) return false;
		const model = this.controller.getViewModel();
		if (model.loadState !== 'ready' || !model.distribution) return false;
		const distribution = withLiveActivity(model.distribution, model.tracking, {
			nowMs: Date.now(),
			idleThresholdMs: model.settings.idleThresholdMs,
		});
		// Path grouping only exposes a file as a direct child of the current
		// scope. Narrow to the parent directory first so the row appears, and
		// complete the highlight once the newer-generation result settles.
		if (
			model.query.groupBy === 'path' &&
			!isFileVisibleUnderScope(distribution, activeFilePath)
		) {
			const target = parentDirectory(activeFilePath);
			if (target === model.query.path) return false;
			this.pendingLocatePath = activeFilePath;
			this.cancelLocate();
			void this.controller.dispatch({ kind: 'set-path', path: target });
			return true;
		}
		const item = findLocateItem(distribution, activeFilePath);
		if (!item) return false;
		this.applyLocateHighlight(item.id);
		return true;
	}

	/** Drives both highlight handles and schedules the clear. */
	private applyLocateHighlight(itemId: string): void {
		this.cancelLocate();
		const chart = this.chartHandle;
		const legend = this.legendHandle;
		if (!chart || !legend) return;
		chart.highlight(itemId);
		legend.highlight(itemId);
		// Scroll the legend row into view inside its scroll container. The
		// detail list is the source of truth, so the row exists even when the
		// chart slice is folded into "Other".
		this.scrollLegendRowIntoView(itemId);
		const doc = this.trigger.ownerDocument;
		this.locateTimer =
			doc.defaultView?.setTimeout(() => {
				this.locateTimer = null;
				this.clearLocateHighlight();
			}, LOCATE_HIGHLIGHT_MS) ?? null;
	}

	private scrollLegendRowIntoView(itemId: string): void {
		const popover = this.element;
		if (!popover) return;
		const css = popover.ownerDocument.defaultView?.CSS;
		const selector = css
			? `[data-activity-map-id="legend-${css.escape(itemId)}"]`
			: `[data-activity-map-id="legend-${itemId}"]`;
		const row = popover.querySelector<HTMLElement>(selector);
		// scrollIntoView is absent in some DOM implementations (e.g. linkedom in
		// tests). Capability-gate rather than throw.
		if (row && typeof row.scrollIntoView === 'function') {
			row.scrollIntoView({ block: 'nearest' });
		}
	}

	private clearLocateHighlight(): void {
		this.chartHandle?.highlight(null);
		this.legendHandle?.highlight(null);
	}

	/**
	 * Cancels only the pending highlight-clear timer. Does not clear
	 * {@link pendingLocatePath}: a scope-narrowing locate sets the pending path
	 * and then cancels any prior timer, and the pending path must survive until
	 * the next ready model is rendered and completed.
	 */
	private cancelLocate(): void {
		if (this.locateTimer !== null) {
			this.trigger.ownerDocument.defaultView?.clearTimeout(this.locateTimer);
		}
		this.locateTimer = null;
	}

	private openPosterExport(): void {
		if (!this.app || this.posterModal || this.openingPoster) return;
		const model = this.controller.getViewModel();
		if (model.loadState !== 'ready' || !model.distribution) return;
		const distribution = withLiveActivity(model.distribution, model.tracking, {
			nowMs: Date.now(),
			idleThresholdMs: model.settings.idleThresholdMs,
		});
		this.openingPoster = true;
		// The modal bundles a PNG data URL. Keep that binary-only module outside
		// the Popover's unit-test import path while freezing this click's data now.
		void import('./poster-export-modal')
			.then(({ PosterExportModal }) => {
				if (!this.app || this.posterModal) return;
				const modal = new PosterExportModal(
					this.app,
					this.trigger,
					{
						query: distribution.query,
						distribution,
					},
					() => {
						this.posterModal = null;
					},
				);
				this.posterModal = modal;
				modal.open();
				this.close(false);
			})
			.catch((error: unknown) => {
				this.controller.reportWarning(
					`Poster export is unavailable: ${error instanceof Error ? error.message : String(error)}`,
				);
			})
			.finally(() => {
				this.openingPoster = false;
			});
	}

	private renderDistribution(
		popover: HTMLElement,
		model: ActivityMapViewModel,
		distribution: import('../query/distribution-query').DistributionResult,
	): void {
		const result = popover.createDiv({ cls: 'activity-map-popover-result' });
		const chartColumn = result.createDiv({ cls: 'activity-map-popover-chart-column' });
		const chart = chartColumn.createDiv({ cls: 'activity-map-popover-chart' });
		let legendHandle: ChartLegendHandle | null = null;
		const chartHandle = renderDonutChart({
			container: chart,
			distribution,
			onActivate: (item) => this.activateItem(item),
			onHighlight: (item) => legendHandle?.highlight(item?.id ?? null),
			showTooltip: false,
			tightBounds: true,
		});
		this.chartHandle = chartHandle;
		this.renderCurrentPath(chartColumn, model);
		const items = this.expandedOther
			? distribution.detailItems.filter((item) =>
					item.memberIds.some((id) => this.expandedOther?.includes(id)),
				)
			: distribution.detailItems;
		const legend = result.createDiv({ cls: 'activity-map-popover-legend' });
		if (this.expandedOther) {
			const heading = legend.createDiv({ cls: 'activity-map-detail-heading' });
			heading.createSpan({ text: 'Other items' });
			const close = heading.createEl('button', { text: 'Show all' });
			close.addEventListener('click', () => {
				this.expandedOther = null;
				this.renderIfChanged(this.controller.getViewModel(), true);
			});
		}
		legendHandle = renderChartLegend({
			container: legend,
			distribution,
			items,
			onActivate: (item) => this.activateItem(item),
			onHighlight: (item) => chartHandle.highlight(item?.id ?? null),
			onFileHover: (event, targetEl, filePath) =>
				this.previewFile?.(event, targetEl, filePath),
		});
		this.legendHandle = legendHandle;
		this.distributionView = {
			update: (nextDistribution) => {
				const nextItems = this.expandedOther
					? nextDistribution.detailItems.filter((item) =>
							item.memberIds.some((id) => this.expandedOther?.includes(id)),
						)
					: nextDistribution.detailItems;
				return (
					chartHandle.update(nextDistribution) &&
					legendHandle.update(nextDistribution, nextItems)
				);
			},
		};
	}

	private updateLiveDistribution(model: ActivityMapViewModel): void {
		if (!model.distribution || !this.distributionView) return;
		const distribution = withLiveActivity(model.distribution, model.tracking, {
			nowMs: Date.now(),
			idleThresholdMs: model.settings.idleThresholdMs,
		});
		if (!this.distributionView.update(distribution)) this.renderIfChanged(model, true);
	}

	private renderCurrentPath(popover: HTMLElement, model: ActivityMapViewModel): void {
		const path = popover.createDiv({ cls: 'activity-map-popover-path' });
		renderBreadcrumbs(
			path,
			model.query.path,
			model.query.view,
			(nextPath) => {
				this.expandedOther = null;
				void this.controller.dispatch({ kind: 'set-path', path: nextPath });
			},
			true,
		);
	}

	private activateItem(item: DistributionItem | ChartItem): void {
		const activation = distributionActivation(item);
		if (activation.kind === 'navigate') {
			this.expandedOther = null;
			void this.controller.dispatch({
				kind: 'set-path',
				path: activation.path,
				view: activation.view,
			});
		} else if (activation.kind === 'expand-other') {
			this.expandedOther = activation.memberIds;
			this.renderIfChanged(this.controller.getViewModel(), true);
		} else if (activation.kind === 'open-file') {
			void this.openFile(activation.path);
		}
	}

	private shouldStayOpen(): boolean {
		const popover = this.element;
		if (!popover) return false;
		const active = this.trigger.ownerDocument.activeElement;
		const nativePreview = this.nativePreview();
		return (
			this.pinned ||
			this.trigger.matches(':hover') ||
			popover.matches(':hover') ||
			this.trigger.contains(active) ||
			popover.contains(active) ||
			nativePreview !== null
		);
	}

	private nativePreview(): HTMLElement | null {
		const preview = this.getNativePreview?.() ?? null;
		return preview?.isConnected ? preview : null;
	}
}

function isLiveTodayQuery(model: ActivityMapViewModel): boolean {
	return (
		model.loadState === 'ready' &&
		model.distribution !== null &&
		model.tracking?.state === 'active' &&
		model.query.metric === 'activeMs' &&
		model.query.range.mode === 'day'
	);
}
