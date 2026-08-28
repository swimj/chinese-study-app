# SWI-39 legacy prompt remediation

status: archived
type: task-spec
created: 2026-08-27
retire-when: SWI-39 is implemented and its dogfood run is reviewed
related:
  - SPECS/session-reflection-generation.md
  - SPECS/reflection-proposals-and-handles.md
  - docs/reflection-frontend-architecture.md
  - https://linear.app/swimj/issue/SWI-39

## Outcome

Provide a dogfood-only utility that turns active migrated **definition-fallback
bad-prompt exclusions** into normal reflection artifacts and Help items. It
uses the existing Luna prompt, V4 bundle shape, V7 result handling, proposal
review, invocation, application, and Help inbox. It does not change ordinary
post-session reflection behavior.

## Scope

- Read active `definition_fallback_exclusions` whose origin is
  `legacy_bad_prompt_migration`.
- Exclude `contrast_prompt_exclusions`; they will be handled manually.
- Assemble up to 25 items per provider call. Keep the existing resource
  behavior; do not add a deterministic token-budget or output-size mechanism.
- Provide a study-data CLI with explicit learner/data-dir selection, dry-run by
  default, and explicit apply mode.
- Persist normal generation runs and immutable artifacts so provider failures,
  retries, Help, proposal review, authorization, and application use the
  existing lifecycle.

## Bundle construction

Do not introduce a new bundle or prompt format for this one-off utility.
Construct a valid `session_reflection_bundle.v4` directly in the CLI-side
builder. Each exclusion becomes a `production_mistake` item with:

- the current word, existing-content, and meaning-derived fallback snapshots;
- `responseKind: 'no_clue'`, null response/submitted word, and
  `learnerRequestedReview: true`;
- the historical bad-prompt note in `sessionNote`; and
- a synthetic item/attempt identifier used only to satisfy the retained V4
  shape, never presented as durable attempt evidence.

The provider receives ordinary V4 evidence and needs no operator/remediation
awareness. The existing prompt already permits a no-clue item to judge a word's
production value or fallback cue independently. Current no-clue restrictions
on alternate-answer and contrast claims are acceptable for this scope.

## Narrow adaptations

1. Reflection artifacts and generation runs must permit a null source session
   for this utility. Update the reflection-only persistence/ownership checks
   and readers accordingly; do not create a fake study session or add a
   remediation-specific column.
2. When normalizing `repair_production_cue@2` from one of these synthetic
   items, retain its cue changes but replace `sourceAttemptJudgments` with an
   empty array. Those judgments require a real durable production attempt at
   application time; inventing one would make accepted repairs fail or falsify
   provenance. Normal session items retain current normalization unchanged.

## CLI behavior

The command should report selected definition exclusions, skipped contrast
exclusions, planned batches, and generated artifact/run ids. Apply mode must
not delete, clear, or alter any exclusion. A successfully authorized cue repair
may make a useful durable cue serve, while the legacy fallback exclusion remains
truthfully active.

## Non-goals

- A general sessionless-reflection product architecture or custom bundle UI.
- Second-opinion workflow, cross-session item selection, or generalized word
  review. Future work may design those properly without treating this utility
  as their contract.
- Contrast-prompt repair or automatic resolution of contrast exclusions.
- Changes to session finalization, scheduling, grading, or ordinary reflection
  resource policy.

## Verification

- Focused tests for synthetic V4 construction, null-source persistence,
  stripped synthetic attempt judgments, Help materialization, and CLI dry-run
  versus apply/idempotent rerun behavior.
- Existing reflection generation, store, application, and Help-inbox tests.
- `npm run build`.
- Before a real dogfood apply, make a recoverable database backup and inspect
  the dry-run report.

## Disposition

The sole dogfood database completed the remediation successfully on 2026-08-28.
The temporary exclusion state and one-time operator path were then retired;
durable sessionless reflection artifacts remain readable and retryable.
