# Study Action Model

Status: draft for roadmap and implementation planning.

This document defines the next architectural direction for the study system.
It is intended to sit between the current prototype specs and the broader
adaptive vocabulary training vision.

Until this model is implemented, the existing learning-review and
session-covering specs remain the source of truth for current behavior. This
document describes the target architecture for the next phase.

Related documents:

- [`learning-review-model.md`](/Users/jw/dev/chinese-study-app/SPECS/learning-review-model.md)
- [`session-covering-criteria.md`](/Users/jw/dev/chinese-study-app/SPECS/session-covering-criteria.md)
- [`adaptive_vocabulary_training_product_notes.md`](/Users/jw/dev/chinese-study-app/SPECS/adaptive_vocabulary_training_product_notes.md)

## 1. Product Direction

The current app schedules review cards.

The long-term product should schedule study actions that sample particular
skills for particular words.

In the current prototype, a word has two review directions:

- forward: Hanzi to meaning / pronunciation
- reverse: meaning to Hanzi

In the new model, those directions become early action types inside a broader
system:

- recognition
- production
- contextual selection
- later: collocation, pronunciation, robustness probes, MCP, and other modes

This means the current behavior should become a simplified case of the richer
model, not a separate legacy concept that future features have to work around.

## 2. Core Principles

### Words Remain The Primary Learning Object

The word is still the main durable carrier of learner state.

The system should usually ask:

> What skill should be sampled for this word next?

It should not primarily ask:

> Which card is due?

or:

> Which cluster is due?

Clusters, prompts, examples, and explanations are supporting content. They
help the system sample skills for words, but they are not the main unit of
learner progress.

### Word Admission And Skill Selection Are Separate

Session selection happens at the word level.

The scheduler decides whether a word should receive attention in a session.
That decision is a policy function over word-level state, skill-level state,
user load limits, manual priority, and recency constraints.

Once a word is admitted, the action selector decides which skill/action should
be sampled for that word.

Skill-level state therefore influences the model twice:

- it helps decide whether the word is urgent enough to admit, usually because
  the weakest or most overdue enabled skill pulls the word forward
- it helps decide which skill/action to sample after the word has been admitted

This avoids turning every unlocked skill into a separate SRS card stream. It
also gives the product a natural place to manage the tradeoff between broad
vocabulary growth and deeper lexical competence for existing words.

This new admission model is primarily about words in `review`.

The existing lifecycle states still have distinct value:

- `unstudied` selection can continue to rely on priority and new-word intake
  policy.
- `learning` words can continue to be session obligations until covered.
- `review` words are where the system needs a holistic admission policy over
  multiple skill dimensions.

Future versions may enrich unstudied and learning behavior with more skills,
but the first architectural rework should not erase the current lifecycle
distinction.

### Skills And Actions Are Separate

A skill is a learner capability.

An action is a concrete exercise shape that samples one or more skills.

For example:

- `contextual_selection` is a skill.
- `contrast_selection` is an action kind that samples contextual selection.
- Future MCP prompts may also sample contextual selection, production, or both.

This decoupling matters because several exercise types may inform the same
skill, and one exercise type may provide evidence about more than one skill.

For the first cut, the skill-to-action mapping can be mostly one-to-one:

- recognition -> recognition card
- production -> production card
- contextual selection -> contrast selection

Later, a skill may map to a distribution over possible actions. That
distribution can initially be global rather than word-specific.

### Events Are Evidence, Not The Whole State Model

The system should persist attempt events as durable evidence.

However, near-term implementation should not be fully event sourced. The app
should keep current schedule/progress state in normal tables for simple
queries and updates.

Long term, attempt events may become the source for rebuilding derived state,
with schedule/progress tables acting as computation caches. Near term, they
are a practical audit trail and future data source.

### Failure Should Be Local

Failure in one skill should not automatically weaken unrelated skills.

For example, if a learner fails a contrast drill involving `考查` and `考察`,
that should affect contextual-selection progress or confusion evidence. It
should not imply that the learner no longer recognizes either word.

