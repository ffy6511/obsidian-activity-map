# Activity Map Product and Data Decisions

## Metadata

| Field | Value |
| --- | --- |
| Decision date | 2026-07-21 |
| Related specs | [Tracking runtime](../active/01-activity-tracking-runtime-plan.md), [Local data and query](../active/02-local-data-and-query-plan.md), [UI and v0.1 release](../active/03-activity-map-ui-and-v0-1-release-plan.md), [Header Popover split layout](../active/04-header-popover-split-layout-plan.md), [Header Popover file grouping](../active/05-header-popover-file-grouping-plan.md), [typedChars](../active/06-typed-character-metric-plan.md), [poster export](../active/07-poster-export-plan.md) |
| Product requirements | [Activity Map PRD](../../docs/PRD.md) |

## Decision Summary

Activity Map will be a local-first, cross-platform Obsidian plugin that records trustworthy foreground activity per file, preserves durable file identity and event-time paths, stores settings separately from sharded time-series data, and presents directory aggregates through a progressively disclosed UI. It also records a privacy-preserving `typedChars` count from eligible human text input and exports the current distribution as an editable, local poster. Desktop receives the complete experience; mobile remains a supported viewer and uses only capabilities verified on that platform.

## Background

The product must distinguish meaningful Obsidian activity from a file merely remaining visible. It also needs long-lived daily and historical queries without repeatedly rewriting an ever-growing settings file. Directory visualization must remain understandable when a vault contains hundreds or thousands of files, while later metrics such as human input counts need to reuse the same identity and aggregation model.

These requirements affect every release. They belong in a stable decision record rather than an implementation plan.

## User Narrative

A user works across several Obsidian windows and project folders. Activity Map attributes time only to the trackable file in the focused window. When the user walks away, the plugin closes the session at the last trusted interaction. On return, a short uncertain interval can be explicitly included; a long sleep interval stays excluded. The user opens the file-header donut, navigates from the vault root into a project, changes from today to a 30-day average, inspects the exact file rows, and pauses or resumes tracking from the popover. While composing text in an eligible foreground editor, only the number of committed grapheme clusters is recorded. From the top control group, the user opens a Wide poster preview, optionally types a bounded caption directly into the preview, and starts one local PNG download. The modal exposes no layout, format, filename, or destination control. All records and generated files remain local.

## Final Decision

### Product Identity and Scope

- Repository: `obsidian-activity-map`.
- Plugin name: `Activity Map`.
- Plugin ID: `activity-map`.
- License: MIT.
- The product tracks Obsidian vault activity only and does not provide system-wide or browser tracking.
- The core remains cross-platform. Desktop is the complete first-release target; mobile must at least load and interact with statistics.

### Attribution and Session Semantics

- Attribute `activeMs` only when a foreground Obsidian window has a trackable active file and tracking is not paused.
- At most one file can receive activity at a time across all Obsidian windows.
- Use trusted keyboard, composition, pointer, wheel, touch, editor, leaf, and focus signals to refresh activity.
- The default idle threshold is 180 seconds. Once idle is confirmed, close the session at the last trusted activity time.
- Intervals up to 30 minutes enter an explicit recovery decision with exclusion as the default. Longer, locked, or sleeping intervals are excluded automatically with a bounded undo path.
- Split sessions at event-time local midnight. Later timezone changes do not repartition historical shards.
- `editingMs` is an activity-subset metric using edit bursts with a default 15-second silence threshold.
- `openCount` counts activation from another file or untrackable view; ordinary application refocus on the same file does not increment it.

### File Identity and Aggregation

- Assign each observed file a stable internal `fileId`; do not write IDs to frontmatter or file content.
- Persist `pathAtEvent` on every metric-bearing event and maintain a current-path registry.
- History follows the current path when identity is known. Observed rename and move events update the registry without changing `fileId`.
- Preserve unmatched deleted history in a virtual “deleted” group. Never guess an offline rename when evidence is insufficient.
- Track all file-backed views; collect edit metrics only where an editor signal exists.
- Apply user glob exclusions, while the Obsidian config directory and Activity Map data are mandatory exclusions.
- Query from the vault root one directory level at a time. Represent current-directory files as a virtual “local files” item; show files directly when no child directory exists.
- Limit the donut to the top eight items plus “other”, while retaining every item in the detail list.

### Metrics and Extensibility

