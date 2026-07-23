# Activity Map Architecture

## Document Status

This document describes the implemented `v0.1` technical candidate and its remaining real-environment acceptance boundary. Source, automated fixtures, generated artifacts, and real Obsidian journeys remain distinct forms of evidence.

Authority links:

- [Product and data decisions](specs/constitution/2026-07-21-activity-map-product-and-data.md)
- [Product requirements](docs/PRD.md)
- [Roadmap](specs/ROADMAP.md)
- [Tracking runtime Spec](specs/active/01-activity-tracking-runtime-plan.md)
- [Local data and query Spec](specs/active/02-local-data-and-query-plan.md)
- [UI and v0.1 release Spec](specs/active/03-activity-map-ui-and-v0-1-release-plan.md)

## Current Implementation

The tracking, persistence, maintenance, query, controller, settings, and file-header/popover surfaces are implemented and covered by deterministic fixtures. Trusted editor input also produces content-free `typedChars` evidence and a fourth distribution metric. A ready Popover result can now open a local poster-export modal that freezes its query data, previews one theme-resolved Wide poster, and downloads its PNG rasterization at 2× source dimensions. Its volatile caption editor reports visual lines only while focused and warns when the three-line export bound is exceeded. Renderer layouts and encodings remain tested internal capabilities; the modal exposes no selector. The bundled PNG wordmark is embedded as a data URL in the SVG. Rebuild and deletion remain tested local data-service boundaries pending their later data-modal controls.

```text
src/
├── domain/                 # Implemented activity/settings contracts.
├── platform/               # Implemented clock and window abstractions.
├── tracking/               # Implemented attribution runtime and recovery behavior.
├── data/                   # Implemented local evidence, summaries, and data-operation services.
├── query/                  # Implemented date, path-grouped, and file-grouped distribution queries.
├── ui/                     # Header-only presentation, controller, immutable view model, and settings.
└── main.ts                 # Composes recovery, tracking, data, query, and bootstrap presentation.

styles.css                  # Header popover, chart, detail, theme, focus, and reduced-motion styles.
manifest.json               # Plugin ID activity-map; cross-platform manifest flag.
main.js                     # Generated build artifact; ignored and never edited directly.
```

Automated integration, accessibility-source, privacy-source, XML, and generated-artifact checks are implemented. Joint Critic review and real Obsidian desktop/mobile journeys remain subject to the open evidence checkboxes in Spec 03.

## System Overview

```text
Obsidian public APIs + standard Web APIs
        │
        │ focus / leaf / file / editor / trusted DOM input events
        ▼
┌──────────────────────── Tracking Runtime ────────────────────────┐
│ Select one eligible foreground file.                            │
│ Apply session, idle, edit-burst, typed-input, pause, recovery.  │
└───────────────────────────┬─────────────────────────────────────┘
                            │ closed sessions + checkpoints
                            ▼
┌────────────────────────── Data Layer ────────────────────────────┐
│ Resolve file/device identity, append raw evidence, rebuild daily │
│ summaries, retain diagnostics, and execute safe data operations. │
└───────────────────────────┬─────────────────────────────────────┘
                            │ immutable query results
                            ▼
┌────────────────────────── Query Engine ──────────────────────────┐
│ Calculate date ranges, current-path projections, path/file      │
│ groups, vault/scope totals, typed metrics, top items, “other”,  │
│ file rows.                                                      │
└───────────────────────────┬─────────────────────────────────────┘
                            │ ActivityMapViewModel
                            ▼
┌────────────── Header Presentation and Local Data Services ───────┐
│ File-header donut, popover, settings, detail list, native SVG    │
│ model, and unregistered local export/rebuild/deletion services.  │
└──────────────────────────────────────────────────────────────────┘

# Dependency rule: arrows point toward a consumer of validated output.
# Presentation cannot write raw shards; tracking cannot depend on DOM views.
```

## Target Source Layout

The target tree groups code by responsibility rather than by Obsidian callback type:

