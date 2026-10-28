# Product documentation routes

The Mandarin learner runtime is defined by the [adaptive vocabulary contract](vocabulary-learning.md)
and [implementation guide](../docs/vocabulary-learning.md), including modes, action logs, internal reflection,
content provenance, and the operator review surface.

This is a retrieval map for existing material under `SPECS/`, not a definition
of the target taxonomy. The [documentation hierarchy](../docs/documentation-principles.md#documentation-map)
defines ownership independently of this folder. The
[adoption inventory](../docs/README.md#known-adoption-gaps) records the known gap
between that target and the current corpus.

Use these sources to recover intended behavior and its rationale. Existing
guarantees do not disappear because their documents need restructuring, but a
canonical label does not certify every sentence as deliberate or current.
Distinguish promises from implementation details, and surface consequential
conflicts rather than changing a promise solely to match the code.

## Current Mandarin product and architecture

| Reader's question | Owner |
| --- | --- |
| What do words, modes, exercises, coverage and completion mean? | [Adaptive vocabulary study](vocabulary-learning.md): product model and intended learner behavior |
| What can feedback, repair and operator review change? | [Review and content authority](vocabulary-learning.md#reactions-feedback-content-repair-and-authority) |
| What structural constraints must an implementation preserve? | [Vocabulary architecture](vocabulary-architecture.md): state ownership, retained evidence, completion and application authority |
| How do independent pure cues work? | [Pure-cue elicitation](pure-cue-elicitation.md), with current vocabulary admission in [mode and selection](vocabulary-learning.md#learner-mode-and-selection) |
| What does Connections promise? | [Session debrief](session-debrief.md): input, durable generation, interests, failure and retry |
| How are Chinese characters presented? | [Character presentation](character-presentation.md): display intent and explicitly described conversion mechanisms |

The [implementation guide](../docs/vocabulary-learning.md) explains current
mechanisms. [Study UI](../docs/implementation/vocabulary-ui.md) and the
[operator workflow](../docs/operator-panel.md#content-improvement-workflow) describe
current interfaces. These descriptions do not make every layout or algorithm an
architectural requirement.

## Earlier runtime contracts and design rationale

These documents help interpret historical records and recover design reasoning.
Their earlier-runtime authority is explicitly scoped in their openings. Current
vocabulary requirements are maintained in the contracts above; a surviving
principle is not lost merely because its original realization was replaced.

- [Learning and review](learning-review-model.md): earlier lifecycle and direction-level scheduling.
- [Study actions](study-action-model.md): earlier skill state, attempt events and production primitives.
- [Session progress and completion](session-progress-and-completion.md): earlier covering and deferred-commit model.
- [Reflection generation](session-reflection-generation.md) and
  [proposals and handles](reflection-proposals-and-handles.md): earlier evidence and authorization flow.
- [Home exercise rates](home-exercise-rates.md) and [My Words](my-words.md): earlier metrics and browsing terminology.
- [Word bootstrap and introduction](word-bootstrap-and-introduction.md): teaching rationale and earlier package-based design, with current preparation owned by the vocabulary guides.

## Other feature sources

The following routes retain useful domain material. Their full applicability was
not established by the vocabulary documentation reconciliation; consult their
scope and implementation before carrying a rule into the current runtime.

- [Recovery highlights](session-recovery-highlights.md).
- [Deferred reflection](deferred-reflection-second-opinion.md).
- [New-word intake](diet-deck-distribution.md).

## Material with other destination roles

- [frontend-architecture-map.md](frontend-architecture-map.md) is a technical
  navigation source. Its placement under `SPECS/` does not make current React
  structure a product guarantee. See the [technical routes](../docs/README.md#descriptive-architecture-and-implementation).
- [study-db-setup.md](study-db-setup.md) describes older study-mode setup and
  restore. Assess current applicability for the task; it is not the default
  hosted-service workflow. See the [operations routes](../docs/README.md#operations-guides).
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
