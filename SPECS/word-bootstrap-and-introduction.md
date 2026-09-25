# Word Bootstrap, Introduction, And Early Rehearsal

Status: accepted design direction, with initial in-app policies agreed 2026-09-25.
The [local authoring lab](../docs/word-introduction-lab.md) remains available alongside
shared preparation, paced introductions, and package-based early learning. See the
[executable model and compatibility guide](../docs/word-content-model.md).
This is the product and content-model north star for the combined feature.
The policy choices in §9 can remain open through a merged prototype. Define
their initial behavior when enabling the corresponding live study effects.

## 1. Outcome And Authority

A learner should meet a word through useful, natural content, have time to
understand it, and practice the specific thing just taught. That content should
remain useful after graduation, alongside review content improved by reflection.
The long-term aim is high-quality study material that converges and needs less
repair, rather than perpetual content churn.

Word bootstrap, introduction, and early rehearsal form one feature. Bootstrap
and teaching remain separate authoring tasks with distinct prompts: bootstrap
describes the word; teaching turns that content into an experience.

This spec owns content boundaries, teaching intent, and the relationship to
review reflection. It does not replace current lifecycle, covering, scheduling,
Undo, or commit rules. Until explicitly revised, those remain in
[learning-review-model](learning-review-model.md),
[session-covering-criteria](session-covering-criteria.md), and
[study-action-model](study-action-model.md). Existing review and pure-cue
contracts remain authoritative for their exercises.

The [draft introduction prompt and worked examples](../notes/active/2026-09-24-word-introduction-prompt-draft.md)
provide editorial guidance. The
[brainstorming checkpoint](../notes/active/2026-09-19-new-word-introduction-content-brainstorm.md)
preserves discovery and feedback; this spec owns the accepted direction where
they differ. Neither example transcripts nor prompt formatting define the wire
schema.

## 2. Model Boundaries

These are conceptual responsibilities, not a required table layout.

| Concept | Responsibility |
| --- | --- |
| Word | Stable lexical identity, written forms, pronunciation, and retained corpus information |
| Word content | A coherent immutable document of selected uses, examples/translations, and useful usage or construction notes |
| Teaching package | A pinned introduction sequence and its associated target-rehearsal definitions, anchored to exact word content |
| Exercise | Presented stimulus, instruction, response mode, and answer contract; may reference source material |
| Learner state/evidence | Package association where needed, presented content, responses, and separately governed progress effects |

Shared content and private learner state remain distinct. An introduction
does not create a new persisted word lifecycle state. Uses are bounded editorial
groupings, not separately scheduled or graded senses. The existing word-skill
and standalone pure-cue scheduling boundaries remain intact.

The word's overall content view may assemble these related objects. It must
not make one mutable word record the owner of every object's update cycle.

## 3. Bootstrap Content

Bootstrap runs because useful word content has not yet been prepared, not
because a learner missed an exercise. Its inputs are lexical material such as
written form, pronunciation, corpus meanings, and available examples. It does
not require a learner history or a synthetic reflection attempt.

Its conceptual output contains:

- a bounded selection of useful uses, each with a concise learner-facing label;
- natural example sentences with faithful translations and addressable identity;
- concise usage, register, or construction explanation where it adds value.

One use is often enough; add others when they materially improve everyday
understanding. Consider familiar colloquial uses even when they are extensions
of a formal use. Select by best-effort teaching judgment; corpus frequency
measurement and formal rankings are not prerequisites. Do not enumerate every
dictionary sense or force every word into the same number of uses.

There is no standalone collocations field in the initial model. A useful phrase
can appear in an example or explanation when teaching actually needs it.
Optional supplied phrase material may later inform authoring if a concrete
consumer warrants it; do not store unused inventories speculatively.

Examples should be good language examples first. They do not need to uniquely
elicit their associated word when blanked. They have no answer sets merely
because they contain a target. A full sentence is not a pure cue.

Bootstrap is learner-independent in the first version. Scale surrounding
language sensibly to the target without matching a learner's known lexicon.
The corpus meaning list remains stored. The intended recognition reveal for
bootstrapped words uses curated use labels and an example/translation;
unbootstrapped words retain their existing reveal. This display improvement
does not alter recognition grading or scheduling.

## 4. Introduction And Rehearsal Belong Together

A teaching package identifies exact word content, an ordered introduction,
and the rehearsal definitions associated with what it teaches. It is one
coherent immutable assembly. Changing a constituent produces a new package
identity rather than silently changing an existing lesson.

The introduction proceeds in small learner-advanced beats. Space advances
the next thought; earlier content remains available. The usual starting rhythm
is situation, Chinese sentence, translation, then an explanation of what the
word does there. Additional scenes, light grammar, literary parsing, imagery,
and private reflection are chosen for their value to the particular word.

Beats may combine authored prose with references to examples. Reusable lexical
notes belong in word content; the scenario, transitions, questions, and
explanations tailored to the sequence belong in the teaching package. Do not
require every piece of narration to become a reusable content entity.