```text
src/
├── main.ts                         # Composition root and plugin lifecycle only.
│
├── domain/                         # Pure types and invariants; no Obsidian imports.
│   ├── activity.ts                 # Sessions, metrics, closures, recovery decisions.
│   └── settings.ts                 # Validated plugin settings and durable UI preferences.
│
├── platform/                       # Thin wrappers around time/window capabilities.
│   ├── clock.ts                    # Wall + monotonic samples; injectable in tests.
│   └── window-registry.ts          # Main/pop-out Window identity and listener ownership.
│
├── tracking/                       # Spec 01: foreground attribution state machine.
│   ├── ports.ts                    # Identity, checkpoint, record-sink, observer contracts.
│   ├── activity-engine.ts          # Pure serialized transitions and session invariants.
│   ├── editing-burst.ts            # Union/clipping of editor activity intervals.
│   ├── typed-input.ts              # Trusted grapheme count and IME commit classifier.
│   ├── recovery-queue.ts            # Pending decisions and bounded auto-exclusion undo.
│   ├── transition-queue.ts         # Serializes concurrent callbacks into ordered transitions.
│   ├── heartbeat-monitor.ts        # Detects delayed callbacks without counting the gap.
│   ├── checkpoint-reconciler.ts    # Startup replay/quarantine of in-flight checkpoints.
│   ├── target-resolver.ts          # Focused leaf -> eligible file identity request.
│   └── tracking-coordinator.ts     # Converts Obsidian/DOM events into engine inputs.
│
├── data/                           # Spec 02: local persistence and derived projections.
│   ├── paths.ts                    # Config-aware, normalized Activity Map-owned paths.
│   ├── schema.ts                   # Runtime validation for every persisted structure.
│   ├── settings-repository.ts      # Serialized loadData/saveData operations.
│   ├── safe-json-store.ts          # Verified .next/.bak replacement and recovery.
│   ├── file-registry.ts            # Stable fileId and current/last-known path mapping.
│   ├── event-envelope.ts           # Versioned session/adjustment/typed-input envelopes.
│   ├── ndjson-shard-store.ts       # Per-device/date serialized append and tolerant read.
│   ├── checkpoint-repository.ts    # Recoverable in-flight runtime snapshot.
│   ├── daily-summary-repository.ts # Replaceable metricsByFileId projection.
│   ├── retention-service.ts        # Removes raw dates only after summary verification.
│   ├── rebuild-service.ts          # Recomputes summaries from retained evidence.
│   ├── raw-export-service.ts       # Metadata/metrics export; never reads note content.
│   └── deletion-service.ts         # Preview + drift-checked scoped deletion.
│
├── query/                          # Spec 02: read-only statistics semantics.
│   ├── date-range.ts               # Day, 7/30/90/all averages, and coverage.
│   ├── path-projection.ts          # Current path, local files, deleted grouping, metric projection.
│   ├── distribution-query.ts       # Scope/vault totals, ranking, and “other”.
│   └── query-cache.ts              # Snapshot cache with targeted invalidation.
│
├── ui/                             # Spec 03: Obsidian-owned presentation surfaces.
│   ├── activity-map-controller.ts  # Intent serialization and immutable view model.
│   ├── file-hover-preview.ts       # Public Page Preview event and activation gate.
│   ├── header-action-manager.ts    # Public FileView.addAction lifecycle.
│   ├── poster-caption-editor.ts   # In-preview caption textarea and ephemeral line-bound feedback.
│   ├── poster-export-modal.ts     # Wide PNG modal and local download action.
│   ├── summary-popover.ts          # Owner-document-aware non-modal interaction.
│   ├── settings-tab.ts             # Validated save-before-apply settings controls.
│   └── components/                 # Range, breadcrumb, donut, and detail renderers.
│
└── export/                         # Spec 07: deterministic standalone poster artifacts.
    ├── poster-exporter.ts          # Query snapshot -> escaped Portrait/Wide/Compact SVG.
│   ├── poster-export-session.ts   # Frozen snapshot, default Wide PNG, volatile caption.
│   ├── poster-theme.ts            # Document theme tokens -> standalone SVG palette.
    ├── poster-wordmark.ts          # Bundled PNG wordmark data URL.
    └── export-destination.ts       # Capability-gated Blob download and SVG rasterization.

tests/
├── helpers/                        # Fake clock, adapter, windows, and fixed history.
├── tracking/                       # Pure state-machine and coordination evidence.
├── data/                           # Recovery, corruption, retention, deletion evidence.
├── query/                          # Fixed range/path aggregation evidence.
├── ui/                             # DOM, keyboard, focus, and chart evidence.
├── export/                         # SVG parsing, escaping, and value parity.
└── integration/                    # Full fixture journey; kept distinct from real UAT.
```

Do not create every listed file preemptively. Each Active Spec introduces only the modules needed by its current Phase.

## Dependency Direction

