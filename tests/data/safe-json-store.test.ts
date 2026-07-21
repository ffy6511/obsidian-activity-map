import { describe, expect, it } from '../helpers/test-harness';

import { SafeJsonStore } from '../../src/data/safe-json-store';
import { FakeDataAdapter } from '../helpers/fake-data-adapter';

const identity = (x: unknown) => x;

describe('safe json store load/save', () => {
	it('returns null when no candidate exists', async () => {
		const adapter = new FakeDataAdapter();
		const store = new SafeJsonStore(adapter, '/p/data.json');
		const result = await store.load(identity);
		expect(result.value).toBeNull();
		expect(result.recovered).toBeFalse();
	});

	it('writes and reads back a value', async () => {
		const adapter = new FakeDataAdapter();
		const store = new SafeJsonStore(adapter, '/p/data.json');
		await store.save({ a: 1 }, (v) => JSON.stringify(v));
		const result = await store.load(identity);
		expect(result.value).toEqual({ a: 1 });
		expect(result.recovered).toBeFalse();
	});

	it('recovers from the .bak when the primary is invalid', async () => {
		const adapter = new FakeDataAdapter();
		const store = new SafeJsonStore(adapter, '/p/data.json');
		await store.save({ a: 1 }, (v) => JSON.stringify(v));
		await store.save({ a: 2 }, (v) => JSON.stringify(v));
		// Corrupt the primary in place. The .bak holds the *previous* valid
		// primary ({a:1}); recovery restores that older-but-valid value rather
		// than losing all data.
		adapter.seed('/p/data.json', '{ not json');
		const result = await store.load(identity);
		expect(result.recovered).toBeTrue();
		expect(result.value).toEqual({ a: 1 });
		expect(result.reason).toBe('primary-invalid');
	});

	it('promotes a valid .next when both primary and .bak are unusable', async () => {
		const adapter = new FakeDataAdapter();
		const store = new SafeJsonStore(adapter, '/p/data.json');
		await store.save({ a: 1 }, (v) => JSON.stringify(v));
		// Seed a valid next, corrupt primary, leave no valid bak.
		adapter.seed('/p/data.json.next', JSON.stringify({ a: 9 }));
		adapter.seed('/p/data.json', 'corrupt');
		const result = await store.load(identity);
		expect(result.recovered).toBeTrue();
		expect(result.reason).toBe('next-promoted');
	});
});

describe('safe json store failures', () => {
	it('falls back to write+remove when rename is unsupported', async () => {
		const adapter = new FakeDataAdapter({ renameUnsupported: true });
		const store = new SafeJsonStore(adapter, '/p/data.json');
		await store.save({ a: 1 }, (v) => JSON.stringify(v));
		expect(adapter.peek('/p/data.json')).toBe(JSON.stringify({ a: 1 }));
		// The .next was promoted via write+remove, so it is gone.
		expect(adapter.peek('/p/data.json.next')).toBeUndefined();
	});

	it('a failed write leaves at least one validated primary or backup', async () => {
		const adapter = new FakeDataAdapter({ fail: { write: 2 } });
		const store = new SafeJsonStore(adapter, '/p/data.json');
		// First save succeeds and establishes a primary.
		await store.save({ a: 1 }, (v) => JSON.stringify(v));
		expect(adapter.peek('/p/data.json')).toBe(JSON.stringify({ a: 1 }));
		// Second save fails at the write step (the .next write).
		let threw = false;
		try {
			await store.save({ a: 2 }, (v) => JSON.stringify(v));
		} catch {
			threw = true;
		}
		expect(threw).toBeTrue();
		// The previous primary is still readable and valid.
		expect(adapter.peek('/p/data.json')).toBe(JSON.stringify({ a: 1 }));
	});

	it('removeAll clears primary, next, and backup', async () => {
		const adapter = new FakeDataAdapter();
		const store = new SafeJsonStore(adapter, '/p/data.json');
		await store.save({ a: 1 }, (v) => JSON.stringify(v));
		await store.save({ a: 2 }, (v) => JSON.stringify(v));
		await store.removeAll();
		expect(adapter.peek('/p/data.json')).toBeUndefined();
		expect(adapter.peek('/p/data.json.bak')).toBeUndefined();
		expect(adapter.peek('/p/data.json.next')).toBeUndefined();
	});

	it('serializes concurrent saves so writes do not interleave', async () => {
		const adapter = new FakeDataAdapter();
		const store = new SafeJsonStore(adapter, '/p/data.json');
		await Promise.all([
			store.save({ a: 1 }, (v) => JSON.stringify(v)),
			store.save({ a: 2 }, (v) => JSON.stringify(v)),
			store.save({ a: 3 }, (v) => JSON.stringify(v)),
		]);
		// The final primary is one of the written values (last wins, serialized).
		const result = await store.load(identity);
		expect(result.value).toEqual({ a: 3 });
	});
});
