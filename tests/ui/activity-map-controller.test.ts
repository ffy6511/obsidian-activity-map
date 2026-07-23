import { describe, expect, expectReject, it } from '../helpers/test-harness';

import { ActivityMapController, type QueryService, type TrackingControl } from '../../src/ui/activity-map-controller';
import { normalizeSettings } from '../../src/domain/settings';
import type { TrackingSnapshot } from '../../src/domain/activity';
import { localDateFor } from '../../src/platform/clock';
import type { DistributionQuery, DistributionResult } from '../../src/query/distribution-query';

function result(query: DistributionQuery, value: number): DistributionResult {
	return {
		query,
		maxChartItems: 8,
		scopeTotal: value,
		vaultTotal: value,
		percentOfVault: value > 0 ? 1 : 0,
		denominatorDays: null,
		coverage: null,
		chartItems: value > 0 ? [{ id: 'x', kind: 'file', label: 'x.md', path: 'x.md', value, percentOfScope: 1, memberIds: ['x'] }] : [],
		detailItems: value > 0 ? [{ id: 'x', kind: 'file', label: 'x.md', path: 'x.md', value, percentOfScope: 1, memberIds: ['x'] }] : [],
		warnings: [],
	};
}

function tracking(): TrackingControl & { updates: number; pauses: number; resumes: number; undos: number } {
	return {
		updates: 0,
		pauses: 0,
		resumes: 0,
		undos: 0,
		pause() { this.pauses += 1; },
		resume() { this.resumes += 1; },
		updateSettings() { this.updates += 1; },
		async resolveRecovery() { return null; },
		undoAutomaticExclusion() { this.undos += 1; return true; },
	};
}

function activeSnapshot(sampledAt: string): TrackingSnapshot {
	return {
		state: 'active',
		reason: 'active',
		currentTarget: { fileId: 'file-1', path: 'notes/today.md', windowId: 'window-1', leafId: 'leaf-1' },
		sessionStartedAt: sampledAt,
		lastTrustedActivityAt: sampledAt,
		pendingRecovery: [],
		recentDecisions: [],
		degradedReason: null,
		sampledAt,
	};
}

