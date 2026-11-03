# Vocabulary reflection prompt contracts

This guide helps prompt maintainers find each vocabulary reflection call, understand
its inputs and outputs, and choose verification for a change. The
[content-improvement implementation guide](../../../docs/implementation/vocabulary-content-improvement.md)
owns routing, persistence, identity resolution, and operator application. The
[prompt development procedure](../../../docs/prompt-development.md) governs adaptation
and behavioral comparisons.

## Call boundaries and prompt composition

Only general production encounters enter feedback or improvement jobs.
Recognition and contrast encounters are retained in the session log but excluded
from these calls; teaching issues go to the manual inbox. Learner feedback and
content proposals have independent authority.

| Prompt | Responsibility | Composition |
| --- | --- | --- |
| [feedback.md](feedback.md) | Teach from the encounter and assess unfair grading | Standalone |
| [sense-mapping.md](sense-mapping.md) | Categorize an authored exercise's intended use | Standalone |
| [single-improvement.md](single-improvement.md) | Diagnose encounters and author a coherent recommendation | Standalone |
| [pure-cue-integration.md](pure-cue-integration.md) | Reuse, extend, or create an authored shared exercise | Standalone |
| [pure-cue-improvement.md](pure-cue-improvement.md) | Assess an existing shared exercise | Standalone |
| [second-opinion.md](second-opinion.md) | Independently review a proposal or no-change judgment | Preceded by `reasoning.md` |
| [pure-cue-promotion.md](pure-cue-promotion.md) | Resume a saved referral without an authored draft | Standalone compatibility path |

`improvement.md` is a retained generic contract and is not dispatched by the
active improvement routes. `reasoning.md` carries adapted linguistic guidance
from the legacy reflection prompts; it is not a common prefix for the standalone
calls. Changing a legacy file does not alter these prompt files at runtime.

Reactions are the learner's input about an exercise. Feedback is the generated
read-only lesson. Projected `encounters[].reactions` entries contain `reaction`
and an optional `comment`; historical storage fields named `feedback` are adapted
at this boundary. Comments accumulate, and withdrawn ratings are excluded from
effective reactions. Assessment treats reactions as evidence while judging their
linguistic claims and requested remedies independently.

## Learner feedback

`feedback.md` is a standalone, purpose-led teaching prompt: learning goal,
input/output map, linguistic assessment, editorial selection, worked lessons,
and final checks. Its structural and linguistic sources are the legacy
`staged-diagnosis.md` and `pure-cue-reflection.md`, via `reasoning.md`; it is not
a direct successor to an equivalent standalone legacy feedback call.

It retains visible-task versus intended-axis reasoning, cue-scoped acceptance,
lexical-unit integrity, post-reveal boundaries, independent assessment of correct
answers and cue quality, substantive learner reactions, and uncertainty. The
worked lessons adapt established lexical examples to show concise communication.
Content-design procedures, repair operations, suppression/contrast decisions,
and compulsory narration of correctness or future repairs are outside this
call's purpose. The provider does not prepend `reasoning.md`, whose repair-led
instructions and examples would conflict with the lesson's editorial direction.

The internal `diagnosis` and `unfairEncounterIds` carry the assessment; `lesson`
leads with the useful language point and mentions the exercise or fairness only
when it helps teach. It can combine related encounters without treating different
exercises as one fairness judgment. Language claims must agree with the internal
assessment, but the learner need not read the full reasoning or a session recap.

Feedback is versioned `vocabulary-reflection-feedback.v4`; the exact prompt,
schema, projected inputs, settings and provider outputs are retained by the common
invocation ledger. JSON schema is v1; input projection is
`vocabulary-reflection.v2` for the explicit reaction fields. Earlier prompts are
recoverable from Git and retained trial invocations for evaluation comparisons.
Structural tests establish dispatch and provenance, not linguistic effectiveness.
The standalone editorial framing needs live comparison against retained feedback
outputs before claiming a quality gain. See the
[prompt development guide](../../../docs/prompt-development.md).

## Existing pure-cue review

