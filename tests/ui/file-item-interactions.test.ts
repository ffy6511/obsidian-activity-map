import { describe, expect, it } from '../helpers/test-harness';

import { isTrustedPrimaryClick, previewFileOnHover } from '../../src/ui/file-hover-preview';

describe('file item interactions', () => {
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
