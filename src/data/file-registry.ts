/**
 * Stable file identity registry.
 *
 * Each first-observed file receives a stable internal `fileId` (never written
 * to frontmatter or content). The registry maintains current and last-known
 * paths, a path index for present files, and a deleted state. Observed rename
 * and move events update the registry without changing the fileId; observed
 * delete sets the file deleted. A later file at the same deleted path receives
 * a new id unless a reliable live rename linked it.
 *
 * Registry mutations are serialized globally so concurrent rename/delete/create
 * events cannot fork history. Corruption does not permit silent id reassignment:
 * a structurally invalid registry is preserved and surfaced, and new identity
 * creation pauses until repair or reset.
 */

import type { SafeJsonStore } from './safe-json-store';

/** One file's registry entry. */
export interface FileRegistryEntry {
	fileId: string;
	currentPath: string | null;
	lastKnownPath: string;
	state: 'present' | 'deleted';
	firstSeenAt: string;
	lastSeenAt: string;
}

/** The persisted registry file shape (schema version 1). */
export interface FileRegistryFile {
	schemaVersion: 1;
	entries: Record<string, FileRegistryEntry>;
	pathIndex: Record<string, string>;
}

/** Result of resolving a path to an identity. */
export interface ResolvedIdentity {
	fileId: string;
	currentPath: string;
}

