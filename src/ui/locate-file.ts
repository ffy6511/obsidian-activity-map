import type { DistributionItem, DistributionResult } from '../query/distribution-query';

/** Duration of the transient locate highlight, in milliseconds. */
export const LOCATE_HIGHLIGHT_MS = 2_000;

/**
 * Find the file {@link DistributionItem} whose `path` equals `activeFilePath`.
 *
 * The detail list always carries one row per present file (the chart may fold
 * low-value files into "Other"), so the legend row is the source of truth.
 * Returns `null` when the file has no row in this scope.
 */
export function findLocateItem(
	distribution: DistributionResult,
	activeFilePath: string,
): DistributionItem | null {
	return (
		distribution.detailItems.find(
			(item) => item.kind === 'file' && item.path === activeFilePath,
		) ?? null
	);
}

/**
 * Vault-relative parent directory of `filePath`. Returns `''` for files at the
 * vault root and for an empty path. Matches the breadcrumb/path contract: `''`
 * is the root scope, a non-empty result has no leading or trailing slash.
 */
export function parentDirectory(filePath: string): string {
	if (!filePath) return '';
	const slash = filePath.lastIndexOf('/');
	if (slash <= 0) return '';
	return filePath.slice(0, slash);
}

/**
 * Whether `filePath` is present as a direct file row under `scopePath`. In file
 * grouping this is the only way the file appears; in path grouping the file is
 * a direct child only when its parent equals the current scope. Used to decide
 * whether locate must narrow the scope first or can highlight immediately.
 */
export function isFileVisibleUnderScope(
	distribution: DistributionResult,
	activeFilePath: string,
): boolean {
	return findLocateItem(distribution, activeFilePath) !== null;
}
