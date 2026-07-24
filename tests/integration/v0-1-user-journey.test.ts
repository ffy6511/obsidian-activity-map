import { describe, expect, it } from '../helpers/test-harness';

import { normalizeSettings } from '../../src/domain/settings';
import { createFakeClock } from '../helpers/fake-clock';
import { FakeDataAdapter } from '../helpers/fake-data-adapter';
import { SafeJsonStore } from '../../src/data/safe-json-store';
import { FileRegistry } from '../../src/data/file-registry';
import { filesRegistryPath, sessionShardPath, dailySummaryPath } from '../../src/data/paths';
import { DataServices } from '../../src/data/data-services';
import { DailySummaryRepository } from '../../src/data/daily-summary-repository';
import {
	TrackingCoordinator,
	type ActivityEventSource,
	type WorkspaceSource,
} from '../../src/tracking/tracking-coordinator';
import { InMemoryCheckpointPort } from '../../src/tracking/ports';
import type { ResolvedLeaf } from '../../src/tracking/target-resolver';
import type { TrackingSnapshot } from '../../src/domain/activity';
import type { ShardInventory } from '../../src/data/retention-service';
import { LocalQueryService } from '../../src/query/query-service';
import { RawExportService } from '../../src/data/raw-export-service';
import { RebuildService } from '../../src/data/rebuild-service';
import { DeletionService } from '../../src/data/deletion-service';
import { renderPoster } from '../../src/export/poster-exporter';
import type { RangeMode } from '../../src/query/date-range';

function flush(): Promise<void> {
	return new Promise((resolve) => setTimeout(() => setTimeout(() => setTimeout(resolve, 0)), 0));
}

