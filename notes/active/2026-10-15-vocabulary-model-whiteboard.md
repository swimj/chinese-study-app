# Vocabulary learning model early specification

This early specification describes the intended vocabulary learning model,
focused on production. Its diagrams and relationships guide implementation;
policy candidates, future extensions, and open questions remain separate below.
It describes the fuller intended experience, not current shipped behavior or a
requirement to deliver every capability at once. The [first delivery plan](2026-10-16-vocabulary-first-deliverable-plan.md)
sets the initial scope, including simpler policies and incremental sense adoption;
the [storage sketch](2026-10-16-vocabulary-storage-sketch.md) develops that scope's
records and relationships. Delivery and cutover choices belong in the plan.

## Word lifecycle

```text
Unstudied ── completed teaching ──→ Solidify ──→ Practice ──→ Maintain
                                  warmup      unprimed      lighter upkeep
                                              + spacing

Learner can change mode in either direction.
Maintain ── temporary refresh ──→ Maintain with brief scheduling guarantee
```

Mode belongs to the learner's word. Default transition policies guide progression;
the learner can override them. Sense-specific exceptions adjust particular uses.

## Scheduling and session composition

```text
Word modes + active senses + learner preferences
Exercise history + spacing signals + refresh requests
                         │
                         ▼
                  Candidate study work
                         │
                  Session composition
                         │
                         ▼
                A manageable set of work
```

Lifecycle describes the learning arrangement. Scheduling supplies signals for
when work may be useful; composition chooses what fits the session. SRS is one
available scheduling tool. A due item is a candidate, not a promise that every
due item will be practised. Explicit refresh requests retain their separately
defined, bounded scheduling commitment.

Pure cues can retain independent learner scheduling, including sparse sampling
of strong cues. Contrast relationships can make exercises relevant without
enrolling every related word. Selection need not originate from a word becoming
due, and an exercise's result retains its own meaning rather than updating every
associated word as though it were independently tested.

## Content at rest

```text
Word (hanzi, pinyin)
  └─ has → Senses
              ├─ illustrated by → Examples
              ├─ elicited by → Cues
              └─ related to → Other senses (collocation, shared axis, …)

Introduction
  ├─ addresses → Senses
  └─ contains → Teaching material (explanations, examples, …)

Exercise
  ├─ relates to → Word-senses (targets or supporting context)
  ├─ practises → Skill (recognition, production, …)
  ├─ has → Exercise type (definition production, cloze, …)
  ├─ has → Selection traits (mode suitability, …)
  ├─ defines → Response format and immediate assessment criteria
  └─ has → Exercise content (sense description, cue, example, …)
```

A word is the usual entry point. Its senses are identifiable uses.
Senses have revisable descriptions and boundaries. They can be added, split,
or combined through deliberate maintenance that preserves interpretable history
and references. Examples can support several alternative or overlapping readings.
An introduction can teach several senses together.

Content–word–sense relationships connect identities and outlive changes to their
representations. Live relationships use current sense descriptions; historical
encounters retain what was actually presented. Words and exercises remain usable
while sense associations are unresolved. Known associations can support more
specific selection without treating unknown ones as evidence of coverage.

General practice exercises form one logical pool, with traits and sense
relationships supporting selection across modes. Teaching exercises have an
exclusive serving role: teaching and Solidify priming use their curated repertoire,
while general practice selection excludes them. They can share physical storage;
reuse between the two roles is not required. This also prevents Solidify from
serving its priming exercises again as general practice later in the session.
Exercise content is self-contained presented material. Reusing a sentence does
not couple exercises through a shared mutable sentence reference. Source
provenance can be retained without requiring synchronized edits. Teaching exercises
reinforce the introduction actually delivered, without needing to reuse its exact
sentences. Skill describes the capability practised; type describes the task form.
Teaching exercises directly target a word-sense. Pure cues can have several target
words; targeting does not imply exclusivity. Exercise type and response criteria
define acceptable answers. Selecting a pure cue through
one target does not restrict its answer set or confer learning credit on every
target word.

## Learner state at rest

