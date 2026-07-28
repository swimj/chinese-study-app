# Workflow Appendix Fixture Gaps

This report covers the first fixture pass derived from examples 1–15 in
`notes/active/2026-07-06-session-reflection-workflow.md`, plus separately sourced
exploratory stress cases.

## Corpus status

- All 15 appendix-derived fixtures are ready for an initial provider comparison.
- 1 additional, user-supplied fixture is ready in exploratory mode.

The exact counts are enforced by `validate-fixtures.ts` and should be updated if
fixture readiness changes.

## Field-specific gaps

### Attempt outcomes after the initial failure

The appendix records the initial submitted answer but generally does not record
whether the target was recalled later, how many reinforcement attempts occurred,
or the terminal rating. Fixtures therefore use one incorrect attempt with
`resolution: 'unknown'`. This is structurally valid dummy metadata, not evidence
about recovery.

### Durable cue identity

No appendix example supplies a durable cue id. All fixtures use `cueId: null` and
the captured text as the cue reference. This matches the M0 bundle contract.

### Existing contrast and answer-class content

The appendix does not state whether any pair already belongs to a contrast
cluster or has accepted alternates. Fixtures use empty content arrays. As a
result, the corpus tests new cluster creation and does not test whether a model
avoids duplicating existing content.

### Study-history evidence

The appendix sometimes says a word is new, a pair has been slow to acquire, or
a confusion may be one-off. The M0 bundle deliberately omits recent-history
summaries because current attempt history is incomplete. These judgments enter
fixtures only through `sessionNote`, where the learner explicitly supplied them;
they are not represented as deterministic history.

### Correct-response attempt linkage

Example 8 is represented as a `session_note` item with `linkedAttemptId: null`.
The appendix says the answer was correct but supplies no durable attempt id. The
fixture still tests whether a model can respond to explicitly flagged
uncertainty without treating it as a grading failure.

## Category gaps

The appendix does not provide clean coverage for:

- unmatched free-text submissions
- a case where a clarifying question and an unrelated safe proposal should
  coexist
- contrast-selection reflection items

These should become small synthetic or newly captured fixtures after the
appendix-derived corpus is reviewed. They should not be retrofitted onto an
appendix case whose original judgment did not exercise that category.

The separately sourced 长江 / 扬子江 stress case covers diagnosis without a
registered operation when the cue leaks the target reading and the intended
competency remains unclear. It deliberately mixes answer leakage, a valid but
context-limited alternate name, proper-name production policy, and missing
learner-goal information. Evaluation requires the model to surface those layers
and ask what competency is intended; it may propose cue repair only with a
genuinely concrete, goal-specific draft. It is exploratory rather than a hard
single-answer provider bar.

## Explicitly deferred integration coverage

The first provider decision will focus on the common initial-production-confusion
case. The following require history or existing-content enrichment and are
deliberately deferred rather than treated as missing provider-spike prerequisites:

- extending an existing contrast cluster (not a V1 operation)
- avoiding duplicate content when a suitable cluster or prompt already exists
- stale or invalid durable references
- history-informed judgments after earlier cue repairs or repeated confusion
- cue diagnoses without a concrete repair draft when a later cue model could
  give them a durable target

The current corpus should establish whether a model can make the core linguistic
diagnosis, select an appropriate handle, and draft useful new content. If that
works, the deferred cases can later test grounding and conflict resolution over
richer application state without reopening the initial provider shortlist.

Ordinary no-clue events are not a corpus gap. M0 bundle assembly intentionally
excludes them because they normally indicate direct forgetting without a clear
reflection action. An explicit session note can still elevate a recurring or
surprising no-clue pattern.

## Distribution gap

Examples 11–15, plus example 4, repeatedly exercise the same high-level pattern:

```text
English cue overlap hides a useful Mandarin boundary
  -> repair the production cue
  -> independently author contextual contrast content
```

That repetition is useful for testing linguistic breadth across commercial,
technical, spatial, and emotional distinctions. It should not be mistaken for a
balanced handle-selection corpus. In particular, the current set will reward a
model that often proposes cue repair plus contrast content unless the separate
no-action, alternate, form-interference, and question cases are weighted
deliberately during evaluation.

## Judgment clarifications

### Example 6: 落成 / 建成

The learner subsequently clarified the expected judgment. 建成 is a valid term
for completing a construction project, but 落成 has a substantially more formal
tone and register. The case is not a true lapse. It now requires
`repair_production_cue` with `add_contextual_triangulation`; an official or
ceremonial announcement frame, or an explicit formal-register hint, provides the
distinguishing context. Contrast content is allowed but not required.

### Example 7: 给（jǐ） / 供应

The learner subsequently clarified that isolated definition-based production of
给 in the jǐ reading is low value even around B2/C1, while recognition remains
useful because the reading appears in common lexical items such as 自给自足 and
供给. The fixture now requires `suppress_definition_production` with
`low_value_for_learner`; it must not imply that recognition is suppressed.

The learner also identified a possible future compound capability: suppress a
low-value production target while prioritizing a more useful related unstudied
lexical item. That capability is parked in `TASKS.md` and is deliberately not
part of this fixture's provider test bar. The reference result records it as an
optional `unhandledNeed`, which can later become a developer-facing handle-gap
artifact. A model is not required to discover it in this provider comparison.

The current bundle can express the desired capability gap, but it cannot safely
claim that a particular related expression is unstudied or should be prioritized.
That stronger recommendation needs related-word study status and an applicability
or frequency signal from bundle enrichment. Prompt and enrichment iteration,
rather than base-model selection, should own that later test.

### Prompt-authored Mandarin examples

The contextual prompts in `referenceResult` are first-pass drafts produced from
the appendix's linguistic interpretation. They have not been native-speaker
reviewed. Provider evaluation should initially score whether a candidate model
selects the right operation and articulates the intended boundary; prompt-level
naturalness should be reviewed separately before treating these drafts as gold.

## Result-contract observation

The fixture validator implements the agreed completeness rule:

```text
Every input bundle item appears exactly once in itemResults.
No itemResults exist for unknown item ids.
```

Cross-item discovery is intentionally absent from this corpus. A later freeform
session-level observation can explore whether models find useful cross-item
patterns before any cross-item structured contract is introduced.
