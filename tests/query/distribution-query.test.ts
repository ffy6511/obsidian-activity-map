import { describe, expect, it } from '../helpers/test-harness';

import { runDistributionQuery } from '../../src/query/distribution-query';
import { resolveRange } from '../../src/query/date-range';
import { QueryCache, queryKey } from '../../src/query/query-cache';
import { sampleRegistry, sampleSummaries, sampleRecordedDates } from '../fixtures/activity-history';

function run(args: {
	path: string;
	view: 'children' | 'local-files';
	groupBy?: 'path' | 'file';
	metric?: 'activeMs' | 'editingMs' | 'openCount';
	range?:
		| { mode: 'day'; localDate: string }
		| { mode: 'average'; days: 7 | 30 | 90 | 'all'; today: string }
		| { mode: 'all' };
	maxChartItems?: number;
}) {
	const query = {
		metric: args.metric ?? 'activeMs',
		range: args.range ?? { mode: 'day', localDate: '2026-07-14' },
		path: args.path,
		view: args.view,
		groupBy: args.groupBy ?? 'path',
	};
	const resolved = resolveRange({
		range: query.range,
		recordedDates: sampleRecordedDates(),
	});
	const summaries = sampleSummaries().filter((s) => resolved.dates.includes(s.localDate));
	return runDistributionQuery({
		query,
		resolved,
		summaries: summaries.map((summary) => ({ summary })),
		registryEntries: sampleRegistry(),
		maxChartItems: args.maxChartItems ?? 8,
	});
}

describe('distribution query root view', () => {
	it('groups the vault root into top-level directories and local files', () => {
		// Day 2026-07-14: projects (a,b under proj1), root.md, deleted archive.
		const result = run({ path: '', view: 'children', range: { mode: 'day', localDate: '2026-07-14' } });
		const labels = result.detailItems.map((i) => i.label);
		expect(labels).toContain('projects');
		// The vault total includes everything recorded that day.
		expect(result.vaultTotal).toBe(95_000);
		expect(result.scopeTotal).toBe(95_000);
		expect(result.percentOfVault).toBe(1);
	});

	it('exposes deleted history as a deleted item with last-known path in members', () => {
		const result = run({ path: '', view: 'children', range: { mode: 'day', localDate: '2026-07-14' } });
		const deleted = result.detailItems.find((i) => i.kind === 'deleted');
		expect(deleted).toBeDefined();
		expect(deleted?.value).toBe(10_000);
		expect(deleted?.memberIds).toContain('file-c');
	});
});

describe('distribution query directory drill-down', () => {
	it('drills into projects/ and groups by the next segment', () => {
		const result = run({
			path: 'projects',
			view: 'children',
			range: { mode: 'day', localDate: '2026-07-14' },
		});
		// Under projects/: proj1 (dir) with a,b.
		const proj1 = result.detailItems.find((i) => i.kind === 'directory' && i.label === 'proj1');
		expect(proj1).toBeDefined();
		expect(proj1?.value).toBe(80_000);
		expect(result.detailItems.some((item) => item.kind === 'deleted')).toBeFalse();
	});

	it('includes deleted history only within the selected last-known directory', () => {
		const archive = run({ path: 'archive', view: 'children', range: { mode: 'day', localDate: '2026-07-14' } });
		const deleted = archive.detailItems.find((item) => item.kind === 'deleted');
		expect(deleted?.memberIds).toContain('file-c');
		expect(deleted?.value).toBe(10_000);
	});

	it('keeps unknown-path deleted identities at vault root only', () => {
		const registry = sampleRegistry();
		const summary = sampleSummaries()[0];
		if (!summary) throw new Error('summary fixture missing');
		const withUnknown = {
			...summary,
			metricsByFileId: {
				...summary.metricsByFileId,
				'unknown-file': { activeMs: 3_000, editingMs: 0, openCount: 1 },
			},
		};
		const query = (path: string) => runDistributionQuery({
			query: { metric: 'activeMs', range: { mode: 'day', localDate: '2026-07-14' }, path, view: 'children', groupBy: 'path' },
			resolved: resolveRange({ range: { mode: 'day', localDate: '2026-07-14' }, recordedDates: sampleRecordedDates() }),
			summaries: [{ summary: withUnknown }],
			registryEntries: registry,
			maxChartItems: 8,
		});
		expect(query('').detailItems.find((item) => item.kind === 'deleted')?.memberIds).toContain('unknown-file');
		expect(query('projects').detailItems.some((item) => item.kind === 'deleted')).toBeFalse();
	});

	it('drills into projects/proj1 and shows local files when a sub-directory exists', () => {
		const result = run({
			path: 'projects/proj1',
			view: 'children',
			range: { mode: 'day', localDate: '2026-07-14' },
		});
		// proj1 has sub (dir, with deep.md) and notes.md as a local file.
		const sub = result.detailItems.find((i) => i.kind === 'directory' && i.label === 'sub');
		expect(sub).toBeDefined();
		expect(sub?.value).toBe(20_000);
	});

	it('local-files view returns only direct files under the path', () => {
		const result = run({
			path: 'projects/proj1',
			view: 'local-files',
			range: { mode: 'day', localDate: '2026-07-14' },
		});
		// Only notes.md is a direct file under proj1.
		expect(result.detailItems.every((i) => i.kind === 'file')).toBeTrue();
		const notes = result.detailItems.find((i) => i.id === 'file:file-a');
		expect(notes?.label).toBe('notes.md');
		expect(notes?.path).toBe('projects/proj1/notes.md');
		expect(notes?.id).toBe('file:file-a');
		expect(result.detailItems.some((i) => i.kind === 'directory')).toBeFalse();
	});
});

