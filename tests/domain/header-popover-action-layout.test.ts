import { describe, expect, it } from '../helpers/test-harness';

import {
	defaultHeaderPopoverActionLayout,
	moveHeaderPopoverAction,
	normalizeHeaderPopoverActionLayout,
	projectHeaderPopoverActionLayout,
} from '../../src/domain/header-popover-action-layout';

describe('Header Popover action layout normalization', () => {
	it('returns the current six-control order for absent persisted settings', () => {
		expect(normalizeHeaderPopoverActionLayout(null)).toEqual(
			defaultHeaderPopoverActionLayout(),
		);
	});

	it('keeps the first known record, repairs malformed values, and restores missing actions', () => {
		const layout = normalizeHeaderPopoverActionLayout([
			{ id: 'poster-export', order: 0, enabled: false },
			{ id: 'poster-export', order: 1, enabled: true },
			{ id: 'tracking-toggle', order: -1, enabled: true },
			{ id: 'metric', order: 0.5, enabled: 'no' },
			{ id: 'unknown-action', order: 0, enabled: false },
			{ id: 'date-range', order: Number.NaN, enabled: false },
		]);

		expect(layout.map((item) => item.id)).toEqual([
			'tracking-toggle',
			'distribution-grouping-toggle',
			'poster-export',
			'locate-current-file',
			'metric',
			'date-range',
		]);
		expect(layout.map((item) => item.order)).toEqual([0, 1, 2, 0, 1, 2]);
		expect(layout.find((item) => item.id === 'poster-export')?.enabled).toBeFalse();
		expect(layout.find((item) => item.id === 'metric')?.enabled).toBeTrue();
		expect(layout.find((item) => item.id === 'date-range')?.enabled).toBeFalse();
	});
});

describe('Header Popover action layout moves', () => {
	it('reorders enabled controls only within their registry-owned side', () => {
		const result = moveHeaderPopoverAction(
			defaultHeaderPopoverActionLayout(),
			'tracking-toggle',
			{ kind: 'side', side: 'left', index: 2 },
		);
		expect(result.kind).toBe('moved');
		if (result.kind !== 'moved') return;
		expect(projectHeaderPopoverActionLayout(result.layout).left.map((item) => item.id)).toEqual(
			['distribution-grouping-toggle', 'poster-export', 'tracking-toggle'],
		);
	});

	it('moves actions to the recovery area and restores them at an explicit same-side index', () => {
		const disabled = moveHeaderPopoverAction(
			defaultHeaderPopoverActionLayout(),
			'poster-export',
			{ kind: 'disabled' },
		);
		expect(disabled.kind).toBe('moved');
		if (disabled.kind !== 'moved') return;
		expect(
			projectHeaderPopoverActionLayout(disabled.layout).disabled.map((item) => item.id),
		).toEqual(['poster-export']);

		const restored = moveHeaderPopoverAction(disabled.layout, 'poster-export', {
			kind: 'side',
			side: 'left',
			index: 1,
		});
		expect(restored.kind).toBe('moved');
		if (restored.kind !== 'moved') return;
		expect(
			projectHeaderPopoverActionLayout(restored.layout).left.map((item) => item.id),
		).toEqual(['tracking-toggle', 'poster-export', 'distribution-grouping-toggle']);
	});

	it('rejects a wrong-side target without changing the canonical layout', () => {
		const original = defaultHeaderPopoverActionLayout();
		const result = moveHeaderPopoverAction(original, 'metric', {
			kind: 'side',
			side: 'left',
			index: 0,
		});
		expect(result.kind).toBe('rejected');
		if (result.kind !== 'rejected') return;
		expect(result.reason).toBe('wrong-side');
		expect(result.layout).toEqual(original);
	});

	it('can restore an action into an otherwise empty side', () => {
		let layout = defaultHeaderPopoverActionLayout();
		for (const id of [
			'tracking-toggle',
			'distribution-grouping-toggle',
			'poster-export',
		] as const) {
			const result = moveHeaderPopoverAction(layout, id, { kind: 'disabled' });
			expect(result.kind).toBe('moved');
			if (result.kind === 'moved') layout = result.layout;
		}
		expect(projectHeaderPopoverActionLayout(layout).left).toHaveLength(0);

		const restored = moveHeaderPopoverAction(layout, 'poster-export', {
			kind: 'side',
			side: 'left',
			index: 0,
		});
		expect(restored.kind).toBe('moved');
		if (restored.kind !== 'moved') return;
		expect(
			projectHeaderPopoverActionLayout(restored.layout).left.map((item) => item.id),
		).toEqual(['poster-export']);
	});
});
