/**
 * Distribution query engine.
 *
 * Combines a resolved date range, per-device daily summaries, and the current-
 * path registry projection into an immutable {@link DistributionResult}. The
 * result carries scope and vault totals, the day denominator and coverage, the
 * top-N chart items plus a derived "other", the complete detail list, and any
 * warnings. It never rewrites raw evidence: it reads verified summaries and the
 * registry snapshot only.
 */

import type { DailySummary, DataWarning } from '../data/daily-summary-repository';
import type { FileRegistryEntry } from '../data/file-registry';
import type { MetricKey, ProjectedFile } from './path-projection';
import { projectAndGroup } from './path-projection';
import type { RangeMode, ResolvedRange } from './date-range';

/** How items inside the selected path scope are presented. */
export type DistributionGrouping = 'path' | 'file';

/** A query request from the UI. */
export interface DistributionQuery {
	metric: MetricKey;
	range: RangeMode;
	path: string;
	view: 'children' | 'local-files';
	groupBy: DistributionGrouping;
}

/** One item in the distribution result (chart or detail). */
export interface DistributionItem {
	id: string;
	kind: 'directory' | 'file' | 'local-files' | 'other' | 'deleted';
	label: string;
	path: string | null;
	value: number;
	percentOfScope: number;
	memberIds: string[];
}

/** The immutable query result. */
export interface DistributionResult {
	query: DistributionQuery;
	scopeTotal: number;
	vaultTotal: number;
	percentOfVault: number;
	denominatorDays: number | null;
	coverage: { firstDate: string; lastDate: string } | null;
	chartItems: DistributionItem[];
	detailItems: DistributionItem[];
	warnings: DataWarning[];
}

/** Input summaries for a query: one per contributing date/device. */
export interface QuerySummaryInput {
	summary: DailySummary;
}

/**
 * Run a distribution query. `resolved` is the date range; `summaries` are the
 * per-date/device summaries for the contributing dates; `maxChartItems` caps
 * the number of independent chart slices (the rest fold into "other").
 */
export function runDistributionQuery(args: {
	query: DistributionQuery;
	resolved: ResolvedRange;
	summaries: readonly QuerySummaryInput[];
	registryEntries: Record<string, FileRegistryEntry>;
	maxChartItems: number;
	warnings?: readonly DataWarning[];
}): DistributionResult {
	const { query, resolved, summaries, registryEntries, maxChartItems } = args;

	// 1. Vault-wide aggregation across all contributing summaries, for the vault
	//    total. The vault total is independent of the selected path.
	const vaultMetricsByFileId = mergeSummaries(summaries);
	const vaultProjection = projectAndGroup({
		metricsByFileId: vaultMetricsByFileId,
		registryEntries,
		path: '',
		metric: query.metric,
	});
	const vaultTotal = totalAll(vaultProjection);

	// 2. Scope aggregation at the selected path (children or local-files view).
	const scopeMetricsByFileId = vaultMetricsByFileId; // same file pool; grouping filters by path
	const scopeProjection = projectAndGroup({
		metricsByFileId: scopeMetricsByFileId,
		registryEntries,
		path: query.path,
		metric: query.metric,
	});
	// The scope total includes every file under the path, including deleted
	// history, so a local 100% cannot be confused with the vault share.
	const visibleGroups = scopeProjection.groups.filter((g) =>
		query.view === 'local-files' ? g.kind === 'local-files' : true,
	);
	const scopeTotal =
		visibleGroups.reduce((sum, g) => sum + g.total, 0) +
		(query.view === 'children' ? scopeProjection.deleted.reduce((s, d) => s + d.value, 0) : 0);

	// 3. Build detail + chart items.
	const warnings: DataWarning[] = [...(args.warnings ?? [])];
	for (const s of summaries) {
		warnings.push(...s.summary.warnings);
	}
	const detailItems = buildDetailItems(
		scopeProjection,
		query,
		scopeTotal,
		warnings,
	);
	const chartItems = buildChartItems(detailItems, maxChartItems, scopeTotal);

	const percentOfVault = vaultTotal > 0 ? scopeTotal / vaultTotal : 0;

	return {
		query,
		scopeTotal,
		vaultTotal,
		percentOfVault,
		denominatorDays: resolved.denominatorDays,
		coverage: resolved.coverage,
		chartItems,
		detailItems,
		warnings,
	};
}

