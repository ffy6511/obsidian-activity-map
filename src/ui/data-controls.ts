import type { DeletionPlan, DeletionResult, DeletionScope } from '../data/deletion-service';
import type { DeletionService } from '../data/deletion-service';
import type { RawExportService, ExportScope } from '../data/raw-export-service';
import type { RebuildService, RebuildResult } from '../data/rebuild-service';
import type { DataOperationProgress } from '../data/retention-service';
import type { DistributionQuery, DistributionResult } from '../query/distribution-query';
import { exportSvg, type SvgExportMode } from '../export/svg-exporter';
import type { BrowserExportDestination, ExportDestinationResult } from '../export/export-destination';
import type { ActivityMapController } from './activity-map-controller';
import type { ActivityMapViewModel } from './view-model';
import { renderDeletionConfirmation } from './deletion-confirmation';

export interface DataOperationPort {
	exportSvg(args: { mode: SvgExportMode; query: DistributionQuery; distribution: DistributionResult }): Promise<ExportDestinationResult>;
	exportRaw(args: { scope: ExportScope; onProgress: (progress: DataOperationProgress) => void }): Promise<{ destination: ExportDestinationResult; warnings: number; records: number }>;
	rebuild(onProgress: (progress: DataOperationProgress) => void): Promise<RebuildResult>;
	planDeletion(scope: DeletionScope): Promise<DeletionPlan>;
	executeDeletion(plan: DeletionPlan, onProgress: (progress: DataOperationProgress) => void): Promise<DeletionResult>;
}

export class LocalDataOperations implements DataOperationPort {
	constructor(
		private readonly rawExport: RawExportService,
		private readonly rebuildService: RebuildService,
		private readonly deletionService: DeletionService,
		private readonly destination: BrowserExportDestination,
		private readonly nowIso: () => string,
	) {}

	async exportSvg(args: { mode: SvgExportMode; query: DistributionQuery; distribution: DistributionResult }): Promise<ExportDestinationResult> {
		const result = exportSvg({ mode: args.mode, title: 'Activity Map', query: args.query, distribution: args.distribution });
		return this.destination.download(result.svg, result.filename, 'image/svg+xml;charset=utf-8');
	}

	async exportRaw(args: { scope: ExportScope; onProgress: (progress: DataOperationProgress) => void }): Promise<{ destination: ExportDestinationResult; warnings: number; records: number }> {
		const result = await this.rawExport.export({ scope: args.scope, nowIso: this.nowIso(), onProgress: args.onProgress });
		const scope = result.scope.kind === 'date'
			? result.scope.localDate
			: result.scope.kind === 'file' ? `file-${result.scope.fileId.replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 48)}` : 'all';
		const destination = this.destination.download(JSON.stringify(result, null, 2), `activity-map-raw-${scope}.json`, 'application/json;charset=utf-8');
		return { destination, warnings: result.warnings.length, records: result.recordCount };
	}

	rebuild(onProgress: (progress: DataOperationProgress) => void): Promise<RebuildResult> {
		return this.rebuildService.rebuild({ nowIso: this.nowIso(), onProgress });
	}

	planDeletion(scope: DeletionScope): Promise<DeletionPlan> {
		return this.deletionService.planDeletion({ scope, nowIso: this.nowIso() });
	}

	executeDeletion(plan: DeletionPlan, onProgress: (progress: DataOperationProgress) => void): Promise<DeletionResult> {
		return this.deletionService.executeDeletion({ plan, nowIso: this.nowIso(), onProgress });
	}
}

export function renderDataControls(container: HTMLElement, model: ActivityMapViewModel, controller: ActivityMapController): void {
	const section = container.createEl('section', { cls: 'activity-map-data-controls', attr: { 'aria-label': 'Export and data controls' } });
	section.createEl('h3', { text: 'Export and data' });
	section.createEl('p', { text: 'Exports include the displayed paths and statistics. Activity map never reads note content.', cls: 'activity-map-data-disclosure' });
	const controls = section.createDiv({ cls: 'activity-map-data-control-buttons' });
	const hasDistribution = model.distribution !== null && model.loadState !== 'loading' && model.loadState !== 'error';
	for (const [mode, label] of [['infographic', 'Export infographic SVG'], ['chart-only', 'Export chart SVG']] as const) {
		const button = controls.createEl('button', { text: label });
		button.disabled = !hasDistribution || model.operation.kind === 'running';
		button.addEventListener('click', () => void controller.dispatch({ kind: 'export-svg', mode }));
	}
	const raw = controls.createEl('button', { text: 'Export raw JSON' });
	raw.disabled = model.operation.kind === 'running';
	raw.addEventListener('click', () => void controller.dispatch({ kind: 'export-raw', scope: exportScopeFor(model) }));
	const rebuild = controls.createEl('button', { text: 'Rebuild summaries' });
	rebuild.disabled = model.operation.kind === 'running';
	rebuild.addEventListener('click', () => void controller.dispatch({ kind: 'rebuild-summaries' }));

	const deletion = section.createDiv({ cls: 'activity-map-deletion-controls' });
	const dateButton = deletion.createEl('button', { text: 'Clear selected date' });
	dateButton.disabled = model.query.range.mode !== 'day' || model.operation.kind === 'running';
	dateButton.addEventListener('click', () => {
		if (model.query.range.mode === 'day') void controller.dispatch({ kind: 'plan-deletion', scope: { kind: 'date', localDate: model.query.range.localDate } });
	});
	const fileSelect = deletion.createEl('select', { attr: { 'aria-label': 'File to clear' } });
	fileSelect.createEl('option', { text: 'Choose a file…', value: '' });
	for (const item of model.distribution?.detailItems ?? []) {
		if (item.kind !== 'file' || item.memberIds.length !== 1) continue;
		fileSelect.createEl('option', { text: item.path ?? item.label, value: item.memberIds[0] });
	}
	const fileButton = deletion.createEl('button', { text: 'Clear selected file' });
	fileButton.disabled = model.operation.kind === 'running';
	fileButton.addEventListener('click', () => {
		if (fileSelect.value) void controller.dispatch({ kind: 'plan-deletion', scope: { kind: 'file', fileId: fileSelect.value } });
	});
	const fileExport = deletion.createEl('button', { text: 'Export selected file JSON' });
	fileExport.disabled = model.operation.kind === 'running';
	fileExport.addEventListener('click', () => {
		if (fileSelect.value) void controller.dispatch({ kind: 'export-raw', scope: { kind: 'file', fileId: fileSelect.value } });
	});
	const allButton = deletion.createEl('button', { text: 'Clear all activity data', cls: 'mod-warning' });
	allButton.disabled = model.operation.kind === 'running';
	allButton.addEventListener('click', () => void controller.dispatch({ kind: 'plan-deletion', scope: { kind: 'all' } }));

	if (model.operation.kind === 'running') {
		section.createEl('p', { text: `${model.operation.label}: ${model.operation.completed}/${model.operation.total || '?'}`, attr: { 'aria-live': 'polite' } });
	} else if (model.operation.kind === 'completed' || model.operation.kind === 'error') {
		section.createEl('p', { text: model.operation.message, cls: model.operation.kind === 'error' ? 'mod-error' : undefined, attr: { role: model.operation.kind === 'error' ? 'alert' : 'status' } });
	}
	if (model.operation.kind === 'deletion-preview') renderDeletionConfirmation(section, model.operation.plan, controller);
}

function exportScopeFor(model: ActivityMapViewModel): ExportScope {
	return model.query.range.mode === 'day' ? { kind: 'date', localDate: model.query.range.localDate } : { kind: 'all' };
}
