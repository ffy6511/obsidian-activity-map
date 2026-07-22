import { describe, expect, it } from '../helpers/test-harness';

import { buildSessionEnvelope, buildAdjustmentEnvelope } from '../../src/data/event-envelope';
import { NdjsonShardStore } from '../../src/data/ndjson-shard-store';
import { FakeDataAdapter } from '../helpers/fake-data-adapter';
import type { ClosedSessionSegment, RecoveryDecision } from '../../src/domain/activity';

function segment(fileId: string, localDate: string, activeMs: number): ClosedSessionSegment {
	return {
		sessionId: `s-${fileId}`,
		target: { fileId, path: `${fileId}.md`, windowId: 'main', leafId: 'l1' },
		startedAt: `2026-01-01T00:00:00.000Z`,
		endedAt: `2026-01-01T00:00:10.000Z`,
		localDate,
		activeMs,
		editingMs: 0,
		openCount: 1,
		closureReason: 'blur',
	};
}

function decision(candidateId: string): RecoveryDecision {
	return {
		candidateId,
		fileId: 'f1',
		pathAtEvent: 'a.md',
		intervalStartedAt: '2026-07-20T00:00:00.000Z',
		kind: 'include',
		deltaMs: 5_000,
		reason: 'user-include',
		decidedAt: '2026-01-01T00:01:00.000Z',
		automatic: false,
	};
}

describe('ndjson shard store append and read', () => {
	it('appends records and reads them back', async () => {
		const adapter = new FakeDataAdapter();
		const store = new NdjsonShardStore(adapter);
		const env = buildSessionEnvelope(segment('f1', '2026-01-01', 5_000), 'dev1');
		const result = await store.append('/shard.ndjson', [env]);
		expect(result.appended).toBe(1);
		const read = await store.read('/shard.ndjson');
		expect(read.records).toHaveLength(1);
		expect(read.records[0]?.payload).toMatchObject({ kind: 'session', activeMs: 5_000 });
	});

	it('appends multiple records to the same shard across calls', async () => {
		const adapter = new FakeDataAdapter();
		const store = new NdjsonShardStore(adapter);
		await store.append('/shard.ndjson', [buildSessionEnvelope(segment('f1', '2026-01-01', 1_000), 'dev1')]);
		await store.append('/shard.ndjson', [buildSessionEnvelope(segment('f2', '2026-01-01', 2_000), 'dev1')]);
		const read = await store.read('/shard.ndjson');
		expect(read.records).toHaveLength(2);
	});

	it('duplicate recordIds are skipped on append and read (idempotency)', async () => {
		const adapter = new FakeDataAdapter();
		const store = new NdjsonShardStore(adapter);
		const env = buildSessionEnvelope(segment('f1', '2026-01-01', 1_000), 'dev1');
		const first = await store.append('/shard.ndjson', [env]);
		expect(first.appended).toBe(1);
		// Re-append the same recordId: skipped as a duplicate.
		const second = await store.append('/shard.ndjson', [env]);
		expect(second.appended).toBe(0);
		expect(second.duplicatesSkipped).toBe(1);
		const read = await store.read('/shard.ndjson');
		expect(read.records).toHaveLength(1);
	});
});

describe('ndjson shard store corruption isolation', () => {
	it('isolates a malformed line and continues with valid records', async () => {
		const adapter = new FakeDataAdapter();
		adapter.seed('/shard.ndjson', '{ valid-ish\n' + JSON.stringify(buildSessionEnvelope(segment('f1', '2026-01-01', 1_000), 'dev1')) + '\n');
		const store = new NdjsonShardStore(adapter);
		const read = await store.read('/shard.ndjson');
		expect(read.records).toHaveLength(1);
		expect(read.diagnostics).toHaveLength(1);
		expect(read.diagnostics[0]?.code).toBe('malformed-line');
	});

	it('isolates an invalid envelope without blocking valid records', async () => {
		const adapter = new FakeDataAdapter();
		const valid = buildSessionEnvelope(segment('f1', '2026-01-01', 1_000), 'dev1');
		// A structurally-invalid envelope (missing required fields).
		const invalid = JSON.stringify({ schemaVersion: 1, type: 'session', recordId: 'bad' });
		adapter.seed('/shard.ndjson', `${invalid}\n${JSON.stringify(valid)}\n`);
		const store = new NdjsonShardStore(adapter);
		const read = await store.read('/shard.ndjson');
		expect(read.records).toHaveLength(1);
		expect(read.diagnostics.some((d) => d.code === 'invalid-envelope')).toBeTrue();
	});

	it('an unreadable shard yields a diagnostic and no records, without throwing', async () => {
		const adapter = new FakeDataAdapter({ fail: { read: 1 } });
		adapter.seed('/shard.ndjson', '{}\n');
		const store = new NdjsonShardStore(adapter);
		const read = await store.read('/shard.ndjson');
		expect(read.records).toHaveLength(0);
		expect(read.diagnostics).toHaveLength(1);
		expect(read.diagnostics[0]?.message).toBe('shard-unreadable');
	});
});

