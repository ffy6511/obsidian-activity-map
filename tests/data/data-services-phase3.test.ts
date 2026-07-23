import { describe, expect, it } from '../helpers/test-harness';

import { buildSessionEnvelope, buildAdjustmentEnvelope } from '../../src/data/event-envelope';
import { NdjsonShardStore } from '../../src/data/ndjson-shard-store';
import { DailySummaryRepository } from '../../src/data/daily-summary-repository';
import { RetentionService, type ShardInventory } from '../../src/data/retention-service';
import { RebuildService } from '../../src/data/rebuild-service';
import { RawExportService } from '../../src/data/raw-export-service';
import { DeletionService } from '../../src/data/deletion-service';
import { FileRegistry } from '../../src/data/file-registry';
import { SafeJsonStore } from '../../src/data/safe-json-store';
import { dailySummaryPath, sessionShardPath } from '../../src/data/paths';
import { FakeDataAdapter } from '../helpers/fake-data-adapter';
import type { ClosedSessionSegment, RecoveryDecision } from '../../src/domain/activity';
import { LocalQueryService } from '../../src/query/query-service';
import { normalizeSettings } from '../../src/domain/settings';

function segment(fileId: string, path: string, localDate: string, activeMs: number): ClosedSessionSegment {
	return {
		sessionId: `s-${fileId}-${localDate}`,
		target: { fileId, path, windowId: 'main', leafId: 'l1' },
		startedAt: `${localDate}T00:00:00.000Z`,
		endedAt: `${localDate}T00:00:10.000Z`,
		localDate,
		activeMs,
		editingMs: 0,
		openCount: 1,
		closureReason: 'blur',
	};
}

function decision(candidateId: string, decidedAt: string): RecoveryDecision {
	return { candidateId, fileId: 'f1', pathAtEvent: 'a.md', intervalStartedAt: decidedAt, kind: 'include', deltaMs: 5_000, reason: 'user-include', decidedAt, automatic: false };
}

/** Fake inventory that returns whatever (deviceId, localDate) pairs it's given. */
function fakeInventory(
	shards: { deviceId: string; localDate: string }[],
	summaries = shards,
): ShardInventory {
	return {
		async listSessionShards() {
			return shards;
		},
		async listDailySummaries() {
			return summaries;
		},
	};
}

interface Setup {
	adapter: FakeDataAdapter;
	shardStore: NdjsonShardStore;
	summaries: DailySummaryRepository;
	pathAdapter: FakeDataAdapter;
	registry: FileRegistry;
}

function setup(options: ConstructorParameters<typeof FakeDataAdapter>[0] = {}): Setup {
	const adapter = new FakeDataAdapter(options);
	const shardStore = new NdjsonShardStore(adapter);
	const summaries = new DailySummaryRepository({ shardStore, pathAdapter: adapter, fileAdapter: adapter });
	const registryStore = new SafeJsonStore(adapter, '/p/files.json');
	const registry = new FileRegistry(registryStore, null, false);
	return { adapter, shardStore, summaries, pathAdapter: adapter, registry };
}

async function seedShard(
	s: Setup,
	deviceId: string,
	localDate: string,
	segments: ClosedSessionSegment[],
) {
	const envs = segments.map((seg) => buildSessionEnvelope(seg, deviceId));
	const path = sessionShardPath(s.pathAdapter, deviceId, localDate);
	await s.shardStore.append(path, envs);
}

/** Convenience path for the single seed device/date used across tests. */
function dev1Path(s: Setup, localDate = '2026-07-20'): string {
	return sessionShardPath(s.pathAdapter, 'dev1', localDate);
}

