/**
 * Tracking coordinator.
 *
 * The coordinator is the runtime facade that converts public Obsidian and
 * standard DOM events into ordered engine inputs across main and pop-out
 * windows, owns the single transition queue, and drives ports and observers.
 *
 * Responsibilities:
 * - Register/unregister Obsidian windows and DOM trusted-signal listeners
 *   through lifecycle-owned hooks so teardown leaves no callback behind.
 * - Resolve the focused window's active leaf into an eligible target, awaiting
 *   file-identity resolution while keeping transitions serialized.
 * - Hand normalized {@link EngineInput}s to the {@link ActivityEngine}.
 * - Forward emissions to the record sink and snapshots to observers, entering
 *   `degraded` on sink/checkpoint failure.
 *
 * The engine stays pure; the coordinator owns all side effects and async
 * ordering. Idle timers and heartbeat scheduling are wired by the host plugin
 * (Spec 03 lifecycle), which calls {@link TrackingCoordinator.onIdleTimer} and
 * {@link TrackingCoordinator.onHeartbeat}.
 */

import type {
	RecoveryDecision,
	RuntimeCheckpoint,
	TrackingSnapshot,
	TypedInputRecord,
} from '../domain/activity';
import type { ActivityMapSettings } from '../domain/settings';
import { localDateFor, type Clock } from '../platform/clock';
import { ActivityEngine, type EngineEmissions } from './activity-engine';
import { reconcileCheckpoint, type ReconcileResult } from './checkpoint-reconciler';
import {
	isTrustedActivityEvent,
	resolveTarget,
	type ExclusionChecker,
	type ResolvedLeaf,
} from './target-resolver';
import type {
	FileIdentityPort,
	TrackingCheckpointPort,
	TrackingObserver,
	TrackingRecordSink,
} from './ports';
import { TransitionQueue } from './transition-queue';
import type { TypedInputCount } from './typed-input';

/** Source of workspace/leaf observations, abstracted so tests can fake it. */
export interface WorkspaceSource {
	/** Resolve the currently focused leaf across all windows. */
	getActiveLeaf(): ResolvedLeaf | null;
	/** Subscribe to leaf/focus changes; returns an unsubscribe. */
	onActiveLeafChange(cb: () => void): () => void;
	/** Subscribe to file-open events; returns an unsubscribe. */
	onFileOpen(cb: (leaf: ResolvedLeaf) => void): () => void;
	/** Subscribe to editor changes with their originating file/view identity. */
	onEditorChange(cb: (source: EditorChangeSource) => void): () => void;
}

export interface EditorChangeSource {
	path: string;
	leafId?: string;
	windowId?: string;
}

/** Source of trusted activity events for one window. */
export interface ActivityEventSource {
	/** Register trusted keyboard/composition/pointer/wheel/touch/focus listeners. */
	attachActivityListeners(onActivity: (event: { isTrusted?: boolean; type?: string }) => void): () => void;
	/** Subscribe to window blur. */
	onBlur(cb: () => void): () => void;
}

/** A CodeMirror bridge commit with exact editor provenance and no text content. */
export interface TypedInputCommit extends TypedInputCount {
	windowId: string;
	leafId: string;
}

export interface TrackingCoordinatorOptions {
	settings: ActivityMapSettings;
	clock: Clock;
	sink: TrackingRecordSink;
	checkpoint: TrackingCheckpointPort;
	identity: FileIdentityPort;
	isExcluded: ExclusionChecker;
	workspace: WorkspaceSource;
	/** Attach per-window activity listeners; called when a window registers. */
	attachWindowEvents(winId: string): ActivityEventSource;
	observers?: TrackingObserver[];
}

export class TrackingCoordinator {
	private readonly engine: ActivityEngine;
	private readonly queue: TransitionQueue;
	private readonly opts: TrackingCoordinatorOptions;
	private readonly unsubs: Array<() => void> = [];
	private started = false;
	private stopped = false;
	private lastSnapshot: TrackingSnapshot | null = null;
	private restored = false;
	private settings: ActivityMapSettings;
	private nextTypedInputId = 1;

