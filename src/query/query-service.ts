import type { DailySummaryRepository } from '../data/daily-summary-repository';
import type { FileRegistry } from '../data/file-registry';
import type { ShardInventory } from '../data/retention-service';
import type { ActivityMapSettings } from '../domain/settings';
import { resolveRange } from './date-range';
import { runDistributionQuery, type DistributionQuery, type DistributionResult } from './distribution-query';

/** Loads one consistent registry/summary snapshot for a distribution query. */
export class LocalQueryService {
	constructor(
		private readonly inventory: ShardInventory,
		private readonly summaries: DailySummaryRepository,
		private readonly registry: FileRegistry,
		private readonly getSettings: () => ActivityMapSettings,
	) {}

	async run(query: DistributionQuery): Promise<DistributionResult> {
		const available = await this.inventory.listDailySummaries();
		const recordedDates = [...new Set(available.map((item) => item.localDate))].sort();
		const resolved = resolveRange({ range: query.range, recordedDates });
		const contributing = new Set(resolved.dates);
		const loaded = [];
		for (const item of available) {
			if (!contributing.has(item.localDate)) continue;
			const summary = await this.summaries.load(item);
			if (summary) loaded.push({ summary });
		}
		return runDistributionQuery({
			query,
			resolved,
			summaries: loaded,
			registryEntries: this.registry.snapshot().entries,
			maxChartItems: this.getSettings().maxChartItems,
		});
	}
}