```text
domain
  ▲
  ├── platform              # Implements abstract time/window capabilities.
  ├── tracking              # Depends on domain + ports; emits domain records.
  ├── data                  # Implements tracking ports and persisted projections.
  ├── query                 # Reads validated data snapshots; never raw UI state.
  ├── ui                    # Consumes tracking snapshots + query/data services.
  └── export                # Consumes immutable chart/query models.

main.ts
  └── may import every outer module only to compose lifecycle ownership.

# Forbidden edges:
# domain -> Obsidian/data/ui
# tracking -> concrete data repository or rendered DOM
# data/query -> ui
# export -> live DOM or note content
# any module -> hidden network/telemetry service
```

Interfaces break the two important implementation-order dependencies:

```ts
// Spec 01 defines these ports and verifies the runtime with in-memory fakes.
interface TrackingRecordSink {
	appendSessions(records: readonly ClosedSessionSegment[]): Promise<void>;
	appendRecoveryDecision(decision: RecoveryDecision): Promise<void>;
}

// Spec 02 implements the ports using local, sharded plugin data.
interface FileIdentityPort {
	resolve(file: TFile): Promise<{ fileId: string; currentPath: string }>;
}

// Spec 03 consumes read-only results and controller intents.
interface ActivityMapController {
	getViewModel(): ActivityMapViewModel;
	dispatch(intent: ActivityMapIntent): Promise<void>;
}
```

## Plugin Lifecycle

Startup and shutdown order protect recovery evidence:

```text
onload
  1. load + validate settings          # Tracking must not start with unknown defaults.
  2. open registry and event stores    # File/device identity exists before attribution.
  3. load and reconcile checkpoint     # Recover once before accepting new events.
  4. start tracking coordinator        # Registers workspace/window/editor/DOM inputs.
  5. register controller, settings, and header actions

onunload / Obsidian quit
  1. reject new UI intents             # Prevent operations during teardown.
  2. unregister tracking inputs        # Stop new state transitions.
  3. close/flush active session        # Append evidence before clearing checkpoint.
  4. flush data/settings queues        # Resolve owned asynchronous writes.
  5. remove transient owned DOM        # Header-only UI owns no restorable Activity Map leaf.
```

Every startup stage can enter a visible degraded state. A persistence failure must stop new unverifiable attribution; the plugin must not silently fall back to in-memory totals.

## Tracking Runtime

Tracking is a single serialized state machine owned by [Spec 01](specs/active/01-activity-tracking-runtime-plan.md).

```text
stopped
  ├── untrackable        # No eligible foreground file or tracking disabled.
  ├── active             # Exactly one file owns one provisional session.
  ├── idle               # Session settled at last trusted activity.
  ├── paused             # Explicit user pause or safe operational pause.
  └── degraded           # Persistence/checkpoint boundary cannot guarantee evidence.

active --trusted signal same target--> active(refresh lastActivity)
active --file switch---------------> active(new target; close old without overlap)
active --blur-----------------------> untrackable(close at blur sample)
active --idle/sleep confirmation----> idle(close at last trusted sample)
idle   --resume---------------------> active(new session + separate recovery candidate)

# At most one target receives activeMs at any instant.
# Timer callbacks only confirm elapsed inactivity; they never define earned time.
# editingMs is a clipped union of edit bursts and cannot exceed activeMs.
```

One callback creates one immutable wall/monotonic clock sample. Wall time owns timestamps and local-date boundaries; monotonic time owns elapsed durations and delayed-heartbeat detection. Closed intervals are split at local midnight only after their final endpoint is known, so idle rollback cannot leave an already persisted fragment.

Trusted activity refreshes a bounded live checkpoint, including collapsed completed-edit duration plus the current burst endpoints. `editor-change` carries its source file/leaf/window through the platform boundary and is accepted only when it matches the unique foreground target.

## typedChars Input Boundary

`ActivityMapPlugin` registers a public CodeMirror 6 `ViewPlugin` through Obsidian's `registerEditorExtension()`. The bridge reads each editor's `editorInfoField`, which may be the active `MarkdownEditView` rather than its enclosing `MarkdownView`, and matches that object to the current Markdown leaf before minting window/leaf provenance. It accepts only applied document-changing transactions marked `input.type`, immediately converts their inserted text to a non-whitespace grapheme count at that platform boundary, and sends only `{ windowId, leafId, typedChars, source }` to `TrackingCoordinator`.

