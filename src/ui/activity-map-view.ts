import { ItemView, TFile, type App, type WorkspaceLeaf } from 'obsidian';

import type { DistributionItem } from '../query/distribution-query';
import type { ActivityMapController } from './activity-map-controller';
import type { ActivityMapViewModel } from './view-model';
import { renderRangeControls } from './components/range-controls';
import { renderBreadcrumbs } from './components/breadcrumbs';
import { renderDonutChart, type ChartItem } from './components/donut-chart';
import { renderDetailList } from './components/detail-list';
import { formatMetric, formatPercent, metricLabel } from './format';
import { renderDataControls } from './data-controls';
import { QueryHistory } from './query-history';
import { distributionActivation } from './distribution-activation';

export const ACTIVITY_MAP_VIEW_TYPE = 'activity-map-view';

export class ActivityMapView extends ItemView {
	private unsubscribe: (() => void) | null = null;
	private expandedOther: string[] | null = null;
	private readonly history = new QueryHistory();

	constructor(leaf: WorkspaceLeaf, private readonly controller: ActivityMapController, private readonly hostApp: App) {
		super(leaf);
	}

	getViewType(): string { return ACTIVITY_MAP_VIEW_TYPE; }
	getDisplayText(): string { return 'Activity map'; }
	getIcon(): string { return 'chart-pie'; }

	onOpen(): Promise<void> {
		this.contentEl.addClass('activity-map-view');
		this.unsubscribe = this.controller.subscribe((model) => this.render(model));
		void this.controller.dispatch({ kind: 'refresh' });
		return Promise.resolve();
	}

	onClose(): Promise<void> {
		this.unsubscribe?.();
		this.unsubscribe = null;
		this.contentEl.empty();
		return Promise.resolve();
	}

	async goHistory(direction: 'back' | 'forward'): Promise<void> {
		const current = this.controller.getViewModel().query;
		const query = direction === 'back' ? this.history.back(current) : this.history.forward(current);
		if (!query) return;
		this.expandedOther = null;
		await this.controller.dispatch({ kind: 'set-query', query });
	}