describe('distribution query file grouping', () => {
	it('flattens every present descendant file at the vault root', () => {
		const result = run({
			path: '',
			view: 'children',
			groupBy: 'file',
			range: { mode: 'day', localDate: '2026-07-14' },
		});
		expect(result.detailItems.some((item) => item.kind === 'directory')).toBeFalse();
		expect(result.detailItems.find((item) => item.id === 'file:file-a')).toEqual({
			id: 'file:file-a',
			kind: 'file',
			label: 'notes.md',
			path: 'projects/proj1/notes.md',
			value: 60_000,
			percentOfScope: 60_000 / 95_000,
			memberIds: ['file-a'],
		});
		expect(result.detailItems.find((item) => item.id === 'file:file-b')?.label).toBe('deep.md');
	});

	it('limits flattened files to the selected path without changing totals', () => {
		const pathResult = run({
			path: 'projects',
			view: 'children',
			groupBy: 'path',
			range: { mode: 'day', localDate: '2026-07-14' },
		});
		const fileResult = run({
			path: 'projects',
			view: 'children',
			groupBy: 'file',
			range: { mode: 'day', localDate: '2026-07-14' },
		});
		expect(fileResult.detailItems.filter((item) => item.kind === 'file').map((item) => item.id)).toEqual([
			'file:file-a',
			'file:file-b',
		]);
		expect(fileResult.scopeTotal).toBe(pathResult.scopeTotal);
		expect(fileResult.vaultTotal).toBe(pathResult.vaultTotal);
	});

	it('retains deleted history and the existing top-N Other fold', () => {
		const result = run({
			path: '',
			view: 'children',
			groupBy: 'file',
			range: { mode: 'all' },
			maxChartItems: 2,
		});
		expect(result.detailItems.find((item) => item.kind === 'deleted')?.memberIds).toContain('file-c');
		expect(result.chartItems.some((item) => item.kind === 'other')).toBeTrue();
	});
});

describe('distribution query other and ranking', () => {
	it('top N plus Other fold small items; details retain all', () => {
		// Use all-history so many files contribute; cap chart at 2.
		const result = run({
			path: '',
			view: 'children',
			range: { mode: 'all' },
			maxChartItems: 2,
		});
		const chartKinds = result.chartItems.map((i) => i.kind);
		// Chart has at most 3 entries (top 2 + Other), and Other is derived.
		expect(result.chartItems.length).toBeLessThanOrEqual(3);
		expect(chartKinds).toContain('other');
		// Details keep every item (no folding).
		expect(result.detailItems.length).toBeGreaterThanOrEqual(result.chartItems.length);
	});

	it('zero-value items do not appear as chart slices', () => {
		const result = run({
			path: '',
			view: 'children',
			range: { mode: 'day', localDate: '2026-07-14' },
			metric: 'editingMs',
		});
		expect(result.chartItems.every((i) => i.value > 0)).toBeTrue();
	});
});

describe('distribution query rolling average', () => {
	it('7-day average sums across the window including the zero-use day in the denominator', () => {
		const result = run({
			path: '',
			view: 'children',
			range: { mode: 'average', days: 7, today: '2026-07-20' },
		});
		expect(result.denominatorDays).toBe(7);
		// file-a is aggregated under the projects directory at the root; drill
		// into projects/proj1 local-files to read its exact total.
		const fileA = run({
			path: 'projects/proj1',
			view: 'local-files',
			range: { mode: 'average', days: 7, today: '2026-07-20' },
		}).detailItems.find((i) => i.id === 'file:file-a');
		// 60+40+30+50+20+70 = 270000 activeMs across 6 recorded days.
		expect(fileA?.value).toBe(270_000);
	});
});

describe('distribution query empty and warnings', () => {
	it('a day with no records returns empty items and zero totals', () => {
		const result = run({
			path: '',
			view: 'children',
			range: { mode: 'day', localDate: '2026-07-17' }, // zero-use day
		});
		expect(result.detailItems).toEqual([]);
		expect(result.scopeTotal).toBe(0);
		expect(result.vaultTotal).toBe(0);
		expect(result.percentOfVault).toBe(0);
	});
});

describe('query cache', () => {
	it('caches and returns results until invalidated', () => {
		const cache = new QueryCache();
		const query = {
			metric: 'activeMs' as const,
			range: { mode: 'day' as const, localDate: '2026-07-14' },
			path: '',
			view: 'children' as const,
			groupBy: 'path' as const,
		};
		const result = run({ path: '', view: 'children', range: { mode: 'day', localDate: '2026-07-14' } });
		expect(cache.getQuery(query)).toBeNull();
		cache.putQuery(query, result);
		expect(cache.getQuery(query)).not.toBeNull();
		cache.invalidateSummaries();
		expect(cache.getQuery(query)).toBeNull();
	});

	it('queryKey is stable for equivalent queries', () => {
		const q = {
			metric: 'activeMs' as const,
			range: { mode: 'day' as const, localDate: '2026-07-14' },
			path: '',
			view: 'children' as const,
			groupBy: 'path' as const,
		};
		expect(queryKey(q)).toBe(queryKey({ ...q }));
		expect(queryKey(q)).not.toBe(queryKey({ ...q, groupBy: 'file' }));
	});

	it('invalidateRegistry drops cached queries', () => {
		const cache = new QueryCache();
		const query = {
			metric: 'activeMs' as const,
			range: { mode: 'all' as const },
			path: '',
			view: 'children' as const,
			groupBy: 'path' as const,
		};
		const result = run({ path: '', view: 'children', range: { mode: 'all' } });
		cache.putQuery(query, result);
		cache.invalidateRegistry();
		expect(cache.getQuery(query)).toBeNull();
	});
});
