# Vocabulary reflection prompt decomposition

This guide describes the active vocabulary reflection calls, their input/output
contracts, preserved linguistic guidance, and retained trial evidence.

Reactions are the learner's input about an exercise. Feedback is the read-only
lesson generated for the learner. Model inputs expose effective learner input as
`encounters[].reactions`, with each entry carrying `reaction` and an optional
`comment`. Historical session/storage `feedback` fields are adapted at projection;
they are not app-generated lessons. Comments accumulate; withdrawn ratings do
not remain active reactions. Both feedback and improvement consider reactions
as evidence, allowing useful concerns beyond the quality principles while
evaluating linguistic claims and requested remedies independently.

`reasoning.md` combines the linguistic guidance in
`server/reflection/prompts/staged-diagnosis.md` with the semantic-axis distinction
from `server/reflection/prompts/pure-cue-reflection.md`. It retains the detailed reasoning
and worked examples verbatim wherever they are independent of output schema and
routing: ideal productive capability, definition-gloss coherence, valid alternates,
pre-answer cues versus post-reveal teaching, natural evocation, and lexical-unit
integrity. The examples retain their linguistic judgments even where their former
operation or handoff instructions must change.

The shared axis guidance distinguishes natural fit to the visible cue from fit
to the intended productive use. A response outside that use may expose an
underspecified cue; hidden author context cannot justify the original rejection.
Repairs preserve the expressive purpose and accepted answers. Imported pure-cue
axes reach projected encounter evidence inside each frozen encounter's
`served.body.material.reveal.axisNote`; they are not pre-answer clues. Content
without a recorded axis permits cautious interpretation, not invented reviewed
senses.

The dispatched contracts are standalone `feedback.md`, single-word admission,
and standalone existing-pure-cue review. Feedback produces a read-only learner
lesson and bounded unfair-encounter judgments. The retained `improvement.md`
generic contract is no longer dispatched. Single-word admission has its own
local improvement and optional shared-practice review, described below.
Teaching issues remain a manual inbox. The shared reasoning does not supply the old registered-operation schema, two-stage
ambiguity routing, learner-approval routing, or legacy input/output field names.
Suppression and contrast creation remain diagnostic considerations,
not operations available to these calls. The new experience permits wording
variants and breadth, so the old requirement that each cue add a distinct
dimension is deliberately not carried forward.

This is a copied prompt source, not a runtime include of the legacy prompt.
Changes to the legacy files do not silently change the vocabulary contracts. The focused
preservation test checks selected retained passages and excludes obsolete schema
directives; it does not establish linguistic effectiveness or replace review.

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
invocation ledger. JSON schema remains v1; input projection is
`vocabulary-reflection.v2` for the explicit reaction fields. Earlier prompts remain
recoverable from Git and retained trial invocations for evaluation comparisons.
Structural tests establish dispatch and provenance, not linguistic effectiveness.
The standalone editorial framing needs live comparison against retained feedback
outputs before claiming a quality gain. See the
[prompt development guide](../../../docs/prompt-development.md).

## Provider eligibility and existing pure-cue review

Only general production encounters enter provider jobs. Recognition and contrast
remain in the full session log but create no feedback or improvement calls, and
are excluded from mixed-word feedback aggregation. Teaching issues stay manual.
Learner feedback remains independent of content proposals.

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
excluded from this mapping input. Related glosses are not a laundry-list route.

| Mapping outcome | Required sense IDs | Subsequent work |
| --- | --- | --- |
| `single_sense` | Exactly one supplied active ID | Record mapping; assess a coherent local plan with the intended sense and encounter evidence |
| `inventory_gap` | None | Retain an operator finding without expanding inventory |
| `unmappable` | None | Retain an operator finding |

Mapping describes authorial intent, not historical grading fairness. Its internal
sense context was not necessarily visible to the learner. The model does not
return a repertoire-bootstrap outcome; that route belongs to deterministic
fallback handling.

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
repeat dictionary IDs or source accepted forms. Raw unresolved responses remain
available for shared-practice judgment and subsequent operator identity review;
individual additions require a uniquely resolved supplied word.

The adapter maps `revise` to `update_existing`, preserving source identity,
answer criteria, and existing learner controls. Retirement can coexist with
additional target or response-word exercises and a shared cue. The application
supplies operation keys, source versions, and answer forms. Internal proposals
retain the established operations format and optional `learningRole` metadata;
existing saved proposals remain readable without that metadata. Source repairs
and target refinements retain the originating sense mapping. Optional target
enrichment and response-word additions receive no invented sense association;
later assessment can establish one.

