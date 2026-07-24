# typedChars metric plan

## Metadata

| Field | Value |
| --- | --- |
| Created | 2026-07-23 |
| Scope | Trusted input boundary, raw event schema, daily aggregate, distribution query, metric control |
| Type | feat |
| Priority | P1 |
| Status | completed |
| Completed | 2026-07-23 |
| Dependencies | [Product requirements](../../docs/PRD.md#交互输入字符-typedchars), [Constitution](../constitution/2026-07-21-activity-map-product-and-data.md#metrics-and-extensibility), [Architecture](../../ARCHITECTURE.md#dependency-direction) |
| Decisions | [Input metric decision](../constitution/2026-07-21-activity-map-product-and-data.md#metrics-and-extensibility), [Privacy boundary](../constitution/2026-07-21-activity-map-product-and-data.md#privacy-and-network-boundary) |

## Phases

- [x] Phase 0: persist trusted typed-input evidence and rebuild aggregates
- [x] Phase 1: query and display the `typedChars` metric
- [x] Phase 2: explore DOM IME final-commit variants (superseded by real-input evidence)
- [x] Phase 3: use applied CodeMirror transactions as the IME authority

## Background

### Problem

The shipped metrics distinguish active time, editing bursts, and file entry count, but none represents the amount of human text committed. `editingMs` must remain because it measures an activity subset and deliberately includes programmatic editor mutations.

### Goals and Non-goals

Count trusted editor text commits by non-whitespace Unicode grapheme cluster, persist only a numeric count plus source class, rebuild it from existing daily shards, and expose it as a fourth distribution metric. Do not retain strings, selection, clipboard data, deletions, document diffs, or input from an inactive/non-editor surface. Historical numeric-only evidence is not backfilled when the capture rule changes.

### Key Insight

`beforeinput` expresses browser intent before a document mutation, but Obsidian's CodeMirror host can flush a final IME mutation after `compositionend`. The applied CodeMirror `input.type` transaction is therefore the counting authority. The bridge must keep IME changes provisional until finalization, then discard all text after converting the one committed insertion to a grapheme count.

## Design

> Inherited design: [metric and privacy invariants](../constitution/2026-07-21-activity-map-product-and-data.md#metrics-and-extensibility).
>
> Local delta: add a numeric `typed-input` envelope to the existing append-only daily shards, then use its `typedChars` total in the existing immutable distribution pipeline.

### Control Flow

```text
CodeMirror input.type transaction / IME finalization
  -> bridge resolves the actual editor leaf and converts inserted text to a numeric non-whitespace grapheme count
  -> coordinator verifies active target, owning window, and leaf
  -> content-free TypedInputRecord
  -> serialized DataServices append to the target local-date shard
  -> existing shard-change rebuild invalidates query cache
  -> query reads typedChars from DailySummary and Popover renders the selected metric
```

### Data Flow

`TypedInputRecord` contains `fileId`, `pathAtEvent`, timestamp/local date, `typedChars`, and `source` (`insert-text` or `ime-commit`). `typedChars` excludes standalone Unicode whitespace graphemes. The record's string payload is discarded before the coordinator emits it. A `DailyFileMetrics` value gains a non-negative integer `typedChars`; old summaries missing this field normalize to zero for backward compatibility.

## Phase 0: persist trusted typed-input evidence and rebuild aggregates

### Tasks

- [x] Add a narrow trusted input observation port, grapheme counter, and IME final-commit de-duplication in the tracking boundary.
- [x] Extend validated envelopes, DataServices, daily-summary rebuild/validation, and related deletion/export paths for numeric `typed-input` events.
- [x] Add deterministic tests for Latin, CJK IME, combining marks, emoji, synthetic events, non-editor input, paste/drop/history/programmatic exclusion, wrong-window/leaf rejection, append failure, and rebuild.

### Files

- `src/tracking/typed-input.ts`
- `src/tracking/ports.ts`
- `src/tracking/tracking-coordinator.ts`
- `src/data/{schema,event-envelope,data-services,daily-summary-repository}.ts`
- `tests/tracking/*typed*`, `tests/data/*typed*`

### Acceptance Criteria

- [x] Every accepted source creates one content-free count record for the current target's local date; composition updates and a following duplicate `insertText` do not double-count.
- [x] Any rejected source leaves shards and summaries unchanged; a persistence failure reaches the existing degraded safety boundary.
- [x] A shard rebuild derives exact typed counts while old records and old summaries remain readable with zero counts.

Evidence: `npm run check`, `npm run lint`, and `npm test -- --run` passed on 2026-07-23 (253 tests). Focused coverage validates grapheme segmentation, IME final-commit de-duplication, source exclusion, content-free envelopes, old-summary normalization, shard rebuild, and persistence-failure degradation.

## Phase 1: query and display the `typedChars` metric

### Tasks

- [x] Extend the read-only query metric union, merging, chart formatting, range control, controller behavior, fixtures, and tests.
- [x] Update product/architecture documentation with the implemented boundary and recorded evidence.

### Files

- `src/query/{path-projection,distribution-query}.ts`
- `src/ui/{format,components/range-controls}.ts`
- `tests/query/*`, `tests/ui/*`, `docs/PRD.md`, `ARCHITECTURE.md`

### Acceptance Criteria

- [x] Changing only the metric preserves the current range, path, grouping, totals semantics, and file activation identities.
- [x] The UI labels the metric as `Chars`; it never shows text content.
- [x] Focused automated and repository gates pass with exact command output recorded below.

Evidence: `npm run check`, `npm run lint`, and `npm test -- --run` passed on 2026-07-23 (254 tests); `npm run build`, strict specs validation, and `git diff --check` also passed. Focused coverage proves the fourth metric's independent projection, `Chars` selector and keyboard icon, and controller preservation of range, path, grouping, and detail identity.

## Phase 2: explore DOM IME final-commit variants (superseded by real-input evidence)

### Tasks

- [x] Treat a trusted post-`compositionend` `beforeinput` as the one IME final commit when it is `insertText` or `insertCompositionText`, including hosts that still set `isComposing: true`; keep every pre-end composition update excluded.
- [x] Add classifier and coordinator-to-sink event-sequence tests for Pinyin updates, candidate confirmation, multi-character submission, and cancellation; prove each accepted commit persists once and cancellation persists nothing.
- [x] Restrict the production DOM boundary to CodeMirror's editable content and prove text controls inside a Markdown leaf are rejected before coordinator attribution.
- [x] Route composition lifecycle events from the same CodeMirror editor wrapper and clear a stale composition state when a fresh non-composing text insert proves ordinary typing resumed.

### Files

- `src/tracking/typed-input.ts`
- `src/main.ts`
- `tests/tracking/typed-input.test.ts`
- `tests/tracking/tracking-coordinator.test.ts`
- `ARCHITECTURE.md`
- `specs/active/06-typed-character-metric-plan.md`

### Acceptance Criteria

- [x] A final `insertCompositionText` remains attributable only when it immediately follows the same eligible editor's `compositionend`; it creates one `ime-commit` with the submitted grapheme count even if `isComposing` stays true.
- [x] Pinyin intermediate updates, paste/drop/history inputs, cancelled composition, stale leaf/window input, and delayed fallback paths create no extra count.
- [x] A composition lifecycle target outside editable content cannot permanently suppress later trusted English input; Markdown-leaf text controls remain excluded.

Evidence: `npm run check`, `npm run lint`, `npm test -- --run` (278 passed), `npm run build`, and `python3 "${SPEC_DRIVEN_DELIVERY_DIR:?set SPEC_DRIVEN_DELIVERY_DIR}/scripts/validate_specs_workspace.py" . --strict` passed on 2026-07-23. The candidate-confirmation fixture traces Pinyin `insertCompositionText` updates, `compositionend`, then final `insertCompositionText` with `isComposing: true` through the coordinator into one numeric record; the cancellation fixture emits no record. DOM-boundary fixtures accept `beforeinput` only from CodeMirror editable content, permit composition lifecycle events from the same CodeMirror wrapper, reject textarea/input controls inside the same Markdown leaf, and prove an unobservable completion cannot suppress a later English insert. Owner UAT then showed confirmed Chinese still created no count, so this fixture model is historical investigation evidence rather than an accepted production boundary.

## Phase 3: use applied CodeMirror transactions as the IME authority

### Tasks

- [x] Replace global DOM `beforeinput` counting with an Obsidian `registerEditorExtension()` CodeMirror 6 `ViewPlugin` that observes applied document-changing `input.type` transactions.
- [x] Resolve the source leaf from `editorInfoField`, and pass only window ID, leaf ID, numeric grapheme count, and source class into `TrackingCoordinator`.
- [x] Keep `input.type.compose` provisional after trusted composition start. A generation-guarded two-frame finalizer prefers a trailing CodeMirror transaction, uses trusted non-empty `compositionend.data` only as a numeric fallback, and lets an untrusted host-delivered end settle prior numeric transaction evidence without trusting its datum; an ending zero discards cancellation.
- [x] Cover Pinyin updates, candidate confirmation, multi-character submission, delayed post-end transaction, cancellation, later English input, paste/drop/history/completion/programmatic/deletion exclusion, stale targets, and the no-content persistence boundary.
- [x] Accept the public `MarkdownFileInfo` editor-mode variant when it belongs to the active Markdown leaf, and use a temporary content-free console trace to establish the real Obsidian event order before removing it after owner UAT.
- [x] Exclude standalone Unicode whitespace graphemes at the CodeMirror boundary, including space, tab, line break, and non-breaking space, without revising retained numeric evidence.

### Files

- `src/main.ts`
- `src/platform/codemirror-typed-input.ts`
- `src/tracking/typed-input.ts`
- `src/tracking/tracking-coordinator.ts`
- `tests/tracking/typed-input.test.ts`
- `tests/tracking/tracking-coordinator.test.ts`
- `ARCHITECTURE.md`
- `specs/constitution/2026-07-21-activity-map-product-and-data.md`
- `specs/active/06-typed-character-metric-plan.md`

### Acceptance Criteria

- [x] One applied `input.type` transaction records its inserted grapheme count once when its editor owns the active tracked target.
- [x] Pinyin updates remain uncounted until candidate confirmation; confirmed multi-character CJK input records once when CodeMirror flushes its final transaction after `compositionend`.
- [x] Cancellation, standalone Unicode whitespace, paste, drop, history, completion, programmatic changes, deletion, a background leaf/window, and a non-editor control create no typed-input record.
- [x] Real Obsidian desktop evidence separately validates Pinyin input, candidate confirmation, multi-character submission, mid-composition cancellation, later English input, and no retained typed content.

Evidence: the pre-UAT bridge passed `npm run check`, `npm run lint`, `npm test -- --run` (277 passed), `npm run build`, strict Specs validation, and `git diff --check` on 2026-07-23, but owner UAT still found Chinese candidate confirmation uncounted. The follow-up accepts `MarkdownFileInfo`'s documented active editor-mode variant. A temporary content-free console trace then established that a trusted start precedes numeric `input.type.compose` transactions, while the host reports the end observer as untrusted; it was removed after owner UAT confirmed the corrected candidate-confirmation path. On 2026-07-23, the final source without diagnostics passed `npm run check`, `npm run lint`, `npm test -- --run` (282 passed), `npm run build`, strict Specs validation (0 errors, 0 warnings), and `git diff --check`; the rebuilt bundle was byte-identical to the locally installed Obsidian plugin bundle. The whitespace rule then passed `npm run check`, `npm run lint`, `npm test -- --run` (284 passed), `npm run build`, strict Specs validation (0 errors, 0 warnings), and `git diff --check`. The owner then completed the named real-Obsidian desktop UAT and explicitly authorized completion. Focused fixtures exercise direct `input.type` filtering and inserted grapheme counting, standalone Unicode whitespace exclusion, Pinyin's repeated provisional composition updates, pre- and post-end final commits, trusted and untrusted end fallback, cancellation, rapid next composition, stale generations, subsequent English, invalid numeric commits, persistence failure, stale window/leaf rejection, and editor-mode provenance. These are controlled CodeMirror fixtures; the separately recorded owner UAT is the real desktop evidence.

## Risks and Mitigations

IME event order differs by browser and host, so the bridge tests applied CodeMirror transaction ordering rather than treating `beforeinput` as the source of truth. CodeMirror can flush a final composition mutation after `compositionend`; the finalizer therefore waits two frames and uses generation guards to prevent stale fallback emission. Browser event metadata still cannot reliably distinguish every assistive or simulated keyboard source; product help retains that accuracy limit. Summary compatibility is additive: a missing historical field becomes zero instead of invalidating retained activity evidence.

## Post-Critic Acceptance

- [x] Owner validates real Obsidian input with Latin, CJK IME Pinyin updates, candidate confirmation, multi-character submission, mid-composition cancellation, combining characters, emoji, standalone spaces/tabs/line breaks, paste, undo/redo, and a non-editor text box. Record the four IME outcomes separately without retaining typed content in plugin data or test artifacts.

Round 3 used the final independent Critic review. The owner UAT subsequently invalidated the DOM-event solution, and no Critic round remained for an independent re-review of the replacement CodeMirror boundary. The owner completed the real-Obsidian acceptance and explicitly authorized this Spec's completion; that owner acceptance, rather than an unclaimed later Critic verdict, is the completion authority recorded below.

## Evaluation Record

### Round 1

- Critic: `joint_critic` (fresh, read-only joint review of Specs 06 and 07)
- Review scope: full
- Evidence reviewed: commits `a6279e7`, `d393ac8`, `7ee4385`, and `c988d7f`; full diff from `930a7e0`; `npm run check`, `npm run lint`, `npm test -- --run` (258 passed), strict Specs validation, and `git diff --check` all passed before review.
- Findings: P1 — the typed-input boundary provided only `windowId`, so a same-window background editor or a leaf switch before target refresh could persist a count against the stale target. P2 — support text does not yet state the limits for dictation, assistive technology, and simulated keyboards.
- Selected fixes: P1 current-leaf provenance and IME fallback recheck.
- Executor fixes: the DOM boundary now attaches an ephemeral source leaf ID only when the current file view contains the editor target; the coordinator requires matching active and snapshotted `windowId` plus `leafId`, keys composition state by source leaf, and rechecks the leaf before its delayed IME fallback. New deterministic tests cover a same-window background leaf, a target-refresh race, and an IME leaf-switch race.
- Deferred findings: at this point, P2 support-text accuracy was deferred. It was resolved on 2026-07-23 by the PRD and bilingual README wording for dictation, assistive technology, and simulated keyboards.
- Validation rerun: `npm run check`; `npm run lint`; `npm test -- --run` (261 passed); `npm run build`; `python3 "$SPEC_DRIVEN_DELIVERY_DIR/scripts/validate_specs_workspace.py" . --strict` (0 errors, 0 warnings); production bundle PNG data-URL check; `git diff --check`.
- Verdict: changes-required; P1 correction batch is ready for the joint Round 2 review.

### Round 2

- Critic: `joint_critic` (same independent read-only joint reviewer)
- Review scope: full
- Evidence reviewed: current commit `4fab642`; source-level current-leaf and IME fallback controls; focused regression and disclosure tests; the preserved Round 1 production-build evidence.
- Findings: no P0/P1 blocker. P2 support-text accuracy for dictation, assistive technology, and simulated keyboards remains.
- Selected fixes: none.
- Executor fixes: none; the completed P1 correction batch was reviewed as implemented.
- Deferred findings: none; the former P2 support-text accuracy item was resolved by the 2026-07-23 PRD and bilingual README correction.
- Validation rerun: Critic independently ran `npm run check`; `npm run lint`; `npm test -- --run` (261 passed); strict Specs validation (0 errors, 0 warnings); and `git diff --check`. `npm run build` was not rerun because source was unchanged after the Round 1 production build; the current bundle's PNG data URL was statically confirmed.
- Verdict: pass-with-follow-ups.

### Round 3

- Critic: `typedchars_critic` (fresh, read-only review of Spec 06)
- Review scope: full
- Evidence reviewed: current worktree including the IME final-commit correction, its classifier/coordinator fixtures, `src/main.ts` DOM boundary, Architecture and Spec lifecycle; the Critic independently ran `npm run check`, `npm run lint`, `npm test -- --run` (275 passed before the correction batch), strict Specs validation, and `git diff --check`.
- Findings: P1 — the production selector admitted any target inside `.markdown-source-view`, allowing a textarea/input control in a tracked Markdown leaf to persist typed counts; P2 — Phase 2 recorded 274 rather than 275 tests; P3 — Architecture described classifier ownership as per window although runtime keys it by source window/leaf.
- Selected fixes: P1 production DOM boundary plus regression test; P2 exact evidence correction; P3 ownership wording correction.
- Executor fixes: extracted the production target predicate, restricted `beforeinput` to CodeMirror editable content, explicitly excluded native form controls and `contenteditable="false"`, and added a DOM fixture for accepted editor text plus rejected Markdown-leaf textarea/input. Updated the Phase 2 test count and Architecture ownership wording.
- Deferred findings: none.
- Post-Critic owner evidence: the owner reported that starting Chinese input left later English and Chinese input counts blocked. The report invalidated the assumed composition-lifecycle target boundary.
- Executor follow-up: composition lifecycle events now accept the same CodeMirror editor wrapper while `beforeinput` remains content-only; a new non-composing `insertText` also clears a stale composing state. Added classifier and coordinator-to-sink regressions for the blocked-English path.
- Validation rerun: `npm run check`; `npm run lint`; `npm test -- --run` (278 passed); `npm run build`; `python3 "${SPEC_DRIVEN_DELIVERY_DIR:?set SPEC_DRIVEN_DELIVERY_DIR}/scripts/validate_specs_workspace.py" . --strict` (0 errors, 0 warnings); `git diff --check`.
- Verdict: changes-required. The selected correction batch is implemented and technically validated, but the three-round Critic budget is exhausted before an independent re-review; no final Critic pass is claimed.

### Phase 3 correction

- Owner UAT: Chinese candidate confirmation still created no `typedChars` record, though later English input was no longer blocked.
- Root cause: CodeMirror can dispatch the committed IME mutation as `input.type.compose` after `compositionend`; the global DOM listener and its microtask fallback can finalize before CodeMirror applies the document change.
- Adopted correction: a public Obsidian CodeMirror `ViewPlugin` becomes the counting authority. DOM composition events only delimit finalization or cancellation. Prior DOM fixtures remain non-acceptance evidence.
- Runtime trace after the bridge correction: an ordinary `input.type` transaction reached target resolution and the coordinator as `accepted`. The CJK sequence had a trusted `compositionstart`, only `input.type.compose` transactions, then an untrusted `compositionend`; the last numeric composition transaction arrived before that end and no trailing input transaction followed. The prior trusted-end guard therefore discarded the only settlement boundary. No input string was logged or retained.
- Current correction: after a trusted start, the untrusted end closes only the existing composition state and can settle the last already-reduced numeric CodeMirror transaction. Its datum is ignored. A final zero transaction clears that numeric provisional state, preserving cancellation semantics.
- Owner follow-up UAT: the corrected Chinese candidate-confirmation path increments `typedChars`. The temporary console trace was removed immediately after this confirmation; its logs were never persisted.

### Documentation follow-up

- Resolution: the PRD and bilingual README now describe the event-metadata limitation for dictation, assistive technology, and simulated keyboards.
- Lifecycle: this documentation-only correction does not consume a new Critic round or change the open owner UAT criterion.

### Completion acceptance

- Owner UAT: on 2026-07-23, the owner confirmed the completed real-Obsidian journey and authorized completion. Pinyin preedit created no count; candidate confirmation and multi-character submission each committed one numeric count; a cancelled composition created none; later Latin input continued to count. The same acceptance covered combining characters, emoji, standalone spaces/tabs/line breaks, paste, undo/redo, and a non-editor text box.
- Privacy evidence: UAT used no persisted input strings, and the temporary console trace had already been removed.
- Critic limitation: the three permitted Critic rounds were exhausted before this replacement CodeMirror boundary could receive another independent review. No additional Critic pass is claimed.
- Lifecycle: the owner's explicit UAT acceptance is the recorded authority for `completed` on 2026-07-23.