	constructor(opts: TrackingCoordinatorOptions) {
		this.opts = opts;
		this.settings = opts.settings;
		const callbacks = {
			onEmit: (e: EngineEmissions) => {
				// handleEmit enqueues onto the transition queue; the returned
				// promise settles there and errors are caught at the queue boundary.
				void this.handleEmit(e);
			},
			onSnapshot: (s: TrackingSnapshot) => {
				this.lastSnapshot = s;
				for (const obs of opts.observers ?? []) {
					obs.onSnapshot(s);
				}
			},
			onCheckpoint: (c: RuntimeCheckpoint) => {
				// Checkpoint writes are serialized through the queue too, so an
				// append failure cannot be masked by a later checkpoint clear.
				void this.queue.enqueue(async () => {
					try {
						await opts.checkpoint.write(c);
					} catch (error) {
						this.enterDegradedFromError(error);
					}
				});
			},
		};
		this.engine = new ActivityEngine(opts.settings, callbacks);
		this.queue = new TransitionQueue((error) => {
			// A transition threw; surface as degraded without losing serialization.
			this.enterDegradedFromError(error);
		});
	}

	/** Last published snapshot (for the controller/view initial state). */
	getSnapshot(): TrackingSnapshot | null {
		return this.lastSnapshot;
	}

	/** Start tracking: register listeners and emit the start transition. */
	start(): void {
		if (this.started || this.stopped) {
			return;
		}
		this.started = true;
		if (!this.restored) {
			this.engine.submit({ kind: 'start', sample: this.opts.clock.now() });
		}
		this.registerWorkspaceListeners();
		// A restored checkpoint was already reconciled against the initial leaf.
		// Do not let startup topology reopen idle/untrackable attribution.
		if (!this.restored) void this.refreshTarget();
	}

	/** Stop tracking and flush; rejects new transitions after this returns. */
	async stop(): Promise<void> {
		if (this.stopped) {
			return;
		}
		this.stopped = true;
		for (const unsub of this.unsubs) {
			try {
				unsub();
			} catch {
				// Listener disposal must not block shutdown.
			}
		}
		this.unsubs.length = 0;
		this.engine.submit({ kind: 'stop', sample: this.opts.clock.now() });
		await this.queue.idle();
	}

	/** Update settings; takes effect on the next transition. */
	updateSettings(settings: ActivityMapSettings): void {
		this.settings = settings;
		this.engine.submit({
			kind: 'settings',
			sample: this.opts.clock.now(),
			settings,
		});
	}

	/** Pause all tracking (user intent or safe operational pause). */
	pause(reason?: string): void {
		this.engine.submit({ kind: 'pause', sample: this.opts.clock.now(), reason });
	}

	/** Resume tracking after a user or operational pause. */
	resume(): void {
		this.engine.submit({ kind: 'resume', sample: this.opts.clock.now() });
		void this.refreshTarget();
	}

	/** Wait until all persistence triggered before this call has settled. */
	settle(): Promise<void> {
		return this.queue.idle();
	}

	/**
	 * Persist a numeric CodeMirror input commit only while its originating editor
	 * still owns the active tracking target. The platform bridge has already
	 * discarded the inserted string before calling this boundary.
	 */
	onTypedInputCommit(commit: TypedInputCommit): void {
		if (
			!Number.isSafeInteger(commit.typedChars) ||
			commit.typedChars <= 0 ||
			(commit.source !== 'insert-text' && commit.source !== 'ime-commit')
		) return;
		const target = this.currentTypedTarget(commit.windowId, commit.leafId);
		if (!target) return;
		this.appendTypedInput(commit, target, this.opts.clock.now());
	}

	/** Enter a safe degraded pause for a startup or persistence boundary error. */
	degrade(reason: string): void {
		this.engine.enterDegraded(reason, this.opts.clock.now());
	}

