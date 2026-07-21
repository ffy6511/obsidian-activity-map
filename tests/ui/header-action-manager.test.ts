import { describe, expect, it } from '../helpers/test-harness';
import type { FileView } from 'obsidian';

import { HeaderActionManager } from '../../src/ui/header-action-manager';
import { HeaderMiniDonut, headerDonutSlices, type HeaderDonutSlice } from '../../src/ui/header-mini-donut';
import type { DistributionResult } from '../../src/query/distribution-query';

interface FakeAction {
	isConnected: boolean;
	removed: boolean;
	attrs: Record<string, string>;
	classes: Set<string>;
	ownerDocument: { defaultView: { matchMedia: () => { matches: boolean } } };
	addClass(value: string): void;
	setAttr(name: string, value: string): void;
	addEventListener(): void;
	removeClasses(values: string[]): void;
	removeClass(value: string): void;
	toggleClass(value: string, enabled: boolean): void;
	remove(): void;
}

function action(): FakeAction {
	return {
		isConnected: true,
		removed: false,
		attrs: {},
		classes: new Set(),
		ownerDocument: { defaultView: { matchMedia: () => ({ matches: false }) } },
		addClass(value) { this.classes.add(value); },
		setAttr(name, value) { this.attrs[name] = value; },
		addEventListener() {},
		removeClasses(values) { for (const value of values) this.classes.delete(value); },
		removeClass(value) { this.classes.delete(value); },
		toggleClass(value, enabled) { if (enabled) this.classes.add(value); else this.classes.delete(value); },
		remove() { this.removed = true; this.isConnected = false; },
	};
}

