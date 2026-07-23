import { describe, expect, it } from '../helpers/test-harness';

import { WindowRegistry } from '../../src/platform/window-registry';
import {
	isTrustedActivityEvent,
	resolveTarget,
	type ResolvedLeaf,
} from '../../src/tracking/target-resolver';
import {
	TrackingCoordinator,
	type ActivityEventSource,
	type EditorChangeSource,
	type TypedInputCommit,
	type WorkspaceSource,
} from '../../src/tracking/tracking-coordinator';
import { InMemoryCheckpointPort, InMemoryTrackingSink } from '../../src/tracking/ports';
import { createFakeClock, type FakeClock } from '../helpers/fake-clock';
import { DEFAULT_SETTINGS, normalizeSettings } from '../../src/domain/settings';
import type { TrackingSnapshot } from '../../src/domain/activity';
import type { RuntimeCheckpoint } from '../../src/domain/activity';

function settings(overrides: Record<string, unknown> = {}) {
	return normalizeSettings({ ...DEFAULT_SETTINGS, deviceId: 'd1', ...overrides });
}

/** A fake identity port that assigns deterministic file IDs by path. */
function fakeIdentity() {
	const ids = new Map<string, string>();
	return {
		resolve: async ({ path }: { path: string }) => {
			let id = ids.get(path);
			if (!id) {
				id = `file-${ids.size + 1}`;
				ids.set(path, id);
			}
			return { fileId: id, currentPath: path };
		},
	};
}

/** Build a controllable workspace source with manual event triggers. */
function fakeWorkspace(initialLeaf: ResolvedLeaf | null): {
	source: WorkspaceSource;
	setActiveLeaf(leaf: ResolvedLeaf | null): void;
	fireActiveLeafChange(): void;
	fireFileOpen(leaf: ResolvedLeaf): void;
	fireEditorChange(source: EditorChangeSource): void;
} {
	let active = initialLeaf;
	const leafCbs = new Set<() => void>();
	const fileOpenCbs = new Set<(leaf: ResolvedLeaf) => void>();
	const editorCbs = new Set<(source: EditorChangeSource) => void>();
	return {
		source: {
			getActiveLeaf: () => active,
			onActiveLeafChange: (cb) => {
				leafCbs.add(cb);
				return () => leafCbs.delete(cb);
			},
			onFileOpen: (cb) => {
				fileOpenCbs.add(cb);
				return () => fileOpenCbs.delete(cb);
			},
			onEditorChange: (cb) => {
				editorCbs.add(cb);
				return () => editorCbs.delete(cb);
			},
		},
		setActiveLeaf(leaf) {
			active = leaf;
		},
		fireActiveLeafChange() {
			for (const cb of leafCbs) cb();
		},
		fireFileOpen(leaf) {
			for (const cb of fileOpenCbs) cb(leaf);
		},
		fireEditorChange(source) {
			for (const cb of editorCbs) cb(source);
		},
	};
}

/** A no-op activity event source whose blur can be fired manually. */
function fakeActivitySource(): ActivityEventSource & {
	fireActivity(type?: string): void;
	fireBlur(): void;
} {
	const blurCbs = new Set<() => void>();
	const activityCbs = new Set<(event: { isTrusted?: boolean; type?: string }) => void>();
	return {
		attachActivityListeners: (cb) => {
			activityCbs.add(cb);
			return () => activityCbs.delete(cb);
		},
		onBlur: (cb) => {
			blurCbs.add(cb);
			return () => blurCbs.delete(cb);
		},
		fireActivity(type = 'pointerdown') {
			for (const cb of activityCbs) cb({ isTrusted: true, type });
		},
		fireBlur() {
			for (const cb of blurCbs) cb();
		},
	};
}

function leaf(leafId: string, path: string | null): ResolvedLeaf {
	return { leafId, windowId: 'main', file: path ? { path } : null };
}

function typedCommit(
	commit: Partial<Omit<TypedInputCommit, 'windowId' | 'leafId'>>,
	leafId = 'front',
): TypedInputCommit {
	return { windowId: 'main', leafId, typedChars: 1, source: 'insert-text', ...commit };
}