```text
Learner
  ├─ stash → Words + optional intended senses or description of a use
  ├─ learning scope → Learner–sense relationships
  ├─ word mode → Unstudied / Solidify / Practice / Maintain
  │                └─ sense-specific overrides where needed
  ├─ temporary refresh request → Brief scheduling guarantee, mode unchanged
  ├─ learner nudges → More / less emphasis in subsequent selection
  ├─ interests ← relevance → Senses
  └─ completed teaching history
                         ├─ senses addressed
                         ├─ exact material presented
                         └─ time/session
```

Learning scope records which senses the learner wants to develop; teaching
history records experience, without claiming understanding. Each learner–sense
relationship supports independent development within the word-level experience.
The learner can exclude senses or take up additional senses later. Mode is
lightweight, reversible state; changing it does not reset history or content.

The word's mode supplies the default for its active senses. Sense-specific
overrides describe exceptions, such as a newly added sense needing teaching
while the word is in Maintain. Senses without overrides follow the word's mode;
they do not carry duplicate mode state. The learner sees one overall direction
with explicit exceptions. Sense-linked evidence remains available independently
of this arrangement.

Sense-level evidence and learner nudges influence selection weights within a
word's mode. “More of this” or “less often” expresses a direction, with room for
the app to choose how it plays out. Established senses can receive less emphasis
while a weaker sense receives more, without splitting the word into parallel
lifecycles. Nudges are distinct from explicit scope exclusions and mode changes.

## Unstudied within a session

```text
Add word to stash
  │  common senses by default; optional specific intended use
  ▼
Resolve senses for introduction
  │  clarify intended use with the learner where needed
  ▼
Select teaching scope
  │  explicit set of senses
  ▼
Present introduction
  ▼
Practise recognition and production
  │  basic exercises targeting the introduced word-senses
  ▼
Teaching complete
  └─ post-session → Save teaching history and transition to Solidify

Teaching history ── informs → Familiar starting material for Solidify
```

Explicitly sense-scoped teaching requires those senses and its material to be
ready before presentation. Word-level teaching remains possible when structured
sense associations are unresolved. Preparation can run ahead of or during the
session; unavailable material does not block other content or behavior.

A requested use can resolve to an existing sense, lead to a new sense, or
require clarification of a misunderstanding. The introduction surface remains
one coherent teaching experience. Solidify can revisit familiar explanations
and examples while allowing the teaching to improve.

Teaching is session behavior, not a persisted mode. The word begins Unstudied;
teaching completion is all-or-nothing within the session. Incomplete teaching
creates no partial teaching state or dedicated aborted-teaching record. Content
quality reactions are independent of teaching completion.

Teaching uses a bounded, trusted repertoire that reinforces the meanings and
associations just introduced. Direct definitions and well-framed clozes can serve
that purpose; an elaborate circumstance is not inherently better. Exercises ask
for the taught word without adjudicating every linguistically valid alternative.
The dictionary-style sense and example list is the baseline teaching material.

Learners can report dissatisfaction or skip an exercise. Teaching does not promise
a better alternative in response; its material is a deliberate content-quality
target. Reporting and skipping do not establish successful recall.

## Solidify and Practice within a session

```text
Word admitted to session
  │  word mode supplies the default; sense overrides adjust the affected work
  ├─ Solidify → Warmup from familiar teaching
  └─ Practice → Start without priming
  ▼
Select exercise ← Shared pool, active senses, selection traits
  ▼
Practise + react to content
  ├─ continue → Select another exercise
  └─ wrap → Default covering policy or learner's choice
                └─ more practice → Resume work on the word
```

Exercises explore the learner's active senses. Warmup design, generation, and
selection are black boxes here. Session composition is orthogonal: this flow
starts once a word is included, without assuming daily inclusion. Covering is
a default recommendation that the learner can shorten or extend.

The exercise pool can offer many options for a single use. Generation explores
different retrieval experiences while retaining straightforward options. Basic
curation supports usefulness, but apparent similarity is not sufficient reason
to discard an option: small wording differences may matter in actual use.

