/**
 * In-memory fake DataAdapter for persistence tests.
 *
 * Supports injected failure points so tests can simulate interrupted writes,
 * rename failures, and partial recovery deterministically. Mirrors the surface
 * the data layer consumes: {@link JsonFileAdapter} and {@link PathAdapter}.
 */

import type { JsonFileAdapter } from '../../src/data/safe-json-store';
import type { PathAdapter } from '../../src/data/paths';

export interface FakeDataAdapterOptions {
	/** Throw on the Nth call to a method (1-indexed). */
	fail?: {
		write?: number;
		append?: number;
		read?: number;
		rename?: number;
		remove?: number;
	};
	/** Force rename to fail always (simulates a non-atomic adapter). */
	renameUnsupported?: boolean;
	/** Config directory path; defaults to a neutral fixture root (see below). */
	configDir?: string;
}

/**
 * Fake adapter combining JsonFileAdapter and PathAdapter surfaces, backed by an
 * in-memory Map keyed by normalized path.
 */
export class FakeDataAdapter implements JsonFileAdapter, PathAdapter {
	private readonly files = new Map<string, string>();
	private readonly counters = { write: 0, append: 0, read: 0, rename: 0, remove: 0 };
	private readonly options: FakeDataAdapterOptions;

	constructor(options: FakeDataAdapterOptions = {}) {
		this.options = options;
	}

	get configDir(): string {
		// Default to a fixture-specific config root (not a real Obsidian path).
		return this.options.configDir ?? '/vault/.activity-map-test-config';
	}

	get manifestPath(): string | undefined {
		return `${this.configDir}/plugins/activity-map/manifest.json`;
	}

	normalize(path: string): string {
		return path.replace(/\\/g, '/').replace(/\/+/g, '/');
	}

	join(...segments: string[]): string {
		return segments.join('/').replace(/\/+/g, '/');
	}

	async exists(path: string): Promise<boolean> {
		return this.files.has(this.normalize(path));
	}

	async read(path: string): Promise<string> {
		this.counters.read += 1;
		if (this.shouldFail('read')) {
			throw new Error('injected-read-failure');
		}
		const normalized = this.normalize(path);
		const contents = this.files.get(normalized);
		if (contents === undefined) {
			throw new Error(`not-found: ${normalized}`);
		}
		return contents;
	}

	async write(path: string, contents: string): Promise<void> {
		this.counters.write += 1;
		if (this.shouldFail('write')) {
			throw new Error('injected-write-failure');
		}
		this.files.set(this.normalize(path), contents);
	}

	async append(path: string, contents: string): Promise<void> {
		this.counters.append += 1;
		if (this.shouldFail('append')) {
			throw new Error('injected-append-failure');
		}
		const normalized = this.normalize(path);
		this.files.set(normalized, `${this.files.get(normalized) ?? ''}${contents}`);
	}

	async remove(path: string): Promise<void> {
		this.counters.remove += 1;
		if (this.shouldFail('remove')) {
			throw new Error('injected-remove-failure');
		}
		this.files.delete(this.normalize(path));
	}

	async rename(from: string, to: string): Promise<void> {
		this.counters.rename += 1;
		if (this.options.renameUnsupported || this.shouldFail('rename')) {
			throw new Error('injected-rename-failure');
		}
		const normalizedFrom = this.normalize(from);
		const normalizedTo = this.normalize(to);
		const contents = this.files.get(normalizedFrom);
		if (contents === undefined) {
			throw new Error(`rename-source-not-found: ${normalizedFrom}`);
		}
		this.files.set(normalizedTo, contents);
		this.files.delete(normalizedFrom);
	}

	/** Direct in-memory read for test assertions (bypasses counters). */
	peek(path: string): string | undefined {
		return this.files.get(this.normalize(path));
	}

	/** Direct in-memory write for seeding fixtures. */
	seed(path: string, contents: string): void {
		this.files.set(this.normalize(path), contents);
	}

	/** Call counts per method, for assertion. */
	stats(): { write: number; append: number; read: number; rename: number; remove: number } {
		return { ...this.counters };
	}

	private shouldFail(method: 'write' | 'append' | 'read' | 'rename' | 'remove'): boolean {
		const threshold = this.options.fail?.[method];
		return threshold !== undefined && this.counters[method] >= threshold;
	}
}
