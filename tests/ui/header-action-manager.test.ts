import { describe, expect, it } from '../helpers/test-harness';
import type { FileView } from 'obsidian';

import { HeaderActionManager } from '../../src/ui/header-action-manager';

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
		remove() { this.removed = true; this.isConnected = false; },
	};
}

describe('header action manager', () => {
	it('creates one action per file view, updates it, and removes only owned actions', () => {
		const first = action();
		const second = action();
		let leaves: unknown[] = [];
		let actionIndex = 0;
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
			getViewModel() { return { tracking: null }; },
		};
		const manager = new HeaderActionManager({
			workspace: workspace as never,
			controller: controller as never,
			openView: async () => {},
			isFileView: (candidate): candidate is FileView => Boolean(candidate),
			setIcon: (element, icon) => element.setAttr('data-icon', icon),
			reportWarning: () => {},
		});
		manager.start();
		manager.synchronize();
		expect(actionIndex).toBe(2);
		expect(first.attrs['aria-label']).toBe('Activity Map: starting');
		expect(second.attrs['data-icon']).toBe('chart-pie');
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
			isFileView: (candidate): candidate is FileView => Boolean(candidate),
			setIcon: () => {},
			reportWarning: (message) => warnings.push(message),
		});
		manager.start();
		expect(warnings).toHaveLength(1);
		expect(warnings[0]?.includes('unsupported')).toBeTrue();
	});
});