Practice includes spacing between encounters to develop and assess retention.
Scheduling policy is separate from this flow; it needs retained encounter times
and results plus scheduling state at the chosen learner/word/sense granularity.
Exercise selection can use word mode, sense overrides, active senses, and
history. Difficulty and a broader repertoire can enrich that policy as those
properties become useful.

## Maintain

Maintain schedules words less aggressively and favors approachable exercises
the learner is expected to be able to do. Exercise suitability and scheduling
are policies that can evolve with experience.

```text
Maintain
  ├─ ordinary upkeep → Lighter scheduling + approachable exercises
  ├─ refresh request → Brief scheduling guarantee → Ordinary upkeep
  └─ change mode → Resume the chosen mode's arrangement
```

A refresh gives the word temporary attention while preserving Maintain mode.
It is distinct from returning to Solidify or Practice. Learners can choose any
mode when a different arrangement would be more useful.

## Responses and judgments

Live exercises use their prepared assessment criteria. A rejected response is
an immediate assessment, not a final judgment of learner error. The learner can
skip or decline further work without waiting for model judgment. Their choice
is evidence of their experience and an instruction about practice, not an
oracle of correctness or content quality.

```text
Response → Immediate assessment → Live continuation policy + learner choice
   │
   └─ post-session judgment → True mistake / false rejection / other diagnosis
                                ├─ scheduling and graduation policies
                                ├─ exercise selection weights
                                └─ content research and improvement
```

The flow describes the responsibilities of teacher judgment; its implementation
and the timing of its effects are separate choices. Negative reactions can warrant
investigation even when the answer was accepted. Mistakes can inform research on strengths,
weaknesses, and new exercises independently of lifecycle consequences.

## Session log and durable changes

```text
Every session action → Append-only session log
                         ├─ exact served exercises, assessment criteria, responses
                         ├─ mode/sense context, priming, help, and immediate results
                         ├─ reactions and learner choices
                         └─ undo records referencing earlier actions
                                  │
                                  ▼
                         Effective session state
                                  │
                                  ▼
                         Summary and transition choices
                                  │
                                  ▼
                         Post-session application
```

