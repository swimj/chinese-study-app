# Documentation index

How documentation in this repo is classified and where to start.

## Reading order for agents

1. [AGENTS.md](../AGENTS.md) — runbook, conventions, task routing
2. [SPECS/README.md](../SPECS/README.md) — product spec index
3. Canonical specs (behavior changes must align here):
   - [SPECS/learning-review-model.md](../SPECS/learning-review-model.md)
   - [SPECS/session-covering-criteria.md](../SPECS/session-covering-criteria.md)
   - [SPECS/study-action-model.md](../SPECS/study-action-model.md)
4. [architecture.md](./architecture.md) — system map (navigation only)
5. Relevant tests — see [testing.md](./testing.md)

## Doc classes

| Class | Location | Use when |
| --- | --- | --- |
| **Canonical product** | `SPECS/learning-review-model.md`, `session-covering-criteria.md`, `study-action-model.md` | Changing user-visible study behavior |
| **Architecture maps** | `docs/architecture.md`, `docs/api.md`, `docs/server-db.md`, `SPECS/frontend-architecture-map.md` | Finding code; must stay in sync with implementation |
| **Active plans** | `PLANS/`, open milestone slices in `SPECS/` | Planned work not yet done |
| **Completed / historical** | `SPECS/archive/` | Context only; not authoritative for current behavior |
| **Vision / backlog** | `docs/vision/`, `BACKLOG.md`, `SPECS/adaptive_vocabulary_training_product_notes.md` | Long-term ideas; not implementation contracts |
| **Operations** | `docs/ops/`, `SPECS/study-db-setup.md` | Local setup and data workflows |
| **Working memory** | `notes/active/` | Cross-thread coordination, research, multi-day work bundles (days–weeks; not authoritative) |

When a map doc and code disagree, fix the map in the same change as the code (or file a follow-up immediately).

## Companion maps

- [architecture.md](./architecture.md) — frontend/backend boundaries and data flow
- [api.md](./api.md) — HTTP route index by domain
- [testing.md](./testing.md) — test files mapped to domains
- [server-db.md](./server-db.md) — `server/db/` module map
- [scripts.md](./scripts.md) — maintenance scripts catalog

## Other root docs

- [README.md](../README.md) — human getting started, modes, data layout
- [CHANGELOG.md](../CHANGELOG.md) — casual release notes for users
- [BACKLOG.md](../BACKLOG.md) — noncritical product/engineering ideas
- [notes/README.md](../notes/README.md) — medium-lived working memory (cross-thread coordination)
