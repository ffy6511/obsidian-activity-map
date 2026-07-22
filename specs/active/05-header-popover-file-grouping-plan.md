# Header Popover File Grouping Plan

## Metadata

| Field | Value |
| --- | --- |
| Created | 2026-07-22 |
| Scope | Distribution query grouping and Header Popover controls |
| Type | feat |
| Priority | P1 |
| Status | in-progress |
| Completed | pending |
| Dependencies | [Header Popover split layout](04-header-popover-split-layout-plan.md) |
| Decisions | [Interface and export](../constitution/2026-07-21-activity-map-product-and-data.md#interface-and-export), [PRD chart popover](../../docs/PRD.md#环形图浮层), [Presentation architecture](../../ARCHITECTURE.md#presentation-and-export) |

## Phases

- [ ] Phase 0: Add path/file grouping to the distribution query
- [ ] Phase 1: Add the Header Popover grouping toggle
- [ ] Phase 2: Synchronize documentation and complete integration evidence

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

- [ ] Add the required `groupBy` field to query contracts, defaults, cache keys, fixtures, and query history.
- [ ] Flatten every present descendant file under the selected path in file grouping while preserving Deleted and Other semantics.
- [ ] Update live distribution ownership so a live descendant contributes to its file item in file grouping.
- [ ] Add focused tests for root and nested scopes, equal totals, basename/full-path identity, deleted history, cache separation, and live-only files.

### Files

- `src/query/distribution-query.ts`
- `src/query/query-cache.ts`
- `src/ui/view-model.ts`
- `src/ui/activity-map-controller.ts`
- `src/ui/live-distribution.ts`
- query, controller, cache, history, and live-distribution tests/fixtures

### Acceptance Criteria

- [ ] Path grouping remains byte-for-behavior compatible with the current query output.
- [ ] File grouping returns all present descendant files as detail items, sorted by the existing value/label rule.
- [ ] Both modes report equal scope/vault totals for the same path, metric, and range.
- [ ] File items keep basename labels, stable IDs, full paths, and existing activation semantics.
- [ ] Deleted activity remains non-activatable and visible through the existing Deleted item.
- [ ] Focused query, cache, live projection, controller, type-check, and lint gates pass.

## Phase 1: Add the Header Popover Grouping Toggle

### Goal

Expose the query grouping choice without adding visible chrome or disrupting the control row.

### Tasks

- [ ] Generalize the trailing control slot into an ordered action group without changing existing consumers.
- [ ] Render a grouping icon toggle immediately before pause/resume with accessible action text and pressed state.
- [ ] Preserve grouping across metric, range, date, and breadcrumb changes; reset to path grouping only when a new Header Popover opens.
- [ ] Preserve loading retention, focus restoration, live updates, highlighting, pinning, Other expansion, and file activation.
- [ ] Add focused control-order, accessibility, controller, and Popover regression tests.

### Files

- `src/ui/components/range-controls.ts`
- `src/ui/summary-popover.ts`
- `styles.css`
- `tests/ui/summary-popover.test.ts`
- `tests/ui/accessibility.test.ts`
- `tests/ui/activity-map-controller.test.ts`

### Acceptance Criteria

- [ ] The grouping toggle is directly left of pause/resume in the existing control row.
- [ ] The toggle exposes an accessible label, stable data ID, icon change, and `aria-pressed` state without visible explanatory text.
- [ ] Activating it switches between hierarchical path slices and flat file slices for the same scope.
- [ ] Breadcrumb navigation in file grouping preserves file grouping.
- [ ] Existing controls and Popover interactions remain green under pointer and keyboard tests.
- [ ] Focused UI, accessibility, type-check, lint, test, and build gates pass.

## Phase 2: Synchronize Documentation and Complete Integration Evidence

### Goal

Align public behavior and architecture with the implemented grouping contract and collect complete technical evidence.

### Tasks

- [ ] Update Architecture and README after the implementation exists.
- [ ] Synchronize this Spec, Constitution, PRD, and Roadmap without claiming unexecuted real-Obsidian journeys.
- [ ] Run the full automated suite, production build, strict specs validation, Markdown link validation, and whitespace checks.

### Files

- `ARCHITECTURE.md`
- `README.md`
- `docs/PRD.md`
- `specs/ROADMAP.md`
- `specs/constitution/2026-07-21-activity-map-product-and-data.md`
- `specs/active/05-header-popover-file-grouping-plan.md`

### Acceptance Criteria

- [ ] Documentation distinguishes path grouping, recursive file grouping, and the unchanged path scope.
- [ ] `npm run check`, `npm run lint`, `npm test -- --run`, and `npm run build` pass.
- [ ] Strict specs validation, repository-relative Markdown links, and `git diff --check` pass.

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

No Critic round has started. Planning evidence does not change implementation status.
