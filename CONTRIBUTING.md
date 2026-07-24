# Contributing to Activity Map

Contributions that improve trustworthy, local-first activity insights are welcome.

## Before You Start

Open an issue before beginning a large feature, data-model change, or behavior change. Keep pull requests focused on one purpose and avoid unrelated refactors.

## Development

Requirements: Node.js 20.11+ and npm.

```bash
npm install
npm run check
npm run lint
npm test -- --run
npm run build
git diff --check
```

Change source files under `src/`; do not edit generated `main.js`. Add focused tests for meaningful behavior and failure paths. Verify UI or Obsidian API changes in a real Obsidian environment when practical, and distinguish that result from fixture tests.

## Project Boundaries

- Preserve the local-first privacy model: do not add telemetry, accounts, network upload, note-content capture, selected-text capture, or typed-string storage without an approved product decision.
- Keep TypeScript strict and preserve module boundaries described in `ARCHITECTURE.md`.
- Update relevant tests and user-facing documentation when behavior changes.
- Follow the repository's `AGENTS.md` and `specs/AGENTS.md` instructions for spec-scoped work.

## Pull Requests

Use the pull request template and describe the user-visible outcome, implementation scope, and validation evidence. Link the related issue when one exists. Do not include generated bundles, user data, credentials, or unrelated formatting changes.