Word-specific refinements must make a distinctive construction or meaning
available through the cue. Optional enrichment comes from examples surfaced
while assessing the source, or from an explicit learner request; it is not a
separate exercise search. Enrichment has the same naturalness and answer-fairness
standard as source repairs. The operator summary defaults to a few short
sentences, while individual rationales explain each item's contribution.
Integration rationale remains separately recorded rather than being appended
to that summary. Operator edits and selection of parts remain deliberate,
without enforced component dependencies.

Single improvement uses prompt version 6, schema version 5, and projection
`vocabulary-exercise-authoring.v1`. Mapping uses prompt version 4, schema version 1,
and projection `vocabulary-admission.v4`. Exact source, catalog, mapping, and
lexical checks fence publication and approval. Stage identities retain actual
projected input, schema, and contract; unknown supplied references fail validation.

The brief incorporates the reviewed prose draft from PR #442. It preserves
cue-first diagnosis, learner feedback as evidence, selected uncommon coverage,
actual lexical contribution, construction and rhythm, and reveal-time teaching.
The 违反/违法 and 遭到/遭受 examples retain the distinction between overlapping
glosses and worthwhile natural production patterns. Examples show no-change,
repair without shared practice, shared practice with a distinctive refinement,
and optional enrichment. The former repeated decision/checklist material and
additional illustrative examples are consolidated into that reviewed sequence;
storage instructions are replaced by three complete editorial-output examples.
See the [prompt development guide](../../../docs/prompt-development.md).

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

Integration uses prompt version 2, schema version 4, and projection
`vocabulary-integration.v2`. It chooses a destination without a second pedagogical
veto. Creation derives the semantic axis from the authored cue, answers, note,
and rationale; it does not broaden or redesign that task. An incompatible
existing cue leads to creation, not rejection of the plan.
Extension notes preserve accumulated teaching and cover the complete resulting
membership, mostly in English with Chinese examples where useful. The prompt
retains natural-production guidance and requires actual grammatical, collocational,
and meaning compatibility rather than mere membership overlap.

Unresolved shared identities withhold the complete proposal as `pendingPlan`.
Operator identity selection records a separate immutable resolution and resumes
the saved local plan plus integration into one proposal. It does not repeat
mapping or local planning, and does not apply content. Source, catalog, selected
lexical identities, and inspected shared-cue versions fence resumed work. Historical
pending plans may already contain an authored axis; they remain resumable. No
database migration or rewriting of saved proposals is required.

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
authority. Its empty result publishes nothing and becomes terminal attention;
explicit retry starts a bounded cycle without changing selected coverage.
Canonical inventory includes peripheral senses separately from useful defaults.
Captured generation scope is immutable across retry; later policy edits do not
retarget an existing invocation or invalidate its result. Source, mapping, and
catalog fences retain their authority.

Learner feedback and existing pure-cue assessment bypass the single-word flow.
Recognition and contrast make no provider calls. Private comments inform judgment
without entering shared authored content. All reflection exercise changes await
operator application; content assessment does not alter compensation or scheduling.
Operator reassessment pins the current source and retains historical encounters,
responses, and reactions as distinct evidence; it makes fresh applicable mapping
and assessment calls rather than reusing the parent's assessment.

The caller separates invocation scope from serving policy. A mapped single sense
is the scope of source repair and target refinement. Optional enrichment is
identified separately and is not automatically assigned that source sense. Repertoire calls receive a captured
review/default sense list, retained in backend mapping evidence and admission as
`generationScope`. Mutable serving versions do not enter provider inputs or
content cache/approval fences. An explicit empty invocation returns no proposal
and leaves its source active. This interface adaptation preserves the complete
linguistic briefs; it does not ask the model to reassess serving defaults.

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

The retained review comparison used 19 bounded strict-Luna calls: six cases under
each initial brief (12), three general follow-ups, two final positive controls,
and two standalone default-selection probes over existing canonical records.
These provider comparisons preceded the short-reference projection and required
new-item use binding; every retained generated item already had a supplied
reference. Structural projection/decode and null-rejection tests cover the later
wire adaptation. Single 贸 retired under both variants; 得以 construction practice and deliberately
selected rare 簋 were retained. Initial general 贸 failed through compound fragments;
the first revision still failed through character-classification questions. Those
failures remain evidence. After adapting the established metalinguistic reasoning,
贸 returned empty as a development case. Unseen 泞 returned empty under both
baseline and final revision, so it demonstrates no measured improvement. Final
得以 and 簋 controls produced six and four useful options respectively. The 得以
direct anchor names modal enablement rather than a whole event; its five clozes
exercise natural constructions. These one-shot observations establish bounded
judgments, not reliability across words or formats.

