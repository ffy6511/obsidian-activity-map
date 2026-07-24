import { describe, expect, it } from '../helpers/test-harness';

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
}): {
	controller: ActivityMapController;
	queries: DistributionQuery[];
} {
	const settings = normalizeSettings({ deviceId: 'd1' });
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
		expect(rendered).toContain('locate-fixed');
	});
});

/** Minimal range-controls fixture exercising the leadingQueryAction path. */
function renderLocateControlsFixture(
	container: HTMLElement,
	args: { hasFile: boolean },
	rendered: string[],
): void {
	renderRangeControls({
		container,
		metric: 'activeMs',
		range: { mode: 'all' },
		onMetric: () => {},
		onRange: () => {},
		renderIcon: (_el, icon) => {
			rendered.push(icon);
		},
		leadingQueryAction: {
			icon: 'locate-fixed',
			label: 'Locate current file',
			id: 'locate-current-file',
			disabled: !args.hasFile,
			onActivate: () => {},
		},
	});
}