Private reflection requires no submitted answer. A subsequent beat may offer
an interpretation, without pretending an answer was observed. Advancing a beat
is navigation, not evidence of mastery. LLM chat and sentence-construction
grading are not required.

Associated rehearsal intentionally practices the taught target, even where
other words could naturally fit. Repetition and constrained drills are welcome
when they help acquire that specific word or pattern. The instruction must
make that intent clear: recall the taught expression, rather than supply any
valid completion. An out-of-contract response is not a claim of bad Chinese.

Coupling means coherent content and exact references, not identical presentation
or forced immediate practice after each beat. The package can supply reusable
rehearsal definitions while session policy decides when and how often they run.
The initial cross-session association and transition policy are specified in §9.

## 5. Reuse Material; Keep Exercise Contracts Distinct

Teaching, supplementation, and exercise are roles for material, not mutually
exclusive sentence types.

| Role or contract | What it asks or provides |
| --- | --- |
| Teaching | Understand a word through a situated, ordered explanation |
| Supplement | Read contextual reinforcement, such as an example after reveal |
| Target rehearsal | Retrieve the expression taught by this package under an explicit constraint |
| Targeted review | Produce the target from a cue whose fairness can be reconsidered by review reflection |
| Pure-cue review | Produce any accepted member of the standalone elicitation |
| Contrast selection | Distinguish among explicit choices supported by the presented context |

An exercise's contract is explicit on the exercise itself. It is not inferred
solely from the learner's word status. A shared source sentence does not imply
shared exercise identity, lifecycle, answer set, or scheduler evidence.

A cloze derived from an example identifies the exact occurrence/span to blank.
Blanking is deterministic once that choice is made. Exercise suitability,
instructions, accepted answers, and contrast choices require their own decisions;
they cannot be obtained just by deleting a substring. Not every example must
have a corresponding exercise, and not every exercise needs a source sentence.

Target rehearsal uses deterministic matching and is excluded from automatic
review cue repair/pure-cue promotion. Attempts must be distinguishable from
review attempts so a natural alternative in a constrained drill does not enter
the review false-lapse/promotion path. During learning, rehearsal occupies the production direction and uses the existing
coverage and first-try success rules; it does not become a review cue.

Preserve the exercise intent with the served stimulus, instructions, and frozen
answer forms. The initial learning integration freezes these in the session/Undo
snapshot; durable learning commits retain their existing word-level success
contract, without a new per-rehearsal attempt ledger. Rehearsal must not accidentally invoke review-lapse compensation
or review scheduler projection. Navigation, completion, and attempts remain
learner-private; they are not mutable fields of a shared teaching package.

The same example may support a separately authored review exercise when useful.
Crossing that boundary explicitly creates the review contract; graduation alone
does not silently turn a rehearsal into a normal review cue.

## 6. Pinned Teaching And Dynamic Review

Teaching references exact immutable content, never "whatever example is current"
at display time. The introduction and its rehearsal stay internally coherent
even when reflection changes the available review pool.

Review continues to use its existing content lifecycle and authorization rules.
Replacing or retiring a review cue does not rewrite the teaching package or its
source examples. Revising teaching does not automatically retire review content.
Past served content and answers remain interpretable after either changes.

Alignment is desirable but does not require continuous synchronization.
Periodic custodial work can inspect drift, identify useful review discoveries,
and deliberately revise teaching or review content. This spec does not require
an automated reconciliation service or recurring job. A revision is an
attributable content decision, not an incidental side effect of reflection.

Pinning does not override content withdrawal. Material found incorrect must
be withdrawable from future serving while preserving historical evidence.
How to resume a learner whose package is withdrawn is a rollout decision,
not permission to silently swap one example in the middle of a lesson.

## 7. Initial Implementation Posture

Optimize for discovering and preserving a good learner experience. Immutable
documents with local example identities and exact document references are
sufficient initially. A normalized global sentence catalog, deduplication,
optimal derivation, and a general lesson engine are not prerequisites.

Redundant material or frozen snapshots are acceptable when they simplify
rendering and evidence. Copies must retain enough source identity to explain
what was used; do not create ambiguous mutable aliases. Content identity is
distinct from a serialization schema version. No numbered lineage system for
every review cue is implied by teaching-package replacement.

The authoring boundary remains:

```text
lexical input -> word bootstrap content -> introduction + rehearsal package
                       |
                       +-> recognition/reinforcement material
                       +-> separately authored review exercises where useful
```

Existing review content can coexist with the new model. Definition-cue
supplements already attach to exact cues/fallbacks; preserve that meaning rather
than treating existing supplement rows as a generic example store. Pure cues
retain their independent schedules and target-free answer contract.

Provider work stays backend-owned and outside live grading. Generation failure
must not corrupt study state. Generation, validation, publication/selection,
and learner progress are separate effects. The application authorizes automatic publication of validated lexical bootstrap and
teaching outputs as shared-trial content. This policy does not give the model
arbitrary mutation authority or grant reflection proposals new authorization.

