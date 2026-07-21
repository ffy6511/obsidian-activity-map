/**
 * Resolve the focused window's active leaf to an eligible tracking target.
 *
 * A target is eligible only when the focused leaf exposes a vault file, the
 * path is not excluded, and tracking is enabled. The resolver is platform-
 * agnostic: the coordinator adapts Obsidian's `WorkspaceLeaf`, `TFile`, and
 * the exclusion service into the {@link ResolvedLeaf} shape at the boundary.
 */

import type { TrackingTarget } from '../domain/activity';

/**
 * Minimal view of a leaf the resolver consumes. `file` is null when the leaf
 * shows a non-file-backed view (settings, graph, etc.), making it untrackable.
 */
export interface ResolvedLeaf {
	leafId: string;
	windowId: string;
	file: { path: string } | null;
}

/** Outcome of resolving the current foreground leaf. */
export type TargetResolution =
	| { kind: 'target'; target: TrackingTarget }
	| { kind: 'untrackable'; reason: string };

/** Function that decides whether a path is excluded from tracking. */
export type ExclusionChecker = (path: string) => boolean;

/**
 * Resolve a leaf into a tracking target given a file-identity lookup and an
 * exclusion check. The file-identity port (Spec 02) assigns the stable fileId;
 * here we only validate eligibility and shape the target.
 */
export async function resolveTarget(args: {
	leaf: ResolvedLeaf | null;
	resolveFileId: (path: string) => Promise<{ fileId: string; currentPath: string }>;
	isExcluded: ExclusionChecker;
}): Promise<TargetResolution> {
	const { leaf, resolveFileId, isExcluded } = args;
	if (!leaf) {
		return { kind: 'untrackable', reason: 'no-active-leaf' };
	}
	if (!leaf.file) {
		return { kind: 'untrackable', reason: 'no-file-backed-view' };
	}
	if (isExcluded(leaf.file.path)) {
		return { kind: 'untrackable', reason: 'path-excluded' };
	}
	const identity = await resolveFileId(leaf.file.path);
	return {
		kind: 'target',
		target: {
			fileId: identity.fileId,
			path: identity.currentPath,
			windowId: leaf.windowId,
			leafId: leaf.leafId,
		},
	};
}

/**
 * Filter a DOM activity event to trusted signals only. Untrusted (synthetic)
 * events must not refresh idle time, so the coordinator gates every DOM event
 * through this check.
 */
export function isTrustedActivityEvent(event: { isTrusted?: boolean }): boolean {
	// `isTrusted` is true for user-agent-dispatched events only. Synthetic DOM
	// events dispatched by scripts have isTrusted === false.
	return event.isTrusted === true;
}
