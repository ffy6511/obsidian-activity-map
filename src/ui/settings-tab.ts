import { PluginSettingTab, Setting, type App, type SettingDefinitionItem } from 'obsidian';

import type { ActivityMapController } from './activity-map-controller';
import type { ActivityMapSettings } from '../domain/settings';

/** Settings controls persist through the controller before affecting runtime. */
export class ActivityMapSettingsTab extends PluginSettingTab {
	constructor(
		app: App,
		plugin: ConstructorParameters<typeof PluginSettingTab>[1],
		private readonly controller: ActivityMapController,
	) {
		super(app, plugin);
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		// Values are persisted asynchronously before runtime application, which
		// the imperative controls below express more precisely than static items.
		return [];
	}

	display(): void {
		this.containerEl.empty();
		const settings = this.controller.getViewModel().settings;
		new Setting(this.containerEl)
			.setName('Tracking')
			.setDesc('Attribute activity to the foreground vault file.')
			.addToggle((toggle) => toggle.setValue(settings.trackingEnabled).onChange((value) => {
				void this.save({ trackingEnabled: value });
			}));
		this.numberSetting('Idle threshold', 'Seconds before activity is clipped.', settings.idleThresholdMs / 1000, 30, 1800, (value) => ({ idleThresholdMs: value * 1000 }));
		this.numberSetting('Edit silence', 'Seconds after the last edit before a burst closes.', settings.editSilenceMs / 1000, 5, 120, (value) => ({ editSilenceMs: value * 1000 }));
		this.numberSetting('Raw retention', 'Days to retain raw sessions after a verified summary exists.', settings.rawRetentionDays, 1, 3650, (value) => ({ rawRetentionDays: value }));
		new Setting(this.containerEl)
			.setName('Excluded paths')
			.setDesc('One vault-relative glob per line. Mandatory plugin-data exclusions always apply.')
			.addTextArea((text) => text.setValue(settings.excludedPathGlobs.join('\n')).onChange((value) => {
				void this.save({ excludedPathGlobs: value.split('\n').map((item) => item.trim()).filter(Boolean) });
			}));
	}

	private numberSetting(
		name: string,
		description: string,
		value: number,
		min: number,
		max: number,
		patch: (value: number) => Partial<ActivityMapSettings>,
	): void {
		new Setting(this.containerEl)
			.setName(name)
			.setDesc(description)
			.addText((text) => text.setValue(String(value)).onChange((raw) => {
				const parsed = Number(raw);
				if (Number.isFinite(parsed) && parsed >= min && parsed <= max) void this.save(patch(parsed));
			}));
	}

	private async save(patch: Partial<ActivityMapSettings>): Promise<void> {
		await this.controller.dispatch({ kind: 'update-settings', patch });
	}
}