- The event model supports `activeMs`, `editingMs`, `openCount`, and the independent `typed-input` family for `typedChars`.
- `typedChars` counts each committed non-whitespace Unicode grapheme cluster from an applied CodeMirror 6 transaction marked `input.type` in the active, eligible foreground editor. Standalone Unicode whitespace graphemes, including spaces, tabs, line breaks, and non-breaking spaces, contribute zero. During IME composition, a trusted `compositionstart` makes `input.type.compose` changes provisional. The same editor's end lifecycle resolves a final transaction or bounded non-content numeric fallback: an untrusted host-delivered end may settle only already-observed numeric transactions, never its own datum; a zero final transaction cancels the provisional value. The exclusion applies only to future capture because retained evidence contains no text from which historical counts could be safely revised.
- Exclude paste, drop, history undo/redo, replacement caused by a non-text input type, programmatic edits, external file writes, and input from a non-current window, leaf, or non-editor control.
- Persist the number and a non-content source class only. Never persist the inserted string, composition buffer, selection, clipboard, or document diff.
- Deletions are out of scope for this version and do not subtract from `typedChars`.
- All metrics share `deviceId`, `fileId`, event timestamps, local date, event-time path, filters, aggregation, and export boundaries.

### Persistence and Retention

- Use Obsidian `loadData()` and `saveData()` only for settings, schema version, device identity, and small indexes.
- Store completed events as per-device, per-local-date NDJSON shards.
- Store derived daily summaries separately and make them rebuildable from retained raw events.
- Keep a small checkpoint for an in-flight session so a restart can recover or safely close it.
- Retain raw session and correction events for 90 days by default. Retain daily summaries until a later data modal offers an explicit clear operation.
- Delete raw events only after the corresponding aggregate has been durably written and verified readable.
- Retain raw JSON export, aggregate rebuild, scoped deletion, and full deletion as local service capabilities; a later header-modal decision owns their user-facing surface.
- Device shards may coexist when a user syncs the Obsidian configuration directory. `v0.1` does not silently deduplicate concurrent or duplicated device activity.

### Interface and Export

