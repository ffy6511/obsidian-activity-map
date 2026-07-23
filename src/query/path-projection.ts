/**
 * Path projection for distribution queries.
 *
 * Queries project metrics onto the current-path registry and group by the next
 * directory segment under the selected path. Direct files aggregate as a
 * virtual "local files" item; deleted/missing identities group under "deleted"
 * with their last-known path retained in details. A directory with no child
 * directories returns files directly instead of a redundant virtual item.
 */

import type { FileRegistryEntry } from '../data/file-registry';

/** Metric keys queryable by the distribution engine. */
export type MetricKey = 'activeMs' | 'editingMs' | 'openCount' | 'typedChars';

/** A file with its current or last-known path and a metric value. */
export interface ProjectedFile {
	fileId: string;
	path: string | null;
	lastKnownPath: string;
	deleted: boolean;
	value: number;
}

/** A grouping under the selected path. */
export interface PathGroup {
	/** Next directory segment, or null for a direct file. */
	segment: string | null;
	/** Full directory path this group represents, when segment is a directory. */
	directoryPath: string | null;
	kind: 'directory' | 'local-files';
	files: ProjectedFile[];
	total: number;
}

/**
 * Project per-file metrics onto the registry and group them under `path`.
 * `path` is a vault-relative prefix ("" for the vault root). Files whose current
 * path does not start with `path` are excluded; deleted files appear under the
 * "deleted" group handled by the caller.
 */
export function projectAndGroup(args: {
	metricsByFileId: Record<string, { activeMs: number; editingMs: number; openCount: number; typedChars: number }>;
	registryEntries: Record<string, FileRegistryEntry>;
	path: string;
	metric: MetricKey;
}): { groups: PathGroup[]; deleted: ProjectedFile[] } {
	const { metricsByFileId, registryEntries, path, metric } = args;
	const prefix = normalizePrefix(path);
	const present: ProjectedFile[] = [];
	const deleted: ProjectedFile[] = [];
	for (const [fileId, metrics] of Object.entries(metricsByFileId)) {
		const value = metrics[metric];
		const entry = registryEntries[fileId];
		if (!entry) {
			// An unknown identity has no defensible directory membership. Keep it
			// visible at vault root without leaking it into every drill-down.
			if (!prefix) {
				deleted.push({ fileId, path: null, lastKnownPath: '', deleted: true, value });
			}
			continue;
		}
		const currentPath = entry.currentPath;
		if (currentPath === null || entry.state === 'deleted') {
			if (!prefix || isWithinPrefix(entry.lastKnownPath, prefix)) {
				deleted.push({
					fileId,
					path: null,
					lastKnownPath: entry.lastKnownPath,
					deleted: true,
					value,
				});
			}
			continue;
		}
		// Only include present files whose current path is under the prefix.
		if (prefix && !(currentPath === prefix || currentPath.startsWith(`${prefix}/`))) {
			continue;
		}
		present.push({
			fileId,
			path: currentPath,
			lastKnownPath: entry.lastKnownPath,
			deleted: false,
			value,
		});
	}
	return { groups: groupPresent(present, prefix), deleted };
}

function isWithinPrefix(path: string, prefix: string): boolean {
	return path === prefix || path.startsWith(`${prefix}/`);
}

/**
 * Group present files by their next path segment under `prefix`. Direct files
 * (no further segment) form a single "local-files" group. Child directories
 * each form their own group. When there are no child directories, the local-
 * files group is returned alone (the caller decides whether to expose the
 * virtual item or return files directly).
 */
function groupPresent(files: ProjectedFile[], prefix: string): PathGroup[] {
	const bySegment = new Map<string, ProjectedFile[]>();
	const localFiles: ProjectedFile[] = [];
	for (const file of files) {
		const path = file.path ?? '';
		const remainder = prefix ? path.slice(prefix.length + 1) : path;
		const slash = remainder.indexOf('/');
		if (slash === -1) {
			localFiles.push(file);
		} else {
			const seg = remainder.slice(0, slash);
			const bucket = bySegment.get(seg) ?? [];
			bucket.push(file);
			bySegment.set(seg, bucket);
		}
	}
	const groups: PathGroup[] = [];
	for (const [segment, segFiles] of bySegment) {
		const dirPath = prefix ? `${prefix}/${segment}` : segment;
		groups.push({
			segment,
			directoryPath: dirPath,
			kind: 'directory',
			files: segFiles,
			total: sum(segFiles),
		});
	}
	if (localFiles.length > 0) {
		groups.push({
			segment: null,
			directoryPath: null,
			kind: 'local-files',
			files: localFiles,
			total: sum(localFiles),
		});
	}
	// Sort directories by descending total, then label; local-files last so the
	// caller can render files directly when no directories exist.
	groups.sort((a, b) => {
		if (a.kind !== b.kind) {
			return a.kind === 'directory' ? -1 : 1;
		}
		if (b.total !== a.total) {
			return b.total - a.total;
		}
		return (a.segment ?? '').localeCompare(b.segment ?? '');
	});
	return groups;
}

function sum(files: ProjectedFile[]): number {
	return files.reduce((total, f) => total + f.value, 0);
}

function normalizePrefix(path: string): string {
	let p = path.replace(/\\/g, '/').replace(/\/+/g, '/');
	if (p.startsWith('/')) {
		p = p.slice(1);
	}
	if (p.length > 1 && p.endsWith('/')) {
		p = p.slice(0, -1);
	}
	return p;
}