`pure-cue-improvement.md` is the standalone contract for an existing pure cue,
using prompt version 1, schema version 1, and projection
`vocabulary-admission.v1`. Its input contains complete original `sourceContent`,
projected encounter evidence, original `currentMembers`, and lexical resolutions
of effective rejected responses in `responseCandidates`. Raw responses remain
useful evidence when resolution is missing or ambiguous, but only a uniquely
resolved supplied candidate ID can extend membership.

The call returns `{diagnosis, decision, reason, addedWordIds, prompt,
teachingNote}`. Extension preserves the stimulus, axis, current members and
accepted forms while adding eligible words and replacing the full teaching note.
Repair changes only the stimulus, preserving axis, membership and teaching.
Explanation-only produces no draft. The note integrates accumulated teaching for
all members, mostly in English with Chinese illustrations where helpful. Neither
path reconciles individual word exercises or determines learner compensation.
Proposed repairs and extensions require manual application. Invocation provenance
and source/lexical fences are retained; this call does not use the admission
stage-result cache.

## Single-word production admission

`improvement-admission.ts` ensures an established active sense inventory through
`sense-readiness.ts`. Readiness reuses canonical senses or requests the shared
inventory/default-selection call. It creates senses, not teaching or exercises.
Partial unestablished inventories and established inventories without active
senses require operator attention.

The backend identifies dictionary fallback sources before requesting mapping.
Current authored general production practice accepting the word in the same
publication scope and owner, including pure cues, records `already_covered`
without a proposal. Otherwise the fallback takes `repertoire_bootstrap` directly:
it captures selected scope and invokes shared general-exercise authoring without
a mapping or local-improvement call. This content lifecycle does not depend on
learner scheduling, adoption, deactivation, or selected serving senses.

Authored sources enter the separate `sense-mapping.md` call with
`{sourceContent, wordId, word, catalog, senses}`. It assesses the actual authored
cue before associating it with a supplied active sense. Learner encounters are
excluded from this mapping input. A compact definition or related glosses can
identify one intended use.

| Mapping outcome | Required sense IDs | Subsequent work |
| --- | --- | --- |
| `single_sense` | Exactly one supplied active ID | Record mapping; assess a coherent local plan with the intended sense and encounter evidence |
| `inventory_gap` | None | Retain an operator finding without expanding inventory |
| `unmappable` | None | Retain an operator finding |

Mapping describes authorial intent, not historical grading fairness. Its internal
sense context was not necessarily visible to the learner.

### Coherent exercise-local planning

`single-improvement.md` is standalone and includes neither `reasoning.md` nor
`improvement.md`. It assesses the encounter, develops practice within the
originating meaning or circumstance, and lets that content determine what
happens to the source. Its output is an editorial recommendation:

| Field | Meaning |
| --- | --- |
| `summary` | Brief operator diagnosis and recommendation |
| `source` | `keep`, `revise`, or `retire`, with a prompt only for revision |
| `sharedExercise` | Nullable complete shared cue, supplied answer references, reveal teaching note, and rationale |
| `additionalExercises` | Target or response-word additions, each with answer reference, prompt, rationale, and `refinement` or `enrichment` role |

`exercise-improvement-authoring.ts` projects only the source, intended-use
description, historical encounters, and supplied words. Call-local references
such as `target` and `response_1` identify answers without asking the model to
repeat dictionary IDs or source accepted forms. The input marks
eligibility with `canAuthorIndividual`. The target has a known identity;
submitted forms require exactly one dictionary match. Both individual additions
and shared answers require a resolved supplied word. Missing or ambiguous forms
serve as encounter evidence for diagnosis and target improvement; validation
rejects their use as proposed answers.

The adapter maps `revise` to `update_existing`, preserving source identity,
answer criteria, and existing learner controls. Retirement can coexist with
additional target or response-word exercises and a shared cue. The application
supplies operation keys, source versions, and answer forms. Internal proposals
retain the established operations format and optional `learningRole` metadata;
existing saved proposals remain readable without that metadata. Source repairs
and all target additions, including optional enrichment, receive the originating
sense mapping. This assumes additional target practice develops the same sense.
Response-word additions receive no invented sense association; later assessment
can establish one.

