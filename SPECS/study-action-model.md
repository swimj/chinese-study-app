# Study Action Model

Status: accepted canonical product contract. The scheduling, attempt-event,
contrast-selection, and bounded V0 production-task/cue sections describe
implemented behavior. The dual-pool unstudied admission policy below is an
experimental implementation contract for current code and tests; it is
throwaway-tolerant relative to a future session-composition rewrite.

This document describes the study-action model, including current study
actions, word-skill scheduler state, attempt-event projection, contrast
selection, and accepted near-term production-cue behavior. It complements the
word-lifecycle rules in `learning-review-model.md` and the in-session covering
rules in `session-covering-criteria.md`.

For long-term product vision beyond the current PoC, see
`adaptive_vocabulary_training_product_notes.md`.

Related documents:

- [`learning-review-model.md`](/Users/jw/dev/chinese-study-app/SPECS/learning-review-model.md)
- [`session-covering-criteria.md`](/Users/jw/dev/chinese-study-app/SPECS/session-covering-criteria.md)
- [`adaptive_vocabulary_training_product_notes.md`](/Users/jw/dev/chinese-study-app/SPECS/adaptive_vocabulary_training_product_notes.md)
- [`milestone-7-8-relevance-aware-contrast-plan.md`](./archive/milestone-7-8-relevance-aware-contrast-plan.md)

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

