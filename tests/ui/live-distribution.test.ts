import { describe, expect, it } from '../helpers/test-harness';

import type { TrackingSnapshot } from '../../src/domain/activity';
import type { DistributionResult } from '../../src/query/distribution-query';
import { withLiveActivity } from '../../src/ui/live-distribution';

function distribution(path = '', view: 'children' | 'local-files' = 'children'): DistributionResult {
	return {
		query: { metric: 'activeMs', range: { mode: 'day', localDate: '2026-07-21' }, path, view },
		scopeTotal: 10_000,
		vaultTotal: 20_000,
		percentOfVault: 0.5,
		denominatorDays: null,
		coverage: null,
		chartItems: [{ id: 'dir:projects', kind: 'directory', label: 'projects', path: 'projects', value: 10_000, percentOfScope: 1, memberIds: ['existing'] }],
		detailItems: [{ id: 'dir:projects', kind: 'directory', label: 'projects', path: 'projects', value: 10_000, percentOfScope: 1, memberIds: ['existing'] }],
		warnings: [],
	};
}

function snapshot(path = 'projects/live.md'): TrackingSnapshot {
	return {
		state: 'active',
		reason: 'active',
		currentTarget: { fileId: 'live', path, windowId: 'w', leafId: 'l' },
		sessionStartedAt: '2026-07-21T10:00:00.000Z',
		lastTrustedActivityAt: '2026-07-21T10:00:10.000Z',
		pendingRecovery: [],
		recentDecisions: [],
		degradedReason: null,
		sampledAt: '2026-07-21T10:00:10.000Z',
	};
}

describe('live distribution projection', () => {
	it('advances an active root slice between persisted query refreshes', () => {
		const base = distribution();
		const first = withLiveActivity(base, snapshot(), { nowMs: Date.parse('2026-07-21T10:00:11.000Z'), idleThresholdMs: 180_000, timeZone: 'UTC' });
		const second = withLiveActivity(base, snapshot(), { nowMs: Date.parse('2026-07-21T10:00:12.000Z'), idleThresholdMs: 180_000, timeZone: 'UTC' });
		expect(second.scopeTotal - first.scopeTotal).toBe(1_000);
		expect((second.detailItems[0]?.value ?? 0) - (first.detailItems[0]?.value ?? 0)).toBe(1_000);
		expect(base.scopeTotal).toBe(10_000);
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
		const direct = withLiveActivity(distribution('projects', 'local-files'), snapshot('projects/live.md'), {
			nowMs: Date.parse('2026-07-21T10:00:20.000Z'), idleThresholdMs: 180_000, timeZone: 'UTC',
		});
		const nested = withLiveActivity(distribution('projects', 'local-files'), snapshot('projects/nested/live.md'), {
			nowMs: Date.parse('2026-07-21T10:00:20.000Z'), idleThresholdMs: 180_000, timeZone: 'UTC',
		});
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
		expect(withLiveActivity(historical, snapshot(), { nowMs: Date.parse('2026-07-21T10:00:20.000Z'), timeZone: 'UTC' })).toBe(historical);
		expect(withLiveActivity(count, snapshot(), { nowMs: Date.parse('2026-07-21T10:00:20.000Z'), timeZone: 'UTC' })).toBe(count);
	});
});