## 8. Observable Acceptance Criteria

- The worked examples can be represented as paced introductions without
  requiring live chat, forced cloze conversion, or assessed reflection answers.
- A natural, non-unique example can be shown whole and reused in explicit
  target rehearsal without asserting that its target is the only valid Chinese.
- Rehearsal and review using the same source remain distinguishable in served
  contracts and evidence; rehearsal cannot trigger review pure-cue promotion.
- Review repair leaves an already selected teaching package coherent and its
  history readable. Deliberate package replacement also preserves prior evidence.
- No extra word/sense scheduler or lifecycle state is needed merely to teach
  the word. Existing review behavior remains unchanged outside explicit integration.
- Missing or failed generation has defined serving behavior before production
  rollout; it cannot leave partially applied learning transitions.

## 9. Policy Seams And Initial Rollout

These are separable policy seams, not prerequisites for merging a prototype
to main. A prototype may author, persist, preview, and practice packages without
replacing live study progression. Define explicit initial policy when a slice
starts affecting durable learner progress or shared serving; that policy can
be simple and replaceable rather than a final product design.

1. **Payload contract:** exact bootstrap fields, beat representation, example
   references, rehearsal representation, validation, and authoring-gap reporting.
2. **Authoring/serving:** generation trigger and bounded execution, publication
   authority, package selection, and fallback when content is unavailable.
3. **Learning integration:** when a package becomes associated with a learner,
   whether it remains pinned across learning days, resume/Undo behavior, what
   rehearsal counts toward coverage and graduation, and the review handoff.
4. **Correction:** how replacement/withdrawal affects new versus already learning
   users, without rewriting past evidence or splicing incoherent content.

Before integrating changed learning behavior, update the owning lifecycle and
covering specs together with implementation and tests. Precise DB/HTTP/provider
choices should follow the smallest vertical implementation that exercises the
accepted experience.

For this feature, the user explicitly waived the existing frontier as a scope
gate while that project working model is being reconsidered. No frontier
reconciliation is required to proceed with this work.

### Initial in-app policy (2026-09-25)

- **Shared preparation:** the first request prepares lexical word content and then
  its teaching package. Both publish immediately after deterministic validation,
  with no learner quality-review step. Later learners reuse the result. Each stage
  has durable shared readiness and an expiring generation claim. A failed teaching
  stage retains the completed bootstrap. A withdrawn ready result is unavailable;
  ordinary requests do not silently regenerate it.
- **Private association:** opening pins an eligible package for that learner.
  Completion is a private navigation marker, separate from study credit. A
  withdrawn private pin is not silently replaced with another package.
- **First encounter:** an unstudied Mandarin word opens its introduction before
  ordinary cards. Completing the introduction and its rehearsal satisfies the
  first-encounter word unit through the existing deferred commit and Undo path.
  On-demand completion in My Words alone does not advance word status. Skipping
  or unavailable content falls back to the existing first-encounter cards.
- **Learning:** one recognition direction and one production direction remain
  the daily obligation. Production can use a cloze or direct definition/situation
  from a pinned package whose introduction the learner has completed. Rotate available rehearsals with a simple deterministic
  policy; no per-example or per-sense mastery ledger is required. Retries retain
  the served exercise. Missing eligible package content uses existing cards.
- **Graduation:** preserve three consecutive successful study sessions, with
  first-try Good in both directions. Adjacent calendar days are not required.
  Graduation restores the ordinary review contracts and scheduler.
- **Correction:** quarantine/retirement prevents future serving, preserves stored
  documents and evidence, and offers ordinary cards. Automatic quality control,
  revision selection, and drift reconciliation remain future policies.

### Ordinary review and reflection storage (2026-09-25)

Bootstrap content also supplies a separate review-authoring stage. Its outputs
use `targeted_review`, rather than relabeling teaching rehearsals. At least one
contextual production cue is required; definition cues may carry an exact
post-reveal example. Validated results publish automatically under the same
application-authorized shared-trial policy, with a separate recoverable readiness
claim. Preparing an existing introduction retries missing review preparation.
Failure preserves usable teaching and ordinary fallback; completion does not
regenerate retired review content.

Ordinary review uses these durable cues through its existing lifecycle and
evidence paths. Recognition may reveal eligible bootstrap material. Source
withdrawal excludes dependent review material from new serving without rewriting
past snapshots or the pinned teaching package.

Newly applied reflection cue repairs, supplements and pure-cue content also gain
canonical content records. Existing proposal schemas/approval remain unchanged;
text-only repairs normalize to `direct_text`, with no inferred sentence parsing.
Supplements carry exact local example sources with the same private visibility
as their owning supplement. Pure accepted-set growth creates a new immutable
exercise revision without changing schedule identity. Compatibility projections
remain in existing tables; the set of legacy-only authored records stops growing
for these reflection effects. Model-authored structured cloze proposals and bulk
legacy unification remain separate later work.
