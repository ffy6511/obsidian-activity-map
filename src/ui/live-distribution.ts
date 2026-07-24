import type { TrackingSnapshot } from '../domain/activity';
import { localDateFor } from '../platform/clock';
import {
	buildChartItems,
	compareDistributionItems,
	type DistributionItem,
	type DistributionResult,
} from '../query/distribution-query';
import { liveTodayMs } from './live-today';

export interface LiveDistributionOptions {
	nowMs?: number;
	idleThresholdMs?: number;
	timeZone?: string;
}

/**
 * Adds the current unclosed active interval to a query result without mutating
 * persisted evidence. Only today's active-time query is eligible. Vault total
 * always follows the active file; scope items change only when that file is
 * visible under the selected path and view.
 */
export function withLiveActivity(
	distribution: DistributionResult,
	snapshot: TrackingSnapshot | null,
	options: LiveDistributionOptions = {},
): DistributionResult {
	const target = snapshot?.currentTarget;
	const range = distribution.query.range;
	if (!target || distribution.query.metric !== 'activeMs' || range.mode !== 'day')
		return distribution;

	const sampledAt = Date.parse(snapshot?.sampledAt ?? '');
	const nowMs = Number.isFinite(options.nowMs) ? (options.nowMs as number) : sampledAt;
	const timeZone = options.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
	if (!Number.isFinite(nowMs) || localDateFor(nowMs, timeZone) !== range.localDate)
		return distribution;

	const liveMs = liveTodayMs(snapshot, {
		nowMs,
		idleThresholdMs: options.idleThresholdMs,
		timeZone,
	});
	if (liveMs <= 0) return distribution;

	const owner = scopeOwner(distribution, target.fileId, target.path);
	const detailItems = cloneItems(distribution.detailItems);
	const scopeIncrement = owner ? liveMs : 0;
	if (owner) {
		addToOwner(detailItems, owner, target.fileId, liveMs);
	}
	const scopeTotal = distribution.scopeTotal + scopeIncrement;
	const vaultTotal = distribution.vaultTotal + liveMs;
	detailItems.sort(compareDistributionItems);
	refreshPercents(detailItems, scopeTotal);
	// Rebuild from complete details so a live-only file cannot bypass the same
	// top-N/Other partition applied by the persisted query.
	const chartItems = buildChartItems(detailItems, distribution.maxChartItems, scopeTotal);
	return {
		...distribution,
		scopeTotal,
		vaultTotal,
		percentOfVault: vaultTotal > 0 ? scopeTotal / vaultTotal : 0,
		detailItems,
		chartItems,
	};
}

function cloneItems(items: readonly DistributionItem[]): DistributionItem[] {
	return items.map((item) => ({ ...item, memberIds: [...item.memberIds] }));
}

function scopeOwner(
	distribution: DistributionResult,
	fileId: string,
	filePath: string,
): Pick<DistributionItem, 'id' | 'kind' | 'label' | 'path'> | null {
	const scopePath = distribution.query.path.split('/').filter(Boolean).join('/');
	const prefix = scopePath ? `${scopePath}/` : '';
	if (!filePath.startsWith(prefix)) return null;
	const relative = filePath.slice(prefix.length);
	const segments = relative.split('/').filter(Boolean);
	if (segments.length === 0) return null;
	if (distribution.query.groupBy === 'file') {
		return {
			id: `file:${fileId}`,
			kind: 'file',
			label: segments[segments.length - 1] as string,
			path: filePath,
		};
	}
	if (distribution.query.view === 'local-files' && segments.length !== 1) return null;
	if (segments.length === 1) {
		return { id: `file:${fileId}`, kind: 'file', label: relative, path: filePath };
	}
	const directoryPath = scopePath ? `${scopePath}/${segments[0]}` : (segments[0] as string);
	return {
		id: `dir:${directoryPath}`,
		kind: 'directory',
		label: segments[0] as string,
		path: directoryPath,
	};
}

function addToOwner(
	items: DistributionItem[],
	owner: Pick<DistributionItem, 'id' | 'kind' | 'label' | 'path'>,
	fileId: string,
	value: number,
): void {
	const existing = items.find((item) => item.memberIds.includes(fileId) || item.id === owner.id);
	if (existing) {
		existing.value += value;
		if (!existing.memberIds.includes(fileId)) existing.memberIds.push(fileId);
		return;
	}
	items.push({ ...owner, value, percentOfScope: 0, memberIds: [fileId] });
}

function refreshPercents(items: DistributionItem[], scopeTotal: number): void {
	for (const item of items) item.percentOfScope = scopeTotal > 0 ? item.value / scopeTotal : 0;
}