Word-specific refinements must make a distinctive construction or meaning
available through the cue. Optional enrichment comes from examples surfaced
while assessing the source, or from an explicit learner request; it is not a
separate exercise search. Enrichment has the same naturalness and answer-fairness
standard as source repairs. The operator summary defaults to a few short
sentences, while individual rationales explain each item's contribution.
Integration rationale remains separately recorded rather than being appended
to that summary. Operator edits and selection of parts remain deliberate,
without enforced component dependencies.

Single improvement uses prompt version 5, schema version 4, and projection
`vocabulary-exercise-authoring.v1`. Mapping uses prompt version 4, schema version 1,
and projection `vocabulary-admission.v4`. Exact source, catalog, mapping, and
lexical checks fence publication and approval. Stage identities retain actual
projected input, schema, and contract; unknown supplied references fail validation.

The brief teaches cue-first diagnosis, learner reactions as evidence, the actual
lexical contribution, construction and rhythm, and reveal-time teaching. Worked
examples distinguish overlapping glosses from natural production patterns and
illustrate unchanged sources, repair without shared practice, shared practice
with a distinctive refinement, and optional enrichment. Three complete JSON
examples demonstrate the editorial output contract.

### Shared-cue integration

`pure-cue-integration.md` receives `localAssessment`, `localPlan`, `referral`,
resolved `candidates`, and eligible `existingCues`. Lookup includes active general
production pure cues overlapping candidates within source scope and owner.
Its output has `decision`, `existingContentId`, `semanticAxis`, `teachingNote`, and `rationale`.

| Decision | Existing ID | Axis output | Note output | Backend result |
| --- | --- | --- | --- | --- |
| `reuse` | Supplied compatible cue already accepting every candidate | null | null | Record assessment; no shared edit |
| `extend` | Supplied compatible cue missing a candidate | null | Integrated full note | Preserve stimulus, axis, forms, and all members; add every candidate |
| `create` | null | Derived from the authored shared task | null | Preserve the upstream prompt and teaching note; include every candidate |

Integration uses prompt version 1, schema version 3, and projection
`vocabulary-integration.v1`. It chooses a destination without a second pedagogical
veto. Creation derives the semantic axis from the authored cue, answers, note,
and rationale; it does not broaden or redesign that task. An incompatible
existing cue leads to creation, not rejection of the plan.
Extension notes preserve accumulated teaching and cover the complete resulting
membership, mostly in English with Chinese examples where useful. The prompt
retains natural-production guidance and requires actual grammatical, collocational,
and meaning compatibility rather than mere membership overlap.

Historical assessments with unresolved shared identities retain the complete
proposal as `pendingPlan`; current authoring rejects unresolved shared answers.
Operator identity selection records a separate immutable resolution and resumes
the saved local plan plus integration into one proposal. It does not repeat
mapping or local planning, and does not apply content. Source, catalog, selected
lexical identities, and inspected shared-cue versions fence resumed work. Saved
pending plans containing an authored axis are also resumable. The implementation guide
describes version checks and compatibility behavior.

### Legacy referral resolution

`pure-cue-promotion.md` serves persisted pre-plan resolution records whose
referrals lack an authored draft. Its retained contract can reject, reuse, extend,
or create and emits promotion-only proposals; parent local proposals and operator
edits are separate. The current integration stage does not use that legacy
pedagogical veto or author a replacement draft. Legacy prompt/schema identities
remain attached to the saved records rather than being reinterpreted as the new
contract.

### Repertoire authoring and independent paths

Fallback repertoire bootstrap uses `../general-exercise-authoring.ts`: full
general v5 brief, schema version 2, projection `general-exercises-v2`, and the
reflection job's selected model. Selected canonical uses and retained examples
supply authoring evidence. Every automatic item identifies a supplied use;
null or unknown references are rejected. Structured direct/cloze stimuli and
optional notes become a source replacement plus additional exercises. Unrelated
cues are untouched. A nonempty requested scope returning no exercises proposes
source retirement; an empty requested scope makes no call or proposal.