## 3. V0 Skill Dimensions

The first implementation should acknowledge only a small set of durable skill
dimensions:

### Recognition

Can the learner understand the word when seeing it?

Prototype mapping:

- current `forward` review direction

Example action:

- Hanzi prompt asks for meaning and pronunciation recall.

### Production

Can the learner produce the target Hanzi from a cue?

Prototype mapping:

- current `reverse` review direction

Example action:

- English meaning cue asks the learner to type Hanzi.

This intentionally uses the shorter name `production` instead of
`orthographic_production`. The current UI tests typed Hanzi production, but
the product language should not imply handwriting.

### Contextual Selection

Can the learner choose the appropriate word among plausible alternatives?

First new action:

- contrast selection

Example:

- choose among `严格`, `严肃`, `严峻`, `严厉`, and `严谨` in a context.

Future actions may also update contextual selection, including MCP,
collocation drills, and robustness probes.

## 4. Study Actions

A study action is the unit served by a live session.

Conceptually, a study action includes:

- action instance id, if needed
- target word id
- skill dimensions sampled
- action kind
- prompt/content reference, if applicable
- scheduling state reference
- display payload needed by the frontend

Initial action kinds:

- `recognition`
- `production`
- `contrast_selection`

Future action kinds:

- `minimal_context_production`
- `collocation_selection`
- `collocation_production`
- `pronunciation_probe`
- `robustness_probe`

## 5. Current Prototype Mapping

The current model can map into the study action model as follows:

| Current concept | New concept |
| --- | --- |
| `review_items.direction = forward` | recognition skill state/action |
| `review_items.direction = reverse` | production skill state/action |
| `review_items.interval_hours` | early schedule interval state |
| `review_items.next_due_at` | early due time state |
| `Forgot/Hard/Good/Easy` | action attempt outcome for recognition/production |
| learning word coverage | session covering policy over recognition/production actions |
| review item coverage | session covering policy for scheduled action |

The first implementation may still read from or migrate from `review_items`,
but the architectural goal is for session composition to operate on study
actions rather than review directions.

## 6. Scheduling State

Near-term scheduling should have two levels:

1. word-level admission state
2. word-skill state used by the admission and action-selection policies

The first implementation should avoid making `StudyAction` only a rendering
wrapper around `review_items`. The goal is to move scheduling ownership into
the new model early, while still allowing current `review_items` data to seed,
mirror, or validate the new schedule state during migration.

### Word-Level Admission State

Word-level state controls whether the word can appear in a session at all.

For the first pass, this is mainly needed for `review` words.

Likely fields:

- word id
- earliest next study at

### Word-Skill State

Skill-level state contributes to both word admission and action selection.

It helps determine whether a word is urgent enough to study at all, and it
controls what kind of attention the word currently needs if it is admitted.

Likely fields:

- word id
- skill id
- strength score, initially equivalent to an interval
- last studied at
- enabled / disabled state
- ease-like scheduler inputs, if still useful
- last updated timestamp

The first implementation may treat strength as an interval so existing review
data can migrate directly into the new model. Later versions may move strength
to a different scale and use a policy function to convert strength into a
scheduling threshold.

The exact table names are open, but likely candidates include:

- `word_study_state`
- `word_skill_state`

The key architectural goal is to stop treating `review_items` as the root
scheduler object. Existing review intervals can still inform the first
recognition/production schedules, but the action selector should speak in
terms of words, skills, and action kinds.

### Initial Admission Heuristic

The first heuristic can be:

> A word becomes due when any enabled skill is overdue.

For each enabled skill, compute an urgency value roughly like:

```text
skill urgency = elapsed time since skill study / strength-derived threshold
```

Then compute word urgency as:

```text
word urgency = max(enabled skill urgency values)
```

A word is eligible when:

```text
now >= word.nextEligibleAt
and word urgency >= 1
```

The session admits the most urgent eligible words under the user's load budget.

Once a word is admitted, the selector usually chooses the enabled skill with
the highest urgency, then chooses an action for that skill.

