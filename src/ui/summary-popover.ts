import type { DistributionItem } from '../query/distribution-query';
import type { ActivityMapController } from './activity-map-controller';
import type { ActivityMapViewModel } from './view-model';
import { distributionActivation } from './distribution-activation';
import { renderBreadcrumbs } from './components/breadcrumbs';
import { renderChartLegend, type ChartLegendHandle } from './components/chart-legend';
import { renderDonutChart, type ChartItem } from './components/donut-chart';
import { renderRangeControls } from './components/range-controls';
import { withLiveActivity } from './live-distribution';

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

	constructor(
		private readonly trigger: HTMLElement,
		private readonly controller: ActivityMapController,
		private readonly openView: () => Promise<void>,
		private readonly openFile: (filePath: string) => Promise<void>,
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
			if (!OwnerNode || !(next instanceof OwnerNode) || (!popover.contains(next) && !this.trigger.contains(next))) {
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
			if (OwnerNode && target instanceof OwnerNode && !popover.contains(target) && !this.trigger.contains(target)) {
				this.close(false);
			}
		};
		doc.addEventListener('pointerdown', this.outsideHandler, true);
		void this.controller.dispatch({ kind: 'set-query', query: this.controller.getHeaderDefaultQuery() });
		this.unsubscribe = this.controller.subscribe((model) => this.renderIfChanged(model));
		this.liveTimer = doc.defaultView?.setInterval(() => {
			const model = this.controller.getViewModel();
			if (isLiveTodayQuery(model)) this.renderIfChanged(model, true);
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
		this.closeTimer = this.trigger.ownerDocument.defaultView?.setTimeout(() => this.close(false), 180) ?? null;
	}

	cancelClose(): void {
		if (this.closeTimer !== null) this.trigger.ownerDocument.defaultView?.clearTimeout(this.closeTimer);
		this.closeTimer = null;
	}

	close(restoreFocus: boolean): void {
		this.cancelClose();
		if (this.outsideHandler) this.trigger.ownerDocument.removeEventListener('pointerdown', this.outsideHandler, true);
		this.outsideHandler = null;
		this.unsubscribe?.();
		this.unsubscribe = null;
		if (this.liveTimer !== null) this.trigger.ownerDocument.defaultView?.clearInterval(this.liveTimer);
		this.liveTimer = null;
		this.element?.remove();
		this.element = null;
		this.pinned = false;
		this.expandedOther = null;
		this.lastRenderKey = '';
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
		const left = Math.max(margin, Math.min(triggerRect.left, (viewport?.innerWidth ?? triggerRect.right + width) - width - margin));
		const below = triggerRect.bottom + 6;
		const top = below + height <= (viewport?.innerHeight ?? below + height)
			? below
			: Math.max(margin, triggerRect.top - height - 6);
		popover.style.left = `${String(left)}px`;
		popover.style.top = `${String(top)}px`;
	}

	private renderIfChanged(model: ActivityMapViewModel, force = false): void {
		const trackingKey = model.tracking
			? `${model.tracking.state}:${model.tracking.sampledAt}:${model.tracking.lastTrustedActivityAt ?? ''}`
			: 'none';
		const key = `${String(model.queryGeneration)}:${model.loadState}:${trackingKey}:${this.expandedOther?.join(',') ?? ''}`;
		if (!force && key === this.lastRenderKey) return;
		this.lastRenderKey = key;
		this.render(model);
	}

	private render(model: ActivityMapViewModel): void {
		const popover = this.element;
		if (!popover) return;
		const focusedId = (popover.ownerDocument.activeElement as HTMLElement | null)?.dataset.activityMapId;
		popover.empty();

		renderRangeControls({
			container: popover,
			metric: model.query.metric,
			range: model.query.range,
			onMetric: (metric) => { this.expandedOther = null; void this.controller.dispatch({ kind: 'set-metric', metric }); },
			onRange: (range) => { this.expandedOther = null; void this.controller.dispatch({ kind: 'set-range', range }); },
			trailingAction: {
				icon: 'expand',
				label: 'Open full activity map view',
				onActivate: () => { this.close(false); void this.openView(); },
			},
		});

		if (model.loadState === 'loading') {
			popover.createEl('p', { text: 'Loading activity…', cls: 'activity-map-state', attr: { 'aria-live': 'polite' } });
		} else if (model.loadState === 'error') {
			popover.createEl('p', { text: model.error ?? 'Activity query failed.', cls: 'activity-map-state mod-error', attr: { role: 'alert' } });
		} else if (!model.distribution || model.loadState === 'empty') {
			popover.createEl('p', { text: 'No activity was recorded for this range.', cls: 'activity-map-state' });
		} else {
			this.renderDistribution(popover, model);
		}
		if (!model.distribution || model.loadState !== 'ready') this.renderCurrentPath(popover, model);
		const css = popover.ownerDocument.defaultView?.CSS;
		if (focusedId && css) popover.querySelector<HTMLElement>(`[data-activity-map-id="${css.escape(focusedId)}"]`)?.focus();
		this.position();
	}

	private renderDistribution(popover: HTMLElement, model: ActivityMapViewModel): void {
		const distribution = model.distribution
			? withLiveActivity(model.distribution, model.tracking, {
				nowMs: Date.now(),
				idleThresholdMs: model.settings.idleThresholdMs,
			})
			: null;
		if (!distribution) return;

		const chart = popover.createDiv({ cls: 'activity-map-popover-chart' });
		let legendHandle: ChartLegendHandle | null = null;
		const chartHandle = renderDonutChart({
			container: chart,
			distribution,
			onActivate: (item) => this.activateItem(item),
			onHighlight: (item) => legendHandle?.highlight(item?.id ?? null),
			showTooltip: false,
		});
		this.renderCurrentPath(popover, model);
		const items = this.expandedOther
			? distribution.detailItems.filter((item) => item.memberIds.some((id) => this.expandedOther?.includes(id)))
			: distribution.detailItems;
		const legend = popover.createDiv({ cls: 'activity-map-popover-legend' });
		if (this.expandedOther) {
			const heading = legend.createDiv({ cls: 'activity-map-detail-heading' });
			heading.createSpan({ text: 'Other items' });
			const close = heading.createEl('button', { text: 'Show all' });
			close.addEventListener('click', () => { this.expandedOther = null; this.renderIfChanged(this.controller.getViewModel(), true); });
		}
		legendHandle = renderChartLegend({
			container: legend,
			distribution,
			items,
			onActivate: (item) => this.activateItem(item),
			onHighlight: (item) => chartHandle.highlight(item?.id ?? null),
		});
	}

	private renderCurrentPath(popover: HTMLElement, model: ActivityMapViewModel): void {
		const path = popover.createDiv({ cls: 'activity-map-popover-path' });
		renderBreadcrumbs(path, model.query.path, model.query.view, (nextPath) => {
			this.expandedOther = null;
			void this.controller.dispatch({ kind: 'set-path', path: nextPath });
		});
	}

	private activateItem(item: DistributionItem | ChartItem): void {
		const activation = distributionActivation(item);
		if (activation.kind === 'navigate') {
			this.expandedOther = null;
			void this.controller.dispatch({ kind: 'set-path', path: activation.path, view: activation.view });
		} else if (activation.kind === 'expand-other') {
			this.expandedOther = activation.memberIds;
			this.renderIfChanged(this.controller.getViewModel(), true);
		} else if (activation.kind === 'open-file') {
			void this.openFile(activation.path);
		}
	}

}

function isLiveTodayQuery(model: ActivityMapViewModel): boolean {
	return model.loadState === 'ready' &&
		model.distribution !== null &&
		model.tracking?.state === 'active' &&
		model.query.metric === 'activeMs' &&
		model.query.range.mode === 'day';
}
