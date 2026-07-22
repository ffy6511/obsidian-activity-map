# Header Popover File Grouping Plan

## Metadata

| Field | Value |
| --- | --- |
| Created | 2026-07-22 |
| Scope | Distribution query grouping and Header Popover controls |
| Type | feat |
| Priority | P1 |
| Status | review |
| Completed | pending |
| Dependencies | [Header Popover split layout](04-header-popover-split-layout-plan.md) |
| Decisions | [Interface and export](../constitution/2026-07-21-activity-map-product-and-data.md#interface-and-export), [PRD chart popover](../../docs/PRD.md#环形图浮层), [Presentation architecture](../../ARCHITECTURE.md#presentation-and-export) |

## Phases

- [x] Phase 0: Add path/file grouping to the distribution query
- [x] Phase 1: Add the Header Popover grouping toggle
- [x] Phase 2: Synchronize documentation and complete integration evidence

## Background

### Problem

The Header Popover always groups activity by the next path segment. Users can drill through directories, but they cannot compare every file in the selected path as direct chart slices and legend rows.

### Current Behavior

`DistributionQuery.view` controls hierarchical children versus the existing direct local-files subview. The Header Popover opens at the vault root in the children view, and its controls expose metric, range, date navigation, and pause/resume. The query, live projection, chart, legend, breadcrumbs, top-N folding, and file activation already carry the information required for a second grouping mode.

### Goals and Non-goals

Goals:

- Add an explicit query grouping axis with `path` as the unchanged default and `file` as the new alternative.
- In file grouping, recursively expose every present file under the current breadcrumb path as an independent detail item before the existing top-N/Other chart fold.
- Preserve the same scope total, vault total, date range, metric, selected path, basename labels, stable file IDs, and full-path activation across grouping changes.
- Place one icon toggle immediately left of pause/resume in the existing Header Popover control row.
- Keep breadcrumbs usable as the scope selector while file grouping is active.

Non-goals:

- Persist the grouping choice in plugin settings or across a newly opened Header Popover.
- Change the dockable view layout, tracking, persistence, export schema, sorting, palette, top-N threshold, or Other expansion behavior.
- Render new headings, status text, summaries, or a second control row.

### Key Insight

Grouping is independent from path scope and the existing hierarchical `view`. Modeling it as a separate query field keeps cache identity and live projection explicit, while the Popover can switch presentation without rebuilding data outside the normal query pipeline.

## Design

> Inherited design: [Interface and export](../constitution/2026-07-21-activity-map-product-and-data.md#interface-and-export), [PRD chart popover](../../docs/PRD.md#环形图浮层), and [Presentation architecture](../../ARCHITECTURE.md#presentation-and-export).
>
> Local delta: add one query grouping field, one deterministic file-flattening branch, and one existing-row icon toggle. All current layout and interaction semantics remain inherited.

### Query Contract

```ts
type DistributionGrouping = 'path' | 'file';

interface DistributionQuery {
  metric: MetricKey;
  range: RangeMode;
  path: string;
  view: 'children' | 'local-files';
  groupBy: DistributionGrouping;
}
```

- `groupBy: 'path'` preserves the current children/local-files behavior.
- `groupBy: 'file'` uses `view: 'children'`, recursively flattens all present files below `query.path`, and retains the existing Deleted virtual item when historical deleted activity belongs to the scope.
- The same path/range/metric has the same `scopeTotal` and `vaultTotal` in path and file grouping.
- Query cache identity includes `groupBy`.

### Control Flow

```text
Open Header Popover
  -> default query groupBy = path
  -> render grouping toggle before pause/resume

Activate toggle
  -> clear expanded Other state
  -> dispatch set-grouping(path | file)
  -> normalize view to children
  -> run ordinary generation-guarded query
  -> retain metric, range, path, pin state, and focus contract

Navigate breadcrumb while groupBy = file
  -> update path
  -> preserve file grouping
  -> rerun flattened query for the new scope
```

### Data Flow

```text
merged per-file metrics + registry snapshot
  -> project all files beneath query.path
  -> groupBy path: existing next-segment projection
  -> groupBy file: one DistributionItem per present ProjectedFile
  -> retain Deleted virtual item when applicable
  -> existing sort and top-N/Other fold
  -> shared donut, legend, live projection, and activation
```

### Failure and State Semantics

- The toggle uses the existing loading-retention and stale-generation rules; a slow previous mode cannot replace a newer result.
- A query error keeps the selected grouping in the view model and uses the existing Popover error state.
- A newly opened Header Popover always starts in path grouping.
- File grouping never converts a missing/deleted identity into an activatable present file.

## Phase 0: Add Path/File Grouping to the Distribution Query

### Goal

Make both grouping modes deterministic query results with identical scope accounting.

### Tasks

- [x] Add the required `groupBy` field to query contracts, defaults, cache keys, fixtures, and query history.
- [x] Flatten every present descendant file under the selected path in file grouping while preserving Deleted and Other semantics.
- [x] Update live distribution ownership so a live descendant contributes to its file item in file grouping.
- [x] Add focused tests for root and nested scopes, equal totals, basename/full-path identity, deleted history, cache separation, and live-only files.

### Files

- `src/query/distribution-query.ts`
- `src/query/query-cache.ts`
- `src/ui/view-model.ts`
- `src/ui/activity-map-controller.ts`
- `src/ui/live-distribution.ts`
- query, controller, cache, history, and live-distribution tests/fixtures

### Acceptance Criteria

- [x] Path grouping remains byte-for-behavior compatible with the current query output.
- [x] File grouping returns all present descendant files as detail items, sorted by the existing value/label rule.
- [x] Both modes report equal scope/vault totals for the same path, metric, and range.
- [x] File items keep basename labels, stable IDs, full paths, and existing activation semantics.
- [x] Deleted activity remains non-activatable and visible through the existing Deleted item.
- [x] Focused query, cache, live projection, controller, type-check, and lint gates pass.

### Evidence

- `npm run check` — passed.
- `npm run lint` — passed.
- `npm test -- --run` — passed, 236 tests and 0 failures, including new query grouping, cache separation, live projection, and controller cases.

## Phase 1: Add the Header Popover Grouping Toggle

### Goal

Expose the query grouping choice without adding visible chrome or disrupting the control row.

### Tasks

- [x] Generalize the trailing control slot into an ordered action group without changing existing consumers.
- [x] Render a grouping icon toggle immediately before pause/resume with accessible action text and pressed state.
- [x] Preserve grouping across metric, range, date, and breadcrumb changes; reset to path grouping only when a new Header Popover opens.
- [x] Preserve loading retention, focus restoration, live updates, highlighting, pinning, Other expansion, and file activation.
- [x] Add focused control-order, accessibility, controller, and Popover regression tests.

### Files

- `src/ui/components/range-controls.ts`
- `src/ui/summary-popover.ts`
- `styles.css`
- `tests/ui/summary-popover.test.ts`
- `tests/ui/accessibility.test.ts`
- `tests/ui/activity-map-controller.test.ts`

### Acceptance Criteria

- [x] The grouping toggle is directly left of pause/resume in the existing control row.
- [x] The toggle exposes an accessible label, stable data ID, icon change, and `aria-pressed` state without visible explanatory text.
- [x] Activating it switches between hierarchical path slices and flat file slices for the same scope.
- [x] Breadcrumb navigation in file grouping preserves file grouping.
- [x] Existing controls and Popover interactions remain green under pointer and keyboard tests.
- [x] Focused UI, accessibility, type-check, lint, test, and build gates pass.

### Evidence

- `npm run check` — passed.
- `npm run lint` — passed.
- `npm test -- --run` — passed, 236 tests and 0 failures, including control order, toggle state, and accessibility source contracts.
- `npm run build` — passed; the production bundle contains the ordered grouping and tracking actions. Real Obsidian interaction remains the explicit Post-Critic Acceptance gate.

## Phase 2: Synchronize Documentation and Complete Integration Evidence

### Goal

Align public behavior and architecture with the implemented grouping contract and collect complete technical evidence.

### Tasks

- [x] Update Architecture and README after the implementation exists.
- [x] Synchronize this Spec, Constitution, PRD, and Roadmap without claiming unexecuted real-Obsidian journeys.
- [x] Run the full automated suite, production build, strict specs validation, Markdown link validation, and whitespace checks.

### Files

- `ARCHITECTURE.md`
- `README.md`
- `docs/PRD.md`
- `specs/ROADMAP.md`
- `specs/constitution/2026-07-21-activity-map-product-and-data.md`
- `specs/active/05-header-popover-file-grouping-plan.md`

### Acceptance Criteria

- [x] Documentation distinguishes path grouping, recursive file grouping, and the unchanged path scope.
- [x] `npm run check`, `npm run lint`, `npm test -- --run`, and `npm run build` pass.
- [x] Strict specs validation, repository-relative Markdown links, and `git diff --check` pass.

### Evidence

- `npm run check` — passed.
- `npm run lint` — passed.
- `npm test -- --run` — passed, 236 tests and 0 failures; the suite includes repository-relative Markdown target and heading-fragment validation.
- `npm run build` — passed.
- `SPEC_DRIVEN_DELIVERY_DIR=/Users/zhuo/.agents/skills/spec-driven-delivery python3 /Users/zhuo/.agents/skills/spec-driven-delivery/scripts/validate_specs_workspace.py . --strict` — passed with 0 errors and 0 warnings.
- `git diff --check` — passed.

## Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| File grouping changes the denominator | Derive both modes from one scope projection and assert equal totals. |
| A live file appears under a directory in file mode | Make live ownership branch on `groupBy` before path-segment grouping. |
| The fifth control wraps the row | Render both icon actions in one ordered trailing action group. |
| Switching modes loses path or range | Add a dedicated grouping intent that changes only `groupBy` and normalizes `view`. |
| Many files overwhelm the donut | Reuse top-N/Other for chart slices and the existing bounded scroll legend for complete details. |

## Post-Critic Acceptance

- [ ] In real Obsidian, the owner toggles a vault-root Popover containing nested files from path to file grouping and confirms the chart/list change without Popover movement or a second control row.
- [ ] The owner navigates a breadcrumb while file grouping is active, confirms the new scope remains file-grouped, and activates a basename-only row to open its unchanged full path.

## Evaluation Record

### Round 1

- Critic: `spec05_critic` (independent read-only evaluator).
- Review scope: full implementation, tests, documentation, and Post-Critic Acceptance readiness.
- Evidence reviewed: Spec 05, commits `b8baf5e` through `03cea25`, implementation and test sources, and the recorded 236-test technical gate evidence.
- Findings:
  1. P1 blocking — live-only file items could be appended outside the persisted query's top-N/Other partition, allowing the chart to exceed its configured bound.
  2. P1 blocking — loading retention kept the original toggle callback and stale accessibility/icon state, so a second activation during a pending query could not reliably switch back.
  3. P1 blocking — toggle acceptance relied on source-string assertions rather than a standards-based DOM behavior test covering order, state, focus-preserving updates, and consecutive activation.
  4. P2 blocking — equal-value file items with the same basename lacked a final stable path/ID tie-break, so persisted and live projections could order them differently.
- Selected fixes: findings 1–3, the three highest-priority blocking findings permitted in this round.
- Executor fixes: exposed the query chart bound and shared top-N/Other builder with live projection; rebuilt live chart items from the complete sorted detail list; added an in-place trailing-action update handle whose activation reads current controller grouping; added a `linkedom` DOM harness and consecutive pending-toggle behavior coverage.
- Deferred findings: finding 4 is unselected in this round and must be re-ranked by the same Critic in Round 2 before any fix.
- Validation rerun: `npm run check`, `npm run lint`, `npm test -- --run` (239 passed, 0 failed), `npm run build`, strict specs validation (0 errors, 0 warnings), and `git diff --check` all passed.
- Verdict: changes-required.

### Round 2

- Critic: `spec05_critic` (same independent read-only evaluator).
- Review scope: full re-review of Spec 05 and commit `a52ab3e`, including Round 1 fixes, regressions, documentation, lifecycle, and Post-Critic Acceptance readiness.
- Evidence reviewed: the complete branch, clean worktree, 239-test rerun, and all previously recorded technical gates.
- Findings:
  1. P1 blocking — pause/resume retained stale icon, label, and captured intent while a grouping query was loading, so a second activation could not resume before the query settled.
  2. P2 blocking — persisted and live item comparators still lacked full-path and stable-ID tie-breaks for equal values and identical basenames.
- Selected fixes: both blocking findings; no other findings were reported.
- Executor fixes: added a current-state tracking action and synchronized both retained trailing actions in place; added delayed-query Pause/Resume DOM behavior coverage for icon, accessible label, node identity, and focus; shared one value/label/path/ID comparator between persisted and live projections; added reversed-input and live-order regression tests.
- Deferred findings: none.
- Validation rerun: `npm run check`, `npm run lint`, `npm test -- --run` (242 passed, 0 failed), `npm run build`, strict specs validation (0 errors, 0 warnings), and `git diff --check` all passed.
- Verdict: changes-required.

### Round 3

- Critic: `spec05_critic` (same independent read-only evaluator; final allowed round).
- Review scope: full re-review of Spec 05 and commit `409cc16`, including all prior fixes, regressions, documentation, lifecycle, and Post-Critic Acceptance readiness.
- Evidence reviewed: complete clean branch, shared comparator and retained-action control flow, DOM and query regression tests, independent reversed-input reproduction, and recorded technical gates.
- Findings: none.
- Selected fixes: none.
- Executor fixes: none required.
- Deferred findings: none.
- Validation rerun: Critic reran `npm test -- --run` (242 passed, 0 failed), independently reproduced stable `file:a,file:b` ordering from both input orders, and passed `git diff --check`; the recorded check, lint, build, strict validator, and Markdown-link gates remain green.
- Verdict: pass.

The three-round Critic budget is exhausted. The Spec remains in `review` only for the two unchecked Owner journeys in Post-Critic Acceptance; successful UAT is recorded without starting a fourth Critic round. Any substantive UAT defect keeps the Spec in `review` and is reported against the exhausted review budget.