### Recency Guard

After a serious assessment action for a word, the system should set a
word-level minimum gap before another skill for that same word is assessed.

This protects skill measurements from short-term recency contamination. If a
learner has just seen a word in recognition, a production success minutes later
may be less trustworthy as evidence of durable production strength.

Same-session reinforcement after a failure may still exist, but it should be
treated as a distinct training/recovery behavior rather than clean assessment
evidence.

Initial minimum review-phase gap:

```text
6 hours
```

This is intended to be long enough that the learner has left the immediate
card-study context before the same word can be assessed again.

## 7. Load Budget

The first load budget should stay simple.

Useful starting controls:

- base session budget, preferably expressed as wall-clock study time
- max total new words
- optional adjustment based on recent performance, deferred until after the new
  review scheduler works

The session may need tolerance for spillover so the user can finish covering
items that have already been started. This is similar in spirit to the current
drain mode: after the base budget is reached, the app should avoid opening
fresh work but may continue serving work needed to close out already-started
items cleanly.

This implies that session payloads may eventually become more dynamic. The app
can move toward that incrementally.

The deferred performance adjustment can move the budget up when the user has
been succeeding easily and down when the user is struggling.

Longer term, the system may target a desired failure rate as a measure of
productive difficulty. A user may eventually be able to choose that stress
level, but the product should avoid steering users toward a demoralizingly low
success rate. As an initial intuition, sustained success below roughly 80%
should probably be treated as too stressful for ordinary daily study.

## 8. Attempt Events

Attempt events record what the learner actually did.

They should preserve evidence that would otherwise be compressed into an
interval or status update.

Common fields:

- event id
- occurred at
- session id or session sequence number, if available
- action instance id or generated action key, if needed
- action kind
- target word id
- skill ids sampled
- prompt/content id, if applicable
- first response
- first outcome
- rating, if applicable
- reflection outcome, if applicable
- metadata JSON for action-specific details

Example production event:

```json
{
  "actionKind": "production",
  "targetWordId": "kaocha-2",
  "firstResponse": "考查",
  "firstOutcome": "incorrect",
  "rating": "forgot"
}
```

Example contrast event:

```json
{
  "actionKind": "contrast_selection",
  "targetWordId": "kaocha-2",
  "promptId": "kaocha-cluster-prompt-3",
  "firstResponse": "考查",
  "firstOutcome": "incorrect",
  "reflectionOutcome": "shaky"
}
```

Attempt events are not a substitute for schedule state in the near term. They
are a durable record that supports future analysis, debugging, migration, and
adaptive policy changes.

The action instance id does not need to be a durable scheduling identity. It is
only a way to identify the exact task shown in a session when that is useful.
The durable learner model should live in word-level state, word-skill state,
content tables, and attempt events.

## 9. Lexical Clusters

Lexical clusters are manually curated groups of related or confusable words.

Examples:

- `严格 / 严肃 / 严峻 / 严厉 / 严谨`
- `考查 / 考察`
- `测验 / 测试 / 考核`

Clusters are content/context objects, not scheduler objects.

A cluster may include:

- title
- cluster-level learner note
- member words
- member-level nuance notes
- optional tags describing the relation type
- contrast prompts

Possible relation types:

- similar meaning, different tone/application
- similar sound
- similar characters
- learner-confused pair
- same broad semantic field

V0 should keep these relation types informal or manually assigned. The system
should not attempt to infer a full semantic graph yet.

Contrast eligibility lives on the word or word-skill state, not on the cluster.
When a member word schedules contextual-selection practice, clusters provide
candidate content for the action selector.

## 10. Contrast Selection

Contrast selection is the first proposed new lexical-competence action.

It samples contextual selection by asking the learner to choose the most
appropriate word from a cluster or subset of a cluster.

V0 should use multiple choice.

The purpose is not speed. The purpose is to train instinctive differentiation
and then support reflection.

### Reflective Flow

1. The user sees a contrast prompt.
2. The user chooses an answer.
3. The app records the first choice as evidence.
4. The app shows the correct answer and explanation.
5. The user gives a reflection signal.