describe('header action manager', () => {
	it('keeps the same header SVG and stable slice nodes while distributions change', () => {
		class FakeSvgNode {
			children: FakeSvgNode[] = [];
			readonly attrs: Record<string, string> = {};
			parent: FakeSvgNode | null = null;
			setAttribute(name: string, value: string) { this.attrs[name] = value; }
			appendChild(child: FakeSvgNode) { this.children = this.children.filter((node) => node !== child); child.parent = this; this.children.push(child); return child; }
			remove() { if (this.parent) this.parent.children = this.parent.children.filter((node) => node !== this); }
			createSvg() { const node = new FakeSvgNode(); node.parent = this; this.children.push(node); return node; }
		}
		const host = {
			children: [] as FakeSvgNode[],
			empty() { this.children = []; },
			createSvg() { const node = new FakeSvgNode(); this.children.push(node); return node; },
		};
		const donut = new HeaderMiniDonut(host as never);
		const svg = host.children[0];
		donut.update([
			{ id: 'dir:inbox', ratio: 0.25, color: 'blue' },
			{ id: 'dir:projects', ratio: 0.75, color: 'green' },
		]);
		const inbox = svg?.children[1];
		const projects = svg?.children[2];
		donut.update([
			{ id: 'dir:inbox', ratio: 0.5, color: 'blue' },
			{ id: 'dir:projects', ratio: 0.5, color: 'green' },
		]);
		expect(host.children[0]).toBe(svg);
		expect(svg?.children[1]).toBe(inbox);
		expect(svg?.children[2]).toBe(projects);
		expect(inbox?.attrs['stroke-dasharray']).toBe('0.5 0.5');
		expect(projects?.attrs['stroke-dashoffset']).toBe('-0.5');
		donut.update([]);
		expect(svg?.children).toHaveLength(1);
	});

	it('adds an unclosed session to its actual vault-root slice', () => {
		const distribution: DistributionResult = {
			query: { metric: 'activeMs', range: { mode: 'day', localDate: '2026-07-21' }, path: '', view: 'children' },
			scopeTotal: 100,
			vaultTotal: 100,
			percentOfVault: 1,
			denominatorDays: null,
			coverage: null,
			chartItems: [{ id: 'dir:inbox', kind: 'directory', label: 'inbox', path: 'inbox', value: 100, percentOfScope: 1, memberIds: ['f1'] }],
			detailItems: [{ id: 'dir:inbox', kind: 'directory', label: 'inbox', path: 'inbox', value: 100, percentOfScope: 1, memberIds: ['f1'] }],
			warnings: [],
		};
		const slices = headerDonutSlices(distribution, {
			state: 'active', reason: 'active', currentTarget: { fileId: 'f2', path: 'projects/a.md', windowId: 'w', leafId: 'l' },
			sessionStartedAt: '2026-07-21T00:00:00.000Z', lastTrustedActivityAt: '2026-07-21T00:00:10.000Z',
			pendingRecovery: [], recentDecisions: [], degradedReason: null, sampledAt: '2026-07-21T00:00:10.000Z',
		});
		expect(slices.map((slice) => slice.id)).toEqual(['dir:inbox', 'dir:projects']);
		expect(slices[1]?.ratio).toBeGreaterThan(0);
	});

	it('creates one stable mini donut per file view and removes only owned actions', async () => {
		const first = action();
		const second = action();
		let leaves: unknown[] = [];
		let actionIndex = 0;
		let donutCount = 0;
		const updates: HeaderDonutSlice[][] = [];
		const view = (path: string, target: FakeAction) => ({
			file: { path },
			addAction() { actionIndex += 1; return target; },
		});
		const viewA = view('a.md', first);
		const viewB = view('b.md', second);
		leaves = [{ view: viewA }, { view: viewB }];
		const refs: object[] = [];
		const workspace = {
			on() { const ref = {}; refs.push(ref); return ref; },
			offref() {},
			iterateAllLeaves(callback: (leaf: unknown) => void) { leaves.forEach(callback); },
		};
		const controller = {
			subscribe(listener: () => void) { listener(); return () => {}; },
			getViewModel() { return { tracking: null, queryGeneration: 0, settings: { idleThresholdMs: 180_000 } }; },
			getHeaderDistribution: async () => ({
				query: { metric: 'activeMs', range: { mode: 'day', localDate: '2026-07-21' }, path: '', view: 'children' },
				scopeTotal: 100, vaultTotal: 100, percentOfVault: 1, denominatorDays: null, coverage: null, warnings: [],
				chartItems: [
					{ id: 'dir:a', kind: 'directory', label: 'a', path: 'a', value: 25, percentOfScope: 0.25, memberIds: ['a'] },
					{ id: 'dir:b', kind: 'directory', label: 'b', path: 'b', value: 75, percentOfScope: 0.75, memberIds: ['b'] },
				],
				detailItems: [
					{ id: 'dir:a', kind: 'directory', label: 'a', path: 'a', value: 25, percentOfScope: 0.25, memberIds: ['a'] },
					{ id: 'dir:b', kind: 'directory', label: 'b', path: 'b', value: 75, percentOfScope: 0.75, memberIds: ['b'] },
				],
			}),
		};
		const manager = new HeaderActionManager({
			workspace: workspace as never,
			controller: controller as never,
			openView: async () => {},
			openFile: async () => {},
			isFileView: (candidate): candidate is FileView => Boolean(candidate),
			createMiniDonut: () => { donutCount += 1; return { update: (slices) => updates.push([...slices]) }; },
			reportWarning: () => {},
		});
		manager.start();
		manager.synchronize();
		await Promise.resolve();
		expect(actionIndex).toBe(2);
		expect(donutCount).toBe(2);
		expect(first.attrs['aria-label']).toBe('Activity Map: starting');
		expect(updates.some((slices) => slices.length === 2 && slices[0]?.ratio === 0.25)).toBeTrue();
		leaves = [{ view: viewB }];
		manager.synchronize();
		expect(first.removed).toBeTrue();
		expect(second.removed).toBeFalse();
		manager.stop();
		expect(second.removed).toBeTrue();
	});

	it('records header integration failure without throwing', () => {
		const warnings: string[] = [];
		const manager = new HeaderActionManager({
			workspace: {
				on: () => ({}), offref: () => {},
				iterateAllLeaves: () => { throw new Error('unsupported'); },
			} as never,
			controller: { subscribe: () => () => {}, getViewModel: () => ({ tracking: null, queryGeneration: 0, settings: { idleThresholdMs: 180_000 } }), getHeaderDistribution: async () => { throw new Error('unavailable'); } } as never,
			openView: async () => {},
			openFile: async () => {},
			isFileView: (candidate): candidate is FileView => Boolean(candidate),
			createMiniDonut: () => ({ update: () => {} }),
			reportWarning: (message) => warnings.push(message),
		});
		manager.start();
		expect(warnings).toHaveLength(1);
		expect(warnings[0]?.includes('unsupported')).toBeTrue();
	});
});
