# Vocabulary learning first deliverable plan

This working plan turns the [early specification](2026-10-15-vocabulary-model-whiteboard.md)
into a first delivery. It owns implementation choices, conversion, validation,
and cutover. The starting direction is one coherent new scheme with simple
initial policies and one learner-visible cutover. Review units need not be
separate releases. No implementation is dispatched by this document.

The [storage sketch](2026-10-16-vocabulary-storage-sketch.md) develops the key
tables, reference relationships, and read indexes for reviewing this design.

## First delivery scope

Deliver rapid cue repair and the new learning scheme with straightforward,
reasonable policies. Retain existing scheduling where it fits, with the new
mode-level behavior. Include internal reflection with manual repair approval,
a basic backend event log, and consistent content/model provenance. Rich preference
controls, sense-override surfaces, and sophisticated adaptive policies are later
extensions. Sense records grow through bootstrap and useful enrichment; incomplete
sense associations do not block ordinary study or learner feedback. Single-word
automatic improvement establishes sense context before proposing repairs.

## Session controls and completion

Replace Drain with “Finish for now”: stop admitting new work and wrap up what is
in flight. In that phase, offer “Finish immediately” with a warning that unfinished
words remain due for the next session. Send remaining frontend actions before
finalization and retain them on the backend. Finalization and post-session work
include uncovered words; incomplete teaching does not create a completion, and
unfinished practice does not receive fabricated covering credit. Keep the existing
completion deadline and cancellation mechanism. Richer interrupted-session
recovery and restart options can follow on the persisted log.

Remove dismiss/suppress from the live session UI. Skip, try another, and stop work
on this word provide immediate ways out while preserving responses and reactions.
Offer dismissal for skipped words from the summary or Words panel. A fuller
production-suppression experience is follow-up work; existing deactivations remain
effective. Retain current Undo scope. Returning to an earlier word adds practice;
changing mode after session closure is a new command, not an undo of that session.

## Content authoring and prompt evaluation

Bootstrap, teaching, and exercise generation can evolve during implementation,
supported by a reproducible way to evaluate prompt changes. The authoring targets
differ by experience:

- **Teaching introduction:** preserve the existing approach; its content is
  already working well and needs no general redesign.
- **Teaching exercises:** reconnect generation to the introduction actually
  delivered, reinforcing the uses and associations it taught. Coherence does not
  require reusing its sentences. A direct definition can be better than a rambling
  circumstance prompt or vague cloze; choose what makes the taught meaning clear
  and retrievable.
- **Solidify/Practice:** generate a generous pool of plausible retrieval options,
  aiming for a recognizable meaning, intention, or feeling. Explore tone, rhythm,
  structure, content, length, and ways of approaching the same use. Five or six
  options for a single use, or more, is reasonable—not a quota or ceiling. The
  generation brief can explicitly acknowledge that we do not yet know what will
  work and want breadth to learn from actual use. Retain straightforward options
  alongside exploratory ones; reserving some of the pool for familiar approaches
  is a policy candidate, with the mix left adjustable.

Curate for basic usefulness and linguistic faithfulness, removing clear errors,
confusing wording, and obvious filler. Do not require every option to prove a
distinct pedagogical contribution before trying it. Apparently redundant cues,
including small wording variations, may produce different learner outcomes.
Prompt review cannot settle that in advance. Evaluate exploratory content for
the flexible practice experience, where learners can skip or try another way,
rather than imposing the old compulsory-recall standard on every candidate.

Teaching exercises are exclusively marked for teaching/priming and excluded from
general practice APIs, including after Solidify priming. Shared physical storage
is convenient, but cross-role reuse is not a requirement. Teaching reactions go
to a separate manual inbox with the introduction and associated exercises;
teaching repair does not pass through the ordinary reflection improvement loop.

Provide implementation with a prompt-evaluation loop: run variants against the
same retained inputs, save prompt/model provenance and generated outputs, render
the learner-facing experience, and retain comparisons and review notes. The
[introduction lab](../../docs/word-introduction-lab.md) is an existing starting
point. Check structural validity separately from editorial quality. Review
teaching exercises alongside their actual introduction, and Solidify/Practice
options both individually and as a pool. Model critique can assist; it does not
establish learner effectiveness or replace hands-on judgment. Actual encounters
and reactions provide the subsequent evidence. Concrete prompts and evaluation
cases can be developed during implementation within these targets.

## Internal reflection

Reflection has independent learner-feedback and internal-improvement paths.
Learner feedback is generated per word, drawing a lesson across the exercises
encountered. Internal improvement works per interaction or general exercise and
produces proposals for manual review by Justin. Neither path waits for the other
to finish or for the learner to work through a maintenance backlog. Teaching
issues use the separate manual inbox described above.