Possible reflection signals:

- clear now
- still shaky
- want more practice

The first response should remain the primary assessment signal. If the user
chooses incorrectly right away, the system should treat that as meaningful
evidence even if the explanation makes sense afterward.

### Scheduling Policy

V0 contrast scheduling should be conservative:

- only schedule contrast for manually eligible words
- require available contrast content
- prefer words already in learning or review
- avoid damaging recognition/production progress after contrast failure
- update contextual-selection state and confusion evidence instead

Specific nouns and other low-ambiguity words may never need contrast training.
The user should be able to opt words into richer differentiation training when
that feels useful.

## 11. Mistake Capture

Production mistakes are an important source of contrast candidates.

When the learner types the wrong Hanzi for a production action, the app should
eventually offer a way to capture the mistaken answer as a possible contrast
candidate with the target word.

Example:

- target: `考察`
- user enters: `考查`
- app records that this pair may deserve contrast training

V0 mistake capture can be crude. It may simply persist:

- target word id
- attempted Hanzi
- matched word id, if the attempted Hanzi exists in the corpus
- source action/event id
- timestamp
- user note or status

This can begin producing useful data before full contrast drills are built.
One-off scripts can later migrate captured mistakes into clusters and contrast
prompt content.

## 12. Implementation Roadmap

### Phase 0: Frontend Foundation Cleanup

- split the monolithic `App.tsx` into smaller page, session, and UI modules
- preserve current user-visible behavior
- extract session orchestration enough that future study actions do not have to
  be threaded through one large component
- keep React for now; defer framework and global state-management decisions
  until the product/state boundaries are clearer
- verify the existing app still builds and relevant tests still pass

### Milestone 1: Model Spec And Domain Types

- finalize this model enough to implement
- add TypeScript domain types for skills, action kinds, study actions, and
  attempt events
- decide the first concrete shapes for word-level admission state and
  word-skill state

### Milestone 2: Current Behavior Through Word Admission And Skill State

- introduce explicit word-level admission state and word-skill state
- migrate or mirror current review item intervals into the new state
- map forward review behavior to recognition skill state/actions
- map reverse review behavior to production skill state/actions
- convert current session composition to select and emit study actions from the
  new schedule state
- admit words once, then choose the skill/action to sample
- keep user-facing behavior mostly unchanged
- keep existing session covering rules intact

### Milestone 3: Rudimentary Mistake Capture

- add a lightweight UI affordance after wrong production input
- persist target/mistake pair evidence
- expose a dev/admin view or script for reviewing captured candidates
- allow this to be a simple log before the full study-action scheduler
  migration is complete

### Milestone 4: Attempt Event Logging

- add durable attempt event storage
- log recognition and production attempts
- include production mistakes as structured event data
- add tests that verify events are written alongside schedule updates

### Milestone 5: Retire Or Demote Review Items

- update completion paths to update the new schedule state directly
- decide whether `review_items` still have any durable role
- remove `review_items` if the new schedule state fully replaces them
- otherwise keep them only as a compatibility or diagnostic view, not as the
  session composition root

### Milestone 6: Manual Cluster Content

- add lexical cluster tables
- add cluster members
- add cluster notes
- add manual contrast prompt content
- seed a tiny dev/test cluster set

### Milestone 7: First Contrast Selection Drill

- add contrast selection actions
- add reflective feedback UI
- log first-choice outcome and reflection outcome
- update contextual-selection state only
- schedule contrast conservatively for manually eligible words

## 13. Non-Goals For The First Pass

- full event sourcing
- automatic prompt generation
- automatic naturalness grading
- full synonym/confusable-word graph
- cluster-level scheduling
- public multi-user service work
- polished cluster management UI
- comprehensive stats dashboards

## 14. Open Questions

1. What should the first strength update parameter values be for recognition,
   production, and contextual selection?
2. What is the smallest useful implementation step toward wall-clock budgeting
   and dynamic session payloads?
