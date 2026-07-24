import { describe, expect, it } from '../helpers/test-harness';

import {
	DEFAULT_SCROLL_DURATION_MS,
	easeInOut,
	scrollIntoViewAnimated,
	type AnimatedScrollPort,
} from '../../src/ui/scroll-into-view-animated';

/**
 * Minimal in-memory stand-ins for a scroll container and a target row. The real
 * DOM is exercised in real Obsidian; these expose a `getBoundingClientRect()`
 * that reflects the current `scrollTop` (as a real browser would) plus numeric
 * client/scroll metrics, so the centering math is testable without a layout
 * engine. `targetContentTop` is the target's offset from the container's content
 * origin — the same origin `scrollTop` measures.
 */
function makeDom(args: {
	containerHeight: number;
	scrollHeight: number;
	targetContentTop: number;
	targetHeight: number;
}): {
	target: Record<string, unknown>;
	container: Record<string, unknown>;
} {
	// The container's viewport top is fixed at 0 for simplicity.
	const state = {
		scrollTop: 0,
		containerHeight: args.containerHeight,
		scrollHeight: args.scrollHeight,
		targetContentTop: args.targetContentTop,
		targetHeight: args.targetHeight,
	};
	const container = {
		clientHeight: state.containerHeight,
		scrollHeight: state.scrollHeight,
		get scrollTop() {
			return state.scrollTop;
		},
		set scrollTop(value: number) {
			state.scrollTop = value;
		},
		getBoundingClientRect() {
			// The container's own viewport rect does not move with scrolling.
			return { top: 0, height: state.containerHeight };
		},
	};
	const target = {
		getBoundingClientRect() {
			// The target moves up by scrollTop within the container's viewport.
			return {
				top: state.targetContentTop - state.scrollTop,
				height: state.targetHeight,
			};
		},
	};
	return { target, container };
}

/** A port whose clock advances only when the test ticks it. */
function makePort(): AnimatedScrollPort & { tick(ms: number): void; frames: number } {
	let time = 0;
	const queue: Array<{ at: number; cb: (t: number) => void }> = [];
	let frames = 0;
	return {
		now: () => time,
		requestFrame(cb) {
			frames += 1;
			const at = time + 16;
			queue.push({ at, cb });
			return frames;
		},
		cancelFrame() {
			queue.length = 0;
		},
		tick(ms: number) {
			const target = time + ms;
			// Drain frames scheduled at or before `target`, in order.
			while (queue.length && queue[0]!.at <= target) {
				time = queue[0]!.at;
				const { cb } = queue.shift()!;
				cb(time);
				const next = queue[0];
				if (next && next.at <= time) {
					// allow same-tick coalescing
					continue;
				}
			}
			time = target;
		},
		frames: 0,
	};
}

describe('scroll-into-view-animated easing', () => {
	it('easeInOut is symmetric and bounded 0..1', () => {
		expect(easeInOut(0)).toBe(0);
		expect(easeInOut(1)).toBe(1);
		expect(Math.abs(easeInOut(0.5) - 0.5)).toBeLessThan(1e-6);
		// Symmetry: f(t) + f(1-t) === 1 for this cubic ease.
		expect(Math.abs(easeInOut(0.25) + easeInOut(0.75) - 1)).toBeLessThan(1e-6);
	});

	it('uses a 400ms default duration', () => {
		expect(DEFAULT_SCROLL_DURATION_MS).toBe(400);
	});
});