Preserve the core linguistic reasoning while allowing decomposition of calls,
evidence contracts, and reporting. Those orchestration changes are in scope;
changes to core linguistic guidance or framing require hands-on experimentation.
Adapters supply the actual exercise purpose and teaching/priming context. The
single-word improvement path ensures a sense inventory, then assesses the authored
cue and maps a single intended use before drafting a repair. This local prerequisite does
not require comprehensive remapping at cutover. Learner feedback still reasons
from exact encounters independently of improvement readiness.

Mapping admits an exercise with a defensible single intended sense to local
improvement. A gloss laundry list spanning distinct senses instead automatically
generates a fresh, sense-based repertoire for operator review. Applying that
proposal replaces the laundry-list exercise and retains any other existing cues;
it does not reset the word's content pool or learner state. The discarded list
needs no sense association; replacement draws on the word's inventory without
preserving or accounting for every old gloss. Uninterpretable intent
and an apparent inventory gap for a single intended use remain visible operator findings, with
no subsequent automatic repair, inventory expansion, or repertoire generation.
These routing decisions concern single-word exercises; pure-cue policy remains
separate. Sense intent does not retroactively establish the fairness of a cue.

Encounters and explicit reactions determine processing eligibility, including
skips before an answer and work on uncovered words. Do not carry forward old
review-only, covered-attempt, or overlapping-word filters as reasons to lose this
evidence. Work can be grouped or deferred between calls; reactions without an
answer is not a fabricated mistake. Preserve attribution to the source encounters.

Learner feedback is read-only. Backend policy applies compensation automatically
from a designated judgment, independently of reading feedback or approving a
content proposal. Apply each adjustment once. Prefer a simple, comprehensible
initial policy, including for delayed judgment and mixed outcomes across a word's
exercises; full scheduling replay and linguistically perfect compensation are
not launch requirements. Scheduling compensation does not reverse explicit mode
choices. Exact adjustment amounts and timing remain implementation policy.

Service ownership remains separate from evidence ownership. Shared publication
does not publish private learner evidence. Operator previews distinguish shared
creation/update/retirement from learner-only deactivation or suppression. Legacy
operations retain explicit effect scope rather than silently acquiring a global
meaning. Learner-state correction is independent of content application.

The operator can update an existing content item or replace it with a new one,
retiring the previous item. Preview the consequences for identity-bound learner
state and teaching relationships, and retain the chosen strategy, rationale,
and effects. Those cases provide evidence for later agent guidance rather than
requiring a complete update-versus-replacement policy upfront.

Decision-model diagnosis and independent proposal-quality trials are separate
follow-up experiments handled through Linear intake. The authoring eval loop
above supports this delivery's prompt work; it does not bring those trials back
into scope.

## Basic event records and richer linked evidence

Provide one general-purpose backend event log. Any backend behavior we decide
is worth tracking has an obvious place to go, without designing a new table or
workflow-specific logging mechanism. Adding an event should be a small, routine
code change. The log uses structured records that are easy to filter, join, and
analyze with ordinary scripts.

Keep the common record small: identity, timestamp, event name, and structured
JSON data, with actor, entity, session, workflow, and causal references where
applicable. Exact fields and storage remain refinement choices. Optional context
must not make a simple event expensive to emit. Event names and payload conventions
should be predictable enough that scripts need not parse human-readable messages.

Richer records can attach through stable event or entity IDs as needs emerge:
exercise encounters, model invocations, diagnoses, human reviews, and content
applications. Existing durable records can supply this evidence too. Preserve
facts that later analysis cannot recover, such as the content version actually
served, and distinguish requests/attempts from committed effects. Coverage can
grow whenever a new analytical question arises; the basic facility is available
from the start. The same log can hold both diagnostics and durable change evidence.
Records that are the sole evidence of a domain change must be written with that
change and retained accordingly. Concrete persistence and retention choices
belong in refinement.

## Content and model-call provenance

Complete content objects retain their identity and current authored data together;
revision history also stores every version, including the active one. Model calls
link to the exact content or sense versions they consumed or produced. Generation,
evaluation, human editing, and application are distinct relationships: evaluating
a proposal does not make the evaluator its author, and approval is not application.
One call can produce several items; one item can pass through several calls.

Retain a common invocation identity with workflow/step/attempt attribution,
provider and model identity, prompt identity/version and exact template hash,
schema and input-projection versions, relevant generation settings, timing,
outcome, usage/cost, and provider request identifiers where available. Exact inputs
and outputs need retained snapshots or resolvable immutable references for analysis;
a hash alone cannot reconstruct them. Human edits and imported content retain
their own origins, with unavailable legacy metadata left unknown.

This should answer both “where did this exercise come from?” and “what did this
prompt version produce or judge?” It also supports selecting a precise repair
cohort. A prompt change identifies candidates for inspection or regeneration;
it does not itself declare existing content incompatible or overwrite later edits.
Provenance records derivation without creating automatic live content dependencies.

### Existing foundations and gaps

Source inspection found useful pieces to extend:

