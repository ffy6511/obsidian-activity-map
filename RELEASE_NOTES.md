# Activity Map v0.1.0 Release Notes

## Release Status

`v0.1.0` is a local development candidate. Specs 01–03 have automated implementation evidence; joint Critic review and real Obsidian desktop/mobile acceptance remain required before publication.

## Included Capabilities

- Foreground-only file attribution with trusted activity signals, idle clipping, pause/resume, sleep-gap exclusion, recovery decisions, and restart checkpoints.
- Stable local file identity, per-device/date event shards, verified daily summaries, retention safety, rebuild, raw JSON export, and scoped deletion plans.
- Selected-day, 7/30/90-day and all-history averages, all-history totals, folder drill-down, local-file detail, “other”, and deleted-file history.
- File-header status and recovery popover, Ribbon/command fallbacks, dockable statistics view, native SVG donut, and complete detail rows.
- Standalone infographic and chart-only SVG export with escaped metadata and inline colors.

## Privacy and Platform

Activity Map stores its data under the configured vault plugin directory. It has no account, telemetry, remote API, or upload path and never reads note content, selected text, or typed strings. The manifest remains cross-platform; mobile viewing still requires real-device acceptance, and export is capability-detected.

## Verification Boundary

Automated controlled-clock, persistence, query, SVG, accessibility-source, privacy-source, and integrated fake-adapter tests are included. Generated `main.js`, `manifest.json`, and `styles.css` form the local install set. No release has been published.
