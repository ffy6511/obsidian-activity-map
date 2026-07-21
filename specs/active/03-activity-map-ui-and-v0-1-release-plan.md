# Activity Map UI and v0.1 Release Plan

## Metadata

| Field | Value |
| --- | --- |
| Created | 2026-07-21 |
| Scope | `src/ui/`, `src/export/`, settings UI, plugin composition, v0.1 integration and release evidence |
| Type | feat |
| Priority | P0 |
| Status | review |
| Completed | pending |
| Dependencies | [Activity Tracking Runtime](01-activity-tracking-runtime-plan.md), [Local Data and Query](02-local-data-and-query-plan.md) |
| Decisions | [Interface and export](../constitution/2026-07-21-activity-map-product-and-data.md#interface-and-export), [Privacy and network boundary](../constitution/2026-07-21-activity-map-product-and-data.md#privacy-and-network-boundary), [Presentation architecture](../../ARCHITECTURE.md#presentation-and-export), [PRD information architecture](../../docs/PRD.md#信息架构与交互), [PRD release acceptance](../../docs/PRD.md#发布验收) |

## Phases

- [x] Phase 0: Compose services, settings, commands, and view state
- [x] Phase 1: Implement the full statistics view and native SVG chart
- [x] Phase 2: Implement initial file-header status and popover lifecycle
- [x] Phase 3: Implement SVG export and local data controls
- [x] Phase 4: Complete automated accessibility, platform integration, and release-candidate evidence
- [x] Phase 5: Correct the header entry and deliver the interactive donut popover
- [x] Phase 6: Simplify the popover layout and render the real header distribution
- [x] Phase 7: Keep the open popover live and refine fixed-layout alignment

## Background

### Problem

The current view is a truthful placeholder. Users need one coherent interface for current tracking state, idle recovery, range and metric selection, directory drill-down, exact detail values, settings, data ownership, and SVG export. Desktop must provide the full flow, while mobile must retain the view and navigation path without hover or desktop-only dependencies.

### Current Behavior

The plugin composes tracking, local data, queries, settings, commands, a dockable hierarchical statistics view, one stable multi-slice vault-root miniature per eligible file view, an idle-bounded real-time pinnable hierarchical donut popover, standalone SVG/JSON export, rebuild controls, and drift-checked scoped deletion. The duplicated title, totals, tooltip row, tracking footer, misleading single blue file-share arc, and persisted-summary lag have been removed; real Obsidian desktop/mobile verification remains pending.

### Goals and Non-goals

Goals:

- Compose Specs 01 and 02 behind a presentation-safe controller.
- Deliver the dockable full view, directory navigation, native SVG donut, complete detail list, and responsive states.
- Add a stable data-backed file-header mini donut and a focusable, pinnable hierarchical donut popover with Ribbon/command fallbacks.
- Provide settings, pause/resume, recovery decisions, raw JSON export, rebuild, scoped deletion, and both SVG export modes.
- Meet keyboard, focus, theme, reduced-motion, desktop, mobile-viewer, privacy, and release-documentation requirements.
- Produce automated evidence plus real Obsidian desktop and mobile journeys for `v0.1` acceptance.

Non-goals:

- Add `typedChars`, multi-device deduplication, event-time-path analysis, trend comparison, or later-version reports.
- Depend on hover for any required operation.
- Use Canvas for the donut or rasterize the live DOM for export.
- Publish a GitHub release or community-plugin submission without separate user authorization.

### Key Insight

Use one immutable `ActivityMapViewModel` for the full view, header popover, detail list, and SVG exporter. The header action derives only a compact current-file/vault-today ratio from real query data. Commands emit controller intents; only the controller calls tracking, query, or data services. This keeps presentation from mutating raw evidence and ensures the popover, full view, and exported chart use the same values and activation semantics.

## Design

> Inherited design: [Interface and export](../constitution/2026-07-21-activity-map-product-and-data.md#interface-and-export), [Control boundaries](../constitution/2026-07-21-activity-map-product-and-data.md#control-boundaries), [PRD product entry](../../docs/PRD.md#产品入口), [PRD SVG export](../../docs/PRD.md#svg-导出), and [PRD accessibility](../../docs/PRD.md#可访问性).
>
> Local delta: build the presentation/controller layer, wire all v0.1 services, and collect the final cross-platform acceptance evidence. It does not change time or storage semantics.

### Control Flow

```text
plugin onload
  -> load settings and data services
  -> reconcile checkpoint
  -> start tracking runtime
  -> register ItemView, settings tab, Ribbon, commands, and header-action manager

user or runtime intent
  -> ActivityMapController serializes intent
  -> call tracking/query/data service
  -> replace immutable ActivityMapViewModel
  -> notify full view and active popover
  -> preserve/restore focused control when DOM updates
```

Unload stops new UI intents, closes popovers, removes plugin-owned header elements, stops tracking, flushes services, and leaves user-positioned Activity Map leaves intact for Obsidian to restore later.

### View Model and Controller

```ts
interface ActivityMapViewState {
	metric: 'activeMs' | 'editingMs' | 'openCount';
	range: DistributionQuery['range'];
	path: string;
	view: 'children' | 'local-files';
	selectedItemId: string | null;
}

interface ActivityMapViewModel {
	tracking: TrackingSnapshot;
	queryState: 'loading' | 'ready' | 'empty' | 'error';
	distribution: DistributionResult | null;
	breadcrumbs: BreadcrumbItem[];
	chart: ChartModel | null;
	details: DetailRow[];
	pendingOperation: DataOperationProgress | null;
	warnings: UserFacingWarning[];
	capabilities: PlatformCapabilities;
}
```

- Persist only safe view preferences such as metric, average window, and last path; validate a restored path before querying.
- Query requests use cancellation/generation IDs. A slow previous request cannot replace a newer navigation result.
- Runtime snapshots update status and current-file values without forcing an unrelated distribution query every second.
- Format durations and percentages at render time; domain/query values remain integer milliseconds/counts.
- Controller errors become bounded user-facing warnings with retry actions and diagnostic codes.

### Full ItemView

The existing `ActivityMapView` becomes a thin renderer owned by `ActivityMapController`. The layout order is:

1. metric and range controls;
2. date navigation when day mode is selected;
3. path breadcrumbs;
4. scope total, vault share, denominator/coverage, and warnings;
5. native SVG donut or explanatory empty/error state;
6. complete, sortable detail list;
7. filters, export, rebuild, and data-management actions.

Navigation rules:

- Directory activation pushes that path and requests its child view.
- “Local files” activates the `local-files` query for the same path.
- “Other” filters/highlights its member rows and never enters the breadcrumb path.
- File activation opens the file through the workspace and retains the statistics view.
- Deleted rows show the last-known path and do not attempt to open a missing file.
- Browser-like Back/Forward commands operate on an in-memory path/range history for the current Activity Map leaf.

### Native SVG Donut

`DonutChart` receives a `ChartModel` and produces SVG elements directly:

- Calculate arcs from non-negative values and omit zero-value slices.
- Use one focusable interactive element per rendered item with text alternatives.
- Expose name, percentage, and exact value on hover, focus, and click.
- Keep the detail list as the complete textual representation, including members grouped into “other”.
- Generate colors from stable item kind/identity using a fixed theme-aware palette; semantic virtual groups use fixed tokens.
- Preserve the selected item across rerenders when it still exists.
- Render no-data text instead of a synthetic 100% slice.
- Disable nonessential transitions under `prefers-reduced-motion`.

### Header Action and Popover

Use the public `FileView.addAction()` API for each eligible file view and retain the returned element in a plugin-owned weak registry.

- Add or refresh actions on layout readiness, active-leaf changes, file opens, and layout changes.
- Remove only plugin-owned elements when a view becomes ineligible or the plugin unloads.
- The action installs one stable miniature SVG donut. Its arc is `current file activeMs / vault activeMs` for today; unavailable or zero data renders the same empty ring.
- Runtime state updates accessible name, tooltip, CSS state, and a restrained semantic marker without replacing the donut DOM. Repeated snapshots with the same ratio do not rewrite geometry.
- Hover and keyboard focus open the chart popover on desktop-capable pointer environments. Click toggles pinned/unpinned state; a trailing control pauses or resumes tracking, while Ribbon and command open the full view.
- The popover is plugin-owned DOM attached to the action's owner document, remains open while pointer/focus is within trigger or popover, closes on `Escape` or outside interaction, and restores focus to the trigger.
- The popover is non-modal and does not trap focus. It defaults to today's vault-root distribution and reuses the full view's range controls, breadcrumbs, native donut, synchronized legend, tooltip, and slice activation rules.
- Directory activation drills down in-place; local-files, other, deleted, and file activation match the ItemView. Expanding the ItemView preserves the popover's current query.
- Pending include/exclude and recent automatic-exclusion undo remain in the full view; the Popover exposes only the compact pause/resume control without displacing the chart.
- A recent automatic exclusion exposes its bounded undo action; undo returns the interval to pending review and never includes time immediately.
- If public header integration fails, record a warning and keep Ribbon and command access fully functional.
- Mobile registers no hover behavior and uses Ribbon, command, and the full view.

### Settings and Data Controls

The settings tab owns documented defaults and ranges for tracking enabled, idle threshold, recovery limit, edit silence, average window, raw retention, chart item limit, and path exclusions.

- Save a valid setting before applying it to runtime/query services; failed saves leave the previous effective value.
- Threshold changes affect future transitions and do not rewrite closed records.
- Pause/resume is available from settings, popover, full view, and command palette and uses one controller intent.
- Show pending and recent recovery decisions without allowing the same candidate to be resolved twice.
- Rebuild and export show progress and per-date warnings from Spec 02.
- Deletion first renders the immutable `DeletionPlan`, requires explicit scope confirmation, and passes the same plan ID to execution.
- Disable destructive controls while their plan is stale or another mutation is active.

### SVG and JSON Export

The SVG exporter consumes the same immutable `ChartModel` and formatted metadata as the live view; it never serializes the live DOM.

```ts
interface SvgExportRequest {
	mode: 'infographic' | 'chart-only';
	title: string;
	query: DistributionQuery;
	distribution: DistributionResult;
	chart: ChartModel;
	theme: ExportTheme;
	generatedAt: string;
}
```

- Infographic output includes title, range, path, metric, scope/vault totals, donut, legend, percentages, exact values, and generation time.
- Chart-only output includes geometry plus `<title>` and `<desc>`.
- Inline all required colors, typography fallbacks, dimensions, and accessibility metadata.
- Escape every path and label as text; no raw string enters markup unsanitized.
- Generate a filename from metric, range, and a sanitized path summary.
- Use a standard `Blob` download capability on desktop. Capability-detect export elsewhere and show a precise unavailable message rather than silently failing.
- Raw JSON export uses Spec 02's stream/result and the same explicit download boundary.
- Export contains paths and statistics selected by the user but never reads note text, selected text, or typed strings.

### Platform and Accessibility Boundaries

- Keep `isDesktopOnly: false`; imports contain no Electron or Node runtime API.
- Responsive layout preserves controls and details before chart size.
- Every icon-only control has an accessible name and visible tooltip.
- Tab order follows visual order; Enter/Space activates slices and buttons; `Escape` closes transient UI.
- Status announcements use a restrained `aria-live` region and never announce per-second ticks.
- Do not use color as the only status or item encoding.
- Test light/dark theme tokens and reduced-motion behavior.
- Mobile acceptance covers loading existing data, changing ranges, breadcrumbs, local-files detail, and file/deleted rows without hover.

## Phase 0: Compose Services, Settings, Commands, and View State

### Goal

Replace placeholder wiring with a lifecycle-safe composition root and presentation controller.

### Tasks

- [x] Compose settings, data services, checkpoint reconciliation, tracking runtime, query service, and controller in deterministic startup order.
- [x] Implement immutable view state/model, query generation cancellation, warning mapping, and observers.
- [x] Preserve the existing Ribbon and command entry while adding pause/resume and date-navigation commands.
- [x] Implement the settings tab with validated save-before-apply behavior.
- [x] Stop UI intents and flush owned services in deterministic unload order without detaching user-positioned leaves.

### Files

- `src/main.ts`
- `src/ui/activity-map-controller.ts`
- `src/ui/view-model.ts`
- `src/ui/commands.ts`
- `src/ui/settings-tab.ts`
- `tests/ui/activity-map-controller.test.ts`
- `tests/ui/settings-tab.test.ts`

### Acceptance Criteria

- [x] Startup does not begin tracking before settings, registry, event store, and checkpoint reconciliation complete.
- [x] Slow stale query results cannot replace the latest path/range selection.
- [x] Failed setting saves do not change effective runtime behavior.
- [x] Commands and Ribbon reveal one existing Activity Map view when available.
- [x] Unload leaves no active listener, operation, or popover capable of mutating state. *(Controller invalidates pending queries synchronously; coordinator rejects new transitions before asynchronous flush.)*

## Phase 1: Implement the Full Statistics View and Native SVG Chart

### Goal

Deliver the complete selected-day, average, all-history, breadcrumb, donut, and detail experience.

### Tasks

- [x] Implement metric/range/date controls, breadcrumbs, scope summary, coverage, warnings, and empty/error states.
- [x] Implement directory, local-files, “other”, file, and deleted-row interactions.
- [x] Implement native SVG arc geometry, stable colors, focus selection, tooltip content, and reduced motion.
- [x] Implement the complete detail list with exact values and percent-of-scope text.
- [x] Add responsive rendering and view-state history for narrow sidebars and main-area leaves.

### Files

- `src/ui/activity-map-view.ts`
- `src/ui/components/range-controls.ts`
- `src/ui/components/breadcrumbs.ts`
- `src/ui/components/donut-chart.ts`
- `src/ui/components/detail-list.ts`
- `src/ui/format.ts`
- `styles.css`
- `tests/ui/donut-chart.test.ts`
- `tests/ui/activity-map-view.test.ts`

### Acceptance Criteria

- [x] Fixed query models render correct labels, order, totals, vault share, denominator, and exact values.
- [x] Every chart item has equivalent detail-list text and keyboard activation.
- [x] “Other” never mutates the breadcrumb and exposes all grouped rows.
- [x] Empty results contain no fake chart slice and clearly distinguish no data from query failure.
- [x] Repeated rerenders do not leak DOM listeners or lose valid focus/selection. *(Each render replaces the owned subtree, restores selection by stable item id, and the ItemView releases its controller subscription on close.)*

## Phase 2: Implement File-Header Status and Interactive Summary Popover

### Goal

Provide the low-distraction desktop entry and status interaction while retaining stable fallbacks.

### Tasks

- [x] Manage one public header action per eligible `FileView` across layout and pop-out changes.
- [x] Map every tracking snapshot state to icon, accessible name, tooltip, and available actions.
- [x] Implement owner-document-aware popover placement, hover/focus persistence, outside close, `Escape`, and focus restoration.
- [x] Wire recovery include/exclude, automatic-exclusion undo, pause/resume, and open-view intents through the controller.
- [x] Capability-gate pointer hover and header failures while preserving Ribbon/command access.

### Files

- `src/ui/header-action-manager.ts`
- `src/ui/summary-popover.ts`
- `src/ui/status-presentation.ts`
- `styles.css`
- `tests/ui/header-action-manager.test.ts`
- `tests/ui/summary-popover.test.ts`

### Acceptance Criteria

- [x] Multiple file views and pop-out documents receive independent plugin-owned actions without duplicates.
- [x] Popover pointer and keyboard journeys remain interactive and restore focus on close.
- [x] Recovery candidates cannot be resolved twice through repeated clicks.
- [x] Header integration failure leaves the command, Ribbon, and full view usable.
- [x] Mobile/touch mode exposes no hover-only required operation.

## Phase 3: Implement SVG Export and Local Data Controls

### Goal

Complete user-owned export, rebuild, and destructive data workflows.

### Tasks

- [x] Implement deterministic infographic and chart-only SVG rendering from `ChartModel`.
- [x] Implement XML escaping, accessible metadata, inline styles, safe filenames, and export capability reporting.
- [x] Implement raw JSON export progress and download handling.
- [x] Implement rebuild progress/warnings and deletion-plan confirmation dialogs.
- [x] Prevent stale, concurrent, or partially failed data operations from reporting success.

### Files

- `src/export/svg-exporter.ts`
- `src/export/export-destination.ts`
- `src/ui/data-controls.ts`
- `src/ui/deletion-confirmation.ts`
- `styles.css`
- `tests/export/svg-exporter.test.ts`
- `tests/ui/data-controls.test.ts`

### Acceptance Criteria

- [x] Both SVG modes parse as standalone SVG and contain `<title>`, `<desc>`, inline colors, and expected values. *(Automated fixtures plus `xmllint --noout` parsing cover both modes.)*
- [x] Adversarial path/label fixtures cannot inject markup or scripts into exported SVG.
- [x] Full infographic and live view use identical distribution values and item colors.
- [x] A deletion action displays and executes the same unexpired plan ID and reports partial failure accurately.
- [x] Export and diagnostic logs contain no note content, selected text, or typed strings.

## Phase 4: Complete Automated Accessibility, Platform Integration, and Release-Candidate Evidence

### Goal

Prove the three Specs form the complete `v0.1` product without overstating fixture-only verification.

### Tasks

- [x] Add automated keyboard, accessible-name, focus restoration, non-color encoding, theme, and reduced-motion checks.
- [x] Add an integrated fake-clock/fake-adapter journey from activity input through query, UI, correction, export, rebuild, and deletion.
- [x] Verify bundle imports, `isDesktopOnly: false`, startup/unload, and absence of network/telemetry code.
- [x] Update Architecture, README, PRD, Roadmap, Constitution links, settings help, installation instructions, and release notes to match verified behavior.
- [x] Produce release artifacts locally and verify their contents without publishing them.

Real Obsidian desktop and mobile-viewer journeys require the technical and Critic gates first. They are tracked only under Post-Critic Acceptance below, so fixture evidence cannot accidentally complete them.

### Files

- `tests/integration/v0-1-user-journey.test.ts`
- `tests/ui/accessibility.test.ts`
- `tests/integration/privacy-boundary.test.ts`
- `ARCHITECTURE.md`
- `README.md`
- `docs/PRD.md`
- `specs/ROADMAP.md`
- `manifest.json`
- `versions.json`

### Acceptance Criteria

- [x] The integrated fixture journey covers foreground tracking, idle recovery, directory drill-down, all ranges, data controls, and both SVG modes.
- [x] Automated accessibility checks cover keyboard operation, focus restoration, names, text alternatives, theme tokens, and reduced motion.
- [x] The production bundle contains no Electron runtime dependency, telemetry endpoint, note-content capture, or hidden desktop-only requirement.
- [x] `npm run check`, `npm run lint`, `npm test -- --run`, `npm run build`, strict specs validation, and Markdown link checks pass.
- [x] Roadmap deliverables and acceptance boxes are checked only for evidence actually collected across Specs 01–03.
- [x] Generated `main.js`, `manifest.json`, and `styles.css` install as one local plugin artifact set.

## Phase 5: Correct the Header Entry and Deliver the Interactive Donut Popover

### Goal

Replace the rejected text-first hover card and icon swapping with the approved stable mini donut and directly interactive hierarchical chart.

### Tasks

- [x] Render one persistent miniature SVG donut in each eligible file header; update its current-file/vault-today ratio without replacing the owned SVG nodes.
- [x] Keep tracking status in accessible text and restrained CSS state so active/idle/pending/paused/degraded changes cannot flash or swap the main icon.
- [x] Replace the text-first summary card with a vault-root chart popover that reuses range controls, breadcrumbs, `ChartModel`, donut interaction, and synchronized legend values.
- [x] Implement hover/focus open, click-to-pin/unpin, pointer/focus retention, outside/Escape close, and a compact trailing controller action.
- [x] Share directory, local-files, other, deleted, and file activation rules between the popover and ItemView; preserve keyboard and touch/click fallbacks.
- [x] Add focused DOM/lifecycle fixtures, rerun the integrated journey, and synchronize Constitution, PRD, Architecture, Roadmap, README, release notes, and Spec evidence.

### Files

- `src/ui/header-action-manager.ts`
- `src/ui/header-mini-donut.ts`
- `src/ui/summary-popover.ts`
- `src/ui/components/donut-chart.ts`
- `src/ui/components/chart-legend.ts`
- `src/ui/components/range-controls.ts`
- `src/ui/components/breadcrumbs.ts`
- `src/ui/activity-map-controller.ts`
- `src/ui/activity-map-view.ts`
- `styles.css`
- `tests/ui/header-action-manager.test.ts`
- `tests/ui/summary-popover.test.ts`
- `tests/ui/donut-chart.test.ts`
- `tests/ui/accessibility.test.ts`

### Acceptance Criteria

- [x] Repeated tracking snapshots keep the same header SVG nodes and do not trigger icon replacement; equal data ratios do not rewrite arc geometry.
- [x] Real today data controls the mini donut, while missing/zero/error states retain one stable empty ring without fabricated activity.
- [x] Hover/focus reveals a donut-first vault-root popover; trigger click pins/unpins it, and Ribbon/command open the ItemView.
- [x] Hover/focus on every rendered slice shows its name, percentage, and exact value and synchronizes the matching legend row.
- [x] Directory and virtual-group clicks drill or expand in-place; file clicks open the file; breadcrumbs and range changes preserve coherent state.
- [x] Keyboard, focus restoration, outside/Escape close, reduced motion, theme tokens, and mobile no-hover fallbacks pass focused tests.
- [x] `npm run check`, `npm run lint`, `npm test -- --run`, `npm run build`, strict specs validation, Markdown link checks, and `git diff --check` pass.

## Phase 6: Simplify the Popover Layout and Render the Real Header Distribution

### Goal

Apply the owner-approved tldraw layout without transient rows and make the persistent header miniature truthfully preview today's vault-root chart.

### Tasks

- [x] Remove the popover title, duplicate metric/total/vault-share summary, transient chart tooltip row, and ordinary tracking-status footer.
- [x] Keep one compact control row; render previous-day, calendar, next-day, and the trailing pause/resume action as equal icon buttons, with the trailing action visually separated from the date group and the metric icon derived from the selected metric.
- [x] Move the current breadcrumb path below the donut, default it to the vault root, and constrain the legend to a fixed-height scroll region.
- [x] Add a dedicated today/vault-root distribution read for the Header action and reconcile stable miniature slice nodes using the shared color model, including the current in-flight activity in its owning root slice.
- [x] Preserve pin/focus/keyboard/activation behavior and add focused tests for the fixed layout, equal controls, scroll boundary, multi-slice geometry, empty state, and stable SVG ownership.
- [x] Synchronize Constitution, PRD, Architecture, Roadmap, README, release notes, and Spec evidence before returning the Spec to `review`.

### Files

- `src/ui/activity-map-controller.ts`
- `src/ui/header-action-manager.ts`
- `src/ui/header-mini-donut.ts`
- `src/ui/summary-popover.ts`
- `src/ui/components/donut-chart.ts`
- `src/ui/components/range-controls.ts`
- `styles.css`
- `tests/ui/activity-map-controller.test.ts`
- `tests/ui/header-action-manager.test.ts`
- `tests/ui/summary-popover.test.ts`
- `tests/ui/accessibility.test.ts`

### Acceptance Criteria

- [x] Header SVG root identity survives distribution updates; stable slice IDs reuse their nodes, real root items render distinct shared-palette arcs, and zero/error data leaves only the fixed empty ring.
- [x] The header distribution includes the current unclosed active interval in the correct root directory or file slice without waiting for persistence.
- [x] Popover source and DOM fixtures contain no title bar, duplicate summary, transient chart tooltip, or ordinary tracking footer.
- [x] The current path follows the chart, defaults to `Vault`, updates after drill-down, and the legend scrolls within a bounded region without moving surrounding controls or chart.
- [x] Previous, calendar, next, and pause/resume controls have one compact size; the trailing action has a group gap and an accessible icon label; metric changes update the metric icon.
- [x] Slice pointer/focus changes only highlight the existing chart and legend nodes; pin/unpin, outside/Escape close, focus restoration, drill-down, file activation, and full-view expansion remain available.
- [x] `npm run check`, `npm run lint`, `npm test -- --run`, `npm run build`, strict specs validation, repository Markdown links, and `git diff --check` pass.

## Phase 7: Keep the Open Popover Live and Refine Fixed-Layout Alignment

### Goal

Remove the summary/heartbeat lag from the open chart while preserving trusted-time clipping and align the owner-requested path, legend, and control regions.

### Tasks

- [x] Extract one immutable live-distribution projection shared by the Header miniature and Popover, limited to today's `activeMs` query and the selected path/view.
- [x] Tick an open Popover once per second without issuing a query or persistence write; clear the owner-window timer on close and clip growth at the trusted idle boundary.
- [x] Render the current path as centered muted context without a card background; increase legend-row left padding and promote only the hovered/focused item name.
- [x] Align metric/range selects, date navigation, and the trailing action to a shared control height with centered icons.
- [x] Preserve chart and legend DOM identity during live ticks; update geometry and values in place so pointer/focus highlight remains stable.
- [x] Normalize the three date-button gaps, tighten chart-to-path spacing, increase path-to-list spacing, and replace Expand with pause/resume tracking.
- [x] Remove default legend fills, keep all row text muted until synchronized highlight, align exact values before rightmost percentages, and center the donut total on both axes.
- [x] Replace the selected-day calendar icon with a clickable ISO date between equal arrow buttons; add underline/color and pointer-cursor affordances to every interactive Popover element.
- [x] Add deterministic projection and source/style tests and synchronize Constitution, PRD, Architecture, Roadmap, README, and Spec evidence.

### Files

- `src/ui/live-today.ts`
- `src/ui/live-distribution.ts`
- `src/ui/header-mini-donut.ts`
- `src/ui/header-action-manager.ts`
- `src/ui/summary-popover.ts`
- `styles.css`
- `tests/ui/live-distribution.test.ts`
- `tests/ui/header-action-manager.test.ts`
- `tests/ui/summary-popover.test.ts`

### Acceptance Criteria

- [x] The open Popover's total and owning slice increase between persisted query refreshes while active, then stop at the last trusted interaction plus `idleThresholdMs`.
- [x] Historical days, non-`activeMs` metrics, out-of-scope paths, and nested files excluded by `local-files` view do not receive an invalid scope increment.
- [x] Header miniature and Popover consume the same projection and do not mutate the controller's persisted `DistributionResult`.
- [x] Closing the Popover clears its live timer; ordinary live ticks do not rebuild chart or legend DOM, while item-identity changes fall back to a structural render.
- [x] Path, legend padding/highlight colors, date-button gaps, and all control heights/alignment match the fixed owner-approved layout without adding transient rows.
- [x] Legend rows are transparent at rest; fixed exact-value and rightmost percentage columns remain aligned for seconds, minutes, hours, and count metrics.
- [x] The donut total is centered vertically and horizontally; current Popover breadcrumbs remain operable and every pointer-capable interactive element exposes a hand cursor.
- [x] The trailing control dispatches shared pause/resume intents; Ribbon and command remain the full-view entrypoints.
- [x] `npm run check`, `npm run lint`, `npm test -- --run`, `npm run build`, strict specs validation, repository Markdown links, and `git diff --check` pass.

## Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| Header actions rely on a view lifecycle outside plugin-owned DOM | Use public `FileView.addAction`, maintain a weak registry, remove only owned elements, and retain Ribbon/command fallbacks. |
| Live chart and exported SVG diverge | Derive both from one immutable `ChartModel` and test value/color equality. |
| Frequent runtime updates cause excessive query/render work | Separate status snapshots from distribution invalidation and batch DOM updates. |
| Header status changes flash or rebuild the icon | Keep one SVG ring mounted, update geometry only when the real ratio changes, and express state through accessible text plus restrained CSS. |
| Destructive UI executes a changed scope | Require a backend deletion plan and revalidate the exact plan ID before mutation. |
| Mobile lacks a desktop export or hover capability | Make viewing and navigation independent of both; capability-detect optional export and report its availability honestly. |
| Fixture tests are mistaken for real Obsidian evidence | Record automated and real desktop/mobile results separately and leave Roadmap acceptance open until each named journey passes. |

## Post-Critic Acceptance

- [ ] A real Obsidian desktop journey verifies installation, foreground tracking, idle recovery, pause/resume, directory drill-down, data controls, and both SVG exports.
- [ ] A real Obsidian mobile journey verifies plugin loading, existing-data display, range changes, breadcrumbs, details, and operation without hover.

## Evaluation Record

### Round 1

- Critic: `/root/joint_critic` (joint Specs 01–03 evaluation, read-only)
- Review scope: full
- Evidence reviewed: Constitution, PRD, Architecture, Roadmap, Specs 01–03, source/tests, generated artifact set, and the 200-test technical-candidate gate.
- Findings: P0 idle confirmation immediately reopened attribution without trusted resume; P0 production startup bypassed checkpoint focus/idle/gap reconciliation; P0 normal NDJSON append could replace authoritative raw evidence after a failed read.
- Selected fixes: all three blocking findings; no lower-priority findings were proposed.
- Executor fixes: corrected runtime resume and startup composition, introduced true append-only shard writes, and extended the integrated journey plus focused failure fixtures.
- Deferred findings: none; real desktop/mobile journeys remain open Post-Critic Acceptance work and keep this Spec and `v0.1` in review.
- Validation rerun: `npm run check`; `npm run lint`; `npm test -- --run` (207 passed); `npm run build`; strict specs validation (0 errors, 0 warnings); `git diff --check`.
- Verdict: changes-required; corrected artifacts were submitted to the same joint Critic for Round 2.

### Round 2

- Critic: `/root/joint_critic` (joint Specs 01–03 evaluation, read-only)
- Review scope: full
- Evidence reviewed: commit `9adba5f`, Round 1 fixes/evidence, current production paths, and the clean 207-test gate.
- Findings: P0 live checkpoints and recovery-decision crash idempotency were incomplete; P1 `editor-change` discarded its source leaf/file; P1 deletion drift fingerprints omitted summary-only authoritative data.
- Selected fixes: all three blocking findings.
- Executor fixes: runtime checkpoints and retry IDs now preserve crash semantics, Obsidian editor events retain view identity through the platform boundary, and UI-retained deletion plans now reject summary-only drift before mutation.
- Deferred findings: none; real desktop/mobile journeys remain open Post-Critic Acceptance work and keep this Spec and `v0.1` in review.
- Validation rerun: `npm run check`; `npm run lint`; `npm test -- --run` (215 passed); `npm run build`; strict specs validation (0 errors, 0 warnings); `git diff --check`.
- Verdict: changes-required; corrected artifacts were submitted to the same joint Critic for final Round 3.

### Round 3

- Critic: `/root/joint_critic` (joint Specs 01–03 evaluation, read-only)
- Review scope: full
- Evidence reviewed: commits `9adba5f` and `8687a05`, both prior fix batches, current source/tests/docs, and the clean 215-test gate.
- Findings: P1 persisted daily summaries lack deep metrics/identity/warning validation and visible corrupt-summary query diagnostics; P1 deleted history is not filtered by the selected directory; P1 deletion execution re-enumerates after drift validation and is not frozen to per-path preview fingerprints.
- Selected fixes: none; the three-round Critic limit is exhausted.
- Executor fixes: none in this round.
- Deferred findings: the three blocking findings remain unresolved and are not accepted as follow-ups; desktop/mobile journeys remain open Post-Critic Acceptance work.
- Validation rerun: Critic confirmed `npm run check`, `npm run lint`, `npm test -- --run` (215 passed), `npm run build`, strict specs validation, and `git diff --check` all pass on the clean worktree.
- Verdict: fail; keep Specs 01–03 and `v0.1` in `review` and do not start another automatic Critic.

### Owner-directed post-Critic MVP fix

- Scope: the owner explicitly requested completion of the three remaining P1 findings after the bounded Critic loop; this is an Executor evidence update, not Critic Round 4.
- Changes: the UI query result now carries rebuild-required diagnostics for corrupt summaries; directory drill-down no longer includes unrelated Deleted history; destructive controls still execute the retained plan object, whose backend targets and per-path fingerprints are frozen.
- Evidence: focused data/query/controller fixtures plus the integrated technical journey remain distinct from real Obsidian evidence.
- Validation rerun: `npm run check`; `npm run lint`; `npm test -- --run` (220 passed); `npm run build`; strict specs validation (0 errors, 0 warnings); `git diff --check`.
- Lifecycle: this Spec and `v0.1` stay `review`; no new Critic verdict was issued, and both desktop/mobile Post-Critic Acceptance checkboxes remain open for the owner's final validation.

### Owner-directed Header UX correction

- Scope: the owner rejected the text-first hover card and icon swapping, approved a vault-root interactive donut popover, click-to-pin behavior, a separate expand action, and a stable data-backed header mini donut.
- Executor fixes: Header actions retain one SVG ring and update only the real current-file/vault-today arc; semantic status no longer calls `setIcon`. The popover now shares controller query state, date/range controls, breadcrumbs, `ChartModel`, tooltip, legend highlighting, and activation semantics with the ItemView.
- Evidence: focused fixtures prove stable SVG node identity, ratio updates, today-root defaults, shared activation, date navigation, donut-first source boundaries, keyboard labels, and non-color status text. The full automated suite passes 225 tests.
- Validation rerun: `npm run check`; `npm run lint`; `npm test -- --run` (225 passed); `npm run build`; strict specs validation (0 errors, 0 warnings); repository Markdown links; `git diff --check`.
- Lifecycle: Phase 5 is technically complete and this Spec returns to `review`. The previous three-round Critic budget remains exhausted, so this owner-directed correction does not create a fourth Critic verdict; real desktop/mobile Post-Critic Acceptance stays open.

### Owner-directed fixed-layout refinement

- Scope: the owner approved the edited tldraw layout: no title, duplicate summary, transient tooltip row, or ordinary tracking footer; path below the chart; bounded scroll legend; equal date/expand icon sizes with a group gap; and a real multi-slice Header miniature.
- Executor fixes: the controller exposes a dedicated today/vault-root distribution read; the Header reconciles shared-color slice circles by stable ID and adds the unclosed session to its owning root item. The popover renders a single compact control row, chart without tooltip DOM, current breadcrumbs, and a bounded legend.
- Evidence: focused tests cover dedicated root queries, stable SVG and slice identity, distinct ratios, live root attribution, empty rings, rejected Popover source regions, metric icons, equal icon classes, expand separation, and the scroll boundary. The full automated suite passes 225 tests.
- Validation rerun: `npm run check`; `npm run lint`; `npm test -- --run` (225 passed); `npm run build`; strict specs validation (0 errors, 0 warnings); repository Markdown links; `git diff --check`.
- Lifecycle: Phase 6 is technically complete and this Spec returns to `review`. No fourth Critic round is created; real desktop/mobile Post-Critic Acceptance stays open.

### Owner-directed live-popover and alignment correction

- Scope: the owner reported that the Header miniature included the active interval while the open Popover remained on its persisted summary, and requested a centered muted path, wider legend inset, muted default legend labels with name-only hover emphasis, and corrected control alignment.
- Executor fixes: Header and Popover now share one immutable live-distribution projection. The open Popover advances once per second without querying or persisting, clips at the trusted idle boundary, and clears its owner-window timer on close. Path, legend, and controls use the requested fixed styling.
- Evidence: deterministic fixtures cover live growth, idle clipping, historical and non-time exclusion, path scope, local-files scope, immutable input, timer ownership, and required CSS/source boundaries. The full automated suite passes 230 tests.
- Validation rerun: `npm run check`; `npm run lint`; `npm test -- --run` (230 passed); `npm run build`; strict specs validation (0 errors, 0 warnings); repository Markdown links; `git diff --check`.
- Lifecycle: Phase 7 is technically complete and this Spec remains in `review`. No fourth Critic round is created; real desktop/mobile Post-Critic Acceptance stays open for the owner's final validation.

### Owner-directed Phase 7 micro-adjustment

- Scope: the owner requested no new Phase and no automatic commit. The live Popover must preserve hover/focus emphasis across ticks; legend rows must be transparent and column-aligned; chart totals must be centered; selected-day navigation must expose its ISO date; paths and all controls must visibly advertise clickability; and the ineffective Expand affordance must become pause/resume tracking.
- Executor changes: donut and legend renderers expose identity-checked in-place update handles; the Popover uses them for timer and tracking updates and rebuilds only on structural changes. Fixed time/percentage columns, center-baseline SVG text, an ISO-date picker trigger, current-path activation, uniform cursor/underline affordances, compact spacing, and the shared pause/resume intent complete the Phase 7 refinement.
- Validation: `npm run check`; `npm run lint`; `npm test -- --run` (230 passed); `npm run build`; strict specs validation (0 errors, 0 warnings); repository Markdown links; `git diff --check`.
- Lifecycle: this remains Phase 7 owner-directed work. Spec 03 stays in `review`; no Critic round, stage, or commit is created.
