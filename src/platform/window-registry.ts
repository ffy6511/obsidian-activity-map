/**
 * Obsidian window registry.
 *
 * Obsidian supports main and pop-out windows. A global main-window listener
 * cannot identify the only eligible foreground file, so each known
 * {@link WorkspaceWindow} is registered and the coordinator resolves the owner
 * window of the selected leaf. This module owns window identity and listener
 * bookkeeping only; it does not decide attribution.
 */

/**
 * Minimal platform-agnostic window descriptor the coordinator needs. Obsidian's
 * `WorkspaceWindow` and `Window` are adapted into this shape at the boundary so
 * the registry stays testable without importing Obsidian types here.
 */
export interface RegisteredWindow {
	id: string;
	/** The DOM `Window` owning this Obsidian window's document. */
	win: Window;
}

/**
 * Registry of currently known Obsidian windows. Callers add/remove windows as
 * the workspace opens and closes them; the registry never assumes the global
 * window owns every leaf.
 */
export class WindowRegistry {
	private readonly windows = new Map<string, RegisteredWindow>();

	/** Register or refresh a window. Returns true if newly added. */
	register(window: RegisteredWindow): boolean {
		const existed = this.windows.has(window.id);
		this.windows.set(window.id, window);
		return !existed;
	}

	/** Remove a window by id. Returns true if it was present. */
	unregister(id: string): boolean {
		return this.windows.delete(id);
	}

	/** All currently registered windows. */
	list(): readonly RegisteredWindow[] {
		return [...this.windows.values()];
	}

	/** Look up a window by id. */
	get(id: string): RegisteredWindow | undefined {
		return this.windows.get(id);
	}

	/** True when no windows are registered (e.g. during teardown). */
	isEmpty(): boolean {
		return this.windows.size === 0;
	}

	/** Clear all windows; used on teardown so no stale reference remains. */
	clear(): void {
		this.windows.clear();
	}
}
