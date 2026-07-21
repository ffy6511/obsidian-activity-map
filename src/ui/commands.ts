import type { Plugin } from 'obsidian';

import type { ActivityMapController } from './activity-map-controller';

export function registerActivityMapCommands(
	plugin: Plugin,
	controller: ActivityMapController,
	openView: () => Promise<void>,
): void {
	plugin.addCommand({ id: 'open-view', name: 'Open view', callback: () => void openView() });
	plugin.addCommand({ id: 'pause-tracking', name: 'Pause tracking', callback: () => void controller.dispatch({ kind: 'pause' }) });
	plugin.addCommand({ id: 'resume-tracking', name: 'Resume tracking', callback: () => void controller.dispatch({ kind: 'resume' }) });
	plugin.addCommand({
		id: 'previous-day',
		name: 'Previous day',
		callback: () => void shiftDay(controller, -1),
	});
	plugin.addCommand({
		id: 'next-day',
		name: 'Next day',
		callback: () => void shiftDay(controller, 1),
	});
}

async function shiftDay(controller: ActivityMapController, amount: number): Promise<void> {
	const range = controller.getViewModel().query.range;
	if (range.mode !== 'day') return;
	const date = new Date(`${range.localDate}T00:00:00.000Z`);
	date.setUTCDate(date.getUTCDate() + amount);
	await controller.dispatch({ kind: 'set-range', range: { mode: 'day', localDate: date.toISOString().slice(0, 10) } });
}