describe('rebuild service', () => {
	it('rebuilds a summary from retained raw evidence', async () => {
		const s = setup();
		await seedShard(s, 'dev1', '2026-07-20', [
			segment('f1', 'a.md', '2026-07-20', 10_000),
			segment('f2', 'b.md', '2026-07-20', 5_000),
		]);
		const inventory = fakeInventory([{ deviceId: 'dev1', localDate: '2026-07-20' }]);
		const service = new RebuildService(inventory, s.shardStore, s.summaries);
		const result = await service.rebuild({ nowIso: '2026-07-21T00:00:00.000Z' });
		expect(result.outcomes[0]?.outcome).toBe('rebuilt');
		const loaded = await s.summaries.load({ deviceId: 'dev1', localDate: '2026-07-20' });
		expect(loaded?.metricsByFileId['f1']?.activeMs).toBe(10_000);
		expect(loaded?.metricsByFileId['f2']?.activeMs).toBe(5_000);
	});

	it('reports unchanged when the rebuilt metrics equal the existing summary', async () => {
		const s = setup();
		await seedShard(s, 'dev1', '2026-07-20', [segment('f1', 'a.md', '2026-07-20', 10_000)]);
		const inventory = fakeInventory([{ deviceId: 'dev1', localDate: '2026-07-20' }]);
		const service = new RebuildService(inventory, s.shardStore, s.summaries);
		await service.rebuild({ nowIso: '2026-07-21T00:00:00.000Z' });
		const second = await service.rebuild({ nowIso: '2026-07-21T00:00:00.000Z' });
		expect(second.outcomes[0]?.outcome).toBe('unchanged');
	});

	it('reports unavailable when raw evidence is gone', async () => {
		const s = setup();
		// No shard seeded; inventory claims one but the file is missing.
		const inventory = fakeInventory([{ deviceId: 'dev1', localDate: '2026-07-20' }]);
		const service = new RebuildService(inventory, s.shardStore, s.summaries);
		const result = await service.rebuild({ nowIso: '2026-07-21T00:00:00.000Z' });
		expect(result.outcomes[0]?.outcome).toBe('unavailable');
	});

	it('reports a failed date without overwriting evidence when summary persistence fails', async () => {
		const s = setup({ fail: { write: 1 } });
		const envelope = buildSessionEnvelope(segment('f1', 'a.md', '2026-07-20', 10_000), 'dev1');
		s.adapter.seed(dev1Path(s), `${JSON.stringify(envelope)}\n`);
		const inventory = fakeInventory([{ deviceId: 'dev1', localDate: '2026-07-20' }]);
		const result = await new RebuildService(inventory, s.shardStore, s.summaries).rebuild({
			nowIso: '2026-07-21T00:00:00.000Z',
		});
		expect(result.outcomes[0]?.outcome).toBe('failed');
		expect((await s.shardStore.read(dev1Path(s))).records).toHaveLength(1);
	});

	it('deduplicates legacy adjustment retries by candidate identity during rebuild', async () => {
		const s = setup();
		const first = buildAdjustmentEnvelope(decision('candidate-1', '2026-07-20T00:01:00.000Z'), 'dev1', 'f1', 'a.md', '2026-07-20');
		const duplicate = { ...first, recordId: 'legacy-random-retry-id' };
		await s.shardStore.append(dev1Path(s), [first, duplicate]);
		const rebuilt = await s.summaries.rebuild({
			deviceId: 'dev1',
			localDate: '2026-07-20',
			nowIso: '2026-07-21T00:00:00.000Z',
		});
		expect(rebuilt.summary.metricsByFileId.f1?.activeMs).toBe(5_000);
		expect(rebuilt.summary.warnings.some((warning) => warning.code === 'duplicate-adjustment')).toBeTrue();
	});

	it('rejects invalid nested metrics, identity, and warning structures', async () => {
		const s = setup();
		const ref = { deviceId: 'dev1', localDate: '2026-07-20' };
		const path = dailySummaryPath(s.pathAdapter, ref.deviceId, ref.localDate);
		const valid = {
			schemaVersion: 1,
			...ref,
			generatedAt: '2026-07-21T00:00:00.000Z',
			sourceRecordCount: 1,
			sourceFingerprint: 'source',
			metricsByFileId: { f1: { activeMs: 10, editingMs: 5, openCount: 1 } },
			warnings: [],
		};
		for (const invalid of [
			{ ...valid, metricsByFileId: { f1: { activeMs: -1, editingMs: 0, openCount: 1 } } },
			{ ...valid, metricsByFileId: { f1: { activeMs: 10, editingMs: 0, openCount: 1.5 } } },
			{ ...valid, deviceId: 'other-device' },
			{ ...valid, warnings: [{ code: 'broken' }] },
		]) {
			s.adapter.seed(path, JSON.stringify(invalid));
			const loaded = await s.summaries.loadWithStatus(ref);
			expect(loaded.status).toBe('corrupt');
			expect(loaded.warning?.code).toBe('corrupt-daily-summary');
		}
	});

	it('surfaces a corrupt daily summary as a rebuild-required query warning', async () => {
		const s = setup();
		const ref = { deviceId: 'dev1', localDate: '2026-07-20' };
		s.adapter.seed(dailySummaryPath(s.pathAdapter, ref.deviceId, ref.localDate), '{broken');
		const query = new LocalQueryService(
			fakeInventory([], [ref]),
			s.summaries,
			s.registry,
			() => normalizeSettings({ deviceId: 'dev1' }),
		);
		const result = await query.run({
			metric: 'activeMs',
			range: { mode: 'day', localDate: ref.localDate },
			path: '',
			view: 'children',
			groupBy: 'path',
		});
		expect(result.warnings.some((warning) => warning.code === 'corrupt-daily-summary')).toBeTrue();
		expect(result.scopeTotal).toBe(0);
	});
});

