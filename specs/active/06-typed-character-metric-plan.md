# typedChars metric plan

## Metadata

| Field | Value |
| --- | --- |
| Created | 2026-07-23 |
| Scope | Trusted input boundary, raw event schema, daily aggregate, distribution query, metric control |
| Type | feat |
| Priority | P1 |
| Status | review |
| Completed | pending |
| Dependencies | [Product requirements](../../docs/PRD.md#交互输入字符-typedchars), [Constitution](../constitution/2026-07-21-activity-map-product-and-data.md#metrics-and-extensibility), [Architecture](../../ARCHITECTURE.md#dependency-direction) |
| Decisions | [Input metric decision](../constitution/2026-07-21-activity-map-product-and-data.md#metrics-and-extensibility), [Privacy boundary](../constitution/2026-07-21-activity-map-product-and-data.md#privacy-and-network-boundary) |

## Phases

- [x] Phase 0: persist trusted typed-input evidence and rebuild aggregates
- [x] Phase 1: query and display the `typedChars` metric

## Background

### Problem

The shipped metrics distinguish active time, editing bursts, and file entry count, but none represents the amount of human text committed. `editingMs` must remain because it measures an activity subset and deliberately includes programmatic editor mutations.

### Goals and Non-goals

Count trusted editor text commits by Unicode grapheme cluster, persist only a numeric count plus source class, rebuild it from existing daily shards, and expose it as a fourth distribution metric. Do not retain strings, selection, clipboard data, deletions, document diffs, or input from an inactive/non-editor surface.

### Key Insight

`beforeinput` expresses the browser's semantic input type before the document mutation. It can exclude paste, drop, history and replacement classes without inspecting note content; IME must be counted only at its final trusted composition commit so intermediate composition updates do not inflate the count.

## Design

> Inherited design: [metric and privacy invariants](../constitution/2026-07-21-activity-map-product-and-data.md#metrics-and-extensibility).
>
> Local delta: add a numeric `typed-input` envelope to the existing append-only daily shards, then use its `typedChars` total in the existing immutable distribution pipeline.

### Control Flow

```text
trusted editor beforeinput / IME final commit
  -> coordinator verifies active target, owning window, editor surface and input kind
  -> grapheme counter emits a content-free TypedInputRecord
  -> serialized DataServices append to the target local-date shard
  -> existing shard-change rebuild invalidates query cache
  -> query reads typedChars from DailySummary and Popover renders the selected metric
```

### Data Flow

`TypedInputRecord` contains `fileId`, `pathAtEvent`, timestamp/local date, `typedChars`, and `source` (`insert-text` or `ime-commit`). The record's string payload is discarded before the coordinator emits it. A `DailyFileMetrics` value gains a non-negative integer `typedChars`; old summaries missing this field normalize to zero for backward compatibility.

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
- [x] The UI labels the metric as `Typed chars`; it never shows text content.
- [x] Focused automated and repository gates pass with exact command output recorded below.

Evidence: `npm run check`, `npm run lint`, and `npm test -- --run` passed on 2026-07-23 (254 tests); `npm run build`, strict specs validation, and `git diff --check` also passed. Focused coverage proves the fourth metric's independent projection, `Typed chars` selector and keyboard icon, and controller preservation of range, path, grouping, and detail identity.

## Risks and Mitigations

IME event order differs by browser, so the classifier explicitly tests both composition-end-plus-insertText and composition-end-only flows. Browser event metadata cannot reliably distinguish every assistive or simulated keyboard source; product help retains that accuracy limit. Summary compatibility is additive: a missing historical field becomes zero instead of invalidating retained activity evidence.

## Post-Critic Acceptance

- [ ] Owner validates real Obsidian input with Latin, CJK IME, combining characters, emoji, paste, undo/redo, and a non-editor text box.

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

### Documentation follow-up

- Resolution: the PRD and bilingual README now describe the event-metadata limitation for dictation, assistive technology, and simulated keyboards.
- Lifecycle: this documentation-only correction does not consume a new Critic round or change the open owner UAT criterion.
