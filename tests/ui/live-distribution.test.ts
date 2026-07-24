import { describe, expect, it } from '../helpers/test-harness';

import type { TrackingSnapshot } from '../../src/domain/activity';
import {
	buildChartItems,
	type DistributionItem,
	type DistributionResult,
} from '../../src/query/distribution-query';
import { withLiveActivity } from '../../src/ui/live-distribution';

function distribution(
	path = '',
	view: 'children' | 'local-files' = 'children',
	groupBy: 'path' | 'file' = 'path',
): DistributionResult {
	return {
		query: {
			metric: 'activeMs',
			range: { mode: 'day', localDate: '2026-07-21' },
			path,
			view,
			groupBy,
		},
		maxChartItems: 8,
		scopeTotal: 10_000,
		vaultTotal: 20_000,
		percentOfVault: 0.5,
		denominatorDays: null,
		coverage: null,
		chartItems: [
			{
				id: 'dir:projects',
				kind: 'directory',
				label: 'projects',
				path: 'projects',
				value: 10_000,
				percentOfScope: 1,
				memberIds: ['existing'],
			},
		],
		detailItems: [
			{
				id: 'dir:projects',
				kind: 'directory',
				label: 'projects',
				path: 'projects',
				value: 10_000,
				percentOfScope: 1,
				memberIds: ['existing'],
			},
		],
		warnings: [],
	};
}

function snapshot(path = 'projects/live.md', fileId = 'live'): TrackingSnapshot {
	return {
		state: 'active',
		reason: 'active',
		currentTarget: { fileId, path, windowId: 'w', leafId: 'l' },
		sessionStartedAt: '2026-07-21T10:00:00.000Z',
		lastTrustedActivityAt: '2026-07-21T10:00:10.000Z',
		pendingRecovery: [],
		recentDecisions: [],
		degradedReason: null,
		sampledAt: '2026-07-21T10:00:10.000Z',
	};
}

function populatedFileDistribution(count: number): DistributionResult {
	const detailItems: DistributionItem[] = Array.from({ length: count }, (_, index) => ({
		id: `file:file-${String(index)}`,
		kind: 'file',
		label: `file-${String(index)}.md`,
		path: `projects/file-${String(index)}.md`,
		value: (count - index) * 10_000,
		percentOfScope: 0,
		memberIds: [`file-${String(index)}`],
	}));
	const scopeTotal = detailItems.reduce((sum, item) => sum + item.value, 0);
	for (const item of detailItems) item.percentOfScope = item.value / scopeTotal;
	const base = distribution('projects', 'children', 'file');
	return {
		...base,
		scopeTotal,
		vaultTotal: scopeTotal,
		percentOfVault: 1,
		detailItems,
		chartItems: buildChartItems(detailItems, base.maxChartItems, scopeTotal),
	};
}

