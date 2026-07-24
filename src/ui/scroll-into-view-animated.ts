/**
 * Fixed-duration, ease-in-out scroll that centers an element inside its scroll
 * container. The native `scrollIntoView({ behavior: 'smooth' })` duration and
 * easing are engine-defined and inconsistent across desktop/mobile, so this
 * module owns the motion so the locate action gets a predictable feel: a fixed
 * total duration regardless of distance (longer scrolls run faster on average).
 */

export interface AnimatedScrollPort {
	/** Monotonic timestamp in milliseconds (DOMHighResTimeStamp semantics). */
	now(): number;
	/** Schedules the next animation frame; returns a cancellable handle. */
	requestFrame(callback: (time: number) => void): number;
	cancelFrame(handle: number): void;
}

export interface AnimatedScrollOptions {
	/** Total animation duration in milliseconds. */
	durationMs?: number;
	/** Port for time and frame scheduling; defaults to the owning window. */
	port?: AnimatedScrollPort;
}

/** Default animation duration. */
export const DEFAULT_SCROLL_DURATION_MS = 400;

/** Standard ease-in-out (cubic). Returns progress 0..1 for t in 0..1. */
export function easeInOut(t: number): number {
	return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/**
 * Scrolls `container` so that `target` is centered on the cross-axis, animated
 * over a fixed duration with ease-in-out. No-op when `target` is already fully
 * visible (then the caller's highlight alone suffices), or when the host lacks
 * `requestAnimationFrame` / layout metrics (e.g. the linkedom test DOM).
 *
 * Returns a cancel function: calling it stops the in-flight animation. The
 * caller should cancel on re-render, close, or a new activation.
 */
export function scrollIntoViewAnimated(
	target: HTMLElement,
	container: HTMLElement,
	options: AnimatedScrollOptions = {},
): () => void {
	const duration = options.durationMs ?? DEFAULT_SCROLL_DURATION_MS;
	const port = resolvePort(target, options.port);
	// Compute the target's offset relative to the scroll container's *content*
	// origin. `offsetTop` is relative to `offsetParent`, which is NOT always the
	// scroll container (here the rows sit in an inner `.activity-map-chart-legend`
	// flex list while `.activity-map-popover-legend` scrolls). Using rect
	// differences ties the target position to the same origin as `scrollTop`, so
	// the centering math is correct regardless of nesting.
	const containerRect = container.getBoundingClientRect();
	const targetRect = target.getBoundingClientRect();
	if (
		!containerRect ||
		!targetRect ||
		typeof targetRect.top !== 'number' ||
		typeof targetRect.height !== 'number' ||
		typeof containerRect.top !== 'number'
	) {
		return () => {};
	}
	const containerHeight = container.clientHeight;
	const scrollTop = container.scrollTop;
	const scrollHeight = container.scrollHeight;
	if (
		typeof containerHeight !== 'number' ||
		typeof scrollTop !== 'number' ||
		typeof scrollHeight !== 'number'
	) {
		return () => {};
	}
	const targetHeight = targetRect.height;
	// Content-space top of the target = its viewport top minus the container's
	// viewport top (the container's visible content origin) plus how far the
	// container is already scrolled.
	const targetTop = targetRect.top - containerRect.top + scrollTop;

	// The desired scrollTop centers the target, clamped to the scrollable range so
	// the first/last rows rest at the boundary instead of leaving empty space.
	const start = scrollTop;
	const maxScroll = scrollHeight - containerHeight;
	const centered = targetTop - (containerHeight - targetHeight) / 2;
	const end = Math.max(0, Math.min(centered, Math.max(0, maxScroll)));

	// Already visible: do not move the list, let the highlight carry the locate.
	const targetBottom = targetTop + targetHeight;
	const viewTop = start;
	const viewBottom = viewTop + containerHeight;
	if (targetTop >= viewTop && targetBottom <= viewBottom) return () => {};
	// No distance to cover (e.g. list shorter than its container).
	if (end === start) return () => {};

	const startTime = port.now();
	let handle = port.requestFrame(step);
	let cancelled = false;

	function step(time: number): void {
		if (cancelled) return;
		const elapsed = time - startTime;
		const progress = elapsed >= duration ? 1 : Math.max(0, elapsed / duration);
		container.scrollTop = start + (end - start) * easeInOut(progress);
		if (progress < 1) {
			handle = port.requestFrame(step);
		}
	}

	return () => {
		cancelled = true;
		port.cancelFrame(handle);
	};
}

function resolvePort(target: HTMLElement, port?: AnimatedScrollPort): AnimatedScrollPort {
	if (port) return port;
	const view = target.ownerDocument.defaultView as
		(Window & { requestAnimationFrame: number; cancelAnimationFrame: number }) | null;
	if (view && typeof view.requestAnimationFrame === 'function') {
		return {
			now: () => performance.now(),
			requestFrame: (cb) => view.requestAnimationFrame(cb),
			cancelFrame: (h) => view.cancelAnimationFrame(h),
		};
	}
	// No requestAnimationFrame: the host cannot animate (Obsidian always can).
	// Return a port that never schedules a frame, so the animation effectively
	// settles at its start. The layout no-op guard above already handles hosts
	// without metrics; this keeps the contract total without touching timers.
	return {
		now: () => 0,
		requestFrame: () => 0,
		cancelFrame: () => {},
	};
}
