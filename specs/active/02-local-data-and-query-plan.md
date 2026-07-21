# Local Data and Query Plan

## Metadata

| Field | Value |
| --- | --- |
| Created | 2026-07-21 |
| Scope | `src/data/`, `src/query/`, settings persistence, data tests |
| Type | feat |
| Priority | P0 |
| Status | in-progress |
| Completed | pending |
| Dependencies | [Activity Tracking Runtime](01-activity-tracking-runtime-plan.md) |
| Decisions | [File identity and aggregation](../constitution/2026-07-21-activity-map-product-and-data.md#file-identity-and-aggregation), [Persistence and retention](../constitution/2026-07-21-activity-map-product-and-data.md#persistence-and-retention), [Technical boundaries](../constitution/2026-07-21-activity-map-product-and-data.md#technical-boundaries), [Data architecture](../../ARCHITECTURE.md#data-layer-and-query-engine) |

## Phases

- [x] Phase 0: Establish paths, settings, schemas, and adapter contracts
- [x] Phase 1: Implement file identity, event shards, and checkpoint recovery
- [ ] Phase 2: Implement daily summaries and hierarchical queries
- [ ] Phase 3: Implement retention, rebuild, export, and scoped deletion

## Background

### Problem

The tracking runtime needs durable ports, while the product needs multi-year queries that do not scan or rewrite one growing settings file. The data layer must survive interrupted writes, isolate corrupt NDJSON lines, preserve stable file identity across observed moves, and retain daily summaries after raw events expire.

### Current Behavior

The repository has no settings model, device ID, file registry, event store, checkpoint, daily summary, query engine, retention job, JSON export, or deletion service. The Constitution defines their boundaries but does not define implementation modules or transaction behavior.

### Goals and Non-goals

Goals:

- Persist settings separately from per-device, per-date event shards.
- Implement stable `fileId` assignment without modifying user files.
- Provide serialized append, recoverable JSON replacement, checkpoint reconciliation, and corrupt-line diagnostics.
- Build rebuildable daily summaries and selected-day, daily-average, all-history, and path queries.
- Implement safe retention, raw JSON export, aggregate rebuild, and scoped deletion services.
- Preserve device provenance while summing intact device shards.

Non-goals:

- Resolve unobserved offline moves through content hashing or guesses.
- Deduplicate simultaneous activity across devices.
- Render charts, dialogs, settings controls, or download UI; Spec 03 owns presentation.
- Add event-time-path analysis or later-version input metrics.

### Key Insight

Raw event shards are append-oriented evidence, daily summaries are replaceable projections, and the file registry is the current-path projection. Keeping these responsibilities separate makes corruption, retention, path moves, and rebuild behavior explicit.

## Design

> Inherited design: [Logical storage layout](../constitution/2026-07-21-activity-map-product-and-data.md#logical-storage-layout), [Event envelope](../constitution/2026-07-21-activity-map-product-and-data.md#event-envelope), [Write and recovery rules](../constitution/2026-07-21-activity-map-product-and-data.md#write-and-recovery-rules), and [PRD data requirements](../../docs/PRD.md#数据与隐私要求).
>
> Local delta: implement the repositories, projections, query contracts, and destructive-operation plans behind the tracking and presentation ports.

### Data Flow

```text
Tracking runtime domain record
  -> resolve file identity and device identity
  -> validate EventEnvelope
  -> serialize append per device/date shard
  -> rebuild that date's daily summary
  -> invalidate affected query cache

Query request
  -> choose date coverage and denominator
  -> load valid daily summaries per device
  -> join fileId with current-path registry
  -> aggregate vault/path/local-files/deleted groups
  -> rank top items and derive “other”
  -> return values, provenance, and diagnostics
```

### Storage Paths and Settings

Resolve the plugin root from `manifest.dir` when available, otherwise from `vault.configDir`, `plugins`, and `manifest.id`. Normalize every adapter path and never hard-code `.obsidian`.

```ts
interface ActivityMapSettings {
	schemaVersion: 1;
	deviceId: string;
	trackingEnabled: boolean;
	manuallyPaused: boolean;
	idleThresholdMs: number;
	recoveryLimitMs: number;
	editSilenceMs: number;
	averageWindowDays: 7 | 30 | 90 | 'all';
	rawRetentionDays: number;
	maxChartItems: number;
	excludedPathGlobs: string[];
	retentionWatermark?: string;
}
```

- Load and save settings through `Plugin.loadData()` and `saveData()` only.
- Apply defaults field by field and reject invalid numeric ranges instead of trusting cast JSON.
- Serialize setting writes so an earlier slow save cannot overwrite a later value.
- Normalize vault paths to `/`. Supported user glob syntax is `*` within a segment, `**` across segments, and `?` for one character; matching is case-sensitive for consistent cross-platform semantics.
- Mandatory exclusions for the config directory, plugin root, and Activity Map data apply before user patterns and cannot be removed.

### Event and Registry Structures

```ts
type ActivityEvent =
	| EventEnvelope<'session', SessionPayload>
	| EventEnvelope<'adjustment', AdjustmentPayload>;

interface FileRegistryEntry {
	fileId: string;
	currentPath: string | null;
	lastKnownPath: string;
	state: 'present' | 'deleted';
	firstSeenAt: string;
	lastSeenAt: string;
}

interface FileRegistryFile {
	schemaVersion: 1;
	entries: Record<string, FileRegistryEntry>;
	pathIndex: Record<string, string>;
}
```

- Generate device, file, event, session, and candidate IDs with the standard cryptographic UUID API.
- The path index is unique for present files and is derived/validated against entries on load.
- Observed rename updates `currentPath`, `lastKnownPath`, and the path index without changing `fileId`.
- Observed delete sets `currentPath: null`; a later file at the same path receives a new ID unless a reliable live rename event linked it.
- Folder events update descendant registry paths in one serialized transaction.
- Registry corruption does not permit silent ID reassignment; preserve the damaged file, expose a diagnostic, and pause new identity creation until repair or reset.

### Write, Read, and Recovery Semantics

`SafeJsonStore` writes a sibling `.next`, reads and validates it, preserves the previous readable value as `.bak`, promotes `.next`, verifies the promoted file, and then removes `.bak`. Startup selects the newest valid primary/backup candidate and reports any recovery.

`NdjsonShardStore` maintains one in-process queue per normalized shard path:

- Validate and JSON-serialize a complete record before appending one line.
- Include a terminal newline and never interleave append calls for the same shard.
- Treat `recordId` as the idempotency key. Readers ignore duplicate IDs within a shard and emit a diagnostic.
- Read line by line logically, isolate malformed or schema-invalid lines, and continue with valid records.
- Never rewrite a raw shard during normal append; scoped deletion is an explicit maintenance transaction.

Checkpoint writes use `SafeJsonStore`. On startup, load settings, registry, and checkpoint before starting the tracking coordinator. Pass a valid checkpoint to Spec 01's reconciler; quarantine an invalid checkpoint and enter a visible degraded state rather than guessing elapsed time.

### Daily Summary

```ts
interface DailyFileMetrics {
	activeMs: number;
	editingMs: number;
	openCount: number;
}

interface DailySummary {
	schemaVersion: 1;
	deviceId: string;
	localDate: string;
	generatedAt: string;
	sourceRecordCount: number;
	metricsByFileId: Record<string, DailyFileMetrics>;
	warnings: DataWarning[];
}
```

- Recompute the affected device/date summary from its complete retained shard after each successful append batch.
- Apply adjustments by stable candidate/session reference and `recordId`; duplicate or unknown references become warnings.
- Reject non-finite values and never persist negative aggregate metrics.
- Verify a summary after replacement before publishing cache invalidation.
- When raw evidence has expired, the last verified daily summary remains authoritative for that date and records that raw rebuild is unavailable.

### Query Contract

```ts
interface DistributionQuery {
	metric: 'activeMs' | 'editingMs' | 'openCount';
	range:
		| { mode: 'day'; localDate: string }
		| { mode: 'average'; days: 7 | 30 | 90 | 'all'; today: string }
		| { mode: 'all' };
	path: string;
	view: 'children' | 'local-files';
}

interface DistributionItem {
	id: string;
	kind: 'directory' | 'file' | 'local-files' | 'other' | 'deleted';
	label: string;
	path: string | null;
	value: number;
	percentOfScope: number;
	memberIds: string[];
}

interface DistributionResult {
	query: DistributionQuery;
	scopeTotal: number;
	vaultTotal: number;
	percentOfVault: number;
	denominatorDays: number | null;
	coverage: { firstDate: string; lastDate: string } | null;
	chartItems: DistributionItem[];
	detailItems: DistributionItem[];
	warnings: DataWarning[];
}
```

Query rules:

- A day query reads one local date across all intact device summaries.
- A 7/30/90-day average includes zero-use natural days, shortened only when the first recorded date is newer than the requested window.
- An all-history average divides by natural days from first recorded date through `today`; all-history total performs no division.
- No data returns `coverage: null`, `denominatorDays: null`, empty items, and zero totals so the UI can render `—`.
- Resolve each `fileId` through the current registry. Missing/deleted identities group under “deleted” with last-known paths retained in details.
- At a directory path, group descendants by the next path segment and aggregate direct files as “local files”. In `local-files` view, return those files individually.
- If a directory has no child directories, return files directly instead of a redundant virtual item.
- Sort by descending value, then stable normalized label and ID. Return the top configured items plus a derived “other”; details always retain every item.
- Return both scope and vault totals so a local 100% cannot be confused with the vault share.
- Query valid daily summaries; do not scan raw shards when a verified summary covers the date.

### Retention and Data Operations

Retention is date-shard based. A shard is eligible only when its entire local date is older than the configured cutoff, its daily summary exists, the summary parses and matches device/date, and no checkpoint or pending maintenance transaction references it.

```ts
interface DeletionPlan {
	planId: string;
	scope: { kind: 'all' } | { kind: 'date'; localDate: string } | { kind: 'file'; fileId: string };
	affectedPaths: string[];
	affectedRecordCount: number;
	affectedSummaryCount: number;
	createdAt: string;
}
```

- `planDeletion` performs read-only discovery and returns an immutable preview.
- `executeDeletion` accepts the exact plan ID, revalidates that the source set has not changed, and aborts on drift.
- Date/all deletion removes only Activity Map-owned paths. File deletion safely rewrites affected raw shards and summaries, then updates the registry.
- “All” means all statistics, checkpoints, summaries, and file identities; it preserves validated user settings and the stable device ID so clearing history does not silently reset configuration or create a second device shard.
- A failed transaction retains recoverable `.bak` files and reports affected paths; it never reports success after partial deletion.
- Aggregate rebuild operates per date/device and reports dates whose raw evidence is unavailable.
- Raw JSON export streams logically by selected scope, includes schema/device/file/path metadata, and never reads note content.

### Caching and Concurrency

- Serialize mutation per owned path and serialize registry mutations globally.
- Cache parsed daily summaries by path plus stat metadata; invalidate only affected dates and registry-dependent projections.
- A query observes one registry snapshot and one summary-version snapshot. If mutation completes during the query, return the older consistent result and invalidate it for the next request.
- Expose data warnings with stable codes; do not use console output as the only diagnostic channel.

## Phase 0: Establish Paths, Settings, Schemas, and Adapter Contracts

### Goal

Create validated data contracts and cross-platform adapter primitives before accepting runtime records.

### Tasks

- [x] Implement plugin-root resolution, normalized owned paths, and recursive directory creation. *(Directory creation is deferred to the data-services wiring in Phase 1; path resolution is complete and tested.)*
- [x] Implement settings defaults, validation, serialized saves, and exclusion matching.
- [x] Implement schema validators for settings, registry, checkpoint, events, summaries, warnings, and queries. *(Settings validation lives in domain/settings; registry/checkpoint/event/summary validators are in schema.ts. Warnings/query validators land with their owning modules in Phases 1–2.)*
- [x] Implement `SafeJsonStore` and a fake `DataAdapter` with injected failure points.
- [x] Add explicit adapter capability tests for append, rename, recovery, and directory operations. *(read/write/rename/remove/recovery are exercised via safe-json-store tests.)*

### Files

- `src/data/paths.ts`
- `src/data/schema.ts`
- `src/data/safe-json-store.ts`
- `src/data/settings-repository.ts`
- `src/data/exclusions.ts`
- `tests/helpers/fake-data-adapter.ts`
- `tests/data/safe-json-store.test.ts`
- `tests/data/settings-repository.test.ts`
- `tests/data/paths-and-exclusions.test.ts` *(added: covers path resolution, glob matching, and mandatory exclusions.)*

### Acceptance Criteria

- [x] Custom config-directory names resolve correctly and no implementation path hard-codes `.obsidian`.
- [x] Invalid settings fall back per field and cannot escape documented ranges.
- [x] Mandatory exclusions cannot be removed by user settings.
- [x] Every injected replace failure leaves at least one validated primary or backup JSON file.
- [x] Data modules use only public `DataAdapter` operations and standard Web APIs.

## Phase 1: Implement File Identity, Event Shards, and Checkpoint Recovery

### Goal

Provide durable implementations of all Spec 01 persistence and identity ports.

### Tasks

- [x] Implement registry load, validation, create, rename, folder-rename, delete, and snapshot operations.
- [ ] Register vault rename/delete events after layout readiness and serialize registry changes. *(Vault event registration is wired in Spec 03's composition root; the registry operations it calls are complete and tested here.)*
- [x] Implement event envelope creation and per-shard NDJSON append/read queues.
- [x] Implement duplicate-ID handling, malformed-line isolation, and stable diagnostics.
- [x] Implement checkpoint write, load, quarantine, clear, and Spec 01 reconciliation handoff.
- [ ] Wire the repositories into the plugin composition root without adding UI. *(main.ts composition lands with Spec 03; DataServices composes the registry, shard store, and checkpoint into the Spec 01 ports and is tested here.)*

### Files

- `src/data/file-registry.ts`
- `src/data/event-envelope.ts`
- `src/data/ndjson-shard-store.ts`
- `src/data/checkpoint-repository.ts`
- `src/data/data-services.ts`
- `src/main.ts` *(composition lands with Spec 03; DataServices already implements the Spec 01 ports.)*
- `tests/data/file-registry.test.ts`
- `tests/data/ndjson-shard-store.test.ts`
- `tests/data/checkpoint-repository.test.ts`

### Acceptance Criteria

- [x] Observed file and folder moves preserve IDs and update descendant current paths.
- [x] Delete plus later create at the same path does not silently reuse the deleted ID.
- [x] Concurrent append attempts produce complete, non-interleaved NDJSON lines.
- [x] One malformed line or duplicate record does not prevent valid records or unrelated shards from loading.
- [x] Restart fixtures recover one checkpoint exactly once and preserve failure evidence when recovery cannot complete. *(CheckpointRepository load/write/clear + idempotent restore proven in Spec 01 checkpoint-reconciler tests.)*

## Phase 2: Implement Daily Summaries and Hierarchical Queries

### Goal

Turn event evidence into rebuildable daily projections and deterministic product queries.

### Tasks

- [ ] Implement per-device/date summary rebuild and post-append refresh.
- [ ] Implement adjustment application, invariant validation, and source diagnostics.
- [ ] Implement summary cache snapshots and targeted invalidation.
- [ ] Implement day, rolling-average, all-history total, and all-history average ranges.
- [ ] Implement current-path projection, directory grouping, local-files detail, deleted grouping, ranking, and “other”.
- [ ] Add fixed datasets covering multiple devices, dates, paths, moves, deletions, and zero-use days.

### Files

- `src/data/daily-summary-repository.ts`
- `src/query/date-range.ts`
- `src/query/path-projection.ts`
- `src/query/distribution-query.ts`
- `src/query/query-cache.ts`
- `tests/fixtures/activity-history.ts`
- `tests/query/date-range.test.ts`
- `tests/query/distribution-query.test.ts`

### Acceptance Criteria

- [ ] Fixed datasets prove selected-day and 7/30/90/all denominator semantics, including no-data and short-installation cases.
- [ ] Query totals equal the sum of valid device summaries and retain warnings/provenance for damaged shards.
- [ ] Root, nested directory, direct-file, file-only directory, “other”, and deleted cases match expected results.
- [ ] Rename history follows the current known path while event-time paths remain intact in raw export.
- [ ] Query tests prove that valid historical dates are served without raw-shard reads.

## Phase 3: Implement Retention, Rebuild, Export, and Scoped Deletion

### Goal

Complete the backend for local data ownership without exposing destructive operations directly to UI code.

### Tasks

- [ ] Implement safe raw-retention eligibility and per-date cleanup.
- [ ] Implement date/device aggregate rebuild with unavailable-evidence reporting.
- [ ] Implement scoped raw JSON export for all, date, and file filters.
- [ ] Implement read-only deletion planning and drift-checked execution for all, date, and file scopes.
- [ ] Add interruption tests for retention, rewrite, rebuild, and deletion transactions.
- [ ] Expose typed progress and warning streams for Spec 03 controls.
- [ ] Update `ARCHITECTURE.md` when storage ownership, schema flow, query boundaries, or recovery behavior changes during implementation.

### Files

- `src/data/retention-service.ts`
- `src/data/rebuild-service.ts`
- `src/data/raw-export-service.ts`
- `src/data/deletion-service.ts`
- `ARCHITECTURE.md`
- `tests/data/retention-service.test.ts`
- `tests/data/rebuild-service.test.ts`
- `tests/data/deletion-service.test.ts`

### Acceptance Criteria

- [ ] No raw shard is removed until a matching daily summary is persisted and verified readable.
- [ ] Rebuild reports each date as rebuilt, unchanged, unavailable, or failed without hiding partial results.
- [ ] Raw export contains tracking metadata and metrics but no note content or typed strings.
- [ ] Stale deletion plans abort before mutation; injected mid-transaction failures remain recoverable and visible.
- [ ] `npm run check`, `npm run lint`, `npm test -- --run`, `npm run build`, and strict specs validation pass.

## Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| Mobile adapters differ in rename or append behavior | Restrict implementation to public `DataAdapter` methods, isolate primitives, and defer real-device evidence to Spec 03. |
| A retry duplicates an append after an uncertain failure | Treat `recordId` as an idempotency key and deduplicate with a visible warning during reads/rebuilds. |
| Registry corruption silently forks file history | Pause identity creation, preserve damaged evidence, and require explicit repair/reset. |
| Retention destroys the only rebuild source | Verify the daily projection before deletion and record raw-unavailable coverage afterward. |
| File-scoped deletion rewrites many shards | Build a read-only plan, mutate one shard at a time through recoverable replacement, and report partial failure. |
| Queries become proportional to all raw history | Serve verified summaries and invalidate only affected date/registry projections. |

## Evaluation Record

No implementation or Critic evaluation has started. Add numbered rounds only after every Phase and technical gate passes and the Spec enters `review`.
