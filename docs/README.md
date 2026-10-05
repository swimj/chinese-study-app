# Documentation index

How documentation in this repo is classified and where to start.

## Reading order for agents

1. [AGENTS.md](../AGENTS.md) — runbook, conventions, task routing
2. [STABILITY_FRONTIER.md](../STABILITY_FRONTIER.md) — safe architectural assumptions, invariants, and unsettled decisions
3. [SPECS/README.md](../SPECS/README.md) — product spec index
4. Canonical specs (intended behavior; surface conflicts with instructions or code):
   - [SPECS/learning-review-model.md](../SPECS/learning-review-model.md)
   - [SPECS/session-covering-criteria.md](../SPECS/session-covering-criteria.md)
   - [SPECS/study-action-model.md](../SPECS/study-action-model.md)
   - [SPECS/session-reflection-generation.md](../SPECS/session-reflection-generation.md)
   - [SPECS/reflection-proposals-and-handles.md](../SPECS/reflection-proposals-and-handles.md)
5. [architecture.md](./architecture.md) — system map (navigation only)
6. [private-beta-service-boundary.md](./private-beta-service-boundary.md) — accepted hosted-beta ownership, identity, persistence, release, and trust contract
7. [hosted-dogfood-shared-trial-policy.md](./hosted-dogfood-shared-trial-policy.md) — one-time shared-trial backfill used at the hosted dogfood cutover
8. Relevant tests — see [testing.md](./testing.md)

## Doc classes

| Class | Location | Use when |
| --- | --- | --- |
| **Architectural boundary** | `STABILITY_FRONTIER.md` | Understanding safe assumptions, preserved constraints, and decisions requiring human guidance |
| **Canonical product** | `SPECS/learning-review-model.md`, `session-covering-criteria.md`, `study-action-model.md`, `session-reflection-generation.md`, `reflection-proposals-and-handles.md` | Changing user-visible study or reflection behavior |
| **Architecture maps** | `docs/architecture.md`, `docs/api.md`, `docs/server-db.md`, `SPECS/frontend-architecture-map.md` | Finding code; must stay in sync with implementation |
| **Accepted architecture contracts** | `docs/private-beta-service-boundary.md` | Building the hosted private-beta service boundary and steel thread |
| **Plans** | `PLANS/`, milestone slices in `SPECS/` | Dated sequencing and rationale; verify current applicability rather than infer unfinished work from a label |
| **Completed / historical** | `SPECS/archive/`, completed plans retained in `PLANS/` | Context only; not authoritative for current behavior |
| **Vision / strategic context** | `docs/vision/`, `SPECS/adaptive_vocabulary_training_product_notes.md` | Long-term direction and hypotheses; not implementation contracts or a current task catalog |
| **Operations** | `docs/ops/`, `SPECS/study-db-setup.md` | Local setup and data workflows |
| **Working memory** | `notes/active/` | Cross-thread context, research, multi-day work bundles (days–weeks; not authoritative or live task state) |
| **Archived working memory** | `notes/archive/` | Retired working notes retained for context only; not part of the default agent reading path |

Task instructions supply execution scope. Specs describe intended behavior; code
and tests provide implementation evidence. Surface consequential conflicts instead
of silently choosing a source. Correct stale maps within scope; report unresolved
discrepancies. Historical plans and vision documents do not assign current work.

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
- [ops/hosted-release-candidate.md](./ops/hosted-release-candidate.md) — restore-backed Fly RC deploys, manual acceptance, quiesce/idle/activate, and exact-image promotion
- [ops/hosted-observability.md](./ops/hosted-observability.md) — private Fly/Grafana performance dashboard and metrics runbook
- [ops/error-diagnostics.md](./ops/error-diagnostics.md) — current error surfaces, retention/privacy boundaries, incident correlation, and operator triage
- [reflection-frontend-architecture.md](./reflection-frontend-architecture.md) — feature-specific session-finalization, evidence, and review-UI map

- [content-quality.md](./content-quality.md) — in-session thumbs, exact content identity, and operator triage

## Development and review workflows

- [stacked-feature-development-and-review.md](./stacked-feature-development-and-review.md) — default proportional implementation delivery and review model; it scales from one PR to a Graphite stack
- [hosted-beta-implementation-steel-thread.md](../PLANS/hosted-beta-implementation-steel-thread.md) — historical implementation sequence and release/recovery proof context

## Other root docs

- [README.md](../README.md) — human getting started, modes, data layout
- [STABILITY_FRONTIER.md](../STABILITY_FRONTIER.md) — architectural assumptions and decision boundaries
- Linear — issue intake and retrieval; incomplete bookkeeping, not an exhaustive account of current work. See [AGENTS.md §11](../AGENTS.md#11-project-context-and-task-scope) for task and steward context.
- [CHANGELOG.md](../CHANGELOG.md) — casual release notes for users
- [notes/README.md](../notes/README.md) — medium-lived working memory for cross-thread context