The first synthetic general examples used an inert `pinyin:null` field instead of
`pronunciation:null`, identically in both variants. Corrected follow-ups retain
their exact inputs. Validation initially loaded a pre-v5 checked-out helper that
rejected three legitimate empty outputs; separate revalidation against the frozen
PR4 v5 helper passed all general outputs, retaining the initial diagnostic records.
The canonical-ID selector probes omitted 函's case/box sense and selected all three
supplied 查询 senses; 函's existing envelope notes remain an inventory-precision
caveat. No corpus corrections, proposal applications or cutover writes followed.

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

### Historical coherent-plan comparison evidence (2026-11-02)

This evidence predates the editorial output contract above. The coherent-plan
change compared eight synthetic single-exercise cases with
Sol high: 原因/缘故, 有关/关于, 稠密/密集, 声调/拼音, 框/筐, 违反/违法,
遭到/遭受, and correct-answer 犹豫 readability feedback. The harness freezes
baseline schema/input separately: baseline `407ba42b` excludes `responseExercises`,
`referral.draft`, and `responseCandidates`; the candidate supplies them. All
other fixture evidence and model settings stay fixed. There were 24 calls:
eight baseline, eight initial candidate, and eight corrected candidate calls.
Every call completed with valid strict output and standalone content checks.

The initial candidate introduced a budget scenario for 有关, despite the original
notice/exam circumstance. Corrected examples keep the notice and exam arrangements
in both shared and individual practice. 原因/缘故 reveal teaching now illustrates
familiar constructions instead of only describing register. Final outputs
provided shared density practice plus an explicitly optional 密集 interview case,
separate 违反/违法 constructions, a pitch-frame repair, an unchanged fair 框 cue,
and preserved correct-answer readability repair.

One output remains questionable: 遭到-only practice in
`这个决定____了各方的强烈反对。` may still admit 遭受, despite a collocational
preference for 遭到. The shared decision-focused criticism cue also needs editorial
judgment. Structural validity does not resolve that taste question. This experiment
mostly exercises worked-example compliance, not held-out reliability; baseline
referrals were not run through their downstream promotion stage. Reuse/extension
and full proposal application are covered by database-backed injected-provider
tests, not by these live single-stage calls.

Exact requests, wire schemas, responses, settings, hashes, and editorial reviews
are retained locally under `/private/tmp/exercise-comparison-20261102`, including
`comparison-final-review.json` and `comparison-final-manifest.json`. The final
live candidate used `a5ff5b00`; subsequent editorial tightening labels the 中断
excursion optional and makes retirement of redundant single-answer sources
explicit in the 提醒 example. Those two edits were reviewed but not rerun live.
The fixture IDs begin `comparison-`; pass up to eight with the trial script's
`--cases` option. No trial applied proposals or mutated hosted content. This
historical run does not establish behavior of the current authoring contract.

### Editorial-contract comparison evidence (2026-11-03)

Eight paired synthetic single-stage cases compare baseline `11387643` with the
working authoring contract using the same registered Sol high settings. Baseline
requests retain the v4 operation schema and input; candidate requests project
those fixtures into supplied word references and the v5 editorial schema. All
16 successful outputs passed strict schema and the standalone content guards.
Initial sandbox transport failures are retained separately from the successful
network-enabled runs.

Both variants kept the fair frame/basket control, repaired the missing pitch
focus, preserved shared notice practice with a distinct 有关 predicate, and
shared population practice with optional 密集 scheduling enrichment. The candidate
repaired 犹豫 readability with a compact direct definition. Its operator summaries
averaged 36.6 whitespace-separated words, versus 64.0 in the baseline diagnoses;
this measures this small sample's presentation length, not judgment quality.

For 遭到/遭受, baseline retained exclusive 遭到 criticism practice on collocational
preference and added a loss example. Candidate shared the original criticism cue,
qualified the usage tendency in its teaching note, and added no enrichment.
That result avoids using preference alone to exclude the response. The relative
naturalness and value of repeated shared practice remain operator judgments.
These fixtures closely resemble prompt examples and establish bounded contract
and behavioral evidence, not held-out reliability. Shared-cue integration and
proposal application were not part of these provider calls.

Exact requests, wire schemas, responses, settings, hashes, and editorial findings
are retained under `/private/tmp/exercise-authoring-20261103`, including
`comparison-review.json` and `comparison-manifest.json`. The `baseline` directory
contains transport failures; `baseline-network` and `candidate` contain the
successful paired calls. No proposals were applied or hosted content changed.
