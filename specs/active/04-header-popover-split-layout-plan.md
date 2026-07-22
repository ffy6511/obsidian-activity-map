# Header Popover Split Layout Plan

## Metadata

| Field | Value |
| --- | --- |
| Created | 2026-07-22 |
| Scope | Header chart Popover layout and file-leaf display labels |
| Type | feat |
| Priority | P1 |
| Status | in-progress |
| Completed | pending |
| Dependencies | [Activity Map UI and v0.1 release](03-activity-map-ui-and-v0-1-release-plan.md) |
| Decisions | [Interface and export](../constitution/2026-07-21-activity-map-product-and-data.md#interface-and-export), [PRD chart popover](../../docs/PRD.md#环形图浮层), [Presentation architecture](../../ARCHITECTURE.md#presentation-and-export) |

## Phases

- [x] Phase 0: Display file leaves by basename
- [ ] Phase 1: Reflow the Popover into a 3:2 chart-and-list layout
- [ ] Phase 2: Synchronize documentation and complete integration evidence

## Background

### Problem

The Header Popover currently stacks the donut, path, and legend vertically. This makes the Popover unnecessarily tall and leaves horizontal space unused. File leaves also expose their full vault-relative path in the legend even though the current breadcrumb already supplies directory context.

### Current Behavior

The control row, live donut projection, breadcrumbs, scrollable legend, highlight synchronization, range changes, drill-down, and file activation are implemented and must remain intact. The Popover renders the donut, path, and legend as three vertical siblings. Query file items retain both a full `path` and a `label`, but the label currently repeats the full path.

### Goals and Non-goals

Goals:

- Keep the existing control row and all Popover interaction semantics unchanged.
- Place the donut and its current path on the left and the synchronized legend on the right.
- Allocate the result body in a `3fr 2fr` chart-to-list ratio.
- Cap the legend's visible height at the donut height and scroll only the legend when rows overflow.
- Display a file leaf's basename while retaining its full vault-relative path for identity and activation.

Non-goals:

- Add headings, captions, separators, totals, tooltips, status rows, or explanatory labels such as “chart area” or “list area”.
- Change controls, metrics, range navigation, live ticking, breadcrumbs, colors, sorting, highlighting, pinning, or activation behavior.
- Change the dockable `ItemView`, persistence, tracking, export schema, or query membership semantics.

### Key Insight

The existing presentation already has the correct components and behavior. One wrapper can reflow those components without duplicating them, while file items can derive a short display label at the query boundary and continue carrying their unchanged full path.

## Design

> Inherited design: [Interface and export](../constitution/2026-07-21-activity-map-product-and-data.md#interface-and-export), [PRD chart popover](../../docs/PRD.md#环形图浮层), and [Presentation architecture](../../ARCHITECTURE.md#presentation-and-export).
>
> Local delta: reflow the existing Popover result region and shorten only `kind: 'file'` display labels. No new visible component or interaction is introduced.

### Data Flow

```text
ProjectedFile.path
  -> preserve full vault-relative path in DistributionItem.path
  -> derive DistributionItem.label from the final path segment
  -> reuse the same label in donut accessibility text and legend rows
  -> activate the item with the unchanged DistributionItem.path
```

### Presentation Flow

```text
Popover controls
Popover result body (3fr : 2fr)
├── existing chart column
│   ├── existing donut
│   └── existing current-path breadcrumbs
└── existing legend
    └── overflow-y: auto; max-height equals the donut height
```

The wrapper and columns are layout-only containers. They must not render user-visible headings or descriptions. Loading, empty, and error states remain outside the result-body grid and retain their existing behavior.

## Phase 0: Display File Leaves by Basename

### Goal

Remove redundant parent paths from file labels without changing file identity, membership, sorting inputs beyond the shorter label, or activation targets.

### Tasks

- [x] Derive every present file item's `label` from the final segment of its normalized vault-relative path.
- [x] Preserve the full path in `DistributionItem.path` and keep directory, virtual-group, and deleted labels unchanged.
- [x] Add a focused query test covering a nested file and its unchanged activation path.

### Files

- `src/query/distribution-query.ts`
- `tests/query/distribution-query.test.ts`

### Acceptance Criteria

- [x] A nested file leaf renders as its basename.
- [x] The same item retains its full vault-relative path and stable file ID.
- [x] Directory and virtual-group labels remain unchanged.
- [x] Query tests, type checking, and lint pass.

### Evidence

- `npm run check` — passed.
- `npm run lint` — passed.
- `npm test -- --run` — 231 passed, 0 failed.

## Phase 1: Reflow the Popover into a 3:2 Chart-and-List Layout

### Goal

Use the approved horizontal layout while preserving the existing component set and runtime behavior.

### Tasks

- [ ] Add one result-body wrapper around the existing chart/path column and legend.
- [ ] Use `minmax(0, 3fr) minmax(0, 2fr)` for the result body and widen only the existing chart Popover enough to support the ratio.
- [ ] Keep the path below the donut inside the left column.
- [ ] Cap the right legend at the donut height, keep `overflow-y: auto`, and prevent legend growth from increasing the Popover height.
- [ ] Preserve loading retention, live in-place updates, highlight synchronization, focus restoration, drill-down, and reduced-motion behavior.
- [ ] Extend focused Popover and accessibility checks without asserting or rendering any new headings.

### Files

- `src/ui/summary-popover.ts`
- `styles.css`
- `tests/ui/summary-popover.test.ts`
- `tests/ui/accessibility.test.ts`

### Acceptance Criteria

- [ ] The chart/path column and legend render side by side at a `3:2` ratio.
- [ ] The legend never exceeds the donut's height and becomes internally scrollable when necessary.
- [ ] The Popover contains no new title, chart/list caption, summary, tooltip row, or status footer.
- [ ] Existing query, live ticking, pointer, keyboard, pinning, breadcrumb, and activation tests remain green.
- [ ] Focused UI tests, type checking, lint, and build pass.

## Phase 2: Synchronize Documentation and Complete Integration Evidence

### Goal

Keep the product and architecture descriptions aligned with the implemented layout and collect the complete technical candidate evidence.

### Tasks

- [ ] Update Architecture and README current-behavior text after the implementation exists.
- [ ] Synchronize this Spec, Roadmap, Constitution, and PRD without overstating real Obsidian acceptance.
- [ ] Run the full automated suite, production build, strict specs validation, Markdown link validation, and whitespace checks.
- [ ] Record independent Critic findings and fixes within the bounded review loop.

### Files

- `ARCHITECTURE.md`
- `README.md`
- `docs/PRD.md`
- `specs/ROADMAP.md`
- `specs/constitution/2026-07-21-activity-map-product-and-data.md`
- `specs/active/04-header-popover-split-layout-plan.md`

### Acceptance Criteria

- [ ] Documentation describes the horizontal Popover and basename-only file labels as implemented behavior.
- [ ] `npm run check`, `npm run lint`, `npm test -- --run`, and `npm run build` pass.
- [ ] Strict specs validation, repository-relative Markdown links, and `git diff --check` pass.
- [ ] Independent Critic evaluation reports no blocking finding.

## Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| The wider Popover exceeds the owner window | Retain viewport-bounded width and existing owner-document positioning. |
| A long filename crowds numeric columns | Keep the existing `minmax(0, 1fr)` label column and text overflow behavior. |
| Moving DOM nodes breaks live updates or focus | Reuse the existing chart and legend handles; test node-stable updates and focus behavior. |
| Short labels lose activation context | Preserve the full path separately and activate files only through that path. |

## Post-Critic Acceptance

- [ ] The owner verifies the 3:2 layout, list-only overflow, and basename-only file rows in real Obsidian.

## Evaluation Record

No Critic round has started. Planning validation does not change implementation status.