describe('retention service', () => {
	it('removes a raw shard only after its summary exists and matches', async () => {
		const s = setup();
		await seedShard(s, 'dev1', '2026-07-01', [segment('f1', 'a.md', '2026-07-01', 10_000)]);
		const inventory = fakeInventory([{ deviceId: 'dev1', localDate: '2026-07-01' }]);
		const rebuild = new RebuildService(inventory, s.shardStore, s.summaries);
		// First: summary does not exist yet, so retention keeps the shard.
		const retention = new RetentionService(inventory, s.shardStore, s.summaries, s.pathAdapter, s.adapter);
		const before = await retention.run({ cutoffDate: '2026-07-15', nowIso: '2026-07-21T00:00:00.000Z' });
		expect(before.processed[0]?.outcome).toBe('kept-summary-missing');
		// Build the summary, then retention removes the raw shard.
		await rebuild.rebuild({ nowIso: '2026-07-21T00:00:00.000Z' });
		const after = await retention.run({ cutoffDate: '2026-07-15', nowIso: '2026-07-21T00:00:00.000Z' });
		expect(after.processed[0]?.outcome).toBe('removed');
		expect(after.watermark).toBe('2026-07-21T00:00:00.000Z');
	});

	it('keeps shards within the retention window', async () => {
		const s = setup();
		await seedShard(s, 'dev1', '2026-07-20', [segment('f1', 'a.md', '2026-07-20', 10_000)]);
		const inventory = fakeInventory([{ deviceId: 'dev1', localDate: '2026-07-20' }]);
		const retention = new RetentionService(inventory, s.shardStore, s.summaries, s.pathAdapter, s.adapter);
		const result = await retention.run({ cutoffDate: '2026-07-15', nowIso: '2026-07-21T00:00:00.000Z' });
		// 2026-07-20 >= 2026-07-15, so it is within the window.
		expect(result.processed[0]?.outcome).toBe('kept-within-window');
	});

	it('keeps an old shard when its summary fingerprint is stale', async () => {
		const s = setup();
		await seedShard(s, 'dev1', '2026-07-01', [segment('f1', 'a.md', '2026-07-01', 10_000)]);
		const inventory = fakeInventory([{ deviceId: 'dev1', localDate: '2026-07-01' }]);
		await new RebuildService(inventory, s.shardStore, s.summaries).rebuild({ nowIso: '2026-07-21T00:00:00.000Z' });
		await seedShard(s, 'dev1', '2026-07-01', [segment('f2', 'b.md', '2026-07-01', 5_000)]);
		const result = await new RetentionService(inventory, s.shardStore, s.summaries, s.pathAdapter, s.adapter).run({
			cutoffDate: '2026-07-15',
			nowIso: '2026-07-21T00:00:00.000Z',
		});
		expect(result.processed[0]?.outcome).toBe('kept-summary-missing');
		expect((await s.shardStore.read(dev1Path(s, '2026-07-01'))).records).toHaveLength(2);
	});

	it('reports and retains a shard when removal is interrupted', async () => {
		const s = setup({ fail: { remove: 1 } });
		const envelope = buildSessionEnvelope(segment('f1', 'a.md', '2026-07-01', 10_000), 'dev1');
		s.adapter.seed(dev1Path(s, '2026-07-01'), `${JSON.stringify(envelope)}\n`);
		const inventory = fakeInventory([{ deviceId: 'dev1', localDate: '2026-07-01' }]);
		await new RebuildService(inventory, s.shardStore, s.summaries).rebuild({ nowIso: '2026-07-21T00:00:00.000Z' });
		const result = await new RetentionService(inventory, s.shardStore, s.summaries, s.pathAdapter, s.adapter).run({
			cutoffDate: '2026-07-15',
			nowIso: '2026-07-21T00:00:00.000Z',
		});
		expect(result.processed[0]?.outcome).toBe('kept-unreadable');
		expect((await s.shardStore.read(dev1Path(s, '2026-07-01'))).records).toHaveLength(1);
	});

	it('cutoffDate computes the date N days before today', () => {
		expect(RetentionService.cutoffDate('2026-07-21', 90)).toBe('2026-04-22');
	});
});

