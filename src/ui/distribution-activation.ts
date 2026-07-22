import type { DistributionItem } from '../query/distribution-query';

export type DistributionActivation =
	| { kind: 'navigate'; path: string; view: 'children' | 'local-files' }
	| { kind: 'expand-other'; memberIds: string[] }
	| { kind: 'open-file'; path: string }
	| { kind: 'none' };

/** One activation contract shared by the header popover and dockable view. */
export function distributionActivation(item: DistributionItem): DistributionActivation {
	if (item.kind === 'directory' && item.path !== null) {
		return { kind: 'navigate', path: item.path, view: 'children' };
	}
	if (item.kind === 'local-files') {
		return { kind: 'navigate', path: item.path ?? '', view: 'local-files' };
	}
	if (item.kind === 'other') {
		return { kind: 'expand-other', memberIds: [...item.memberIds] };
	}
	if (item.kind === 'file' && item.path) {
		return { kind: 'open-file', path: item.path };
	}
	return { kind: 'none' };
}
