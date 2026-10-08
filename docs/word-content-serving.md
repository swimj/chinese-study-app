# Serving word content during study

A learner first meets a Mandarin word through an introduction, then practises
recognition and recall before the word enters ordinary review. The application
must choose content that is ready, keep the material stable during study, and
record progress separately from opening or reading a lesson.

This guide explains that serving path for prepared introductions and Practice,
the learner-facing name for the persisted `learning` stage. It covers preparation
demand, package association, session snapshots, and their connection to study
progress. [Generation and publication](word-content-generation.md) produce the
shared material; [data representation](word-content-representation.md) explains
its source documents, packages, and exercise snapshots. The
[feature contract](../SPECS/word-bootstrap-and-introduction.md),
[covering contract](../SPECS/session-covering-criteria.md), and
[learning/review model](../SPECS/learning-review-model.md) define the intended
learning rules that this implementation realizes.

## Requesting prepared content

The preparation reserve turns learner selection into bounded demand for shared
content. Its candidate membership is private to each learner, while preparation
of the same word is reused across accounts.

The reserve targets twice the configured daily new-word limit, up to 40 words.
Queued, ready, and failed candidates occupy slots. Keeping failed slots reserved
prevents repeated visits from replacing failures with unbounded new generation.
App entry, meaningful priority/settings changes, and durable first-study commits
reconcile membership. Session composition, opening, and abandonment do not
consume the reserve. [The shared worker](word-content-generation.md#retaining-work-without-exposing-a-partial-lesson)
handles generation and its retry budget independently of learner navigation.

[Session preparation](../server/word-content/session-preparation.ts) waits at most
30 seconds total, then admits ready new words within the existing stash/diet
quotas. Quotas are computed before readiness filtering: stash words still
preparing do not transfer their slots to diet. Top priority is best effort; a
reduced or empty new-word set is valid. If no useful session exists yet, the UI
explains preparation and offers waiting again or returning later.

The complete introduction and exact source travel in the session payload.
Consequently, the player can advance through the lesson and recall cards without
model calls or fetching missing introduction content during study.

## Selection and withdrawal

[Package selection](../server/db/word-introductions.ts) combines shared availability
with the learner's private association. A learner who has never opened a package
can receive the first eligible package. Opening records the exact package ID;
subsequent selection follows that pin. The package contains both the introduction
and its practice rehearsals, anchored to one immutable source document.

A package is eligible only while both its publication and its source publication
are `shared_trial` or `available`. Quarantine or retirement excludes it from new
serving while preserving stored content and history. A withdrawn private pin
does not silently select another package. Unprepared new words are omitted at
session entry; established Practice words without eligible completed-package
content use their existing ordinary cards.

Active session and Undo snapshots retain the exact package, content, exercise,
and accepted-answer identities already served. Selection for a later session
checks availability again. The [generation guide](word-content-generation.md#publication-and-availability)
explains why new demand does not regenerate an already-prepared withdrawn result.

## Private association API

The [service and routes](../server/word-content/routes.ts) keep private navigation
separate from background preparation and the session's durable study commits.
`learner_word_introduction_events` stores append-only opened/completed markers.

Authenticated Mandarin endpoints:

- `POST /api/words/:wordId/introduction/open`, body `{ "packageId": "..." }`:
  privately associate the exact eligible prepared package, without generation.
- `POST /api/words/:wordId/introduction/complete`, body `{ "packageId": "..." }`:
  idempotent private navigation completion of the exact opened eligible package.

Opening or completing a lesson records navigation. Completing it in My Words
awards no study credit, and a saved completion marker does not automatically
complete a later session unit.

## First encounter: introduction followed by recall

An admitted new Mandarin word begins with teaching beats. Space advances a
complete beat, and private reflection questions require no submitted answer.
The player uses one continuous paper surface: earlier beats remain readable,
while scrolling does not reveal future content. In browse mode, Space returns to
the current beat; a separate press advances. Held keys, typing, and IME
composition do not trigger navigation. Text sizes stay stable in both modes,
and reduced-motion preferences disable smooth scrolling.

Finishing the walkthrough opens recognition and production through the ordinary
weighted session scheduler. Recognition reveals curated source material;
production asks for the taught expression using a package rehearsal. Each
direction needs three consecutive `Good` ratings. A non-`Good` rating resets only
that direction. Production selects the rehearsal at the current production
streak modulo the rehearsal count, so a reset returns to the first rehearsal.
Coverage remains word-level, rather than requiring every authored exercise.
Weighted interleaving can select the same word consecutively, especially when
other work runs out.

Only completing both recall streaks covers the word through the deferred
commit/Undo path. Finishing the teaching beats alone grants no study credit.
The session walkthrough has no skip-to-cards control or Escape bypass; normal
session controls allow leaving without completing teaching. The
[covering contract](../SPECS/session-covering-criteria.md#unstudied-word-covering)
defines that distinction and the effects of the durable first-study commit.

## Practice and the handoff to review

During Practice, one recognition direction and one production direction remain
the daily obligation. An eligible package whose introduction the learner has
completed supplies curated recognition material and a production rehearsal.
[Session composition](../server/db/persistence.ts) chooses the rehearsal by UTC
study-day ordinal modulo the package's rehearsal count. Fetching or retrying on
the same day therefore keeps the same choice without a durable exercise cursor.

Recognition and production reveals can show the pinned source examples and
translations, including after an incorrect production answer freezes the
feedback card. This reinforcement comes from the source document; an authored
practice phrase is not inserted into the source example collection.

Practice uses the existing coverage and first-try success rules. Three
consecutive successful study sessions graduate the word; calendar-day adjacency
is irrelevant. Learning commits retain their existing word-level success result,
with no durable per-rehearsal attempt ledger. The
[learning covering rules](../SPECS/session-covering-criteria.md#learning-word-covering)
and [graduation model](../SPECS/learning-review-model.md) own those promises.

Ordinary review uses separately authored bootstrap-backed cues and its existing
reflection/scheduling paths. Graduation does not convert a target rehearsal into
a review cue. [Structured review content](structured-review-content.md) explains
that later serving and content lifecycle.

## Presentation from pinned content

The [session character preference](../SPECS/character-presentation.md) controls
word headings and authored Chinese text. Sentences and examples follow the main
Simplified or Traditional choice; Both allows a separate sentence-script choice.
Revealed clozes insert one answer form matching the sentence, while standalone
answers can show both. Display conversion leaves pinned content, packages, and
answer contracts unchanged.

[Rehearsal presentation](../src/features/rehearsal-presentation.ts) owns generic
session-time wording, so changing that framing does not require rewriting
packages. Generated rehearsals store an empty instruction, and the default adds
no preamble. Content-specific instructions remain visible. The formatter also
suppresses the exact former generic instruction in already-open snapshots and
lab drafts; the [migration guide](ops/schema-migrations.md#rehearsal-presentation-cleanup)
explains its stored-content cleanup.

## Evidence and limits

- [Reserve tests](../tests/word-preparation-reserve.test.ts) exercise stable
  candidate membership, bounded demand, reconciliation, and quota behavior.
- [Session composition tests](../tests/word-introduction-session-composition.test.ts)
  exercise completed private pins, stable rehearsal selection, and withdrawal
  fallback without changing progress.
- [Teaching integration tests](../tests/teaching-session-integration.test.ts)
  exercise first-encounter recall, Practice coverage, frozen selection, and Undo
  without turning rehearsals into review evidence.
- [Presentation tests](../tests/practice-card-presentation.test.ts) check the
  learner-facing stage labels and source example/translation rendering.

These fixtures exercise selection and state transitions. They do not measure
content quality or establish the visual behavior of every rendered session.
