import type { HoverParent, Workspace } from 'obsidian';

export const ACTIVITY_MAP_HOVER_SOURCE = 'activity-map';

/** A trusted pointer or keyboard activation that may open a file leaf. */
export type FileActivationEvent = MouseEvent | KeyboardEvent;

/** Presentation requests an open; the composition root chooses the workspace leaf. */
export interface OpenFileRequest {
	readonly filePath: string;
	readonly openInNewTab: boolean;
}

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

/** Modifier semantics match Obsidian's desktop link convention across platforms. */
export function shouldOpenInNewTab(event: FileActivationEvent): boolean {
	return event.metaKey || event.ctrlKey;
}

/** Explicit `'tab'` avoids the user-preferred split behavior of boolean `true`. */
export function fileOpenPane(openInNewTab: boolean): false | 'tab' {
	return openInNewTab ? 'tab' : false;
}
