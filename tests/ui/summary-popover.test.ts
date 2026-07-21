import { describe, expect, it } from '../helpers/test-harness';

import { SingleFlightActions } from '../../src/ui/summary-popover';

describe('summary popover action guard', () => {
	it('accepts a recovery action exactly once across repeated clicks', () => {
		const guard = new SingleFlightActions();
		expect(guard.begin('candidate-1')).toBeTrue();
		expect(guard.begin('candidate-1')).toBeFalse();
		expect(guard.begin('candidate-2')).toBeTrue();
	});
});
