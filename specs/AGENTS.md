# Activity Map Specs Instructions

## Authority and Reading Order

For every specs task, read sources in this order:

1. `constitution/` for stable product, data, privacy, and technical decisions.
2. `../docs/PRD.md` for user-facing requirements and release acceptance.
3. `ROADMAP.md` for version outcomes and version status.
4. The single relevant file in `active/` for the current implementation delta.
5. `research/` only when the task depends on evidence or an unresolved question.

When sources conflict, update the highest-authority changed decision first and synchronize all downstream documents in the same change.

## Project Invariants

- Attribute time only to a trackable file in the foreground Obsidian window; never allow concurrent attribution to multiple files.
- Cut confirmed idle and sleep intervals back to the last trusted activity signal.
- Keep per-file identity and event-time paths without modifying note frontmatter or content.
- Keep settings separate from sharded time-series data; preserve raw evidence until its aggregate is durable.
- Keep all product data local by default. Do not add telemetry, accounts, or network upload without a new Constitution decision.
- Keep the core cross-platform and capability-gate any desktop-only enhancement.
- Do not claim activity tracking, aggregation, mobile support, or export is implemented when only the repository skeleton exists.

## Naming and Lifecycle

- Active Specs use `NN-kebab-case-plan.md`.
- Research uses `YYYY-MM-DD-kebab-case-research.md`.
- Constitution decisions use `YYYY-MM-DD-kebab-case.md`.
- Active Spec statuses are `in-progress`, `review`, `completed`, and `cancelled`.
- Move completed or cancelled Specs to `archive/` after recording the final Critic verdict and updating every inbound link.
- Execute one Active Spec at a time unless the user explicitly requests a batch.
- Follow `$spec-driven-delivery` for document contracts, phase execution, and the bounded independent Critic loop.

## Required Synchronization

- User-visible behavior: update `../docs/PRD.md`, `../README.md`, and the related Roadmap version.
- Stable product or data boundary: update Constitution before code or Active Spec projections.
- Public interface, event schema, storage layout, or directory responsibility: update the owning Constitution heading and affected Specs.
- Spec completion or archive move: update all Roadmap, Constitution, Research, docs, and Spec links in the same change.

## Validation

Run the following gates before a Spec enters `review`:

```bash
npm run check
npm run lint
npm run build
python3 "${SPEC_DRIVEN_DELIVERY_DIR:?set SPEC_DRIVEN_DELIVERY_DIR}/scripts/validate_specs_workspace.py" . --strict
```

Also verify repository-relative Markdown links and inspect `git diff --check`. Record the exact commands and results in the Active Spec. The validator is a baseline; feature Specs must add focused unit, integration, failure, and user-journey gates.