	/** Resolve a recovery candidate (user include/exclude intent). */
	async resolveRecovery(args: {
		candidateId: string;
		kind: 'include' | 'exclude';
	}): Promise<RecoveryDecision | null> {
		const sample = this.opts.clock.now();
		return this.queue.enqueue(() =>
			this.engine.resolveRecovery({
				candidateId: args.candidateId,
				kind: args.kind,
				decidedAt: new Date(sample.wallMs).toISOString(),
				sample,
			}),
		);
	}

	/** Undo an automatic exclusion (UI intent). */
	undoAutomaticExclusion(candidateId: string): boolean {
		return this.engine.undoAutomaticExclusion(candidateId, this.opts.clock.now());
	}

	/** Called by the host's idle timer; confirms elapsed inactivity. */
	onIdleTimer(): void {
		const sample = this.opts.clock.now();
		const last = this.lastSnapshot?.lastTrustedActivityAt;
		if (!last || sample.wallMs - Date.parse(last) < this.settings.idleThresholdMs) {
			return;
		}
		this.engine.submit({ kind: 'idle-confirm', sample });
	}

	/** Called by the host's heartbeat scheduler; detects sleep-like gaps. */
	onHeartbeat(expectedGapMs: number): void {
		this.engine.submit({
			kind: 'heartbeat',
			sample: this.opts.clock.now(),
			expectedGapMs,
		});
	}

	// --- internal ------------------------------------------------------

	private registerWorkspaceListeners(): void {
		const { workspace } = this.opts;
		this.unsubs.push(
			workspace.onActiveLeafChange(() => {
				void this.refreshTarget();
			}),
		);
		this.unsubs.push(
			workspace.onFileOpen((leaf) => {
				void this.onLeafObserved(leaf);
			}),
		);
		this.unsubs.push(
			workspace.onEditorChange((source) => {
				const target = this.lastSnapshot?.currentTarget;
				if (
					!target ||
					target.path !== source.path ||
					(source.leafId !== undefined && target.leafId !== source.leafId) ||
					(source.windowId !== undefined && target.windowId !== source.windowId)
				) {
					return;
				}
				this.engine.submit({ kind: 'edit', sample: this.opts.clock.now() });
			}),
		);
		// Attach activity listeners for the main window immediately; pop-outs
		// are attached by the host through registerWindow.
		const mainSource = this.opts.attachWindowEvents('main');
		this.unsubs.push(
			mainSource.attachActivityListeners((event) => {
				if (isTrustedActivityEvent(event)) {
					this.onTrustedActivity(event);
				}
			}),
		);
		this.unsubs.push(
			mainSource.onBlur(() => {
				this.engine.submit({ kind: 'blur', sample: this.opts.clock.now() });
			}),
		);
	}

	/** Register a pop-out window's activity listeners; returns an unregister. */
	registerWindow(winId: string): () => void {
		const source = this.opts.attachWindowEvents(winId);
		const offActivity = source.attachActivityListeners((event) => {
			if (isTrustedActivityEvent(event)) {
				this.onTrustedActivity(event);
			}
		});
		const offBlur = source.onBlur(() => {
			this.engine.submit({ kind: 'blur', sample: this.opts.clock.now() });
		});
		const unsub = () => {
			offActivity();
			offBlur();
		};
		this.unsubs.push(unsub);
		return unsub;
	}

	private async onLeafObserved(leaf: ResolvedLeaf): Promise<void> {
		// file-open fires for background opens too; only the active leaf drives
		// attribution, so re-resolve the active leaf rather than trusting `leaf`.
		void leaf;
		await this.refreshTarget();
	}

	private onTrustedActivity(event: { type?: string }): void {
		const sample = this.opts.clock.now();
		if (this.engine.getState() === 'idle') {
			void this.refreshTarget(sample, true);
			return;
		}
		if (event.type === 'focus') void this.refreshTarget(sample, true);
		this.engine.submit({ kind: 'activity', sample });
	}