Ordinary preparation uses the same authoring contract under separate publication
authority. Its empty result publishes nothing and becomes operator attention.
The [implementation guide](../../../docs/implementation/vocabulary-content-improvement.md#repertoire-authoring-outcomes)
explains selected-scope capture, empty outcomes, source fences, and reassessment.

## Independent review

`second-opinion.md` reviews an exact saved `proposal` and immutable `sources`,
or `originalDiagnosis` when no proposal exists. The input also includes retained
encounter `evidence` and optional `operatorNotes`. It returns a `verdict` of
`support`, `revise`, or `reject`, with a concise `rationale`; it neither rewrites
nor applies content. This call uses prompt version 2, schema version 1, and
projection `vocabulary-second-opinion.v1`.

## Verification and retained evidence

Structural tests establish dispatch, schema, normalization, and provenance.
They do not establish linguistic effectiveness. Use the
[archived comparison record](../../../notes/archive/2026-11-03-vocabulary-exercise-prompt-comparisons.md)
for tested revisions, exact artifact locations, observed results, and limitations.
The record includes exact-target authoring, coherent-plan and editorial-contract
comparisons, and the mapping simplification review.

`scripts/review-exercise-fidelity-trial.ts` prepares standalone synthetic
single/repertoire/mapping requests without opening an application database or
initializing its invocation ledger. The bounded default contains 贸, 得以 and 簋
single/general cases; use `--cases` for up to eight named cases, including 泞 and
the separate worked-example smoke cases. 他, 有所 and 笏 are demonstrated in the
briefs and provide contract smoke evidence, not unseen lexical judgments.

`--baseline-revision` reads the retained general or single-improvement brief from
Git and selects its historical contract. The pre-authoring baseline `11387643`
uses the frozen single-improvement v4 schema and original input fields; current
single cases project the same source, sense, lexical snapshots, and encounters
into the supplied-reference authoring contract. Requests, rendered messages, schemas, hashes,
model settings, raw responses and validation are saved in a new archive. General
outputs use the rendered reference schema plus shared exercise/stimulus guards,
so historical nullable references retain their original contract rather than
receiving current binding policy. Single outputs receive partial standalone
source-decision, supplied-answer, prompt, and completeness checks rather than the
database-backed normalizer; historical variants retain their operation checks.
Mapping gets schema checks only. Source/version, ownership, referential semantics
and application fences require database-backed behavior tests.

```bash
node --import tsx scripts/review-exercise-fidelity-trial.ts \
  --archive=/tmp/exercise-fidelity --variant=candidate
```

The default only prepares requests. Authorized live runs add
`--allow-provider-calls`. `--model-choice` defaults to the registered Luna high
arm and its strict OpenAI schema transport; another registered arm retains its
provider's own transport. `--profile auto` uses production preparation settings
for general cases (Luna high, 24000 output tokens, 180 seconds by default) and
the selected reflection arm's settings otherwise. `--profile reflection` runs
general authoring with reflection settings too; `--profile preparation` requires
general-only cases. Supply credentials through the configured provider's environment
variables. Run baseline and candidate batches sequentially; each batch has at
most three calls in flight. A valid schema alone does not establish useful practice.

Use `tests/vocabulary-improvement-admission.test.ts` for an isolated SQLite
fixture and `createVocabularyReflectionProvider({adapter, ensureSenses,
environment})` to capture exact provider requests. The injected
`ensureSenses` must agree with the fixture's persisted sense catalog: publication
checks read it from SQLite. Mapping and repertoire schemas are exported from
`improvement-admission.ts`. Mapping validates ID membership, uniqueness, and
outcome cardinality in addition to JSON shape.

For mapping-only linguistic evals, replay the captured `sense_mapping` request
through the adapter without running later improvement calls. Preserve the exact
prompt, schema, source, mocked inventory, settings, and outputs. The backend
[`vocabulary-reflection-trial.ts`](../../../scripts/vocabulary-reflection-trial.ts)
runner exercises current admission and pure-cue stages through normal post-session
processing; its fixtures describe session actions rather than direct mapper input.
See the [trial procedure](../../../docs/testing.md#vocabulary-backend-provider-trials)
for isolated preparation, authorized live calls and retained evidence.

For inventory generation and readiness routing, use
`tests/vocabulary-sense-readiness.test.ts` and
`createVocabularySenseProvider({adapter, environment})`. Inject that provider
into `ensureVocabularySenses`, then supply the latter as the reflection
provider's `ensureSenses` dependency. Injecting a reflection adapter alone does
not replace the independent sense-generation provider. Keep mapper judgments,
inventory quality, and deterministic inability-to-proceed checks separate.
