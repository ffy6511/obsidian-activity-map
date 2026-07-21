/**
 * Activity Map-owned storage paths.
 *
 * The physical root is the Activity Map plugin directory below Obsidian's
 * configured vault configuration directory. `.obsidian` is never hard-coded:
 * the config directory may have a custom name. Every adapter path is resolved
 * from the configured plugin root and normalized to `/` for cross-platform
 * consistency.
 *
 * The path layer is the single place that knows the on-disk layout. Everything
 * else asks for a logical path (`sessions`, `daily`, `checkpoint`) and never
 * constructs plugin-owned paths itself.
 */

/**
 * Minimal adapter surface the path layer needs. Obsidian's `DataAdapter`
 * satisfies this; tests inject a fake. Keeping it narrow means the layout is
 * testable without importing Obsidian types here.
 */
export interface PathAdapter {
	/** Full path to the plugin's config directory (e.g. "<vault>/.obsidian"). */
	configDir: string;
	/** Normalize an adapter-specific path to a canonical form. */
	normalize(path: string): string;
	/** Join path segments using the adapter's separator. */
	join(...segments: string[]): string;
	/** Full path to the plugin manifest (provides manifest.dir on desktop). */
	manifestPath?: string;
}

/** Plugin id; must match manifest.json. */
const PLUGIN_ID = 'activity-map';

/** Logical, layout-owned subdirectories under the plugin data root. */
export const DATA_SUBDIR = 'data';
export const SESSIONS_SUBDIR = 'sessions';
export const DAILY_SUBDIR = 'daily';
export const CHECKPOINT_FILE = 'checkpoint.json';
export const FILES_FILE = 'files.json';
export const SETTINGS_FILE = 'data.json';

/**
 * Resolves the plugin root directory from the adapter. Prefers `manifest.dir`
 * (the desktop-provided exact location) and falls back to `configDir/plugins/<id>`.
 * The config directory name is never assumed to be `.obsidian`.
 */
export function resolvePluginRoot(adapter: PathAdapter): string {
	// manifestPath like "<config>/plugins/activity-map/manifest.json" -> its dir.
	if (adapter.manifestPath) {
		const normalized = adapter.normalize(adapter.manifestPath);
		const slash = normalized.lastIndexOf('/');
		if (slash > 0) {
			return normalized.slice(0, slash);
		}
	}
	return adapter.normalize(adapter.join(adapter.configDir, 'plugins', PLUGIN_ID));
}

/** The plugin's data root: `<pluginRoot>/data`. */
export function dataRoot(adapter: PathAdapter): string {
	return adapter.normalize(adapter.join(resolvePluginRoot(adapter), DATA_SUBDIR));
}

/** Path to the in-flight checkpoint file. */
export function checkpointPath(adapter: PathAdapter): string {
	return adapter.normalize(adapter.join(dataRoot(adapter), CHECKPOINT_FILE));
}

/** Path to the stable file registry. */
export function filesRegistryPath(adapter: PathAdapter): string {
	return adapter.normalize(adapter.join(dataRoot(adapter), FILES_FILE));
}

/** Path to a device/date session shard: `data/sessions/<deviceId>/<date>.ndjson`. */
export function sessionShardPath(
	adapter: PathAdapter,
	deviceId: string,
	localDate: string,
): string {
	return adapter.normalize(
		adapter.join(dataRoot(adapter), SESSIONS_SUBDIR, deviceId, `${localDate}.ndjson`),
	);
}

/** Path to a device/date daily summary: `data/daily/<deviceId>/<date>.json`. */
export function dailySummaryPath(
	adapter: PathAdapter,
	deviceId: string,
	localDate: string,
): string {
	return adapter.normalize(
		adapter.join(dataRoot(adapter), DAILY_SUBDIR, deviceId, `${localDate}.json`),
	);
}

/** Directory containing all session shards for a device. */
export function sessionsDir(adapter: PathAdapter, deviceId: string): string {
	return adapter.normalize(adapter.join(dataRoot(adapter), SESSIONS_SUBDIR, deviceId));
}

/** Directory containing all daily summaries for a device. */
export function dailyDir(adapter: PathAdapter, deviceId: string): string {
	return adapter.normalize(adapter.join(dataRoot(adapter), DAILY_SUBDIR, deviceId));
}

/**
 * Normalize a vault-relative path to canonical `/`-separated form. Used before
 * glob matching and identity lookups so paths are comparable cross-platform.
 */
export function normalizeVaultPath(path: string): string {
	// Collapse backslashes (Windows adapters) and repeated separators, strip
	// a leading slash, and trim trailing separators.
	let p = path.replace(/\\/g, '/').replace(/\/+/g, '/');
	if (p.startsWith('/')) {
		p = p.slice(1);
	}
	if (p.length > 1 && p.endsWith('/')) {
		p = p.slice(0, -1);
	}
	return p;
}

/**
 * The mandatory-excluded root prefixes. The config directory, plugin root, and
 * Activity Map data area are always excluded and cannot be removed by user
 * settings. Expressed as vault-relative prefixes derived from the adapter so a
 * custom config-directory name is honored.
 */
export function mandatoryExcludedPrefixes(adapter: PathAdapter): string[] {
	const config = normalizeVaultPath(adapter.configDir);
	const pluginRoot = normalizeVaultPath(resolvePluginRoot(adapter));
	// Avoid duplicates when configDir already contains the plugin root.
	const set = new Set<string>([config, pluginRoot]);
	return [...set].sort();
}
