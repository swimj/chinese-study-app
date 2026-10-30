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

`single-improvement.md` is the standalone sense-specific improvement prompt;
it does not include `reasoning.md` or `improvement.md`. It trusts selected sense
coverage and assesses faithful production of the exact target, interprets the actual response and substantive
reactions, chooses a local response, and independently considers shared practice.
Its output is `{diagnosis, operations, pureCueReferral}`. Local operations preserve
the source's accepted answers. The nullable referral contains advisory written
forms in `candidateWords`, a `sharedPurpose`, and a `rationale`; it does not change
answer membership. Either action can be useful without the other. Raw learner
`response` remains usable evidence without a structured lexical resolution.

Single improvement uses prompt version 4, JSON schema version 3, and input
projection `vocabulary-admission.v3`. `sense-mapping.md` uses standalone prompt
version 3, schema version 1, and the same reference projection.
Repertoire generation uses the shared general-exercise invocation in
`../general-exercise-authoring.ts`: the full general v5 brief, schema version 2,
and projection `general-exercises-v2`, with the reflection job's selected model.
Selected senses supply uses, notes, and any retained examples. Every new
automatic item anchors to a supplied use; null/unknown references are rejected
rather than synthesized. This narrows the output reference contract while
leaving cue approaches and repertoire exploration open. Legacy/manual unmapped
content is unchanged. Its structured
direct/cloze stimuli and optional teaching notes become one replacement of the
assessed exercise plus new exercises; unrelated existing cues remain. An empty
model output after a nonempty requested scope proposes retiring only the
assessed source. An empty requested scope instead makes no authoring call and
proposes no content change. The shared call
returns no sense-exclusion assessment. An empty automatic preparation result
publishes nothing and becomes terminal operator attention without changing
coverage or retrying automatically; explicit operator retry starts a bounded cycle.

The v4 single-improvement brief preserves the v3 purpose, linguistic reasoning,
reaction/referral distinctions and content-design guidance. Its worked cases name
the exact target, supplied sense, served prompt, evidence and concrete decision.
The communicative-value test and contextual-exposure distinction remain explicit;
retirement concerns exercise design while selected coverage remains trusted.
The old finding that no convincing repair is apparent gains an exercise-level
retirement outcome; it does not gain authority to exclude selected senses. The
shared v5 brief retains every substantive general-v4 authoring paragraph and
uses the purpose/decision/design/worked-example style of the reflection briefs.
General examples are starting points for exploration, not required cue shapes,
a checklist, or a claim that unfamiliar approaches are defective. The prompt
under `word-content-lab/vocabulary-experiments/` is the active production brief
for both ordinary preparation and reflection repertoire, despite that historical
directory name. Mapping replaces
the old paragraph equating inventory with useful coverage because canonical
inventory includes attested peripheral senses separately from useful defaults.
The provider receives the full inventory without serving-policy metadata.
Backend-normalized mapping evidence captures the first requested repertoire
scope, retained as generationScope with audit-only provenance. Later policy
edits do not invalidate content calls or approval; source, mapping and catalog
fences remain. Diagnoses and rationales use readable labels, with IDs kept in
structured references. Mapper, single improvement and promotion receive short
call-local sense references throughout nested inventory, source relationships,
admission and intended-sense fields. Repertoire uses and example references are
also shortened at the shared wire boundary. Unknown references are rejected;
responses translate back before canonical validation. Persistent stage evidence,
generation scope, provenance links and source/catalog fences retain canonical IDs.
Stage identity records the actual projected input/schema and projection version.

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
`vocabulary-admission.v3`. Like other admission stages, it caches its exact
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

`scripts/review-exercise-fidelity-trial.ts` prepares standalone synthetic
single/repertoire/mapping requests without opening an application database or
initializing its invocation ledger. The bounded default contains 贸, 得以 and 簋
single/general cases; use `--cases` for up to eight named cases, including 泞 and
the separate worked-example smoke cases. 他, 有所 and 笏 are demonstrated in the
briefs and provide contract smoke evidence, not unseen lexical judgments.

`--baseline-revision` reads the retained v4/v5 general brief and matching
single-retirement schema from Git. Requests, rendered messages, schemas, hashes,
model settings, raw responses and validation are saved in a new archive. General
outputs use the rendered reference schema plus shared exercise/stimulus guards,
so historical nullable references retain their original contract rather than
receiving current binding policy. Single outputs receive partial standalone
identity/answer/prompt/retirement checks rather than the database-backed normalizer.
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
