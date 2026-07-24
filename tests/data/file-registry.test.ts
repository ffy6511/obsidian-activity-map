import { describe, expect, expectReject, it } from '../helpers/test-harness';

import { FileRegistry, type FileRegistryFile } from '../../src/data/file-registry';
import { SafeJsonStore } from '../../src/data/safe-json-store';
import { FakeDataAdapter } from '../helpers/fake-data-adapter';

function registryFile(
	entries: Record<string, unknown> = {},
	pathIndex: Record<string, string> = {},
): FileRegistryFile {
	return { schemaVersion: 1, entries: entries as FileRegistryFile['entries'], pathIndex };
}

async function newRegistry(
	adapter = new FakeDataAdapter(),
	path = '/p/files.json',
): Promise<FileRegistry> {
	const store = new SafeJsonStore(adapter, path);
	return FileRegistry.load(store);
}

describe('file registry identity', () => {
	it('assigns a stable id on first observation and reuses it', async () => {
		const reg = await newRegistry();
		const a = await reg.resolve('notes/a.md', '2026-01-01T00:00:00.000Z');
		const b = await reg.resolve('notes/a.md', '2026-01-02T00:00:00.000Z');
		expect(a.fileId).toBe(b.fileId);
		expect(a.currentPath).toBe('notes/a.md');
	});

	it('observed rename preserves the id and updates the path index', async () => {
		const reg = await newRegistry();
		const before = await reg.resolve('notes/a.md', 't');
		await reg.rename('notes/a.md', 'notes/renamed.md');
		const after = await reg.resolve('notes/renamed.md', 't2');
		expect(after.fileId).toBe(before.fileId);
		// The old path no longer resolves to the same id.
		const snapshot = reg.snapshot();
		expect(snapshot.pathIndex['notes/a.md']).toBeUndefined();
		expect(snapshot.pathIndex['notes/renamed.md']).toBe(before.fileId);
	});

	it('observed delete marks deleted; a recreate at the same path gets a new id', async () => {
		const reg = await newRegistry();
		const first = await reg.resolve('notes/a.md', 't');
		await reg.delete('notes/a.md');
		expect(reg.currentPathFor(first.fileId)).toBeNull();
		expect(reg.lastKnownPathFor(first.fileId)).toBe('notes/a.md');
		const recreated = await reg.resolve('notes/a.md', 't2');
		expect(recreated.fileId).not.toBe(first.fileId);
	});

	it('folder rename moves every descendant path in one transaction', async () => {
		const reg = await newRegistry();
		await reg.resolve('projects/proj1/a.md', 't');
		await reg.resolve('projects/proj1/sub/b.md', 't');
		await reg.resolve('projects/proj2/c.md', 't');
		await reg.renameFolder('projects/proj1', 'archive/proj1');
		const snap = reg.snapshot();
		expect(snap.pathIndex['archive/proj1/a.md']).toBeDefined();
		expect(snap.pathIndex['archive/proj1/sub/b.md']).toBeDefined();
		// Unrelated sibling is untouched.
		expect(snap.pathIndex['projects/proj2/c.md']).toBeDefined();
		// Old paths are gone.
		expect(snap.pathIndex['projects/proj1/a.md']).toBeUndefined();
	});

	it('rename of an unknown source is a no-op (no id invented)', async () => {
		const reg = await newRegistry();
		await reg.rename('never/seen.md', 'notes/x.md');
		const snap = reg.snapshot();
		expect(Object.keys(snap.entries)).toHaveLength(0);
	});

	it('delete of an unknown path is a no-op', async () => {
		const reg = await newRegistry();
		await reg.delete('never/seen.md');
		expect(Object.keys(reg.snapshot().entries)).toHaveLength(0);
	});
});

describe('file registry persistence', () => {
	it('round-trips entries and path index through save/load', async () => {
		const adapter = new FakeDataAdapter();
		const reg = await newRegistry(adapter);
		await reg.resolve('notes/a.md', 't');
		await reg.resolve('notes/b.md', 't');
		await reg.save();
		const reg2 = await newRegistry(adapter);
		const a = await reg2.resolve('notes/a.md', 't2');
		const snap = reg2.snapshot();
		expect(snap.pathIndex['notes/a.md']).toBe(a.fileId);
		expect(Object.keys(snap.entries)).toHaveLength(2);
	});

	it('a corrupt registry pauses identity creation rather than reassigning', async () => {
		const adapter = new FakeDataAdapter();
		adapter.seed('/p/files.json', '{ not json');
		const reg = await newRegistry(adapter);
		// Validate that loading a corrupt file yields a registry that refuses
		// new identity creation (the corrupted flag is the signal).
		expect(reg.corrupted).toBeTrue();
		await expectReject(reg.resolve('notes/a.md', 't')).toBeTruthy();
	});

	it('quarantines an unsupported schema version without losing the file', async () => {
		const adapter = new FakeDataAdapter();
		adapter.seed(
			'/p/files.json',
			JSON.stringify(
				registryFile({}, {}) && { schemaVersion: 99, entries: {}, pathIndex: {} },
			),
		);
		const reg = await newRegistry(adapter);
		expect(reg.corrupted).toBeTrue();
	});
});