	private render(model: ActivityMapViewModel): void {
		const focusedId = (this.contentEl.ownerDocument.activeElement as HTMLElement | null)?.dataset.activityMapId;
		this.contentEl.empty();
		const header = this.contentEl.createEl('header', { cls: 'activity-map-view-header' });
		header.createEl('h2', { text: 'Activity map' });
		const headerActions = header.createDiv({ cls: 'activity-map-view-actions' });
		const back = headerActions.createEl('button', { text: 'Back', attr: { 'data-activity-map-id': 'history-back' } });
		back.disabled = !this.history.canGoBack;
		back.addEventListener('click', () => void this.goHistory('back'));
		const forward = headerActions.createEl('button', { text: 'Forward', attr: { 'data-activity-map-id': 'history-forward' } });
		forward.disabled = !this.history.canGoForward;
		forward.addEventListener('click', () => void this.goHistory('forward'));
		const paused = model.tracking?.state === 'paused';
		const pause = headerActions.createEl('button', { text: paused ? 'Resume tracking' : 'Pause tracking', attr: { 'data-activity-map-id': 'tracking-toggle' } });
		pause.addEventListener('click', () => void this.controller.dispatch({ kind: paused ? 'resume' : 'pause' }));
		renderRangeControls({
			container: this.contentEl,
			metric: model.query.metric,
			range: model.query.range,
			onMetric: (metric) => void this.navigate({ kind: 'set-metric', metric }),
			onRange: (range) => void this.navigate({ kind: 'set-range', range }),
		});
		renderBreadcrumbs(this.contentEl, model.query.path, model.query.view, (path) => {
			this.expandedOther = null;
			void this.navigate({ kind: 'set-path', path });
		});
		renderDataControls(this.contentEl, model, this.controller);
		if (model.loadState === 'loading') {
			this.contentEl.createEl('p', { text: 'Loading activity…', cls: 'activity-map-state', attr: { 'aria-live': 'polite' } });
			return;
		}
		if (model.loadState === 'error') {
			this.contentEl.createEl('p', { text: model.error ?? 'Activity query failed.', cls: 'activity-map-state mod-error', attr: { role: 'alert' } });
			return;
		}
		const distribution = model.distribution;
		if (!distribution || model.loadState === 'empty') {
			this.contentEl.createEl('p', { text: 'No activity was recorded for this range.', cls: 'activity-map-state' });
			return;
		}
		const summary = this.contentEl.createDiv({ cls: 'activity-map-summary' });
		summary.createDiv({ text: metricLabel(model.query.metric), cls: 'activity-map-summary-label' });
		summary.createDiv({ text: formatMetric(distribution.scopeTotal, model.query.metric, distribution.denominatorDays), cls: 'activity-map-summary-total' });
		summary.createDiv({ text: `${formatPercent(distribution.percentOfVault)} of vault`, cls: 'activity-map-summary-vault' });
		if (distribution.coverage) summary.createDiv({ text: `${distribution.coverage.firstDate} – ${distribution.coverage.lastDate}`, cls: 'activity-map-summary-coverage' });
		const body = this.contentEl.createDiv({ cls: 'activity-map-body' });
		const chart = body.createDiv({ cls: 'activity-map-chart-panel' });
		let detailHandle: { highlight(itemId: string | null): void } | null = null;
		const chartHandle = renderDonutChart({
			container: chart,
			distribution,
			onActivate: (item) => this.activateItem(item),
			onHighlight: (item) => detailHandle?.highlight(item?.id ?? null),
		});
		const details = body.createDiv({ cls: 'activity-map-details-panel' });
		const detailItems = this.expandedOther
			? distribution.detailItems.filter((item) => item.memberIds.some((id) => this.expandedOther?.includes(id)))
			: distribution.detailItems;
		if (this.expandedOther) {
			const heading = details.createDiv({ cls: 'activity-map-detail-heading' });
			heading.createSpan({ text: 'Other items' });
			const close = heading.createEl('button', { text: 'Show all', cls: 'mod-cta' });
			close.addEventListener('click', () => { this.expandedOther = null; this.render(model); });
		}
		detailHandle = renderDetailList({
			container: details,
			distribution,
			items: detailItems,
			onActivate: (item) => this.activateItem(item),
			onHighlight: (item) => chartHandle.highlight(item?.id ?? null),
		});
		if (model.warnings.length > 0) {
			const warnings = this.contentEl.createEl('details', { cls: 'activity-map-warnings' });
			warnings.createEl('summary', { text: `${model.warnings.length} data warning${model.warnings.length === 1 ? '' : 's'}` });
			for (const warning of model.warnings) warnings.createEl('p', { text: warning });
		}
		const css = this.contentEl.ownerDocument.defaultView?.CSS;
		if (focusedId && css) this.contentEl.querySelector<HTMLElement>(`[data-activity-map-id="${css.escape(focusedId)}"]`)?.focus();
	}

	private activateItem(item: DistributionItem | ChartItem): void {
		const activation = distributionActivation(item);
		if (activation.kind === 'navigate') {
			this.expandedOther = null;
			void this.navigate({ kind: 'set-path', path: activation.path, view: activation.view });
		} else if (activation.kind === 'expand-other') {
			this.expandedOther = activation.memberIds;
			this.render(this.controller.getViewModel());
		} else if (activation.kind === 'open-file') {
			const file = this.hostApp.vault.getAbstractFileByPath(activation.path);
			if (file instanceof TFile) void this.hostApp.workspace.getLeaf(false).openFile(file);
		}
	}

	private async navigate(intent: Extract<Parameters<ActivityMapController['dispatch']>[0], { kind: 'set-path' | 'set-range' | 'set-metric' }>): Promise<void> {
		this.history.push(this.controller.getViewModel().query);
		await this.controller.dispatch(intent);
	}
}
