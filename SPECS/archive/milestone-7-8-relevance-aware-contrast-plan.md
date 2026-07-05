# Milestone 7/8 Plan: Relevance-Aware Contrast Practice

**DONE (archived).** Contrast/relevance milestone complete as far as product owner is concerned; any remaining gaps in this plan are non-pressing.

Status: completed product and implementation plan (archived).

This plan covers the milestone-7 and milestone-8 expansion from simple
recognition/production scheduling into relevance-aware contextual
disambiguation.

Related documents:

- [`study-action-model.md`](/Users/jw/dev/chinese-study-app/SPECS/study-action-model.md)
- [`learning-review-model.md`](/Users/jw/dev/chinese-study-app/SPECS/learning-review-model.md)
- [`session-covering-criteria.md`](/Users/jw/dev/chinese-study-app/SPECS/session-covering-criteria.md)
- [`milestone-7-8-implementation-slices.md`](./milestone-7-8-implementation-slices.md)

## Goal

Milestones 7 and 8 should add the first visible drill for contextual
disambiguation while also teaching the scheduler that not every failed action is
worth repeating.

The product outcome is:

- suppress low-value or ambiguous definition-based production prompts
- allow words to be effectively recognition-only when that matches the user's
  current goal
- promote contextual-selection practice when useful cluster content exists
- avoid substituting busywork when richer content is unavailable

This is not a general solution for open-ended production, LLM grading, or
automatic synonym discovery. It is the smallest useful step toward a scheduler
that distinguishes skill strength, word-skill relevance, and action/content
quality.

## Core Model Decisions

The durable skill set remains:

```ts
type StudySkillId = 'recognition' | 'production' | 'contextual_selection';
```

The V0 skill-to-action mapping remains effectively one-to-one, but the action
names should be precise enough to avoid overclaiming what is being measured:

| Skill | V0 action | Meaning |
| --- | --- | --- |
| `recognition` | `recognition` | Understand the word when seeing it. |
| `production` | `definition_based_production` | Produce the target from a definition-like cue. |
| `contextual_selection` | `contrast_selection` | Select the appropriate word from confusable alternatives. |

`production` remains the skill name because future actions may sample broader
active-use ability. The current reverse-card shape is more specifically
`definition_based_production`; it is often useful, but it is not always a fair
or valuable production probe.

Attempt outcome, word-skill relevance feedback, and action/content quality
feedback are conceptually separate:

- attempt outcome: how the learner performed on the served action
- word-skill relevance feedback: whether this skill is worth drilling for this
  word now
- action/content quality feedback: whether this action or prompt was a useful
  way to sample the skill

Early endpoints may carry these signals together for implementation simplicity,
but projection code should keep the meanings separate.

## Relevance And Meta-Feedback

Production meta-feedback applies to `definition_based_production` actions.

| Feedback | Effect |
| --- | --- |
| `recognition_only` | Suppress or strongly deprioritize production for this word. |
| `enable_contrast` | Mark contextual selection relevant for this word when content exists. |
| `prefer_contrast_over_production` | Enable contextual selection and deprioritize definition-based production. |
| `bad_prompt` | Suppress the specific prompt/action shape without treating failure as ordinary production weakness. |

These feedback values should not require replacement content. For example, a
surname or specialized term can become recognition-only without entering a
cluster.

Contrast meta-feedback applies to `contrast_selection` actions.

| Feedback | Effect |
| --- | --- |
| `stop_contrast` | Disable or strongly deprioritize contextual selection for the scheduled word only. |
| `bad_prompt` | Suppress the specific contrast prompt while leaving contextual selection relevant. |

`stop_contrast` is scoped to the word admitted by session composition. It does
not disable contrast practice for siblings in the same cluster.

The important scheduling invariant is:

> A failure should reschedule a skill only when the user accepts the action as a
> fair and useful sample of that skill.

## Manual Cluster Content

Milestone 7 adds manually curated lexical cluster content. Clusters are content
objects, not scheduler objects.

V0 should keep the contrast content model small enough to inspect directly:

- `ContrastCluster`
  - `id`
  - `title`
  - optional cluster-level note
- `ContrastClusterMember`
  - `clusterId`
  - `wordId`
  - optional member-level nuance note
  - optional display order for authoring/readability
- `ContrastPrompt`
  - `id`
  - `clusterId`
  - `targetWordId`
  - prompt text
  - explanation

