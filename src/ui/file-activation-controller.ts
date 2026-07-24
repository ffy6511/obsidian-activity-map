import type { DistributionItem } from '../query/distribution-query';
import type { ChartActivationSource, ChartItem } from './components/donut-chart';
import { shouldOpenInNewTab, type FileActivationEvent } from './file-hover-preview';

export type FileChartActivation = 'arm' | 'open' | 'delegate';

/** True only for present file rows and slices; folders retain navigation semantics. */
export function isFileActivationItem(item: DistributionItem | ChartItem): boolean {
	return item.kind === 'file';
}

/**
 * Owns the one armed chart-file ID shared by both path and file groupings.
 * It contains interaction policy only; SummaryPopover owns DOM effects such as
 * scrolling, cursor state, and the instructional footer.
 */
export class FileActivationController {
	private armedItemId: string | null = null;

	activateChart(
		item: ChartItem,
		event: FileActivationEvent,
		source: ChartActivationSource,
	): FileChartActivation {
		if (!isFileActivationItem(item) || source === 'touch') return 'delegate';
		// SummaryPopover clears the arm and its matching DOM effects before the
		// workspace request. Keeping that effect at the presentation boundary means
		// an `open` result cannot leave a stale cursor or footer behind.
		if (shouldOpenInNewTab(event) || this.armedItemId === item.id) return 'open';
		this.armedItemId = item.id;
		return 'arm';
	}

	clear(expectedItemId?: string): boolean {
		if (expectedItemId && this.armedItemId !== expectedItemId) return false;
		if (this.armedItemId === null) return false;
		this.armedItemId = null;
		return true;
	}
}
