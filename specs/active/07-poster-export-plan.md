# Poster export plan

## Metadata

| Field | Value |
| --- | --- |
| Created | 2026-07-23 |
| Scope | Poster renderer, Header Popover export modal, browser download boundary, bundled wordmark |
| Type | feat |
| Priority | P1 |
| Status | review |
| Completed | pending |
| Dependencies | [Product requirements](../../docs/PRD.md#海报导出-modal), [Constitution](../constitution/2026-07-21-activity-map-product-and-data.md#interface-and-export), [typedChars](06-typed-character-metric-plan.md) |
| Decisions | [Export decision](../constitution/2026-07-21-activity-map-product-and-data.md#interface-and-export), [Privacy boundary](../constitution/2026-07-21-activity-map-product-and-data.md#privacy-and-network-boundary) |

## Phases

- [x] Phase 0: render deterministic complete posters from an immutable query snapshot
- [x] Phase 1: open the export modal and download the selected format

## Background

### Problem

The repository can serialize an unmounted SVG infographic as a service, but users cannot export current data. The approved interaction is a full data poster, not a screenshot or a generic raw-data modal.

### Goals and Non-goals

Provide a large editable poster preview with Portrait, Wide, and Compact layouts; an optional initially-empty caption at the bottom center of that preview; and one-click SVG, PNG, or JPEG downloads. Do not add a confirmation dialog, summary suggestions, raw JSON control, mounted-DOM capture, note-content capture, network activity, or a command/ribbon alternative.

### Key Insight

One escaped standalone SVG is both the preview source and the export source. The browser rasterizes that same SVG only after the user chooses PNG or JPEG, which keeps chart values, layout, colors, wordmark, and caption identical across formats.

## Design

> Inherited design: [poster export contract](../constitution/2026-07-21-activity-map-product-and-data.md#interface-and-export).
>
> Local delta: replace the service-only infographic/graph export with one poster renderer and compose it into a dedicated modal started from the Popover's top control group.

### Control Flow

```text
Popover Export action
  -> freeze the current ActivityMapViewModel query + DistributionResult
  -> modal previews a selected layout and caption in-place
  -> user chooses SVG / PNG / JPEG and presses Export
  -> renderer serializes escaped standalone SVG
  -> SVG downloads directly, raster formats render from it then download once
```

The snapshot does not follow live ticks, late queries, or later Popover navigation. Download capability errors remain visible in the modal and do not silently claim success.

### Data Flow

The renderer consumes only `DistributionQuery`, `DistributionResult`, layout, caption, generated time, and bundled wordmark data. It never reads a rendered chart, input DOM, vault files, retained raw events, or note content. PNG/JPEG downloads receive the exact SVG bytes that back the preview; rasterization changes encoding only.

## Phase 0: render deterministic complete posters from an immutable query snapshot

### Tasks

- [x] Define the three layout contracts and produce accessible, escaped SVG posters including wordmark, current-path data, donut, legend, percentages, and optional caption.
- [x] Package the supplied wordmark as a data URL and add SVG-to-raster conversion plus a download boundary that supports binary blobs.
- [x] Replace tests for the old chart-only/infographic modes with renderer, escaping, layout, format, raster failure, filename, and data-parity tests.

### Files

- `docs/assets/activity-map-wordmark.png`
- `src/export/{poster-exporter,export-destination}.ts`
- `src/assets.d.ts`, `esbuild.config.mjs`
- `tests/export/*`

### Acceptance Criteria

- [x] Each layout is a complete poster, contains the wordmark and only the supplied query data, and renders an absent caption as empty.
- [x] SVG has title/description and escaped user-derived strings; raster formats originate from its SVG representation without screenshotting the application.
- [x] Every output filename is bounded, safe, layout-aware, and format-aware.

Evidence: `npm run check`, `npm run lint`, `npm test -- --run` (255 tests), `npm run build`, strict specs validation, and `git diff --check` passed on 2026-07-23. Export tests cover all layouts, wordmark inclusion, exact values and percentages, escaping, omitted captions, bounded filenames, MIME parity, Blob download, and unavailable rasterization.

## Phase 1: open the export modal and download the selected format

### Tasks

- [x] Add the Export action immediately right of pause/resume, using the current query/distribution only when it is ready.
- [x] Build a modal whose preview dominates the content area; place caption editing directly over the preview's bottom center; add layout/format controls and one Export action.
- [x] Report download/rasterization failure in the modal, keep keyboard behavior accessible, update styles/docs/architecture, and add DOM/controller coverage.

### Files

- `src/ui/{summary-popover,poster-export-modal}.ts`
- `src/export/poster-export-session.ts`
- `src/ui/components/range-controls.ts`
- `styles.css`, `ARCHITECTURE.md`, `README.md`, `docs/PRD.md`
- `tests/ui/*`, `tests/export/*`

### Acceptance Criteria

- [x] Opening the modal freezes the actual current query result; later live updates do not alter its preview or download.
- [x] Caption editing occurs inside the visual poster preview, defaults to empty, and reaches all selected export formats.
- [x] SVG, PNG, and JPEG each start exactly one local download after the user presses Export; no confirmation modal is rendered.
- [x] Focus returns safely on close and all repository gates pass with exact evidence recorded below.

Evidence: `npm run check`, `npm run lint`, `npm test -- --run` (258 tests), `npm run build`, strict specs validation, `git diff --check`, and a production-bundle data-URL check all passed on 2026-07-23. Focused coverage proves ready-only action order, disabled unavailable state, frozen snapshot isolation, identical SVG bytes across SVG/PNG/JPG paths, caption propagation, accessible controls, focus restoration, and absence of a confirmation modal.

## Risks and Mitigations

Canvas rasterization can be unavailable in a host document, so it is capability-gated and emits a visible failure instead of falling back to a fake download. The supplied PNG wordmark is inlined in SVG to avoid a runtime asset path; later SVG replacement remains renderer input only. Screenshots are deliberately excluded to keep user-visible preview geometry and exported data stable.

## Post-Critic Acceptance

- [ ] Owner validates all three layouts and SVG/PNG/JPEG downloads in a real desktop Obsidian window, including an edited caption and a zero-data range.

## Evaluation Record

### Round 1

- Critic: `joint_critic` (fresh, read-only joint review of Specs 06 and 07)
- Review scope: full
- Evidence reviewed: commits `a6279e7`, `d393ac8`, `7ee4385`, and `c988d7f`; full diff from `930a7e0`; `npm run check`, `npm run lint`, `npm test -- --run` (258 passed), strict Specs validation, and `git diff --check` all passed before review.
- Findings: P1 — the modal did not disclose the exact filename or frozen query scope until after Export was pressed. P1 — Roadmap acceptance incorrectly marked the real desktop poster journey complete while this Spec still requires owner UAT. P2 — PRD wording still describes SVG as unavailable from the header interface, and Spec 03 still names the superseded SVG exporter.
- Selected fixes: both P1 export-disclosure and Roadmap-evidence corrections.
- Executor fixes: the modal now renders the frozen metric/range/path plus the exact safe filename before download and updates the filename when layout or format changes; its DOM test asserts the disclosure and update. The Roadmap now separates automated export coverage from the open real-desktop caption and SVG/PNG/JPG journey.
- Deferred findings: P2 documentation accuracy is routed to [`v0.2 documentation accuracy follow-up`](../ROADMAP.md#follow-up-todo).
- Validation rerun: `npm run check`; `npm run lint`; `npm test -- --run` (261 passed); `npm run build`; `python3 "$SPEC_DRIVEN_DELIVERY_DIR/scripts/validate_specs_workspace.py" . --strict` (0 errors, 0 warnings); production bundle PNG data-URL check; `git diff --check`.
- Verdict: changes-required; P1 correction batch is ready for the joint Round 2 review.

### Round 2

- Critic: `joint_critic` (same independent read-only joint reviewer)
- Review scope: full
- Evidence reviewed: current commit `4fab642`; current modal disclosure, filename, and frozen-snapshot control flow; focused DOM/regression tests; the preserved Round 1 production-build evidence.
- Findings: no P0/P1 blocker. P2 PRD SVG policy and superseded Spec 03 exporter references remain.
- Selected fixes: none.
- Executor fixes: none; the completed P1 correction batch was reviewed as implemented.
- Deferred findings: P2 documentation accuracy remains routed to [`v0.2 documentation accuracy follow-up`](../ROADMAP.md#follow-up-todo).
- Validation rerun: Critic independently ran `npm run check`; `npm run lint`; `npm test -- --run` (261 passed); strict Specs validation (0 errors, 0 warnings); and `git diff --check`. `npm run build` was not rerun because source was unchanged after the Round 1 production build; the current bundle's PNG data URL was statically confirmed.
- Verdict: pass-with-follow-ups.
