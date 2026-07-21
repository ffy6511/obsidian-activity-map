import { describe, expect, it } from '../helpers/test-harness';

import { buildChartModel, stableColor } from '../../src/ui/components/donut-chart';
import type { DistributionItem, DistributionResult } from '../../src/query/distribution-query';

function item(id: string, kind: DistributionItem['kind'], value: number, memberIds = [id]): DistributionItem {
	return { id, kind, label: id, path: kind === 'directory' || kind === 'file' ? id : null, value, percentOfScope: value / 100, memberIds };
}

function distribution(chartItems: DistributionItem[], detailItems = chartItems): DistributionResult {
	return {
		query: { metric: 'activeMs', range: { mode: 'day', localDate: '2026-07-21' }, path: '', view: 'children' },
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
		const model = buildChartModel(distribution([item('a', 'directory', 70), item('b', 'directory', 30)]));
		expect(model.items).toHaveLength(2);
		expect(model.items[0]?.color).toBe(stableColor('a'));
		expect(Math.round(((model.items[1]?.endAngle ?? 0) - (model.items[0]?.startAngle ?? 0)) * 1000)).toBe(Math.round(Math.PI * 2 * 1000));
	});

	it('groups direct files into a local-files slice when directories coexist', () => {
		const directory = item('dir:projects', 'directory', 60);
		const fileA = item('file:a', 'file', 25, ['a']);
		const fileB = item('file:b', 'file', 15, ['b']);
		const model = buildChartModel(distribution([directory, fileA, fileB], [directory, fileA, fileB]));
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
});