- The [common invocation ledger](../../server/db/model-invocations.ts) records
  provider/model, call type, cost, status, and latency. It requires learner identity
  and has no common prompt or content-reference record. Backend work needs service
  attribution without inventing learner ownership.
- [Teaching/practice components](../../docs/word-content-generation.md) retain
  invocation links and a generation key hashing prompt, schema, model, settings,
  and input-projection version. Bootstrap and review generation do not retain the
  same direct invocation link in their publication path.
- [Reflection records](../../docs/server-db.md) retain evidence, results, prompt
  metadata, provider attempts, proposal reviews, and authorized operations, but
  these records are learner-owned. The [operator content-improvement workspace](../../docs/content-improvement.md)
  already supports manual revision, approval, and application of repairs.

These findings are source-based. They identify reusable pieces, not verified
hosted coverage; no hosted provenance audit or model trials have been performed.

## Learner state conversion

| Existing lifecycle | New mode |
| --- | --- |
| Unstudied | Unstudied |
| Practice (`learning`) | Solidify |
| Review | Practice |

Retain stash membership, useful teaching history, and existing scheduling
values. Preserve pure-cue scheduling continuity. Conversion does not infer
sense-level ability, manufacture preferences, or create per-sense overrides.
Existing explicit content deactivations remain effective without adding a new
preference-management surface.

Learners can change word mode directly. Automatic mode promotion uses a simple
heuristic, with thresholds chosen during implementation. Scheduling follows
existing behavior except where mode-level policies require a change; this
delivery does not require a new general composition or personalization engine.

## Sense establishment and word-level fallback

Sense records and exercise associations are separate work:

```text
Bootstrap uses → Sense catalog with stable identities

Exercise + word → Optional association to one of that word's senses
```

New bootstrap/normalization persists senses from authored uses. Existing bootstrap
uses can seed senses without another generation call. Justin expects each word
to have been bootstrapped only once; validate that against the conversion dataset
before assuming multiple-version reconciliation is necessary. A word association
alone does not establish an exercise's sense.

Cutover requires no sense generation or model-assisted remapping. Create senses
from existing uses where available, and associate content where the source
establishes the relationship. Both imported and newly generated content remain
usable through word-level fallback when senses or associations are unresolved.
Other flows can enrich these records as sufficient evidence becomes available.

### Relationship contract

Store at most one sense ID inline on each content–word relationship, plus
`sense_mapping_established_at`. A null timestamp means unresolved; a completed
mapping with no sense ID means no appropriate single sense was assigned. Neither
means that the content covers every sense. Multiple senses per relationship can
wait for a demonstrated need and a schema change. A word may still have many
senses, and teaching history may record several introduced together.

The relationship connects identities and outlives representation versions. Live
reads use the sense's current description. A content or catalog change does not
implicitly invalidate the association; changing it is an explicit operation.
Establishment is per content–word pair: resolving one member of a pure cue says
nothing about the others. Considered versions and invocation provenance belong
in job/model evidence and events, rather than on `content_words`.

Word-level selection, answer assessment, and exact-content reactions remain useful
without sense associations. Sense-specific interpretation must not claim links
that have not been established. Historical encounters retain their original
meaning; later interpretation cannot fabricate a historical sense target or
per-sense mastery.

### Incremental enrichment

Single-word improvement reuses or establishes the word's senses and maps the
relevant exercise. Sense establishment is independent of fresh exercise generation;
existing authored bootstrap uses can establish an inventory without a provider
call. Mapping records the content and catalog examined as workflow evidence.
The stable association remains separate from those versions. Prompt refinements
remain subject to the experimentation boundary above.

Enrichment changes associations without implicitly rewriting content, answers,
history, or access scope. Retain established senses if subsequent mapping fails.
Concurrent/retried work reuses completed results; asynchronous writers check for
intervening content or relationship changes without turning the lasting relation
into a version pin. A future requirement for complete coverage would need its
own broader enrichment pass.

## Content conversion boundaries

Keep existing word identities and import usable content by default. Imported
content retains provenance and a traceable old-to-new identity mapping, including
package-scoped exercise IDs. Preserve the exclusive teaching role for imported
teaching exercises. Flatten exercise material where needed while preserving its
presented meaning and answer criteria.
Pure-cue accepted answers and contrast choices/explanations remain explicit.

Preserve access scope, publication/withdrawal state, and explicit learner
deactivations rather than treating import as fresh publication or activation.
Keep original packages and historical encounters available as evidence; they
do not need to become new-model session logs.

## Conversion validation

- Check bootstrap coverage and document multiplicity for active learner words.
- Count reusable exercises with explicit sense evidence versus uncertain links.
- Verify unresolved associations are not interpreted as known sense matches or mastery.
- Confirm meaningful word-level practice remains possible for unresolved content.

No hosted inventory or model-assisted mapping has been performed for this plan.

The storage sketch supplies the initial table model. Detailed session/UI contracts
and operational cutover procedures remain refinement work.