describe('activity map controller', () => {
	it('provides and executes a dedicated today vault-root query for the header chart', async () => {
		const settings = normalizeSettings({ deviceId: 'd1' });
		let requested: DistributionQuery | null = null;
		const controller = new ActivityMapController(settings, { run: async (query) => { requested = query; return result(query, 0); } }, { update: async () => settings }, tracking(), '2026-07-21');
		expect(controller.getHeaderDefaultQuery()).toEqual({
			metric: 'activeMs',
			range: { mode: 'day', localDate: '2026-07-21' },
			path: '',
			view: 'children',
			groupBy: 'path',
		});
		await controller.getHeaderDistribution();
		expect(requested).toEqual(controller.getHeaderDefaultQuery());
	});

	it('refreshes the default day query after local midnight so live activity stays visible', async () => {
		const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
		const beforeMidnight = Date.UTC(2026, 6, 21, 12, 0, 0);
		const afterMidnight = beforeMidnight + 24 * 60 * 60 * 1_000;
		const previousToday = localDateFor(beforeMidnight, timeZone);
		const nextToday = localDateFor(afterMidnight, timeZone);
		expect(nextToday).not.toEqual(previousToday);

		const requested: DistributionQuery[] = [];
		const settings = normalizeSettings({ deviceId: 'd1' });
		const controller = new ActivityMapController(
			settings,
			{ run: async (query) => { requested.push(query); return result(query, 0); } },
			{ update: async () => settings },
			tracking(),
			previousToday,
		);
		await controller.dispatch({ kind: 'refresh' });

		controller.onSnapshot(activeSnapshot(new Date(afterMidnight).toISOString()));

		expect(controller.getViewModel().query.range).toEqual({ mode: 'day', localDate: nextToday });
		expect(requested.at(-1)?.range).toEqual({ mode: 'day', localDate: nextToday });
		expect(controller.getHeaderDefaultQuery().range).toEqual({ mode: 'day', localDate: nextToday });
	});

	it('keeps a user-selected historical day fixed when tracking crosses local midnight', async () => {
		const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
		const afterMidnight = Date.UTC(2026, 6, 22, 12, 0, 0);
		const settings = normalizeSettings({ deviceId: 'd1' });
		const controller = new ActivityMapController(
			settings,
			{ run: async (query) => result(query, 0) },
			{ update: async () => settings },
			tracking(),
			localDateFor(afterMidnight - 24 * 60 * 60 * 1_000, timeZone),
		);
		await controller.dispatch({ kind: 'set-range', range: { mode: 'day', localDate: '2026-01-15' } });

		controller.onSnapshot(activeSnapshot(new Date(afterMidnight).toISOString()));

		expect(controller.getViewModel().query.range).toEqual({ mode: 'day', localDate: '2026-01-15' });
	});

	it('switches grouping without changing scope controls and normalizes the view', async () => {
		const settings = normalizeSettings({ deviceId: 'd1' });
		let persisted = settings;
		const controller = new ActivityMapController(
			settings,
			{ run: async (query) => result(query, 0) },
			{ update: async (patch) => { persisted = normalizeSettings({ ...persisted, ...patch }); return persisted; } },
			tracking(),
			'2026-07-21',
		);
		await controller.dispatch({
			kind: 'set-query',
			query: {
				metric: 'editingMs',
				range: { mode: 'all' },
				path: 'projects',
				view: 'local-files',
				groupBy: 'path',
			},
		});
		await controller.dispatch({ kind: 'set-grouping', groupBy: 'file' });
		expect(controller.getViewModel().query).toEqual({
			metric: 'editingMs',
			range: { mode: 'all' },
			path: 'projects',
			view: 'children',
			groupBy: 'file',
		});
		expect(persisted.headerPopoverGrouping).toBe('file');
		expect(controller.getHeaderDefaultQuery().groupBy).toBe('file');
		const reopened = new ActivityMapController(persisted, { run: async (query) => result(query, 0) }, { update: async () => persisted }, tracking(), '2026-07-21');
		expect(reopened.getHeaderDefaultQuery().groupBy).toBe('file');
	});

	it('switches to Typed chars without changing the active range, path, or grouping', async () => {
		const settings = normalizeSettings({ deviceId: 'd1' });
		const requested: DistributionQuery[] = [];
		const controller = new ActivityMapController(
			settings,
			{ run: async (query) => { requested.push(query); return result(query, 8); } },
			{ update: async () => settings },
			tracking(),
			'2026-07-21',
		);
		await controller.dispatch({
			kind: 'set-query',
			query: {
				metric: 'activeMs',
				range: { mode: 'average', days: 30, today: '2026-07-21' },
				path: 'projects',
				view: 'children',
				groupBy: 'file',
			},
		});
		await controller.dispatch({ kind: 'set-metric', metric: 'typedChars' });
		expect(controller.getViewModel().query).toEqual({
			metric: 'typedChars',
			range: { mode: 'average', days: 30, today: '2026-07-21' },
			path: 'projects',
			view: 'children',
			groupBy: 'file',
		});
		expect(requested.at(-1)).toEqual(controller.getViewModel().query);
		expect(controller.getViewModel().distribution?.detailItems[0]?.id).toBe('x');
	});

	it('rolls back an optimistic grouping when preference persistence fails', async () => {
		const settings = normalizeSettings({ deviceId: 'd1' });
		const controller = new ActivityMapController(
			settings,
			{ run: async (query) => result(query, 0) },
			{ update: async () => { throw new Error('save-failed'); } },
			tracking(),
			'2026-07-21',
		);
		await controller.dispatch({ kind: 'set-grouping', groupBy: 'file' });
		expect(controller.getViewModel().query.groupBy).toBe('path');
		expect(controller.getViewModel().settings.headerPopoverGrouping).toBe('path');
		expect(controller.getViewModel().loadState).toBe('error');
		expect(controller.getViewModel().error).toBe('save-failed');
	});

	it('ignores a stale slow query after a newer navigation resolves', async () => {
		const pending: Array<{ query: DistributionQuery; resolve: (value: DistributionResult) => void }> = [];
		const service: QueryService = {
			run(query) {
				return new Promise((resolve) => pending.push({ query, resolve }));
			},
		};
		const settings = normalizeSettings({ deviceId: 'd1' });
		const controller = new ActivityMapController(settings, service, { update: async () => settings }, tracking(), '2026-07-21');
		const first = controller.dispatch({ kind: 'refresh' });
		const second = controller.dispatch({ kind: 'set-path', path: 'projects' });
		pending[1]?.resolve(result(pending[1].query, 20));
		await second;
		pending[0]?.resolve(result(pending[0].query, 10));
		await first;
		expect(controller.getViewModel().query.path).toBe('projects');
		expect(controller.getViewModel().distribution?.scopeTotal).toBe(20);
	});

	it('applies settings to tracking only after persistence succeeds', async () => {
		const settings = normalizeSettings({ deviceId: 'd1' });
		const runtime = tracking();
		const controller = new ActivityMapController(
			settings,
			{ run: async (query) => result(query, 0) },
			{ update: async () => { throw new Error('save-failed'); } },
			runtime,
			'2026-07-21',
		);
		await expectReject(controller.dispatch({ kind: 'update-settings', patch: { idleThresholdMs: 60_000 } })).toThrow('save-failed');
		expect(runtime.updates).toBe(0);
		expect(controller.getViewModel().settings.idleThresholdMs).toBe(180_000);
	});

	it('routes pause and resume through one tracking control', async () => {
		const settings = normalizeSettings({ deviceId: 'd1' });
		const runtime = tracking();
		const controller = new ActivityMapController(settings, { run: async (query) => result(query, 0) }, { update: async () => settings }, runtime, '2026-07-21');
		await controller.dispatch({ kind: 'pause' });
		await controller.dispatch({ kind: 'resume' });
		expect(runtime.pauses).toBe(1);
		expect(runtime.resumes).toBe(1);
	});

	it('queries a file-specific status summary and routes automatic-exclusion undo', async () => {
		const settings = normalizeSettings({ deviceId: 'd1' });
		const runtime = tracking();
		let requestedPath = '';
		const controller = new ActivityMapController(settings, {
			run: async (query) => result(query, 0),
			getStatusSummary: async (path) => { requestedPath = path; return { fileActiveMs: 10, vaultActiveMs: 20 }; },
		}, { update: async () => settings }, runtime, '2026-07-21');
		const summary = await controller.getStatusSummary('notes/a.md');
		await controller.dispatch({ kind: 'undo-automatic-exclusion', candidateId: 'candidate-1' });
		expect(requestedPath).toBe('notes/a.md');
		expect(summary).toEqual({ fileActiveMs: 10, vaultActiveMs: 20 });
		expect(runtime.undos).toBe(1);
	});
});
