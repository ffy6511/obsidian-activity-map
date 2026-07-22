import { describe, expect, it } from '../helpers/test-harness';

import type { DistributionQuery } from '../../src/query/distribution-query';
import { QueryHistory } from '../../src/ui/query-history';

function query(path: string): DistributionQuery {
	return { metric: 'activeMs', range: { mode: 'day', localDate: '2026-07-21' }, path, view: 'children', groupBy: 'path' };
}

describe('per-view query history', () => {
	it('supports browser-like back and forward without sharing mutable query state', () => {
		const history = new QueryHistory();
		const root = query('');
		history.push(root);
		root.path = 'mutated-outside';
		const previous = history.back(query('projects'));
		expect(previous?.path).toBe('');
		expect(history.canGoForward).toBeTrue();
		expect(history.forward(previous ?? query(''))?.path).toBe('projects');
	});

	it('clears forward history after a new navigation branch', () => {
		const history = new QueryHistory();
		history.push(query(''));
		const root = history.back(query('a'));
		expect(root?.path).toBe('');
		history.push(root ?? query(''));
		expect(history.canGoForward).toBeFalse();
	});
});