`input.type.compose` transactions are provisional after a trusted `compositionstart`. A bounded two-frame finalization window accepts a trailing applied `input.type` or `input.type.compose` transaction first. On hosts where CodeMirror exposes its end observer as untrusted, that observer cannot contribute its datum; it only settles the last numeric composition transaction already seen after the trusted start. A final zero transaction cancels this provisional value. A trusted end may instead use its non-empty datum as a numeric fallback, while a trusted empty end cancels. Two frames place fallback after CodeMirror's post-end microtask and its Android animation-frame flush, without touching private CodeMirror internals. Paste, drop, history, completion, programmatic changes, deletions, background leaves, and non-current windows do not cross the bridge.

```text
CodeMirror input.type transaction -> grapheme count -> TrackingCoordinator -> TypedInputRecord
                     -> TrackingRecordSink.appendTypedInputs
                     -> per-device/date NDJSON typed-input envelope
                     -> DailySummary.metricsByFileId.typedChars
                     -> immutable DistributionQuery metric
```

Append failure enters the same degraded safety boundary as a session append. Pre-`typedChars` daily summaries normalize the missing field to zero; retained session/adjustment records stay valid unchanged.

## Data Layer and Query Engine

Spec 02 implements local evidence, derived summaries, and read-only product queries.

### Physical Layout

```text
<vault-config-dir>/plugins/activity-map/
├── data.json                         # Small settings, schemaVersion, deviceId.
└── data/
    ├── checkpoint.json               # Recoverable in-flight runtime state.
    ├── files.json                    # Stable fileId -> current/last-known path.
    ├── sessions/<device>/<date>.ndjson
    │                                   # Append-oriented session/adjustment/typed-input evidence.
    └── daily/<device>/<date>.json
                                        # Replaceable metricsByFileId projection.

# The configured directory may not be named .obsidian.
# Note files and frontmatter are never modified for tracking identity.
```

### Write Path

```text
closed runtime record
  -> validate domain values
  -> add schemaVersion / recordId / deviceId / fileId / pathAtEvent
  -> validate the existing shard and enqueue one adapter append for its device/date
  -> read + rebuild the matching daily summary
  -> verify replacement is readable and fingerprint-matches the source record ids
  -> invalidate matching query-cache snapshots

# recordId is the idempotency key for uncertain append retries.
# Session/date and recovery-candidate decision keys remain stable across checkpoint retries.
# Normal append never replaces a raw shard; unreadable/corrupt sources abort before mutation.
# One malformed line is isolated and reported; unrelated records still load.
# Raw retention runs only after the corresponding daily summary is verified.
# Maintenance operations emit typed per-date progress and explicit partial-failure results.
```

Replaceable JSON uses a recoverable `.next`/`.bak` protocol. Mutation is serialized per owned path, while file-registry changes use one global registry queue. A query reads one registry snapshot and one summary-version snapshot so concurrent mutation cannot produce a mixed projection.

### Query Path

```text
DistributionQuery(metric, range, path, view, groupBy)
  -> resolve day coverage and average denominator
  -> load verified daily summaries across device shards
  -> join fileId with current path or deleted state
  -> groupBy path: next directory segment or direct local files
  -> groupBy file: every present descendant file below path
  -> compute scopeTotal + vaultTotal + percentOfVault
  -> sort all details; derive top N + “other” for the chart
  -> return DistributionResult + warnings + coverage

# Daily averages include zero-use natural days after the first recorded date.
# Grouping changes item presentation, not scopeTotal or vaultTotal.
# “Other” is a derived query item and never becomes a real path.
# Valid historical summaries avoid scanning expired raw session files.
```

## Presentation and Export

