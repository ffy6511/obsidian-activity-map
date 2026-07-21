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

The tracking, persistence, maintenance, query, controller, statistics, file-header, export, and data-control surfaces are implemented, covered by deterministic fixtures, and composed by the plugin entrypoint. The installable bundle collects activity, maintains queryable daily summaries, renders hierarchical native-SVG distributions, exports standalone SVG or raw JSON, rebuilds summaries, and executes previewed drift-checked deletion plans:

```text
src/
├── domain/                 # Implemented activity/settings contracts.
├── platform/               # Implemented clock and window abstractions.
├── tracking/               # Implemented attribution runtime and recovery behavior.
├── data/                   # Implemented local evidence, summaries, and data controls.
├── query/                  # Implemented date and hierarchical distribution queries.
├── ui/                     # Implemented controller, immutable view model, commands, and settings.
└── main.ts                 # Composes recovery, tracking, data, query, and bootstrap presentation.

styles.css                  # Responsive view, chart, detail, theme, focus, and reduced-motion styles.
manifest.json               # Plugin ID activity-map; cross-platform manifest flag.
main.js                     # Generated build artifact; ignored and never edited directly.
```

Automated integration, accessibility-source, privacy-source, XML, and generated-artifact checks are implemented. Joint Critic review and real Obsidian desktop/mobile journeys remain subject to the open evidence checkboxes in Spec 03.

## System Overview

```text
Obsidian public APIs + standard Web APIs
        │
        │ focus / leaf / file / editor / trusted DOM events
        ▼
┌──────────────────────── Tracking Runtime ────────────────────────┐
│ Select one eligible foreground file.                            │
│ Apply session, idle, edit-burst, pause, and recovery semantics. │
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
│ Calculate date ranges, current-path projections, folder groups, │
│ vault/scope totals, top items, “other”, and deleted-file rows.  │
└───────────────────────────┬─────────────────────────────────────┘
                            │ ActivityMapViewModel
                            ▼
┌──────────────────── Presentation and Export ─────────────────────┐
│ Full ItemView, file-header status, popover, settings, detail     │
│ list, native SVG donut, JSON/SVG export, and data controls.      │
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
│   └── settings.ts                 # Validated runtime settings and documented units.
│
├── platform/                       # Thin wrappers around time/window capabilities.
│   ├── clock.ts                    # Wall + monotonic samples; injectable in tests.
│   └── window-registry.ts          # Main/pop-out Window identity and listener ownership.
│
├── tracking/                       # Spec 01: foreground attribution state machine.
│   ├── ports.ts                    # Identity, checkpoint, record-sink, observer contracts.
│   ├── activity-engine.ts          # Pure serialized transitions and session invariants.
│   ├── editing-burst.ts            # Union/clipping of editor activity intervals.
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
│   ├── event-envelope.ts           # Versioned session/adjustment persistence envelope.
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
│   ├── path-projection.ts          # Current path, local files, deleted grouping.
│   ├── distribution-query.ts       # Scope/vault totals, ranking, and “other”.
│   └── query-cache.ts              # Snapshot cache with targeted invalidation.
│
├── ui/                             # Spec 03: Obsidian-owned presentation surfaces.
│   ├── activity-map-controller.ts  # Intent serialization and immutable view model.
│   ├── activity-map-view.ts        # Dockable ItemView renderer.
│   ├── header-action-manager.ts    # Public FileView.addAction lifecycle.
│   ├── summary-popover.ts          # Owner-document-aware non-modal interaction.
│   ├── settings-tab.ts             # Validated save-before-apply settings controls.
│   ├── data-controls.ts            # Export/rebuild/delete progress and warnings.
│   └── components/                 # Range, breadcrumb, donut, and detail renderers.
│
└── export/                         # Spec 03: deterministic standalone artifacts.
    ├── svg-exporter.ts             # ChartModel -> escaped standalone SVG.
    └── export-destination.ts       # Capability-detected local download boundary.

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
  5. register controller + UI          # UI receives a complete initial snapshot.

onunload / Obsidian quit
  1. reject new UI intents             # Prevent operations during teardown.
  2. unregister tracking inputs        # Stop new state transitions.
  3. close/flush active session        # Append evidence before clearing checkpoint.
  4. flush data/settings queues        # Resolve owned asynchronous writes.
  5. remove transient owned DOM        # Keep Obsidian-restorable ItemView placement.
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
    │                                   # Append-oriented session/adjustment evidence.
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
DistributionQuery(metric, range, path, view)
  -> resolve day coverage and average denominator
  -> load verified daily summaries across device shards
  -> join fileId with current path or deleted state
  -> group by next directory segment or direct local files
  -> compute scopeTotal + vaultTotal + percentOfVault
  -> sort all details; derive top N + “other” for the chart
  -> return DistributionResult + warnings + coverage

# Daily averages include zero-use natural days after the first recorded date.
# “Other” is a derived query item and never becomes a real path.
# Valid historical summaries avoid scanning expired raw session files.
```

## Presentation and Export

Spec 03 owns every user-visible surface and consumes immutable controller models.