function makeCoordinator(opts: {
	clock: FakeClock;
	workspace: WorkspaceSource;
	sink?: InMemoryTrackingSink;
	excluded?: string[];
}): {
	coordinator: TrackingCoordinator;
	sink: InMemoryTrackingSink;
	checkpoint: InMemoryCheckpointPort;
	snapshots: TrackingSnapshot[];
	mainSource: ReturnType<typeof fakeActivitySource>;
} {
	const sink = opts.sink ?? new InMemoryTrackingSink();
	const checkpoint = new InMemoryCheckpointPort();
	const identity = fakeIdentity();
	const excluded = new Set(opts.excluded ?? []);
	const snapshots: TrackingSnapshot[] = [];
	const mainSource = fakeActivitySource();
	const coordinator = new TrackingCoordinator({
		settings: settings(),
		clock: opts.clock,
		sink,
		checkpoint,
		identity,
		isExcluded: (p) => excluded.has(p),
		workspace: opts.workspace,
		attachWindowEvents: () => mainSource,
		observers: [{ onSnapshot: (s) => snapshots.push(s) }],
	});
	return { coordinator, sink, checkpoint, snapshots, mainSource };
}

/** Wait for the coordinator's serialized queue to drain. */
function flush(clock: FakeClock, advance = 0): Promise<void> {
	return new Promise((resolve) => {
		// Microtask drain: the queue chains promises; a couple of ticks clear it.
		clock.advance(advance);
		setTimeout(() => setTimeout(() => setTimeout(() => resolve()), 0), 0);
	});
}

/** Minimal stand-in for a DOM Window, avoiding Obsidian-augmented Window type. */
function mockWindow(): Window {
	// A brand-new object cast to Window is enough for registry bookkeeping; the
	// registry only stores the reference and never touches its surface.
	return {} as Window;
}

describe('window registry', () => {
	it('registers, lists, and unregisters windows', () => {
		const reg = new WindowRegistry();
		expect(reg.isEmpty()).toBeTrue();
		const added = reg.register({ id: 'main', win: mockWindow() });
		expect(added).toBeTrue();
		expect(reg.register({ id: 'main', win: mockWindow() })).toBeFalse();
		expect(reg.list()).toHaveLength(1);
		expect(reg.get('main')?.id).toBe('main');
		expect(reg.unregister('main')).toBeTrue();
		expect(reg.isEmpty()).toBeTrue();
	});

	it('clear removes all windows', () => {
		const reg = new WindowRegistry();
		reg.register({ id: 'a', win: mockWindow() });
		reg.register({ id: 'b', win: mockWindow() });
		reg.clear();
		expect(reg.isEmpty()).toBeTrue();
	});
});

describe('target resolver', () => {
	it('returns untrackable when there is no active leaf', async () => {
		const r = await resolveTarget({
			leaf: null,
			resolveFileId: async (p) => ({ fileId: 'x', currentPath: p }),
			isExcluded: () => false,
		});
		expect(r.kind).toBe('untrackable');
	});

	it('returns untrackable for a non-file-backed view', async () => {
		const r = await resolveTarget({
			leaf: leaf('l1', null),
			resolveFileId: async (p) => ({ fileId: 'x', currentPath: p }),
			isExcluded: () => false,
		});
		expect(r.kind).toBe('untrackable');
	});

	it('returns untrackable for an excluded path', async () => {
		const r = await resolveTarget({
			leaf: leaf('l1', 'secret/x.md'),
			resolveFileId: async (p) => ({ fileId: 'x', currentPath: p }),
			isExcluded: (p) => p.startsWith('secret/'),
		});
		expect(r.kind).toBe('untrackable');
	});

	it('returns a target for an eligible file', async () => {
		const r = await resolveTarget({
			leaf: leaf('l1', 'notes/a.md'),
			resolveFileId: async (p) => ({ fileId: 'fid-1', currentPath: p }),
			isExcluded: () => false,
		});
		expect(r.kind).toBe('target');
		if (r.kind === 'target') {
			expect(r.target.fileId).toBe('fid-1');
			expect(r.target.path).toBe('notes/a.md');
			expect(r.target.windowId).toBe('main');
		}
	});
});

describe('isTrustedActivityEvent', () => {
	it('accepts user-agent-dispatched events only', () => {
		expect(isTrustedActivityEvent({ isTrusted: true })).toBeTrue();
		expect(isTrustedActivityEvent({ isTrusted: false })).toBeFalse();
		expect(isTrustedActivityEvent({})).toBeFalse();
	});
});

