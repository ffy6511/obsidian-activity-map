import { describe, expect, it } from '../helpers/test-harness';

import { buildChartModel, stableColor } from '../../src/ui/components/donut-chart';
import type { DistributionItem, DistributionResult } from '../../src/query/distribution-query';
import { distributionActivation } from '../../src/ui/distribution-activation';
import { shiftLocalDate } from '../../src/ui/components/range-controls';

function item(
	id: string,
	kind: DistributionItem['kind'],
	value: number,
	memberIds = [id],
): DistributionItem {
	return {
		id,
		kind,
		label: id,
		path: kind === 'directory' || kind === 'file' ? id : null,
		value,
		percentOfScope: value / 100,
		memberIds,
	};
}

function distribution(
	chartItems: DistributionItem[],
	detailItems = chartItems,
): DistributionResult {
	return {
		query: {
			metric: 'activeMs',
			range: { mode: 'day', localDate: '2026-07-21' },
			path: '',
			view: 'children',
			groupBy: 'path',
		},
		maxChartItems: 8,
		scopeTotal: 100,
		vaultTotal: 100,
		percentOfVault: 1,
		denominatorDays: null,
		coverage: null,
		chartItems,
		detailItems,
		warnings: [],
	};
}

describe('donut chart model', () => {
	it('assigns stable colors and partitions one complete turn', () => {
		const model = buildChartModel(
			distribution([item('a', 'directory', 70), item('b', 'directory', 30)]),
		);
		expect(model.items).toHaveLength(2);
		expect(model.items[0]?.color).toBe(stableColor('a'));
		expect(
			Math.round(
				((model.items[1]?.endAngle ?? 0) - (model.items[0]?.startAngle ?? 0)) * 1000,
			),
		).toBe(Math.round(Math.PI * 2 * 1000));
	});

	it('groups direct files into a local-files slice when directories coexist', () => {
		const directory = item('dir:projects', 'directory', 60);
		const fileA = item('file:a', 'file', 25, ['a']);
		const fileB = item('file:b', 'file', 15, ['b']);
		const model = buildChartModel(
			distribution([directory, fileA, fileB], [directory, fileA, fileB]),
		);
		expect(model.items).toHaveLength(2);
		expect(model.items[1]?.kind).toBe('local-files');
		expect(model.items[1]?.value).toBe(40);
		expect(model.items[1]?.memberIds).toEqual(['a', 'b']);
	});

	it('keeps other as a derived item without creating a path', () => {
		const other = item('group:other', 'other', 20, ['a', 'b']);
		const model = buildChartModel(distribution([item('dir:x', 'directory', 80), other]));
		expect(model.items[1]?.kind).toBe('other');
		expect(model.items[1]?.path).toBeNull();
	});

	it('shares directory, local-files, other, and file activation semantics', () => {
		expect(distributionActivation(item('dir:projects', 'directory', 50))).toEqual({
			kind: 'navigate',
			path: 'dir:projects',
			view: 'children',
		});
		expect(
			distributionActivation({
				...item('group:local-files', 'local-files', 20),
				path: 'projects',
			}),
		).toEqual({ kind: 'navigate', path: 'projects', view: 'local-files' });
		expect(distributionActivation(item('group:other', 'other', 10, ['a', 'b']))).toEqual({
			kind: 'expand-other',
			memberIds: ['a', 'b'],
		});
		expect(distributionActivation(item('notes/a.md', 'file', 20))).toEqual({
			kind: 'open-file',
			path: 'notes/a.md',
		});
	});

	it('moves selected-day navigation across month boundaries', () => {
		expect(shiftLocalDate('2026-07-01', -1)).toBe('2026-06-30');
		expect(shiftLocalDate('2026-07-31', 1)).toBe('2026-08-01');
	});
});
