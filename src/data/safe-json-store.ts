/**
 * Recoverable JSON store.
 *
 * Replaceable JSON files (settings, registry, checkpoint, summaries) are written
 * through a sibling `.next`, validated after write, preserved as `.bak`, then
 * promoted. Startup selects the newest valid primary/backup candidate and
 * reports any recovery. Mutation is serialized per owned path so two writers
 * cannot interleave.
 *
 * The store uses only public `DataAdapter`-shaped operations, abstracted behind
 * {@link JsonFileAdapter} so tests can inject failures.
 */

/** Minimal file operations the store needs. Obsidian's DataAdapter satisfies this. */
export interface JsonFileAdapter {
	read(path: string): Promise<string>;
	write(path: string, contents: string): Promise<void>;
	exists(path: string): Promise<boolean>;
	remove(path: string): Promise<void>;
	rename(from: string, to: string): Promise<void>;
}

/** Result of a load attempt, distinguishing a clean read from a recovery. */
export interface LoadResult<T> {
	value: T | null;
	recovered: boolean;
	reason?: string;
}

/**
 * Serialized, recoverable JSON store for one owned path. Construct one instance
 * per owned file; never share across unrelated paths.
 */
export class SafeJsonStore {
	// Mutable so save()/removeAll() can chain onto the latest settled write.
	private writeQueue: Promise<unknown> = Promise.resolve();

	constructor(
		private readonly adapter: JsonFileAdapter,
		private readonly path: string,
	) {}

	private get nextPath(): string {
		return `${this.path}.next`;
	}

	private get bakPath(): string {
		return `${this.path}.bak`;
	}

	/**
	 * Load the newest valid candidate (primary, else backup, else `.next`).
	 * Returns null when no candidate exists. `recovered` is true when the
	 * primary was unusable and a backup/next was used instead.
	 */
	async load<T>(validate: (raw: unknown) => T): Promise<LoadResult<T>> {
		const primary = await this.tryRead(this.path, validate);
		if (primary.ok) {
			return { value: primary.value, recovered: false };
		}
		const bak = await this.tryRead(this.bakPath, validate);
		if (bak.ok) {
			return { value: bak.value, recovered: true, reason: 'primary-invalid' };
		}
		const next = await this.tryRead(this.nextPath, validate);
		if (next.ok) {
			return { value: next.value, recovered: true, reason: 'next-promoted' };
		}
		return { value: null, recovered: false };
	}

	/**
	 * Write `value` through the recoverable protocol, serialized per path.
	 * Resolves only after the promoted primary has been verified readable.
	 */
	async save(value: unknown, serialize: (value: unknown) => string): Promise<void> {
		// Serialize per owned path so an earlier slow save cannot overwrite a
		// later one and two writers cannot interleave bytes.
		const run = this.writeQueue.then(async () => {
			const contents = serialize(value);
			await this.adapter.write(this.nextPath, contents);
			// Verify the .next is readable before promoting.
			const reread = await this.adapter.read(this.nextPath);
			if (reread !== contents) {
				throw new Error('safe-json-store-next-verify-failed');
			}
			// Preserve the previous primary (if any) as .bak before promotion.
			const primaryExists = await this.adapter.exists(this.path);
			if (primaryExists) {
				// Move existing primary to .bak, overwriting any stale backup.
				const previous = await this.adapter.read(this.path);
				await this.adapter.write(this.bakPath, previous);
			}
			// Promote .next to the primary. Some adapters support atomic rename;
			// others need write+remove. Try rename first, fall back to copy.
			try {
				await this.adapter.rename(this.nextPath, this.path);
			} catch {
				await this.adapter.write(this.path, contents);
				await this.adapter.remove(this.nextPath);
			}
			// Verify the promoted primary.
			const promoted = await this.adapter.read(this.path);
			if (promoted !== contents) {
				throw new Error('safe-json-store-promote-verify-failed');
			}
			// Cleanup the backup only after the primary is verified.
			if (await this.adapter.exists(this.bakPath)) {
				// Keep .bak intentionally: it is the recoverable previous copy and
				// is overwritten on the next save. Removing it would lose the only
				// fallback if the just-written primary later corrupts.
			}
		});
		this.writeQueue = run.catch(() => undefined);
		await run;
	}

	/** True when the primary path exists on disk (regardless of validity). */
	async primaryExists(): Promise<boolean> {
		return this.adapter.exists(this.path);
	}

	/** Remove the primary, next, and backup files (used by full deletion). */
	async removeAll(): Promise<void> {
		const run = this.writeQueue.then(async () => {
			for (const p of [this.path, this.nextPath, this.bakPath]) {
				if (await this.adapter.exists(p)) {
					await this.adapter.remove(p);
				}
			}
		});
		this.writeQueue = run.catch(() => undefined);
		await run;
	}

	private async tryRead<T>(
		path: string,
		validate: (raw: unknown) => T,
	): Promise<{ ok: true; value: T } | { ok: false }> {
		try {
			if (!(await this.adapter.exists(path))) {
				return { ok: false };
			}
			const text = await this.adapter.read(path);
			const parsed = JSON.parse(text) as unknown;
			return { ok: true, value: validate(parsed) };
		} catch {
			return { ok: false };
		}
	}
}