The correct answer is `ContrastPrompt.targetWordId`. V0 does not need durable
prompt-choice rows. When a contrast action is served, the action selector can
choose one or more sibling words from the prompt's cluster and present the
runtime choices as the target word plus those siblings.

This gives the app the three necessary relationships without adding extra
content graph machinery:

- membership: `wordId` belongs to one or more clusters
- siblings: a word's contrast siblings are the other members of those clusters
- exercise content: a prompt plus runtime-selected sibling choices defines the
  concrete pair, trio, or set being tested

V0 does not need a separate durable "sibling set" or "prompt choice" entity. If
authored content later proves that a specific prompt requires a specific
distractor set, that can be introduced after the pressure is real.

A word may belong to a cluster without contextual selection being enabled. A
word may also have contextual selection enabled but not be scheduled until a
usable prompt exists.

Contrast selection remains scheduling-word driven, but the scheduled word does
not need to be the correct answer for every served prompt. When the scheduler
decides that `contextual_selection` is due for a specific word, the action
selector may use that word's cluster membership to find either:

- a prompt whose `targetWordId` is the scheduled word
- a prompt whose `targetWordId` is a sibling, with the scheduled word included
  as a distractor

This avoids making the correct answer predictable from review timing alone and
lets the drill test both "use this word here" and "do not use this word here".
The cluster itself does not become due.

To keep projection unambiguous, a served contrast action should distinguish:

- `scheduledWordId`: the word admitted by session composition
- `promptTargetWordId`: the prompt's correct answer
- `choiceWordIds`: the runtime choice set shown to the learner
- `selectedWordId`: the learner's first choice

Projection can update multiple word-skill states from one contrast attempt. In
the initial product policy, an incorrect binary contrast attempt may weaken
contextual selection for both words in the pair. Multi-choice projection can
start conservatively by updating the scheduled word and the prompt target, then
be refined once real data shows whether all displayed distractors should also
move.

The first seed set should stay tiny and manually authored. Its purpose is to
exercise the product and scheduler behavior, not to build a comprehensive
semantic graph.

## Contrast Selection Drill

Milestone 8 adds the first contextual-selection action:

1. Serve a short context prompt for one target word.
2. Show choices from the relevant cluster or a subset of the cluster.
3. Record the first choice as the assessment attempt.
4. Reveal the correct answer, explanation, and relevant nuance notes.
5. Collect optional reflection:
   - `clear_now`
   - `still_shaky`
   - `want_more_practice`
6. Allow optional meta-feedback:
   - `bad_prompt`
   - `stop_contrast`

Projection behavior:

- correctness updates only `contextual_selection`
- reflection may influence contextual-selection urgency or ease
- contrast failure must not weaken recognition or production
- `bad_prompt` suppresses the prompt
- `stop_contrast` disables or strongly deprioritizes contextual selection for
  the scheduled word only

The first response remains the primary assessment signal. Later reflection can
shape scheduling pressure, but it should not erase the evidence of the initial
choice.

## Scheduler Behavior

When a word is admitted for study, the action selector should choose only from
actions that are:

- backed by an enabled or relevant skill for the word
- not suppressed or strongly deprioritized by user feedback
- supported by available content when the action requires content
- due or urgent enough under the relevant word-skill state

If no richer action is available or useful, the scheduler should not substitute
busywork. Recognition-only is a valid state for a word.

Contextual selection should be scheduled conservatively:

- only for manually eligible words
- only when contrast content exists
- preferably for words already in learning or review
- without damaging recognition or production state after contrast failure

## Implementation Acceptance Criteria

A minimal successful implementation should prove:

- the user can suppress or deprioritize definition-based production for a word
- suppressed production is not rescheduled merely because of failure
- the user can mark a word recognition-only
- the user can enable contextual selection when cluster content exists
- manually seeded cluster prompts can be served as contrast drills
- contrast drills record choice attempts and reflection
- contrast failures update contextual-selection state only
- bad contrast prompts can be suppressed without disabling the whole skill
- existing recognition and ordinary production behavior remains intact for
  words that do not receive meta-feedback

## Non-Goals

These milestones should not solve:

- open sentence production
- LLM grading
- automatic cluster generation
- automatic synonym or confusable-word graph construction
- refined English definition prompt authoring
- polished cluster management UI
- multi-user prompt statistics
- a finalized production taxonomy
