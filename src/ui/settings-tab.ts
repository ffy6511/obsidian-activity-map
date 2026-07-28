import { PluginSettingTab, Setting, type App, type SettingDefinitionItem } from 'obsidian';

import {
	normalizeHeaderPopoverActionLayout,
	type HeaderPopoverActionLayoutItem,
} from '../domain/header-popover-action-layout';
import type { ActivityMapSettings } from '../domain/settings';
import {
	renderHeaderPopoverActionLayoutEditor,
	type HeaderPopoverActionLayoutEditorHandle,
} from './components/header-popover-action-layout-editor';
import type { ActivityMapController } from './activity-map-controller';

/** Settings controls persist through the controller before affecting runtime. */
export class ActivityMapSettingsTab extends PluginSettingTab {
	private actionLayoutEditor: HeaderPopoverActionLayoutEditorHandle | null = null;
	private actionLayoutDraft: HeaderPopoverActionLayoutItem[] | null = null;
	private actionLayoutSaving = false;

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
		this.destroyActionLayoutEditor();
		this.containerEl.empty();
		const settings = this.controller.getViewModel().settings;
		new Setting(this.containerEl)
			.setName('Tracking')
			.setDesc('Attribute activity to the foreground vault file.')
			.addToggle((toggle) =>
				toggle.setValue(settings.trackingEnabled).onChange((value) => {
					void this.save({ trackingEnabled: value });
				}),
			);
		let paused = this.controller.getViewModel().tracking?.state === 'paused';
		new Setting(this.containerEl)
			.setName('Manual pause')
			.setDesc('Pause attribution without changing or deleting recorded history.')
			.addButton((button) =>
				button.setButtonText(paused ? 'Resume tracking' : 'Pause tracking').onClick(() => {
					void this.controller
						.dispatch({ kind: paused ? 'resume' : 'pause' })
						.then(() => {
							paused = !paused;
							button.setButtonText(paused ? 'Resume tracking' : 'Pause tracking');
						});
				}),
			);
		this.numberSetting(
			'Idle threshold',
			'Seconds before activity is clipped.',
			settings.idleThresholdMs / 1000,
			30,
			1800,
			(value) => ({ idleThresholdMs: value * 1000 }),
		);
		this.numberSetting(
			'Recovery limit',
			'Minutes up to which an uncertain idle gap can be reviewed.',
			settings.recoveryLimitMs / 60_000,
			1,
			1440,
			(value) => ({ recoveryLimitMs: value * 60_000 }),
		);
		this.numberSetting(
			'Edit silence',
			'Seconds after the last edit before a burst closes.',
			settings.editSilenceMs / 1000,
			5,
			120,
			(value) => ({ editSilenceMs: value * 1000 }),
		);
		this.numberSetting(
			'Raw retention',
			'Days to retain raw sessions after a verified summary exists.',
			settings.rawRetentionDays,
			1,
			3650,
			(value) => ({ rawRetentionDays: value }),
		);
		this.numberSetting(
			'Maximum chart items',
			'Independent slices shown before smaller items are grouped.',
			settings.maxChartItems,
			1,
			32,
			(value) => ({ maxChartItems: value }),
		);
		new Setting(this.containerEl)
			.setName('Default average window')
			.setDesc('Default natural-day window for average views.')
			.addDropdown((dropdown) =>
				dropdown
					.addOptions({
						'7': '7 days',
						'30': '30 days',
						'90': '90 days',
						all: 'All history',
					})
					.setValue(String(settings.averageWindowDays))
					.onChange(
						(value) =>
							void this.save({
								averageWindowDays:
									value === 'all' ? 'all' : (Number(value) as 7 | 30 | 90),
							}),
					),
			);
		new Setting(this.containerEl)
			.setName('Excluded paths')
			.setDesc(
				'One vault-relative glob per line. Mandatory plugin-data exclusions always apply.',
			)
			.addTextArea((text) =>
				text.setValue(settings.excludedPathGlobs.join('\n')).onChange((value) => {
					void this.save({
						excludedPathGlobs: value
							.split('\n')
							.map((item) => item.trim())
							.filter(Boolean),
					});
				}),
			);
		this.renderHeaderPopoverActionLayout(settings);
		this.containerEl.createEl('p', {
			text: 'All activity data stays in this vault configuration directory. Activity map has no account, telemetry, or network upload.',
			cls: 'setting-item-description',
		});
	}

	override hide(): void {
		this.destroyActionLayoutEditor();
		super.hide();
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
			.addText((text) =>
				text.setValue(String(value)).onChange((raw) => {
					const parsed = Number(raw);
					if (Number.isFinite(parsed) && parsed >= min && parsed <= max)
						void this.save(patch(parsed));
				}),
			);
	}

	private async save(patch: Partial<ActivityMapSettings>): Promise<void> {
		await this.controller.dispatch({ kind: 'update-settings', patch });
	}

	private renderHeaderPopoverActionLayout(settings: ActivityMapSettings): void {
		const section = this.containerEl.createDiv({
			cls: 'activity-map-action-layout-settings-section',
		});
		new Setting(section).setName('Header popover controls').setHeading();
		section.createEl('p', {
			text: 'Drag controls to reorder them, move them across the fixed date navigation, or drop them below to disable them.',
			cls: 'setting-item-description',
		});
		this.actionLayoutDraft = normalizeHeaderPopoverActionLayout(
			settings.headerPopoverActionLayout,
		);
		const editorHost = section.createDiv({ cls: 'activity-map-action-layout-settings-editor' });
		this.actionLayoutEditor = renderHeaderPopoverActionLayoutEditor({
			container: editorHost,
			layout: this.actionLayoutDraft,
			onChange: (layout) => {
				this.actionLayoutDraft = layout;
			},
		});

		const actions = section.createDiv({ cls: 'activity-map-action-layout-settings-actions' });
		const status = section.createEl('p', {
			cls: 'activity-map-action-layout-settings-status',
			attr: { 'aria-live': 'polite', 'aria-atomic': 'true' },
		});
		const cancel = actions.createEl('button', { text: 'Cancel', attr: { type: 'button' } });
		const save = actions.createEl('button', {
			text: 'Save',
			cls: 'mod-cta',
			attr: { type: 'button' },
		});
		cancel.addEventListener('click', () => {
			if (this.actionLayoutSaving) return;
			this.resetActionLayoutDraft(status);
		});
		save.addEventListener('click', () => {
			void this.saveActionLayout(save, cancel, status);
		});
	}

	private async saveActionLayout(
		save: HTMLButtonElement,
		cancel: HTMLButtonElement,
		status: HTMLElement,
	): Promise<void> {
		const draft = this.actionLayoutDraft;
		if (!draft || this.actionLayoutSaving) return;
		const committed = this.controller.getViewModel().settings.headerPopoverActionLayout;
		if (sameActionLayout(draft, committed)) {
			status.textContent = 'No header popover control changes to save.';
			return;
		}
		this.actionLayoutSaving = true;
		save.disabled = true;
		cancel.disabled = true;
		this.actionLayoutEditor?.setDisabled(true);
		try {
			await this.controller.dispatch({
				kind: 'update-settings',
				patch: { headerPopoverActionLayout: draft },
			});
			this.actionLayoutDraft = normalizeHeaderPopoverActionLayout(
				this.controller.getViewModel().settings.headerPopoverActionLayout,
			);
			this.actionLayoutEditor?.setLayout(this.actionLayoutDraft);
			status.textContent = 'Saved header popover controls.';
		} catch (error) {
			status.textContent = `Could not save Header Popover controls: ${messageForError(error)}. Retry or Cancel.`;
		} finally {
			this.actionLayoutSaving = false;
			save.disabled = false;
			cancel.disabled = false;
			this.actionLayoutEditor?.setDisabled(false);
		}
	}

	private resetActionLayoutDraft(status: HTMLElement): void {
		this.actionLayoutDraft = normalizeHeaderPopoverActionLayout(
			this.controller.getViewModel().settings.headerPopoverActionLayout,
		);
		this.actionLayoutEditor?.setLayout(this.actionLayoutDraft);
		status.textContent = 'Discarded unsaved header popover control changes.';
	}

	private destroyActionLayoutEditor(): void {
		this.actionLayoutEditor?.destroy();
		this.actionLayoutEditor = null;
		this.actionLayoutDraft = null;
		this.actionLayoutSaving = false;
	}
}

function sameActionLayout(
	left: readonly HeaderPopoverActionLayoutItem[],
	right: readonly HeaderPopoverActionLayoutItem[],
): boolean {
	return (
		left.length === right.length &&
		left.every(
			(item, index) =>
				item.id === right[index]?.id &&
				item.side === right[index]?.side &&
				item.order === right[index]?.order &&
				item.enabled === right[index]?.enabled,
		)
	);
}

function messageForError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