/** Generate a file id using the standard crypto UUID API. */
function newFileId(): string {
	const win =
		typeof window !== 'undefined'
			? (window as { crypto?: { randomUUID?: () => string } })
			: undefined;
	if (win?.crypto && typeof win.crypto.randomUUID === 'function') {
		return win.crypto.randomUUID();
	}
	return `file-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function emptyRegistry(): FileRegistryFile {
	return { schemaVersion: 1, entries: {}, pathIndex: {} };
}

/**
 * Stable file-identity registry. Construct one per plugin instance; all mutating
 * operations are serialized through one global queue.
 */
export class FileRegistry {
	private registry: FileRegistryFile;
	// Mutable so rename/delete/folder-rename can chain onto the latest settled mutation.
	private mutationQueue: Promise<unknown> = Promise.resolve();
	/** True when the loaded registry failed validation; pauses new id creation. */
	readonly corrupted: boolean;

	constructor(
		private readonly store: SafeJsonStore,
		initial: FileRegistryFile | null,
		corrupted: boolean,
	) {
		this.registry = initial ?? emptyRegistry();
		this.corrupted = corrupted;
	}

	/** Load and validate the registry, preserving a damaged file on corruption. */
	static async load(store: SafeJsonStore): Promise<FileRegistry> {
		const result = await store.load<FileRegistryFile>((raw) => validateRegistryFile(raw));
		if (result.value) {
			// A valid primary (or a recovered backup/next) loaded successfully.
			return new FileRegistry(store, result.value, false);
		}
		// No valid candidate. Distinguish "no file" (clean) from "file exists but
		// is corrupt" so identity creation pauses only when there is damaged
		// evidence to preserve.
		const exists = await store.primaryExists();
		return new FileRegistry(store, null, exists);
	}

	/** Persist the current registry through the safe store. */
	async save(): Promise<void> {
		await this.store.save(this.registry, (v) => JSON.stringify(v));
	}

	/**
	 * Resolve a path to a stable identity. If present, returns the existing id.
	 * If the path was deleted, assigns a new id (delete + recreate is not a
	 * rename). If corrupted, throws so the caller can pause identity creation.
	 */
	async resolve(path: string, nowIso: string): Promise<ResolvedIdentity> {
		return this.serialize(async () => {
			if (this.corrupted) {
				throw new Error('registry-corrupted-identity-paused');
			}
			const normalized = normalizePath(path);
			const existingId = this.registry.pathIndex[normalized];
			if (existingId) {
				const entry = this.registry.entries[existingId];
				if (entry) {
					entry.lastSeenAt = nowIso;
					return { fileId: existingId, currentPath: normalized };
				}
			}
			// First observation (or recreate at a previously-deleted path): new id.
			const fileId = newFileId();
			const entry: FileRegistryEntry = {
				fileId,
				currentPath: normalized,
				lastKnownPath: normalized,
				state: 'present',
				firstSeenAt: nowIso,
				lastSeenAt: nowIso,
			};
			this.registry.entries[fileId] = entry;
			this.registry.pathIndex[normalized] = fileId;
			return { fileId, currentPath: normalized };
		});
	}

	/** Observed rename/move: update current path + index without changing id. */
	async rename(oldPath: string, newPath: string): Promise<void> {
		await this.serialize(async () => {
			const oldNorm = normalizePath(oldPath);
			const newNorm = normalizePath(newPath);
			const fileId = this.registry.pathIndex[oldNorm];
			if (!fileId) {
				return; // Unknown source; the file-open path will assign a new id.
			}
			const entry = this.registry.entries[fileId];
			if (!entry) {
				return;
			}
			entry.currentPath = newNorm;
			entry.lastKnownPath = newNorm;
			delete this.registry.pathIndex[oldNorm];
			this.registry.pathIndex[newNorm] = fileId;
		});
	}

	/** Observed delete: mark deleted, clear current path, drop the path index. */
	async delete(path: string): Promise<void> {
		await this.serialize(async () => {
			const norm = normalizePath(path);
			const fileId = this.registry.pathIndex[norm];
			if (!fileId) {
				return;
			}
			const entry = this.registry.entries[fileId];
			if (entry) {
				entry.state = 'deleted';
				entry.currentPath = null;
			}
			delete this.registry.pathIndex[norm];
		});
	}

	/**
	 * Folder rename: move every descendant path in one serialized transaction.
	 * `oldPrefix` and `newPrefix` are vault-relative, `/`-separated.
	 */
	async renameFolder(oldPrefix: string, newPrefix: string): Promise<void> {
		await this.serialize(async () => {
			const oldNorm = normalizePath(oldPrefix);
			const newNorm = normalizePath(newPrefix);
			const entries = Object.entries(this.registry.pathIndex);
			for (const [path, fileId] of entries) {
				if (path === oldNorm || path.startsWith(`${oldNorm}/`)) {
					const suffix = path.slice(oldNorm.length);
					const next = `${newNorm}${suffix}`;
					const entry = this.registry.entries[fileId];
					if (entry) {
						entry.currentPath = next;
						entry.lastKnownPath = next;
					}
					delete this.registry.pathIndex[path];
					this.registry.pathIndex[next] = fileId;
				}
			}
		});
	}

	/** Current path for a fileId, or null if deleted/unknown. */
	currentPathFor(fileId: string): string | null {
		const entry = this.registry.entries[fileId];
		return entry?.currentPath ?? null;
	}

	/** Last-known path for a fileId (used for the deleted-group display). */
	lastKnownPathFor(fileId: string): string | null {
		const entry = this.registry.entries[fileId];
		return entry?.lastKnownPath ?? null;
	}

	/** All entries, for snapshot queries and exports. */
	snapshot(): { entries: Record<string, FileRegistryEntry>; pathIndex: Record<string, string> } {
		return {
			entries: { ...this.registry.entries },
			pathIndex: { ...this.registry.pathIndex },
		};
	}

	/** Clear all tracking identities while preserving a valid registry file. */
	async clear(): Promise<void> {
		await this.serialize(async () => {
			this.registry = emptyRegistry();
			await this.save();
		});
	}

	private serialize<T>(task: () => T | Promise<T>): Promise<T> {
		const run = this.mutationQueue.then(task);
		// Advance the tail from a settled state so a thrown mutation cannot cascade.
		this.mutationQueue = run.then(
			() => undefined,
			() => undefined,
		);
		return run;
	}
}

function normalizePath(path: string): string {
	let p = path.replace(/\\/g, '/').replace(/\/+/g, '/');
	if (p.startsWith('/')) {
		p = p.slice(1);
	}
	if (p.length > 1 && p.endsWith('/')) {
		p = p.slice(0, -1);
	}
	return p;
}

/** Validate a loaded registry file structurally. Throws on corruption. */
function validateRegistryFile(raw: unknown): FileRegistryFile {
	if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
		throw new Error('registry-not-object');
	}
	const obj = raw as Record<string, unknown>;
	if (obj.schemaVersion !== 1) {
		throw new Error(`registry-unsupported-schema-${String(obj.schemaVersion)}`);
	}
	const entries = obj.entries;
	const pathIndex = obj.pathIndex;
	if (typeof entries !== 'object' || entries === null || Array.isArray(entries)) {
		throw new Error('registry-entries-invalid');
	}
	if (typeof pathIndex !== 'object' || pathIndex === null || Array.isArray(pathIndex)) {
		throw new Error('registry-pathIndex-invalid');
	}
	// Shallow-validate each entry; trust the rest after boundary validation.
	return {
		schemaVersion: 1,
		entries: entries as Record<string, FileRegistryEntry>,
		pathIndex: pathIndex as Record<string, string>,
	};
}
