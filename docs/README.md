# Documentation index

How documentation in this repo is classified and where to start. See
[documentation principles](documentation-principles.md) for how to write and
maintain it, distinguish promises from descriptions, and improve it incrementally.

## Entry points

- **Getting started:** [README.md](../README.md) covers the app, modes, and local
  workflow. Use [architecture.md](architecture.md) for the system map.
- **Agent tasks:** [AGENTS.md](../AGENTS.md#2-orientation-and-task-routing) owns
  orientation and task routing. Use the entries below to select relevant
  material; this index adds no second mandatory reading sequence.
- **Intent and boundaries:** [STABILITY_FRONTIER.md](../STABILITY_FRONTIER.md)
  summarizes safe architectural assumptions and unsettled decisions;
  [SPECS/README.md](../SPECS/README.md) routes to product and feature contracts.

Reading order helps navigation; it does not rank truth or resolve conflicts.
The separate human and agent entry points share the same owning explanations.

## Doc classes

| Class | Location | Use when |
| --- | --- | --- |
| **Architectural boundary** | `STABILITY_FRONTIER.md` | Understanding safe assumptions, preserved constraints, and decisions requiring human guidance |
| **Canonical product** | `SPECS/learning-review-model.md`, `session-covering-criteria.md`, `study-action-model.md`, `session-reflection-generation.md`, `reflection-proposals-and-handles.md` | Changing user-visible study or reflection behavior |
| **Implementation descriptions and maps** | `docs/architecture.md`, `docs/api.md`, `docs/server-db.md`, `SPECS/frontend-architecture-map.md`, feature guides | Understanding how the system works today, including mechanisms, limitations, and code navigation |
| **Accepted architecture contracts** | `docs/private-beta-service-boundary.md` | Building the hosted private-beta service boundary and steel thread |
| **Plans** | `PLANS/`, milestone slices in `SPECS/` | Dated sequencing and rationale; verify current applicability rather than infer unfinished work from a label |
| **Completed / historical** | `SPECS/archive/`, completed plans retained in `PLANS/` | Context only; not authoritative for current behavior |
| **Vision / strategic context** | `docs/vision/`, `SPECS/adaptive_vocabulary_training_product_notes.md` | Long-term direction and hypotheses; not implementation contracts or a current task catalog |
| **Operations** | `docs/ops/`, `SPECS/study-db-setup.md` | Local setup and data workflows |
| **Working memory** | `notes/active/` | Cross-thread context, research, multi-day work bundles (days–weeks; not authoritative or live task state) |
| **Archived working memory** | `notes/archive/` | Retired working notes retained for context only; not part of the default agent reading path |

These classes describe document roles; a document can serve several when its
sections distinguish intended guarantees, current implementation, and rationale.
Task instructions supply execution scope. Specs describe intended behavior; code
determines actual behavior and tests show what is checked. Surface consequential
conflicts instead of silently choosing a source or rewriting a promise to match
the code. Correct stale descriptions within scope; report unresolved discrepancies.
Historical plans and vision documents do not assign current work. The principles
are a target for incremental improvement, not a certification of this corpus.

## Companion maps

- [architecture.md](./architecture.md) — frontend/backend boundaries and data flow
- [api.md](./api.md) — HTTP route index by domain
- [testing.md](./testing.md) — test files mapped to domains
- [server-db.md](./server-db.md) — `server/db/` module map
- [word-introduction-in-app.md](./word-introduction-in-app.md) — shared preparation, private package pins, and early learning
- [word-introduction-lab.md](./word-introduction-lab.md) — local bootstrap, teaching, and rehearsal prototype
- [structured-review-content.md](./structured-review-content.md) — bootstrap-backed review and canonical storage for new reflection content
- [word-content-model.md](./word-content-model.md) — executable bootstrap/teaching model checkpoint, synthetic fixture report, and review compatibility boundary
- [scripts.md](./scripts.md) — maintenance scripts catalog
- [ops/schema-migrations.md](./ops/schema-migrations.md) — explicit offline migrations, baseline adoption, and migration authoring
- [ops/hosted-beta-deployment.md](./ops/hosted-beta-deployment.md) — invite, upgrade, maintenance, backup, restore, and human/agent release procedures
- [ops/hosted-observability.md](./ops/hosted-observability.md) — private Fly/Grafana performance dashboard and metrics runbook
- [ops/error-diagnostics.md](./ops/error-diagnostics.md) — current error surfaces, retention/privacy boundaries, incident correlation, and operator triage
- [reflection-frontend-architecture.md](./reflection-frontend-architecture.md) — feature-specific session-finalization, evidence, and review-UI map

- [content-quality.md](./content-quality.md) — in-session thumbs, exact content identity, and operator triage

## Development and review workflows

- [documentation-principles.md](documentation-principles.md) — readable models, promises and descriptions, incremental maintenance, and future custodial work
- [stacked-feature-development-and-review.md](./stacked-feature-development-and-review.md) — default proportional implementation delivery and review model; it scales from one PR to a Graphite stack
- [hosted-beta-implementation-steel-thread.md](../PLANS/hosted-beta-implementation-steel-thread.md) — historical implementation sequence and release/recovery proof context

## Other root docs

- [README.md](../README.md) — human getting started, modes, data layout
- [STABILITY_FRONTIER.md](../STABILITY_FRONTIER.md) — architectural assumptions and decision boundaries
- Linear — issue intake and retrieval; incomplete bookkeeping, not an exhaustive account of current work. See [AGENTS.md §11](../AGENTS.md#11-project-context-and-task-scope) for task and steward context.
- [CHANGELOG.md](../CHANGELOG.md) — casual release notes for users
- [notes/README.md](../notes/README.md) — medium-lived working memory for cross-thread context
