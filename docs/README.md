# Documentation index

How documentation in this repo is classified and where to start.

## Reading order for agents

1. [AGENTS.md](../AGENTS.md) — runbook, conventions, task routing
2. [STABILITY_FRONTIER.md](../STABILITY_FRONTIER.md) — how to use and maintain the current build-wave boundary
3. [SPECS/README.md](../SPECS/README.md) — product spec index
4. Canonical specs (behavior changes must align here):
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
| **Current operating contract** | `STABILITY_FRONTIER.md` | Understanding what the current build wave may assume, what remains blocking, and when human guidance is required |
| **Canonical product** | `SPECS/learning-review-model.md`, `session-covering-criteria.md`, `study-action-model.md`, `session-reflection-generation.md`, `reflection-proposals-and-handles.md` | Changing user-visible study or reflection behavior |
| **Architecture maps** | `docs/architecture.md`, `docs/api.md`, `docs/server-db.md`, `SPECS/frontend-architecture-map.md` | Finding code; must stay in sync with implementation |
| **Accepted architecture contracts** | `docs/private-beta-service-boundary.md` | Building the hosted private-beta service boundary and steel thread |
| **Active plans** | Active entries in `PLANS/`, open milestone slices in `SPECS/` | Planned work not yet done |
| **Completed / historical** | `SPECS/archive/`, completed plans retained in `PLANS/` | Context only; not authoritative for current behavior |
| **Vision / strategic context** | `docs/vision/`, `SPECS/adaptive_vocabulary_training_product_notes.md` | Long-term direction and hypotheses; not implementation contracts or a current task catalog |
| **Operations** | `docs/ops/`, `SPECS/study-db-setup.md` | Local setup and data workflows |
| **Working memory** | `notes/active/` | Cross-thread context, research, multi-day work bundles (days–weeks; not authoritative or live task state) |
| **Archived working memory** | `notes/archive/` | Retired working notes retained for context only; not part of the default agent reading path |

When a map doc and code disagree, fix the map in the same change as the code (or file a follow-up immediately).

## Companion maps

- [architecture.md](./architecture.md) — frontend/backend boundaries and data flow
- [api.md](./api.md) — HTTP route index by domain
- [testing.md](./testing.md) — test files mapped to domains
- [server-db.md](./server-db.md) — `server/db/` module map
- [scripts.md](./scripts.md) — maintenance scripts catalog
- [reflection-frontend-architecture.md](./reflection-frontend-architecture.md) — feature-specific session-finalization, evidence, and review-UI map

## Development and review workflows

- [stacked-feature-development-and-review.md](./stacked-feature-development-and-review.md) — default proportional implementation delivery and review model; it scales from one PR to a Graphite stack
- [hosted-beta-implementation-steel-thread.md](../PLANS/hosted-beta-implementation-steel-thread.md) — accepted implementation sequence and proof gates for the private-beta service

## Other root docs

- [README.md](../README.md) — human getting started, modes, data layout
- [STABILITY_FRONTIER.md](../STABILITY_FRONTIER.md) — stability-frontier operating model and agent maintenance rules
- Linear — current idea intake, portfolio placement, priority, and declared Focus/Async work; the steward maintains it under the operating model in [`PLANS/project-steward-linear-trial.md`](../PLANS/project-steward-linear-trial.md)
- [CHANGELOG.md](../CHANGELOG.md) — casual release notes for users
- [notes/README.md](../notes/README.md) — medium-lived working memory for cross-thread context
