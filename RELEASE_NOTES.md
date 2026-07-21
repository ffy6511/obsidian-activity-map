# Activity Map v0.1.0 Release Notes

## Release Status

`v0.1.0` is a local development candidate. The interactive header chart is undergoing a final owner-directed layout correction: duplicate and transient rows are being removed, the legend becomes a bounded scroll list, and the persistent miniature must show the actual vault-root distribution instead of a single blue file-share arc. Final implementation evidence and real Obsidian desktop/mobile acceptance remain required before publication.

## Included Capabilities

- Foreground-only file attribution with trusted activity signals, idle clipping, pause/resume, sleep-gap exclusion, recovery decisions, and restart checkpoints.
- Stable local file identity, per-device/date event shards, verified daily summaries, retention safety, rebuild, raw JSON export, and scoped deletion plans.
- Selected-day, 7/30/90-day and all-history averages, all-history totals, folder drill-down, local-file detail, “other”, and deleted-file history.
- Header mini donut and pinnable interactive chart popover are implemented but remain outside the accepted capability set until the Phase 6 multi-slice and fixed-layout correction passes.
- Standalone infographic and chart-only SVG export with escaped metadata and inline colors.

## Privacy and Platform

Activity Map stores its data under the configured vault plugin directory. It has no account, telemetry, remote API, or upload path and never reads note content, selected text, or typed strings. The manifest remains cross-platform; mobile viewing still requires real-device acceptance, and export is capability-detected.

## Verification Boundary

Automated controlled-clock, persistence, query, SVG, accessibility-source, privacy-source, and integrated fake-adapter tests are included. Generated `main.js`, `manifest.json`, and `styles.css` form the local install set. No release has been published.