/** Merge per-file metrics across summaries (sums intact device shards). */
function mergeSummaries(
	summaries: readonly QuerySummaryInput[],
): Record<string, { activeMs: number; editingMs: number; openCount: number }> {
	const out: Record<string, { activeMs: number; editingMs: number; openCount: number }> = {};
	for (const { summary } of summaries) {
		for (const [fileId, metrics] of Object.entries(summary.metricsByFileId)) {
			const bucket = (out[fileId] ??= { activeMs: 0, editingMs: 0, openCount: 0 });
			bucket.activeMs += metrics.activeMs;
			bucket.editingMs += metrics.editingMs;
			bucket.openCount += metrics.openCount;
		}
	}
	return out;
}

function totalAll(projection: { groups: { total: number }[]; deleted: { value: number }[] }): number {
	let total = 0;
	for (const g of projection.groups) {
		total += g.total;
	}
	for (const d of projection.deleted) {
		total += d.value;
	}
	return total;
}

function buildDetailItems(
	projection: { groups: import('./path-projection').PathGroup[]; deleted: ProjectedFile[] },
	query: DistributionQuery,
	scopeTotal: number,
	_warnings: DataWarning[],
): DistributionItem[] {
	const items: DistributionItem[] = [];
	const view = query.view;
	if (query.groupBy === 'file') {
		for (const group of projection.groups) appendFileItems(items, group.files, scopeTotal);
	} else {
		for (const group of projection.groups) {
			// In local-files view, only the local-files group is exposed.
			if (view === 'local-files' && group.kind !== 'local-files') {
				continue;
			}
			if (group.kind === 'directory') {
				const dirPath = group.directoryPath ?? '';
				const label = group.segment ?? dirPath;
				items.push({
					id: `dir:${dirPath}`,
					kind: 'directory',
					label,
					path: dirPath,
					value: group.total,
					percentOfScope: scopeTotal > 0 ? group.total / scopeTotal : 0,
					memberIds: group.files.map((f) => f.fileId),
				});
			} else {
				// local-files group: expose each file directly.
				appendFileItems(items, group.files, scopeTotal);
			}
		}
	}
	// Deleted group (only if it has value under this scope, and only in the
	// children view — local-files view returns direct files only).
	if (view === 'children' && projection.deleted.length > 0) {
		const deletedTotal = projection.deleted.reduce((sum, f) => sum + f.value, 0);
		items.push({
			id: 'group:deleted',
			kind: 'deleted',
			label: 'Deleted',
			path: null,
			value: deletedTotal,
			percentOfScope: scopeTotal > 0 ? deletedTotal / scopeTotal : 0,
			memberIds: projection.deleted.map((f) => f.fileId),
		});
	}
	// Sort by descending value, then stable by label/id. Details retain all.
	items.sort((a, b) => {
		if (b.value !== a.value) {
			return b.value - a.value;
		}
		return a.label.localeCompare(b.label);
	});
	return items;
}

function appendFileItems(items: DistributionItem[], files: readonly ProjectedFile[], scopeTotal: number): void {
	for (const file of files) {
		const path = file.path;
		items.push({
			id: `file:${file.fileId}`,
			kind: 'file',
			// Breadcrumbs already provide the directory context. Keep the full
			// path separately so shortening the visible label cannot change
			// identity, navigation, or the file opened on activation.
			label: path ? fileBasename(path) : file.fileId,
			path,
			value: file.value,
			percentOfScope: scopeTotal > 0 ? file.value / scopeTotal : 0,
			memberIds: [file.fileId],
		});
	}
}

function fileBasename(path: string): string {
	const normalized = path.replace(/\\/g, '/').replace(/\/+$/g, '');
	const separator = normalized.lastIndexOf('/');
	return normalized.slice(separator + 1) || normalized;
}

/**
 * Build the chart items: the top `maxChartItems` by value, plus a derived
 * "other" item for the remainder. "other" never becomes a real path.
 */
function buildChartItems(
	detailItems: DistributionItem[],
	maxChartItems: number,
	scopeTotal: number,
): DistributionItem[] {
	// Exclude zero-value items from the chart; they carry no slice.
	const nonzero = detailItems.filter((i) => i.value > 0);
	if (nonzero.length <= maxChartItems) {
		return nonzero.map((i) => ({ ...i }));
	}
	const top = nonzero.slice(0, maxChartItems).map((i) => ({ ...i }));
	const rest = nonzero.slice(maxChartItems);
	const otherTotal = rest.reduce((sum, i) => sum + i.value, 0);
	const other: DistributionItem = {
		id: 'group:other',
		kind: 'other',
		label: 'Other',
		path: null,
		value: otherTotal,
		percentOfScope: scopeTotal > 0 ? otherTotal / scopeTotal : 0,
		memberIds: rest.flatMap((i) => i.memberIds),
	};
	return [...top, other];
}
