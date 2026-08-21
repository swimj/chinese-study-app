# SPECS index

Product and planning documents under `SPECS/`. See [docs/README.md](../docs/README.md) for how these relate to other documentation.

## Canonical product and feature contracts

Behavior changes must align with these and update tests in the same change.

| Document | Role |
| --- | --- |
| [learning-review-model.md](./learning-review-model.md) | Word lifecycle (`unstudied` / `learning` / `review`), direction-level rules, session inclusion at word level |
| [session-covering-criteria.md](./session-covering-criteria.md) | In-session covering, undo, commit payload intent (frontend-owned session snapshot) |
| [study-action-model.md](./study-action-model.md) | Implemented scheduling architecture: study actions, word-skill state, attempt events, contrast selection, and the bounded production-task/cue model |
| [session-reflection-generation.md](./session-reflection-generation.md) | Completed-session boundary, reflection evidence, generation attempts, failure isolation, retry, and resource bounds |
| [reflection-proposals-and-handles.md](./reflection-proposals-and-handles.md) | Reflection result, proposal review, authorized-operation, application, provenance, and handle contracts |
| [intake-triage-advisor.md](./intake-triage-advisor.md) | Pre-introduction advisor evidence, judgments, review actions, persistence, and triage presentation |

**Layering:** `learning-review-model` defines word-status semantics;
`study-action-model` defines how skills and actions are scheduled and projected;
`session-covering-criteria` defines how the frontend treats items inside an
active session; `session-reflection-generation` owns finalized evidence and
generation; and `reflection-proposals-and-handles` owns review, authorization,
application, and provenance after generation succeeds. `intake-triage-advisor`
owns the separate pre-introduction language-aware triage loop.

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

## Active plans

| Document | Role |
| --- | --- |
| [french-compatibility-profile-plan.md](./french-compatibility-profile-plan.md) | French study profile compatibility |
| [french-priority-alias-first-cut-plan.md](./french-priority-alias-first-cut-plan.md) | Priority alias lookup first cut |
| [french-reading-corpus-compatibility-plan.md](./french-reading-corpus-compatibility-plan.md) | French corpus ingestion plan |

Repo-level plans: [PLANS/](../PLANS/).

## Completed / historical

| Document | Notes |
| --- | --- |
| [archive/milestone-6-retire-review-items-plan.md](./archive/milestone-6-retire-review-items-plan.md) | **Done** — `review_items` removed; scheduling uses word-skill state |
| [archive/milestone-7-8-relevance-aware-contrast-plan.md](./archive/milestone-7-8-relevance-aware-contrast-plan.md) | **Done** — relevance-aware contrast practice (archived; gaps non-pressing) |
| [archive/milestone-7-8-implementation-slices.md](./archive/milestone-7-8-implementation-slices.md) | **Done** — contrast/relevance implementation checklist (archived) |
| [initial-reflection-steel-thread.md](../PLANS/initial-reflection-steel-thread.md) | **Done** — initial durable post-session reflection, proposal review, and supported application steel thread |

## Vision (not implementation contracts)

| Document | Role |
| --- | --- |
| [adaptive_vocabulary_training_product_notes.md](./adaptive_vocabulary_training_product_notes.md) | Long-term product vision |

Misc backlog dump: [docs/vision/todos-dump.md](../docs/vision/todos-dump.md).
