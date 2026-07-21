import { describe, expect, it } from '../helpers/test-harness';

import { SingleFlightActions } from '../../src/ui/summary-popover';
import { readFile } from 'node:fs/promises';

describe('summary popover action guard', () => {
	it('accepts a recovery action exactly once across repeated clicks', () => {
		const guard = new SingleFlightActions();
		expect(guard.begin('candidate-1')).toBeTrue();
		expect(guard.begin('candidate-1')).toBeFalse();
		expect(guard.begin('candidate-2')).toBeTrue();
	});

	it('implements a donut-first pinnable chart instead of the rejected text card', async () => {
		const source = await readFile(new URL('../../src/ui/summary-popover.ts', import.meta.url), 'utf8');
		expect(source.includes('togglePinned()')).toBeTrue();
		expect(source.includes('getHeaderDefaultQuery()')).toBeTrue();
		expect(source.includes('renderDonutChart({')).toBeTrue();
		expect(source.includes('renderChartLegend({')).toBeTrue();
		expect(source.includes("text: 'Expand'")).toBeTrue();
		expect(source.includes('This file today')).toBeFalse();
	});
});
