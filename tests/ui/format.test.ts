import { describe, expect, it } from '../helpers/test-harness';

import { formatMetric, formatMetricFull } from '../../src/ui/format';

describe('metric formatting', () => {
	it('compacts large typed-character counts without losing the exact accessible value', () => {
		expect(formatMetric(11_230, 'typedChars')).toBe('11.23k chars');
		expect(formatMetric(1_230_000, 'typedChars')).toBe('1.23M chars');
		expect(formatMetric(999_999, 'typedChars')).toBe('1M chars');
		expect(formatMetricFull(11_230, 'typedChars')).toBe('11230 chars');
	});

	it('keeps ordinary and averaged counts readable', () => {
		expect(formatMetric(204, 'typedChars')).toBe('204 chars');
		expect(formatMetric(11_230, 'typedChars', 7)).toBe('1.6k chars');
		expect(formatMetric(12_000, 'openCount')).toBe('12k opens');
	});
});