describe('raw export service', () => {
	it('exports all records with metadata and never reads note content', async () => {
		const s = setup();
		await seedShard(s, 'dev1', '2026-07-20', [
			segment('f1', 'a.md', '2026-07-20', 10_000),
			segment('f2', 'b.md', '2026-07-20', 5_000),
		]);
		const inventory = fakeInventory([{ deviceId: 'dev1', localDate: '2026-07-20' }]);
		const exporter = new RawExportService(inventory, s.shardStore, s.pathAdapter);
		const result = await exporter.export({ scope: { kind: 'all' }, nowIso: '2026-07-21T00:00:00.000Z' });
		expect(result.recordCount).toBe(2);
		expect(result.deviceId).toBe('dev1');
		expect(result.schemaVersion).toBe(1);
		// No note content is present in the records.
		const serialized = JSON.stringify(result);
		expect(serialized.includes('note-body')).toBeFalse();
	});

	it('exports a single file scope', async () => {
		const s = setup();
		await seedShard(s, 'dev1', '2026-07-20', [
			segment('f1', 'a.md', '2026-07-20', 10_000),
			segment('f2', 'b.md', '2026-07-20', 5_000),
		]);
		const inventory = fakeInventory([{ deviceId: 'dev1', localDate: '2026-07-20' }]);
		const exporter = new RawExportService(inventory, s.shardStore, s.pathAdapter);
		const result = await exporter.export({
			scope: { kind: 'file', fileId: 'f1' },
			nowIso: '2026-07-21T00:00:00.000Z',
		});
		expect(result.recordCount).toBe(1);
		expect(result.records[0]?.fileId).toBe('f1');
	});

	it('exports adjustments alongside sessions', async () => {
		const s = setup();
		const adj = buildAdjustmentEnvelope(decision('c1', '2026-07-20T00:01:00.000Z'), 'dev1', 'f1', 'a.md', '2026-07-20');
		await s.shardStore.append(dev1Path(s), [adj]);
		const inventory = fakeInventory([{ deviceId: 'dev1', localDate: '2026-07-20' }]);
		const exporter = new RawExportService(inventory, s.shardStore, s.pathAdapter);
		const result = await exporter.export({ scope: { kind: 'all' }, nowIso: '2026-07-21T00:00:00.000Z' });
		expect(result.records[0]?.type).toBe('adjustment');
	});

	it('isolates corrupt export lines and emits typed progress', async () => {
		const s = setup();
		const envelope = buildSessionEnvelope(segment('f1', 'a.md', '2026-07-20', 10_000), 'dev1');
		s.adapter.seed(dev1Path(s), `${JSON.stringify(envelope)}\n{broken\n`);
		const inventory = fakeInventory([{ deviceId: 'dev1', localDate: '2026-07-20' }]);
		const progress: number[] = [];
		const result = await new RawExportService(inventory, s.shardStore, s.pathAdapter).export({
			scope: { kind: 'all' },
			nowIso: '2026-07-21T00:00:00.000Z',
			onProgress: (event) => progress.push(event.completed),
		});
		expect(result.recordCount).toBe(1);
		expect(result.warnings).toHaveLength(1);
		expect(progress).toHaveLength(1);
	});
});