describe('v0.1 integrated local journey', () => {
	it('flows from trusted activity and recovery through every query range, export, rebuild, and deletion', async () => {
		const adapter = new FakeDataAdapter();
		const settings = normalizeSettings({
			deviceId: 'device-1',
			idleThresholdMs: 60_000,
			recoveryLimitMs: 300_000,
		});
		const clock = createFakeClock({
			wallMs: Date.parse('2026-07-21T10:00:00.000Z'),
			timeZone: 'UTC',
		});
		const registry = await FileRegistry.load(
			new SafeJsonStore(adapter, filesRegistryPath(adapter)),
		);
		const inventory: ShardInventory = {
			listSessionShards: async () =>
				(await adapter.exists(sessionShardPath(adapter, 'device-1', '2026-07-21')))
					? [{ deviceId: 'device-1', localDate: '2026-07-21' }]
					: [],
			listDailySummaries: async () =>
				(await adapter.exists(dailySummaryPath(adapter, 'device-1', '2026-07-21')))
					? [{ deviceId: 'device-1', localDate: '2026-07-21' }]
					: [],
		};
		const summariesHolder: { value: DailySummaryRepository | null } = { value: null };
		const data = new DataServices({
			registry,
			fileAdapter: adapter,
			pathAdapter: adapter,
			settings,
			timeZone: 'UTC',
			onShardChanged: async (deviceId, localDate) => {
				const repository = summariesHolder.value;
				if (!repository) return;
				const rebuilt = await repository.rebuild({
					deviceId,
					localDate,
					nowIso: new Date(clock.now().wallMs).toISOString(),
				});
				if (!rebuilt.rawUnavailable)
					await repository.save({ deviceId, localDate, summary: rebuilt.summary });
			},
		});
		const summaries = new DailySummaryRepository({
			shardStore: data.getShardStore(),
			pathAdapter: adapter,
			fileAdapter: adapter,
		});
		summariesHolder.value = summaries;
		const activity: {
			callback: ((event: { isTrusted?: boolean; type?: string }) => void) | null;
		} = { callback: null };
		const activitySource: ActivityEventSource = {
			attachActivityListeners(callback) {
				activity.callback = callback;
				return () => {
					activity.callback = null;
				};
			},
			onBlur: () => () => {},
		};
		const activeLeaf: ResolvedLeaf = {
			leafId: 'leaf-1',
			windowId: 'main',
			file: { path: 'notes/a.md' },
		};
		const workspace: WorkspaceSource = {
			getActiveLeaf: () => activeLeaf,
			onActiveLeafChange: () => () => {},
			onFileOpen: () => () => {},
			onEditorChange: () => () => {},
		};
		const snapshots: TrackingSnapshot[] = [];
		const coordinator = new TrackingCoordinator({
			settings,
			clock,
			sink: data,
			checkpoint: new InMemoryCheckpointPort(),
			identity: data,
			isExcluded: () => false,
			workspace,
			attachWindowEvents: () => activitySource,
			observers: [{ onSnapshot: (snapshot) => snapshots.push(snapshot) }],
		});
		coordinator.start();
		await flush();
		clock.advance(30_000);
		activity.callback?.({ isTrusted: true, type: 'pointerdown' });
		clock.advance(60_000);
		coordinator.onIdleTimer();
		await flush();
		expect(snapshots.at(-1)?.state).toBe('idle');
		expect(snapshots.at(-1)?.pendingRecovery).toHaveLength(0);
		activity.callback?.({ isTrusted: true, type: 'pointerdown' });
		await flush();
		const candidate = snapshots.at(-1)?.pendingRecovery[0];
		expect(candidate).toBeDefined();
		await coordinator.resolveRecovery({
			candidateId: candidate?.candidateId ?? '',
			kind: 'include',
		});
		await flush();

		const query = new LocalQueryService(inventory, summaries, registry, () => settings);
		const ranges: RangeMode[] = [
			{ mode: 'day', localDate: '2026-07-21' } as const,
			{ mode: 'average', days: 7, today: '2026-07-21' } as const,
			{ mode: 'average', days: 30, today: '2026-07-21' } as const,
			{ mode: 'average', days: 90, today: '2026-07-21' } as const,
			{ mode: 'average', days: 'all', today: '2026-07-21' } as const,
			{ mode: 'all' } as const,
		];
		const selectedDay: RangeMode = { mode: 'day', localDate: '2026-07-21' };
		for (const range of ranges) {
			const result = await query.run({
				metric: 'activeMs',
				range,
				path: '',
				view: 'children',
				groupBy: 'path',
			});
			expect(result.scopeTotal).toBe(90_000);
		}
		const root = await query.run({
			metric: 'activeMs',
			range: selectedDay,
			path: '',
			view: 'children',
			groupBy: 'path',
		});
		expect(
			root.detailItems.some((item) => item.kind === 'directory' && item.label === 'notes'),
		).toBeTrue();
		const files = await query.run({
			metric: 'activeMs',
			range: selectedDay,
			path: 'notes',
			view: 'children',
			groupBy: 'path',
		});
		expect(files.detailItems[0]?.path).toBe('notes/a.md');

		const exported = renderPoster({
			layout: 'portrait',
			query: files.query,
			distribution: files,
			wordmarkDataUrl: 'data:image/png;base64,d29yZG1hcms=',
		});
		expect(exported.svg.includes('<title id="activity-map-poster-title">')).toBeTrue();
		expect(exported.svg.includes('1m 30s')).toBeTrue();
		const raw = new RawExportService(inventory, data.getShardStore(), adapter);
		const rawResult = await raw.export({
			scope: { kind: 'all' },
			nowIso: '2026-07-21T11:00:00.000Z',
		});
		expect(rawResult.records.length).toBeGreaterThanOrEqual(2);
		expect(JSON.stringify(rawResult).includes('note content')).toBeFalse();
		const rebuild = await new RebuildService(
			inventory,
			data.getShardStore(),
			summaries,
		).rebuild({ nowIso: '2026-07-21T11:00:00.000Z' });
		expect(rebuild.outcomes[0]?.outcome).toBe('unchanged');
		const deletion = new DeletionService(
			inventory,
			data.getShardStore(),
			summaries,
			adapter,
			adapter,
			registry,
		);
		const deletionPlan = await deletion.planDeletion({
			scope: { kind: 'date', localDate: '2026-07-21' },
			nowIso: '2026-07-21T11:00:00.000Z',
		});
		const deleted = await deletion.executeDeletion({
			plan: deletionPlan,
			nowIso: '2026-07-21T11:00:01.000Z',
		});
		expect(deleted.planId).toBe(deletionPlan.planId);
		expect(deleted.outcome).toBe('completed');
		expect(
			(
				await query.run({
					metric: 'activeMs',
					range: selectedDay,
					path: '',
					view: 'children',
					groupBy: 'path',
				})
			).scopeTotal,
		).toBe(0);
		await coordinator.stop();
	});
});
