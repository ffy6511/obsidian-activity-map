import { describe, expect, it } from '../helpers/test-harness';

import { SettingsRepository, type SettingsStore } from '../../src/data/settings-repository';
import { DEFAULT_SETTINGS } from '../../src/domain/settings';

/** In-memory SettingsStore mirroring Obsidian Plugin loadData/saveData. */
function memoryStore(): SettingsStore & { data: unknown } {
	const state: { data: unknown } = { data: null };
	const store = {
		async loadData() {
			return state.data;
		},
		async saveData(data: unknown) {
			state.data = data;
		},
	};
	return Object.assign(store, {
		get data() {
			return state.data;
		},
		set data(value: unknown) {
			state.data = value;
		},
	});
}

describe('settings repository load', () => {
	it('returns defaults when no settings are persisted', async () => {
		const store = memoryStore();
		const repo = new SettingsRepository(store);
		const { settings, deviceIdAssigned } = await repo.load();
		expect(settings.idleThresholdMs).toBe(DEFAULT_SETTINGS.idleThresholdMs);
		expect(settings.trackingEnabled).toBeTrue();
		expect(settings.headerPopoverGrouping).toBe('path');
		expect(deviceIdAssigned).toBeTrue();
		expect(settings.deviceId).toBeDefined();
	});

	it('persists an assigned device id so a second load is stable', async () => {
		const store = memoryStore();
		const repo = new SettingsRepository(store);
		const first = await repo.load();
		const firstId = first.settings.deviceId;
		const repo2 = new SettingsRepository(store);
		const second = await repo2.load();
		expect(second.settings.deviceId).toBe(firstId);
		expect(second.deviceIdAssigned).toBeFalse();
	});

	it('normalizes invalid numeric ranges back to defaults', async () => {
		const store = memoryStore();
		store.data = {
			deviceId: 'dev',
			idleThresholdMs: 5, // below the 30s minimum
			editSilenceMs: 999_999, // above the 120s maximum
			averageWindowDays: 'bogus',
			headerPopoverGrouping: 'bogus',
		};
		const repo = new SettingsRepository(store);
		const { settings } = await repo.load();
		expect(settings.idleThresholdMs).toBe(DEFAULT_SETTINGS.idleThresholdMs);
		expect(settings.editSilenceMs).toBe(DEFAULT_SETTINGS.editSilenceMs);
		expect(settings.averageWindowDays).toBe(DEFAULT_SETTINGS.averageWindowDays);
		expect(settings.headerPopoverGrouping).toBe('path');
	});
});

describe('settings repository update', () => {
	it('applies a partial patch and persists the merged result', async () => {
		const store = memoryStore();
		const repo = new SettingsRepository(store);
		await repo.load();
		const updated = await repo.update({ idleThresholdMs: 60_000 });
		expect(updated.idleThresholdMs).toBe(60_000);
		expect(repo.get()?.idleThresholdMs).toBe(60_000);
		// A new repository sees the persisted value.
		const repo2 = new SettingsRepository(store);
		const reloaded = await repo2.load();
		expect(reloaded.settings.idleThresholdMs).toBe(60_000);
	});

	it('persists the Header Popover grouping preference across repository reloads', async () => {
		const store = memoryStore();
		const repo = new SettingsRepository(store);
		await repo.load();
		await repo.update({ headerPopoverGrouping: 'file' });
		const reloaded = await new SettingsRepository(store).load();
		expect(reloaded.settings.headerPopoverGrouping).toBe('file');
	});

	it('a failed save leaves the previous effective value', async () => {
		const failingStore: SettingsStore = {
			async loadData() {
				return { deviceId: 'dev' };
			},
			async saveData() {
				throw new Error('save-failed');
			},
		};
		const repo = new SettingsRepository(failingStore);
		await repo.load();
		const before = repo.get()?.idleThresholdMs;
		let threw = false;
		try {
			await repo.update({ idleThresholdMs: 90_000 });
		} catch {
			threw = true;
		}
		expect(threw).toBeTrue();
		expect(repo.get()?.idleThresholdMs).toBe(before);
	});

	it('clamps out-of-range patches into the documented ranges', async () => {
		const store = memoryStore();
		const repo = new SettingsRepository(store);
		await repo.load();
		const updated = await repo.update({ idleThresholdMs: 1 });
		// 1ms clamps up to the 30s minimum.
		expect(updated.idleThresholdMs).toBe(30_000);
	});
});
