import { AUTO_EXCLUSION_UNDO_MS } from '../tracking/recovery-queue';
import { startOfLocalDayMs } from '../platform/clock';
import type { ActivityMapController } from './activity-map-controller';
import { formatMetric } from './format';
import { statusPresentation } from './status-presentation';

/** Prevents a destructive or evidentiary action from being submitted twice. */
export class SingleFlightActions {
	private readonly pending = new Set<string>();

	begin(id: string): boolean {
		if (this.pending.has(id)) return false;
		this.pending.add(id);
		return true;
	}
}

export class SummaryPopover {
	private element: HTMLElement | null = null;
	private closeTimer: number | null = null;
	private outsideHandler: ((event: PointerEvent) => void) | null = null;
	private unsubscribe: (() => void) | null = null;
	private summary = { fileActiveMs: 0, vaultActiveMs: 0 };
	private readonly actions = new SingleFlightActions();

	constructor(
		private readonly trigger: HTMLElement,
		private readonly controller: ActivityMapController,
		private readonly filePath: string,
		private readonly openView: () => Promise<void>,
	) {}

	open(): void {
		this.cancelClose();
		if (this.element) return;
		const doc = this.trigger.ownerDocument;
		const popover = doc.body.createDiv({
			cls: 'activity-map-popover',
			attr: { role: 'dialog', 'aria-label': 'Activity Map summary' },
		});
		this.element = popover;
		this.render();
		this.position();
		popover.addEventListener('pointerenter', () => this.cancelClose());
		popover.addEventListener('pointerleave', () => this.scheduleClose());
		popover.addEventListener('focusin', () => this.cancelClose());
		popover.addEventListener('focusout', (event) => {
			const next = event.relatedTarget;
			if (!(next instanceof (doc.defaultView?.Node ?? Node)) || (!popover.contains(next) && !this.trigger.contains(next))) {
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
			if (OwnerNode && target instanceof OwnerNode && !popover.contains(target) && !this.trigger.contains(target)) this.close(false);
		};
		doc.addEventListener('pointerdown', this.outsideHandler, true);
		this.unsubscribe = this.controller.subscribe(() => this.render());
		void this.controller.getStatusSummary(this.filePath).then((summary) => {
			if (!this.element) return;
			this.summary = summary;
			this.render();
		}).catch((error: unknown) => {
			this.controller.reportWarning(`Status summary unavailable: ${error instanceof Error ? error.message : String(error)}`);
		});
	}

	scheduleClose(): void {
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
		if (restoreFocus && this.trigger.isConnected) this.trigger.focus();
	}

	private position(): void {
		const popover = this.element;
		if (!popover) return;
		const viewport = this.trigger.ownerDocument.defaultView;
		const triggerRect = this.trigger.getBoundingClientRect();
		const popoverRect = popover.getBoundingClientRect();
		const margin = 8;
		const width = popoverRect.width || 320;
		const height = popoverRect.height || 240;
		const left = Math.max(margin, Math.min(triggerRect.left, (viewport?.innerWidth ?? triggerRect.right + width) - width - margin));
		const below = triggerRect.bottom + 6;
		const top = below + height <= (viewport?.innerHeight ?? below + height)
			? below
			: Math.max(margin, triggerRect.top - height - 6);
		popover.style.left = `${left}px`;
		popover.style.top = `${top}px`;
	}

	private render(): void {
		const popover = this.element;
		if (!popover) return;
		const focusedAction = (popover.ownerDocument.activeElement as HTMLElement | null)?.dataset.activityMapAction;
		popover.empty();
		const model = this.controller.getViewModel();
		popover.createEl('h3', { text: this.filePath.split('/').pop() ?? this.filePath });
		const status = statusPresentation(model.tracking, this.filePath);
		popover.createEl('p', { text: status.label, cls: 'activity-map-popover-status', attr: { 'aria-live': 'polite' } });
		const metrics = popover.createDiv({ cls: 'activity-map-popover-metrics' });
		const liveMs = this.liveActiveMs();
		metrics.createDiv({ text: `This file today: ${formatMetric(this.summary.fileActiveMs + liveMs, 'activeMs')}` });
		metrics.createDiv({ text: `Vault today: ${formatMetric(this.summary.vaultActiveMs + liveMs, 'activeMs')}` });
		for (const candidate of model.tracking?.pendingRecovery ?? []) {
			const row = popover.createDiv({ cls: 'activity-map-recovery-row' });
			row.createSpan({ text: `Review ${formatMetric(candidate.gapMs, 'activeMs')}` });
			this.addDecisionButton(row, candidate.candidateId, 'include', 'Include');
			this.addDecisionButton(row, candidate.candidateId, 'exclude', 'Exclude');
		}
		const sampledAt = Date.parse(model.tracking?.sampledAt ?? '');
		for (const decision of model.tracking?.recentDecisions ?? []) {
			const ageMs = sampledAt - Date.parse(decision.decidedAt);
			if (!decision.automatic || !Number.isFinite(ageMs) || ageMs < 0 || ageMs > AUTO_EXCLUSION_UNDO_MS) continue;
			const row = popover.createDiv({ cls: 'activity-map-recovery-row' });
			row.createSpan({ text: 'Recent interval excluded automatically' });
			const undo = row.createEl('button', { text: 'Undo', attr: { 'data-activity-map-action': `undo-${decision.candidateId}` } });
			undo.addEventListener('click', () => {
				const key = `undo:${decision.candidateId}`;
				if (!this.actions.begin(key)) return;
				undo.disabled = true;
				void this.controller.dispatch({ kind: 'undo-automatic-exclusion', candidateId: decision.candidateId });
			});
		}
		const actions = popover.createDiv({ cls: 'activity-map-popover-actions' });
		const paused = model.tracking?.state === 'paused';
		const pause = actions.createEl('button', { text: paused ? 'Resume' : 'Pause', attr: { 'data-activity-map-action': 'pause' } });
		pause.addEventListener('click', () => void this.controller.dispatch({ kind: paused ? 'resume' : 'pause' }));
		const open = actions.createEl('button', { text: 'Open activity map', cls: 'mod-cta', attr: { 'data-activity-map-action': 'open' } });
		open.addEventListener('click', () => { this.close(false); void this.openView(); });
		if (focusedAction) popover.querySelector<HTMLElement>(`[data-activity-map-action="${CSS.escape(focusedAction)}"]`)?.focus();
	}

	private addDecisionButton(row: HTMLElement, candidateId: string, decision: 'include' | 'exclude', label: string): void {
		const button = row.createEl('button', { text: label, attr: { 'data-activity-map-action': `${decision}-${candidateId}` } });
		button.addEventListener('click', () => {
			if (!this.actions.begin(candidateId)) return;
			row.querySelectorAll<HTMLButtonElement>('button').forEach((sibling) => { sibling.disabled = true; });
			void this.controller.dispatch({ kind: 'resolve-recovery', candidateId, decision }).then(() => this.close(false));
		});
	}

	private liveActiveMs(): number {
		const snapshot = this.controller.getViewModel().tracking;
		if (snapshot?.state !== 'active' || snapshot.currentTarget?.path !== this.filePath || !snapshot.sessionStartedAt) return 0;
		const sampledAt = Date.parse(snapshot.sampledAt);
		const dayStart = startOfLocalDayMs(sampledAt, Intl.DateTimeFormat().resolvedOptions().timeZone);
		return Math.max(0, sampledAt - Math.max(Date.parse(snapshot.sessionStartedAt), dayStart));
	}
}
