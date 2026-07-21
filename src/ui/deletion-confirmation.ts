import type { DeletionPlan } from '../data/deletion-service';
import type { ActivityMapController } from './activity-map-controller';

export function renderDeletionConfirmation(container: HTMLElement, plan: DeletionPlan, controller: ActivityMapController): void {
	const panel = container.createDiv({ cls: 'activity-map-deletion-confirmation', attr: { role: 'alertdialog', 'aria-labelledby': `activity-map-delete-${plan.planId}` } });
	panel.createEl('h4', { text: 'Confirm irreversible deletion', attr: { id: `activity-map-delete-${plan.planId}` } });
	panel.createEl('p', { text: `${scopeLabel(plan)} removes ${plan.affectedRecordCount} raw record${plan.affectedRecordCount === 1 ? '' : 's'} and ${plan.affectedSummaryCount} summar${plan.affectedSummaryCount === 1 ? 'y' : 'ies'}.` });
	panel.createEl('p', { text: `Plan ID: ${plan.planId}`, cls: 'activity-map-plan-id' });
	const actions = panel.createDiv({ cls: 'activity-map-popover-actions' });
	const cancel = actions.createEl('button', { text: 'Cancel' });
	cancel.addEventListener('click', () => void controller.dispatch({ kind: 'dismiss-operation' }));
	const execute = actions.createEl('button', { text: 'Delete planned data', cls: 'mod-warning' });
	execute.addEventListener('click', () => {
		execute.disabled = true;
		cancel.disabled = true;
		void controller.dispatch({ kind: 'execute-deletion', planId: plan.planId });
	});
}

function scopeLabel(plan: DeletionPlan): string {
	if (plan.scope.kind === 'all') return 'All Activity Map data';
	if (plan.scope.kind === 'date') return `Activity Map data for ${plan.scope.localDate}`;
	return `Activity Map data for file ${plan.scope.fileId}`;
}