```text
ActivityMapController
├── ItemView                       # Range, breadcrumb, totals, chart, details, controls.
├── file-header mini donut         # Stable miniature of today's vault-root distribution.
├── interactive chart popover      # Shared query/donut/legend; hover/focus/pin/drill-down.
├── Ribbon + commands              # Stable fallback when header integration is absent.
├── settings tab                   # Persist valid values before applying them.
└── data-operation dialogs         # Preview destructive scope; report progress/failure.
```

The header popover, dockable view, and exported SVG share one chart model:

```text
DistributionResult
  -> ChartModel                    # Stable items, colors, labels, geometry inputs.
       ├── DonutChart DOM          # Reused by popover and ItemView.
       └── SvgExporter             # Escaped, styled, standalone serialized artifact.

# Export never snapshots live DOM, so transient tooltips/buttons cannot leak.
# Every graphical item has equivalent label, percentage, and exact-value text.
# Paths and labels are escaped before entering SVG markup.
```

UI code sends intents to the controller. It cannot append records, rewrite summaries, or delete files directly. Destructive actions execute only the immutable plan returned by the data layer. The plan freezes the selected shard pairs and every affected raw, summary-only, checkpoint, and registry path with per-path content fingerprints. Execution rejects a changed scope before mutation, rechecks each frozen pair immediately before its first write, and never widens deletion from a newly enumerated path.

Daily summaries cross a strict persistence boundary before reaching queries: device/date identity, timestamps, counts, per-file finite non-negative integer metrics, `editingMs <= activeMs`, and warning objects are validated together. Missing summaries contribute no data; invalid summaries are excluded and surface a stable rebuild-required warning instead of silently reducing totals. Deleted identities use `lastKnownPath` for directory membership, while identities with no known path appear only in the vault-root Deleted group.

The header-action manager listens to public workspace lifecycle events, owns one `FileView.addAction()` element per live file view through a weak registry, and removes only those elements on view removal or unload. It installs one stable miniature SVG donut driven by a dedicated today/vault-root query. Slice nodes are reconciled by stable item ID and reuse the chart palette; the in-flight active session adjusts its owning root slice before persistence. Tracking snapshots update accessible status and restrained CSS state without replacing the SVG or rebuilding the action. Missing data retains the same empty-ring geometry.

Each popover is attached to its trigger's owner document so pop-out windows keep independent focus, pointer, pin, and close behavior. Hover/focus opens the vault-root chart; action click toggles a pinned state; an icon action separated from the date group opens the ItemView with the current popover query. The popover consumes the controller's immutable distribution and reuses the range controls, donut, legend, path, and directory/file activation behavior from the full view. Its fixed regions are controls, chart, current path, and a bounded scrollable legend. Slice highlight only changes classes; it creates no tooltip row. Duplicate summary, title, and ordinary tracking-status regions are absent. Hover listeners remain capability-gated; keyboard focus, action click, Ribbon, commands, and the full view remain usable without hover or when header integration reports a warning.

Data operations are single-flight controller intents. SVG serialization consumes the same immutable `ChartModel` as the live donut, resolves its stable color tokens to inline standalone colors, escapes every user-derived string, and downloads through a capability-detected standard Web API boundary. Raw JSON export and rebuild relay typed per-date progress. Deletion renders the backend plan ID and counts, expires the UI confirmation after five minutes, executes the exact retained plan object, and maps drift or partial failure to explicit error state before refreshing queries.

Before deletion planning, the controller closes the in-flight session and awaits the tracking transition queue so the plan fingerprints durable evidence. Cancellation and every execution outcome resume tracking only when the controller initiated that operational pause, creating a fresh attribution session after the destructive boundary.

## Failure and Privacy Boundaries

```text
Invalid settings          -> field-level defaults + visible warning
Corrupt registry          -> preserve evidence + stop new identity creation
Corrupt daily summary     -> exclude projection + visible rebuild-required warning
Malformed NDJSON line     -> isolate line + continue valid records
Failed JSON replacement   -> recover primary/backup + report affected path
Checkpoint uncertainty    -> degraded pause; never guess elapsed time
Stale deletion plan       -> reject changed scope/path fingerprints before mutation
Missing export capability -> explain unavailable action; keep viewing functional
Header-action failure     -> Ribbon/command/full-view fallback

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
  └── signal -> session -> shard -> summary -> query -> UI/export
                            # Stronger than unit tests, still not real Obsidian UAT.

real Obsidian evidence
  ├── desktop full journey
  └── mobile viewer journey
                            # Recorded separately after technical/Critic gates.
```

Automated and real-environment evidence must remain distinguishable in Active Specs and Roadmap checkboxes.

## Change Ownership

```text
Time/session/window semantics         -> Spec 01 + Tracking Runtime section
Schema/storage/identity/query changes -> Spec 02 + Data Layer and Query Engine section
UI/export/platform journey changes    -> Spec 03 + Presentation and Export section
Stable cross-version boundary changes -> Constitution first, then this document and Specs
Version outcome or release evidence   -> Roadmap after owning Spec evidence
```

Update this document in the same change whenever module ownership, dependency direction, startup/shutdown order, persistence flow, query boundary, presentation contract, or platform boundary changes.
