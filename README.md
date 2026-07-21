# Activity Map

Activity Map is a local-first Obsidian plugin for measuring trustworthy activity time per file and exploring it through a folder hierarchy.

## Project Status

The repository contains composed tracking, local persistence, maintenance, hierarchical queries, settings, commands, and an immutable presentation controller with deterministic automated tests. The current installable build records activity and maintains daily summaries, while its Activity Map view remains a bootstrap status surface. Charts, file-header UI, SVG export, data-control dialogs, and real Obsidian acceptance remain in progress.

Treat this as a development build until the complete UI and real Obsidian journeys pass. Follow the [Roadmap](specs/ROADMAP.md) for release acceptance status.

## Product Direction

The planned first release will provide:

- foreground-only activity attribution for vault files;
- idle clipping and explicit recovery corrections;
- selected-day, rolling daily-average, and all-history queries;
- hierarchical folder drill-down with file-level details;
- a low-distraction header entry and dockable full view;
- local data controls and standalone SVG export;
- complete desktop behavior and a mobile view path without hover.

The complete requirements and stable data decisions are documented in:

- [Product Requirements](docs/PRD.md)
- [Product and Data Decisions](specs/constitution/2026-07-21-activity-map-product-and-data.md)
- [Architecture](ARCHITECTURE.md)
- [Existing Plugin Research](specs/research/2026-07-21-existing-plugin-landscape-research.md)

## Development

Contributors and coding agents should read [Repository Instructions](AGENTS.md) and the relevant current/target boundary in [Architecture](ARCHITECTURE.md) before changing source or Specs.

Requirements:

- Node.js 20.11 or newer
- npm

Install dependencies and run the repository gates:

```bash
npm install
npm run check
npm run lint
npm run build
```

For watch mode:

```bash
npm run dev
```

The build writes `main.js` at the repository root. The generated bundle is intentionally ignored and should be attached to releases rather than committed.

## Development Installation

After `npm run build`, copy the following files into `<vault-config-dir>/plugins/activity-map/`:

```text
main.js
manifest.json
styles.css
```

Reload Obsidian, disable Restricted Mode if appropriate for the development vault, and enable Activity Map under Community plugins. The current build begins local tracking after settings and checkpoint recovery, and opens a bootstrap Activity Map status view.

## Repository Structure

```text
.
├── AGENTS.md      Repository-wide engineering and writing rules
├── ARCHITECTURE.md Current skeleton and approved v0.1 target architecture
├── docs/          Product requirements and UX contract
├── specs/         Constitution, Roadmap, Research, Active Specs, and review evidence
├── src/           TypeScript plugin source
├── manifest.json  Obsidian plugin metadata
└── styles.css     Plugin-owned styles
```

## Privacy

The product is local-only and does not include telemetry, accounts, or content upload. It stores activity metadata and metrics in the plugin data directory without reading note text, selected text, or typed strings.

## License

[MIT](LICENSE)
