import { describe, expect, it } from '../helpers/test-harness';

import type { DistributionItem, DistributionResult } from '../../src/query/distribution-query';
import { renderDetailList } from '../../src/ui/components/detail-list';
import { isTrustedPrimaryClick, previewFileOnHover } from '../../src/ui/file-hover-preview';
import { installDomEnvironment } from '../helpers/dom-environment';

function item(id: string): DistributionItem {
	return {
		id,
		kind: 'file',
		label: id,
		path: `${id}.md`,
		value: 1_000,
		percentOfScope: 0.5,
		memberIds: [id],
	};
}

function distribution(items: DistributionItem[]): DistributionResult {
	return {
		query: { metric: 'activeMs', range: { mode: 'day', localDate: '2026-07-22' }, path: '', view: 'children', groupBy: 'file' },
		maxChartItems: 8,
		scopeTotal: 2_000,
		vaultTotal: 2_000,
		percentOfVault: 1,
		denominatorDays: null,
		coverage: null,
		chartItems: items,
		detailItems: items,
		warnings: [],
	};
}

describe('file item interactions', () => {
	it('dims sibling rows while preserving the selected row', () => {
		const { document } = installDomEnvironment();
		const container = document.createElement('div');
		const items = [item('a'), item('b')];
		const handle = renderDetailList({ container, distribution: distribution(items), onActivate: () => undefined });
		const rows = Array.from(container.querySelectorAll<HTMLElement>('.activity-map-detail-row'));

		handle.highlight('a');
		expect(rows[0]?.classList.contains('is-highlighted')).toBeTrue();
		expect(rows[0]?.classList.contains('is-dimmed')).toBeFalse();
		expect(rows[1]?.classList.contains('is-dimmed')).toBeTrue();

		handle.highlight(null);
		expect(rows.some((row) => row.classList.contains('is-dimmed'))).toBeFalse();
	});

	it('emits the public Page Preview payload without opening a file', () => {
		const triggers: Array<{ name: string; payload: Record<string, unknown> }> = [];
		const targetEl = {} as HTMLElement;
		const hoverParent = { hoverPopover: null };
		const event = {} as MouseEvent;
		previewFileOnHover({
			workspace: {
				trigger(name: string, value: unknown) {
					triggers.push({ name, payload: value as Record<string, unknown> });
				},
			} as never,
			hoverParent,
			event,
			targetEl,
			filePath: 'notes/a.md',
		});

		const emitted = triggers[0];
		expect(emitted?.name).toBe('hover-link');
		expect(emitted?.payload.source).toBe('activity-map');
		expect(emitted?.payload.linktext).toBe('notes/a.md');
		expect(emitted?.payload.hoverParent).toBe(hoverParent);
		expect(emitted?.payload.targetEl).toBe(targetEl);
	});

	it('rejects synthetic and secondary clicks before file activation', () => {
		expect(isTrustedPrimaryClick({ isTrusted: false, button: 0 } as MouseEvent)).toBeFalse();
		expect(isTrustedPrimaryClick({ isTrusted: true, button: 1 } as MouseEvent)).toBeFalse();
		expect(isTrustedPrimaryClick({ isTrusted: true, button: 0 } as MouseEvent)).toBeTrue();
	});
});
