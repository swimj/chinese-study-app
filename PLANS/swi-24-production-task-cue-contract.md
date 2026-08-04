# SWI-24 — Production-task and cue contract (design memo)

Status: accepted implementation design (2026-08-05). The durable product
contract has graduated into the owning canonical specs. Two deliberately
unfrozen implementation details remain human-gated orientation decisions: the
exact nested `repair_production_cue@2` wire schema and the first bounded
word-scheduler reconciliation response for multi-answer cue attempts.

Scope: The cue-type, answer-space, grading, cue-evidence, and reflection-handle
contracts are not separable from the cue-repair contract, so SWI-24 settles
them together. Scheduling stays word-based for the first implementation; the
cue layer is content plus a shadow evidence stream. The exact stopgap
word-scheduling response is deliberately replaceable policy behind a defined
reconciliation seam (see §6), not a second design gate for the cue deliverable.

Related:
- `STABILITY_FRONTIER.md` (cue-repair loop near-term outcome)
- `SPECS/study-action-model.md` (production task / cue boundary)
- `SPECS/reflection-proposals-and-handles.md` (`repair_production_cue` versions)

## 1. Current-state trace

- Session composition admits words; the action selector picks a skill and
  emits a `StudyAction`. For production, `contentRef` is currently null.
- The served production prompt is built at render time from `word_meanings`
  rows filtered by `show_on_production_prompt`, falling back to
  `word.meaning` (`src/features/session/session-selectors.ts`). No durable
  cue id, no task id.
- Attempt events persist `contentRef` + `metadata`; the reflection evidence
  supplement carries `cuesAsShown` with a nullable `cueId`.
- Reflection can generate `repair_production_cue@1` proposals (already
  drafting multiple cues per proposal); review can accept them; application
  is `unsupported` (no cue model / no faithful adapter).
- `bad_prompt` is a per-word flag (legacy escape hatch), not cue identity.

## 2. Orienting reframe

The unit of value is the *instinct* — a response available at conversational
speed, often before deliberate reasoning can fully unfold. Native speakers
still reason as they use language; the point is that targeted drills tend to
overtrain deliberate analysis even though much production must keep pace with
thought. A cue is a *role* (any stimulus that elicits a response), not a unit.
Cue quality comes from how closely the stimulus resembles a real usage
situation and how well the trained response transfers beyond the drill.
Current gloss-production is muddied because an English gloss resembles few
real situations in which a speaker needs to produce the word; the trained
instinct can couple to the cue artifact rather than the concept.

Cue families range from gloss, to an anchored or qualified sense, to minimal
context, to a circumstance or expression. As the cue comes closer to a real
usage situation, the trained response is more likely to transfer. V0 represents
an anchored sense as a `definition_gloss` whose text narrows the intended
sense. Register and domain details belong in the cue text rather than in their
own cue type: they may qualify a gloss or help set the scene in
`minimal_context` or `circumstance`. Minimal-context cues often admit multiple
reasonable answers, and being overly strict recreates the overtraining problem,
so multi-answer cues are part of the same contract rather than a later
addition.

V0 folds cloze prompts into `minimal_context`: a short contextual frame may or
may not contain an explicit blank. A separate `cloze` type can return if it
later gains distinct rendering or grading behavior. The initial taxonomy is a
prompting hypothesis and is expected to evolve through dogfood iteration.

## 3. Initial deliverable model

One default production task per word, identity `(wordId, 'default_production')`.
State stays on word/word-skill; the task is a content anchor, not a scheduled
object. This one-task-per-word setup keeps the first implementation simple while
leaving room for later sense-specific tasks; it does not assert that a word and
a task are the same thing.

A task owns a collection of cue entries, and multiple cues may be active at
once. Cue *selection* at serve time is a separate, replaceable policy from cue
existence. V0 selects randomly among active cues because that is simple and
stateless. Selection is scheduling-independent — it chooses which cue to
present for an already-admitted word, not whether the word is due.

Cues are a content layer on top of word-based scheduling. Scheduling stays
word-based; cue rows are content.

## 4. Conceptual model

### 4.1 Cue row (content, not scheduling)

```ts
type ProductionCueEntry = {
  cueId: string;
  cueType:
    | 'definition_gloss'
    | 'minimal_context'
    | 'circumstance';
  text: string;
  attribution: { invocationId: string | null; origin: 'reflection' | 'manual' | 'legacy' };
  answerSpace: {
    // anchor is the task's wordId in V0 (the scheduling anchor); not a
    // separate settable field. Re-anchoring is a post-V0 / sibling concern.
    acceptedWordIds: string[];   // includes the task wordId; length 1 for single-answer cues, >=2 for multi-answer
  };
};
```

