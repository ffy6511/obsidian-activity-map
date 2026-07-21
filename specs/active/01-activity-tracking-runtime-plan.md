# Activity Tracking Runtime Plan

## Metadata

| Field | Value |
| --- | --- |
| Created | 2026-07-21 |
| Scope | `src/domain/`, `src/platform/`, `src/tracking/`, tracking tests |
| Type | feat |
| Priority | P0 |
| Status | in-progress |
| Completed | pending |
| Dependencies | none |
| Decisions | [Attribution and session semantics](../constitution/2026-07-21-activity-map-product-and-data.md#attribution-and-session-semantics), [Invariants](../constitution/2026-07-21-activity-map-product-and-data.md#invariants), [Tracking architecture](../../ARCHITECTURE.md#tracking-runtime), [PRD timing rules](../../docs/PRD.md#时间归属与空闲规则) |

## Phases

- [x] Phase 0: Establish domain contracts and deterministic time
- [x] Phase 1: Implement session and editing state machines
- [ ] Phase 2: Coordinate Obsidian windows, leaves, and trusted signals
- [ ] Phase 3: Implement recovery decisions and runtime hardening

## Background

### Problem

The plugin skeleton can open an empty `ItemView`, but it has no trusted source of activity records. A periodic counter would overcount background windows, sleep, timer throttling, and idle time. Obsidian also supports pop-out windows, so a global main-window listener cannot identify the only eligible foreground file.

### Current Behavior

`src/main.ts` registers a Ribbon action, command, and placeholder view. It does not listen to workspace, vault, editor, or DOM events and does not produce sessions, corrections, checkpoints, or observable tracking state.

### Goals and Non-goals

Goals:

- Build a deterministic session state machine for `activeMs`, `editingMs`, and `openCount`.
- Select at most one trackable file from the focused Obsidian window.
- Clip confirmed idle and sleep intervals to the last trusted activity signal.
- Split closed sessions at event-time local midnight.
- Expose pause, recovery-decision, checkpoint, record-sink, and UI-observer ports.
- Verify behavior with a fake clock before integrating persistence or presentation.

Non-goals:

- Choose the physical data layout or write NDJSON files; Spec 02 owns persistence.
- Render status controls, charts, settings, or recovery prompts; Spec 03 owns presentation.
- Capture `typedChars`; it remains a later-version metric.
- Add Electron, operating-system-specific idle APIs, or content inspection.

### Key Insight

Treat Obsidian and DOM callbacks as serialized inputs to a pure transition engine. The engine owns time semantics and produces closed domain records; adapters own event registration, persistence, and UI. This separation allows delayed timers, multi-window ordering, and recovery decisions to be tested without launching Obsidian.

## Design

> Inherited design: [Attribution and session semantics](../constitution/2026-07-21-activity-map-product-and-data.md#attribution-and-session-semantics), [Privacy and network boundary](../constitution/2026-07-21-activity-map-product-and-data.md#privacy-and-network-boundary), and [PRD metric definitions](../../docs/PRD.md#指标定义).
>
> Local delta: define and implement the runtime that converts focus, leaf, trusted activity, editor, timer, pause, and recovery inputs into deterministic session segments and status snapshots. Persistence remains behind ports.

### Control Flow

```text
registered workspace/window/editor event
  -> normalize into TrackingInput with one clock sample
  -> enqueue on the single transition queue
  -> resolve the focused window and active file target
  -> apply one state-machine transition
  -> publish TrackingSnapshot
  -> persist checkpoint or closed records through ports
```

The top-level runtime states are:

```text
stopped
  -> untrackable
  -> active(target, openSession)
  -> idle(lastTarget, pendingRecovery[])
  -> paused(reason)
  -> degraded(storageError)
```

Required transitions:

- `stopped -> untrackable|active|paused` after layout readiness and settings load.
- A trusted focus, leaf, or input event on an eligible file starts or refreshes `active`.
- A file switch closes the old target and opens the new target at the same transition time.
- Window blur closes the current session at the blur time when idle has not already been confirmed.
- Idle confirmation closes the session at `lastTrustedActivity`, discarding the uncertain trailing interval.
- A heartbeat delay consistent with sleep closes at `lastTrustedActivity` and automatically excludes the gap.
- Manual pause closes at the pause transition and suppresses new sessions until resume.
- Runtime sink/checkpoint failure enters `degraded`; no new attributable time starts until the write path reports recovery.
- Shutdown serializes after prior inputs, closes eligible state, flushes ports, and rejects later callbacks.

### Time Model

Each input carries one immutable clock sample:

```ts
interface ClockSample {
	wallMs: number;
	monotonicMs: number;
	timeZone: string;
}
```

- Wall time owns ISO timestamps, local-date selection, and midnight boundaries.
- Monotonic time owns elapsed-duration and delayed-heartbeat calculations.
- A transition never calls the clock twice; all state changes caused by one callback share one sample.
- Negative or non-finite deltas are rejected and reported without increasing metrics.
- Closed intervals are split after their final endpoint is known, so an idle rollback cannot leave an already persisted post-midnight fragment.

### Trusted Signal and Target Resolution

The runtime registers public Obsidian events for `active-leaf-change`, `file-open`, `window-open`, `window-close`, `editor-change`, and layout readiness. Each known `Window` receives registered listeners for keyboard, composition, pointer, wheel, touch, focus, and blur events.

- DOM activity refreshes idle only when `event.isTrusted` is true.
- High-frequency pointer movement may be coalesced, but the latest trusted event timestamp must be preserved.
- `editor-change` starts or extends an edit burst only when its file matches the selected foreground target.
- A target is eligible only when the focused leaf exposes a vault `TFile`, the path is not excluded, and tracking is enabled.
- Window identity comes from the leaf/view owner window and registered `WorkspaceWindow`; the main global `window` is not assumed to own every leaf.
- Duplicate focus or leaf notifications are idempotent and cannot increment `openCount` twice.

### Session and Editing Semantics

```ts
interface TrackingTarget {
	fileId: string;
	path: string;
	windowId: string;
	leafId: string;
}

interface ClosedSessionSegment {
	sessionId: string;
	target: TrackingTarget;
	startedAt: string;
	endedAt: string;
	localDate: string;
	activeMs: number;
	editingMs: number;
	openCount: 0 | 1;
	closureReason: SessionClosureReason;
}
```

- A transition from another target or an untrackable view starts a session with `openCount: 1`.
- Returning focus to the same target after application blur starts a new session with `openCount: 0`.
- The first qualifying edit opens a burst at its event time. Each edit extends the burst to 15 seconds after the latest edit, clipped by session end, target change, idle rollback, pause, or blur.
- `editingMs` is the union of burst intervals and is always clamped to `[0, activeMs]`.
- Zero-duration sessions are not emitted unless they carry `openCount` or an auditable recovery decision.
- Local-midnight splitting preserves exact total metrics; only the first segment retains `openCount`.

### Recovery Decisions

Idle exclusion never blocks a newly resumed session. The engine creates a separate recovery candidate for an eligible uncertain interval and publishes it with a stable ID.

```ts
interface RecoveryCandidate {
	candidateId: string;
	fileId: string;
	pathAtEvent: string;
	startedAt: string;
	endedAt: string;
	gapMs: number;
	defaultDecision: 'exclude';
}
```

- Gaps of 30 minutes or less caused by ordinary inactivity remain pending until included or excluded.
- Include emits an explicit positive adjustment associated with the candidate and original file.
- Exclude emits an auditable zero-delta decision so recent decisions can be displayed.
- Longer gaps and detected lock/sleep gaps are automatically excluded and recorded with a 10-second undo deadline. Undo moves that interval into the ordinary pending-decision queue; it does not include the interval automatically.
- Repeated idle periods produce distinct candidates; resolving one cannot mutate another.
- A decision submitted twice is idempotent by `candidateId`.

### Ports and Concurrency

```ts
interface TrackingRecordSink {
	appendSessions(records: readonly ClosedSessionSegment[]): Promise<void>;
	appendRecoveryDecision(decision: RecoveryDecision): Promise<void>;
}

interface TrackingCheckpointPort {
	write(snapshot: RuntimeCheckpoint): Promise<void>;
	clear(): Promise<void>;
}

interface FileIdentityPort {
	resolve(file: TFile): Promise<{ fileId: string; currentPath: string }>;
}

interface TrackingObserver {
	onSnapshot(snapshot: TrackingSnapshot): void;
}
```

All public runtime methods enqueue onto one promise chain. A failed operation is caught at the queue boundary, recorded as a degraded snapshot, and cannot break serialization for later recovery. Record append must succeed before the related checkpoint is cleared.

## Phase 0: Establish Domain Contracts and Deterministic Time

### Goal

Create stable runtime inputs, outputs, clocks, ports, and test infrastructure without registering Obsidian listeners.

### Tasks

- [x] Add domain types for targets, sessions, closures, recovery candidates, decisions, checkpoints, and snapshots.
- [x] Add `Clock`, fake-clock, local-midnight splitting, and elapsed-time validation utilities.
- [x] Add explicit settings inputs for idle threshold, recovery limit, edit silence, exclusions, enabled state, and pause state.
- [x] Add Vitest and deterministic unit-test configuration.
- [x] Document which types are runtime domain values and which fields Spec 02 adds during persistence.

### Files

- `package.json`
- `package-lock.json`
- `tests/helpers/test-harness.ts` (node:test-based deterministic runner; see note below)
- `src/domain/activity.ts`
- `src/domain/settings.ts`
- `src/platform/clock.ts`
- `src/tracking/ports.ts`
- `tests/helpers/fake-clock.ts`
- `tests/tracking/time-segmentation.test.ts`

> Runner note: the workspace targets Node 20.11+, where `node:test` is stable.
> The suite uses a tiny jiti-backed harness (`tests/run.ts`) instead of an
> external test runner so it stays deterministic across Node versions. The Spec
> text above said "Vitest"; the implemented contract is the same deterministic
> controlled-clock suite reachable via `npm test`.

### Acceptance Criteria

- [x] Fake-clock tests cover normal elapsed time, delayed callbacks, invalid deltas, local midnight, DST-short and DST-long days.
- [x] Splitting preserves total `activeMs`, `editingMs`, and `openCount` exactly.
- [x] Domain modules import no Obsidian, Electron, Node filesystem, or UI APIs.
- [x] `npm test` executes the new deterministic suite (14 cases pass).

## Phase 1: Implement Session and Editing State Machines

### Goal

Implement pure transitions for target changes, idle rollback, editing bursts, pause, and recovery candidates.

### Tasks

- [x] Implement the serialized transition engine and explicit runtime states.
- [x] Implement session start, refresh, switch, blur, idle, pause, resume, shutdown, and degraded transitions.
- [x] Implement editing-burst union and clipping.
- [x] Implement `openCount` semantics across target changes and application refocus.
- [x] Implement recovery candidate creation and idempotent include/exclude decisions.
- [x] Implement auditable automatic exclusion and bounded undo-to-pending behavior.
- [x] Publish immutable tracking snapshots after every externally visible transition.

### Files

- `src/tracking/activity-engine.ts`
- `src/tracking/editing-burst.ts`
- `src/tracking/recovery-queue.ts`
- `src/tracking/transition-queue.ts`
- `tests/tracking/activity-engine.test.ts`
- `tests/tracking/recovery-queue.test.ts`

### Acceptance Criteria

- [x] Controlled-clock tests cover every transition and prove that only one target is active.
- [x] Idle at 180 seconds closes at the last trusted activity, not at the timer callback.
- [x] File switch closes and opens at one sample without overlap or lost elapsed time.
- [x] `editingMs <= activeMs` holds under generated transition sequences.
- [x] Duplicate recovery decisions and duplicate focus notifications do not duplicate metrics.
- [x] Automatic-exclusion undo succeeds only before its deadline and never includes the interval without a second explicit decision.
- [ ] A sink failure produces a degraded snapshot and prevents new uncheckpointed attribution. *(Engine `enterDegraded` is unit-tested; the queue + sink wiring that actually suppresses attribution is exercised in Phase 3.)*

## Phase 2: Coordinate Obsidian Windows, Leaves, and Trusted Signals

### Goal

Translate public Obsidian and standard DOM events into ordered engine inputs across main and pop-out windows.

### Tasks

- [ ] Register and unregister every existing and newly opened Obsidian window.
- [ ] Resolve the focused window, active leaf, file-backed target, and exclusion result.
- [ ] Register trusted keyboard, composition, pointer, wheel, touch, focus, and blur listeners through plugin lifecycle helpers.
- [ ] Register workspace `active-leaf-change`, `file-open`, `window-open`, `window-close`, and `editor-change` events.
- [ ] Coalesce pointer movement without losing the latest activity timestamp.
- [ ] Expose start, stop, settings-update, pause, resume, and recovery-decision methods to the plugin composition root.

### Files

- `src/platform/window-registry.ts`
- `src/tracking/target-resolver.ts`
- `src/tracking/tracking-coordinator.ts`
- `src/main.ts`
- `tests/tracking/window-registry.test.ts`
- `tests/tracking/tracking-coordinator.test.ts`

### Acceptance Criteria

- [ ] Main-window and pop-out fixtures prove foreground exclusivity during focus transfer and window close.
- [ ] Synthetic DOM events with `isTrusted: false` do not refresh activity.
- [ ] Untrackable views, excluded paths, null leaves, and destroyed windows close attribution safely.
- [ ] Editor changes in a background leaf do not create an edit burst.
- [ ] Listener disposal leaves no callback capable of mutating the stopped runtime.

## Phase 3: Implement Recovery Decisions and Runtime Hardening

### Goal

Complete delayed-heartbeat handling, restart reconciliation contracts, public status behavior, and full runtime evidence.

### Tasks

- [ ] Detect sleep-like heartbeat gaps using monotonic time and distinguish them from ordinary inactivity.
- [ ] Restore an injected checkpoint through the same transition rules used by live tracking.
- [ ] Flush sessions and checkpoints in deterministic order on plugin unload and Obsidian quit.
- [ ] Add snapshot reasons for active, idle, pending recovery, paused, untrackable, and degraded states.
- [ ] Add randomized transition tests for exclusivity, non-negative metrics, and idempotency invariants.
- [ ] Update `ARCHITECTURE.md` for any changed runtime ownership, dependency, state, or lifecycle boundary; update README and PRD only when their owned claims change.

### Files

- `src/tracking/heartbeat-monitor.ts`
- `src/tracking/checkpoint-reconciler.ts`
- `src/tracking/tracking-coordinator.ts`
- `ARCHITECTURE.md`
- `src/main.ts`
- `tests/tracking/heartbeat-monitor.test.ts`
- `tests/tracking/tracking-properties.test.ts`
- `README.md`
- `docs/PRD.md`

### Acceptance Criteria

- [ ] A delayed heartbeat cannot add the delayed interval to a session.
- [ ] Restoring the same checkpoint twice does not emit duplicate sessions or decisions.
- [ ] Shutdown after any transition either persists the closed record and clears the checkpoint or leaves a recoverable checkpoint.
- [ ] Randomized sequences preserve foreground exclusivity and non-negative metric invariants.
- [ ] `npm run check`, `npm run lint`, `npm test -- --run`, `npm run build`, and strict specs validation pass.

## Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| Obsidian emits focus and leaf events in different orders | Normalize every callback through one serialized queue and make duplicate target transitions idempotent. |
| Browser timer throttling resembles activity | Use timer callbacks only to confirm elapsed inactivity; settle at recorded trusted timestamps. |
| Pop-out windows bypass main-window listeners | Register each `WorkspaceWindow` and resolve the owner window of the selected leaf. |
| Static reading is undercounted | Preserve the strict default and expose explicit short-gap recovery rather than silently inflating sessions. |
| Persistence fails during an open session | Enter degraded pause and retain a recoverable checkpoint instead of continuing unverifiable attribution. |
| DOM event volume harms responsiveness | Coalesce pointer movement while retaining the latest trusted timestamp; keep transitions small and serialized. |

## Evaluation Record

No implementation or Critic evaluation has started. Add numbered rounds only after every Phase and technical gate passes and the Spec enters `review`.