- `unstudied` selection follows the experimental dual-pool admission policy
  in [Experimental Dual-Pool Unstudied Admission](#experimental-dual-pool-unstudied-admission)
  plus the remaining daily new-word cap.
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

### Actions, Events, And Projections Are Separate

A study action is a live served exercise instance.

An attempt event records one thing the learner did in response to a served
action.

Scheduler state is the backend's processed view of past evidence. It should
remain queryable in normal tables rather than requiring event replay for every
session composition.

The model should not treat a frontend "commit" as a core durable object. The
current app has commit intents because the frontend owns in-flight session
state and the backend immediately applies state updates after coverage. In the
target architecture, that idea should become event processing:

- the frontend owns live coverage, reinforcement, drain mode, and session
  completion behavior
- the frontend records or buffers granular attempt events as the learner acts
- the backend projects accepted attempt events into durable word-level and
  word-skill scheduler state
- before composing a new session, the backend must have processed all accepted
  events from earlier sessions according to the current projection rules

The backend may process events immediately during a live session, at session
end, or in a background step. The live session should not depend on that timing
after an item has been covered locally.

During the migration, projection does not need to replace every existing commit
path at once. The first durable attempt-event pass should focus on review
actions that already map to `word_skill_state` and `word_study_admission_state`.
Learning and unstudied word transitions can continue through the existing
legacy commit paths until those flows are represented in the newer scheduling
tables.

### Failure Should Be Local

Failure in one skill should not automatically weaken unrelated skills.

For example, if a learner fails a contrast drill involving `考查` and `考察`,
that should affect contextual-selection progress or confusion evidence. It
should not imply that the learner no longer recognizes either word.

## 3. V0 Skill Dimensions

The first implementation should acknowledge only a small set of durable skill
dimensions:

```ts
type StudySkillId = 'recognition' | 'production' | 'contextual_selection';
```

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

#### Production task and cue boundary

The current visible-meaning-to-Hanzi prompt is a compatibility implementation,
not a durable claim that lexical meanings are production cues or that one word
can have only one useful production exercise.

The durable V0 production-cue model separates:

- the word and its production skill state as the source of scheduling demand;
- one default production task per word, identified by
  `(wordId, 'default_production')`, as the content anchor describing the
  competency being sampled; this keeps the first implementation simple while
  leaving room for later sense-specific tasks and does not make the word and
  task the same thing;
- a collection of immutable cues per task, each containing cue-level identity,
  a cue type (`definition_gloss`, `minimal_context`, or `circumstance`),
  non-empty stimulus text, creation attribution, and an answer space of
  accepted visible word ids that includes the task word as its V0 scheduling
  anchor; a `definition_gloss` may narrow to an anchored sense, while register
  and domain details belong in the cue text rather than a separate cue type;
- cue lifecycle as explicit create, replace, and deactivate effects; editing
  content writes a new cue id, replacement deactivates only named cues, and
  unrelated cues retain their identity; deactivation is terminal logical
  deletion, and any later cue with similar content is an ordinary new create
  with no lifecycle continuity with the deleted cue;
- multiple simultaneously active cues, with V0 randomly selecting one at serve
  time independently of word admission or skill scheduling;
- the current meaning-derived gloss prompt as base fallback content rather than
  a cue row; it serves only when no durable cue is active, while a durable
  `definition_gloss` cue remains distinct enriched content;
- at most one immutable V1 post-reveal supplement for an exact durable
  `definition_gloss` cue or for the meaning-derived fallback of a default task;
  it contains an English usage frame, a complete natural target-language
  example, and an English translation, and is never shown as part of the
  pre-reveal production clue;
- one answer-checking rule for every V0 cue: accept the submission only when it
  matches the accepted-word set snapshotted on the served action;
- asynchronous, learner-authorized reconsideration of an out-of-set response;
  expanding the accepted set writes a replacement cue and may append a later
  cue-evidence judgment without rewriting the source attempt or its provisional
  word-scheduler effect; and
- append-oriented cue evidence plus asynchronous shadow projection, kept
  distinct from the current word-based scheduler and not consumed by V0
  scheduling.

`targetWordId` remains the word admitted at composition time and the task word
in V0. A served action and its durable attempt evidence preserve the exact task,
cue, cue text, accepted-word set, raw submission, nullable resolved submitted
word, nullable post-reveal supplement snapshot, and session-time result so later
content changes cannot reinterpret history.

Cues are content, not independently scheduled SRS objects. Cue application does
not reset or fork word-skill scheduling. Multi-answer cues nevertheless expose
a mismatch with the current scheduler: an action is anchored to one word even
when another accepted word is produced. Treating that response as a lapse can
falsely punish the anchor, while treating it as ordinary target-word success
can falsely strengthen it.

The bounded scheduler response is a replaceable implementation policy behind
the recorded cue-evidence seam:

- a clean `accepted_anchor` result uses the ordinary anchor production
  projection;
- any covered action containing a rejected initial attempt, or an accepted
  typed response that the learner rates `forgot`, uses the ordinary anchor
  lapse/reinforcement projection;
- a clean `accepted_non_anchor` result leaves both the
  anchor production-skill row and word-admission row exactly unchanged and
  appends a one-shot production recheck demand due 48 hours later;
- a future recheck demand masks ordinary production for that word without
  masking recognition; when due, it forces production admission using the
  currently available active cue selection or governed fallback;
- the durable commit consumes a served due demand; anchor acceptance or a
  covered rejected action ends it, while a clean non-anchor result
  links a successor demand due another 48 hours later.

These demands are a temporary "check again soon" class, not cue schedule state.
They do not make cues independently scheduled SRS objects and must not be
promoted into cue semantics or a broader scheduling redesign.

Response resolution uses the session-frozen Chinese word catalog. Only the
canonical Hanzi and non-null traditional form participate; lookup aliases do
not. If the response matches any word in the served accepted set, it is
accepted even when an unaccepted catalog word shares that form. The anchor wins
an accepted tie; otherwise the first matching id in the frozen accepted-set
order is recorded as the accepted non-anchor. This deterministic attribution is
a known rare V0 gap: it does not infer which same-form word the learner meant.
When no accepted word matches, a unique known out-of-set word id is retained;
multiple out-of-set matches and unknown text remain unresolved and rejected.

Legacy bad-prompt and definition-production suppression state continues to
govern the meaning-derived fallback and is not cleared by cue application. A
truthfully applied authorized cue may serve without claiming that the legacy
definition exercise was re-enabled. Meaning rows must not be reinterpreted as cue
entities.

A supplement attached to a durable cue is selectable only with that exact
active cue. A fallback supplement is selectable only when the normal fallback
is used, so any active durable cue supersedes both the fallback prompt and its
reinforcement. Supplements do not participate in answer checking, cue random
selection, relevance policy, or scheduling.

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

It is not the durable scheduler object. It is an exact exercise instance inside
one session.

The action id should therefore be named `sessionActionId`, not simply `id`.
It should not be expected to recur across sessions. It only needs to be
persisted where exact traceability is useful, such as attempt events.

Conceptual V0 shape:

```ts
type StudyActionKind =
  | 'recognition'
  | 'production'
  | 'contrast_selection';

type StudyContentRef =
  | { type: 'contrast_prompt'; id: string }
  | { type: 'example_sentence'; id: string }
  | { type: 'production_cue'; taskId: string; cueId: string };

type StudyAction = {
  sessionActionId: string;
  kind: StudyActionKind;
  targetWordId: string;
  sampledSkillIds: StudySkillId[];
  contentRef: StudyContentRef | null;
  legacyReviewItemId?: string;
};
```

`contentRef` identifies supporting prompt/content material. It does not mean
that a study action breaks into smaller action units.

`legacyReviewItemId` is a migration adapter for the current code path. It is
not part of the long-term model. It allows current frontend session behavior
and backend completion routes to be bridged while session composition moves
toward actions and word-skill state.

The core `StudyAction` should not include a scheduling-state reference. Routing
an action result back into scheduler state is backend projection work, not part
of the served exercise's product identity.

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
| `review_items.interval_hours` | V0 word-skill `intervalHours` |
| `review_items.last_reviewed_at` | V0 word-skill `lastStudiedAt` |
| `review_items.next_due_at` | V0 word-skill `nextDueAt` |
| `review_items.ease_factor` | V0 word-skill `easeFactor` |
| `Forgot/Hard/Good/Easy` | attempt event rating for recognition/production |
| learning word coverage | frontend session covering policy over recognition/production actions |
| review item coverage | frontend session covering policy for a scheduled action |
| current frontend commit intent | transitional synchronous projection request |

The first implementation may still read from or mirror `review_items`, but the
architectural goal is for session composition to operate on words, skills, and
study actions rather than review directions.

## 6. Scheduling And Projection State

Near-term scheduling should have two durable levels:

1. word-level admission state
2. word-skill state used by the admission and action-selection policies

The first implementation should avoid making `StudyAction` only a rendering
wrapper around `review_items`. The goal is to move scheduling ownership into
the new model early, while still allowing current `review_items` data to seed,
mirror, or validate the new schedule state during migration.

### Word-Level Admission State

Word-level state controls whether the word can appear in a session at all.

For the first pass, this is mainly needed for `review` words.

Conceptual V0 shape:

```ts
type WordStudyAdmissionState = {
  wordId: string;
  earliestNextStudyAt: string | null;
};
```

`earliestNextStudyAt` enforces word-level recency protection. It is not a skill
due date. It is a gate that can suppress otherwise due skill work for the same
word.

### Word-Skill State

Skill-level state contributes to both word admission and action selection.

It helps determine whether a word is urgent enough to study at all, and it
controls what kind of attention the word currently needs if it is admitted.

Conceptual V0 shape:

```ts
type WordSkillState = {
  wordId: string;
  skillId: StudySkillId;
  enabled: boolean;
  intervalHours: number;
  lastStudiedAt: string | null;
  nextDueAt: string | null;
  easeFactor: number;
};
```

`lastStudiedAt` is required for urgency calculations because urgency depends on
elapsed time since this specific skill was sampled for the word.

`intervalHours` is intentionally legacy-shaped. V0 scheduling still uses
time-based intervals. If future versions move to an abstract strength metric,
that should be a real migration to a new field such as `strengthScore`, not a
hidden semantic change under the old field name.

Successful hard/good/easy interval updates apply a small hour fuzz of
`-1`, `0`, or `+1` with probabilities `0.3`, `0.4`, and `0.3` (clamped to at
least 1 hour) so words that share a base interval do not keep clustering on
the same due times. Lapse resets stay fixed at 6 hours.

`easeFactor` is scheduler trust elasticity. It is not the learner's skill
level directly. It represents how aggressively the scheduler should stretch
the interval after successful evidence for this word-skill pair. Lower ease
means "successful evidence has been less reliable; lengthen cautiously." Higher
ease means "successful evidence has been reliable; give this skill more space."

The current ease update rules are allowed to remain provisional. A better ease
policy is a later candidate for analysis from the event log.

No `updatedAt` field is part of the conceptual model. A table may add ordinary
database bookkeeping columns if useful, but they should not drive scheduling
policy.

### Initial Admission Heuristic

The first heuristic can be:

> A word becomes due when any enabled skill is overdue.

For each enabled skill, compute an urgency value roughly like:

```text
skill urgency = elapsed time since skill study / intervalHours
```

Then compute word urgency as:

```text
word urgency = max(enabled skill urgency values)
```

A word is eligible when:

```text
now >= word.earliestNextStudyAt
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

## Experimental Dual-Pool Unstudied Admission

Status: **experimental** current-implementation contract. This policy is
authoritative for today's unstudied admission ranking and selection. It does
not need to survive a future session-composition rewrite. In-session covering,
undo, and bucket weights remain unaware of diet vs stash.

### Diet vs stash

Two provenances of `unstudied` words:

- **Diet:** unmanaged unstudied words with no `user_word_priority` overlay.
  Ranked by existing corpus/hardcoded `words.priority` (then `created_at`,
  then `id`). Intake triage and the advisor remain diet-only.
- **Stash:** any unstudied word that has a `user_word_priority` overlay
  (add-by-hanzi bump, move-to-top, require, or any other overlay write).
  Overlay membership is stash membership. Stash is **not** ranked by corpus
  frequency. `bump_count` remains stored but does **not** affect admission
  rank (SWI-12 is not implemented).

Sunk/dismissed words (`priority_tier` bottom / `PRIORITY_TIER_SUNK`) are in
**neither** pool and are excluded from scheduling. They keep an overlay row,
but that overlay does not make them stash.

Session composition remains a snapshot. Want-soon / require is not a
mid-session add feature. Covering criteria and the 20% unstudied bucket
weight are unchanged.

### Remaining-quota split

At composition time, compute the existing remaining daily new-word cap
(`configured limit − today's completed new-word count`). Split **that
remaining quota** 50/50, then let existing session logic consume the
admitted unstudied set as its candidate pool.

Rounding:

```text
stash_slots = Math.floor(remaining / 2)
diet_slots  = remaining - stash_slots
```

The odd leftover slot goes to diet. If `remaining` is `0`, this split admits
nobody; require-bypass may still apply.

### Filling the halves

1. **Tops** (move-to-top / force-top) fill the stash half first, newest-first
   by `user_word_priority.updated_at` (UTC ISO). There is no overlay
   `created_at`; any overlay mutation refreshes `updated_at`, so "newest"
   means last overlay write. Tie-break by word `id` ascending.
2. Tops **cannot exceed the stash half**. Extra tops wait until a later
   session. This is a behavior change from "all tops beat everything."
3. Remaining stash slots are a **random sample** of non-top stash. The draw
   happens once per composition. The selected unstudied set is frozen in the
   existing frontend session payload snapshot, so reload/undo/rebuild of the
   same session does not re-roll. Backend composition has no frontend session
   id yet, so the RNG is seeded from `unstudied-admission:${studyDayKey}:${remainingQuota}`
   (stable for identical remaining quota on that UTC day). Tests may depend
   on that seed.
4. If stash cannot fill `stash_slots`, leftover stash slots are filled from
   diet in frequency order.
5. Diet takes `diet_slots` plus any leftover stash slots, frequency-ranked.

The composed unstudied admitted set is:

```text
selected_stash ∪ selected_diet ∪ required_bypass
```

### Require-next-session bypass

Require-next-session is the one interrupt above the mix. Existing require
behavior is kept as a **post-split cap-bypass union**: required unstudied
words that are not sunk still enter even when the cap/split is full,
including when `remaining` is `0`.

Required words are overlay/stash. If the split already selected a required
word, it is **not** double-counted. Extra tops that are also required still
enter via this bypass.

### Non-goals

This experiment does not add:

- keep / skip / park UI
- ETA
- a stash advisor or agent-on-stash
- a user-facing mix-ratio control
- a diet ranker rewrite
- grandfathering of currently-bumped high-frequency words (they become
  lottery tickets in the stash half)

Longer term, the system may target a desired failure rate as a measure of
productive difficulty. A user may eventually be able to choose that stress
level, but the product should avoid steering users toward a demoralizingly low
success rate. As an initial intuition, sustained success below roughly 80%
should probably be treated as too stressful for ordinary daily study.

## 8. Attempt Events And Processing

Attempt events record what the learner actually did.

They should preserve evidence that would otherwise be compressed into an
interval or status update.

An attempt event is granular: one learner response to one served action
appearance. It is not a summary of all in-session progress for an item.

For the initial implementation, durable attempt events should represent
accepted learner evidence after the frontend undo window has closed. The app
does not need to log every transient frontend action or later record undo events
for reverted actions. Stable client-generated event ids and a uniqueness
constraint are enough to keep the storage format future-friendly without adding
full idempotent retry machinery.

Conceptual V0 shape:

```ts
type StudyAttemptOutcome = 'correct' | 'incorrect';

type StudyAttemptEvent = {
  id: string;
  occurredAt: string;
  sessionId: string;
  sessionActionId: string;
  sessionEventSequence: number;
  actionAttemptSequence: number;
  actionKind: StudyActionKind;
  targetWordId: string;
  sampledSkillIds: StudySkillId[];
  response: string | null;
  outcome: StudyAttemptOutcome;
  rating: 'forgot' | 'hard' | 'good' | 'easy' | null;
  contentRef: StudyContentRef | null;
  metadata: Record<string, unknown>;
};
```

`sessionEventSequence` is the monotonic accepted-event order within the session.
`actionAttemptSequence` is scoped to a `sessionActionId` and records repeated
attempts against the same served action.

For a production-cue action, `contentRef` identifies the durable task and cue.
The event metadata snapshots `anchorWordId`, cue type and text,
`acceptedWordIds`, nullable raw submitted text, nullable resolved submitted word
id, the explicit `typed` or `no_clue` response kind, and the deterministic
session-time result, plus the nullable served recheck-demand id. A no-clue
attempt keeps both response fields null and uses the ordinary rejected/Forgot
path. The metadata is historical evidence, not a live lookup into mutable cue
state.

Example production events:

```json
[
  {
    "sessionActionId": "session-42/action-7",
    "sessionEventSequence": 12,
    "actionAttemptSequence": 1,
    "actionKind": "production",
    "targetWordId": "kaocha-2",
    "response": "考查",
    "outcome": "incorrect",
    "rating": "forgot"
  },
  {
    "sessionActionId": "session-42/action-7",
    "sessionEventSequence": 13,
    "actionAttemptSequence": 2,
    "actionKind": "production",
    "targetWordId": "kaocha-2",
    "response": "考察",
    "outcome": "correct",
    "rating": "good"
  }
]
```

The event processor can derive whether the first response was correct by
looking at the first event for a `sessionActionId` or for a specific
session/action grouping. The event itself should use `response`, not
`firstResponse`.

The first migration endpoint may accept a batch containing both accepted attempt
events and the current frontend commit intent. The backend should independently
derive the commit intent from the event batch and reject, or at least fail
loudly in tests, when the derived intent does not match the supplied intent.
This keeps the frontend-owned coverage model in place while proving that the
event shape is sufficient to reconstruct the commit boundary.

Contrast reflection should be a separate event rather than an overloaded field
on attempt events:

```ts
type StudyReflectionEvent = {
  id: string;
  occurredAt: string;
  sessionId: string;
  sessionActionId: string;
  actionKind: 'contrast_selection';
  targetWordId: string;
  reflection: 'clear_now' | 'still_shaky' | 'want_more_practice';
};
```

### Sessions And Processing

A durable study session record can track processing state:

```ts
type StudySessionRecord = {
  id: string;
  startedAt: string;
  endedAt: string | null;
  processingState: 'open' | 'ready_to_process' | 'processed';
  processedAt: string | null;
};
```

Before the backend composes a new session, all accepted projectable events from
earlier sessions must be processed into durable scheduler state according to the
current rules.

The backend may process events immediately while a session is open, when a
session ends, or in a background step. The invariant is catch-up before the next
session starts, not immediate projection after every attempt.

For the first projection checkpoint, processing can run synchronously on the
same cadence as today's commit-worthy unit: once the undo window closes for a
covered review action, the frontend sends the accepted event batch and commit
intent. The legacy commit path can continue updating legacy durable tables such
as `review_items`, while projection updates `word_skill_state` and
`word_study_admission_state`. This makes the new scheduler tables a parallel
projection target rather than a shadow write hidden inside the legacy commit
handler.

Same-session coverage remains frontend-owned. For example, after a review
action lapses, the frontend may require three successful recalls in a row and
then remove the action from the live queue. The backend later reconstructs the
same covered/lapsed result from granular events and projects it into
`WordSkillState` and `WordStudyAdmissionState`.

Interrupted sessions should keep the existing semantics under this commit
cadence. Review units whose accepted event batches have already been processed
remain durable; still-local frontend progress that has not crossed the undo and
commit boundary is not projected.

Learning and unstudied words are intentionally outside the first projection
pass. Their existing commit handlers continue to update `words`,
`daily_new_word_intake`, and related legacy state. Event reconstruction tests for
learning and unstudied coverage can wait until those flows move onto the newer
scheduler-state model.

Attempt events are not a substitute for schedule state in the near term. They
are a durable record that supports projection, analysis, debugging, migration,
and adaptive policy changes.

## 9. Lexical Clusters

Lexical clusters are manually curated groups of related or confusable words.

Examples:

- `严格 / 严肃 / 严峻 / 严厉 / 严谨`
- `考查 / 考察`
- `测验 / 测试 / 考核`

Clusters are content/context objects, not scheduler objects.

A V0 cluster content model should stay deliberately small:

- cluster: `id`, title, optional learner note
- member: `clusterId`, `wordId`, optional nuance note, optional display order
- prompt: `id`, `clusterId`, `targetWordId`, prompt text, explanation

The prompt's `targetWordId` is the correct answer. V0 does not need durable
prompt-choice rows; the action selector can choose one or more sibling words
from the prompt's cluster at serve time.

Cluster membership gives `wordId -> contrast siblings` by taking the other
members of the same cluster or clusters. A prompt plus runtime-selected sibling
choices gives the specific pair, trio, or set used by one exercise. V0 should
not add a separate reusable sibling-set or prompt-choice table unless authored
content later proves that reuse is needed.

Possible relation types:

- similar meaning, different tone/application
- similar sound
- similar characters
- learner-confused pair
- same broad semantic field

V0 should keep these relation types informal or manually assigned. The system
should not attempt to infer a full semantic graph yet.

Cluster membership is the learner's explicit contextual-selection eligibility
decision. Every cluster member has `contextual_selection` relevance `normal`
and an enabled, initialized word-skill scheduler row. Membership creation,
legacy/imported content, and database startup repair enforce that invariant;
the cluster itself still does not become due or carry scheduler state.

When a member word schedules contextual-selection practice, clusters provide
candidate content for the action selector. The selector may use a prompt whose
`targetWordId` is the scheduled word, or a prompt whose `targetWordId` is a
sibling while the scheduled word appears as a distractor.

A served contrast action should separate the scheduling anchor from the prompt's
correct answer:

- `scheduledWordId`: the word admitted by session composition
- `promptTargetWordId`: the prompt's correct answer
- `choiceWordIds`: the runtime choices
- `selectedWordId`: the learner's first choice

This allows a contrast attempt to represent either "use this word here" or "do
not use this word here". Projection may update multiple contextual-selection
word-skill states from one attempt. V0 can start with binary pair updates and
weaken both words in the pair after an incorrect choice.

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
3. The app records the choice as an attempt event.
4. The app shows the correct answer and explanation.
5. The user gives a reflection signal recorded as a reflection event.

Possible reflection signals:

- clear now
- still shaky
- want more practice

The first response should remain the primary assessment signal. If the user
chooses incorrectly right away, the system should treat that as meaningful
evidence even if the explanation makes sense afterward.

### Scheduling Policy

V0 contrast scheduling should be conservative:

- only schedule contrast for words made eligible through cluster membership
- require available contrast content
- prefer words already in learning or review
- avoid damaging recognition/production progress after contrast failure
- update contextual-selection state and confusion evidence instead

Specific nouns and other low-ambiguity words may never need contrast training.
The user opts words into richer differentiation training by adding them to a
cluster and opts them out by removing them from every cluster. The former
generic `suppress_skill` management action is not available for contrast
selection; production suppression remains independent.

## 11. Mistake Capture

Production mistakes are an important source of contrast candidates.

When the learner types the wrong Hanzi for a production action, the app should
eventually offer a way to capture the mistaken answer as a possible contrast
candidate with the target word.

Example:

- target: `考察`
- user enters: `考查`
- app records that this pair may deserve contrast training

There are two useful versions of mistake capture.

The early version is a lightweight evidence capture path for the current app.
It does not need to wait for word-skill state, study actions, or durable
attempt events. Its purpose is to let real study sessions start producing seed
data for future cluster curation as soon as possible.

The long-term version should integrate with study actions and attempt events,
so each captured mistake can point back to the exact served action and response
event that produced it.

Early V0 mistake capture can be crude. It may simply persist:

- target word id
- attempted Hanzi
- matched word id, if the attempted Hanzi exists in the corpus
- source event id, once event logging exists
- timestamp
- user note

This can begin producing useful data before full contrast drills are built.
One-off scripts can later migrate captured mistakes into clusters and contrast
prompt content.

The production/session-management action `add_contrast_candidate` was this
intake-capture path (not a cluster-editor membership action). Live capture and
the projected intake triage UI/API are retired; historical
`contrast_candidate_intake` rows may remain readable as legacy storage. Actual
cluster membership still makes the all-member eligibility invariant apply.

The first durable attempt-event milestone does not need to backfill or
heuristically connect existing JSONL mistake candidates to source events. A
future SQLite-backed candidate model may add an optional source attempt event id
for newly captured mistakes when that id is naturally available from the
production attempt flow.

## 12. Implementation Roadmap

This is the historical implementation sequence that produced the current
study-action substrate. It is retained pending a dedicated spec-organization
pass; it is not the current project roadmap or stability frontier.

### Phase 0: Frontend Foundation Cleanup

- split the monolithic `App.tsx` into smaller page, session, and UI modules
- preserve current user-visible behavior
- extract session orchestration enough that future study actions do not have to
  be threaded through one large component
- keep React for now; defer framework and global state-management decisions
  until the product/state boundaries are clearer
- verify the existing app still builds and relevant tests still pass

### Milestone 1: Domain Types And Legacy Adapters

- add TypeScript domain types for `StudySkillId`, `StudyActionKind`,
  `StudyAction`, `StudyContentRef`, `WordStudyAdmissionState`,
  `WordSkillState`, `StudyAttemptEvent`, `StudyReflectionEvent`, and
  `StudySessionRecord`
- add pure mapping helpers for current review directions:
  - `forward` -> `recognition`
  - `reverse` -> `production`
- add pure adapter helpers that can turn a current `ReviewItem` plus `Word`
  into a V0 `StudyAction` with a migration-only `legacyReviewItemId`
- keep API payloads, database schema, and user-visible behavior unchanged
- add focused tests for mapping and adapter invariants

### Milestone 2: Early Production Mistake Capture

- add lightweight persistence for production mistake candidates
  - initial implementation may use append-only JSONL in the active data
    directory instead of SQLite
  - each line should keep enough context for later curation/migration rather
    than only storing a bare Hanzi pair
- capture wrong production input from the current session flow without requiring
  durable study actions or attempt events
- store target word id, attempted Hanzi, optional matched word id, timestamp,
  and optional note
- expose a minimal dev/admin review surface or script for inspecting captured
  candidates
- later, add optional source event ids once attempt event logging exists

### Milestone 3: Persist Word Admission And Word-Skill State

- introduce explicit word-level admission and word-skill tables
- backfill recognition and production skill state from existing `review_items`
- use `review_items.interval_hours`, `last_reviewed_at`, `next_due_at`, and
  `ease_factor` as the initial source for V0 skill state
- maintain a transitional shadow update path from current completion handlers
  so newly completed review/learning work keeps word-skill state fresh before
  milestone 4 switches session composition reads
- keep `review_items` mirrored or validated during the migration
- add tests that prove new state is created for existing review words and kept
  consistent with current completion behavior

### Milestone 4: Compose Sessions Through Word Admission And Study Actions

- update session composition so `review` words are admitted at the word level
  using `WordStudyAdmissionState` and `WordSkillState`
- choose the most urgent enabled skill after word admission
- emit study actions as the conceptual session units
- keep legacy review-item ids only as adapter data needed by the current
  frontend/backend completion path
- keep learning and unstudied covering rules intact
- keep user-facing behavior mostly unchanged

### Milestone 5: Durable Attempt Events And Projection Checkpoint

- add durable study session and attempt event storage
- log accepted post-undo recognition and production attempt events for review
  actions at response granularity
- give attempt events stable ids and store them with a uniqueness constraint,
  without building full exactly-once retry or batch-idempotency machinery
- accept transitional batches that include both accepted attempt events and the
  frontend commit intent; derive the commit intent from the events and validate
  that the two agree
- add the processing invariant: before composing a new session, all prior
  accepted review attempt events must be projected into durable scheduler state
- initially allow projection to happen synchronously in the same backend request
  path and on the same cadence as today's covered-review-item commit
- keep the legacy commit path responsible for legacy tables such as
  `review_items`; remove scheduler-state shadow writes from that path so event
  projection is responsible for `word_skill_state` and
  `word_study_admission_state`
- keep learning and unstudied word completion on the existing commit paths for
  this milestone; do not require durable attempt-event projection for those
  flows yet
- avoid adding a durable "commit" table unless a real audit/debugging need
  emerges between raw events and projected scheduler state
- defer production mistake source-event linking unless it falls out naturally
  for new candidate rows; do not backfill existing JSONL candidates
- add tests that derive review commit intents from granular events, reject
  mismatched supplied commit intents, and verify that projection keeps the new
  scheduler tables behaviorally parallel to legacy review-item commits

### Milestone 6: Retire Or Demote Review Items

- update projection paths to update word-skill state directly
- decide whether `review_items` still have any durable role
- remove `review_items` if word-skill state fully replaces them
- otherwise keep them only as a compatibility or diagnostic view, not as the
  session composition root

### Milestone 7: Manual Cluster Content

Milestones 7 and 8 should also introduce relevance-aware action feedback.
`production` remains the skill name, but the current reverse-card production
action is more precisely `definition_based_production`. Contextual selection is
the first richer skill dimension, while suppressing low-value or ambiguous
definition-based production prompts is independently useful even when no
contrast content exists.

See
[`milestone-7-8-relevance-aware-contrast-plan.md`](./archive/milestone-7-8-relevance-aware-contrast-plan.md)
for the implementation plan.

- add lexical cluster tables
- add cluster members
- add cluster notes
- add manual contrast prompt content
- seed a tiny dev/test cluster set

### Milestone 8: First Contrast Selection Drill

- add contextual-selection word-skill state for manually eligible words
- add contrast selection actions
- add reflective feedback UI
- log choice attempts and reflection events
- update contextual-selection state only
- schedule contrast conservatively for manually eligible words with available
  contrast content

## 13. Non-Goals For The First Pass

These were scope exclusions for that historical implementation sequence, not
current project-level non-goals. Current-wave scope is defined in
[`STABILITY_FRONTIER.md`](../STABILITY_FRONTIER.md).

- full event sourcing
- automatic prompt generation
- automatic naturalness grading
- full synonym/confusable-word graph
- cluster-level scheduling
- public multi-user service work
- polished cluster management UI
- comprehensive stats dashboards
- a finalized ease-factor update policy

## 14. Open Questions

These remain possible study-action follow-ups, not current focus decisions.

1. When should learning and unstudied flows move from legacy commit handlers
   into durable attempt-event projection?
2. What is the smallest useful implementation step toward wall-clock budgeting
   and dynamic session payloads?
3. Should event projection maintain a separate diagnostic table of derived
   per-session outcomes, or are raw events plus current scheduler state enough?
