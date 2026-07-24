# Activity Map Roadmap

## Maintenance Rules

- The Version Index checkbox is the only version-level status.
- Complete a version only after every required deliverable and acceptance criterion in that version is checked.
- Add implementation Specs as work becomes implementation-ready; do not use Roadmap items as file-level task lists.
- Preserve the distinction between repository foundation, implemented capability, automated verification, and real Obsidian verification.

## Version Index

- [ ] `v0.1` — Trustworthy local activity map
- [ ] `v0.2` — Human-input metrics, poster export, and multi-device hardening

## v0.1 — Trustworthy local activity map

### Goal

Deliver a local-first Obsidian plugin that measures trustworthy file activity and lets users inspect it by date and folder hierarchy.

### Design

- [Product requirements](../docs/PRD.md)
- [Product and data decisions](constitution/2026-07-21-activity-map-product-and-data.md#final-decision)
- [Architecture](../ARCHITECTURE.md)
- [Spec 01 — Activity tracking runtime](active/01-activity-tracking-runtime-plan.md)
- [Spec 02 — Local data and query](active/02-local-data-and-query-plan.md)
- [Spec 03 — Activity Map UI and v0.1 release](active/03-activity-map-ui-and-v0-1-release-plan.md)
- [Spec 04 — Header Popover split layout](active/04-header-popover-split-layout-plan.md)
- [Spec 05 — Header Popover file grouping](active/05-header-popover-file-grouping-plan.md)
- [Spec 08 — Header Popover locate current file](active/08-header-popover-locate-current-file-plan.md)
- [Spec 09 — Header Popover file activation](active/09-header-popover-file-activation-plan.md)

### Key Deliverables

- [x] A buildable, linted, documented Obsidian plugin repository with a strictly validated specs workspace.
- [x] Foreground-only per-file activity sessions with trusted activity signals, idle clipping, pause, sleep handling, and explicit corrections.
- [x] Durable per-device daily session shards, recoverable aggregates, stable file identity, and retention.
- [x] Correct selected-day, rolling daily-average, all-history, path aggregation, detail, and deleted-file queries.
- [x] Stable multi-slice header mini donut as the only entry, idle-bounded real-time centered `2:3` chart/list Popover with ellipsized basename-only file leaves, and complete synchronized scrollable detail list.
- [x] Header Popover grouping toggle switches the current path scope between hierarchical path slices and recursive file slices, persists the last successful choice, and does not change totals or activation identity.
- [x] Tested local services generate standalone full-infographic and chart-only SVG artifacts; their header-modal controls are deferred.
- [ ] Full desktop behavior and a mobile interaction path that does not depend on hover.

### Acceptance Criteria

- [x] Controlled-clock tests prove foreground exclusivity, idle clipping, recovery correction, pause, sleep-delay, and cross-midnight semantics.
- [x] Persistence tests prove restart recovery, corrupt-record isolation, aggregate rebuild, safe retention, export, and scoped deletion.
- [x] Fixed-data query tests prove daily-average denominators, path drill-down, “local files”, “other”, rename, and deleted-file behavior.
- [ ] A real Obsidian desktop journey covers installation, tracking, idle recovery, pause/resume, and header-popover drill-down.
- [ ] A real Obsidian mobile journey covers loading statistics, changing ranges, drill-down, and details without hover.
- [x] Keyboard, focus, pin/unpin, stable-highlight layout, accessible-name, non-color encoding, theme, and reduced-motion checks pass across the header donut and popover.
- [ ] Type checking, lint, automated tests, production build, specs validation, and independent Critic evaluation pass.
- [x] README, PRD, Constitution, settings help, release notes, and installation instructions describe the verified behavior accurately.

The three-round joint Critic budget ended with three P1 findings. An owner-directed MVP fix batch subsequently closed their implementation scope, but no fourth Critic round was started; independent acceptance and real Obsidian journeys remain open.

### Follow-up TODO

- [ ] `v0.2`: implement separate deletion metrics.
- [ ] `v0.2`: add explicit multi-device conflict diagnostics, deduplication, and merge controls.
- [ ] `v0.2`: evaluate historical aggregation by `pathAtEvent` and richer trend comparisons.
- [ ] `v0.2`: surface raw export, aggregate rebuild, and scoped deletion in a dedicated data modal.

## v0.2 — Human-input metrics, poster export, and multi-device hardening

### Goal

Extend trusted activity reporting with privacy-preserving input metrics, local poster export, and explicit multi-device reconciliation.

### Design

- [Reserved metric semantics](../docs/PRD.md#交互输入字符-typedchars)
- [Cross-version product and data boundaries](constitution/2026-07-21-activity-map-product-and-data.md#final-decision)
- [Spec 06 — typedChars](active/06-typed-character-metric-plan.md)
- [Spec 07 — poster export](active/07-poster-export-plan.md)

### Key Deliverables

- [x] Trusted text-input and IME final-commit capture with grapheme-cluster counts and explicit source exclusions.
- [x] Current-query Wide PNG poster export with an editable empty caption, automatic local download, and no screen capture.
- [ ] Separate deletion metrics that do not reduce the input count.
- [ ] Multi-device overlap diagnostics, deterministic deduplication policy, and user-controlled conflict resolution.
- [ ] Optional event-time path analysis and richer range comparison views.

### Acceptance Criteria

- [x] Input tests cover Latin text, CJK IME, combining marks, emoji, paste, drop, undo/redo, programmatic edits, and external writes.
- [x] Export tests prove frozen-query data parity, wordmark inclusion, escaping, bounded three-line captions, default Wide PNG rasterization, and unavailable-download handling.
- [x] Owner acceptance covers the themed Wide PNG preview, caption editing and wrapping, download, and a zero-data range.
- [ ] Multi-device fixtures cover independent shards, simultaneous activity, duplicates, conflicts, and interrupted reconciliation.
- [x] Metrics remain local, do not store typed content, and expose their accuracy limitations in product help.
- [ ] Migration, compatibility, and independent Critic evaluation pass for the remaining multi-device work.
