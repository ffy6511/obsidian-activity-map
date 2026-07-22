# Activity Map

Activity Map is a local-first Obsidian plugin for measuring trustworthy activity time per file and exploring it through a folder hierarchy.

## Project Status

The repository contains composed tracking, local persistence, maintenance, hierarchical queries, settings, commands, dockable statistics, SVG/JSON export, rebuild, and scoped deletion. The file-header entry renders the actual today/vault-root distribution as stable miniature slices; its pinnable popover updates trusted live values in place, preserves highlight state, exposes pause/resume and direct date selection, and uses a `3:2` donut/list layout with bounded list-only scrolling. File leaves show their basename while retaining the full path for activation. Controlled-clock, fake-adapter, accessibility-source, privacy-source, XML, and bundle checks cover the technical candidate; final real Obsidian desktop/mobile acceptance remains pending.

Treat this as a development build until the complete UI and real Obsidian journeys pass. Follow the [Roadmap](specs/ROADMAP.md) for release acceptance status.

## Product Direction

The planned first release will provide:

- foreground-only activity attribution for vault files;
- idle clipping and explicit recovery corrections;
- selected-day, rolling daily-average, and all-history queries;
- hierarchical folder drill-down with file-level details;
- a stable multi-slice header mini donut, `3:2` pinnable chart/list popover, and dockable full view;
- local data controls and standalone SVG export;
- complete desktop behavior and a mobile view path without hover.

The complete requirements and stable data decisions are documented in:

- [Product Requirements](docs/PRD.md)
- [Product and Data Decisions](specs/constitution/2026-07-21-activity-map-product-and-data.md)
- [Architecture](ARCHITECTURE.md)
- [Existing Plugin Research](specs/research/2026-07-21-existing-plugin-landscape-research.md)
- [v0.1.0 Release Notes](RELEASE_NOTES.md)

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
npm test -- --run
npm run build
git diff --check
```

For watch mode:

```bash
npm run dev
```

The build writes `main.js` at the repository root. The generated bundle is intentionally ignored and should be attached to releases rather than committed.

Strict Spec validation additionally requires `SPEC_DRIVEN_DELIVERY_DIR` to point at the installed `spec-driven-delivery` skill, then runs `python3 "$SPEC_DRIVEN_DELIVERY_DIR/scripts/validate_specs_workspace.py" . --strict`.

## Development Installation

After `npm run build`, copy the following files into `<vault-config-dir>/plugins/activity-map/`:

```text
main.js
manifest.json
styles.css
```

Reload Obsidian, disable Restricted Mode if appropriate for the development vault, and enable Activity Map under Community plugins. The current build begins local tracking after settings and checkpoint recovery. Use the Ribbon, command palette, or an eligible file-header status action to open the Activity Map view; export, rebuild, and previewed deletion controls are available inside the full view.

## Repository Structure

```text
.
├── AGENTS.md      Repository-wide engineering and writing rules
├── ARCHITECTURE.md Current skeleton and approved v0.1 target architecture
├── RELEASE_NOTES.md Verified v0.1 capability and acceptance boundary
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
