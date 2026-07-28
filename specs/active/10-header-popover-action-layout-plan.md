# Header Popover Action Layout Plan

## Metadata

| Field | Value |
| --- | --- |
| Created | 2026-07-28 |
| Scope | Header Popover action layout, settings editor, and local preference persistence |
| Type | feat |
| Priority | P1 |
| Status | in-progress |
| Completed | pending |
| Independent review | off |
| Dependencies | [Header Popover file activation](09-header-popover-file-activation-plan.md) supplies the current pinned/hover and trusted-pointer baseline; this Spec cannot complete before its owner acceptance closes. |
| Decisions | [Interface and export](../constitution/2026-07-21-activity-map-product-and-data.md#interface-and-export), [Header Popover](../../docs/PRD.md#环形图浮层), [Presentation and settings architecture](../../ARCHITECTURE.md#presentation-and-export) |

## Decision Summary

| State | Result |
| --- | --- |
| Agent can continue | `yes` |
| User decision required | `no` |
| Ready for acceptance now | `no` |
| Current blockers | `0` |
| Potential blockers | `2` |

- Next action: Collect the owner desktop/mobile UAT; all scoped automated gates have passed, while the repository-wide strict workspace validator remains blocked by legacy Spec records.

### Current blockers

- None.

### Potential blockers

- `R1` (Owner: Agent / Phase 3): The current hover Popover may receive a leave, context-menu, or pointer-cancel event during a long press or touch drag; collect separate real desktop and mobile evidence before treating the direct editor as accepted.
- `R2` (Owner: Agent / Phase 3): Verify in Obsidian that entering edit mode makes the metric and range controls inert without disturbing ordinary custom-listbox focus, close, or live-update behavior after exit.

## Phases

- [x] Phase 0: Add the validated action-layout preference and pure move projection.
- [x] Phase 1: Add the one-row, staged Settings editor.
- [x] Phase 2: Add Header Popover long-press editing without unmounting results.
- [ ] Phase 3: Synchronize product documentation, run gates, and collect owner UAT.

## Background

### Problem

The customizable target is the top action row of the Header Popover that opens from the file-header Activity Map chart. It is not the poster-export dialog. Today the row has three leading actions—tracking, path/file grouping, and poster export—then the selected-day navigation when day mode is active, followed by Locate, metric, and date-range controls. Its order and visibility are hard-coded.

Users need to put the actions they use most often in a personal order and temporarily remove others without losing a recovery path. They need both a deliberate Settings entry and a faster direct-manipulation shortcut in the Header Popover itself.

### Current Behavior

`SummaryPopover` builds the leading tracking/grouping/export actions and passes them to `renderRangeControls`. That component independently renders the day navigation, Locate action, metric listbox, and date-range listbox. `ActivityMapSettings` has no action-layout field. The Settings tab saves its current controls immediately through `ActivityMapController`, while `SettingsRepository` already serializes writes and leaves its effective settings unchanged after a failed save.

The chart, legend, breadcrumb, loading retention, live updates, pinning, locating, and file activation are independent of the control-row layout. They must remain so.

### Goals and Non-goals

Goals:

- Persist one validated user layout for six configurable Header Popover controls: `tracking-toggle`, `distribution-grouping-toggle`, `poster-export`, `locate-current-file`, `metric`, and `date-range`.
- Keep the selected-day navigation fixed between two equivalent action regions. The default left order is tracking, grouping, poster export; the default right order is Locate, metric, date range.
- Let Settings show the full Popover action row as a single WYSIWYG draft: controls can be reordered within either region, moved to the other region, or moved to a recoverable disabled area below the row.
- Let a long press on any visible configurable Popover control enter a temporary iOS-style edit mode: that same control immediately becomes the active drag, editable controls visibly wobble, and the chart/list/breadcrumb/status remain mounted.
- Put disabled controls in the edit footer's left area and fixed `Cancel` then `Save` actions on its right. Only `Save` persists; `Cancel` restores the pre-edit layout.

Non-goals:

- Do not customize the poster-export dialog, its preview, caption, download action, or renderer contract. This Spec only controls whether its existing launcher appears in the Header Popover row.
- Do not make previous day, selected date, or next day configurable, removable, or movable. Existing range semantics still decide whether the day-navigation control is rendered.
- Do not add a global toolbar, command, account, telemetry, remote sync, per-device profiles, or another Popover layout.
- Do not change activity tracking, grouping/query results, Locate behavior, metric/range semantics, chart data, legend behavior, or file activation.

### Interaction Contract

| Surface | Editable area | Fixed area | Commit behavior |
| --- | --- | --- | --- |
| Settings | One complete WYSIWYG Header Popover row; actions appear in their actual positions and can move within or between either region. | Center previous-day / selected-date / next-day preview; no separate left/right management lists. | The local draft persists only through the section's `Save`; `Cancel`, Settings hide, and a re-display discard it. |
| Header Popover, normal mode | None; all enabled controls retain their present behavior. | Chart, legend, breadcrumb, status, center navigation, Popover pinning, and close behavior. | No layout mutation. |
| Header Popover, edit mode | Visible configurable controls wobble and accept pointer drag; a lifted icon/text avatar follows the pointer while dashed rounded slots preview permitted placement and reflow siblings. The lower disabled area accepts a drop and exposes recoverable controls. | Center navigation stays still; the result content remains visible and mounted. | `Save` persists the draft. `Cancel`, `Escape`, Popover close, an external committed layout change, or a structural rerender discards it. |

### Key Insight

The persisted preference must contain only an action identity, selected side, side-local order, and enabled state. A built-in registry owns each action's label, handler kind, default side, and default order. That makes a corrupt or future layout safe to normalize while letting Settings and the live Popover share one projection and one drag reducer.

## Increment Contract

### Starting Runnable Baseline

- Public entrypoint: open the Activity Map Header Popover from its file-header miniature, then use its top-row actions; open Activity Map Settings through Obsidian Settings.
- Baseline smoke: in a desktop vault, open the Header Popover in day mode and verify the current leading actions, fixed previous/selected/next day controls, Locate, metric, date range, chart, breadcrumb, and legend are usable; reopen Settings and verify ordinary controls persist through the controller.
- Observable result: all six configurable controls are currently visible in one fixed order, and no layout preference exists.

### User Story

As an Activity Map user, I can arrange the configurable controls in the actual Header Popover row and disable unneeded controls through Settings or a long press in that Popover, so that its controls match my workflow while the chart and date navigation remain stable.

### Scope Boundary

- Included: a global local layout preference, registry validation, one-row staged Settings editor, in-Popover long-press edit session with immediate drag continuation, cross-region pointer/keyboard moves, disabled recovery area, explicit save/cancel, DOM/accessibility coverage, and real desktop/mobile verification.
- Deferred: per-vault/device layout synchronization and conflict handling to `v0.2`; new Header Popover actions to a later implementation Spec that extends the registry; any poster-export-dialog redesign remains owned by [Poster export](07-poster-export-plan.md).

### Prerequisite Audit Details

<details>
<summary>Expand prerequisite sources, setup, verification, and cleanup</summary>

| Prerequisite | Class | Source or owner | Provision or setup | Verification | Cleanup |
| --- | --- | --- | --- | --- | --- |
| Header Popover and its six existing controls | `baseline-verified` | `SummaryPopover`, `renderRangeControls`, and their current UI tests | Open the existing file-header action in a test vault. | All existing control IDs and their ordinary handlers are present before layout projection. | Close the Popover; no resource is created. |
| Durable small settings write with failure retention | `baseline-verified` | `SettingsRepository` and controller `update-settings` path | Use the existing fake settings store in focused tests. | A successful write publishes the normalized setting; a rejected write keeps the former effective setting. | In-memory store only. |
| Validated layout model and shared projection | `phase-produced` | Phase 0 | Add the registry, normalizer, move reducer, and tests. | Invalid, duplicate, unknown, invalid-side, or partial persisted data projects to all six known actions exactly once. | No external resource is created. |
| WYSIWYG Settings draft | `phase-produced` | Phase 1 | Mount the reusable editor in the Settings tab. | Reload/reopen proves no draft writes before Save and a failed Save preserves the draft. | Discard the local draft on cancel/hide. |
| Long press and edit footer in native Popover | `phase-produced` | Phase 2 | Attach pointer lifecycle handling to the existing controls and render the editor/footer without replacing result nodes. | Desktop and mobile UAT prove long press, drag, cancellation, and retained chart/list behavior. | Cancel timers, pointer capture, and edit state on close/rerender. |

</details>

### Runnable Acceptance

- Success smoke: customize the whole row in Settings, save, open the Header Popover and observe the same side/order/visibility; long-press a visible Popover control, continue dragging it into the other region, move another control to the disabled footer, restore one to either region, then save and reopen the Popover.
- Expected failure: dropping directly onto the fixed center navigation leaves the layout unchanged; a failed settings write preserves the committed layout and leaves the draft available for retry or cancel.
- Regression smokes: ordinary click/keyboard activation of every still-enabled action, day navigation, chart/list live update, breadcrumb navigation, Locate, grouping, tracking pause/resume, pin/unpin, file activation, and poster export launcher retain their current contracts.
- Observable evidence: focused normalization/repository/DOM tests, production gates, and owner desktop/mobile recordings or screenshots that show the Settings row, edit footer, saved result, and cancel rollback.

### Extension Seams

- Action registry: adding a future configurable action requires one registry entry with default side/order plus an explicit production renderer/handler; persisted data never supplies a handler.
- Layout reducer: both Settings and Popover issue the same typed move request, so a later keyboard, touch, or alternate surface uses the same validation without cloning reorder rules.
- Edit session: the committed setting remains the sole source of runtime behavior; the volatile draft can later gain conflict UI without changing persistence semantics.

## Design

> Inherited design: [Header Popover UI contract](../../docs/PRD.md#环形图浮层), [stable presentation and local-settings boundaries](../constitution/2026-07-21-activity-map-product-and-data.md#interface-and-export), and [current presentation flow](../../ARCHITECTURE.md#presentation-and-export).
>
> Local delta: make the six existing Header Popover controls a validated, two-region presentation preference. The entire customization workflow operates on the Header Popover row; no export dialog is reinterpreted as the target surface.

### Control Flow

```text
Plugin load
  -> SettingsRepository.load()
  -> normalizeSettings()
       -> normalizeHeaderPopoverActionLayout()
       -> known registry actions exactly once, safe default side for missing/invalid data
  -> ActivityMapController view model
  -> Header Popover projects enabled actions into left / right regions

Settings: open Header Popover controls
  -> clone committed layout into a local draft
  -> render one day-mode WYSIWYG row: left actions | fixed navigation | right actions
  -> pointer drag or keyboard move
       -> shared reducer reorders, changes region, or moves to disabled
  -> Save
       -> controller update-settings
       -> repository serialized write succeeds
       -> published committed layout replaces draft
  -> Cancel / Settings hide / failed write
       -> discard or retain local draft as appropriate; persisted layout is unchanged on failure

Header Popover: pointerdown on an enabled configurable control
  -> release / cancel / movement beyond tolerance before 500 ms
       -> keep normal action behavior
  -> hold for 500 ms
       -> suppress that action's activation and context menu
       -> freeze hover-close scheduling for the edit session
       -> clone committed layout into Popover draft
       -> replace only control-row interaction layer and immediately lift that same action into a drag
       -> keep chart, legend, breadcrumb, and status mounted
  -> drag to either action region or to disabled footer
       -> shared reducer updates draft and insertion affordance
  -> Save
       -> durable controller update then exit edit mode
  -> Cancel / Escape / Popover close / structural rerender / external layout update
       -> discard draft; retain or restore the last committed projection
```

`Escape` in edit mode first cancels the draft and returns to normal Popover interaction; a subsequent `Escape` follows the existing Popover-close contract. A structural render is any path that clears/replaces the Popover root or its control row. It must discard the draft before removal; in-place chart/legend live updates do not by themselves end an edit session.

### Data Flow

```text
persisted JSON
  -> ActivityMapSettings.headerPopoverActionLayout
  -> normalizeHeaderPopoverActionLayout(registry)
  -> committed layout in ActivityMapViewModel
       -> Header Popover control projection
       -> Settings editor initial draft

Settings or Popover drag
  -> HeaderPopoverLayoutMove
  -> pure reducer
  -> volatile draft only
  -> Save
       -> ActivityMapController.update-settings
       -> SettingsRepository serialized save
       -> normalized committed layout
       -> controller publish
       -> normal Header Popover projection
```

The layout changes presentation only. It never changes the `DistributionQuery`, chart model, distribution result, tracking state, file identity, raw evidence, or export snapshot.

### Reference Data Structures

```ts
type HeaderPopoverActionSide = 'left' | 'right';

type HeaderPopoverActionId =
	| 'tracking-toggle'
	| 'distribution-grouping-toggle'
	| 'poster-export'
	| 'locate-current-file'
	| 'metric'
	| 'date-range';

interface HeaderPopoverActionLayoutItem {
	readonly id: HeaderPopoverActionId;
	/** Current region around the fixed selected-day navigation. */
	readonly side: HeaderPopoverActionSide;
	/** Zero-based order among actions in the current side. */
	readonly order: number;
	readonly enabled: boolean;
}

interface HeaderPopoverActionDefinition {
	readonly id: HeaderPopoverActionId;
	readonly defaultSide: HeaderPopoverActionSide;
	readonly defaultOrder: number;
}

type HeaderPopoverLayoutDestination =
	| { readonly kind: 'side'; readonly side: HeaderPopoverActionSide; readonly index: number }
	| { readonly kind: 'disabled' };
```

`HeaderPopoverActionDefinition` is application code, not persisted JSON. `normalizeHeaderPopoverActionLayout()` accepts only known action IDs, uses the first valid record for a duplicate, repairs side/order deterministically, applies default placement for missing or malformed records, and produces one canonical item per registry action. `moveHeaderPopoverAction()` accepts either action region while the fixed center navigation remains non-droppable. Disabled items retain identity and remain visible in the lower recovery area during editing.

### Rendering and Interaction Rules

- Normal rendering projects enabled left actions, the unchanged center day navigation when the selected range is a day, and enabled right actions. The right controls retain their existing component-specific behavior: Locate is an icon action, metric is a metric listbox, and date range is a range listbox.
- The Settings preview uses the same control descriptors in an inert day-mode representation with a deterministic selected-date label. It visually mirrors the whole row without invoking tracking, query, download, or date behavior.
- Settings has no left/right management sections. Its row and its lower disabled zone are the only management surface. Either action region may be empty; edit mode renders an explicit insertion target in it.
- A pointer drag uses Pointer Events and pointer capture, not HTML5 drag-and-drop, so desktop mouse and touch use one model. Adjustable controls expose `grab`, the active drag exposes `grabbing`, and a cloned icon/text avatar follows the pointer without receiving events. The source action leaves a dashed rounded slot; moving across an action's horizontal midpoint moves that slot between adjacent actions in either region so siblings reflow as a draft-only ordering preview. Dropping on the fixed center navigation never mutates the draft and release restores the unchanged row.
- Keyboard operations call the same reducer: focused action plus `Space` begins/ends a move, left/right changes its position and crosses to the adjacent region at its outer edge, down disables it, and a disabled action can return to either region. The editor announces the resulting position through a scoped live region. `Escape` cancels the active keyboard move before it cancels the draft.
- The long-press threshold is 500 ms with an 8 px movement tolerance. `pointerup`, `pointercancel`, or movement beyond tolerance cancels the timer. Once the threshold fires, the source action's click is consumed, the source enters the active drag immediately, and the normal context menu is suppressed for that gesture.
- Edit mode makes enabled configurable controls visibly wobble with a non-motion outline/focus alternative under `prefers-reduced-motion`. The fixed center navigation never wobbles or becomes a drop target.
- Edit mode is an interaction lock, not a data refresh. It cancels the existing hover-close timer and prevents hover leave from closing the Popover while a drag is active. Outside close still follows the existing close path and discards the draft.
- The edit footer is appended below the still-mounted Popover result. Its disabled controls sit at the left; `Cancel` and primary `Save` stay at the right. Saving disables reorder/cancel until the persistence promise resolves. A failed save restores editing controls, announces the error, and does not change the committed layout.
- A Settings save or another committed layout update received while the Popover is editing discards that Popover draft rather than merging independent drafts. The newly committed layout then renders normally.

### Failure and State Semantics

| Event | Required result |
| --- | --- |
| Missing, corrupted, unknown, duplicate, invalid-side, or partial persisted item | Normalize to a complete six-action canonical layout; do not throw and do not create a new handler. |
| A side has no enabled actions | Keep its edit-mode drop target; ordinary Popover remains usable through the fixed center controls and Settings remains the recovery entry. |
| Drop onto fixed center navigation | Retain the exact draft and restore its current row after release. |
| Save succeeds | Publish the normalized layout through the controller, exit the local edit state, and render only the persisted projection. |
| Save rejects | Retain the pre-save committed layout, keep the draft editable, show an actionable error, and never optimistically reorder another Popover. |
| Cancel, Escape, Settings hide, Popover close, or structural rerender | Destroy transient pointer/timer/listener state and discard the draft without a settings write. |
| Long press begins while a button normally activates | Suppress that one activation; normal short click/keyboard activation remains unchanged outside edit mode. |
| Chart/list live update during edit | Preserve mounted result nodes and current draft when it is an in-place update; discard before a structural Popover/control-row replacement. |

## Phase 0: Add the Validated Layout Preference

### Goal

Make one durable, safe layout contract available to both surfaces before any drag UI is introduced.

### Tasks

- [x] Add a narrow domain module containing the immutable six-action registry, default layout, normalizer, side-aware projection, and pure move reducer.
- [x] Add `headerPopoverActionLayout` to `ActivityMapSettings` and `DEFAULT_SETTINGS`; normalize it at the settings boundary without accepting a persisted label, callback, or unknown action.
- [x] Preserve the current six-control visual order as the first-run default and serialize the canonical layout through the existing settings repository/controller path.
- [x] Add focused domain and repository tests for absent/legacy settings, malformed records, duplicates, unknown IDs, fractional/negative orders, missing entries, region-local reorder, cross-region moves, disable/re-enable, empty-side insertion, reload, serialized saves, and rejected saves.

### Files

- `src/domain/header-popover-action-layout.ts`
- `src/domain/settings.ts`
- `src/data/settings-repository.ts` only if the typed settings boundary needs an explicit adjustment
- `src/ui/activity-map-controller.ts` only if a typed layout patch helper is required; retain the existing persistence commit point
- `tests/domain/header-popover-action-layout.test.ts`
- `tests/data/settings-repository.test.ts`
- `tests/ui/activity-map-controller.test.ts`

### Acceptance Criteria

- [x] Absent settings normalize to the current tracking/grouping/poster-export | Locate/metric/date-range order, all enabled.
- [x] Every normalized layout contains each of the six recognized IDs exactly once and has deterministic side-local order with a valid selected side.
- [x] A pure reducer can reorder an action, move it between either region, move it to disabled, and restore it into an explicit region/index.
- [x] A failed `SettingsRepository` save leaves the controller's committed layout and all runtime behavior unchanged.
- [x] Focused domain, repository, and controller tests pass without relying on a mounted Popover.

### Evidence — 2026-07-28

- `npm run lint` passed.
- `npm run check` passed.
- `npm test -- --run` passed: 330 tests, 0 failures. This includes the earlier normalization, recovery-area, repository-reload, and failed-save retention coverage; current cross-region evidence is recorded in Phase 3.
- `npx prettier --check src/domain/header-popover-action-layout.ts src/domain/settings.ts tests/domain/header-popover-action-layout.test.ts tests/data/settings-repository.test.ts` passed after formatting.
- `git diff --check` passed.

## Phase 1: Add the One-Row Settings Editor

### Goal

Give users a safe, staged WYSIWYG way to customize the complete Header Popover row.

### Tasks

- [x] Add a reusable action-layout editor component that receives a committed layout or local draft, the registry projection, move callbacks, and a presentation mode; do not duplicate sorting or validation in Settings.
- [x] Add one `Header Popover controls` section to `ActivityMapSettingsTab`. Render a single inert day-mode WYSIWYG row with left actions, fixed date navigation, right actions, and a lower disabled drop area; do not render separate side lists.
- [x] Keep this section's draft separate from Settings controls that retain their existing immediate-save behavior. Add explicit `Save` and `Cancel`; discard the layout draft on tab hide/re-display.
- [x] On Save, dispatch one `update-settings` patch and wait for durable success. On failure, preserve the editor draft and show an actionable message; on Cancel, restore the committed layout without a write.
- [x] Support Pointer Events and the shared keyboard move contract with proper labels, insertion/constraint announcements, visible focus, and reduced-motion-safe affordances.

### Files

- `src/ui/components/header-popover-action-layout-editor.ts`
- `src/ui/settings-tab.ts`
- `styles.css`
- `tests/ui/header-popover-action-layout-editor.test.ts`
- `tests/ui/settings-tab.test.ts`
- `tests/ui/accessibility.test.ts`

### Acceptance Criteria

- [x] Settings renders one whole Popover-row preview with the fixed center navigation, not separate left/right management lists.
- [x] Dragging and keyboard operations update only a local draft, keep the center non-droppable, and make disabled actions recoverable.
- [x] Save persists exactly one normalized patch and makes a reopened Settings tab and Header Popover show it; Cancel/hide performs no layout write.
- [x] A save failure leaves the pre-existing runtime layout intact and lets the user retry or cancel the visible draft.
- [x] Focus, accessible action names, instructions, live updates, and reduced-motion presentation pass focused DOM/accessibility coverage.

### Evidence — 2026-07-28

- `npm run lint` passed.
- `npm run check` passed.
- `npm test -- --run` passed: 335 tests, 0 failures. This includes the earlier settings-row DOM coverage for fixed navigation, pointer disable/restore, and keyboard reordering; current cross-region evidence is recorded in Phase 3.
- `git diff --check` passed.

## Phase 2: Add In-Popover Long-Press Editing

### Goal

Let users make the same staged layout change directly in the live Header Popover without hiding its activity information.

### Tasks

- [x] Refactor `renderRangeControls` around the registry-backed left/right action projection while retaining current action handlers, DOM IDs, metric/range listboxes, day navigation, and in-place update APIs.
- [x] Mount the reusable action-layout editor in `SummaryPopover` edit mode. Add 500 ms long-press detection and click/context-menu suppression only after the gesture enters edit mode.
- [x] Make all visible configurable controls wobble and draggable in edit mode; provide a pointer-following icon/text avatar, `grab`/`grabbing` cursors, rounded dashed insertion slots with cross-region reflow preview, and direct drag continuation from long press. Keep center navigation, chart, legend, breadcrumb, loading/error status, pinning, and file-activation surfaces mounted and non-draggable.
- [x] Add the lower footer with disabled controls on the left and fixed `Cancel` / `Save` on the right. Use the shared draft/reducer and controller persistence path.
- [x] Implement cancellation on Escape, close, structural rerender, and externally committed layout changes; dispose timers, pointer capture, custom listbox listeners, and edit affordances at their owning boundary.
- [x] Add DOM behavior tests for normal short activation, long-press activation suppression, drag/reorder/disable/restore, rejected targets, save/cancel/failure behavior, close/rerender disposal, retained chart/legend node identity, and existing Popover interactions.

### Files

- `src/ui/components/range-controls.ts`
- `src/ui/components/header-popover-action-layout-editor.ts`
- `src/ui/summary-popover.ts`
- `styles.css`
- `tests/ui/summary-popover.test.ts`
- `tests/ui/header-popover-action-layout-editor.test.ts`
- `tests/ui/header-popover-action-layout-popover.test.ts`
- `tests/ui/grouping-controls.behavior.test.ts`
- `tests/ui/locate-current-file.behavior.test.ts`
- `tests/ui/accessibility.test.ts`

### Acceptance Criteria

- [x] A short activation retains the current handler behavior; a 500 ms long press enters edit mode without triggering the pressed control.
- [x] In edit mode the user sees all enabled configurable controls wobble, a lifted icon/text avatar, `grab`/`grabbing` cursors, and a dashed rounded insertion slot that previews reflow in either action region. Long press immediately lifts the pressed control; users can move it across the fixed center navigation, move controls to the footer, and restore a disabled control to either region.
- [x] Chart, legend, breadcrumb, and status remain visible and preserve their mounted DOM identity while entering/exiting edit mode and during draft-only moves.
- [x] `Cancel`, Escape, Popover close, structural rerender, and external committed-layout change discard the local draft; `Save` is the only persistence path.
- [x] The footer keeps disabled controls left and `Cancel`/`Save` right; a rejected save returns to an editable, correctly announced draft.
- [x] Existing day navigation, Locate, metric/range listboxes, grouping, tracking, pinning, live updates, and file-activation regression tests pass.

### Evidence — 2026-07-28

- `npx prettier --write src/ui/components/header-popover-action-layout-editor.ts src/ui/components/range-controls.ts src/ui/summary-popover.ts styles.css tests/ui/header-popover-action-layout-popover.test.ts` completed.
- `npm run check` passed.
- `npm run lint` passed.
- `npm test -- --run` passed: 338 tests, 0 failures. The direct-Popover DOM coverage verifies committed layout projection, normal short activation, 500 ms long press, retained chart/legend nodes, cancel rollback, disabled-footer save, and failed-save retention.
- `npm run build` passed.
- `git diff --check` passed.

## Phase 3: Synchronize Documentation and Verify the Runnable Journey

### Goal

Describe the new Header Popover behavior accurately and prove it through technical gates plus real Obsidian interaction.

### Tasks

- [x] Update the PRD's Header Popover and Settings descriptions after implementation, including the two entry points, fixed date-navigation boundary, draft-only save/cancel semantics, and the explicit poster-dialog scope boundary.
- [x] Update the Constitution's stable interface/settings decision and history because the layout is a persisted local presentation preference with immutable control-side boundaries.
- [x] Update Architecture with the new domain preference, presentation projection, volatile edit-session ownership, and persistence flow; update README/settings help and the Roadmap outcome only after the product behavior exists.
- [x] Run formatting, type-check, lint, full test, production build, repository-relative Markdown link/heading checks, and whitespace checks; record the separate strict-workspace validator result without widening this Spec to legacy workspace repair.
- [ ] Collect owner desktop and mobile acceptance evidence separately from DOM/fixture tests. Do not claim either from automated gates.

### Files

- `docs/PRD.md`
- `specs/constitution/2026-07-21-activity-map-product-and-data.md`
- `ARCHITECTURE.md`
- `README.md`
- `specs/ROADMAP.md`
- `specs/active/10-header-popover-action-layout-plan.md`

### Acceptance Criteria

- [x] Product and architecture documents name the Header Popover as the target surface and do not describe the poster-export dialog as customizable.
- [x] `npm run check`, `npm run lint`, `npm test -- --run`, and `npm run build` pass.
- [ ] `python3 "${SPEC_DRIVEN_DELIVERY_DIR:?set SPEC_DRIVEN_DELIVERY_DIR}/scripts/validate_specs_workspace.py" . --strict`, repository-relative Markdown link/heading validation, and `git diff --check` pass.
- [x] The Spec records automated evidence, real desktop evidence, and real mobile evidence as separate verification classes.

### Evidence — 2026-07-28

- `npm run format:check` passed.
- `npm run check` passed.
- `npm run lint` passed.
- `npm test -- --run` passed: 341 tests, 0 failures. This includes repository-relative Markdown target and heading-fragment validation, plus focused action-layout coverage for persisted cross-region placement, direct long-press lift, avatar/`grabbing` feedback, insertion-slot reflow, cross-region moves, direct-Popover cross-region save, invalid-drop restoration, persistence, and accessibility.
- `npm run build` passed.
- `git diff --check` passed.
- The strict validator (`python3 "$SPEC_DRIVEN_DELIVERY_DIR/scripts/validate_specs_workspace.py" . --strict`) ran and reported 16 errors and 2 warnings outside this Spec: legacy active Specs 01–05 and 07–09 lack the newer Decision Summary and Increment Contract headings; unchanged root and `specs/AGENTS.md` architecture-link checks also warn. This feature's documents and links are covered by the passing Markdown-link test, but the repository-wide strict acceptance checkbox remains open until those historical workspace records are separately repaired.
- Real desktop and mobile UAT remain user-owned and open below; no fixture or DOM test is presented as that evidence.

## Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| A persisted layout moves the center navigation or creates an action | Keep action identity and handlers in the code registry; persist only a validated action side, order, and enabled state. |
| Corrupt JSON hides all controls permanently | Normalize all six known IDs exactly once; Settings remains a recovery path even if both action sides are empty. |
| Dragging a dropdown opens it or starts a query | Consume activation only after long-press entry and make all configurable controls inert while edit mode owns their pointer events. |
| Hover Popover closes in the middle of a drag | Use an edit-session interaction lock, pointer capture, and the existing close path's mandatory draft discard. |
| Entering edit clears live activity information | Replace only the control-row interaction layer; explicitly retain chart/legend/breadcrumb/status handles and test node identity. |
| Save failure leaves Settings and Popover visually divergent | Treat repository success as the sole commit point; retain the local draft, show an error, and publish no optimistic global layout. |
| Motion causes discomfort or hides edit affordance | Honor reduced-motion and provide a persistent outline/focus treatment plus accessible edit-state messaging. |
| A future action requires duplicated drag rules | Add it through the registry and reuse the pure projection/reducer; do not deserialize visual behavior or callbacks. |

## User Acceptance

- [ ] Desktop: in a real vault, open Settings and arrange the full one-row preview by moving an action across the fixed center navigation and another into the disabled area. Save, reopen the Header Popover, and confirm the same row layout while previous/selected/next day remains centered and fixed.
- [ ] Desktop: long-press an enabled Header Popover control for 500 ms, confirm the control itself did not activate, immediately lifts into drag without a second press, every editable action has the edit affordance, and the chart, legend, breadcrumb, and status remain visible. Move it across the center navigation, drag a control into the disabled footer, restore one to either region, then Save.
- [ ] Desktop: repeat a direct edit, choose Cancel, then repeat and press Escape; close the Popover during a third draft. Each time confirm the pre-edit persisted layout returns. Confirm a failed-save test path preserves the draft and the last committed runtime row.
- [ ] Mobile: open the Header Popover through the non-hover entry, long-press and drag with touch, Save and reopen, then confirm the fixed navigation and remaining control actions remain usable without relying on hover.
- [ ] Desktop and mobile: verify tracking, grouping, Locate, metric, date range, day navigation, chart/list updates, file activation, and the poster-export launcher still perform their existing jobs. The poster-export dialog itself remains unchanged.
