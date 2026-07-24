# Header Popover File Activation Plan

## Metadata

| Field | Value |
| --- | --- |
| Created | 2026-07-24 |
| Scope | Header Popover file activation, chart/list interaction, and workspace leaf selection |
| Type | feat |
| Priority | P2 |
| Status | review |
| Completed | pending |
| Dependencies | [Header Popover file grouping](05-header-popover-file-grouping-plan.md), [Header Popover locate current file](08-header-popover-locate-current-file-plan.md) |
| Decisions | [Interface and export](../constitution/2026-07-21-activity-map-product-and-data.md#interface-and-export), [PRD chart popover](../../docs/PRD.md#环形图浮层), [Presentation architecture](../../ARCHITECTURE.md#presentation-and-export) |

## Phases

- [x] Phase 0: Carry trusted activation events to the public workspace-opening boundary
- [x] Phase 1: Add file-mode chart arming, list affordances, and the Popover hint
- [x] Phase 2: Synchronize documentation and collect technical evidence

## Background

### Problem

In file grouping, a chart slice currently opens its file on the first activation. That bypasses the newly available locate behavior: the user cannot first reveal the matching list row and then decide whether to open the file. File rows also always reuse an existing leaf, even when a desktop user intentionally holds `Cmd` or `Ctrl` to request a separate tab.

### Current Behavior

`DonutChart` and `ChartLegend` pass only a `DistributionItem` to `SummaryPopover.activateItem()`. The shared activation helper maps a present file to `open-file`, and the composition root always calls `Workspace.openLinkText(filePath, '', false)`. The `false` argument permits reuse of a navigable leaf. The existing locate action can scroll and highlight a list row, but it owns a two-second timer for the header's current file and must remain independent from this pointer-bounded interaction.

### Goals and Non-goals

Goals:

- In desktop file grouping, the first trusted unmodified primary click on a real file slice scrolls its matching legend row into view and arms only that slice; it does not open the file.
- While that armed slice remains under the pointer, give it a jump affordance and show one muted Popover-bottom instruction: `Click the slice again to open the file · cmd/ctrl-click opens a new tab.`
- Clear the armed state on that slice's `pointerleave`, keyboard `blur`, an activation of another item, a structural re-render, or Popover close. Do not use a timer.
- The second trusted primary click on the armed slice opens the file in the current leaf. A trusted `Cmd` on macOS or `Ctrl` on Windows/Linux opens an explicit new tab immediately, including as the first file-slice activation.
- File-grouping legend file rows remain one-click activation targets and always use the jump cursor; their `Cmd/Ctrl` activation opens an explicit new tab.
- Every file opening pins the Popover so the result remains available for further file activation. If the old header action is replaced, the fixed Popover retains its last resolved viewport position until its normal dismissal.
- Preserve the existing one-activation behavior for path grouping, directories, `Local files`, `Other`, deleted items, Page Preview, and non-mouse/touch activation.
- Provide keyboard-equivalent arming and opening behavior with a stateful accessible name and the same bottom instruction.

Non-goals:

- Change query grouping, scope totals, top-N/Other projection, directory navigation, persistence, tracking, or the locate-current-file control.
- Add a persistent selected-file state, settings, telemetry, note-content access, or a custom tab-management API.
- Treat `Cmd/Ctrl` as an override for directory drill-down, `Local files`, `Other`, or deleted-item behavior.
- Add a second Popover control row or a separate dialog. The new note belongs to the existing non-modal Header Popover, not the poster-export modal.

### Key Insight

The two-step behavior is a local presentation state keyed by one chart item ID. It is safe only for a real `file` slice in file grouping. The opening effect stays at the composition boundary: presentation passes a trusted activation event and an `openInNewTab` intent, while `ActivityMapPlugin` calls Obsidian's public `Workspace.openLinkText()` with `false` or the explicit `'tab'` pane type. No data or query state changes.

## Design

> Inherited design: [Interface and export](../constitution/2026-07-21-activity-map-product-and-data.md#interface-and-export), [PRD chart popover](../../docs/PRD.md#环形图浮层), and [Presentation architecture](../../ARCHITECTURE.md#presentation-and-export).
>
> Local delta: file-grouping chart slices receive a pointer-bounded arm-before-open state; file activations carry modifier intent to the existing public workspace boundary; the Popover receives one temporary instructional footer.

### Control Flow

```text
Trusted primary mouse activation on a chart item
  -> groupBy !== file or item.kind !== file
       -> existing activation contract unchanged
  -> Cmd/Ctrl is held
       -> clear any arm, pin the Popover, and open an explicit new tab
  -> armedFileItemId !== item.id
       -> cancel any other arm
       -> scroll the matching legend row into view
       -> set armedFileItemId = item.id
       -> chart slice gains alias cursor and armed accessible name
       -> Popover footer announces the second-click and Cmd/Ctrl instruction
  -> armedFileItemId === item.id
       -> clear arm, pin the Popover, and open in the current leaf

Armed file slice pointerleave / keyboard blur
  -> clear armedFileItemId, cursor class, accessible name, and footer text

Trusted file-row activation in file grouping
  -> pin the Popover, then open immediately (Cmd/Ctrl ? explicit 'tab' : reusable leaf)

Trusted touch activation
  -> retain the current single-activation behavior; no hover-only arm state
```

`pointerleave` is the sole normal pointer expiry. It makes the visual cue and the active state have the same boundary, avoids an invisible countdown after the cursor leaves the slice, and leaves the direct legend-row action available after the user moves to the list.

### Data Flow

```text
DonutChart / ChartLegend trusted MouseEvent or KeyboardEvent
  -> SummaryPopover
       -> file-grouping chart: transient armedFileItemId + scroll/highlight/footer
       -> file row or armed chart: { filePath, openInNewTab }
  -> HeaderActionManager openFile callback
  -> ActivityMapPlugin composition root
  -> Workspace.openLinkText(filePath, '', openInNewTab ? 'tab' : false)
```

`Workspace.openLinkText(..., 'tab')` is deliberately explicit. Boolean `true` requests a new leaf in the user's preferred root-split location and can produce a split; `'tab'` preserves the requested new-tab semantics.

### Reference Data Structures

```ts
type FileActivationEvent = MouseEvent | KeyboardEvent;

interface OpenFileRequest {
  readonly filePath: string;
  readonly openInNewTab: boolean;
}

interface ArmedFileSlice {
  /** Present only while the pointer/focus remains on this file-mode chart slice. */
  readonly itemId: string;
}
```

- `openInNewTab` is true only when a trusted file-opening activation has `metaKey || ctrlKey`.
- `ArmedFileSlice` is volatile Popover state. It is never persisted, stored in the view model, or inferred from the active Obsidian leaf.
- The footer is a stable, empty-by-default status slot below the chart/list result. It reserves one text-line height to avoid moving the Popover after the first click; only its text and armed presentation state change.

### Failure and State Semantics

- Synthetic clicks, secondary/middle buttons, and untrusted keyboard events cannot arm or open a file.
- An arm is cleared before any file-opening request, so a rejected `openLinkText()` promise cannot leave a stale jump cursor or instruction behind.
- Every file-opening request clears any arm and enters the existing pinned state before it changes the active leaf. A queued position pass closes an unpinned Popover with a detached anchor; a pinned Popover keeps its last resolved viewport coordinates instead of calculating a top-left fallback position.
- A live in-place distribution update may retain the arm only if the same chart item DOM identity survives. Any structural update, grouping/path/range/metric change, `Other` expansion, or Popover close clears it.
- The existing locate timer and locate icon remain unchanged. This feature never calls the timer-based locate method; it reuses only the safe legend-row scroll/highlight primitives needed to reveal the clicked file.
- The native Page Preview `defaultMod` hover source remains preview-only. A modifier click reaches the trusted activation path once and must not open a preview leaf or duplicate the open request.

## Phase 0: Carry Trusted File Activation to the Workspace Boundary

### Goal

Preserve the current shared activation semantics while allowing an eligible file activation to request an explicit Obsidian tab.

### Tasks

- [x] Extend donut and legend activation callbacks to carry the original trusted mouse or keyboard event without weakening their existing trust checks.
- [x] Add one narrow helper for `metaKey || ctrlKey` file-opening intent and one typed `openFile` request/callback contract through `SummaryPopover`, `HeaderActionManager`, and `main.ts`.
- [x] Map same-leaf opening to `Workspace.openLinkText(filePath, '', false)` and a modifier file open to `Workspace.openLinkText(filePath, '', 'tab')`.
- [x] Keep `distributionActivation()` authoritative for directory navigation, `Local files`, `Other`, deleted items, and present files; only its `open-file` consumer gains the new request option.
- [x] Add focused tests for trusted/untrusted and primary/non-primary events, normal file open, explicit new-tab open, keyboard modifiers, and unchanged non-file activation intents.

### Files

- `src/main.ts`
- `src/ui/header-action-manager.ts`
- `src/ui/summary-popover.ts`
- `src/ui/components/donut-chart.ts`
- `src/ui/components/chart-legend.ts`
- `src/ui/file-hover-preview.ts`
- `tests/ui/file-item-interactions.test.ts`
- `tests/ui/summary-popover.test.ts`

### Acceptance Criteria

- [x] A trusted normal present-file activation still opens one reusable leaf, while a trusted `Cmd/Ctrl` activation makes exactly one `openLinkText(..., 'tab')` call.
- [x] Synthetic, secondary, and middle-button activations cannot open or arm a file.
- [x] Directory, `Local files`, `Other`, and deleted activation outcomes are byte-for-behavior compatible with the current contract, including when a modifier is held.
- [x] Focused TypeScript and DOM tests cover mouse and keyboard contracts without relying only on source-string assertions.

## Phase 1: Add File-Mode Arming and the Popover Instruction

### Goal

Make an unmodified file-mode chart click a clear locate action while reserving direct opening for a visibly armed second click, a modifier click, or direct legend-row activation.

### Tasks

- [x] Add the single `armedFileItemId` owner to `SummaryPopover`, plus explicit arm/clear methods that coordinate the chart slice, legend highlight, animated row scroll, footer status, and Popover positioning.
- [x] In file grouping only, turn the first trusted desktop-mouse activation of a real `file` chart slice into arm-and-locate; a second activation of the same armed slice opens it. Keep touch activation single-step.
- [x] Clear the arm on the same slice's `pointerleave` or keyboard `blur`, on another activation, structural replacement, query/navigation changes, `Other` expansion, and Popover close. Do not add a timeout.
- [x] Mark armed chart slices and file-grouping legend file rows with scoped Activity Map classes; use the `alias` cursor as the portable jump affordance while preserving the existing pointer cursor everywhere else.
- [x] Add the stable bottom status slot with muted styling and the exact instruction `Click the slice again to open the file · cmd/ctrl-click opens a new tab.` only while armed.
- [x] Update the armed slice's accessible label/instructions and retain keyboard first-activate/second-activate behavior. The footer must announce the armed state without a second visible control row.
- [x] Preserve chart/list hover synchronization, Page Preview, reduced-motion behavior, current-file locate's independent two-second highlight, focus restoration, and in-place live updates.
- [x] Add DOM behavior tests for arm, scroll, cursor/status state, leave/blur cleanup, re-render/close cleanup, second-click normal/new-tab opening, direct legend opening, touch fallback, and all path-grouping regressions.

### Files

- `src/ui/summary-popover.ts`
- `src/ui/components/donut-chart.ts`
- `src/ui/components/chart-legend.ts`
- `src/ui/scroll-into-view-animated.ts`
- `styles.css`
- `tests/ui/summary-popover.test.ts`
- `tests/ui/locate-current-file.behavior.test.ts`
- `tests/ui/file-item-interactions.test.ts`

### Acceptance Criteria

- [x] In file grouping, the first desktop primary click without `Cmd/Ctrl` on a present file slice scrolls its existing legend row into view and displays the armed cursor and bottom instruction without opening a leaf.
- [x] The armed state ends immediately when the pointer leaves that slice or its keyboard focus blurs; it has no timer and cannot survive a structural Popover change or close.
- [x] The same armed slice opens once on its second trusted primary click; `Cmd/Ctrl` opens an explicit new tab whether used on the first or second file-slice activation.
- [x] File-grouping legend file rows show the jump cursor and open directly on one click, including the explicit new-tab modifier path.
- [x] A file opening automatically pins the Popover and retains it at its last resolved viewport position if the old header action disappears.
- [x] Path grouping and all non-file item interactions retain their current one-activation behavior.
- [x] The temporary footer is muted, layout-stable, accessible, and absent from the visible Popover outside the armed state.
- [x] Keyboard and touch paths remain usable without depending on a cursor.

## Phase 2: Synchronize Documentation and Collect Technical Evidence

### Goal

Record the approved interaction accurately without promoting fixture-only checks to real-Obsidian evidence.

### Tasks

- [x] Update the PRD's Header Popover interaction contract, the README feature description, this Spec, and the Roadmap only after the implementation exists.
- [x] Update `ARCHITECTURE.md` because the typed open request adds a composition-boundary contract.
- [x] Run type-check, lint, focused and complete tests, production build, strict specs validation, Markdown-link verification, and whitespace validation; record exact commands and results.
- [x] Keep the real-Obsidian checks in Post-Critic Acceptance and start the Critic only after technical gates pass.

### Files

- `docs/PRD.md`
- `README.md`
- `ARCHITECTURE.md` (if ownership changes)
- `specs/ROADMAP.md`
- `specs/active/09-header-popover-file-activation-plan.md`

### Acceptance Criteria

- [x] Product documentation distinguishes file-mode first-click locate, second-click opening, direct list activation, and `Cmd/Ctrl` new-tab behavior from unchanged path-mode navigation.
- [x] `npm run check`, `npm run lint`, `npm test -- --run`, and `npm run build` pass.
- [x] Strict specs validation, repository-relative Markdown-link and heading-fragment checks, and `git diff --check` pass.
- [x] The Spec records fixture evidence separately from the required real-Obsidian journey.

## Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| A hidden timer makes a second click unpredictable | Expire only on `pointerleave`/`blur` and lifecycle replacement; do not schedule a timer. |
| A chart click changes directory behavior | Gate arming on `groupBy === 'file' && item.kind === 'file'`; all other items use the existing activation contract. |
| A boolean new-leaf request opens a split | Use the public explicit pane type `'tab'`, not boolean `true`. |
| A file open replaces its header anchor and repositions the Popover | Pin before opening; preserve the last resolved fixed position while a pinned Popover's anchor is detached. |
| Cmd/Ctrl hover preview and click double-open a file | Preserve Page Preview as preview-only and assert exactly one workspace open call per trusted click. |
| Touch cannot use hover or a cursor | Retain current single-tap activation and test it separately. |
| Accessibility relies only on cursor shape or color | Update the armed slice's accessible instruction, announce the footer, and retain keyboard activation. |

## Post-Critic Acceptance

- [ ] In real Obsidian desktop file grouping, the owner clicks a present file slice once without a modifier and confirms its row scrolls into view, the jump cursor and muted instruction appear, and no file opens; moving away clears both affordances.
- [ ] The owner confirms a first `Cmd/Ctrl` slice click immediately opens one new tab, while a second unmodified click opens in the current leaf; each file open pins the Popover without moving it to the top-left. A file-row click has the same normal/modifier opening behavior without the first-click arm.
- [ ] In real Obsidian path grouping, the owner verifies directory drill-down, `Local files`, `Other`, file opening, Page Preview, and keyboard/touch interactions retain their existing behavior.

## Evaluation Record

### Executor Evidence — 2026-07-24

- `npm run check` passed.
- `npm run lint` passed.
- `npm test -- --run` passed: 317 tests, 0 failures. This suite includes the repository-relative Markdown-link and heading-fragment validation plus focused file-activation, modifier, and Popover DOM behavior coverage.
- `npm run build` passed.
- `git diff --check` passed.
- The initial strict validation exposed the historical Spec 06 record mismatch. After the owner authorized its final Round 3 pass, Spec 06 was archived and the workspace validation passed with no errors or warnings.

All implementation phases and technical gates are complete. The Spec is in `review`; the three real-Obsidian checks remain intentionally open in Post-Critic Acceptance and belong to the owner.

### Owner-Directed UAT Corrections — 2026-07-24

- Real-Obsidian Cmd-click exposed a stale Popover that could be re-positioned to the window's top-left after the new tab replaced its header anchor.
- The initial close-before-open containment was superseded by the owner's follow-up: a first `Cmd/Ctrl` slice activation bypasses arming and opens a new tab, while every file opening enters pinned mode for continued exploration.
- A detached pinned Popover now retains its last resolved viewport position; only an unpinned detached Popover closes. `HeaderActionManager` retains detached pinned Popovers for normal dismissal and plugin teardown.
- `npm test -- --run tests/ui/locate-current-file.behavior.test.ts` passed: 319 tests, 0 failures (the repository runner executes the complete suite).
- `npm run check`, `npm run lint`, `npm run build`, strict Specs validation (0 errors, 0 warnings), and `git diff --check` passed.
- The correction is uncommitted pending owner re-test. It does not satisfy or alter the open Post-Critic real-Obsidian acceptance checks.

### Round 1

- Critic: `spec09_critic` (fresh, read-only independent review)
- Review scope: full
- Evidence reviewed: the implementation and documentation diff; `npm run check`; `npm run lint`; `npm test -- --run` (317 passed); `npm run build`; strict Specs validation; and `git diff --check`.
- Findings: P1 — the initial Spec 06 archival record retroactively described a Critic review of the later CodeMirror correction; P2 — Spec 09 exercised private Popover methods but did not cover the Donut keyboard trust boundary.
- Selected fixes: P1 historical-record correction; P2 keyboard trust helper and focused keyboard behavior coverage.
- Executor fixes: archived Spec 06 with its original Round 3 chronology intact and an explicit owner-authorized final verdict adjustment; added `isTrustedKeyboardActivation()` at the Donut boundary, plus synthetic/non-activation rejection and keyboard arm/second Cmd/Ctrl-open tests.
- Deferred findings: none.
- Validation rerun: `npm run check`; `npm run lint`; `npm test -- --run` (317 passed); `npm run build`; `python3 "$SPEC_DRIVEN_DELIVERY_DIR/scripts/validate_specs_workspace.py" . --strict` (0 errors, 0 warnings); `git diff --check`.
- Verdict: changes-required

### Round 2

- Critic: `spec09_critic` (same independent read-only reviewer)
- Review scope: full
- Evidence reviewed: the corrected implementation, Spec 06 archive chronology, focused keyboard trust and arm/open tests, and the complete validation rerun.
- Findings: none.
- Selected fixes: none.
- Executor fixes: none; the Round 1 correction batch was confirmed.
- Deferred findings: none.
- Validation rerun: `npm run check`; `npm run lint`; `npm test -- --run` (317 passed); `npm run build`; `python3 "$SPEC_DRIVEN_DELIVERY_DIR/scripts/validate_specs_workspace.py" . --strict` (0 errors, 0 warnings); `git diff --check`.
- Verdict: pass
