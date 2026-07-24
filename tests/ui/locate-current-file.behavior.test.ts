import { describe, expect, it } from '../helpers/test-harness';

import { readFile } from 'node:fs/promises';

import type { TrackingSnapshot } from '../../src/domain/activity';
import { normalizeSettings } from '../../src/domain/settings';
import type {
	DistributionItem,
	DistributionQuery,
	DistributionResult,
} from '../../src/query/distribution-query';
import {
	ActivityMapController,
	type QueryService,
	type TrackingControl,
} from '../../src/ui/activity-map-controller';
import { renderRangeControls } from '../../src/ui/components/range-controls';
import type { ChartItem } from '../../src/ui/components/donut-chart';
import { SummaryPopover } from '../../src/ui/summary-popover';
import { installDomEnvironment } from '../helpers/dom-environment';
import {
	LOCATE_HIGHLIGHT_MS,
	findLocateItem,
	isFileVisibleUnderScope,
	parentDirectory,
} from '../../src/ui/locate-file';

function tracking(): TrackingControl {
	return {
		pause: () => {},
		resume: () => {},
		updateSettings: () => {},
		resolveRecovery: async () => null,
		undoAutomaticExclusion: () => true,
	};
}

function snapshot(): TrackingSnapshot {
	return {
		state: 'active',
		reason: 'active',
		currentTarget: null,
		sessionStartedAt: null,
		lastTrustedActivityAt: null,
		pendingRecovery: [],
		recentDecisions: [],
		degradedReason: null,
		sampledAt: '2026-07-24T10:00:00.000Z',
	};
}

function fileItem(id: string, path: string, value: number): DistributionItem {
	return {
		id,
		kind: 'file',
		label: path.slice(path.lastIndexOf('/') + 1),
		path,
		value,
		percentOfScope: value / 100,
		memberIds: [id],
	};
}

function chartFileItem(id: string, path: string, value: number): ChartItem {
	return {
		...fileItem(id, path, value),
		color: 'var(--color-blue)',
		startAngle: 0,
		endAngle: Math.PI,
	};
}

function distribution(query: DistributionQuery, items: DistributionItem[]): DistributionResult {
	const detailItems = items;
	return {
		query,
		maxChartItems: 8,
		scopeTotal: items.reduce((sum, item) => sum + item.value, 0),
		vaultTotal: items.reduce((sum, item) => sum + item.value, 0),
		percentOfVault: 1,
		denominatorDays: null,
		coverage: null,
		chartItems: items,
		detailItems,
		warnings: [],
	};
}

/**
 * Builds a controller whose QueryService answers with `items` for the root
 * scope and `scopeItems` per-path when provided. Records the last dispatched
 * query path so the path-narrowing flow can be asserted.
 */
function makeController(args: {
	rootItems: DistributionItem[];
	/** Items to return for a given queried path; falls back to rootItems. */
	itemsForPath?: (path: string) => DistributionItem[];
	groupBy?: 'path' | 'file';
}): {
	controller: ActivityMapController;
	queries: DistributionQuery[];
} {
	const settings = normalizeSettings({
		deviceId: 'd1',
		headerPopoverGrouping: args.groupBy,
	});
	const queries: DistributionQuery[] = [];
	const service: QueryService = {
		run(query) {
			queries.push(query);
			const items = args.itemsForPath ? args.itemsForPath(query.path) : args.rootItems;
			return Promise.resolve(distribution(query, items));
		},
	};
	const controller = new ActivityMapController(
		settings,
		service,
		{ update: async () => settings },
		tracking(),
		'2026-07-24',
	);
	controller.onSnapshot(snapshot());
	return { controller, queries };
}

