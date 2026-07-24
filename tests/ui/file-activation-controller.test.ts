import { describe, expect, it } from '../helpers/test-harness';

import type { ChartItem } from '../../src/ui/components/donut-chart';
import {
	FileActivationController,
	isFileActivationItem,
} from '../../src/ui/file-activation-controller';

function chartItem(id: string, kind: ChartItem['kind']): ChartItem {
	return {
		id,
		kind,
		label: id,
		path: `${id}.md`,
		value: 1,
		percentOfScope: 1,
		memberIds: [id],
		color: 'var(--color-blue)',
		startAngle: 0,
		endAngle: Math.PI,
	};
}

describe('file activation controller', () => {
	it('owns the chart-file arm sequence independently of grouping', () => {
		const controller = new FileActivationController();
		const first = chartItem('first', 'file');
		const second = chartItem('second', 'file');
		const ordinaryClick = { metaKey: false, ctrlKey: false } as MouseEvent;

		expect(controller.activateChart(first, ordinaryClick, 'mouse')).toBe('arm');
		expect(controller.activateChart(second, ordinaryClick, 'mouse')).toBe('arm');
		expect(controller.activateChart(first, ordinaryClick, 'mouse')).toBe('arm');
		expect(controller.activateChart(first, ordinaryClick, 'mouse')).toBe('open');
	});

	it('opens modifier clicks immediately and delegates folders and touch input', () => {
		const controller = new FileActivationController();
		const file = chartItem('file', 'file');
		const directory = chartItem('folder', 'directory');

		expect(
			controller.activateChart(
				file,
				{ metaKey: true, ctrlKey: false } as MouseEvent,
				'mouse',
			),
		).toBe('open');
		expect(
			controller.activateChart(
				file,
				{ metaKey: false, ctrlKey: true } as KeyboardEvent,
				'keyboard',
			),
		).toBe('open');
		expect(
			controller.activateChart(
				file,
				{ metaKey: false, ctrlKey: false } as MouseEvent,
				'touch',
			),
		).toBe('delegate');
		expect(
			controller.activateChart(
				directory,
				{ metaKey: false, ctrlKey: false } as MouseEvent,
				'mouse',
			),
		).toBe('delegate');
		expect(isFileActivationItem(file)).toBeTrue();
		expect(isFileActivationItem(directory)).toBeFalse();
	});
});
