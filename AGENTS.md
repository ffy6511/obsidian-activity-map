# Activity Map Repository Instructions

These instructions apply to the entire repository. Files under `specs/` must also follow `specs/AGENTS.md`.

## Project State

Activity Map currently contains a buildable Obsidian plugin skeleton and three implementation-ready `v0.1` Active Specs. The shipped source still provides only an empty Activity Map view, Ribbon action, and command.

- Do not describe tracking, persistence, queries, charts, mobile support, or export as implemented until the owning Spec records evidence.
- Planning or documentation work does not move a Spec to `review` and does not start a Critic.
- Implement one Active Spec at a time in dependency order unless the user explicitly selects a different safe scope.

## Required Reading

Read only the documents relevant to the task, in this authority order:

1. `specs/constitution/2026-07-21-activity-map-product-and-data.md` — stable product, data, privacy, and platform decisions.
2. `docs/PRD.md` — user-facing requirements, terminology, UX, and release acceptance.
3. `ARCHITECTURE.md` — current and target code boundaries, dependency direction, and runtime/data flow.
4. `specs/ROADMAP.md` — version outcomes and release status.
5. The selected file in `specs/active/` — local implementation delta, phases, tests, and evidence.
6. `specs/research/` — evidence and open questions when the task depends on them.

For specs work, read `specs/AGENTS.md` and follow `$spec-driven-delivery`. When documents conflict, stop the conflicting change, update the highest-authority changed source first, and synchronize downstream projections in the same change.

## Repository Boundaries

- `src/main.ts` is the composition root. Keep domain, tracking, data, query, UI, and export logic in their owned modules as defined by `ARCHITECTURE.md`.
- Keep dependency direction inward toward pure domain contracts. UI must not mutate raw persistence directly, and persistence must not depend on presentation.
- Use public Obsidian APIs and standard Web APIs. Capability-gate any platform enhancement and keep `isDesktopOnly: false` unless Constitution changes first.
- Never hard-code `.obsidian`; resolve the configured vault directory and normalize adapter paths.
- Do not edit generated `main.js`. Change `src/`, then rebuild.
- Do not add telemetry, accounts, network upload, note-content capture, selected-text capture, or typed-string storage without an explicit Constitution decision.
- Preserve user notes and frontmatter. Internal file identity belongs to plugin data.

## TypeScript and Module Style

- Keep TypeScript strict. Do not weaken compiler or lint settings to make a change pass.
- Prefer narrow modules with one owner and explicit inputs/outputs. Avoid a generic `utils.ts` dumping ground.
- Use discriminated unions for lifecycle states and event kinds; make impossible states unrepresentable where practical.
- Validate persisted or external data at the boundary before converting it to trusted domain types.
- Keep time, UUID, storage, and platform behavior behind injectable interfaces so deterministic tests can replace them.
- Serialize stateful writes and transitions explicitly. Do not rely on callback arrival order.
- Handle rejected promises at the owning boundary and expose actionable failure state; do not silently continue after possible data loss.
- Use Obsidian lifecycle helpers such as `registerEvent`, `registerDomEvent`, and `registerInterval` when available.
- Keep plugin-owned DOM scoped under stable `activity-map-` classes and use Obsidian CSS variables.

## Comments and Explanations

Comments must preserve reasoning that the type system and code structure cannot express. Explain the invariant, failure boundary, or API limitation; avoid narrating obvious syntax.

Add or update clear comments for:

- state-machine transitions whose ordering affects attribution;
- wall-clock versus monotonic-time calculations, idle rollback, midnight splitting, and delayed timers;
- serialized queues, idempotency keys, recovery checkpoints, and partial-failure handling;
- destructive data operations and the condition that makes deletion safe;
- schema/version compatibility and rejected invalid data;
- Obsidian lifecycle workarounds, capability detection, and fallback behavior;
- SVG escaping, focus management, and accessibility behavior that is easy to regress.

Good comment:

```ts
// Timer callbacks can run after system sleep. Settle at the last trusted
// activity sample so the delayed callback cannot turn the sleep gap into work.
closeSession(lastTrustedActivity);
```

Avoid comments that only repeat the statement:

```ts
// Close the session.
closeSession(lastTrustedActivity);
```

Use TSDoc for exported contracts when callers need to understand units, ownership, idempotency, mutation, or failure semantics. When complex logic changes, update its explanatory comment and the corresponding `ARCHITECTURE.md` section in the same change.

## Tests and Evidence

- Every important branch and failure semantic in an Active Spec needs a focused test.
- Use fake clocks and fake adapters for deterministic time, concurrency, recovery, and data-loss tests.
- Keep unit, integration-fixture, and real Obsidian evidence distinct. Fixture success cannot satisfy a named desktop or mobile acceptance journey.
- Test negative paths: background windows, untrusted events, corrupt records, duplicate IDs, interrupted writes, stale deletion plans, missing files, unavailable capabilities, and teardown.
- Do not mark a Phase complete while a child task, acceptance checkbox, documentation update, or required gate remains open.

Run the applicable gates:

```bash
npm run check
npm run lint
npm test -- --run    # once the selected Spec introduces the test script
npm run build
python3 "${SPEC_DRIVEN_DELIVERY_DIR:?set SPEC_DRIVEN_DELIVERY_DIR}/scripts/validate_specs_workspace.py" . --strict
git diff --check
```

For documentation-only work, run strict specs validation and verify every repository-relative Markdown link and heading fragment. Run code gates when documentation changes package, manifest, build, or source claims.

## Documentation Style

- Lead with the decision, behavior, or result.
- Use nested headings with meaningful hierarchy and concise titles.
- Use repository-relative links in tracked files; do not embed machine-specific absolute paths.
- Keep PRD content user-facing, Constitution content stable, Architecture content structural, Roadmap content version-level, and Active Specs implementation-local.
- Mark planned and implemented architecture separately. Never present a target directory tree as current code.
- Use fenced code blocks for trees, flows, state diagrams, schemas, and examples. Add short inline annotations where they improve understanding.
- Update README after entrypoints, development commands, installation, or verified product capability changes.
- Update `ARCHITECTURE.md` after module ownership, dependency direction, startup/shutdown order, schema flow, or platform boundaries change.
- Update the owning Active Spec and its evidence whenever implementation changes an interface or failure contract.

## Data Safety and Git Hygiene

- Preserve unrelated staged, unstaged, and untracked user work.
- Do not commit, push, publish, or create a release unless the user asks.
- Do not delete or rewrite user data through a development command. Use isolated fixtures or a dedicated test vault.
- Keep runtime data, dependencies, and generated bundles ignored.
- Before destructive operations, resolve the exact Activity Map-owned targets and require the confirmation semantics defined by the selected Spec.
- Report validation limits and open checkboxes honestly; do not convert planned, mocked, or fixture-only behavior into completion claims.
