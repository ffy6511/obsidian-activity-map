import { AUTO_EXCLUSION_UNDO_MS } from '../tracking/recovery-queue';
import type { DistributionItem } from '../query/distribution-query';
import type { ActivityMapController } from './activity-map-controller';
import type { ActivityMapViewModel } from './view-model';
import { distributionActivation } from './distribution-activation';
import { formatMetric, formatPercent, metricLabel } from './format';
import { statusPresentation } from './status-presentation';
import { renderBreadcrumbs } from './components/breadcrumbs';
import { renderChartLegend, type ChartLegendHandle } from './components/chart-legend';
import { renderDonutChart, type ChartItem } from './components/donut-chart';
import { renderRangeControls } from './components/range-controls';

/** Prevents a destructive or evidentiary action from being submitted twice. */
export class SingleFlightActions {
	private readonly pending = new Set<string>();

	begin(id: string): boolean {
		if (this.pending.has(id)) return false;
		this.pending.add(id);
		return true;
	}
}

/** Interactive, pinnable header chart sharing the controller's query state. */
export class SummaryPopover {
	private element: HTMLElement | null = null;
	private closeTimer: number | null = null;
	private outsideHandler: ((event: PointerEvent) => void) | null = null;
	private unsubscribe: (() => void) | null = null;
	private pinned = false;
	private expandedOther: string[] | null = null;
	private lastRenderKey = '';
	private readonly actions = new SingleFlightActions();

	constructor(
		private readonly trigger: HTMLElement,
		private readonly controller: ActivityMapController,
		private readonly filePath: string,
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
		const semanticTracking = [
			model.tracking?.state ?? 'starting',
			model.tracking?.currentTarget?.path ?? '',
			...(model.tracking?.pendingRecovery.map((item) => item.candidateId) ?? []),
			...(model.tracking?.recentDecisions.map((item) => item.candidateId) ?? []),
		].join('|');
		const key = `${String(model.queryGeneration)}:${model.loadState}:${semanticTracking}:${this.expandedOther?.join(',') ?? ''}`;
		if (!force && key === this.lastRenderKey) return;
		this.lastRenderKey = key;
		this.render(model);
	}

	private render(model: ActivityMapViewModel): void {
		const popover = this.element;
		if (!popover) return;
		const focusedId = (popover.ownerDocument.activeElement as HTMLElement | null)?.dataset.activityMapId;
		popover.empty();

		const header = popover.createEl('header', { cls: 'activity-map-popover-header' });
		header.createEl('h3', { text: 'Activity map' });
		const expand = header.createEl('button', {
			text: 'Expand',
			cls: 'clickable-icon',
			attr: { 'data-activity-map-id': 'expand-view', 'aria-label': 'Open full activity map view' },
		});
		expand.addEventListener('click', () => { this.close(false); void this.openView(); });

		renderRangeControls({
			container: popover,
			metric: model.query.metric,
			range: model.query.range,
			onMetric: (metric) => { this.expandedOther = null; void this.controller.dispatch({ kind: 'set-metric', metric }); },
			onRange: (range) => { this.expandedOther = null; void this.controller.dispatch({ kind: 'set-range', range }); },
		});
		renderBreadcrumbs(popover, model.query.path, model.query.view, (path) => {
			this.expandedOther = null;
			void this.controller.dispatch({ kind: 'set-path', path });
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

		this.renderTrackingAuxiliary(popover, model);
		const css = popover.ownerDocument.defaultView?.CSS;
		if (focusedId && css) popover.querySelector<HTMLElement>(`[data-activity-map-id="${css.escape(focusedId)}"]`)?.focus();
		this.position();
	}

	private renderDistribution(popover: HTMLElement, model: ActivityMapViewModel): void {
		const distribution = model.distribution;
		if (!distribution) return;
		const summary = popover.createDiv({ cls: 'activity-map-popover-summary' });
		summary.createSpan({ text: metricLabel(model.query.metric), cls: 'activity-map-summary-label' });
		summary.createSpan({
			text: formatMetric(distribution.scopeTotal, model.query.metric, distribution.denominatorDays),
			cls: 'activity-map-summary-total',
		});
		summary.createSpan({ text: `${formatPercent(distribution.percentOfVault)} of vault`, cls: 'activity-map-summary-vault' });

		const chart = popover.createDiv({ cls: 'activity-map-popover-chart' });
		let legendHandle: ChartLegendHandle | null = null;
		const chartHandle = renderDonutChart({
			container: chart,
			distribution,
			onActivate: (item) => this.activateItem(item),
			onHighlight: (item) => legendHandle?.highlight(item?.id ?? null),
		});
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

	private renderTrackingAuxiliary(popover: HTMLElement, model: ActivityMapViewModel): void {
		const auxiliary = popover.createEl('details', { cls: 'activity-map-popover-auxiliary' });
		const status = statusPresentation(model.tracking, this.filePath);
		auxiliary.createEl('summary', { text: status.label });
		for (const candidate of model.tracking?.pendingRecovery ?? []) {
			const row = auxiliary.createDiv({ cls: 'activity-map-recovery-row' });
			row.createSpan({ text: `Review ${formatMetric(candidate.gapMs, 'activeMs')}` });
			this.addDecisionButton(row, candidate.candidateId, 'include', 'Include');
			this.addDecisionButton(row, candidate.candidateId, 'exclude', 'Exclude');
		}
		const sampledAt = Date.parse(model.tracking?.sampledAt ?? '');
		for (const decision of model.tracking?.recentDecisions ?? []) {
			const ageMs = sampledAt - Date.parse(decision.decidedAt);
			if (!decision.automatic || !Number.isFinite(ageMs) || ageMs < 0 || ageMs > AUTO_EXCLUSION_UNDO_MS) continue;
			const row = auxiliary.createDiv({ cls: 'activity-map-recovery-row' });
			row.createSpan({ text: 'Recent interval excluded automatically' });
			const undo = row.createEl('button', { text: 'Undo', attr: { 'data-activity-map-id': `undo-${decision.candidateId}` } });
			undo.addEventListener('click', () => {
				const key = `undo:${decision.candidateId}`;
				if (!this.actions.begin(key)) return;
				undo.disabled = true;
				void this.controller.dispatch({ kind: 'undo-automatic-exclusion', candidateId: decision.candidateId });
			});
		}
		const paused = model.tracking?.state === 'paused';
		const pause = auxiliary.createEl('button', {
			text: paused ? 'Resume tracking' : 'Pause tracking',
			attr: { 'data-activity-map-id': 'tracking-toggle' },
		});
		pause.addEventListener('click', () => void this.controller.dispatch({ kind: paused ? 'resume' : 'pause' }));
	}

	private addDecisionButton(row: HTMLElement, candidateId: string, decision: 'include' | 'exclude', label: string): void {
		const button = row.createEl('button', { text: label, attr: { 'data-activity-map-id': `${decision}-${candidateId}` } });
		button.addEventListener('click', () => {
			if (!this.actions.begin(candidateId)) return;
			row.querySelectorAll<HTMLButtonElement>('button').forEach((sibling) => { sibling.disabled = true; });
			void this.controller.dispatch({ kind: 'resolve-recovery', candidateId, decision });
		});
	}
}