describe('locate-file pure helpers', () => {
	const items = [fileItem('a', 'notes/a.md', 10), fileItem('b', 'notes/sub/b.md', 20)];
	const result = distribution(
		{
			metric: 'activeMs',
			range: { mode: 'all' },
			path: '',
			view: 'children',
			groupBy: 'file',
		},
		items,
	);

	it('finds the file row by exact path', () => {
		expect(findLocateItem(result, 'notes/sub/b.md')?.id).toBe('b');
	});

	it('returns null when the file is not present', () => {
		expect(findLocateItem(result, 'notes/missing.md')).toBeNull();
	});

	it('computes parent directories and root edge cases', () => {
		expect(parentDirectory('notes/sub/b.md')).toBe('notes/sub');
		expect(parentDirectory('root.md')).toBe('');
		expect(parentDirectory('')).toBe('');
	});

	it('reports visibility from the detail list', () => {
		expect(isFileVisibleUnderScope(result, 'notes/a.md')).toBeTrue();
		expect(isFileVisibleUnderScope(result, 'notes/sub/b.md')).toBeTrue();
		expect(isFileVisibleUnderScope(result, 'other.md')).toBeFalse();
	});

	it('uses a 2s highlight window', () => {
		expect(LOCATE_HIGHLIGHT_MS).toBe(2_000);
	});
});

