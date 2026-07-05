# Milestone 7/8 Implementation Slices

**DONE (archived).** Contrast/relevance milestone complete as far as product owner is concerned; any remaining gaps in this checklist are non-pressing.

Status: completed development sequencing plan (archived).

This document breaks the relevance-aware contrast practice work into pared-down
implementation units. It is intentionally separate from the product plan so the
product spec can remain useful after the initial implementation is complete.

Related documents:

- [`milestone-7-8-relevance-aware-contrast-plan.md`](./milestone-7-8-relevance-aware-contrast-plan.md)
- [`study-action-model.md`](/Users/jw/dev/chinese-study-app/SPECS/study-action-model.md)

## Development Order

### 1. Contrast Selection Data Model

Add durable cluster and contrast-content tables plus matching domain types.

Include:

- `contrast_clusters`
  - `id`
  - `title`
  - optional cluster-level note
- `contrast_cluster_members`
  - `cluster_id`
  - `word_id`
  - optional member-level nuance note
  - optional display order
  - unique membership per `(cluster_id, word_id)`
- `contrast_prompts`
  - `id`
  - `cluster_id`
  - `target_word_id`
  - prompt text
  - explanation

Keep the initial invariants explicit:

- every prompt target must be a member of the prompt's cluster
- a prompt's correct answer is `target_word_id`
- a usable prompt for a scheduled word must either target that word or target a
  sibling while including the scheduled word as a runtime distractor
- a served prompt must have at least two runtime choices

Derived concepts should stay derived in the first pass:

- `wordId -> contrast siblings` is the set of other members in the word's
  clusters
- `(sibling pair/trio/set) -> exercise content` is represented at runtime by a
  prompt plus dynamically selected sibling choices

Keep the served action identity explicit:

- `scheduled_word_id`: the word admitted by session composition
- `prompt_target_word_id`: the correct answer from the selected prompt
- `choice_word_ids`: the runtime choice set
- `selected_word_id`: the learner's first choice, recorded with the attempt

Allow projection from one contrast attempt to touch multiple
contextual-selection word-skill states. V0 can start with binary pair updates:
when the learner chooses incorrectly between the scheduled word and one sibling,
weaken contextual selection for both words in the pair.

Do not add cluster-level scheduling state, prompt statistics, automatic relation
types, a reusable sibling-set table, or durable prompt-choice rows in this
slice. Prompt enabled/suppressed state can wait for the feedback slice unless it
is nearly free to include as a plain `active`/`suppressed` content status.

This comes first because every later slice needs stable content references.

### 2. Initial Seed Data And Inspection Script

Populate a tiny hand-authored cluster set and add a minimal way to inspect or
validate it from development tooling.

Include:

- two to four clusters
- a few prompts per cluster
- seed or fixture data for local/dev use
- a read-only list/validate script

This validates the data model before UI and scheduler behavior depend on it.

### 3. Minimal Cluster Management UI

Add just enough management UI to view and maintain contrast content.

Include:

- list clusters
- view members and notes
- view, create, and edit contrast prompts
- disable or suppress bad prompts

Do not build a polished authoring workflow yet. Manual content quality is
important enough to need a small surface, but not enough to justify a large CMS
style feature.

### 4. Skill Relevance Model

Add per-word skill relevance or preference state independent of scheduler
strength.

Include:

- recognition remains the default floor
- production can be normal, deprioritized, or suppressed
- contextual selection can be enabled, deprioritized, or suppressed
- recognition-only state
- production meta-feedback values from the product plan

This is the core "do not waste my attention" primitive and is useful even
before contrast drills are served.

### 5. Action And Prompt Feedback Model

Record action/content quality feedback separately from correctness.

Include:

- `bad_prompt` for `definition_based_production`
- `bad_prompt` for contrast prompts
- `stop_contrast`
- target-word scoped feedback
- content-scoped feedback

This keeps projection and scheduling policy from confusing a weak skill with a
bad or low-value action.

### 6. Scheduler Eligibility Updates

Teach action selection to respect relevance, suppression, and content
availability.

Include:

- do not reschedule suppressed production merely because it failed
- allow recognition-only words
- make contextual selection eligible only when enabled and prompt content exists
- avoid replacement busywork when no useful richer action exists

This changes behavior with the existing action set before introducing the new
live drill.

### 7. Contrast Selection Action API

Expose contrast actions through session composition.

Include:

- action kind `contrast_selection`
- content reference to the contrast prompt
- choices and target answer payload
- sampled skill `contextual_selection`

Keep the frontend flow minimal until the API shape is stable.

### 8. Contrast Selection Live Flow

Build the actual drill experience.

Include:

- show prompt and choices
- record the first choice
- reveal answer, explanation, and relevant notes
- collect reflection: `clear_now`, `still_shaky`, `want_more_practice`
- collect meta-feedback: `bad_prompt`, `stop_contrast`

This is the first complete user-visible version of contextual-selection
practice.

### 9. Event Logging And Projection For Contrast

Persist contrast attempts/reflections and update only contextual-selection
state.

Include:

- contrast attempt events
- reflection events
- projection into contextual-selection word-skill state
- no recognition or production weakening from contrast failure

This makes the new drill scheduler-connected and analyzable.

### 10. End-To-End Tuning Pass

Use the first full loop to tune behavior and clean up rough edges.

Include:

- scheduling frequency sanity checks
- UI copy and affordance cleanup
- seed content adjustments
- focused tests around suppression, eligibility, and projection

This should come after the full path exists, because the most important product
rough edges will only show up once real sessions can exercise it.

## Suggested Implementation Tranches

For conservative delivery, group the slices into three threads or PRs:

1. Content foundation: slices 1-3.
2. Relevance-aware scheduler: slices 4-6.
3. New drill flow: slices 7-9, followed by slice 10 as a tuning pass.
