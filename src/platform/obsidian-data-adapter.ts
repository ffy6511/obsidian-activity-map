import type { DataAdapter, PluginManifest } from 'obsidian';
import { normalizePath } from 'obsidian';

import type { JsonFileAdapter } from '../data/safe-json-store';
import type { PathAdapter } from '../data/paths';
import type { ShardInventory } from '../data/retention-service';
import { dailyDir, sessionsDir } from '../data/paths';

/** Public-API adapter for Activity Map-owned plugin data. */
export class ObsidianDataAdapter implements JsonFileAdapter, PathAdapter {
	readonly configDir: string;
	readonly manifestPath: string | undefined;

	constructor(
		private readonly adapter: DataAdapter,
		manifest: PluginManifest,
		configDir: string,
	) {
		this.configDir = configDir;
		this.manifestPath = manifest.dir ? normalizePath(`${manifest.dir}/manifest.json`) : undefined;
	}

	normalize(path: string): string {
		return normalizePath(path);
	}

	join(...segments: string[]): string {
		return normalizePath(segments.filter(Boolean).join('/'));
	}

	read(path: string): Promise<string> {
		return this.adapter.read(this.normalize(path));
	}

	async write(path: string, contents: string): Promise<void> {
		const normalized = this.normalize(path);
		await this.ensureParent(normalized);
		await this.adapter.write(normalized, contents);
	}

	async append(path: string, contents: string): Promise<void> {
		const normalized = this.normalize(path);
		await this.ensureParent(normalized);
		await this.adapter.append(normalized, contents);
	}

	exists(path: string): Promise<boolean> {
		return this.adapter.exists(this.normalize(path));
	}

	remove(path: string): Promise<void> {
		return this.adapter.remove(this.normalize(path));
	}

	async rename(from: string, to: string): Promise<void> {
		const normalizedTo = this.normalize(to);
		await this.ensureParent(normalizedTo);
		await this.adapter.rename(this.normalize(from), normalizedTo);
	}

	async list(path: string): Promise<{ files: string[]; folders: string[] }> {
		return this.adapter.list(this.normalize(path));
	}

	private async ensureParent(path: string): Promise<void> {
		const slash = path.lastIndexOf('/');
		if (slash <= 0) return;
		const parent = path.slice(0, slash);
		const parts = parent.split('/');
		let cursor = '';
		for (const part of parts) {
			cursor = cursor ? `${cursor}/${part}` : part;
			if (!(await this.adapter.exists(cursor))) {
				await this.adapter.mkdir(cursor);
			}
		}
	}
}

/** Enumerates device/date shards without assuming a filesystem path API. */
export class ObsidianShardInventory implements ShardInventory {
	constructor(private readonly adapter: ObsidianDataAdapter) {}

	listSessionShards(): Promise<readonly { deviceId: string; localDate: string }[]> {
		return this.scan((deviceId) => sessionsDir(this.adapter, deviceId), 'ndjson');
	}

	listDailySummaries(): Promise<readonly { deviceId: string; localDate: string }[]> {
		return this.scan((deviceId) => dailyDir(this.adapter, deviceId), 'json');
	}

	private async scan(
		dirForDevice: (deviceId: string) => string,
		extension: 'ndjson' | 'json',
	): Promise<readonly { deviceId: string; localDate: string }[]> {
		const sampleDir = dirForDevice('_');
		const root = sampleDir.slice(0, sampleDir.lastIndexOf('/'));
		if (!(await this.adapter.exists(root))) return [];
		const devices = await this.adapter.list(root);
		const out: { deviceId: string; localDate: string }[] = [];
		for (const folder of devices.folders) {
			const deviceId = folder.slice(folder.lastIndexOf('/') + 1);
			const listing = await this.adapter.list(dirForDevice(deviceId));
			for (const file of listing.files) {
				const name = file.slice(file.lastIndexOf('/') + 1);
				if (name.endsWith(`.${extension}`)) {
					out.push({ deviceId, localDate: name.slice(0, -(extension.length + 1)) });
				}
			}
		}
		return out.sort((a, b) => `${a.deviceId}/${a.localDate}`.localeCompare(`${b.deviceId}/${b.localDate}`));
	}
}
