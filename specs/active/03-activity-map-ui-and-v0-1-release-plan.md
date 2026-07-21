# Activity Map UI and v0.1 Release Plan

## Metadata

| Field | Value |
| --- | --- |
| Created | 2026-07-21 |
| Scope | `src/ui/`, `src/export/`, settings UI, plugin composition, v0.1 integration and release evidence |
| Type | feat |
| Priority | P0 |
| Status | in-progress |
| Completed | pending |
| Dependencies | [Activity Tracking Runtime](01-activity-tracking-runtime-plan.md), [Local Data and Query](02-local-data-and-query-plan.md) |
| Decisions | [Interface and export](../constitution/2026-07-21-activity-map-product-and-data.md#interface-and-export), [Privacy and network boundary](../constitution/2026-07-21-activity-map-product-and-data.md#privacy-and-network-boundary), [Presentation architecture](../../ARCHITECTURE.md#presentation-and-export), [PRD information architecture](../../docs/PRD.md#信息架构与交互), [PRD release acceptance](../../docs/PRD.md#发布验收) |

## Phases

- [ ] Phase 0: Compose services, settings, commands, and view state
- [ ] Phase 1: Implement the full statistics view and native SVG chart
- [ ] Phase 2: Implement file-header status and interactive summary popover
- [ ] Phase 3: Implement SVG export and local data controls
- [ ] Phase 4: Complete accessibility, platform integration, and v0.1 release evidence

## Background

### Problem

The current view is a truthful placeholder. Users need one coherent interface for current tracking state, idle recovery, range and metric selection, directory drill-down, exact detail values, settings, data ownership, and SVG export. Desktop must provide the full flow, while mobile must retain the view and navigation path without hover or desktop-only dependencies.

### Current Behavior

The plugin registers a Ribbon action and `Activity Map: Open view` command. The `ItemView` contains one empty-state paragraph. There is no service composition, status model, settings tab, query controller, chart, detail list, file-header action, popover, export path, data-control dialog, accessibility behavior, or real Obsidian verification.

### Goals and Non-goals

Goals:

- Compose Specs 01 and 02 behind a presentation-safe controller.
- Deliver the dockable full view, directory navigation, native SVG donut, complete detail list, and responsive states.
- Add file-header status actions and a focusable non-modal summary popover with Ribbon/command fallbacks.
- Provide settings, pause/resume, recovery decisions, raw JSON export, rebuild, scoped deletion, and both SVG export modes.
- Meet keyboard, focus, theme, reduced-motion, desktop, mobile-viewer, privacy, and release-documentation requirements.
- Produce automated evidence plus real Obsidian desktop and mobile journeys for `v0.1` acceptance.

Non-goals:

- Add `typedChars`, multi-device deduplication, event-time-path analysis, trend comparison, or later-version reports.
- Depend on hover for any required operation.
- Use Canvas for the donut or rasterize the live DOM for export.
- Publish a GitHub release or community-plugin submission without separate user authorization.

### Key Insight

Use one immutable `ActivityMapViewModel` for the full view, header popover, detail list, and SVG exporter. Commands emit controller intents; only the controller calls tracking, query, or data services. This keeps presentation from mutating raw evidence and ensures the exported chart uses the same values shown on screen.

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
- The action exposes active, idle, pending, paused, untrackable, and degraded states through icon, accessible name, and tooltip.
- Click opens or reveals the full view. Hover and keyboard focus open the summary popover on desktop-capable pointer environments.
- The popover is plugin-owned DOM attached to the action's owner document, remains open while pointer/focus is within trigger or popover, closes on `Escape` or outside interaction, and restores focus to the trigger.
- The popover is non-modal and does not trap focus. It contains current-file today time, vault today time, state reason, pending include/exclude, pause/resume, and open-view actions.
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

- [ ] Compose settings, data services, checkpoint reconciliation, tracking runtime, query service, and controller in deterministic startup order.
- [ ] Implement immutable view state/model, query generation cancellation, warning mapping, and observers.
- [ ] Preserve the existing Ribbon and command entry while adding pause/resume and date-navigation commands.
- [ ] Implement the settings tab with validated save-before-apply behavior.
- [ ] Stop UI intents and flush owned services in deterministic unload order without detaching user-positioned leaves.

### Files

- `src/main.ts`
- `src/ui/activity-map-controller.ts`
- `src/ui/view-model.ts`
- `src/ui/commands.ts`
- `src/ui/settings-tab.ts`
- `tests/ui/activity-map-controller.test.ts`
- `tests/ui/settings-tab.test.ts`

### Acceptance Criteria

- [ ] Startup does not begin tracking before settings, registry, event store, and checkpoint reconciliation complete.
- [ ] Slow stale query results cannot replace the latest path/range selection.
- [ ] Failed setting saves do not change effective runtime behavior.
- [ ] Commands and Ribbon reveal one existing Activity Map view when available.
- [ ] Unload leaves no active listener, operation, or popover capable of mutating state.

## Phase 1: Implement the Full Statistics View and Native SVG Chart

### Goal

Deliver the complete selected-day, average, all-history, breadcrumb, donut, and detail experience.

### Tasks

- [ ] Implement metric/range/date controls, breadcrumbs, scope summary, coverage, warnings, and empty/error states.
- [ ] Implement directory, local-files, “other”, file, and deleted-row interactions.
- [ ] Implement native SVG arc geometry, stable colors, focus selection, tooltip content, and reduced motion.
- [ ] Implement the complete detail list with exact values and percent-of-scope text.
- [ ] Add responsive rendering and view-state history for narrow sidebars and main-area leaves.

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

- [ ] Fixed query models render correct labels, order, totals, vault share, denominator, and exact values.
- [ ] Every chart item has equivalent detail-list text and keyboard activation.
- [ ] “Other” never mutates the breadcrumb and exposes all grouped rows.
- [ ] Empty results contain no fake chart slice and clearly distinguish no data from query failure.
- [ ] Repeated rerenders do not leak DOM listeners or lose valid focus/selection.

## Phase 2: Implement File-Header Status and Interactive Summary Popover

### Goal

Provide the low-distraction desktop entry and status interaction while retaining stable fallbacks.

### Tasks

- [ ] Manage one public header action per eligible `FileView` across layout and pop-out changes.
- [ ] Map every tracking snapshot state to icon, accessible name, tooltip, and available actions.
- [ ] Implement owner-document-aware popover placement, hover/focus persistence, outside close, `Escape`, and focus restoration.
- [ ] Wire recovery include/exclude, automatic-exclusion undo, pause/resume, and open-view intents through the controller.
- [ ] Capability-gate pointer hover and header failures while preserving Ribbon/command access.

### Files

- `src/ui/header-action-manager.ts`
- `src/ui/summary-popover.ts`
- `src/ui/status-presentation.ts`
- `styles.css`
- `tests/ui/header-action-manager.test.ts`
- `tests/ui/summary-popover.test.ts`

### Acceptance Criteria

- [ ] Multiple file views and pop-out documents receive independent plugin-owned actions without duplicates.
- [ ] Popover pointer and keyboard journeys remain interactive and restore focus on close.
- [ ] Recovery candidates cannot be resolved twice through repeated clicks.
- [ ] Header integration failure leaves the command, Ribbon, and full view usable.
- [ ] Mobile/touch mode exposes no hover-only required operation.

## Phase 3: Implement SVG Export and Local Data Controls

### Goal

Complete user-owned export, rebuild, and destructive data workflows.

### Tasks

- [ ] Implement deterministic infographic and chart-only SVG rendering from `ChartModel`.
- [ ] Implement XML escaping, accessible metadata, inline styles, safe filenames, and export capability reporting.
- [ ] Implement raw JSON export progress and download handling.
- [ ] Implement rebuild progress/warnings and deletion-plan confirmation dialogs.
- [ ] Prevent stale, concurrent, or partially failed data operations from reporting success.

### Files

- `src/export/svg-exporter.ts`
- `src/export/export-destination.ts`
- `src/ui/data-controls.ts`
- `src/ui/deletion-confirmation.ts`
- `styles.css`
- `tests/export/svg-exporter.test.ts`
- `tests/ui/data-controls.test.ts`

### Acceptance Criteria

- [ ] Both SVG modes parse as standalone SVG and contain `<title>`, `<desc>`, inline colors, and expected values.
- [ ] Adversarial path/label fixtures cannot inject markup or scripts into exported SVG.
- [ ] Full infographic and live view use identical distribution values and item colors.
- [ ] A deletion action displays and executes the same unexpired plan ID and reports partial failure accurately.
- [ ] Export and diagnostic logs contain no note content, selected text, or typed strings.

## Phase 4: Complete Accessibility, Platform Integration, and v0.1 Release Evidence

### Goal

Prove the three Specs form the complete `v0.1` product without overstating fixture-only verification.

### Tasks

- [ ] Add automated keyboard, accessible-name, focus restoration, non-color encoding, theme, and reduced-motion checks.
- [ ] Add an integrated fake-clock/fake-adapter journey from activity input through query, UI, correction, export, rebuild, and deletion.
- [ ] Verify bundle imports, `isDesktopOnly: false`, startup/unload, and absence of network/telemetry code.
- [ ] Execute and record real Obsidian desktop and mobile-viewer journeys after technical and Critic gates.
- [ ] Update Architecture, README, PRD, Roadmap, Constitution links, settings help, installation instructions, and release notes to match verified behavior.
- [ ] Produce release artifacts locally and verify their contents without publishing them.

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

- [ ] The integrated fixture journey covers foreground tracking, idle recovery, directory drill-down, all ranges, data controls, and both SVG modes.
- [ ] Automated accessibility checks cover keyboard operation, focus restoration, names, text alternatives, theme tokens, and reduced motion.
- [ ] The production bundle contains no Electron runtime dependency, telemetry endpoint, note-content capture, or hidden desktop-only requirement.
- [ ] `npm run check`, `npm run lint`, `npm test -- --run`, `npm run build`, strict specs validation, and Markdown link checks pass.
- [ ] Roadmap deliverables and acceptance boxes are checked only for evidence actually collected across Specs 01–03.
- [ ] Generated `main.js`, `manifest.json`, and `styles.css` install as one local plugin artifact set.

## Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| Header actions rely on a view lifecycle outside plugin-owned DOM | Use public `FileView.addAction`, maintain a weak registry, remove only owned elements, and retain Ribbon/command fallbacks. |
| Live chart and exported SVG diverge | Derive both from one immutable `ChartModel` and test value/color equality. |
| Frequent runtime updates cause excessive query/render work | Separate status snapshots from distribution invalidation and batch DOM updates. |
| Destructive UI executes a changed scope | Require a backend deletion plan and revalidate the exact plan ID before mutation. |
| Mobile lacks a desktop export or hover capability | Make viewing and navigation independent of both; capability-detect optional export and report its availability honestly. |
| Fixture tests are mistaken for real Obsidian evidence | Record automated and real desktop/mobile results separately and leave Roadmap acceptance open until each named journey passes. |

## Post-Critic Acceptance

- [ ] A real Obsidian desktop journey verifies installation, foreground tracking, idle recovery, pause/resume, directory drill-down, data controls, and both SVG exports.
- [ ] A real Obsidian mobile journey verifies plugin loading, existing-data display, range changes, breadcrumbs, details, and operation without hover.

## Evaluation Record

No implementation or Critic evaluation has started. Add numbered rounds only after every Phase and technical gate passes and the Spec enters `review`; reserve one available round for successful Post-Critic Acceptance evidence.
