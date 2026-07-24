import type { DailySummaryRepository } from '../data/daily-summary-repository';
import type { FileRegistry } from '../data/file-registry';
import type { ShardInventory } from '../data/retention-service';
import type { ActivityMapSettings } from '../domain/settings';
import type { DataWarning } from '../data/daily-summary-repository';
import { resolveRange } from './date-range';
import {
	runDistributionQuery,
	type DistributionQuery,
	type DistributionResult,
} from './distribution-query';

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
		const warnings: DataWarning[] = [];
		for (const item of available) {
			if (!contributing.has(item.localDate)) continue;
			const result = await this.summaries.loadWithStatus(item);
			if (result.summary) loaded.push({ summary: result.summary });
			if (result.warning) warnings.push(result.warning);
		}
		return runDistributionQuery({
			query,
			resolved,
			summaries: loaded,
			registryEntries: this.registry.snapshot().entries,
			maxChartItems: this.getSettings().maxChartItems,
			warnings,
		});
	}

	async getStatusSummary(
		filePath: string,
		today: string,
	): Promise<{ fileActiveMs: number; vaultActiveMs: number }> {
		const available = await this.inventory.listDailySummaries();
		const fileId = this.registry.snapshot().pathIndex[filePath] ?? null;
		let fileActiveMs = 0;
		let vaultActiveMs = 0;
		for (const item of available) {
			if (item.localDate !== today) continue;
			const summary = await this.summaries.load(item);
			if (!summary) continue;
			for (const [id, metrics] of Object.entries(summary.metricsByFileId)) {
				vaultActiveMs += metrics.activeMs;
				if (fileId !== null && id === fileId) fileActiveMs += metrics.activeMs;
			}
		}
		return { fileActiveMs, vaultActiveMs };
	}
}