describe('live distribution projection', () => {
	it('advances an active root slice between persisted query refreshes', () => {
		const base = distribution();
		const first = withLiveActivity(base, snapshot(), {
			nowMs: Date.parse('2026-07-21T10:00:11.000Z'),
			idleThresholdMs: 180_000,
			timeZone: 'UTC',
		});
		const second = withLiveActivity(base, snapshot(), {
			nowMs: Date.parse('2026-07-21T10:00:12.000Z'),
			idleThresholdMs: 180_000,
			timeZone: 'UTC',
		});
		expect(second.scopeTotal - first.scopeTotal).toBe(1_000);
		expect((second.detailItems[0]?.value ?? 0) - (first.detailItems[0]?.value ?? 0)).toBe(
			1_000,
		);
		expect(base.scopeTotal).toBe(10_000);
	});

	it('creates a concrete descendant file item in file grouping', () => {
		const base = distribution('projects', 'children', 'file');
		base.scopeTotal = 0;
		base.vaultTotal = 0;
		base.percentOfVault = 0;
		base.chartItems = [];
		base.detailItems = [];
		const projected = withLiveActivity(base, snapshot('projects/nested/live.md'), {
			nowMs: Date.parse('2026-07-21T10:00:20.000Z'),
			idleThresholdMs: 180_000,
			timeZone: 'UTC',
		});
		expect(projected.detailItems).toEqual([
			{
				id: 'file:live',
				kind: 'file',
				label: 'live.md',
				path: 'projects/nested/live.md',
				value: 20_000,
				percentOfScope: 1,
				memberIds: ['live'],
			},
		]);
	});

	it('keeps a live-only file inside the configured top-N/Other chart bound', () => {
		for (const persistedCount of [8, 9]) {
			const projected = withLiveActivity(
				populatedFileDistribution(persistedCount),
				snapshot(),
				{
					nowMs: Date.parse('2026-07-21T10:00:20.000Z'),
					idleThresholdMs: 180_000,
					timeZone: 'UTC',
				},
			);
			expect(projected.detailItems).toHaveLength(persistedCount + 1);
			expect(projected.chartItems).toHaveLength(9);
			expect(projected.chartItems.filter((item) => item.kind === 'other')).toHaveLength(1);
			expect(projected.chartItems.reduce((sum, item) => sum + item.value, 0)).toBe(
				projected.scopeTotal,
			);
		}
	});

	it('repartitions a live file that was already folded into Other', () => {
		const base = populatedFileDistribution(9);
		expect(base.chartItems.find((item) => item.kind === 'other')?.memberIds).toContain(
			'file-8',
		);
		const projected = withLiveActivity(base, snapshot('projects/file-8.md', 'file-8'), {
			nowMs: Date.parse('2026-07-21T10:00:20.000Z'),
			idleThresholdMs: 180_000,
			timeZone: 'UTC',
		});
		expect(projected.chartItems).toHaveLength(9);
		expect(projected.chartItems.reduce((sum, item) => sum + item.value, 0)).toBe(
			projected.scopeTotal,
		);
		expect(projected.detailItems.find((item) => item.id === 'file:file-8')?.value).toBe(30_000);
	});

	it('uses the persisted path and ID tie-break after a live projection', () => {
		const equalItems: DistributionItem[] = [
			{
				id: 'file:b',
				kind: 'file',
				label: 'same.md',
				path: 'projects/v/same.md',
				value: 10_000,
				percentOfScope: 0.5,
				memberIds: ['b'],
			},
			{
				id: 'file:c',
				kind: 'file',
				label: 'same.md',
				path: 'projects/u/same.md',
				value: 10_000,
				percentOfScope: 0.5,
				memberIds: ['c'],
			},
			{
				id: 'file:a',
				kind: 'file',
				label: 'same.md',
				path: 'projects/u/same.md',
				value: 10_000,
				percentOfScope: 0.5,
				memberIds: ['a'],
			},
		];
		const base = {
			...distribution('projects', 'children', 'file'),
			scopeTotal: 30_000,
			vaultTotal: 30_000,
			detailItems: equalItems,
			chartItems: equalItems,
		};
		const projected = withLiveActivity(base, snapshot('outside/live.md'), {
			nowMs: Date.parse('2026-07-21T10:00:20.000Z'),
			idleThresholdMs: 180_000,
			timeZone: 'UTC',
		});
		expect(projected.detailItems.map((item) => item.id)).toEqual([
			'file:a',
			'file:c',
			'file:b',
		]);
	});

	it('clips UI-side growth at the trusted idle boundary', () => {
		const projected = withLiveActivity(distribution(), snapshot(), {
			nowMs: Date.parse('2026-07-21T10:10:00.000Z'),
			idleThresholdMs: 30_000,
			timeZone: 'UTC',
		});
		expect(projected.scopeTotal).toBe(50_000);
		expect(projected.vaultTotal).toBe(60_000);
	});

	it('updates vault total without changing a scope that does not contain the active file', () => {
		const base = distribution('archive');
		const projected = withLiveActivity(base, snapshot(), {
			nowMs: Date.parse('2026-07-21T10:00:20.000Z'),
			idleThresholdMs: 180_000,
			timeZone: 'UTC',
		});
		expect(projected.scopeTotal).toBe(base.scopeTotal);
		expect(projected.vaultTotal).toBe(40_000);
	});

	it('includes only direct files in the local-files view', () => {
		const direct = withLiveActivity(
			distribution('projects', 'local-files'),
			snapshot('projects/live.md'),
			{
				nowMs: Date.parse('2026-07-21T10:00:20.000Z'),
				idleThresholdMs: 180_000,
				timeZone: 'UTC',
			},
		);
		const nested = withLiveActivity(
			distribution('projects', 'local-files'),
			snapshot('projects/nested/live.md'),
			{
				nowMs: Date.parse('2026-07-21T10:00:20.000Z'),
				idleThresholdMs: 180_000,
				timeZone: 'UTC',
			},
		);
		expect(direct.scopeTotal).toBe(30_000);
		expect(nested.scopeTotal).toBe(10_000);
	});

	it('creates a visible child item when only the unclosed session has activity', () => {
		const base = distribution('papers');
		base.scopeTotal = 0;
		base.vaultTotal = 0;
		base.percentOfVault = 0;
		base.chartItems = [];
		base.detailItems = [];
		const projected = withLiveActivity(base, snapshot('papers/live.md'), {
			nowMs: Date.parse('2026-07-21T10:00:20.000Z'),
			idleThresholdMs: 180_000,
			timeZone: 'UTC',
		});
		expect(projected.scopeTotal).toBe(20_000);
		expect(projected.detailItems.map((item) => item.id)).toEqual(['file:live']);
		expect(projected.chartItems.map((item) => item.id)).toEqual(['file:live']);
		expect(base.detailItems).toEqual([]);
	});

	it('leaves historical days and non-time metrics unchanged', () => {
		const historical = distribution();
		historical.query.range = { mode: 'day', localDate: '2026-07-20' };
		const count = distribution();
		count.query.metric = 'openCount';
		expect(
			withLiveActivity(historical, snapshot(), {
				nowMs: Date.parse('2026-07-21T10:00:20.000Z'),
				timeZone: 'UTC',
			}),
		).toBe(historical);
		expect(
			withLiveActivity(count, snapshot(), {
				nowMs: Date.parse('2026-07-21T10:00:20.000Z'),
				timeZone: 'UTC',
			}),
		).toBe(count);
	});
});
