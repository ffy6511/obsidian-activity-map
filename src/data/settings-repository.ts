/**
 * Settings repository.
 *
 * Settings use Obsidian `loadData()` / `saveData()` only (small data, frequent
 * reads). The repository normalizes persisted JSON into trusted settings,
 * assigns a stable device ID on first load, and serializes writes so an earlier
 * slow save cannot overwrite a later value. Numeric ranges are enforced by
 * {@link normalizeSettings}, never trusted from cast JSON.
 */

import {
	normalizeSettings,
	type ActivityMapSettings,
} from '../domain/settings';

/** Minimal plugin surface the repository needs; Obsidian's Plugin satisfies this. */
export interface SettingsStore {
	loadData(): Promise<unknown>;
	saveData(data: unknown): Promise<void>;
}

/** Result of loading settings, including whether a device id was just assigned. */
export interface LoadSettingsResult {
	settings: ActivityMapSettings;
	deviceIdAssigned: boolean;
}

/** Generate a fresh device id using the standard crypto UUID API. */
function newDeviceId(): string {
	// Prefer the Web Crypto `randomUUID` available in Obsidian's desktop and
	// mobile runtimes via window.crypto. Older or non-secure runtimes (and the
	// Node-based test harness, where window is absent) fall back to a
	// timestamp+random form. Both are opaque device identifiers; only the
	// runtime needs them to be unique, not cryptographically strong.
	const win = typeof window !== 'undefined' ? (window as { crypto?: { randomUUID?: () => string } }) : undefined;
	if (win?.crypto && typeof win.crypto.randomUUID === 'function') {
		return win.crypto.randomUUID();
	}
	return `dev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Serialized settings repository. Construct one per plugin instance.
 */
export class SettingsRepository {
	private current: ActivityMapSettings | null = null;
	// Mutable so update() can chain onto the latest settled save.
	private writeQueue: Promise<unknown> = Promise.resolve();

	constructor(
		private readonly store: SettingsStore,
	) {}

	/** Load, normalize, and (if needed) assign the device id. */
	async load(): Promise<LoadSettingsResult> {
		const raw = await this.store.loadData();
		const normalized = normalizeSettings(raw);
		let deviceIdAssigned = false;
		if (!normalized.deviceId) {
			normalized.deviceId = newDeviceId();
			deviceIdAssigned = true;
			// Persist the assigned id immediately so a second device shard is not
			// created on the next load.
			await this.serializeSave(normalized);
		}
		this.current = normalized;
		return { settings: normalized, deviceIdAssigned };
	}

	/** Current effective settings (or null before load). */
	get(): ActivityMapSettings | null {
		return this.current;
	}

	/**
	 * Apply a partial update: merge, normalize, persist, and return the new
	 * effective settings. A failed save leaves the previous effective value.
	 */
	async update(patch: Partial<ActivityMapSettings>): Promise<ActivityMapSettings> {
		const base = this.current ?? normalizeSettings(null);
		const merged = normalizeSettings({ ...base, ...patch, deviceId: base.deviceId });
		await this.serializeSave(merged);
		this.current = merged;
		return merged;
	}

	private async serializeSave(settings: ActivityMapSettings): Promise<void> {
		const run = this.writeQueue.then(() => this.store.saveData(settings));
		this.writeQueue = run.catch(() => undefined);
		await run;
	}
}
