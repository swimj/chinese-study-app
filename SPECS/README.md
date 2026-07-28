# SPECS index

Product and planning documents under `SPECS/`. See [docs/README.md](../docs/README.md) for how these relate to other documentation.

## Canonical product and feature contracts

Behavior changes must align with these and update tests in the same change.

| Document | Role |
| --- | --- |
| [learning-review-model.md](./learning-review-model.md) | Word lifecycle (`unstudied` / `learning` / `review`), direction-level rules, session inclusion at word level |
| [session-covering-criteria.md](./session-covering-criteria.md) | In-session covering, undo, commit payload intent (frontend-owned session snapshot) |
| [study-action-model.md](./study-action-model.md) | Implemented scheduling architecture: study actions, word-skill state, attempt events, contrast selection |
| [reflection-proposals-and-handles.md](./reflection-proposals-and-handles.md) | Reflection result, proposal review, authorized-operation, application, provenance, and handle contracts |

**Layering:** `learning-review-model` defines word-status semantics; `study-action-model` defines how skills and actions are scheduled and projected; `session-covering-criteria` defines how the frontend treats items inside an active session.

## Architecture maps (navigation only)

| Document | Role |
| --- | --- |
| [frontend-architecture-map.md](./frontend-architecture-map.md) | React directory map and controller boundaries |

Also see [docs/architecture.md](../docs/architecture.md), [docs/api.md](../docs/api.md),
[docs/server-db.md](../docs/server-db.md), and the feature-specific
[reflection frontend architecture map](../docs/reflection-frontend-architecture.md).

## Operations

| Document | Role |
| --- | --- |
| [study-db-setup.md](./study-db-setup.md) | Study-mode DB setup and restore |

Friend/local setup: [docs/ops/FRIEND_WINDOWS_SETUP.md](../docs/ops/FRIEND_WINDOWS_SETUP.md), [docs/ops/SELINA_SETUP.md](../docs/ops/SELINA_SETUP.md).

## Active plans

| Document | Role |
| --- | --- |
| [french-compatibility-profile-plan.md](./french-compatibility-profile-plan.md) | French study profile compatibility |
| [french-priority-alias-first-cut-plan.md](./french-priority-alias-first-cut-plan.md) | Priority alias lookup first cut |
| [french-reading-corpus-compatibility-plan.md](./french-reading-corpus-compatibility-plan.md) | French corpus ingestion plan |
| [initial-reflection-steel-thread.md](../PLANS/initial-reflection-steel-thread.md) | Initial implementation milestone for durable post-session reflection and proposal review |

Repo-level plans: [PLANS/](../PLANS/).

## Completed / historical (archive)

| Document | Notes |
| --- | --- |
| [archive/milestone-6-retire-review-items-plan.md](./archive/milestone-6-retire-review-items-plan.md) | **Done** — `review_items` removed; scheduling uses word-skill state |
| [archive/milestone-7-8-relevance-aware-contrast-plan.md](./archive/milestone-7-8-relevance-aware-contrast-plan.md) | **Done** — relevance-aware contrast practice (archived; gaps non-pressing) |
| [archive/milestone-7-8-implementation-slices.md](./archive/milestone-7-8-implementation-slices.md) | **Done** — contrast/relevance implementation checklist (archived) |

## Vision (not implementation contracts)

| Document | Role |
| --- | --- |
| [adaptive_vocabulary_training_product_notes.md](./adaptive_vocabulary_training_product_notes.md) | Long-term product vision |

Misc backlog dump: [docs/vision/todos-dump.md](../docs/vision/todos-dump.md).
