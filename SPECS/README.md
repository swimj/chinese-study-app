# SPECS index

Product and planning documents under `SPECS/`. See [docs/README.md](../docs/README.md) for how these relate to other documentation.

## Canonical product and feature contracts

These define intended behavior. Surface conflicts with explicit instructions or
verified implementation; agreed behavior changes update contracts and tests together.

| Document | Role |
| --- | --- |
| [learning-review-model.md](./learning-review-model.md) | Word lifecycle (`unstudied` / `learning` / `review`), direction-level rules, session inclusion at word level |
| [session-covering-criteria.md](./session-covering-criteria.md) | In-session covering, undo, commit payload intent (frontend-owned session snapshot) |
| [study-action-model.md](./study-action-model.md) | Implemented scheduling architecture: study actions, word-skill state, attempt events, contrast selection, and the bounded production-task/cue model |
| [session-debrief.md](./session-debrief.md) | Informational Mandarin debrief inventory, durable generation, interests, failure and retry |
| [session-reflection-generation.md](./session-reflection-generation.md) | Completed-session boundary, reflection evidence, generation attempts, failure isolation, retry, and resource bounds |
| [reflection-proposals-and-handles.md](./reflection-proposals-and-handles.md) | Reflection result, proposal review, authorized-operation, application, provenance, and handle contracts |

**Layering:** `learning-review-model` defines word-status semantics;
`study-action-model` defines how skills and actions are scheduled and projected;
`session-covering-criteria` defines how the frontend treats items inside an
active session; `session-reflection-generation` owns finalized evidence and
generation; and `reflection-proposals-and-handles` owns review, authorization,
application, and provenance after generation succeeds.

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

## Feature specifications

These describe versioned feature behavior alongside the canonical contracts.

| Document | Role |
| --- | --- |
| [pure-cue-elicitation.md](./pure-cue-elicitation.md) | Accepted standalone elicitation contract: independent scheduling, proportional strong-cue sampling, staged promotion, and false-lapse compensation |
| [word-bootstrap-and-introduction.md](./word-bootstrap-and-introduction.md) | Accepted content contract with live preparation, pinned introduction/rehearsal packages, and independent review-reflection lifecycle; see the in-app guide for implemented policy |
| [deferred-reflection-second-opinion.md](./deferred-reflection-second-opinion.md) | SWI-55 implemented first cut: selected deferred evidence, chosen-model reflection, and replacement in active review without prompt changes |
| [character-presentation.md](./character-presentation.md) | Session word forms, sentence script preferences, and cloze display conversion |
| [my-words.md](./my-words.md) | Words navigation, personal vocabulary collections, bounded browsing, and word details |

## Design and planning references

These labels do not establish current work or priority. The diet design has live
implementation; its original delivery sequencing is historical. French plans
remain context for retired experimentation, not a hosted compatibility promise.

| Document | Role |
| --- | --- |
| [diet-deck-distribution.md](./diet-deck-distribution.md) | **Accepted design** — decked new-word diet (distribution-over-decks vision sketch + HSK delta-tier deliverable, placement intake, gut-level nudges, triage retirement) |
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
| [archive/intake-triage-advisor.md](./archive/intake-triage-advisor.md) | **Retired** (2026-09-10) per `diet-deck-distribution` §2.7 — Triage subtab and advisor loop removed; accepted recognition-only suppressions persist as word-level state |

## Vision (not implementation contracts)

| Document | Role |
| --- | --- |
| [adaptive_vocabulary_training_product_notes.md](./adaptive_vocabulary_training_product_notes.md) | Long-term product vision |

Historical idea dump (not a current backlog): [docs/vision/todos-dump.md](../docs/vision/todos-dump.md).
