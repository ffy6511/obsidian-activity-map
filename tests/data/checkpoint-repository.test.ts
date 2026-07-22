import { describe, expect, it } from '../helpers/test-harness';

import { CheckpointRepository } from '../../src/data/checkpoint-repository';
import { SafeJsonStore } from '../../src/data/safe-json-store';
import { FakeDataAdapter } from '../helpers/fake-data-adapter';
import type { RuntimeCheckpoint } from '../../src/domain/activity';

function checkpoint(overrides: Partial<RuntimeCheckpoint> = {}): RuntimeCheckpoint {
	return {
		schemaVersion: 1,
		state: 'active',
		currentTarget: {
			fileId: 'f1',
			path: 'a.md',
			windowId: 'main',
			leafId: 'l1',
		},
		sessionStartedAt: '2026-01-01T00:00:00.000Z',
		lastTrustedActivityAt: '2026-01-01T00:00:05.000Z',
		editBurst: { fileId: 'f1', lastEditAt: '2026-01-01T00:00:03.000Z', silenceMs: 15_000 },
		pendingRecovery: [],
		recentDecisions: [],
		savedAt: '2026-01-01T00:00:10.000Z',
		...overrides,
	};
}

describe('checkpoint repository load/write/clear', () => {
	it('returns null when no checkpoint exists (clean shutdown)', async () => {
		const adapter = new FakeDataAdapter();
		const repo = new CheckpointRepository(new SafeJsonStore(adapter, '/cp.json'));
		const result = await repo.load();
		expect(result.checkpoint).toBeNull();
		expect(result.quarantined).toBeFalse();
	});

	it('writes and loads a checkpoint', async () => {
		const adapter = new FakeDataAdapter();
		const repo = new CheckpointRepository(new SafeJsonStore(adapter, '/cp.json'));
		await repo.write(checkpoint());
		const result = await repo.load();
		expect(result.checkpoint).not.toBeNull();
		expect(result.checkpoint?.state).toBe('active');
	});

	it('clear removes the checkpoint', async () => {
		const adapter = new FakeDataAdapter();
		const repo = new CheckpointRepository(new SafeJsonStore(adapter, '/cp.json'));
		await repo.write(checkpoint());
		await repo.clear();
		const result = await repo.load();
		expect(result.checkpoint).toBeNull();
	});
});
