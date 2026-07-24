import { describe, expect, it } from '../helpers/test-harness';

import { buildTypedInputEnvelope } from '../../src/data/event-envelope';
import { DataServices } from '../../src/data/data-services';
import { DailySummaryRepository, aggregateMetrics } from '../../src/data/daily-summary-repository';
import { NdjsonShardStore } from '../../src/data/ndjson-shard-store';
import { dailySummaryPath, filesRegistryPath, sessionShardPath } from '../../src/data/paths';
import { FileRegistry } from '../../src/data/file-registry';
import { SafeJsonStore } from '../../src/data/safe-json-store';
import { normalizeSettings } from '../../src/domain/settings';
import { FakeDataAdapter } from '../helpers/fake-data-adapter';

describe('typed-input persistence', () => {
	it('stores only a numeric source-classified input count and aggregates it', () => {
		const envelope = buildTypedInputEnvelope(
			{
				recordId: 'file-a-1-1',
				fileId: 'file-a',
				pathAtEvent: 'notes/a.md',
				occurredAt: '2026-07-23T10:00:00.000Z',
				localDate: '2026-07-23',
				typedChars: 3,
				source: 'ime-commit',
			},
			'device-1',
		);
		expect(envelope).toEqual({
			schemaVersion: 1,
			recordId: 'typed-input:file-a-1-1',
			type: 'typed-input',
			deviceId: 'device-1',
			fileId: 'file-a',
			pathAtEvent: 'notes/a.md',
			occurredAt: '2026-07-23T10:00:00.000Z',
			localDate: '2026-07-23',
			payload: { kind: 'typed-input', typedChars: 3, source: 'ime-commit' },
		});
		const metrics = aggregateMetrics([envelope], '2026-07-23', []);
		expect(metrics['file-a']).toEqual({
			activeMs: 0,
			editingMs: 0,
			openCount: 0,
			typedChars: 3,
		});
	});

	it('normalizes a pre-typedChars daily summary to zero', async () => {
		const adapter = new FakeDataAdapter();
		const repository = new DailySummaryRepository({
			shardStore: new NdjsonShardStore(adapter),
			pathAdapter: adapter,
			fileAdapter: adapter,
		});
		adapter.seed(
			dailySummaryPath(adapter, 'device-1', '2026-07-23'),
			JSON.stringify({
				schemaVersion: 1,
				deviceId: 'device-1',
				localDate: '2026-07-23',
				generatedAt: '2026-07-23T10:00:00.000Z',
				sourceRecordCount: 1,
				sourceFingerprint: 'legacy',
				metricsByFileId: { 'file-a': { activeMs: 1000, editingMs: 500, openCount: 1 } },
				warnings: [],
			}),
		);
		expect(
			(await repository.load({ deviceId: 'device-1', localDate: '2026-07-23' }))
				?.metricsByFileId['file-a']?.typedChars,
		).toBe(0);
	});

	it('appends typed input to the event-time shard and rebuilds the exact total', async () => {
		const adapter = new FakeDataAdapter();
		const settings = normalizeSettings({ deviceId: 'device-1' });
		const registry = await FileRegistry.load(
			new SafeJsonStore(adapter, filesRegistryPath(adapter)),
		);
		const data = new DataServices({
			registry,
			fileAdapter: adapter,
			pathAdapter: adapter,
			settings,
			timeZone: 'UTC',
		});
		await data.appendTypedInputs([
			{
				recordId: 'file-a-1-1',
				fileId: 'file-a',
				pathAtEvent: 'notes/a.md',
				occurredAt: '2026-07-23T10:00:00.000Z',
				localDate: '2026-07-23',
				typedChars: 4,
				source: 'insert-text',
			},
		]);
		const shard = sessionShardPath(adapter, 'device-1', '2026-07-23');
		expect(adapter.peek(shard)?.includes('typed-input')).toBeTrue();
		const summaries = new DailySummaryRepository({
			shardStore: data.getShardStore(),
			pathAdapter: adapter,
			fileAdapter: adapter,
		});
		const rebuilt = await summaries.rebuild({
			deviceId: 'device-1',
			localDate: '2026-07-23',
			nowIso: '2026-07-23T10:01:00.000Z',
		});
		expect(rebuilt.summary.metricsByFileId['file-a']).toEqual({
			activeMs: 0,
			editingMs: 0,
			openCount: 0,
			typedChars: 4,
		});
	});
});