The log preserves what happened; undo adds a record rather than erasing history.
Ordinary Undo retains its existing scope: the latest undoable transition. Returning
to an earlier word creates fresh practice, not a rewind of intervening work.
The earlier proposal for ready generation results to enrich an ongoing session
is superseded by the [session payload contract](../../SPECS/vocabulary-learning.md#live-session-and-completion).
Generation improves material for subsequent sessions. The active player chooses
dynamically from its retained payload, without waiting for generation or fetching
new content. Exact encounter evidence records those choices.

Session state is derived from the log, allowing the learner to return to any
earlier word and keep studying. Durable learning changes are applied after the
session; logging and the independent reaction channel do not depend on
successful covering. Application must be safe to retry without duplicating effects.

A default policy identifies Solidify → Practice and Practice → Maintain
candidates at summary time. The learner can easily reverse those choices. Mode
can also be changed explicitly; the transition itself changes only mode. Changes
made during study participate in the session log. After closure, reversing a
recommendation is a new mode choice rather than reopening the session.

“Finish for now” stops admitting new work and wraps up in-flight work. During
that phase, “Finish immediately” allows the learner to end without completing
it, warning that unfinished words remain due for the next session. The frontend
sends remaining actions before finalization; the backend retains the evidence.
Post-session processing includes uncovered words, without manufacturing covering
or teaching completion. The warning concerns unfinished work, not erased history.
Session finalization retains the existing deadline and cancellable revision model.

In-session controls support skipping, trying another exercise, stopping work on
a word, and changing mode. Skipping does not erase responses or reactions, establish
successful recall, or imply permanent dismissal or suppression. Dismiss/suppress
are outside the live session UI; skipped words can be dismissed from the summary
or Words panel. Broader recovery options can build on the persisted log later.

## Post-session feedback and improvement

```text
Retained session evidence, including uncovered words
  ├─ learner + word → Feedback across the exercises encountered
  │                    └─ read-only lesson for the learner
  ├─ interaction / general exercise → Internal content improvement
  │                                    └─ manually reviewed repair proposal
  └─ teaching content → Separate teaching inbox
                          └─ manual review alongside the introduction

Teacher judgment → Backend learner-state adjustment
                    independent of reading feedback or approving content repairs
```

Every mistake receives teacher judgment, incorporating the learner's thoughts
where provided. Reactions to the same encounter is considered together.
Content quality and personal fit can be considered even without a mistake;
both can matter in the same case. Nudges normally express preferences, with
their target defining scope. Learner reports inform judgment without determining
whether content is correct or generally useful.

Mistakes receive learner-facing feedback. Explicit comments normally warrant a
response; dissatisfaction, skips, and nudges can influence future experience
without generating individual replies. Learner feedback can synthesize a lesson
across a word's exercises. Its generation is independent of internal content
improvement, whose unit is an interaction or exercise. The paths share evidence;
linguistic reasoning is preserved while their contracts can evolve separately.

Feedback is read-only. Compensation is backend policy, applied once from its
designated judgment without requiring learner approval or attention to an inbox.
Content approval does not gate learner feedback or compensation. Scheduling
adjustments can remain simple and comprehensible even when intervening practice
makes perfect reconstruction impractical. Explicit learner mode choices remain
separate from those adjustments.

## Shared content improvement

Content is predominantly shared; reflection runs behind the scenes. Ordinary
exercises can be added, corrected, or retired independently. Future selection
uses eligible content while past encounters retain exactly what was served.
Justin initially reviews general content proposals. Teaching repair uses a
separate inbox pairing the issue and exercises with their introduction. It starts
as a manual operator workflow, outside ordinary reflection repair. Maintain suitability also receives deliberate curation. Shared content
changes and learner-only management effects have explicit, separate scopes.

Learners can work around poor-fit content during study. Their choices and
reactions inform subsequent selection and improvement, reducing the cost of
trying varied material without making learner preference a correctness verdict.

## Implementation policy candidates

These are starting points and decisions to make during implementation, not
specifications. Adjust them as the experience develops.

| Area | Candidate or decision |
| --- | --- |
| Retry within session | Reserve a missed exercise until correct, unless the learner declines it for now or more generally. Interleave at least one other exercise before retrying. |
| Mistake scheduling | Solidify stays once daily; Practice shortens its interval, possibly to daily; Maintain receives a temporary refresh without changing mode. |
| Graduation | Normally withhold an automatic recommendation after a true mistake in the current session; define subsequent eligibility. Avoid repeatedly suggesting a transition the learner has overridden. |
| Sense balance | Skew weights toward useful work rather than require every active sense to pass a rigid graduation gate; retain learner judgment. |
| Repeated misses | Decide whether several misses in one session produce one scheduling adjustment or accumulated effects. |
| Covering and refresh | Choose default work amounts, Teach skip semantics, and refresh duration/exit conditions. |
| Exercise selection | Tune variety, revisits, nudge strength/persistence, and mode suitability; add difficulty signals when useful. |
| Session composition | Balance limited learner time, useful repetition, variety, and neglected material; decide how scheduling signals compete without promising exhaustive due coverage. |
| Ready content exhausted | Choose repeat/wrap behavior when another exercise or requested material is unavailable; never make continuation wait on generation. |
| Judgment timing | Choose simple immediate scheduling and later automatic compensation policies, including mixed outcomes across exercises. Apply compensation once, independently of content approval; full scheduler replay is not required. |

## Future extensions

Comprehension tasks and learner-written example sentences could offer different
evidence of a word's grasp from prompted production recall. Reading or
conversation surfaces could also contribute performance evidence to study
scheduling and state. These are sibling extensions beyond this lifecycle model.
More demanding Maintain tests could probe deeper retention; they are deferred
from the first rollout.

Corrections to previously taught misinformation could reach affected learners
through post-session feedback or notifications, potentially interleaved into
later study. This corrective-teaching mechanism is deferred.

## Open questions

- What granularity of teaching history supports useful reinforcement?
- What scheduling state belongs at word versus sense level?
- What do sense overrides specify, and when do they end?
- What makes a Maintain exercise appropriately approachable?