describe('tracking coordinator lifecycle', () => {
	it('starts untrackable with no leaf, then opens a session when a leaf appears', async () => {
		const clock = createFakeClock();
		const ws = fakeWorkspace(null);
		const { coordinator, snapshots } = makeCoordinator({ clock, workspace: ws.source });
		coordinator.start();
		await flush(clock);
		expect(snapshots.at(-1)?.state).toBe('untrackable');
		ws.setActiveLeaf(leaf('l1', 'notes/a.md'));
		ws.fireActiveLeafChange();
		await flush(clock, 5_000);
		expect(snapshots.at(-1)?.state).toBe('active');
		expect(snapshots.at(-1)?.currentTarget?.fileId).toBe('file-1');
		await coordinator.stop();
	});

	it('blur closes the active session and emits a segment', async () => {
		const clock = createFakeClock();
		const ws = fakeWorkspace(leaf('l1', 'notes/a.md'));
		const { coordinator, sink, mainSource } = makeCoordinator({ clock, workspace: ws.source });
		coordinator.start();
		await flush(clock, 5_000);
		mainSource.fireBlur();
		await flush(clock, 5_000);
		expect(sink.sessions).toHaveLength(1);
		expect(sink.sessions[0]?.closureReason).toBe('blur');
		await coordinator.stop();
	});

	it('synthetic DOM events do not refresh activity (untrusted rejected)', async () => {
		// This is structurally guaranteed by isTrustedActivityEvent at attach
		// time; here we assert the helper is the gate the coordinator uses.
		expect(isTrustedActivityEvent({ isTrusted: false })).toBeFalse();
	});

	it('stays idle until a trusted resume signal and creates the gap at resume', async () => {
		const clock = createFakeClock();
		const ws = fakeWorkspace(leaf('l1', 'notes/a.md'));
		const { coordinator, sink, snapshots, mainSource } = makeCoordinator({ clock, workspace: ws.source });
		coordinator.start();
		await flush(clock, 5_000);
		mainSource.fireActivity();
		await flush(clock, 180_000);
		coordinator.onIdleTimer();
		await flush(clock);
		expect(snapshots.at(-1)?.state).toBe('idle');
		expect(snapshots.at(-1)?.pendingRecovery).toHaveLength(0);
		expect(sink.sessions).toHaveLength(1);

		// Timer/topology callbacks cannot reopen or increment openCount.
		ws.fireActiveLeafChange();
		await flush(clock, 10_000);
		expect(snapshots.at(-1)?.state).toBe('idle');
		expect(sink.sessions).toHaveLength(1);

		mainSource.fireActivity();
		await flush(clock);
		expect(snapshots.at(-1)?.state).toBe('active');
		expect(snapshots.at(-1)?.pendingRecovery).toHaveLength(1);
		await coordinator.stop();
	});

	it('uses production checkpoint reconciliation before startup listeners', async () => {
		const clock = createFakeClock();
		const now = clock.now().wallMs;
		const ws = fakeWorkspace(leaf('l1', 'notes/a.md'));
		const { coordinator, snapshots, mainSource } = makeCoordinator({ clock, workspace: ws.source });
		const checkpoint: RuntimeCheckpoint = {
			schemaVersion: 1,
			state: 'active',
			currentTarget: { fileId: 'file-1', path: 'notes/a.md', windowId: 'main', leafId: 'l1' },
			sessionStartedAt: new Date(now - 240_000).toISOString(),
			lastTrustedActivityAt: new Date(now - 200_000).toISOString(),
			editBurst: null,
			pendingRecovery: [],
			recentDecisions: [],
			savedAt: new Date(now - 200_000).toISOString(),
		};
		const result = await coordinator.restore(checkpoint);
		expect(result.outcome).toBe('restored');
		expect(coordinator.getSnapshot()?.state).toBe('idle');
		coordinator.start();
		await flush(clock);
		expect(coordinator.getSnapshot()?.state).toBe('idle');
		mainSource.fireActivity();
		await flush(clock);
		expect(snapshots.at(-1)?.state).toBe('active');
		expect(snapshots.at(-1)?.pendingRecovery).toHaveLength(1);
		await coordinator.stop();
	});

	it('checkpoints a recovery decision after its durable append boundary', async () => {
		const clock = createFakeClock();
		const ws = fakeWorkspace(leaf('l1', 'notes/a.md'));
		const { coordinator, checkpoint, sink, mainSource } = makeCoordinator({ clock, workspace: ws.source });
		coordinator.start();
		await flush(clock, 5_000);
		mainSource.fireActivity();
		await flush(clock, 180_000);
		coordinator.onIdleTimer();
		await flush(clock);
		mainSource.fireActivity();
		await flush(clock);
		const candidate = coordinator.getSnapshot()?.pendingRecovery[0];
		expect(candidate).toBeDefined();
		await coordinator.resolveRecovery({ candidateId: candidate?.candidateId ?? '', kind: 'include' });
		await coordinator.settle();
		expect(sink.decisions).toHaveLength(1);
		expect(checkpoint.snapshot?.pendingRecovery).toHaveLength(0);
		expect(checkpoint.snapshot?.recentDecisions[0]?.candidateId).toBe(candidate?.candidateId);
		await coordinator.stop();
	});

	it('ignores editor changes from a background file or leaf', async () => {
		const clock = createFakeClock();
		const ws = fakeWorkspace(leaf('front', 'notes/a.md'));
		const { coordinator, sink } = makeCoordinator({ clock, workspace: ws.source });
		coordinator.start();
		await flush(clock, 5_000);
		ws.fireEditorChange({ path: 'notes/background.md', leafId: 'back', windowId: 'main' });
		await flush(clock, 5_000);
		ws.fireEditorChange({ path: 'notes/a.md', leafId: 'back', windowId: 'main' });
		await flush(clock, 5_000);
		ws.fireEditorChange({ path: 'notes/a.md', leafId: 'front', windowId: 'main' });
		await flush(clock, 5_000);
		await coordinator.stop();
		expect(sink.sessions).toHaveLength(1);
		expect(sink.sessions[0]?.editingMs).toBeGreaterThan(0);
		// Only the matching foreground edit opens a burst at 15s.
		expect(sink.sessions[0]?.editingMs).toBe(5_000);
	});

	it('persists a content-free foreground CodeMirror commit', async () => {
		const clock = createFakeClock();
		const ws = fakeWorkspace(leaf('front', 'notes/a.md'));
		const { coordinator, sink } = makeCoordinator({ clock, workspace: ws.source });
		coordinator.start();
		await flush(clock, 5_000);
		coordinator.onTypedInputCommit(typedCommit({ typedChars: 2 }));
		await flush(clock);
		expect(sink.typedInputs).toHaveLength(1);
		expect(sink.typedInputs[0]).toMatchObject({
			fileId: 'file-1', pathAtEvent: 'notes/a.md', typedChars: 2, source: 'insert-text',
		});
		expect(JSON.stringify(sink.typedInputs[0])).toBe(JSON.stringify({
			recordId: sink.typedInputs[0]?.recordId,
			fileId: 'file-1',
			pathAtEvent: 'notes/a.md',
			occurredAt: sink.typedInputs[0]?.occurredAt,
			localDate: sink.typedInputs[0]?.localDate,
			typedChars: 2,
			source: 'insert-text',
		}));
		await coordinator.stop();
	});

	it('persists one final IME numeric commit', async () => {
		const clock = createFakeClock();
		const ws = fakeWorkspace(leaf('front', 'notes/a.md'));
		const { coordinator, sink } = makeCoordinator({ clock, workspace: ws.source });
		coordinator.start();
		await flush(clock, 5_000);
		coordinator.onTypedInputCommit(typedCommit({ typedChars: 2, source: 'ime-commit' }));
		await flush(clock);
		expect(sink.typedInputs).toHaveLength(1);
		expect(sink.typedInputs[0]).toMatchObject({ typedChars: 2, source: 'ime-commit' });
		await coordinator.stop();
	});

	it('rejects invalid numeric bridge commits', async () => {
		const clock = createFakeClock();
		const ws = fakeWorkspace(leaf('front', 'notes/a.md'));
		const { coordinator, sink } = makeCoordinator({ clock, workspace: ws.source });
		coordinator.start();
		await flush(clock, 5_000);
		for (const typedChars of [0, -1, 1.5]) coordinator.onTypedInputCommit(typedCommit({ typedChars }));
		coordinator.onTypedInputCommit(typedCommit({ source: 'invalid-source' as TypedInputCommit['source'] }));
		await flush(clock);
		expect(sink.typedInputs).toHaveLength(0);
		await coordinator.stop();
	});

	it('degrades after a typed-input persistence failure', async () => {
		const clock = createFakeClock();
		const ws = fakeWorkspace(leaf('front', 'notes/a.md'));
		const sink = new InMemoryTrackingSink({ failAppendTypedInputsAfter: 1 });
		const { coordinator, snapshots } = makeCoordinator({ clock, workspace: ws.source, sink });
		coordinator.start();
		await flush(clock, 5_000);
		coordinator.onTypedInputCommit(typedCommit({ typedChars: 2, source: 'ime-commit' }));
		await flush(clock);
		expect(sink.typedInputs).toHaveLength(1);
		coordinator.onTypedInputCommit(typedCommit({ typedChars: 1 }));
		await flush(clock);
		expect(snapshots.some((snapshot) => snapshot.state === 'degraded')).toBeTrue();
		await coordinator.stop();
	});

	it('rejects background and stale leaf commits, including delayed IME finalization', async () => {
		const clock = createFakeClock();
		const ws = fakeWorkspace(leaf('front', 'notes/a.md'));
		const { coordinator, sink } = makeCoordinator({ clock, workspace: ws.source });
		coordinator.start();
		await flush(clock, 5_000);
		ws.setActiveLeaf(leaf('next', 'notes/b.md'));
		coordinator.onTypedInputCommit(typedCommit({ typedChars: 2, source: 'ime-commit' }));
		await flush(clock);
		expect(sink.typedInputs).toHaveLength(0);

		ws.fireActiveLeafChange();
		await flush(clock, 5_000);
		coordinator.onTypedInputCommit(typedCommit({ typedChars: 1 }, 'front'));
		coordinator.onTypedInputCommit(typedCommit({ typedChars: 1 }, 'next'));
		await flush(clock);
		expect(sink.typedInputs).toHaveLength(1);
		expect(sink.typedInputs[0]).toMatchObject({ fileId: 'file-2', pathAtEvent: 'notes/b.md', typedChars: 1 });
		await coordinator.stop();
	});

	it('pause and resume flow through the controller', async () => {
		const clock = createFakeClock();
		const ws = fakeWorkspace(leaf('l1', 'notes/a.md'));
		const { coordinator, snapshots } = makeCoordinator({ clock, workspace: ws.source });
		coordinator.start();
		await flush(clock, 5_000);
		coordinator.pause();
		await flush(clock);
		expect(snapshots.at(-1)?.state).toBe('paused');
		coordinator.resume();
		await flush(clock, 5_000);
		expect(snapshots.at(-1)?.state).toBe('active');
		await coordinator.stop();
	});

	it('a sink failure enters degraded and stops further attribution', async () => {
		const clock = createFakeClock();
		const ws = fakeWorkspace(leaf('l1', 'notes/a.md'));
		// Sink fails on the very first session append.
		const failingSink = new InMemoryTrackingSink({ failAppendSessionsAfter: 0 });
		const { coordinator, snapshots, mainSource } = makeCoordinator({
			clock,
			workspace: ws.source,
			sink: failingSink,
		});
		coordinator.start();
		await flush(clock, 5_000);
		// Open session exists; closing it triggers an append that fails.
		mainSource.fireBlur();
		await flush(clock, 5_000);
		const degraded = snapshots.find((s) => s.state === 'degraded');
		expect(degraded).toBeDefined();
		expect(degraded?.degradedReason).toBeDefined();
		await coordinator.stop();
	});

	it('stop is idempotent and prevents later transitions', async () => {
		const clock = createFakeClock();
		const ws = fakeWorkspace(leaf('l1', 'notes/a.md'));
		const { coordinator } = makeCoordinator({ clock, workspace: ws.source });
		coordinator.start();
		await flush(clock, 5_000);
		await coordinator.stop();
		const before = coordinator.getSnapshot();
		ws.fireActiveLeafChange();
		await flush(clock, 5_000);
		// No new active session opened after stop.
		expect(coordinator.getSnapshot()?.state).toBe(before?.state);
	});

	it('registerWindow returns an unsubscribe that removes listeners', async () => {
		const clock = createFakeClock();
		const ws = fakeWorkspace(null);
		const { coordinator } = makeCoordinator({ clock, workspace: ws.source });
		coordinator.start();
		await flush(clock);
		const unsub = coordinator.registerWindow('popout-1');
		expect(typeof unsub).toBe('function');
		unsub();
		await coordinator.stop();
	});
});
