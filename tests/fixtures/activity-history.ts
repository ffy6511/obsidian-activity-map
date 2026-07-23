/**
 * Fixed activity-history fixtures for deterministic query tests.
 *
 * These datasets are intentionally small and hand-computed so expected values
 * are obvious. They cover multiple devices, dates, nested directories, a rename
 * (same id, new path), a deletion, and a zero-use day inside a rolling window.
 */

import type { DailySummary } from '../../src/data/daily-summary-repository';
import type { FileRegistryEntry } from '../../src/data/file-registry';

/** A registry with two present files and one deleted file (same id renamed). */
export function sampleRegistry(): Record<string, FileRegistryEntry> {
	return {
		'file-a': {
			fileId: 'file-a',
			// Renamed: history follows the current path.
			currentPath: 'projects/proj1/notes.md',
			lastKnownPath: 'projects/proj1/notes.md',
			state: 'present',
			firstSeenAt: '2026-07-01T00:00:00.000Z',
			lastSeenAt: '2026-07-20T00:00:00.000Z',
		},
		'file-b': {
			fileId: 'file-b',
			currentPath: 'projects/proj1/sub/deep.md',
			lastKnownPath: 'projects/proj1/sub/deep.md',
			state: 'present',
			firstSeenAt: '2026-07-01T00:00:00.000Z',
			lastSeenAt: '2026-07-20T00:00:00.000Z',
		},
		'file-c': {
			fileId: 'file-c',
			// Deleted: history retained under the deleted group.
			currentPath: null,
			lastKnownPath: 'archive/old.md',
			state: 'deleted',
			firstSeenAt: '2026-07-01T00:00:00.000Z',
			lastSeenAt: '2026-07-10T00:00:00.000Z',
		},
		'file-root': {
			fileId: 'file-root',
			currentPath: 'root.md',
			lastKnownPath: 'root.md',
			state: 'present',
			firstSeenAt: '2026-07-01T00:00:00.000Z',
			lastSeenAt: '2026-07-20T00:00:00.000Z',
		},
	};
}

function summary(
	deviceId: string,
	localDate: string,
	metricsByFileId: DailySummary['metricsByFileId'],
): DailySummary {
	return {
		schemaVersion: 1,
		deviceId,
		localDate,
		generatedAt: `${localDate}T23:59:59.000Z`,
		sourceRecordCount: 1,
		sourceFingerprint: `fixture-${deviceId}-${localDate}`,
		metricsByFileId,
		warnings: [],
	};
}

/**
 * A 7-day history (2026-07-14 .. 2026-07-20) on one device, with:
 * - file-a active each day;
 * - file-b active on some days;
 * - file-c (deleted) active on the first day;
 * - file-root on the root;
 * - one zero-use day (2026-07-17) to exercise the denominator.
 */
export function sampleSummaries(): DailySummary[] {
	const by = (date: string, m: DailySummary['metricsByFileId']) => summary('dev1', date, m);
	return [
		by('2026-07-14', {
			'file-a': { activeMs: 60_000, editingMs: 30_000, openCount: 1, typedChars: 0 },
			'file-b': { activeMs: 20_000, editingMs: 0, openCount: 1, typedChars: 0 },
			'file-c': { activeMs: 10_000, editingMs: 0, openCount: 1, typedChars: 0 },
			'file-root': { activeMs: 5_000, editingMs: 0, openCount: 1, typedChars: 0 },
		}),
		by('2026-07-15', {
			'file-a': { activeMs: 40_000, editingMs: 10_000, openCount: 1, typedChars: 0 },
		}),
		by('2026-07-16', {
			'file-a': { activeMs: 30_000, editingMs: 0, openCount: 1, typedChars: 0 },
			'file-b': { activeMs: 10_000, editingMs: 0, openCount: 1, typedChars: 0 },
		}),
		// 2026-07-17 zero-use day (no summary).
		by('2026-07-18', {
			'file-a': { activeMs: 50_000, editingMs: 20_000, openCount: 1, typedChars: 0 },
		}),
		by('2026-07-19', {
			'file-a': { activeMs: 20_000, editingMs: 0, openCount: 1, typedChars: 0 },
			'file-root': { activeMs: 8_000, editingMs: 0, openCount: 1, typedChars: 0 },
		}),
		by('2026-07-20', {
			'file-a': { activeMs: 70_000, editingMs: 40_000, openCount: 1, typedChars: 0 },
			'file-b': { activeMs: 15_000, editingMs: 5_000, openCount: 1, typedChars: 0 },
		}),
	];
}

/** Recorded local dates across the sample (excludes the zero-use day). */
export function sampleRecordedDates(): string[] {
	return ['2026-07-14', '2026-07-15', '2026-07-16', '2026-07-18', '2026-07-19', '2026-07-20'];
}
