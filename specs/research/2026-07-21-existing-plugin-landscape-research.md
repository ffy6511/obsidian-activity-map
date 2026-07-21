# Existing Obsidian Activity Plugin Landscape Research

## Metadata

| Field | Value |
| --- | --- |
| Created | 2026-07-21 |
| Area | technology-evaluation |
| Related specs | [Tracking runtime](../active/01-activity-tracking-runtime-plan.md), [Local data and query](../active/02-local-data-and-query-plan.md), [UI and v0.1 release](../active/03-activity-map-ui-and-v0-1-release-plan.md) |
| Status | concluded |

## Question

Determine whether an existing open-source Obsidian plugin already satisfies Activity Map's foreground activity semantics, hierarchical time visualization, local data requirements, idle recovery, extensible metrics, and SVG export. Identify implementation evidence worth carrying into the independent project.

## Method

The review covered the Obsidian community plugin index, public repository documentation, licenses, repository metadata, and relevant implementation files. Product claims were separated from observed code behavior. The official [Obsidian sample plugin](https://github.com/obsidianmd/obsidian-sample-plugin) was also inspected as the repository scaffold reference; the foundation used upstream commit `23c165fd362d4049330cb3edad6a52914ff2007a` as its reproducible baseline.

## Findings

### No Existing Plugin Covers the Full Product Contract

| Project | Useful evidence | Missing or conflicting behavior | License |
| --- | --- | --- | --- |
| [Focus Time](https://github.com/astradev123/obsidian-focus-time) | Per-file totals, day/month/year/all-time dashboard, daily JSON files | Periodic accumulation checks window focus but lacks keyboard/pointer idle semantics, hierarchical donut navigation, daily-average definition, and SVG export | Apache-2.0 |
| [Vault Time Tracker](https://github.com/rafaelmehdiyev/obsidian-vault-time-tracker) | Daily per-file totals, sessions, sidebar, idle clipping, rename handling, JSON export, tests | Intentionally keeps timing when another app is foreground; system-idle integration is Electron-specific; long-term totals live in one `data.json` | MIT |
| [Visit History](https://github.com/nickolay-kondratyev/obsidian-visit-history-plugin) | Multi-window focus, keyboard/pointer/wheel/touch activity, 180-second idle default, delayed-timer sleep clipping, directory treemap | Treemap area represents file size and color represents recency rather than activity share; data appears in the vault; document IDs are written into files | KSAL-2.3, source-available |
| [Effort Index](https://github.com/israerusan/effort-index) | Separate editing bursts and dwell time, append-only signals, delayed burst settlement | Targets effort/forgetting analysis and does not provide daily hierarchical time distribution or the required product UI | MIT |
| [ActivityWatch watcher](https://github.com/LordGrimmauld/aw-watcher-obsidian) | Publishes vault and active-file state to local ActivityWatch | Requires an external service and dashboard; does not provide the in-Obsidian product experience | MIT |
| [WakaTime / Wakapi](https://github.com/Kovah/obsidian-wakatime) | File heartbeats, directory-to-project mapping, self-hosted Wakapi option | Depends on an external API and dashboard and does not implement the local hierarchical UI | MIT |
| [Typing Stats](https://github.com/ryyHardy/obsidian-typing-stats) | Input bursts, added/deleted character counts, WPM, daily history | Content-diff growth cannot establish trusted physical or UI input and does not resolve every switch, idle, or agent-edit boundary | GPL-3.0 |

The products overlap with individual Activity Map requirements, but none combines the accepted attribution rules, data ownership, folder drill-down, extensible metric semantics, mobile viewer, and SVG export. Forking one would require replacing its core session, storage, and presentation contracts.

### Idle Confirmation Must Clip to the Last Activity Signal

Vault Time Tracker and Visit History both demonstrate that an idle timer callback cannot define the session endpoint. The callback may run late because of browser throttling or system sleep. A trustworthy tracker stores the last signal time and settles the session there once the idle condition is known.

This observation supports the Constitution invariant that confirmed idle and sleep intervals cannot remain inside a closed session.

### Multi-Window Attribution Needs Window Identity

Obsidian can place leaves in pop-out windows. A listener attached only to the main global `window` cannot distinguish a focused pop-out from a background main window. The tracking coordinator needs the active leaf's owning document/window identity and must reconcile focus across registered windows before selecting one target.

### Settings and Time-Series Data Need Different Persistence Boundaries

The official sample plugin demonstrates `Plugin.loadData()` and `saveData()` for settings stored in `data.json`. Focus Time splits activity by date. Effort Index uses append-oriented signals and derived state. Visit History separates some data by device and document.

Together these observations support a small settings file plus per-device, per-date raw shards and rebuildable summaries. The research does not establish that one library or precise file-writing primitive is portable; each implementation Spec must verify the relevant Obsidian `DataAdapter` behavior on desktop and mobile.

### Native SVG Matches Interaction and Export Requirements

The donut chart must support hover, focus, click, stable semantic labels, and standalone SVG export. Native SVG preserves vector paths and accessibility nodes across both the live interface and exported artifact. A Canvas implementation would require a second rendering and accessibility layer without providing a product benefit for this scope.

### Source Reuse Must Follow License Boundaries

MIT and Apache-2.0 repositories can inform implementation and tests subject to attribution obligations. Visit History's KSAL-2.3 source is useful for behavioral study but is not a permissive code source. Typing Stats is GPL-3.0 and cannot be copied into an MIT plugin without changing distribution obligations. The foundation therefore starts from the official Obsidian sample rather than a feature plugin.

## Conclusion and Recommendation

Proceed with the independent `obsidian-activity-map` repository. Use the official Obsidian sample plugin for build and release conventions, and use existing trackers as behavioral evidence for tests and failure cases. Keep accepted cross-version boundaries in the [Product and Data Decisions](../constitution/2026-07-21-activity-map-product-and-data.md#final-decision); do not import another plugin's event semantics wholesale.

## Open Questions

No unresolved question blocks the repository foundation. Feature Specs must still verify the following implementation details before claiming their related Roadmap deliverables:

- Cross-platform `DataAdapter` append and recoverable-replacement behavior is verified in [Spec 02 Phase 0](../active/02-local-data-and-query-plan.md#phase-0-establish-paths-settings-schemas-and-adapter-contracts) and the real-device journey in Spec 03.
- Public API coverage and degradation behavior for per-view header actions is verified in [Spec 03 Phase 2](../active/03-activity-map-ui-and-v0-1-release-plan.md#phase-2-implement-file-header-status-and-interactive-summary-popover).
- Mobile viewing and available platform capabilities are verified in [Spec 03 Phase 4](../active/03-activity-map-ui-and-v0-1-release-plan.md#phase-4-complete-automated-accessibility-platform-integration-and-release-candidate-evidence).
- Reliable reconciliation options for file moves that occur while Obsidian is closed.
