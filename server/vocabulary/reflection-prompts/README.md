# Vocabulary reflection prompt decomposition

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

`improvement-admission.ts` first ensures an established active sense inventory.
`sense-readiness.ts` reuses existing senses, imports uses from valid shared
bootstrap content, or generates a lexical-only inventory when neither exists.
This prerequisite creates senses, not teaching material or exercises.

The separate `sense-mapping.md` call receives `{sourceContent, wordId, word,
catalog, senses}`. `word` supplies lexical identity including hanzi and pinyin;
`senses` contains active IDs and descriptions. The authored source includes its
answer contract. Learner encounters are excluded from this mapping input. Within
one call, assess the authored cue first; consult the inventory for an association
only when a single intended use is discernible. Lexical background is not itself
an authored cue or evidence that the cue is a laundry list.

| Mapping outcome | Required sense IDs | Subsequent work |
| --- | --- | --- |
| `single_sense` | Exactly one supplied active ID | Record mapping; run local improvement with the intended sense and encounter evidence |
| `laundry_list` | None | Generate a candidate repertoire from the word's active inventory |
| `inventory_gap` | None | Retain a visible operator finding |
| `unmappable` | None | Retain a visible operator finding |

Mapping describes intended content, not historical grading fairness. An absent
single intended use in an otherwise established inventory is `inventory_gap`; it does
not trigger inventory expansion. An empty or unestablished inventory is handled
by readiness before mapping. Partial unestablished inventories and established
inventories with no active senses require operator attention.
Laundry lists receive no sense association. Their old glosses need not be
represented in the inventory or preserved by the replacement repertoire.

`single-improvement.md` is the standalone r5 sense-specific improvement prompt;
it does not include `reasoning.md` or `improvement.md`. It assesses useful
production of the admitted sense, interprets the actual response and substantive
reactions, chooses a local response, and independently considers shared practice.
Its output is `{diagnosis, operations, pureCueReferral}`. Local operations preserve
the source's accepted answers. The nullable referral contains advisory written
forms in `candidateWords`, a `sharedPurpose`, and a `rationale`; it does not change
answer membership. Either action can be useful without the other. Raw learner
`response` remains usable evidence without a structured lexical resolution.

Single improvement uses prompt version 3, JSON schema version 2, and input
projection `vocabulary-admission.v2`. `sense-mapping.md` uses standalone prompt
version 2, schema version 1, and projection `vocabulary-admission.v1`.
Repertoire generation uses the shared general-exercise invocation in
`../general-exercise-authoring.ts`: the full general v4 brief, schema version 1,
and projection `general-exercises-v1`, with the reflection job's selected model.
Active senses supply uses, notes, and any retained examples. Its structured
direct/cloze stimuli and optional teaching notes become one replacement of the
assessed exercise plus new exercises; unrelated existing cues remain.

A referral enters `pure-cue-promotion.md` within the same improvement job. Written
forms must resolve to at least two unambiguous lexical identities including the
target; missing or ambiguous identities produce an operator-attention finding,
not arbitrary membership. Lookup supplies active general production pure cues
that overlap the resolved candidates and share the source's publication scope
and owner. The stage can reject the opportunity, reuse a suitable cue, extend one,
or create a new cue. Extension preserves its stimulus, reveal axis, all existing
answers and accepted forms, while replacing the accumulated teaching note;
creation uses resolved referral candidates. Creation and extension both require
a complete teaching note, mostly English with Chinese where helpful. A shared
purpose must work for every proposed member in the visible construction.

Promotion adapts the legacy `server/reflection/prompts/pure-cue-promotion.md`
learning model, reasoning sequence, content guidance, and four worked examples.
Its different call contract removes the legacy batch/result envelopes, suppression
handoff, fairness output, learner explanation, and individual-word repertoire
inspection/reconciliation. The original attempt still grounds the shared-practice
judgment; learner feedback and compensation remain separate. The new call retains
resolved candidate IDs, original responses/reactions, and shared-cue membership
and teaching-note contracts. These responsibility changes do not replace the
legacy linguistic guidance with a shorter rubric. See the
[prompt development guide](../../../docs/prompt-development.md).

Promotion uses prompt version 3, schema version 2, and projection
`vocabulary-admission.v1`. Like other admission stages, it caches its exact
contract and input within the job, retains invocation provenance, and fences
source, sense catalog, candidate identities and inspected cue versions.
Creation or extension joins any local operations in one manually reviewed
proposal; rejection and reuse are retained assessments. Private comments must
not enter shared authored content. The stage does not reconcile per-word
exercise collections, alter scheduling, or compensate attempts. All exercise
changes await operator application. Learner feedback and existing pure-cue review
bypass this admission path. Recognition and contrast make no provider calls.

## Local evaluation seams

The caller separates invocation scope from serving policy. A mapped single sense
is always the scope of local improvement. Repertoire calls receive a captured
review/default sense list, retained in backend mapping evidence and admission as
`generationScope`. Mutable serving versions do not enter provider inputs or
content cache/approval fences. An explicit empty invocation returns no proposal
and leaves its source active. This interface adaptation preserves the complete
linguistic briefs; it does not ask the model to reassess serving defaults.

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
