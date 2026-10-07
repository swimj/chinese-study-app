# Product documentation routes

This is a retrieval map for existing material under `SPECS/`, not a definition
of the target taxonomy. The [documentation hierarchy](../docs/documentation-principles.md#target-hierarchy-and-ownership)
defines ownership independently of this folder. The
[adoption inventory](../docs/README.md#known-adoption-gaps) records the known gap
between that target and the current corpus.

Use these sources to recover intended behavior and its rationale. Existing
guarantees do not disappear because their documents need restructuring, but a
canonical label does not certify every sentence as deliberate or current.
Distinguish promises from implementation details, and surface consequential
conflicts rather than changing a promise solely to match the code.

## Sources for the product-wide model

- [learning-review-model.md](learning-review-model.md): word lifecycle,
  direction-level rules, and word-level session inclusion.
- [study-action-model.md](study-action-model.md): skills, study actions,
  scheduling, attempt events, contrast selection, and production tasks/cues.
- [session-covering-criteria.md](session-covering-criteria.md): active-session
  covering, Undo, and commit intent.

These explain related parts of the product and currently carry both shared and
area-specific concepts. This PR has not established a coherent product-wide
owner or certified their layering. The target needs shared definitions and
cross-cutting guarantees with explicit refinement by the area owners below.

## Existing feature and domain sources

| Area | Current sources and subject |
| --- | --- |
| Word lifecycle, scheduling, and in-session behavior | The three sources above, pending reconciliation of shared versus area-specific ownership |
| Introduction and preparation | [word-bootstrap-and-introduction.md](word-bootstrap-and-introduction.md): content, preparation, pinned packages, and review-reflection lifecycle; [current guide](../docs/word-introduction-in-app.md) |
| Pure-cue practice | [pure-cue-elicitation.md](pure-cue-elicitation.md): independent scheduling, sampling, promotion, and compensation |
| Session debrief | [session-debrief.md](session-debrief.md): inventory, durable generation, interests, failure, and retry |
| Recovery highlights | [session-recovery-highlights.md](session-recovery-highlights.md): repeated trouble followed by reliable recall |
| Reflection generation | [session-reflection-generation.md](session-reflection-generation.md): completed-session boundary, evidence, attempts, isolation, retry, and bounds |
| Reflection effects and handles | [reflection-proposals-and-handles.md](reflection-proposals-and-handles.md): proposals, review, authorization, application, provenance, and handles |
| Deferred reflection | [deferred-reflection-second-opinion.md](deferred-reflection-second-opinion.md): selected deferred evidence and replacement in active review |
| Character presentation | [character-presentation.md](character-presentation.md): word forms, script preferences, and display conversion |
| My Words | [my-words.md](my-words.md): personal collections, browsing, and word details |
| New-word intake | [diet-deck-distribution.md](diet-deck-distribution.md): deck distribution and intake decisions alongside original delivery planning |

For an area being reconciled, establish the owning model and promises, link or
clearly separate its current realization, explain important decisions, and
identify concrete gaps. The table records where material is found today, not
a decision to preserve one file per row or the present boundaries forever.

## Material with other destination roles

- [frontend-architecture-map.md](frontend-architecture-map.md) is a technical
  navigation source. Its placement under `SPECS/` does not make current React
  structure a product guarantee. See the [technical routes](../docs/README.md#current-architecture-and-implementation).
- [study-db-setup.md](study-db-setup.md) describes older study-mode setup and
  restore. Assess current applicability for the task; it is not the default
  hosted-service workflow. See the [operations routes](../docs/README.md#operations-and-contributor-workflows).
- [diet-deck-distribution.md](diet-deck-distribution.md) mixes durable design
  material with delivery planning; preserve the useful intent while separating
  historical sequencing when this area is reconciled.
- French [compatibility](french-compatibility-profile-plan.md),
  [priority-alias](french-priority-alias-first-cut-plan.md), and
  [reading-corpus](french-reading-corpus-compatibility-plan.md) plans are context
  for retired experimentation, not a current hosted compatibility promise.
- [archive/](archive/), [PLANS/](../PLANS/), and
  [adaptive vocabulary product notes](adaptive_vocabulary_training_product_notes.md)
  are supporting history or exploratory sources. They do not define required
  documentation layers or assign current work. Their retention and ownership
  are part of the bounded adoption review, not settled by this index.
