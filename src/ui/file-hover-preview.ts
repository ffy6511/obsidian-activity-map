import type { HoverParent, Workspace } from 'obsidian';

export const ACTIVITY_MAP_HOVER_SOURCE = 'activity-map';

/** Emit the public Page Preview event without opening or focusing a file leaf. */
export function previewFileOnHover(args: {
	workspace: Workspace;
	hoverParent: HoverParent;
	event: MouseEvent;
	targetEl: HTMLElement;
	filePath: string;
}): void {
	args.workspace.trigger('hover-link', {
		event: args.event,
		source: ACTIVITY_MAP_HOVER_SOURCE,
		hoverParent: args.hoverParent,
		targetEl: args.targetEl,
		linktext: args.filePath,
		sourcePath: '',
	});
}

/** File activation must originate from the user agent, never a scripted click. */
export function isTrustedPrimaryClick(event: MouseEvent): boolean {
	return event.isTrusted && event.button === 0;
}
