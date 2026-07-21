# Activity Map Product and Data Decisions

## Metadata

| Field | Value |
| --- | --- |
| Decision date | 2026-07-21 |
| Related specs | [Tracking runtime](../active/01-activity-tracking-runtime-plan.md), [Local data and query](../active/02-local-data-and-query-plan.md), [UI and v0.1 release](../active/03-activity-map-ui-and-v0-1-release-plan.md) |
| Product requirements | [Activity Map PRD](../../docs/PRD.md) |

## Decision Summary

Activity Map will be a local-first, cross-platform Obsidian plugin that records trustworthy foreground activity per file, preserves durable file identity and event-time paths, stores settings separately from sharded time-series data, and presents directory aggregates through a progressively disclosed UI. Desktop receives the complete experience; mobile remains a supported viewer and uses only capabilities verified on that platform.

## Background

The product must distinguish meaningful Obsidian activity from a file merely remaining visible. It also needs long-lived daily and historical queries without repeatedly rewriting an ever-growing settings file. Directory visualization must remain understandable when a vault contains hundreds or thousands of files, while later metrics such as human input counts need to reuse the same identity and aggregation model.

These requirements affect every release. They belong in a stable decision record rather than an implementation plan.

## User Narrative

A user works across several Obsidian windows and project folders. Activity Map attributes time only to the trackable file in the focused window. When the user walks away, the plugin closes the session at the last trusted interaction. On return, a short uncertain interval can be explicitly included; a long sleep interval stays excluded. The user opens Activity Map, navigates from the vault root into a project, changes from today to a 30-day average, inspects the exact file rows, and exports the current result as SVG. All records remain local and can be exported, rebuilt, or cleared.

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

- Version 1 of the event model supports `activeMs`, `editingMs`, and `openCount`.
- Reserve an independent `typed-input` event family for `typedChars`; do not infer it from arbitrary document diffs.
- Count future text input by grapheme cluster and exclude paste, drop, undo/redo, programmatic edits, and external file writes.
- All metrics share `deviceId`, `fileId`, event timestamps, local date, event-time path, filters, aggregation, and export boundaries.

### Persistence and Retention

- Use Obsidian `loadData()` and `saveData()` only for settings, schema version, device identity, and small indexes.
- Store completed events as per-device, per-local-date NDJSON shards.
- Store derived daily summaries separately and make them rebuildable from retained raw events.
- Keep a small checkpoint for an in-flight session so a restart can recover or safely close it.
- Retain raw session and correction events for 90 days by default. Retain daily summaries until the user clears them.
- Delete raw events only after the corresponding aggregate has been durably written and verified readable.
- Provide raw JSON export, aggregate rebuild, scoped deletion, and full deletion.
- Device shards may coexist when a user syncs the Obsidian configuration directory. `v0.1` does not silently deduplicate concurrent or duplicated device activity.

### Interface and Export

- Provide a stable file-header donut action with a focusable interactive chart popover, plus Ribbon and command fallbacks. Hover/focus reveals the chart; action click pins or unpins it; opening the dockable view remains a separate control.
- Render the header action as a stable miniature donut whose real-data arc represents the current file's share of today's vault activity. When data is unavailable, keep the same fixed donut outline instead of swapping tracking-state icons.
- Make the header popover and dockable view share the same query, native SVG donut, legend, range controls, breadcrumbs, and slice activation semantics. The popover defaults to today's vault-root distribution.
- Use a dockable `ItemView` as the complete interface. Mobile interaction must not depend on hover.
- Use a native SVG donut with stable colors, text detail, keyboard navigation, breadcrumbs, and explicit local-versus-vault percentages.
- Export a full information graphic by default and offer a chart-only SVG. Both outputs embed necessary styles and accessible metadata.

### Privacy and Network Boundary

- Keep settings, event shards, summaries, file registry, and checkpoints in the plugin data area under the vault configuration directory.
- Do not store note content, selected text, or actual typed strings.
- Do not add analytics, telemetry, accounts, remote APIs, or data upload in `v0.1`.
- Treat exported paths and filenames as user-selected local output; disclose their inclusion before export.

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

`session` payloads contain start, end, `activeMs`, `editingMs`, `openCount`, and closure reason. `adjustment` payloads reference a target session or interval, store signed metric deltas, and record the user decision reason. A future `typed-input` payload stores counts and source classification without content.

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
- Presentation consumes query results and cannot rewrite raw activity evidence directly.

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
- Header actions can use a public API or degrade to Ribbon and command access without losing core functionality.

## History

| Date | Change | Reason |
| --- | --- | --- |
| 2026-07-21 | Established the initial product, attribution, identity, storage, privacy, UI, and extensibility decisions. | Provide a stable implementation boundary before feature development. |
| 2026-07-21 | Made the file-header entry a stable data-backed miniature donut and the popover an interactive hierarchical donut rather than a text status card. | Align the primary desktop entry with the Webtime Tracker reference and preserve direct hover, focus, pin, and drill-down interaction. |