describe('scrollIntoViewAnimated', () => {
	it('centers a below-the-fold target and animates scrollTop to the center over the duration', () => {
		// Container shows a 200px window; target sits at content offset 600 (height 40).
		// Centered scrollTop = 600 - (200 - 40)/2 = 520.
		const { target, container } = makeDom({
			containerHeight: 200,
			scrollHeight: 1000,
			targetContentTop: 600,
			targetHeight: 40,
		});
		const port = makePort();
		const cancel = scrollIntoViewAnimated(
			target as unknown as HTMLElement,
			container as unknown as HTMLElement,
			{ port },
		);
		// Halfway through, progress is ~0.5 so scrollTop is ~halfway (eased).
		port.tick(DEFAULT_SCROLL_DURATION_MS / 2);
		expect(container.scrollTop).toBeGreaterThan(0);
		expect(container.scrollTop).toBeLessThan(520);
		// Complete the animation.
		port.tick(DEFAULT_SCROLL_DURATION_MS);
		expect(container.scrollTop).toBe(520);
		cancel();
	});

	it('does not scroll when the target is already visible', () => {
		// Target fully inside the current viewport (0..200).
		const { target, container } = makeDom({
			containerHeight: 200,
			scrollHeight: 1000,
			targetContentTop: 80,
			targetHeight: 40,
		});
		const port = makePort();
		const cancel = scrollIntoViewAnimated(
			target as unknown as HTMLElement,
			container as unknown as HTMLElement,
			{ port },
		);
		port.tick(DEFAULT_SCROLL_DURATION_MS * 2);
		expect(container.scrollTop).toBe(0);
		expect(port.frames).toBe(0);
		cancel();
	});

	it('clamps to the bottom boundary instead of overshooting for a near-last row', () => {
		// scrollHeight 1000, containerHeight 200 => maxScroll 800. A target at the
		// very end would center at 980, which must clamp to 800.
		const { target, container } = makeDom({
			containerHeight: 200,
			scrollHeight: 1000,
			targetContentTop: 980,
			targetHeight: 40,
		});
		const port = makePort();
		const cancel = scrollIntoViewAnimated(
			target as unknown as HTMLElement,
			container as unknown as HTMLElement,
			{ port },
		);
		port.tick(DEFAULT_SCROLL_DURATION_MS * 2);
		expect(container.scrollTop).toBe(800);
		cancel();
	});

	it('clamps to the top boundary for a row above the viewport', () => {
		// Start already scrolled down; target above => clamp to 0.
		const { target, container } = makeDom({
			containerHeight: 200,
			scrollHeight: 1000,
			targetContentTop: 10,
			targetHeight: 40,
		});
		container.scrollTop = 500;
		const port = makePort();
		const cancel = scrollIntoViewAnimated(
			target as unknown as HTMLElement,
			container as unknown as HTMLElement,
			{ port },
		);
		port.tick(DEFAULT_SCROLL_DURATION_MS * 2);
		expect(container.scrollTop).toBe(0);
		cancel();
	});

	it('stops animating when the returned cancel function is called', () => {
		const { target, container } = makeDom({
			containerHeight: 200,
			scrollHeight: 1000,
			targetContentTop: 600,
			targetHeight: 40,
		});
		const port = makePort();
		const cancel = scrollIntoViewAnimated(
			target as unknown as HTMLElement,
			container as unknown as HTMLElement,
			{ port },
		);
		port.tick(DEFAULT_SCROLL_DURATION_MS / 4);
		const scrollTopAtCancel = container.scrollTop;
		cancel();
		port.tick(DEFAULT_SCROLL_DURATION_MS * 2);
		// No further frames advanced the scroll after cancellation.
		expect(container.scrollTop).toBe(scrollTopAtCancel);
	});

	it('is a no-op when layout metrics are absent (headless DOM without layout)', () => {
		// Simulate linkedom: getBoundingClientRect returns a non-numeric/empty rect.
		const target = { getBoundingClientRect: () => ({}) };
		const container = {
			clientHeight: 200,
			scrollHeight: 1000,
			scrollTop: 0,
			getBoundingClientRect: () => ({ top: 0 }),
		};
		const port = makePort();
		const cancel = scrollIntoViewAnimated(
			target as unknown as HTMLElement,
			container as unknown as HTMLElement,
			{ port },
		);
		port.tick(DEFAULT_SCROLL_DURATION_MS * 2);
		expect(port.frames).toBe(0);
		cancel();
	});
});