A cue row is immutable in V0: its type, text, answer space, and creation
attribution identify the exact stimulus-and-answer contract. Cue activation is
a separate lifecycle projection. A learner-visible "edit" creates a new cue
and deactivates the explicitly replaced cue; unrelated cues retain their ids.
One authorized invocation may atomically create, replace, or deactivate several
cue identities so a split or multi-cue repair remains one reviewable change.
The invocation/effect records the created and deactivated cue ids; V0 does not
need a separate semantic cue-revision chain.

A task owns a collection of cue entries. Multiple cues may be active. V0
chooses randomly among active cues. If no active cues exist, the legacy
gloss fallback serves (today's behavior). Once any durable cue is active, the
gloss fallback is shadowed.

The legacy gloss fallback is *not* a cue row — it is `word_meanings`-derived
base content served when no durable cue applies. `definition_gloss` cue rows
are durable enriched gloss cues, distinct from the fallback. When the fallback
serves, `contentRef` is null (as today) and the attempt snapshot records the
gloss-derived prompt, so legacy gloss attempts stay distinguishable from
enriched-cue attempts.

Existing bad-prompt and `suppress_definition_production` state is not cleared
by cue application. Its durable intent remains suppression of the legacy
definition-derived exercise. An active authorized cue may make cue-based
production available without claiming that the old definition exercise was
restored; when no active cue exists, the existing suppression still prevents
the fallback from serving. An eventual explicit whole-production suppression
would be a stronger policy and is not invented here.

### 4.2 Snapshot answer checking and asynchronous reconsideration

All V0 cues use the same answer-checking rule: a submitted response is accepted
only when it matches the accepted-word set snapshotted on the served action.
There is no LLM call, naturalness judgment, or learner-confirmed alternate on
the live-session grading path.

An out-of-set submission is incorrect for that session and receives the current
target-word scheduling response. The attempt still records the raw submitted
text and, when it resolves unambiguously to a catalogued word, its word id.
Post-session reflection may propose that the submitted word belongs in the
cue's answer space. Learner authorization applies that change prospectively by
writing a new immutable cue and may append an explicit later cue-evidence
judgment for the originating attempt. It does not rewrite the served
snapshot or retroactively undo the stopgap target-word scheduling response.

Adding an accepted answer is therefore a cue repair in V0: write a replacement
cue with the expanded `acceptedWordIds`, deactivate the old cue, and optionally
record a later cue-evidence judgment about the source attempt. The old
`accept_production_alternate@1` intent is subsumed by this cue-scoped mechanism
rather than gaining its own directional adapter; the V1 operation itself
remains unsupported and is not reinterpreted.

V0 answer spaces remain restricted to known visible words. Free-standing
phrases or expressions with optional word links are a plausible later extension
for more naturalistic production, but add no required product value to this
deliverable.

### 4.3 Served action + provenance

```ts
type StudyContentRef =
  | { type: 'contrast_prompt'; id: string }
  | { type: 'example_sentence'; id: string }
  | { type: 'production_cue'; taskId: string; cueId: string };
```

The attempt event snapshots cue text, answer space, raw submitted text,
resolved submitted word id when available, and the session-time result in its
existing `metadata` field. A later cue replacement, deactivation, or
answer-space expansion cannot rewrite what an earlier attempt tested.

The exact response-normalization and word-resolution mechanism is delegated to
implementation against the current study-profile behavior and catalog model.
The implementation handoff must report the chosen rules, especially ambiguous
or unresolved submissions; the durable contract only requires raw text plus a
nullable resolved word id.

For multi-answer production, `StudyAction.targetWordId` remains the admitted
word at composition time (the scheduling anchor, which equals the task wordId
in V0). The attempt snapshot metadata carries `anchorWordId`
(= `targetWordId` in V0), `submittedText`, nullable `submittedWordId`, and
`acceptedWordIds` so projection and evidence correlation stay truthful
regardless of what the learner produced.

### 4.4 Ownership, lifecycle, reversibility

- Base content = `word_meanings` (gloss fallback). Durable learner-owned
  cue content = cue rows with `attribution`. Applied effect = the invocation
  that caused a cue row. All distinguishable.
- Cue content is immutable. Forward revision creates new cue ids and explicitly
  deactivates the cue ids it replaces. Deactivation without replacement
  re-exposes the fallback when no active cues remain. Restoration is a new
  authorized activation effect. No destructive delete in V0.
- Manual and reflection paths share the same operation registry, validators,
  invocation writer, and apply adapter.

## 5. `repair_production_cue@1` decision and v2

V1's declared non-effects forbid the replace/activate interpretation needed
to close the loop ("does not deactivate the current definition-production
exercise," "does not apply a cue stack that does not yet exist"). The payload
has no task/cue identity and no add/replace/activate mode. Reinterpreting an
accepted V1 invocation would violate the "registering an adapter later must
not reinterpret stored payloads" rule (`SPECS/reflection-proposals-and-handles.md` §4). So V1 stays `unsupported` for
automatic application.

V1 drafts migrate to v2 via *supersession*, not reinterpretation: a one-off
script pre-fills a v2 editor from an accepted V1 draft; on approval a
user-replacement v2 invocation supersedes the V1 proposal (supersession is
defined in `SPECS/reflection-proposals-and-handles.md` §7). V1 invocations
remain historically `unsupported`. Lower priority, scriptable, dogfood-useful.

Bridge to reflection generation: the first push updates reflection generation,
validation, review, and application to emit and handle the intended v2
operation directly. New cue-repair work must not continue accumulating as V1
drafts that require conversion before use. Historical V1 proposals and
invocations remain truthfully `unsupported`; a learner-visible V1-to-v2
supersession path is useful but sits below the first-push line.

V2 also subsumes the useful cue-scoped part of
`accept_production_alternate@1`: reflection can repair an immutable cue by
replacing it with the same stimulus and an extended accepted-word set, plus an
optional later cue-evidence judgment for the motivating attempt. The old V1
alternate operation remains unsupported because its directional,
non-cue-scoped claim is broader and cannot be reinterpreted as this repair.

## 6. Cue evidence and provisional scheduling reconciliation

This deliverable is not intended to redesign scheduling. Its primary goal is an
end-to-end cue vertical, and cues with multiple accepted answers are essential
to that goal. That creates a limited collision with the current scheduler:
scheduling state belongs to individual words, and an action is assumed to
inform the state of its anchor word. Without an explicit reconciliation step, a
valid non-anchor response could be treated as a lapse on the anchor; treating it
as ordinary target-word success could instead strengthen a word the learner did
not produce. Either result misstates the evidence.

Broader scheduling changes are planned, so V0 needs only a bounded stopgap that
prevents egregious behavior while keeping the cue vertical replaceable. The
content contract first records stable facts: the scheduled anchor, exact cue
and accepted-word snapshot, raw submission, nullable resolved submitted word,
and session-time result. A separate reconciliation policy may then project a
provisional response into the current word/word-skill scheduler without
changing those facts.

At implementation orientation, the agent must trace the current scheduler and
propose the initial response for accepted-anchor, accepted-non-anchor, and
rejected submissions. The human confirms that policy before substantial
implementation. Avoiding false punishment and false strengthening of the
anchor are design aims; some temporary divergence is acceptable because this
policy will be replaced with the broader scheduler rather than promoted into
canonical cue semantics.

Possible bounded experiments include preferring an already authorized
diagnostic cue on the next serve or applying a conservative interval floor or
cap. Model-generated cue content still requires explicit learner authorization
before it becomes durable selectable content.

In parallel, every cue attempt contributes to an append-oriented cue-evidence
stream. Raw facts are never rewritten. A learner-authorized reflection may
append a later cue-evidence judgment tied to the source attempt; later
withdrawal or supersession appends another compensating record. An asynchronous
projector may derive provisional cue strength, response distribution, or other
shadow state from that log. V0 scheduling does not consume this shadow state,
so divergence between cue strength and stopgap word strength/interval is
explicit and expected.

The exact evidence-event, later-judgment, compensating-record, and projector
shapes are delegated to implementation against the existing attempt and
reflection stacks. They must preserve these append-only semantics and be
proposed at the human-guided orientation checkpoint before substantial
implementation, then reported in the implementation handoff. They are
intentionally not frozen here.

This seam preserves the future design space for cue-aware or budget-based
scheduling without requiring arbitrary-distance Undo in the current word
scheduler. Later work may use the log to propose new cues, re-anchor or split a
cue, or introduce word-to-cue affinity in selection.

## 7. Canonical sources

The durable contract now lives in:

- the “Production task and cue boundary” subsection of
  `SPECS/study-action-model.md`; and
- the `repair_production_cue` version 2 contract in
  `SPECS/reflection-proposals-and-handles.md`.

At orientation, implementation must read those current sections and inspect
their diffs from the task's base revision rather than relying on duplicated
excerpts in this memo. If this memo and a canonical spec diverge, the canonical
spec wins.