- Provide a stable file-header chart entry as the only Activity Map interaction entry through public or capability-gated Obsidian APIs. Mobile interaction cannot depend on hover.
- Keep presentation surfaces on the same immutable distribution/query semantics, stable file identity, and full-path activation contract. UI grouping may change projection only; it cannot change scope totals, vault totals, Deleted history, or raw evidence.
- Persist the last successful Header Popover path/file grouping choice as a small validated setting. A persistence failure cannot silently establish a new default.
- Project the current unclosed interval for live presentation only within the trusted idle boundary; presentation updates cannot rewrite persisted evidence.
- The Popover control group contains an export action immediately to the right of pause/resume. It opens a dedicated modal rather than a nested menu or confirmation dialog.
- The modal renders a large, complete `Wide` poster preview from the immutable current query/distribution snapshot. Its current user-facing action is one `PNG` download; layout, format, and filename controls are intentionally absent even though the renderer keeps its tested serialization variants. The optional caption starts empty, is edited in place at the bottom center, uses a system-serif stack, and is bounded to three exported lines.
- Export produces one local automatic download from the selected snapshot. It does not capture the mounted Popover, current screen, or note content, and it does not show a second confirmation modal.
- Use the packaged Activity Map wordmark in the poster. The current PNG wordmark may later be replaced by an SVG without changing the export contract.
- Keep export independent from mounted DOM, resolve the current Obsidian theme into the standalone SVG, escape user-derived strings, include accessible metadata in that source SVG, and rasterize PNG from the same SVG source.
- The [PRD Header Popover section](../../docs/PRD.md#环形图浮层) is the single source for current UI structure, controls, labels, visual hierarchy, and interaction behavior. Active Specs own temporary implementation deltas and acceptance evidence; this Constitution retains only stable product and data boundaries.

### Privacy and Network Boundary

- Keep settings, event shards, summaries, file registry, and checkpoints in the plugin data area under the vault configuration directory.
- Do not store note content, selected text, composition buffers, clipboard payloads, or actual typed strings.
- Do not add analytics, telemetry, accounts, remote APIs, or data upload in `v0.1`.
- Treat poster exports and any later raw-data exports as user-selected local output. The user explicitly starts the download; the browser owns its configured Downloads destination, while the modal exposes neither a filesystem path nor an editable filename.

## Invariants

- The sum of simultaneously attributed activity never exceeds elapsed foreground time.
- A confirmed idle, background, locked, paused, or sleeping interval cannot remain inside a closed session.
- `editingMs` never exceeds `activeMs` for the same file and range.
- Corrections are explicit records; they do not silently mutate or erase the original session evidence.
- Every metric-bearing record has a schema version, unique record ID, device ID, file ID, event timestamp, local date, and event-time path.
- Daily summaries are derived data. Raw retained records remain the authority for rebuildable dates.
- A corrupt record or date shard cannot block unrelated dates from loading.
- Retention cleanup cannot destroy the only durable representation of a metric.
- User notes and frontmatter remain untouched by tracking identity.
- No network connection is required for tracking, queries, data control, or SVG export.

## Technical Boundaries

### Logical Storage Layout

The physical root is the Activity Map plugin directory below Obsidian's configured vault configuration directory; `.obsidian` must not be hard-coded.

```text
<config-dir>/plugins/activity-map/
├── data.json
└── data/
    ├── checkpoint.json
    ├── files.json
    ├── sessions/
    │   └── <deviceId>/
    │       └── <YYYY-MM-DD>.ndjson
    └── daily/
        └── <deviceId>/
            └── <YYYY-MM-DD>.json
```

`data.json` owns settings, `schemaVersion`, `deviceId`, retention progress, and bounded indexes. `files.json` owns the stable file registry. Session shards own immutable session and correction evidence. Daily files own replaceable aggregates.

### Event Envelope

All NDJSON records use a versioned discriminated envelope:

```ts
interface EventEnvelope<TType extends string, TPayload> {
	schemaVersion: 1;
	recordId: string;
	type: TType;
	deviceId: string;
	fileId: string;
	pathAtEvent: string;
	occurredAt: string;
	localDate: string;
	payload: TPayload;
}
```

`session` payloads contain start, end, `activeMs`, `editingMs`, `openCount`, and closure reason. `adjustment` payloads reference a target session or interval, store signed metric deltas, and record the user decision reason. `typed-input` payloads store a non-negative `typedChars` count and a finite source classification without content.

### Write and Recovery Rules

- Normalize every adapter path and resolve it from the configured plugin directory.
- Serialize writes per target shard and never allow two in-process writers to interleave a record.
- Write replaceable JSON files through a temporary sibling and rename when the adapter supports atomic replacement; otherwise preserve the previous readable copy until the new copy is verified.
- Validate an NDJSON line before append. During reads, isolate malformed lines, continue with valid records, and surface the affected shard.
- Reconcile an in-flight checkpoint on startup before opening a new session. Recovery must apply the same focus, idle, and maximum-gap rules as live tracking.
- Aggregate per device first. Cross-device queries may sum intact shards while retaining device provenance.
- Run retention only after successful aggregate persistence and checkpoint reconciliation.

### Control Boundaries

- Window and leaf coordination owns the single active attribution target.
- Session state owns activity, editing bursts, idle transitions, pause, and correction candidates.
- Persistence owns append, checkpoint, rebuild, retention, corruption isolation, and export data reads.
- Query owns date denominators, current-path projection, directory grouping, top-eight selection, “other”, and deleted-file grouping.
- Presentation consumes query results and cannot rewrite raw activity evidence directly. Poster export consumes a frozen query/distribution snapshot and its local caption only.

## Alternatives

### Single `data.json`

Rejected for time-series storage because normal saves rewrite an ever-growing object, create a large corruption boundary, and increase multi-device write conflicts. It remains appropriate for small settings and indexes.

### Visible Markdown or JSON Notes

Rejected because generated records would pollute the vault tree, search results, Git history, and the plugin's own tracking scope.

### Electron System Idle as the Core

Rejected because it makes the core desktop-only and does not solve foreground-file attribution. Platform-specific idle signals may be optional enhancements after capability detection.

### File IDs in Frontmatter

Rejected because tracking must not mutate user content. The accepted registry design favors content integrity and explicitly acknowledges limits for unobserved offline moves.

### Active-Day Average

Rejected as the default because it hides zero-use days and inflates routine daily investment. It may appear as a clearly labeled secondary statistic.

### Canvas-Only Charting

Rejected because keyboard interaction, accessible semantics, and standalone vector export are first-class requirements.

## Assumptions

- Obsidian continues to expose file-backed views, workspace focus/leaf events, vault rename events, and a cross-platform data adapter.
- Operating systems report only one focused top-level Obsidian window at a time.
- A user who enables configuration-directory sync accepts that independent device shards may coexist until explicit reconciliation ships.
- Ninety days of raw records is sufficient for routine diagnosis and aggregate rebuild; changing this default does not alter event semantics.
- Header actions use a public API; this header-only surface deliberately provides no global toolbar or command fallback.

## History

| Date | Change | Reason |
| --- | --- | --- |
| 2026-07-21 | Established the initial product, attribution, identity, storage, privacy, UI, and extensibility decisions. | Provide a stable implementation boundary before feature development. |
| 2026-07-21 | Made the file-header entry a stable data-backed miniature donut and the popover an interactive hierarchical donut rather than a text status card. | Align the primary desktop entry with the Webtime Tracker reference and preserve direct hover, focus, pin, and drill-down interaction. |
| 2026-07-21 | Simplified the header popover to fixed controls, chart, path, and scrollable legend, and changed the header miniature from a single file-share arc to the actual vault-root distribution. | Remove duplicated information and hover-induced layout movement while making the persistent entry visually truthful to the chart it opens. |
| 2026-07-21 | Required the open header chart to project the idle-bounded unclosed session in real time and refined path, legend, and control alignment. | Eliminate the persistence/heartbeat lag between the miniature and popover while preserving trusted-time and fixed-layout invariants. |
| 2026-07-21 | Changed live Popover ticks to update existing chart and legend nodes in place, tightened chart/path/list spacing, normalized date-button gaps, and replaced Expand with pause/resume. | Preserve pointer/focus highlight across real-time updates and keep the compact control row useful without a duplicate full-view entry. |
| 2026-07-21 | Removed default legend-row fills, centered donut totals, aligned exact values before rightmost percentages, replaced the calendar icon with a visible date, and added consistent interactive affordances. | Improve scan alignment and make every clickable Popover element visually discoverable. |
| 2026-07-22 | Reflowed the Header Popover result into a `3:2` chart-and-list grid and shortened present file-leaf labels to basenames. | Use horizontal space without adding UI chrome and remove path repetition already supplied by breadcrumbs. |
| 2026-07-22 | Refined the approved Popover result to a centered `1:1` grid with equal inline padding and a tightly bounded donut. | Balance visible left/right whitespace after real-render tuning while keeping the list height tied to the rendered chart. |
| 2026-07-22 | Added an explicit path/file grouping choice to distribution queries and placed its Popover toggle before pause/resume. | Let users compare all files in the current path without losing hierarchical navigation, totals, or file identity. |
| 2026-07-22 | Retuned the final Popover to a centered `2:3` chart/list grid, ellipsized long legend names, and emphasized the centered total with a serif face. | Give file names more usable width without allowing them to overlap numeric columns, while strengthening the chart total hierarchy. |
| 2026-07-22 | Persisted the Header Popover path/file grouping preference in plugin settings. | Reopening the Popover or restarting the plugin must preserve the user's last successful display choice. |
| 2026-07-22 | Consolidated current Header Popover UI and interaction detail into the PRD. | Keep Constitution and Architecture focused on stable boundaries and module flow, with one current UX source of truth. |
| 2026-07-22 | Removed the global left-toolbar icon and command entry; the file-header donut is the sole Activity Map interaction surface. | Keep everyday interaction close to the active note. Export, rebuild, and deletion controls move to a future explicit header modal. |
| 2026-07-23 | Adopted `typedChars` as a trusted, content-free grapheme count with an independent raw event family and query metric. | Make the already reserved metric useful without collecting text or conflating it with `editingMs`. |
| 2026-07-23 | Made applied CodeMirror 6 `input.type` transactions the `typedChars` authority; DOM composition events only delimit IME finalization or cancellation. | Obsidian can flush an IME's final document change after `compositionend`, so global `beforeinput` timing cannot be the reliable record boundary. |
| 2026-07-23 | Allowed an untrusted CodeMirror composition-end observer to settle only numeric transactions observed after a trusted composition start. | The real Obsidian host can mark its internal end observer untrusted even when candidate confirmation has already applied the final transaction; its datum remains excluded. |
| 2026-07-23 | Excluded standalone Unicode whitespace graphemes from future `typedChars` capture. | Spaces, tabs, and line breaks do not represent input volume; retained numeric-only evidence cannot be backfilled safely. |
| 2026-07-23 | Adopted an editable local poster export modal in the Header Popover, with Portrait/Wide/Compact layouts and SVG/PNG/JPEG output. | Export the current data snapshot as a complete shareable poster without screenshotting the application or adding a confirmation dialog. |
| 2026-07-23 | Refined the visible export flow to one themed Wide PNG with a three-line system-serif caption; renderer variants remain internal capabilities. | Match the Popover's visual hierarchy while removing controls that distracted from the poster preview. |
