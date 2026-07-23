# typedChars metric plan

## Metadata

| Field | Value |
| --- | --- |
| Created | 2026-07-23 |
| Scope | Trusted input boundary, raw event schema, daily aggregate, distribution query, metric control |
| Type | feat |
| Priority | P1 |
| Status | in-progress |
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

Pending the joint review after Spec 07; no Critic is started for this Spec alone.