This document owns presentation module boundaries and dependency direction. User-visible behavior belongs to the [PRD Header Popover section](docs/PRD.md#环形图浮层), while stable cross-version constraints belong to the [Interface and Export decision](specs/constitution/2026-07-21-activity-map-product-and-data.md#interface-and-export). Active Specs own implementation-local deltas and evidence. Pixel values, spacing, typography choices, and interaction copy do not belong here.

Presentation surfaces consume immutable controller state and return typed intents. They never append evidence, rewrite summaries, or execute destructive storage mutations directly.

```text
Query and tracking outputs
  -> ActivityMapController          # Owns view state, intent routing, and stale-query guards.
       ├── HeaderActionManager      # Capability-gated file-header entry and unavailable status.
       ├── SummaryPopover           # Header-scoped query and interaction surface.
       └── SettingsTab              # Persists validated preferences before durable use.

DistributionResult
  -> LiveDistributionProjection     # Pure, idle-bounded presentation projection.
  -> ChartModel                     # Shared semantic chart representation.
       ├── DonutChart               # DOM presentation adapter.
       └── PosterExporter           # Standalone serialization; never snapshots live DOM.

SummaryPopover ready distribution
  -> PosterExportSession            # Deep-copied modal snapshot + volatile caption/options.
  -> PosterExportModal              # Obsidian modal and in-preview caption editor.
  -> BrowserSvgRasterizer           # SVG bytes -> PNG/JPG when capability exists.
  -> BrowserExportDestination       # One local Blob download.
```

The Header Popover grouping preference crosses the settings port before becoming the default for a newly opened Popover. Grouping remains a query presentation axis: it changes item projection without changing scope or vault totals. Persistence failure rolls back the optimistic preference and invalidates its in-flight query.

Header integration is capability-gated behind `HeaderActionManager` and is the only registered Activity Map interaction entry. The source contains no dockable Activity Map view or command registration. The trailing control group places poster export directly after pause/resume; it remains disabled without a ready query result. Opening it deep-copies the displayed distribution before later ticks or navigation can mutate controller state. The current modal exposes only the default Wide PNG flow and a bounded in-preview caption; its preview image and PNG rasterization derive from the same escaped, theme-resolved standalone SVG. Renderer variants remain below this UI boundary. A missing canvas/download capability reports a modal error without claiming success. Rebuild and destructive data controls remain owned by the data layer until the later data modal introduces their controller boundary.

File rows in the Header Popover register one `defaultMod` hover source and emit Obsidian's public `hover-link` event through `file-hover-preview.ts`. Page Preview owns the native preview lifecycle, so modifier hover never calls the file-opening path or changes the active tracking leaf. Because the native preview is mounted outside the Activity Map DOM, `SummaryPopover` treats the owning leaf's connected `hoverPopover.hoverEl` as a temporary interaction extension: it preserves the source row while the preview is open, excludes preview clicks from outside-click dismissal, and resumes delayed close after Obsidian removes the preview. Direct activation accepts only user-agent-issued primary clicks or the existing keyboard contract; synthetic DOM clicks cannot switch the foreground file. List and donut highlight transitions remain presentation-only and are disabled by the reduced-motion media query.

## Failure and Privacy Boundaries

```text
Invalid settings          -> field-level defaults + visible warning
Corrupt registry          -> preserve evidence + stop new identity creation
Corrupt daily summary     -> exclude projection + visible rebuild-required warning
Malformed NDJSON line     -> isolate line + continue valid records
Failed JSON replacement   -> recover primary/backup + report affected path
Checkpoint uncertainty    -> degraded pause; never guess elapsed time
Stale deletion plan       -> reject changed scope/path fingerprints before mutation
Poster-export failure       -> keep the modal open with an explicit unavailable/error state
Header-action failure     -> visible unavailable warning; no global fallback entry

# No failure path enables telemetry, remote upload, note-content reads,
# selected-text capture, or storage of actual typed strings.
```

## Testing and Evidence

```text
unit tests
  ├── fake clock          # State transitions, idle rollback, DST/midnight.
  ├── fake DataAdapter    # Interrupted writes, recovery, corruption, deletion.
  └── fixed query models  # Date denominators, paths, “other”, deleted rows.

integration fixtures
  └── signal -> session -> shard -> summary -> query -> header UI/local services
                            # Stronger than unit tests, still not real Obsidian UAT.

real Obsidian evidence
  ├── desktop header-only journey
  └── mobile viewer journey
                            # Recorded separately after technical/Critic gates.
```

Automated and real-environment evidence must remain distinguishable in Active Specs and Roadmap checkboxes.

## Change Ownership

```text
Time/session/window semantics             -> Spec 01 + Tracking Runtime section
Schema/storage/identity/query changes     -> Spec 02 + Data Layer and Query Engine section
User-visible UI/UX behavior               -> PRD + owning Active Spec
Presentation/export ownership or flow     -> Presentation and Export section
Stable cross-version boundary changes     -> Constitution first, then this document and Specs
Version outcome or release evidence       -> Roadmap after owning Spec evidence
```

Update this document when module ownership, dependency direction, startup/shutdown order, persistence flow, query boundary, or platform boundary changes. Keep detailed UI behavior and visual tuning in the PRD and owning Active Spec.