	private appendTypedInput(
		counted: TypedInputCount,
		target: NonNullable<TrackingSnapshot['currentTarget']>,
		sample: ReturnType<Clock['now']>,
	): void {
		if (counted.typedChars === 0) return;
		const record: TypedInputRecord = {
			recordId: `${target.fileId}-${String(sample.wallMs)}-${String(this.nextTypedInputId++)}`,
			fileId: target.fileId,
			pathAtEvent: target.path,
			occurredAt: new Date(sample.wallMs).toISOString(),
			localDate: localDateFor(sample.wallMs, sample.timeZone),
			typedChars: counted.typedChars,
			source: counted.source,
		};
		void this.queue.enqueue(async () => {
			try {
				await this.opts.sink.appendTypedInputs([record]);
			} catch (error) {
				// Text has already been committed in the editor. Persisting an
				// unverifiable partial count would mislead users, so stop safely.
				this.enterDegradedFromError(error);
			}
		});
	}

	private currentTypedTarget(windowId: string, leafId: string): TrackingSnapshot['currentTarget'] {
		const activeLeaf = this.opts.workspace.getActiveLeaf();
		const snapshot = this.lastSnapshot;
		if (
			activeLeaf?.windowId !== windowId ||
			activeLeaf.leafId !== leafId ||
			snapshot?.state !== 'active' ||
			!snapshot.currentTarget ||
			snapshot.currentTarget.windowId !== windowId ||
			snapshot.currentTarget.leafId !== leafId
		) {
			return null;
		}
		return snapshot.currentTarget;
	}

	private async refreshTarget(
		providedSample?: ReturnType<Clock['now']>,
		allowIdleResume = false,
	): Promise<void> {
		if (this.stopped) {
			return;
		}
		if (this.engine.getState() === 'idle' && !allowIdleResume) return;
		// Serialize target resolution: file-identity is async, but transitions
		// must apply in the order we observe leaves, not in identity-resolve order.
		await this.queue.enqueue(async () => {
			if (this.stopped) {
				return;
			}
			// A topology refresh can be queued before the idle timer closes the
			// session. Recheck at execution time so that stale queued work cannot
			// become an implicit resume signal.
			if (this.engine.getState() === 'idle' && !allowIdleResume) return;
			const leaf = this.opts.workspace.getActiveLeaf();
			const resolution = await resolveTarget({
				leaf,
				resolveFileId: (path) => this.opts.identity.resolve({ path }),
				isExcluded: this.opts.isExcluded,
			});
			const sample = providedSample ?? this.opts.clock.now();
			if (resolution.kind === 'target') {
				this.engine.submit({ kind: 'focus-target', sample, target: resolution.target });
			} else {
				this.engine.submit({ kind: 'untrackable', sample, reason: resolution.reason });
			}
		});
	}

	private async handleEmit(emissions: EngineEmissions): Promise<void> {
		// Record append must succeed before related checkpoint work proceeds.
		await this.queue.enqueue(async () => {
			if (emissions.segments.length > 0) {
				try {
					await this.opts.sink.appendSessions(emissions.segments);
				} catch (error) {
					this.enterDegradedFromError(error);
					return;
				}
			}
			for (const decision of emissions.decisions) {
				try {
					await this.opts.sink.appendRecoveryDecision(decision);
				} catch (error) {
					this.enterDegradedFromError(error);
					return;
				}
			}
		});
	}

	private enterDegradedFromError(error: unknown): void {
		const reason = error instanceof Error ? error.message : 'unknown-sink-error';
		this.engine.enterDegraded(reason, this.opts.clock.now());
	}

	/** Reconcile one startup checkpoint against current focus and elapsed gap. */
	async restore(checkpoint: RuntimeCheckpoint): Promise<ReconcileResult> {
		if (this.restored) return { outcome: 'restored' };
		const sample = this.opts.clock.now();
		const leaf = this.opts.workspace.getActiveLeaf();
		const resolution = await resolveTarget({
			leaf,
			resolveFileId: (path) => this.opts.identity.resolve({ path }),
			isExcluded: this.opts.isExcluded,
		});
		const result = reconcileCheckpoint({
			checkpoint,
			engine: this.engine,
			clock: this.opts.clock,
			nowSample: sample,
			currentTarget: resolution.kind === 'target' ? resolution.target : null,
			idleThresholdMs: this.settings.idleThresholdMs,
		});
		this.restored = true;
		return result;
	}
}
