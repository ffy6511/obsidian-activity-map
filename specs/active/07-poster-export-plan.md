# Poster export plan

## Metadata

| Field | Value |
| --- | --- |
| Created | 2026-07-23 |
| Scope | Poster renderer, Header Popover export modal, browser download boundary, bundled wordmark |
| Type | feat |
| Priority | P1 |
| Status | in-progress |
| Completed | pending |
| Dependencies | [Product requirements](../../docs/PRD.md#海报导出-modal), [Constitution](../constitution/2026-07-21-activity-map-product-and-data.md#interface-and-export), [typedChars](06-typed-character-metric-plan.md) |
| Decisions | [Export decision](../constitution/2026-07-21-activity-map-product-and-data.md#interface-and-export), [Privacy boundary](../constitution/2026-07-21-activity-map-product-and-data.md#privacy-and-network-boundary) |

## Phases

- [ ] Phase 0: render deterministic complete posters from an immutable query snapshot
- [ ] Phase 1: open the export modal and download the selected format

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

- [ ] Define the three layout contracts and produce accessible, escaped SVG posters including wordmark, current-path data, donut, legend, percentages, and optional caption.
- [ ] Package the supplied wordmark as a data URL and add SVG-to-raster conversion plus a download boundary that supports binary blobs.
- [ ] Replace tests for the old chart-only/infographic modes with renderer, escaping, layout, format, raster failure, filename, and data-parity tests.

### Files

- `docs/assets/activity-map-wordmark.png`
- `src/export/{poster-exporter,export-destination}.ts`
- `src/assets.d.ts`, `esbuild.config.mjs`
- `tests/export/*`

### Acceptance Criteria

- [ ] Each layout is a complete poster, contains the wordmark and only the supplied query data, and renders an absent caption as empty.
- [ ] SVG has title/description and escaped user-derived strings; raster formats originate from its SVG representation without screenshotting the application.
- [ ] Every output filename is bounded, safe, layout-aware, and format-aware.

## Phase 1: open the export modal and download the selected format

### Tasks

- [ ] Add the Export action immediately right of pause/resume, using the current query/distribution only when it is ready.
- [ ] Build a modal whose preview dominates the content area; place caption editing directly over the preview's bottom center; add layout/format controls and one Export action.
- [ ] Report download/rasterization failure in the modal, keep keyboard behavior accessible, update styles/docs/architecture, and add DOM/controller coverage.

### Files

- `src/ui/{summary-popover,poster-export-modal}.ts`
- `src/ui/components/range-controls.ts`
- `styles.css`, `ARCHITECTURE.md`, `README.md`, `docs/PRD.md`
- `tests/ui/*`, `tests/export/*`

### Acceptance Criteria

- [ ] Opening the modal freezes the actual current query result; later live updates do not alter its preview or download.
- [ ] Caption editing occurs inside the visual poster preview, defaults to empty, and reaches all selected export formats.
- [ ] SVG, PNG, and JPEG each start exactly one local download after the user presses Export; no confirmation modal is rendered.
- [ ] Focus returns safely on close and all repository gates pass with exact evidence recorded below.

## Risks and Mitigations

Canvas rasterization can be unavailable in a host document, so it is capability-gated and emits a visible failure instead of falling back to a fake download. The supplied PNG wordmark is inlined in SVG to avoid a runtime asset path; later SVG replacement remains renderer input only. Screenshots are deliberately excluded to keep user-visible preview geometry and exported data stable.

## Post-Critic Acceptance

- [ ] Owner validates all three layouts and SVG/PNG/JPEG downloads in a real desktop Obsidian window, including an edited caption and a zero-data range.

## Evaluation Record

Pending the joint review with Spec 06 after both implementation phases complete.