describe('ndjson shard store concurrency and rewrite', () => {
	it('normal append uses the append primitive and never rewrites the shard', async () => {
		const adapter = new FakeDataAdapter();
		const store = new NdjsonShardStore(adapter);
		await store.append('/shard.ndjson', [buildSessionEnvelope(segment('f1', '2026-01-01', 1_000), 'dev1')]);
		expect(adapter.stats().append).toBe(1);
		expect(adapter.stats().write).toBe(0);
	});

	it('aborts without mutation when the authoritative shard cannot be read', async () => {
		const seedAdapter = new FakeDataAdapter();
		const existing = buildSessionEnvelope(segment('f1', '2026-01-01', 1_000), 'dev1');
		await new NdjsonShardStore(seedAdapter).append('/shard.ndjson', [existing]);
		const original = seedAdapter.peek('/shard.ndjson') ?? '';
		const adapter = new FakeDataAdapter({ fail: { read: 1 } });
		adapter.seed('/shard.ndjson', original);
		const store = new NdjsonShardStore(adapter);
		let rejected = false;
		try {
			await store.append('/shard.ndjson', [buildSessionEnvelope(segment('f2', '2026-01-01', 2_000), 'dev1')]);
		} catch {
			rejected = true;
		}
		expect(rejected).toBeTrue();
		expect(adapter.peek('/shard.ndjson')).toBe(original);
		expect(adapter.stats().append).toBe(0);
	});

	it('preserves existing bytes when append is interrupted', async () => {
		const seedAdapter = new FakeDataAdapter();
		await new NdjsonShardStore(seedAdapter).append('/shard.ndjson', [buildSessionEnvelope(segment('f1', '2026-01-01', 1_000), 'dev1')]);
		const original = seedAdapter.peek('/shard.ndjson') ?? '';
		const adapter = new FakeDataAdapter({ fail: { append: 1 } });
		adapter.seed('/shard.ndjson', original);
		const store = new NdjsonShardStore(adapter);
		let rejected = false;
		try {
			await store.append('/shard.ndjson', [buildSessionEnvelope(segment('f2', '2026-01-01', 2_000), 'dev1')]);
		} catch {
			rejected = true;
		}
		expect(rejected).toBeTrue();
		expect(adapter.peek('/shard.ndjson')).toBe(original);
	});

	it('concurrent appends to the same shard serialize without interleaving', async () => {
		const adapter = new FakeDataAdapter();
		const store = new NdjsonShardStore(adapter);
		const envs = Array.from({ length: 5 }, (_, i) =>
			buildSessionEnvelope(segment(`f${i}`, '2026-01-01', (i + 1) * 1_000), 'dev1'),
		);
		await Promise.all(envs.map((env) => store.append('/shard.ndjson', [env])));
		const read = await store.read('/shard.ndjson');
		expect(read.records).toHaveLength(5);
		expect(read.diagnostics).toHaveLength(0);
	});

	it('rewrite filters records and verifies the result', async () => {
		const adapter = new FakeDataAdapter();
		const store = new NdjsonShardStore(adapter);
		const keep = buildSessionEnvelope(segment('f1', '2026-01-01', 1_000), 'dev1');
		const drop = buildSessionEnvelope(segment('f2', '2026-01-01', 2_000), 'dev1');
		await store.append('/shard.ndjson', [keep, drop]);
		const result = await store.rewrite('/shard.ndjson', (r) => r.fileId === 'f1');
		expect(result.before).toBe(2);
		expect(result.after).toBe(1);
		const read = await store.read('/shard.ndjson');
		expect(read.records).toHaveLength(1);
		expect(read.records[0]?.fileId).toBe('f1');
	});

	it('remove deletes the shard file', async () => {
		const adapter = new FakeDataAdapter();
		const store = new NdjsonShardStore(adapter);
		await store.append('/shard.ndjson', [buildSessionEnvelope(segment('f1', '2026-01-01', 1_000), 'dev1')]);
		await store.remove('/shard.ndjson');
		const read = await store.read('/shard.ndjson');
		expect(read.records).toHaveLength(0);
	});

	it('adjustment envelopes append and read back', async () => {
		const adapter = new FakeDataAdapter();
		const store = new NdjsonShardStore(adapter);
		const env = buildAdjustmentEnvelope(decision('c1'), 'dev1', 'f1', 'f1.md', '2026-01-01');
		await store.append('/shard.ndjson', [env]);
		const read = await store.read('/shard.ndjson');
		expect(read.records[0]?.payload).toMatchObject({ kind: 'adjustment', deltaMs: 5_000 });
	});

	it('uses a durable candidate idempotency key across adjustment retries', async () => {
		const adapter = new FakeDataAdapter();
		const store = new NdjsonShardStore(adapter);
		const first = buildAdjustmentEnvelope(decision('c1'), 'dev1', 'f1', 'f1.md', '2026-01-01');
		const retry = buildAdjustmentEnvelope(decision('c1'), 'dev1', 'f1', 'f1.md', '2026-01-01');
		expect(retry.recordId).toBe(first.recordId);
		await store.append('/shard.ndjson', [first]);
		const result = await store.append('/shard.ndjson', [retry]);
		expect(result.appended).toBe(0);
		expect(result.duplicatesSkipped).toBe(1);
		expect((await store.read('/shard.ndjson')).records).toHaveLength(1);
	});

	it('uses a durable session idempotency key across close retries', async () => {
		const adapter = new FakeDataAdapter();
		const store = new NdjsonShardStore(adapter);
		const closed = segment('f1', '2026-01-01', 1_000);
		const first = buildSessionEnvelope(closed, 'dev1');
		const retry = buildSessionEnvelope({ ...closed, endedAt: '2026-01-01T00:00:02.000Z' }, 'dev1');
		expect(retry.recordId).toBe(first.recordId);
		await store.append('/shard.ndjson', [first]);
		const result = await store.append('/shard.ndjson', [retry]);
		expect(result.appended).toBe(0);
		expect((await store.read('/shard.ndjson')).records).toHaveLength(1);
	});
});
