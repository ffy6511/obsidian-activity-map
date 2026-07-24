# Header Popover Locate Current File Plan

## Metadata

| Field | Value |
| --- | --- |
| Created | 2026-07-24 |
| Scope | Header Popover controls, distribution view interaction |
| Type | feat |
| Priority | P2 |
| Status | review |
| Completed | pending |
| Dependencies | [Header Popover file grouping](05-header-popover-file-grouping-plan.md) |
| Decisions | [Interface and export](../constitution/2026-07-21-activity-map-product-and-data.md#interface-and-export), [PRD chart popover](../../docs/PRD.md#环形图浮层), [Presentation architecture](../../ARCHITECTURE.md#presentation-and-export) |

## Phases

- [x] Phase 0: Add a locate-current-file action to the distribution view
- [x] Phase 1: Wire the Header Popover control, scope navigation, and highlight lifecycle
- [x] Phase 2: Synchronize documentation and collect integration evidence

## Background

### Problem

The Header Popover can drill through directories and list files under the current path, but a user looking at a specific open file has no fast way to see where that file sits in the current activity distribution. They must scan the legend or remember the breadcrumb path manually.

### Current Behavior

The Popover control row renders leading actions (tracking, grouping, poster export), then the day navigator, then the metric and range dropdowns. Distribution rendering (`SummaryPopover.renderDistribution`) already wires bidirectional highlight between the donut chart and the legend list via `onHighlight`, and both expose programmatic `highlight(itemId)` handles. There is no scroll-into-view call anywhere in `src/`. Each live `SummaryPopover` is owned by a `HeaderEntry` that already carries the `filePath` of the file-backed view whose header it lives in (`HeaderActionManager`), but that path is not currently passed into the Popover.

### Goals and Non-goals

Goals:

- Add one icon button immediately left of the metric button in the existing control row that locates the file of the Popover's owning header view.
- In file grouping, locate highlights the file's donut slice and legend row for a fixed `2s`, scrolling the legend row into view first if it is not visible.
- In path grouping, locate first navigates the scope to the current file's nearest ancestor directory (parent) while preserving path grouping, waits for the rerender to settle, then performs the same highlight.
- Highlight behaves exactly like the existing hover-driven highlight: it drives the existing donut+legend bidirectional `onHighlight` path, then clears automatically.

Non-goals:

- Change tracking, persistence, query schema, sorting, palette, top-N threshold, Other expansion, activation identity, or settings.
- Add a new control row, status text, or persistent selection state. The `2s` highlight is transient.
- Pin, select, or open the located file. Activation remains a separate click.
- Support locating a file that has no activity in the current scope (no row exists to highlight).

### Key Insight

Locate is a pure presentation action over the existing distribution result. Its only data dependency is the owning header's file path, which `HeaderActionManager` already knows. In file grouping the file's `DistributionItem` row exists whenever the file is present under the current scope, so locate reduces to "find item by path, scroll, highlight, clear". In path grouping the file may be several levels deep, so locate first narrows the scope to the parent directory (a normal `set-path` intent that preserves grouping) and then highlights once the new result is published.

## Design

> Inherited design: [Interface and export](../constitution/2026-07-21-activity-map-product-and-data.md#interface-and-export), [PRD chart popover](../../docs/PRD.md#环形图浮层), [Presentation architecture](../../ARCHITECTURE.md#presentation-and-export).
>
> Local delta: one new leading-of-query icon button, one owning-file path input into the Popover, and one transient highlight lifecycle driven by the existing chart/legend highlight handles.

### Control Flow

```text
Pop popover open
  -> render locate button immediately left of the metric button
  -> button disabled when owning header has no file path or model is not ready

Activate locate (groupBy = file)
  -> find DistributionItem with kind === 'file' && item.path === activeFilePath
  -> not found -> no-op (file not present in scope)
  -> found -> scroll legend row into view (block: 'nearest')
           -> drive chartHandle.highlight(id) and legendHandle.highlight(id)
           -> schedule clear after 2s (monotonic timer, cancel on re-render/close)

Activate locate (groupBy = path)
  -> compute parent directory of activeFilePath (vault-relative, '' for root)
  -> parent equals current query.path -> behave like the file branch
  -> else -> dispatch set-path(parent, view: 'children'), keep groupBy = path
          -> on next ready model of a newer generation:
               -> find file item under the new scope
               -> scroll + highlight + 2s clear as above
```

### Highlight Lifecycle and Cancellation

- The `2s` clear uses a single pending timer owned by the Popover. A new activation cancels the previous timer and restarts the `2s` window.
- Any full re-render (`renderIfChanged` rebuilds the distribution DOM) cancels the pending highlight and clears the applied classes, because the old chart/legend handles are destroyed. The locate action does not attempt to restore highlight across a rebuild other than the one it itself triggered via `set-path`.
- Closing the Popover cancels the pending timer (existing `destroy()` path).
- A file folded into the chart "Other" slice has no individual slice to highlight; locate still scrolls to and highlights its legend row (the detail list always retains per-file rows) and drives `chartHandle.highlight(null)` to clear any prior slice dimming only if no slice matches. The legend row is the source of truth.

### Data Flow

```text
HeaderActionManager entry.filePath  -> SummaryPopover activeFilePath input
                                      (passed at construction; read fresh on each locate)

activeFilePath + model.distribution.detailItems
  -> match by item.kind === 'file' && item.path === activeFilePath
  -> itemId -> chartHandle.highlight / legendHandle.highlight
```

### Reference Data Structures

```ts
// New input passed from HeaderActionManager into SummaryPopover.
interface LocateFileInputs {
  /** Vault-relative path of the file whose header owns this Popover, or null. */
  readonly activeFilePath: string | null;
}

// New Popover method, invoked by the control's onActivate.
// Returns false when there is nothing to locate (no file, no row).
locateCurrentFile(): boolean;
```

No changes to `DistributionQuery`, `DistributionItem`, settings, persistence, or query cache.

## Phase 0: Add a Locate-Current-File Action to the Distribution View

### Goal

Make the locate behavior a deterministic, testable operation over an existing distribution result before exposing any control.

### Tasks

- [x] Add a pure helper that, given `activeFilePath` and `detailItems`, returns the matching file `DistributionItem` or `null` (match by `kind === 'file' && item.path === activeFilePath`).
- [x] Add a pure helper that computes the parent directory of a vault-relative path (`''` for root, no trailing slash normalization beyond what breadcrumbs already expect).
- [x] Expose `locateCurrentFile()` on `SummaryPopover`: find item; when in path grouping and the file is not under the current scope, dispatch `set-path` to the parent and re-run locate on the next ready model; otherwise scroll the legend row into view (`block: 'nearest'`) and drive both highlight handles.
- [x] Implement the single cancelable `2s` highlight timer owned by the Popover; cancel it on new activation, re-render, and `destroy()`.
- [x] Add focused tests: file-grouping locate scrolls and highlights; path-grouping locate navigates scope then highlights; no row -> no-op; re-activation cancels prior timer; re-render and destroy cancel the timer; parent-of-root edge case.

### Files

- `src/ui/summary-popover.ts`
- `src/ui/locate-file.ts`
- `tests/ui/locate-current-file.behavior.test.ts`

### Acceptance Criteria

- [x] `locateCurrentFile()` highlights the matched file's slice and legend row for the configured duration and clears it afterwards, using fake timers.
- [x] In path grouping, locate narrows the scope to the parent directory when needed and highlights on the settled result of a newer generation.
- [x] A second activation during the highlight window restarts the window without overlapping clears.
- [x] Re-render (model generation change not caused by locate) and `destroy()` cancel any pending highlight.
- [x] Files folded into the chart "Other" slice still get their legend row highlighted; no slice is falsely dimmed.
- [x] Focused unit tests with fake clocks and fake adapters pass.

### Evidence

- `npm run check` — passed.
- `npm run lint` — passed.
- `npm test -- --run` — passed, 302 tests and 0 failures, including the new locate helpers, highlight lifecycle, path-scope narrowing, and control-order cases.

## Phase 1: Wire the Header Popover Control, Scope Navigation, and Highlight Lifecycle

### Goal

Expose the locate behavior as one icon button immediately left of the metric button without disrupting the control row.

### Tasks

- [x] Pass `activeFilePath` from `HeaderActionManager` (entry `filePath`) into each `SummaryPopover` at construction.
- [x] Render the locate button immediately before the metric dropdown inside the existing query controls area, with a stable `data-activity-map-id`, accessible label, and Lucide icon.
- [x] Disable the button when `activeFilePath` is null or the model is not in the ready state.
- [x] On activation, call `locateCurrentFile()` and keep focus on the locate button (do not move focus into the legend).
- [x] Preserve loading retention, focus restoration across re-render, metric/range/date/grouping/breadcrumb behavior, live updates, pinning, Other expansion, and file activation.
- [x] Add focused control-order, accessibility, disabled-state, and controller/Popover regression tests.

### Files

- `src/ui/components/range-controls.ts`
- `src/ui/summary-popover.ts`
- `src/ui/header-action-manager.ts`
- `styles.css`
- `tests/ui/locate-current-file.behavior.test.ts`

### Acceptance Criteria

- [x] The locate button is immediately left of the metric button in the existing control row on both file and path grouping.
- [x] The button carries a stable `data-activity-map-id`, accessible label, and icon; it is disabled when the owning header has no file or the model is not ready.
- [x] Activation does not change metric, range, date, grouping (other than the documented path-scope narrowing in path mode), pin state, or focus contract.
- [x] Existing controls and Popover interactions remain green under pointer and keyboard tests.
- [x] Focused UI, accessibility, type-check, lint, test, and build gates pass.

### Evidence

- `npm run check` — passed.
- `npm run lint` — passed.
- `npm test -- --run` — passed, 302 tests and 0 failures, including locate button order, disabled state, and icon rendering.
- `npm run build` — passed; the production bundle contains the locate action wired left of the metric dropdown. Real Obsidian interaction remains the explicit Post-Critic Acceptance gate.

### Post-Critic Refinement: Animated Centering Scroll

After the Critic loop closed, the locate scroll was upgraded from the native instant `scrollIntoView({block:'nearest'})` to a fixed-duration (`~400ms`) ease-in-out centering animation in `src/ui/scroll-into-view-animated.ts`. Rationale: the native smooth-scroll duration and easing are engine-defined and inconsistent across desktop/mobile, so the plugin owns the motion for a predictable feel. The animation centers the target row, clamps at the top/bottom boundary (no empty scroll space), and is a no-op when the row is already visible or the host lacks layout/raf capability. The in-flight animation is cancelled on re-activation, re-render, and close, alongside the highlight timer.

- Added: `src/ui/scroll-into-view-animated.ts`, `tests/ui/scroll-into-view-animated.test.ts` (easing, centering, boundary clamp, already-visible no-op, cancel, headless no-op).
- `npm run check`, `npm run lint`, `npm test -- --run` (312 passed, 0 failed), `npm run build` all pass. This refinement is a non-blocking UI polish and does not reopen the Critic loop.

## Phase 2: Synchronize Documentation and Collect Integration Evidence

### Goal

Align public behavior and architecture with the implemented locate contract and collect complete technical evidence.

### Tasks

- [x] Update Architecture and README after the implementation exists.
- [x] Synchronize this Spec and PRD without claiming unexecuted real-Obsidian journeys.
- [x] Run the full automated suite, production build, strict specs validation, Markdown link validation, and whitespace checks.

### Files

- `ARCHITECTURE.md`
- `README.md`
- `docs/PRD.md`
- `specs/active/08-header-popover-locate-current-file-plan.md`

### Acceptance Criteria

- [x] Documentation describes the transient locate highlight, the path-mode scope narrowing, and the unchanged activation identity.
- [x] `npm run check`, `npm run lint`, `npm test -- --run`, and `npm run build` pass.
- [x] Strict specs validation, repository-relative Markdown links, and `git diff --check` pass.

### Evidence

- `npm run check` — passed.
- `npm run lint` — passed.
- `npm test -- --run` — passed, 302 tests and 0 failures.
- `npm run build` — passed.
- `SPEC_DRIVEN_DELIVERY_DIR=/Users/zhuo/.agents/skills/spec-driven-delivery python3 /Users/zhuo/.agents/skills/spec-driven-delivery/scripts/validate_specs_workspace.py . --strict` — passed for spec 08 with 0 errors and 0 warnings (pre-existing spec-06 errors unchanged).
- `git diff --check` — passed.

## Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| Path grouping narrows scope, surprising the user | Narrow only to the nearest parent directory, preserve grouping, and let breadcrumbs/history restore the prior scope. |
| Locate races a live update or background refresh | Cancel the pending highlight on any generation change not triggered by locate; the newer model owns the DOM. |
| Re-activation overlaps timers | One owner timer per Popover; each activation cancels and restarts the window. |
| File folded into "Other" cannot highlight a slice | Source of truth is the legend row; chart highlight clears stale dimming without false positives. |
| New control wraps the row | Reuse the existing ordered query-controls area and add only a `max-content` leading column if required. |

## Post-Critic Acceptance

- [ ] In real Obsidian, the owner opens a Header Popover on a file with activity, activates locate in file grouping, and confirms the slice and legend row highlight for about two seconds with the row scrolled into view.
- [ ] The owner activates locate in path grouping from the vault root and confirms the Popover narrows to the file's parent directory, then highlights the file's row for about two seconds.

## Evaluation Record

### Round 1

- Critic: independent read-only evaluator (Explore subagent, no prior implementation involvement).
- Review scope: full implementation, tests, documentation, and Post-Critic Acceptance readiness.
- Evidence reviewed: Spec 08, commits `b222a8d`–`b01a577`, implementation and test sources, `git diff main...HEAD`, and the recorded 302-test technical gate evidence.
- Findings:
  1. P3 non-blocking — `completePendingLocate` had no generation guard, so an unrelated interleaving refresh could silently drop a scope-narrowing locate's pending highlight.
  2. P3 non-blocking — test gap: no coverage for unrelated-re-render cancellation or `close()`/`destroy()` timer cancellation (claimed by Phase 0 acceptance).
  3. P3 non-blocking — the `entryRef` indirection in `HeaderActionManager` was dead (never mutated) and its comment claimed in-place path updates that do not occur.
  4. P3 non-blocking — `withLiveActivity` recomputed independently in locate; negligible boundary divergence vs the mounted distribution (noted, not fixed).
- Selected fixes: findings 1–3 (the three highest-priority findings in this round).
- Executor fixes: added `pendingLocateGeneration` and a strict newer-generation guard in `completePendingLocate` so a scope-narrowing locate completes only on its own `set-path` result; reset the generation on close; added two regression tests (unrelated `set-metric` re-render cancels highlight+timer; `close()` cancels the pending timer with no late DOM mutation); replaced the dead `entryRef` with a direct `filePath` capture and an accurate rebuild-on-rename comment.
- Deferred findings: finding 4 (`withLiveActivity` recomputation) is deliberately deferred — the boundary divergence is sub-frame and has no behavioral impact; revisiting would require exposing the mounted live distribution, tracked as a future polish follow-up rather than a correctness gate.
- Validation rerun: `npm run check`, `npm run lint`, `npm test -- --run` (304 passed, 0 failed), `npm run build`, `git diff --check` all passed. Strict specs validation reports 0 errors and 0 warnings for spec 08 (pre-existing spec-06 errors unchanged).
- Verdict: pass-with-follow-ups.

### Round 2

- Critic: same independent read-only evaluator (fresh subagent, no prior implementation involvement).
- Review scope: full re-review of the corrected branch and Round 1 fixes, regressions, documentation, lifecycle, and Post-Critic Acceptance readiness.
- Evidence reviewed: commit `390b1e9`, `git diff main...HEAD`, the generation guard and reset paths in `summary-popover.ts`, the two new regression tests, the removed `entryRef`, and the recorded 304-test gate evidence.
- Findings: none. The Round 1 generation guard was verified sound (`set-path` always bumps the generation via `refresh`, so the locate's own result strictly satisfies the `>` guard); the two new tests are deterministic and assert the claimed behavior; the dead `entryRef` is fully removed; no regressions in focus contract, data safety, control placement, or Other-fold handling.
- Deferred findings: finding 4 (`withLiveActivity` recomputation) remains the sole deferred follow-up — sub-frame boundary divergence with no behavioral or data impact, acceptable as future polish.
- Validation rerun: `npm run check`, `npm run lint`, `npm test -- --run` (304 passed, 0 failed), `npm run build`, `git diff --check`, and strict specs validation (0 errors, 0 warnings for spec 08) all passed.
- Verdict: pass-with-follow-ups.

The two-round Critic review ended with `pass-with-follow-ups`. The Spec remains in `review` only for the two unchecked real-Obsidian journeys in Post-Critic Acceptance; successful UAT is recorded without starting another Critic round.
