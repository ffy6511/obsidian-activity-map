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
- [x] Phase 2: refine the themed Wide PNG composition and bounded caption

## Background

### Problem

The repository can serialize an unmounted SVG infographic as a service, but users cannot export current data. The approved interaction is a full data poster, not a screenshot or a generic raw-data modal.

### Goals and Non-goals

Provide a large editable `Wide` PNG poster preview with an initially-empty bottom-center caption. The renderer retains its tested SVG/JPEG and layout capabilities below the modal boundary, but the current user-facing flow deliberately exposes neither their selectors nor filename controls. Do not add a confirmation dialog, summary suggestions, raw JSON control, mounted-DOM capture, note-content capture, network activity, or a command/ribbon alternative.

### Key Insight

One escaped standalone SVG is both the preview source and the export source. The visible modal rasterizes that same SVG as its default PNG, while the tested internal serializer variants use the same source model. This keeps chart values, layout, colors, wordmark, and caption identical across encodings.

## Design

> Inherited design: [poster export contract](../constitution/2026-07-21-activity-map-product-and-data.md#interface-and-export).
>
> Local delta: replace the service-only infographic/graph export with one poster renderer and compose it into a dedicated modal started from the Popover's top control group.

### Control Flow

```text
Popover Export action
  -> freeze the current ActivityMapViewModel query + DistributionResult
  -> modal previews a themed Wide poster and caption in-place
  -> user presses Download
  -> renderer serializes escaped standalone SVG
  -> rasterizer renders the same SVG as a Retina PNG and downloads it once
```

The snapshot does not follow live ticks, late queries, or later Popover navigation. Download capability errors remain visible in the modal and do not silently claim success.

### Data Flow

The renderer consumes only `DistributionQuery`, `DistributionResult`, layout, caption, and bundled wordmark data. It never reads a rendered chart, input DOM, vault files, retained raw events, or note content. The visible PNG receives the exact theme-resolved SVG bytes that back the preview; rasterization changes encoding only.

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
- [x] Build a modal whose preview dominates the content area; place caption editing directly over the preview's bottom center; add one local download action.
- [x] Report download/rasterization failure in the modal, keep keyboard behavior accessible, update styles/docs/architecture, and add DOM/controller coverage.

### Files

- `src/ui/{summary-popover,poster-export-modal}.ts`
- `src/export/poster-export-session.ts`
- `src/ui/components/range-controls.ts`
- `styles.css`, `ARCHITECTURE.md`, `README.md`, `docs/PRD.md`
- `tests/ui/*`, `tests/export/*`

### Acceptance Criteria

- [x] Opening the modal freezes the actual current query result; later live updates do not alter its preview or download.
- [x] Caption editing occurs inside the visual poster preview, defaults to empty, and reaches the visible Wide PNG through the same source SVG.
- [x] The visible Wide PNG starts exactly one local download after the user presses Download; no confirmation modal is rendered.
- [x] Focus returns safely on close and all repository gates pass with exact evidence recorded below.

Evidence: `npm run check`, `npm run lint`, `npm test -- --run` (258 tests), `npm run build`, strict specs validation, `git diff --check`, and a production-bundle data-URL check all passed on 2026-07-23. Focused coverage proves ready-only action order, disabled unavailable state, frozen snapshot isolation, source-SVG parity, caption propagation, accessible controls, focus restoration, and absence of a confirmation modal.

## Phase 2: refine the themed Wide PNG composition and bounded caption

### Tasks

- [x] Recompose the Wide poster around the current Popover semantics: theme-resolved colors, left donut/path, top-aligned seven-row legend, wordmark/context header, and lower-right local-first footer.
- [x] Reduce the visible modal to Wide PNG with `Download`/`Cancel`, while retaining renderer variants and safe filename generation below the UI boundary.
- [x] Replace the one-line caption input with an in-preview system-serif textarea that expands through three visible lines, exposes a focus-only visual-line counter, serializes the same bounded text as escaped SVG tspans, and ellipsizes third-line overflow.
- [x] Add regression coverage for footer position, caption wrapping/truncation, visual-line feedback, accessible textarea semantics, production-bundle identity, and the updated document contract.

### Files

- `src/export/{poster-exporter,poster-export-session,poster-theme}.ts`
- `src/ui/{poster-export-modal,poster-caption-editor}.ts`
- `styles.css`, `esbuild.config.mjs`
- `tests/export/poster-exporter.test.ts`, `tests/ui/{poster-caption-editor,accessibility,summary-popover}.test.ts`
- `ARCHITECTURE.md`, `README.md`, `docs/PRD.md`, `specs/{ROADMAP.md,constitution/2026-07-21-activity-map-product-and-data.md}`, `specs/active/{03-activity-map-ui-and-v0-1-release-plan,06-typed-character-metric-plan,07-poster-export-plan}.md`

### Acceptance Criteria

- [x] Preview and downloaded poster share one theme-resolved SVG model; the Wide legend remains top-aligned with the donut, shows at most seven rows, and retains Popover column semantics without underlines.
- [x] The visible UI starts one Wide PNG download without exposing a path, filename, layout, or format selector; unavailable rasterization still reports an explicit modal error.
- [x] Caption text is volatile modal/export state, never persists with activity data, is escaped in the standalone SVG, wraps to at most three lines, and occupies a dedicated lower band clear of the chart, legend, and lower-right footer. Its focused editor reports `(0/3)` for empty content and uses an error-color warning beyond three visual lines.

Evidence: `npm run check`, `npm run lint`, `npm test -- --run` (270 passed), `npm run build`, strict specs validation, and `git diff --check` passed on 2026-07-23. The local vault installation was not overwritten by automated validation; owner acceptance is recorded below.

## Risks and Mitigations

Canvas rasterization can be unavailable in a host document, so it is capability-gated and emits a visible failure instead of falling back to a fake download. The supplied PNG wordmark is inlined in SVG to avoid a runtime asset path; later SVG replacement remains renderer input only. Screenshots are deliberately excluded to keep user-visible preview geometry and exported data stable.

## Post-Critic Acceptance

- [x] Owner accepted the themed Wide PNG preview and download in a real desktop Obsidian window, including caption editing/wrapping and a zero-data range.

## Evaluation Record

### Round 1

- Critic: `joint_critic` (fresh, read-only joint review of Specs 06 and 07)
- Review scope: full
- Evidence reviewed: commits `a6279e7`, `d393ac8`, `7ee4385`, and `c988d7f`; full diff from `930a7e0`; `npm run check`, `npm run lint`, `npm test -- --run` (258 passed), strict Specs validation, and `git diff --check` all passed before review.
- Findings: P1 — the modal did not disclose the exact filename or frozen query scope until after Export was pressed. P1 — Roadmap acceptance incorrectly marked the real desktop poster journey complete while this Spec still requires owner UAT. P2 — PRD wording still describes SVG as unavailable from the header interface, and Spec 03 still names the superseded SVG exporter.
- Selected fixes: both P1 export-disclosure and Roadmap-evidence corrections.
- Executor fixes: at that stage, the modal rendered the frozen metric/range/path plus the exact safe filename before download and updated it when layout or format changed. Phase 2 later replaced those visible controls with the one-action Wide PNG flow while retaining safe serialization below the UI boundary. The Roadmap separated automated export coverage from the open desktop poster journey.
- Deferred findings: at this point, P2 documentation accuracy was deferred. It was resolved on 2026-07-23 by the PRD, README, and Spec 03 corrections.
- Validation rerun: `npm run check`; `npm run lint`; `npm test -- --run` (261 passed); `npm run build`; `python3 "$SPEC_DRIVEN_DELIVERY_DIR/scripts/validate_specs_workspace.py" . --strict` (0 errors, 0 warnings); production bundle PNG data-URL check; `git diff --check`.
- Verdict: changes-required; P1 correction batch is ready for the joint Round 2 review.

### Round 2

- Critic: `joint_critic` (same independent read-only joint reviewer)
- Review scope: full
- Evidence reviewed: current commit `4fab642`; the then-current modal disclosure, filename, and frozen-snapshot control flow; focused DOM/regression tests; and the preserved Round 1 production-build evidence. Phase 2 later superseded the visible disclosure UI without changing snapshot isolation or safe serializer behavior.
- Findings: no P0/P1 blocker. P2 PRD SVG policy and superseded Spec 03 exporter references remain.
- Selected fixes: none.
- Executor fixes: none; the completed P1 correction batch was reviewed as implemented.
- Deferred findings: none; the former P2 documentation-accuracy item was resolved by the 2026-07-23 PRD, README, and Spec 03 corrections.
- Validation rerun: Critic independently ran `npm run check`; `npm run lint`; `npm test -- --run` (261 passed); strict Specs validation (0 errors, 0 warnings); and `git diff --check`. `npm run build` was not rerun because source was unchanged after the Round 1 production build; the current bundle's PNG data URL was statically confirmed.
- Verdict: pass-with-follow-ups.

### Round 3

- Critic: `/root/spec07_critic_round3` (fresh, read-only independent reviewer)
- Review scope: full
- Evidence reviewed: commit `ac308b1`; current renderer, export session/modal, caption-editor CSS, regression tests, synchronized Constitution/PRD/README/Architecture/Roadmap/Spec records; and Executor evidence for check, lint, 269 tests, production build, strict Specs validation, and `git diff --check`.
- Findings: P1 — the three-line DOM caption editor used wider/larger viewport-based metrics than the SVG caption, so it could overlap the path and did not reproduce export wrapping. P1 — UTF-16 truncation could split a non-BMP character and make `encodeURIComponent` throw while refreshing the preview. P3 — source comments described serializer layouts/formats as modal-selectable.
- Selected fixes: both P1 findings and the P3 source-comment correction.
- Executor fixes: the Wide SVG and preview now share exported caption-scale metrics for source width, text width, font size, line height, and lower-band anchor; the preview frame uses container units so all three visible lines stay inside that band. SVG-bound text is normalized to Unicode scalar values before escaping/truncation, and caption bounds now count Unicode scalars. Tests cover path/label/caption emoji boundaries, URI encoding, the shared Wide caption ratio, and the preview-frame contract. Serializer comments now name the variants as internal capabilities.
- Deferred findings: none.
- Validation rerun: `npm run check`; `npm run lint`; `npm test -- --run` (270 passed); `npm run build`; `python3 "$SPEC_DRIVEN_DELIVERY_DIR/scripts/validate_specs_workspace.py" . --strict`; and `git diff --check` are recorded as passing after this batch.
- Verdict: changes-required. This was the third and final Critic round. The post-review fix batch passes technical gates, but no fourth independent review is allowed; keep this Spec in `review` until the owner UAT and any later owner-directed acceptance decision.

### Owner acceptance

- Evidence: on 2026-07-23, the owner completed the real Obsidian visual review and explicitly closed poster-export work after the final caption, modal, and icon refinements.
- Decision: this satisfies the post-Critic desktop acceptance criterion and closes owner-requested feature work. The Spec remains in `review`: the third and final Critic verdict is preserved as `changes-required`, and no prohibited fourth Critic round was started.
- Final validation: `npm run check`; `npm run lint`; `npm test -- --run` (270 passed); `npm run build`; strict Specs validation; and `git diff --check` passed on 2026-07-23.
