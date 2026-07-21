import { describe, expect, it } from '../helpers/test-harness';
import type { FileView } from 'obsidian';

import { HeaderActionManager } from '../../src/ui/header-action-manager';
import { HeaderMiniDonut } from '../../src/ui/header-mini-donut';

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
	it('keeps the same header SVG nodes while data ratios change', () => {
		class FakeSvgNode {
			readonly children: FakeSvgNode[] = [];
			readonly attrs: Record<string, string> = {};
			readonly style = { strokeDasharray: '' };
			setAttribute(name: string, value: string) { this.attrs[name] = value; }
			append(...children: FakeSvgNode[]) { this.children.push(...children); }
			createSvg() { const node = new FakeSvgNode(); this.children.push(node); return node; }
		}
		const host = {
			children: [] as FakeSvgNode[],
			empty() { this.children = []; },
			createSvg() { const node = new FakeSvgNode(); this.children.push(node); return node; },
		};
		const donut = new HeaderMiniDonut(host as never);
		const svg = host.children[0];
		const value = svg?.children[1];
		donut.update(0.25);
		donut.update(0.25);
		donut.update(0.75);
		expect(host.children[0]).toBe(svg);
		expect(svg?.children[1]).toBe(value);
		expect(value?.attrs['data-activity-map-ratio']).toBe('0.75');
	});

	it('creates one stable mini donut per file view and removes only owned actions', async () => {
		const first = action();
		const second = action();
		let leaves: unknown[] = [];
		let actionIndex = 0;
		let donutCount = 0;
		const ratios: number[] = [];
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
			getViewModel() { return { tracking: null, queryGeneration: 0 }; },
			getStatusSummary: async () => ({ fileActiveMs: 25, vaultActiveMs: 100 }),
		};
		const manager = new HeaderActionManager({
			workspace: workspace as never,
			controller: controller as never,
			openView: async () => {},
			openFile: async () => {},
			isFileView: (candidate): candidate is FileView => Boolean(candidate),
			createMiniDonut: () => { donutCount += 1; return { update: (ratio) => ratios.push(ratio) }; },
			reportWarning: () => {},
		});
		manager.start();
		manager.synchronize();
		await Promise.resolve();
		expect(actionIndex).toBe(2);
		expect(donutCount).toBe(2);
		expect(first.attrs['aria-label']).toBe('Activity Map: starting');
		expect(ratios).toContain(0.25);
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
			controller: { subscribe: () => () => {}, getViewModel: () => ({ tracking: null }) } as never,
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