describe('deletion service', () => {
	it('plan then execute removes date-scoped shards and summaries', async () => {
		const s = setup();
		await seedShard(s, 'dev1', '2026-07-20', [segment('f1', 'a.md', '2026-07-20', 10_000)]);
		const inventory = fakeInventory([{ deviceId: 'dev1', localDate: '2026-07-20' }]);
		const service = new DeletionService(inventory, s.shardStore, s.summaries, s.pathAdapter, s.adapter, s.registry);
		const plan = await service.planDeletion({
			scope: { kind: 'date', localDate: '2026-07-20' },
			nowIso: '2026-07-21T00:00:00.000Z',
		});
		expect(plan.affectedRecordCount).toBe(1);
		expect(plan.affectedShards).toHaveLength(1);
		expect(Object.keys(plan.pathFingerprints)).toEqual(plan.affectedPaths);
		const executed = await service.executeDeletion({ plan, nowIso: '2026-07-21T00:00:00.000Z' });
		expect(executed.outcome).toBe('completed');
		expect(executed.removedPaths.length).toBeGreaterThan(0);
		// The shard is gone.
		const read = await s.shardStore.read(dev1Path(s));
		expect(read.records).toHaveLength(0);
	});

	it('aborts without deleting plan-external shards added after preview', async () => {
		const s = setup();
		const shards = [{ deviceId: 'dev1', localDate: '2026-07-20' }];
		await seedShard(s, 'dev1', '2026-07-20', [segment('f1', 'a.md', '2026-07-20', 10_000)]);
		const inventory = fakeInventory(shards);
		const service = new DeletionService(inventory, s.shardStore, s.summaries, s.pathAdapter, s.adapter, s.registry);
		const plan = await service.planDeletion({ scope: { kind: 'all' }, nowIso: '2026-07-21T00:00:00.000Z' });
		shards.push({ deviceId: 'dev1', localDate: '2026-07-21' });
		await seedShard(s, 'dev1', '2026-07-21', [segment('f2', 'new.md', '2026-07-21', 5_000)]);
		const executed = await service.executeDeletion({ plan, nowIso: '2026-07-21T00:01:00.000Z' });
		expect(executed.outcome).toBe('aborted-drift');
		expect((await s.shardStore.read(dev1Path(s, '2026-07-20'))).records).toHaveLength(1);
		expect((await s.shardStore.read(dev1Path(s, '2026-07-21'))).records).toHaveLength(1);
	});

	it('aborts when the source set drifts between plan and execute', async () => {
		const s = setup();
		await seedShard(s, 'dev1', '2026-07-20', [segment('f1', 'a.md', '2026-07-20', 10_000)]);
		const inventory = fakeInventory([{ deviceId: 'dev1', localDate: '2026-07-20' }]);
		const service = new DeletionService(inventory, s.shardStore, s.summaries, s.pathAdapter, s.adapter, s.registry);
		const plan = await service.planDeletion({
			scope: { kind: 'date', localDate: '2026-07-20' },
			nowIso: '2026-07-21T00:00:00.000Z',
		});
		// Drift: add another record between plan and execute.
		await seedShard(s, 'dev1', '2026-07-20', [segment('f2', 'b.md', '2026-07-20', 5_000)]);
		const executed = await service.executeDeletion({ plan, nowIso: '2026-07-21T00:00:00.000Z' });
		expect(executed.outcome).toBe('aborted-drift');
		// Original records are preserved.
		const read = await s.shardStore.read(dev1Path(s));
		expect(read.records.length).toBeGreaterThan(0);
	});

	it('detects replacement drift even when the record count is unchanged', async () => {
		const s = setup();
		await seedShard(s, 'dev1', '2026-07-20', [segment('f1', 'a.md', '2026-07-20', 10_000)]);
		const inventory = fakeInventory([{ deviceId: 'dev1', localDate: '2026-07-20' }]);
		const service = new DeletionService(inventory, s.shardStore, s.summaries, s.pathAdapter, s.adapter, s.registry);
		const plan = await service.planDeletion({ scope: { kind: 'date', localDate: '2026-07-20' }, nowIso: '2026-07-21T00:00:00.000Z' });
		await s.shardStore.remove(dev1Path(s));
		await seedShard(s, 'dev1', '2026-07-20', [segment('f2', 'b.md', '2026-07-20', 5_000)]);
		const executed = await service.executeDeletion({ plan, nowIso: '2026-07-21T00:01:00.000Z' });
		expect(executed.outcome).toBe('aborted-drift');
	});

	it('aborts when summary-only authoritative data changes after preview', async () => {
		const s = setup();
		const summaryRef = { deviceId: 'dev1', localDate: '2026-07-01' };
		await s.summaries.save({
			...summaryRef,
			summary: {
				schemaVersion: 1,
				...summaryRef,
				generatedAt: '2026-07-20T00:00:00.000Z',
				sourceRecordCount: 1,
				sourceFingerprint: 'retained-source',
				metricsByFileId: { f1: { activeMs: 10_000, editingMs: 0, openCount: 1, typedChars: 0 } },
				warnings: [],
			},
		});
		const inventory = fakeInventory([], [summaryRef]);
		const service = new DeletionService(inventory, s.shardStore, s.summaries, s.pathAdapter, s.adapter, s.registry);
		const plan = await service.planDeletion({
			scope: { kind: 'date', localDate: summaryRef.localDate },
			nowIso: '2026-07-21T00:00:00.000Z',
		});
		expect(plan.affectedSummaryCount).toBe(1);
		const current = await s.summaries.load(summaryRef);
		if (!current) throw new Error('summary fixture missing');
		await s.summaries.save({
			...summaryRef,
			summary: {
				...current,
				generatedAt: '2026-07-21T00:00:30.000Z',
				metricsByFileId: { f1: { activeMs: 20_000, editingMs: 0, openCount: 1, typedChars: 0 } },
			},
		});
		const executed = await service.executeDeletion({ plan, nowIso: '2026-07-21T00:01:00.000Z' });
		expect(executed.outcome).toBe('aborted-drift');
		expect((await s.summaries.load(summaryRef))?.metricsByFileId.f1?.activeMs).toBe(20_000);
	});

	it('file scope rewrites affected shards without removing whole dates', async () => {
		const s = setup();
		await seedShard(s, 'dev1', '2026-07-20', [
			segment('f1', 'a.md', '2026-07-20', 10_000),
			segment('f2', 'b.md', '2026-07-20', 5_000),
		]);
		const inventory = fakeInventory([{ deviceId: 'dev1', localDate: '2026-07-20' }]);
		const service = new DeletionService(inventory, s.shardStore, s.summaries, s.pathAdapter, s.adapter, s.registry);
		const plan = await service.planDeletion({
			scope: { kind: 'file', fileId: 'f1' },
			nowIso: '2026-07-21T00:00:00.000Z',
		});
		const executed = await service.executeDeletion({ plan, nowIso: '2026-07-21T00:00:00.000Z' });
		expect(executed.outcome).toBe('completed');
		const read = await s.shardStore.read(dev1Path(s));
		// f1 removed, f2 retained.
		expect(read.records).toHaveLength(1);
		expect(read.records[0]?.fileId).toBe('f2');
	});

	it('reports partial failure when a file rewrite cannot safely complete', async () => {
		const s = setup({ fail: { write: 1 } });
		const envelope = buildSessionEnvelope(segment('f1', 'a.md', '2026-07-20', 10_000), 'dev1');
		s.adapter.seed(dev1Path(s), `${JSON.stringify(envelope)}\n`);
		const inventory = fakeInventory([{ deviceId: 'dev1', localDate: '2026-07-20' }]);
		const service = new DeletionService(inventory, s.shardStore, s.summaries, s.pathAdapter, s.adapter, s.registry);
		const plan = await service.planDeletion({ scope: { kind: 'file', fileId: 'f1' }, nowIso: '2026-07-21T00:00:00.000Z' });
		const executed = await service.executeDeletion({ plan, nowIso: '2026-07-21T00:01:00.000Z' });
		expect(executed.outcome).toBe('partial-failure');
		expect(executed.errors.length).toBeGreaterThan(0);
	});

	it('refuses file-scoped rewrite when the source contains a malformed line', async () => {
		const s = setup();
		const envelope = buildSessionEnvelope(segment('f1', 'a.md', '2026-07-20', 10_000), 'dev1');
		s.adapter.seed(dev1Path(s), `${JSON.stringify(envelope)}\n{broken\n`);
		const inventory = fakeInventory([{ deviceId: 'dev1', localDate: '2026-07-20' }]);
		const service = new DeletionService(inventory, s.shardStore, s.summaries, s.pathAdapter, s.adapter, s.registry);
		const plan = await service.planDeletion({ scope: { kind: 'file', fileId: 'f1' }, nowIso: '2026-07-21T00:00:00.000Z' });
		const executed = await service.executeDeletion({ plan, nowIso: '2026-07-21T00:01:00.000Z' });
		expect(executed.outcome).toBe('partial-failure');
		expect((await s.shardStore.read(dev1Path(s))).diagnostics).toHaveLength(1);
	});

	it('full deletion clears checkpoint and registry identities', async () => {
		const s = setup();
		await s.registry.resolve('a.md', '2026-07-20T00:00:00.000Z');
		await s.registry.save();
		await seedShard(s, 'dev1', '2026-07-20', [segment('f1', 'a.md', '2026-07-20', 10_000)]);
		const inventory = fakeInventory([{ deviceId: 'dev1', localDate: '2026-07-20' }]);
		const service = new DeletionService(inventory, s.shardStore, s.summaries, s.pathAdapter, s.adapter, s.registry);
		const plan = await service.planDeletion({ scope: { kind: 'all' }, nowIso: '2026-07-21T00:00:00.000Z' });
		const executed = await service.executeDeletion({ plan, nowIso: '2026-07-21T00:01:00.000Z' });
		expect(executed.outcome).toBe('completed');
		expect(Object.keys(s.registry.snapshot().entries)).toHaveLength(0);
	});
});