describe('locate current file behavior', () => {
	it('arms ordinary file-mode clicks while a first Cmd-click opens and pins immediately', async () => {
		const { document } = installDomEnvironment();
		const item = chartFileItem('a', 'notes/a.md', 10);
		const { controller } = makeController({ rootItems: [item], groupBy: 'file' });
		const trigger = document.createElement('button');
		document.body.appendChild(trigger);
		const window = document.defaultView as unknown as {
			setTimeout: () => number;
			clearTimeout: () => void;
			setInterval: () => number;
			clearInterval: () => void;
		};
		window.setTimeout = () => 0;
		window.clearTimeout = () => {};
		window.setInterval = () => 0;
		window.clearInterval = () => {};
		const opens: Array<{ filePath: string; openInNewTab: boolean }> = [];
		const popover = new SummaryPopover(
			trigger,
			controller,
			async (request) => {
				opens.push(request);
			},
			undefined,
			undefined,
			undefined,
			undefined,
			() => {},
		);
		popover.open();
		await Promise.resolve();
		await Promise.resolve();

		const actions = popover as unknown as {
			activateChartItem(
				item: ChartItem,
				event: MouseEvent | KeyboardEvent,
				source: 'mouse' | 'touch' | 'keyboard',
				groupBy: 'file' | 'path',
			): void;
			activateItem(item: DistributionItem, event: MouseEvent): void;
		};
		actions.activateChartItem(
			item,
			{ metaKey: false, ctrlKey: false } as MouseEvent,
			'mouse',
			'file',
		);

		const slice = document.querySelector<SVGPathElement>('[data-activity-map-id="a"]');
		const row = document.querySelector<HTMLButtonElement>('[data-activity-map-id="legend-a"]');
		const hint = document.querySelector<HTMLElement>('.activity-map-file-activation-hint');
		expect(opens).toHaveLength(0);
		expect(slice?.classList.contains('is-file-activation-armed')).toBeTrue();
		expect(row?.classList.contains('is-file-activation-link')).toBeTrue();
		expect(hint?.textContent).toBe(
			'Click the slice again to open the file · cmd/ctrl-click opens a new tab.',
		);

		slice?.dispatchEvent(new Event('pointerleave'));
		expect(slice?.classList.contains('is-file-activation-armed')).toBeFalse();
		expect(hint?.textContent).toBe('');

		actions.activateChartItem(
			item,
			{ metaKey: true, ctrlKey: false } as MouseEvent,
			'mouse',
			'file',
		);
		expect(opens).toEqual([{ filePath: 'notes/a.md', openInNewTab: true }]);
		expect(slice?.classList.contains('is-file-activation-armed')).toBeFalse();
		expect(
			document.querySelector('.activity-map-chart-popover')?.classList.contains('is-pinned'),
		).toBe(true);

		actions.activateChartItem(
			item,
			{ metaKey: false, ctrlKey: false } as MouseEvent,
			'mouse',
			'file',
		);
		slice?.dispatchEvent(new Event('blur'));
		expect(slice?.classList.contains('is-file-activation-armed')).toBeFalse();
		expect(hint?.textContent).toBe('');

		actions.activateChartItem(
			item,
			{ metaKey: false, ctrlKey: false } as MouseEvent,
			'mouse',
			'file',
		);
		actions.activateChartItem(
			item,
			{ metaKey: true, ctrlKey: false } as MouseEvent,
			'mouse',
			'file',
		);
		// Legend rows are direct file links; they never inherit a chart arm.
		actions.activateItem(item, { metaKey: false, ctrlKey: false } as MouseEvent);
		actions.activateItem(item, { metaKey: false, ctrlKey: true } as MouseEvent);
		expect(opens).toEqual([
			{ filePath: 'notes/a.md', openInNewTab: true },
			{ filePath: 'notes/a.md', openInNewTab: true },
			{ filePath: 'notes/a.md', openInNewTab: false },
			{ filePath: 'notes/a.md', openInNewTab: true },
		]);
		expect(hint?.textContent).toBe('');

		popover.close(false);
	});

	it('retains direct file activation for path grouping and touch', async () => {
		const { document } = installDomEnvironment();
		const item = chartFileItem('a', 'notes/a.md', 10);
		const { controller } = makeController({ rootItems: [item] });
		const trigger = document.createElement('button');
		document.body.appendChild(trigger);
		const window = document.defaultView as unknown as {
			setTimeout: () => number;
			clearTimeout: () => void;
			setInterval: () => number;
			clearInterval: () => void;
		};
		window.setTimeout = () => 0;
		window.clearTimeout = () => {};
		window.setInterval = () => 0;
		window.clearInterval = () => {};
		const opens: Array<{ filePath: string; openInNewTab: boolean }> = [];
		const popover = new SummaryPopover(
			trigger,
			controller,
			async (request) => {
				opens.push(request);
			},
			undefined,
			undefined,
			undefined,
			undefined,
			() => {},
		);
		popover.open();
		await Promise.resolve();
		await Promise.resolve();
		const actions = popover as unknown as {
			activateChartItem(
				item: ChartItem,
				event: MouseEvent,
				source: 'mouse' | 'touch' | 'keyboard',
				groupBy: 'file' | 'path',
			): void;
		};

		actions.activateChartItem(
			item,
			{ metaKey: false, ctrlKey: false } as MouseEvent,
			'mouse',
			'path',
		);
		actions.activateChartItem(
			item,
			{ metaKey: false, ctrlKey: false } as MouseEvent,
			'touch',
			'file',
		);
		expect(opens).toEqual([
			{ filePath: 'notes/a.md', openInNewTab: false },
			{ filePath: 'notes/a.md', openInNewTab: false },
		]);

		popover.close(false);
	});

	it('pins before opening a file and retains its last position after the header action detaches', async () => {
		const { document } = installDomEnvironment();
		const item = chartFileItem('a', 'notes/a.md', 10);
		const { controller } = makeController({ rootItems: [item] });
		const trigger = document.createElement('button');
		document.body.appendChild(trigger);
		const window = document.defaultView as unknown as {
			setTimeout: () => number;
			clearTimeout: () => void;
			setInterval: () => number;
			clearInterval: () => void;
		};
		window.setTimeout = () => 0;
		window.clearTimeout = () => {};
		window.setInterval = () => 0;
		window.clearInterval = () => {};
		const opens: Array<{ filePath: string; openInNewTab: boolean }> = [];
		const popover = new SummaryPopover(
			trigger,
			controller,
			async (request) => {
				opens.push(request);
			},
			undefined,
			undefined,
			undefined,
			undefined,
			() => {},
		);
		popover.open();
		await Promise.resolve();
		await Promise.resolve();

		const actions = popover as unknown as {
			activateItem(item: DistributionItem, event: MouseEvent): void;
		};
		actions.activateItem(item, { metaKey: true, ctrlKey: false } as MouseEvent);

		expect(opens).toEqual([{ filePath: 'notes/a.md', openInNewTab: true }]);
		const fixedPopover = document.querySelector<HTMLElement>('.activity-map-chart-popover');
		expect(fixedPopover?.classList.contains('is-pinned')).toBeTrue();
		expect(trigger.getAttribute('aria-pressed')).toBe('true');
		if (!fixedPopover) throw new Error('pinned Popover missing');
		const previousLeft = fixedPopover.style.left;
		const previousTop = fixedPopover.style.top;
		trigger.remove();

		(popover as unknown as { position(): void }).position();

		expect(document.querySelector('.activity-map-chart-popover')).toBe(fixedPopover);
		expect(fixedPopover.style.left).toBe(previousLeft);
		expect(fixedPopover.style.top).toBe(previousTop);
		popover.close(false);
	});

	it('closes instead of positioning from a detached header action', async () => {
		const { document } = installDomEnvironment();
		const item = chartFileItem('a', 'notes/a.md', 10);
		const { controller } = makeController({ rootItems: [item] });
		const trigger = document.createElement('button');
		document.body.appendChild(trigger);
		const window = document.defaultView as unknown as {
			setTimeout: () => number;
			clearTimeout: () => void;
			setInterval: () => number;
			clearInterval: () => void;
		};
		window.setTimeout = () => 0;
		window.clearTimeout = () => {};
		window.setInterval = () => 0;
		window.clearInterval = () => {};
		const popover = new SummaryPopover(
			trigger,
			controller,
			async () => {},
			undefined,
			undefined,
			undefined,
			undefined,
			() => {},
		);
		popover.open();
		await Promise.resolve();
		await Promise.resolve();
		trigger.remove();

		(popover as unknown as { position(): void }).position();

		expect(document.querySelector('.activity-map-chart-popover')).toBeNull();
		expect(trigger.getAttribute('aria-expanded')).toBe('false');
	});

	it('highlights the slice and legend row for the file in file grouping', async () => {
		const { document } = installDomEnvironment();
		const items = [fileItem('a', 'notes/a.md', 10), fileItem('b', 'notes/b.md', 30)];
		const { controller } = makeController({ rootItems: items });
		const trigger = document.createElement('button');
		document.body.appendChild(trigger);

		// Controllable timers so the 2s clear can be driven deterministically.
		const timers = new Map<number, () => void>();
		let nextTimer = 1;
		const window = document.defaultView as unknown as {
			setTimeout: (fn: () => void) => number;
			clearTimeout: (id: number) => void;
			matchMedia: (q: string) => { matches: boolean };
			setInterval: () => number;
			clearInterval: () => void;
		};
		window.setTimeout = (fn: () => void) => {
			const id = nextTimer++;
			timers.set(id, fn);
			return id;
		};
		window.clearTimeout = (id: number) => {
			timers.delete(id);
		};
		window.setInterval = () => 0;
		window.clearInterval = () => {};

		const popover = new SummaryPopover(
			trigger,
			controller,
			async () => {},
			undefined,
			undefined,
			undefined,
			() => 'notes/b.md',
			() => {},
		);
		popover.open();
		await Promise.resolve();
		await Promise.resolve();

		const started = popover.locateCurrentFile();
		expect(started).toBeTrue();
		const locate = document.querySelector<HTMLButtonElement>(
			'[data-activity-map-id="locate-current-file"]',
		);
		expect(locate?.classList.contains('is-locating')).toBeTrue();

		const row = document.querySelector<HTMLButtonElement>('[data-activity-map-id="legend-b"]');
		expect(row?.classList.contains('is-highlighted')).toBeTrue();
		const other = document.querySelector<HTMLButtonElement>(
			'[data-activity-map-id="legend-a"]',
		);
		expect(other?.classList.contains('is-dimmed')).toBeTrue();

		// Fire the pending clear.
		const clear = [...timers.values()][0];
		expect(clear).toBeDefined();
		clear?.();
		expect(locate?.classList.contains('is-locating')).toBeFalse();
		expect(row?.classList.contains('is-highlighted')).toBeFalse();
		expect(other?.classList.contains('is-dimmed')).toBeFalse();

		popover.close(false);
	});

	it('re-activation restarts the highlight window without overlapping clears', async () => {
		const { document } = installDomEnvironment();
		const items = [fileItem('a', 'a.md', 10)];
		const { controller } = makeController({ rootItems: items });
		const trigger = document.createElement('button');
		document.body.appendChild(trigger);

		const clears: number[] = [];
		const active = new Map<number, () => void>();
		let nextTimer = 100;
		const window = document.defaultView as unknown as {
			setTimeout: (fn: () => void) => number;
			clearTimeout: (id: number) => void;
			matchMedia: (q: string) => { matches: boolean };
			setInterval: () => number;
			clearInterval: () => void;
		};
		window.setTimeout = (fn: () => void) => {
			const id = nextTimer++;
			active.set(id, fn);
			return id;
		};
		window.clearTimeout = (id: number) => {
			clears.push(id);
			active.delete(id);
		};
		window.setInterval = () => 0;
		window.clearInterval = () => {};

		const popover = new SummaryPopover(
			trigger,
			controller,
			async () => {},
			undefined,
			undefined,
			undefined,
			() => 'a.md',
			() => {},
		);
		popover.open();
		await Promise.resolve();
		await Promise.resolve();

		popover.locateCurrentFile();
		const firstTimer = nextTimer - 1;
		popover.locateCurrentFile();
		// The first timer was cancelled when the second locate started.
		expect(clears).toContain(firstTimer);
		expect(active.size).toBe(1);

		popover.close(false);
	});

	it('narrows the path scope in path grouping, then highlights on the settled result', async () => {
		const { document } = installDomEnvironment();
		const rootItems = [
			// Root scope exposes only the directory row, not the nested file.
			{
				id: 'dir:notes',
				kind: 'directory' as const,
				label: 'notes',
				path: 'notes',
				value: 40,
				percentOfScope: 1,
				memberIds: ['a'],
			},
		];
		const fileUnderNotes = fileItem('a', 'notes/a.md', 40);
		const { controller, queries } = makeController({
			rootItems,
			itemsForPath: (path) => (path === 'notes' ? [fileUnderNotes] : rootItems),
		});
		const trigger = document.createElement('button');
		document.body.appendChild(trigger);

		const timers = new Map<number, () => void>();
		let nextTimer = 1;
		const window = document.defaultView as unknown as {
			setTimeout: (fn: () => void) => number;
			clearTimeout: (id: number) => void;
			matchMedia: (q: string) => { matches: boolean };
			setInterval: () => number;
			clearInterval: () => void;
		};
		window.setTimeout = (fn: () => void) => {
			const id = nextTimer++;
			timers.set(id, fn);
			return id;
		};
		window.clearTimeout = (id: number) => {
			timers.delete(id);
		};
		window.setInterval = () => 0;
		window.clearInterval = () => {};

		const popover = new SummaryPopover(
			trigger,
			controller,
			async () => {},
			undefined,
			undefined,
			undefined,
			() => 'notes/a.md',
			() => {},
		);
		popover.open();
		await Promise.resolve();
		await Promise.resolve();

		// In path grouping at root, the file is not a direct child -> locate
		// must narrow to the parent directory first.
		const started = popover.locateCurrentFile();
		expect(started).toBeTrue();
		const lastQuery = queries[queries.length - 1];
		expect(lastQuery?.path).toBe('notes');
		// Highlight is pending until the new ready model settles.
		await Promise.resolve();
		await Promise.resolve();

		const row = document.querySelector<HTMLButtonElement>('[data-activity-map-id="legend-a"]');
		expect(row?.classList.contains('is-highlighted')).toBeTrue();

		popover.close(false);
	});

	it('is a no-op when the file has no row in the current scope', async () => {
		const { document } = installDomEnvironment();
		const items = [fileItem('a', 'a.md', 10)];
		const { controller } = makeController({ rootItems: items });
		const trigger = document.createElement('button');
		document.body.appendChild(trigger);
		const window = document.defaultView as unknown as {
			setTimeout: () => number;
			clearTimeout: () => void;
			matchMedia: (q: string) => { matches: boolean };
			setInterval: () => number;
			clearInterval: () => void;
		};
		window.setTimeout = () => 0;
		window.clearTimeout = () => {};
		window.setInterval = () => 0;
		window.clearInterval = () => {};

		const popover = new SummaryPopover(
			trigger,
			controller,
			async () => {},
			undefined,
			undefined,
			undefined,
			() => 'missing.md',
			() => {},
		);
		popover.open();
		await Promise.resolve();
		await Promise.resolve();

		expect(popover.locateCurrentFile()).toBeFalse();
		const row = document.querySelector('[data-activity-map-id="legend-a"]');
		expect(row?.classList.contains('is-dimmed')).toBeFalse();

		popover.close(false);
	});

	it('disables the locate button when there is no owning file and renders it left of the metric', () => {
		const { document } = installDomEnvironment();
		const container = document.createElement('div');
		document.body.appendChild(container);
		const rendered: string[] = [];
		renderLocateControlsFixture(container, { hasFile: false }, rendered);
		const locate = container.querySelector<HTMLButtonElement>(
			'[data-activity-map-id="locate-current-file"]',
		);
		expect(locate).not.toBeNull();
		expect(locate?.disabled).toBeTrue();
		const queryButtons = Array.from(
			container.querySelectorAll<HTMLElement>('[data-activity-map-id]'),
		);
		const ids = queryButtons.map((el) => el.getAttribute('data-activity-map-id'));
		expect(ids.indexOf('locate-current-file')).toBeLessThan(ids.indexOf('metric'));
	});

	it('keeps the locate button enabled in the control row when a file is present', () => {
		const { document } = installDomEnvironment();
		const container = document.createElement('div');
		document.body.appendChild(container);
		const rendered: string[] = [];
		renderLocateControlsFixture(container, { hasFile: true }, rendered);
		const locate = container.querySelector<HTMLButtonElement>(
			'[data-activity-map-id="locate-current-file"]',
		);
		expect(locate?.disabled).toBeFalse();
		expect(rendered).toContain('locate');
		expect(rendered).toContain('locate-fixed');
	});

	it('retains the stacked locate icons when a loading update changes its state', () => {
		const { document } = installDomEnvironment();
		const container = document.createElement('div');
		document.body.appendChild(container);
		const rendered: string[] = [];
		const handle = renderLocateControlsFixture(container, { hasFile: true }, rendered);
		const locate = container.querySelector<HTMLButtonElement>(
			'[data-activity-map-id="locate-current-file"]',
		);
		if (!locate) throw new Error('locate button missing');
		const stack = locate.querySelector<HTMLElement>('[data-activity-map-icon-stack]');
		const restingIcon = stack?.querySelector<HTMLElement>('.activity-map-locate-icon');
		const pressedIcon = stack?.querySelector<HTMLElement>('.activity-map-locate-icon-fixed');
		if (!stack || !restingIcon || !pressedIcon) throw new Error('locate icon stack missing');
		expect(stack.getAttribute('aria-hidden')).toBe('true');
		expect(restingIcon.getAttribute('data-icon')).toBe('locate');
		expect(pressedIcon.getAttribute('data-icon')).toBe('locate-fixed');
		const renderedLocateIcons = rendered.filter((icon) => icon.startsWith('locate'));

		expect(
			handle.updateAction({
				icon: 'locate',
				label: 'Locate current file',
				id: 'locate-current-file',
				disabled: true,
				onActivate: () => {},
			}),
		).toBeTrue();

		expect(locate.disabled).toBeTrue();
		expect(locate.querySelector('[data-activity-map-icon-stack]')).toBe(stack);
		expect(stack.querySelector('.activity-map-locate-icon')).toBe(restingIcon);
		expect(stack.querySelector('.activity-map-locate-icon-fixed')).toBe(pressedIcon);
		expect(rendered.filter((icon) => icon.startsWith('locate'))).toEqual(renderedLocateIcons);
	});

	it('defines a highlight-owned locate cross-fade and shared subtle button press scale', async () => {
		const css = await readFile(new URL('../../styles.css', import.meta.url), 'utf8');
		expect(css.includes('transform: scale(1.04)')).toBeTrue();
		expect(css.includes("button[data-activity-map-id='locate-current-file']")).toBeTrue();
		expect(css.includes('display: inline-grid')).toBeTrue();
		expect(css.includes('place-items: center')).toBeTrue();
		expect(css.includes('transition: opacity 120ms ease-out')).toBeTrue();
		expect(/\.activity-map-locate-icon-fixed\s*\{\s*opacity: 0;/.test(css)).toBeTrue();
		expect(
			/\.is-locating[\s\S]*?\.activity-map-locate-icon-fixed\s*\{\s*opacity: 1;/.test(css),
		).toBeTrue();
	});

	it('cancels the highlight and timer when an unrelated intent re-renders', async () => {
		const { document } = installDomEnvironment();
		const items = [fileItem('a', 'a.md', 10), fileItem('b', 'b.md', 20)];
		const { controller } = makeController({ rootItems: items });
		const trigger = document.createElement('button');
		document.body.appendChild(trigger);

		const active = new Map<number, () => void>();
		let nextTimer = 1;
		const window = document.defaultView as unknown as {
			setTimeout: (fn: () => void) => number;
			clearTimeout: (id: number) => void;
			matchMedia: (q: string) => { matches: boolean };
			setInterval: () => number;
			clearInterval: () => void;
		};
		window.setTimeout = (fn: () => void) => {
			const id = nextTimer++;
			active.set(id, fn);
			return id;
		};
		window.clearTimeout = (id: number) => {
			active.delete(id);
		};
		window.setInterval = () => 0;
		window.clearInterval = () => {};

		const popover = new SummaryPopover(
			trigger,
			controller,
			async () => {},
			undefined,
			undefined,
			undefined,
			() => 'b.md',
			() => {},
		);
		popover.open();
		await Promise.resolve();
		await Promise.resolve();

		popover.locateCurrentFile();
		const row = document.querySelector<HTMLButtonElement>('[data-activity-map-id="legend-b"]');
		expect(row?.classList.contains('is-highlighted')).toBeTrue();
		expect(active.size).toBe(1);

		// An unrelated metric change bumps the generation and rebuilds the DOM;
		// the pending highlight clear must be cancelled and the new render must
		// not carry the locate highlight.
		void controller.dispatch({ kind: 'set-metric', metric: 'editingMs' });
		await Promise.resolve();
		await Promise.resolve();

		expect(active.size).toBe(0);
		const rowAfter = document.querySelector<HTMLButtonElement>(
			'[data-activity-map-id="legend-b"]',
		);
		expect(rowAfter?.classList.contains('is-highlighted')).toBeFalse();

		popover.close(false);
	});

	it('cancels the pending highlight timer on close so a late clear cannot mutate the DOM', async () => {
		const { document } = installDomEnvironment();
		const items = [fileItem('a', 'a.md', 10)];
		const { controller } = makeController({ rootItems: items });
		const trigger = document.createElement('button');
		document.body.appendChild(trigger);

		const active = new Map<number, () => void>();
		let nextTimer = 1;
		const window = document.defaultView as unknown as {
			setTimeout: (fn: () => void) => number;
			clearTimeout: (id: number) => void;
			matchMedia: (q: string) => { matches: boolean };
			setInterval: () => number;
			clearInterval: () => void;
		};
		window.setTimeout = (fn: () => void) => {
			const id = nextTimer++;
			active.set(id, fn);
			return id;
		};
		window.clearTimeout = (id: number) => {
			active.delete(id);
		};
		window.setInterval = () => 0;
		window.clearInterval = () => {};

		const popover = new SummaryPopover(
			trigger,
			controller,
			async () => {},
			undefined,
			undefined,
			undefined,
			() => 'a.md',
			() => {},
		);
		popover.open();
		await Promise.resolve();
		await Promise.resolve();

		popover.locateCurrentFile();
		expect(active.size).toBe(1);
		popover.close(false);
		// Close cancelled the timer.
		expect(active.size).toBe(0);
		// Driving any captured callback after close is a no-op on the DOM.
		const row = document.querySelector('[data-activity-map-id="legend-a"]');
		expect(row).toBeNull();
	});
});

/** Minimal range-controls fixture exercising the leadingQueryAction path. */
function renderLocateControlsFixture(
	container: HTMLElement,
	args: { hasFile: boolean },
	rendered: string[],
): ReturnType<typeof renderRangeControls> {
	return renderRangeControls({
		container,
		metric: 'activeMs',
		range: { mode: 'all' },
		onMetric: () => {},
		onRange: () => {},
		renderIcon: (element, icon) => {
			rendered.push(icon);
			element.setAttribute('data-icon', icon);
		},
		leadingQueryAction: {
			icon: 'locate',
			activeIcon: 'locate-fixed',
			label: 'Locate current file',
			id: 'locate-current-file',
			disabled: !args.hasFile,
			onActivate: () => {},
		},
	});
}
