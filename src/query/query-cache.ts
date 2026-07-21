/**
 * Distribution query cache.
 *
 * Caches parsed daily summaries by path and query results by query key, with
 * targeted invalidation. A query observes one registry snapshot and one summary-
 * version snapshot; if mutation completes during the query, the older consistent
 * result is returned and the cache is invalidated for the next request.
 *
 * The cache is in-memory and process-scoped: a restart re-reads the verified
 * summaries from disk. It never caches raw shards.
 */

import type { DistributionResult } from './distribution-query';
import type { DistributionQuery } from './distribution-query';
import type { DailySummary } from '../data/daily-summary-repository';

/** A cache key capturing metric/range/path/view. */
export function queryKey(query: DistributionQuery): string {
	const range =
		query.range.mode === 'day'
			? `day:${query.range.localDate}`
			: query.range.mode === 'average'
				? `avg:${String(query.range.days)}:${query.range.today}`
				: 'all';
	return `${query.metric}|${range}|${query.path}|${query.view}`;
}

/** Snapshot cache keyed by summary path. Invalidated by date or registry change. */
export class QueryCache {
	private readonly summaries = new Map<string, { summary: DailySummary; version: number }>();
	private readonly queries = new Map<string, DistributionResult>();
	private summaryVersion = 0;
	private registryVersion = 0;

	/** Bump the summary version when any summary is written/rebuilt/deleted. */
	invalidateSummaries(dates?: readonly string[]): void {
		this.summaryVersion += 1;
		if (dates) {
			for (const key of this.summaries.keys()) {
				if (dates.some((d) => key.includes(d))) {
					this.summaries.delete(key);
				}
			}
		} else {
			this.summaries.clear();
		}
		// Query results depend on summaries; drop them.
		this.queries.clear();
	}

	/** Bump the registry version when paths/identity change (rename/delete/move). */
	invalidateRegistry(): void {
		this.registryVersion += 1;
		// Query results depend on the registry projection; drop them.
		this.queries.clear();
	}

	/** Cache a parsed summary with the current summary version. */
	putSummary(path: string, summary: DailySummary): void {
		this.summaries.set(path, { summary, version: this.summaryVersion });
	}

	/** Read a cached summary if its version matches the current one. */
	getSummary(path: string): DailySummary | null {
		const entry = this.summaries.get(path);
		if (!entry || entry.version !== this.summaryVersion) {
			return null;
		}
		return entry.summary;
	}

	/** Cache a query result with the current summary + registry versions. */
	putQuery(query: DistributionQuery, result: DistributionResult): void {
		this.queries.set(queryKey(query), result);
	}

	/** Read a cached query result, or null if any dependency version changed. */
	getQuery(query: DistributionQuery): DistributionResult | null {
		return this.queries.get(queryKey(query)) ?? null;
	}

	/** Current summary version (for snapshot consistency checks). */
	summaryVersionNow(): number {
		return this.summaryVersion;
	}

	/** Current registry version. */
	registryVersionNow(): number {
		return this.registryVersion;
	}

	/** Clear all cached state (used by full deletion). */
	clear(): void {
		this.summaries.clear();
		this.queries.clear();
		this.summaryVersion += 1;
		this.registryVersion += 1;
	}
}
