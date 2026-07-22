# Header Popover Split Layout Plan

## Metadata

| Field | Value |
| --- | --- |
| Created | 2026-07-22 |
| Scope | Header chart Popover layout and file-leaf display labels |
| Type | feat |
| Priority | P1 |
| Status | review |
| Completed | pending |
| Dependencies | [Activity Map UI and v0.1 release](03-activity-map-ui-and-v0-1-release-plan.md) |
| Decisions | [Interface and export](../constitution/2026-07-21-activity-map-product-and-data.md#interface-and-export), [PRD chart popover](../../docs/PRD.md#环形图浮层), [Presentation architecture](../../ARCHITECTURE.md#presentation-and-export) |

## Phases

- [x] Phase 0: Display file leaves by basename
- [x] Phase 1: Reflow the Popover into a centered 1:1 chart-and-list layout
- [x] Phase 2: Synchronize documentation and complete integration evidence

## Background

### Problem

The Header Popover currently stacks the donut, path, and legend vertically. This makes the Popover unnecessarily tall and leaves horizontal space unused. File leaves also expose their full vault-relative path in the legend even though the current breadcrumb already supplies directory context.

### Current Behavior

The control row, live donut projection, breadcrumbs, scrollable legend, highlight synchronization, range changes, drill-down, and file activation are implemented and must remain intact. The Popover renders the donut, path, and legend as three vertical siblings. Query file items retain both a full `path` and a `label`, but the label currently repeats the full path.

### Goals and Non-goals

Goals:

- Keep the existing control row and all Popover interaction semantics unchanged.
- Place the donut and its current path on the left and the synchronized legend on the right.
- Center a width-bounded result body with equal chart/list columns and equal inline padding.
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
Popover result body (centered 1fr : 1fr; equal inline padding)
├── existing chart column
│   ├── existing donut with tight SVG bounds
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

## Phase 1: Reflow the Popover into a Centered 1:1 Chart-and-List Layout

### Goal

Use the approved horizontal layout while preserving the existing component set and runtime behavior.

### Tasks

- [x] Add one result-body wrapper around the existing chart/path column and legend.
- [x] Use equal `minmax(0, 1fr)` columns in a centered, width-bounded result body with equal inline padding.
- [x] Crop only the Popover donut to its outer-ring SVG bounds and share a responsive size cap between the rendered donut and legend.
- [x] Keep the path below the donut inside the left column.
- [x] Cap the right legend at the donut height, keep `overflow-y: auto`, and prevent legend growth from increasing the Popover height.
- [x] Preserve loading retention, live in-place updates, highlight synchronization, focus restoration, drill-down, and reduced-motion behavior.
- [x] Extend focused Popover and accessibility checks without asserting or rendering any new headings.

### Files

- `src/ui/summary-popover.ts`
- `src/ui/components/donut-chart.ts`
- `styles.css`
- `tests/ui/summary-popover.test.ts`
- `tests/ui/accessibility.test.ts`

### Acceptance Criteria

- [x] The chart/path column and legend render side by side at a `1:1` ratio in a compact, horizontally centered result container with equal left/right padding.
- [x] The Popover donut has no coordinate-space outer whitespace, while other donut consumers retain the full SVG view box.
- [x] The legend never exceeds the donut's height and becomes internally scrollable when necessary.
- [x] The Popover contains no new title, chart/list caption, summary, tooltip row, or status footer.
- [x] Existing query, live ticking, pointer, keyboard, pinning, breadcrumb, and activation tests remain green.
- [x] Focused UI tests, type checking, lint, and build pass after owner visual correction.

### Evidence

- `npm run check` — passed.
- `npm run lint` — passed.
- `npm test -- --run` — 231 passed, 0 failed.
- `npm run build` — passed.
- The first Obsidian 1.12.7 render exposed excess chart-column whitespace, an oversized Popover, and legend content above the donut's visible top edge; subsequent owner-directed tuning superseded that render.
- In the 2026-07-22 Codex task, the owner accepted the live Obsidian layout after the result changed to centered equal columns, equal inline padding, tight Popover-only SVG bounds, and reduced legend-row padding. No repository screenshot is retained because the surrounding vault content is private.
- The final responsive cap is `min(16.5rem, calc(50vw - 2rem))`: at the `36rem` wrapper maximum, two `16px` inline paddings and one `16px` gap leave two `16.5rem` columns, so the legend maximum cannot exceed the rendered donut.

## Phase 2: Synchronize Documentation and Complete Integration Evidence

### Goal

Keep the product and architecture descriptions aligned with the implemented layout and collect the complete technical candidate evidence.

### Tasks

- [x] Update Architecture and README current-behavior text after the implementation exists.
- [x] Synchronize this Spec, Roadmap, Constitution, and PRD without overstating real Obsidian acceptance.
- [x] Run the full automated suite, production build, strict specs validation, Markdown link validation, and whitespace checks after the visual correction.

### Files

- `ARCHITECTURE.md`
- `README.md`
- `docs/PRD.md`
- `specs/ROADMAP.md`
- `specs/constitution/2026-07-21-activity-map-product-and-data.md`
- `specs/active/04-header-popover-split-layout-plan.md`

### Acceptance Criteria

- [x] Documentation describes the horizontal Popover and basename-only file labels as implemented behavior.
- [x] `npm run check`, `npm run lint`, `npm test -- --run`, and `npm run build` pass after the visual correction.
- [x] Strict specs validation, repository-relative Markdown links, and `git diff --check` pass after the visual correction.

### Evidence

- `npm run check` — passed.
- `npm run lint` — passed.
- `npm test -- --run` — 231 passed, 0 failed; includes repository-relative Markdown targets and heading fragments.
- `npm run build` — passed.
- `python3 "${SPEC_DRIVEN_DELIVERY_DIR:?set SPEC_DRIVEN_DELIVERY_DIR}/scripts/validate_specs_workspace.py" . --strict` — 0 errors, 0 warnings.
- `git diff --check` — passed.

## Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| The wider Popover exceeds the owner window | Retain viewport-bounded width and existing owner-document positioning. |
| A long filename crowds numeric columns | Keep the existing `minmax(0, 1fr)` label column and text overflow behavior. |
| Moving DOM nodes breaks live updates or focus | Reuse the existing chart and legend handles; test node-stable updates and focus behavior. |
| Short labels lose activation context | Preserve the full path separately and activate files only through that path. |

## Post-Critic Acceptance

- [ ] In Obsidian 1.12.7 or newer, open the Header Popover at a real path containing enough rows to overflow the legend and at least one nested file leaf, then record a screenshot or video plus the tested vault-relative path.
- [ ] Confirm the legend has `scrollHeight > clientHeight`, its rendered outer height is no greater than the donut SVG height, scrolling changes only the legend scroll position, and the Popover bounds do not grow.
- [ ] Confirm the nested file row displays only its basename and activating it opens the unchanged full vault-relative path.

## Evaluation Record

### Round 1

- Critic: `/root/spec04_critic_round1`
- Review scope: full
- Evidence reviewed: commits `504ae26`, `9d338b3`, `4d24cd6`, `42e1381`, and `6b9dda7`; implementation, tests, documentation, 231-test/check/lint/build/spec-validator/diff-check results, and the recorded real-render boundary.
- Findings: P1 blocking — the combined owner checkbox did not define an executable long-list/basename journey or observable evidence; P2 non-blocking — the corrected-render statement pointed to no durable artifact.
- Selected fixes: define the real-vault fixture and measurable overflow/height/activation evidence; replace the dangling render statement with an explicit owner observation and privacy boundary.
- Executor fixes: expanded Post-Critic Acceptance into setup and observable checks; recorded the accepted live-render source and lack of a repository screenshot; synchronized the final centered `1:1` constraint after owner tuning.
- Deferred findings: none.
- Validation rerun: `npm run check`, `npm run lint`, `npm test -- --run` (231 passed), `npm run build`, strict specs validation (0 errors, 0 warnings), and `git diff --check` all passed after the final constraint synchronization.
- Verdict: changes-required.

### Round 2

- Critic: `/root/spec04_critic_round1`
- Review scope: full
- Evidence reviewed: current implementation and synchronized Constitution, PRD, Architecture, README, Roadmap, Spec, focused tests, and the passing check/lint/231-test/build/spec-validator/diff-check results.
- Findings: none; both Round 1 findings are resolved.
- Selected fixes: none.
- Executor fixes: none after review.
- Deferred findings: none.
- Validation rerun: no code changed after the supplied full gates; strict specs validation and `git diff --check` are rerun after recording this round.
- Verdict: pass.

One final round remains reserved for Post-Critic Acceptance evidence. The Spec remains in `review` while the owner long-list and basename journey is open.
