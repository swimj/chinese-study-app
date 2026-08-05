# Current Stability Frontier

## Near-term product outcome

Dogfood one learner-approved production-cue repair loop:

```text
completed production attempt with a misleading or overloaded cue
  -> post-session reflection proposes a concrete cue repair
  -> asynchronous learner review and explicit authorization
  -> faithful, versioned application to durable learner-owned cue content
  -> a later production action presents the repaired cue
  -> attempt evidence identifies the exact production task and cue used
```

The first useful cue outcome is not a final multi-sense exercise ontology or a
general content-authoring system. It is one real repair that improves a later
learner-facing production exercise without mutating lexical meanings, creating
an independent cue scheduling stream, or rewriting what earlier attempts
tested.

## Current gap and focus

The post-session reflection steel thread is implemented, and the V0
production-task/cue design is accepted in
[`PLANS/swi-24-production-task-cue-contract.md`](PLANS/swi-24-production-task-cue-contract.md).
No durable cue vertical is implemented yet. New reflection still emits
`repair_production_cue@1`, accepted cue repairs remain truthfully unsupported,
and production actions still use meaning-derived prompts without durable
task/cue identity.

The next implementation focus is the complete bounded vertical: immutable cue
persistence and lifecycle; direct V2 reflection generation, review, and
application; active-cue serving and snapshot-based answer checking; exact
served-action and attempt snapshots; append-oriented cue evidence with a shadow
projector; and one replaceable reconciliation seam into the existing word
scheduler.

Two details remain explicit human-gated orientation decisions before
substantial implementation:

- the exact nested `repair_production_cue@2` wire schema, including related
  cue-evidence judgment and effect-reference shapes; and
- the first bounded word-scheduler response for accepted anchor, accepted
  non-anchor, and rejected multi-answer submissions.

These gates choose faithful representations and a temporary policy inside the
accepted boundary; they do not reopen the cue model or authorize a scheduler
redesign. The implementation task remains Yellow until the human confirms both
at orientation, then may proceed as a dynamically structured Graphite stack.
Its task-specific dispatch context should be composed with the reusable
[`stacked feature development and review model`](docs/stacked-feature-development-and-review.md).
The portfolio item is SWI-26; neither that item nor this reference asserts that
work has been dispatched.

## Settled enough to build against

- The implemented post-session generation boundary is defined in
  [`SPECS/session-reflection-generation.md`](SPECS/session-reflection-generation.md).
  Reflection remains best-effort and outside study-session correctness.
- The implemented proposal, authorization, application, and provenance
  lifecycle remains authoritative in
  [`SPECS/reflection-proposals-and-handles.md`](SPECS/reflection-proposals-and-handles.md).
- Words and word-skill state remain the source of scheduling demand. A study
  action is the exact served exercise instance; cues are supporting content,
  not independently scheduled SRS objects. See
  [`SPECS/study-action-model.md`](SPECS/study-action-model.md).
- V0 has one `default_production` task per word as a content anchor, with an
  explicit seam for later sense-specific tasks. It is not a separately
  scheduled object and does not make word and task permanent synonyms.
- A task may own multiple simultaneously active immutable cues. V0 randomly
  selects one after the word is admitted. Cue content has explicit create,
  replace, and deactivate lifecycle effects; deactivation is terminal logical
  deletion, while immutable cue rows and lifecycle facts remain retained for
  provenance. Revision creates a new cue id and leaves unrelated cues unchanged.
  Any later cue with the same or similar content is an ordinary new create with
  no lifecycle continuity with the deleted cue.
- V0 cue types are `definition_gloss`, `minimal_context`, and `circumstance`.
  A `definition_gloss` may narrow to an anchored sense; register and domain
  details belong in cue text rather than a separate type. Each cue has an
  accepted set of known visible words that includes the task word as scheduling
  anchor.
- The current definition-gloss production prompt remains base compatibility
  fallback content, not a cue row. It serves only when no durable cue is active
  and remains governed by existing bad-prompt and production-suppression state.
- Every V0 cue uses the same answer-checking rule: accept a submission only when
  it matches the accepted-word set snapshotted on the served action. Out-of-set
  responses remain incorrect for that session; later learner authorization may
  replace the cue with an expanded accepted set and append a judgment, but never
  rewrites the attempt or scheduler effect.
- `repair_production_cue@1` remains readable and unsupported. New reflection
  generation uses V2 directly; any later V1 migration uses supersession and a
  fresh authorization rather than reinterpretation.
- Cue evidence is append-oriented and may feed asynchronous shadow projection.
  V0 scheduling does not consume that shadow state, so temporary divergence
  from word strength and interval state is explicit and acceptable.
- Provider credentials and calls remain on the backend. Model output is
  untrusted input and must pass strict local validation before it can become a
  proposal or authorized operation.
- Production-mistake reflection supplies only the target word and exact served
  cue to the provider; the trusted boundary derives the V0 task id. Other active
  or inactive cues are not causal evidence for that attempt and must not broaden
  provider proposal authority.
- The model retains proposal-only authority. Cue content originating in
  reflection becomes selectable study content only through explicit
  authorization, a supported adapter, and a truthful applied effect.
- Current reflection batching, model choice, cost estimates, and run logging are
  provisional dogfood mechanisms. Cue work must not require expanding them into
  a planner or multi-agent reflection architecture.
- SQLite is sufficient for the first personal dogfood. Hosted tenancy and
  Postgres follow only after the agentic core proves useful on personal data.

## Invariants and constraints

- Existing study-session behavior remains correct if reflection generation or
  cue application fails, times out, produces invalid output, or is never
  reviewed.
- Every durable operation requires explicit user authorization and domain-level
  validation at application time.
- An accepted handle may remain unapplied when no adapter exists; the UI and
  persistence model must not imply that acceptance changed study state.
- The original evidence, model/prompt/schema versions, original proposal,
  user-authorized operation, disposition, and actual effect must remain
  distinguishable wherever they materially differ.
- Production-task identity, cue presentation, accepted-answer policy, and
  scheduling state must not be collapsed merely because the first vertical
  starts with one task per word and a finite accepted-word set.
- Applying or revising a cue must not mutate broad lexical meanings, reset or
  fork word-skill scheduling state, or retrospectively reinterpret an earlier
  attempt. New cue content is immutable; destructive deletion is excluded.
- A served production action and its durable attempt evidence preserve the
  exact task id, cue id, cue type and text, accepted-word set, anchor word, raw
  submission, nullable resolved word, and session-time result used at that
  time. Later replacement, deactivation, or authorization cannot change that
  record.
- Model judgment never enters the live-session grading path. Model-generated
  cue content or accepted-answer changes become selectable only after explicit
  learner authorization and truthful application.
- Cue attempts and later judgments are append-oriented facts. Withdrawal or
  supersession uses compensating records rather than editing prior evidence.
- The provisional word-scheduler response must stay behind a replaceable seam
  and must not be represented as permanent cue semantics.
- Session composition may consume content caused by a reflection invocation
  only when the invocation has a truthful applied effect. Accepted-but-
  unsupported operations never create selectable study content.
- Until content ownership and customization policy is settled, operations that
  customize learner or content state must preserve the distinguishability of
  base state, user-authorized change, and applied effect. User-visible removal
  or replacement should remain reversible unless true deletion is explicitly
  intended. Production-cue deactivation is such a logical deletion in this
  wave: the facts remain retained, and any later cue creation is independent of
  the deleted cue rather than a reactivation of its identity. See the
  [`hosted-beta tenancy table map`](PLANS/hosted-beta-tenancy-table-map.md#near-term-deferral-constraint-preserve-the-layers)
  for rationale and boundaries.
- Existing manual management paths must not conflict with the handle lifecycle
  or create effects that reflection application cannot reconcile truthfully.
- Initial implementation should remain narrow and reversible. Sticky operation
  payload and identity decisions deserve more care than the storage substrate.

## Explicit non-goals for this wave

- A complete multi-sense production-task ontology or universal cue model.
- General production-alternate grading or answer classes beyond a cue's
  explicit accepted-word set; retrospective word-scheduler credit; free-form
  accepted phrases or expressions; and hot-path model naturalness judgment.
- Cue-aware due queues, independent cue scheduling, a full word-scheduler
  redesign, arbitrary-distance Undo, or treating the provisional scheduler
  response as durable policy.
- Sense-specific production tasks, task re-anchoring, destructive cue deletion,
  or learner-visible migration of historical V1 cue proposals.
- A standalone manual cue-authoring surface beyond the editable reflection
  proposal path.
- A cue marketplace, shared/public cue publication, or automatic migration of
  existing bad-prompt reports.
- Removing the current definition-gloss fallback or manual bad-production-
  prompt escape hatches for unaffected words.
- Multi-agent reflection, planner/debate loops, or content-authoring
  specialists.
- Time-budgeted session planning or autonomous scheduling changes.
- Hosted-tenancy implementation, authentication, Postgres migration, or beta
  deployment. The bounded ownership-map task may proceed as pre-design but must
  not expand into implementing these areas.
- A comprehensive evaluation harness or automatic extraction into deterministic
  product logic.
- Automatic application of model proposals.
- Broad user-history context engineering.
- Removal of existing manual remediation surfaces merely because an equivalent
  reflection handle exists.

## Frontier advancement test

The frontier advances when new reflection emits a faithful V2 cue repair; the
learner can review and authorize it; the adapter atomically creates, replaces,
or deactivates immutable learner-owned cues; and a later production
action serves one active cue or the correct fallback. Single- and multi-answer
cues must use the same answer-checking rule against the served snapshot, and
the durable attempt must preserve the exact task, cue, answer set, submission,
and session-time result after later cue changes.

The same vertical must append cue evidence and project it without feeding V0
scheduling, preserve V1 as unsupported, isolate reflection/application failure
from session correctness, and leave unaffected lexical meaning, legacy
suppression, word scheduling, Undo, and session behavior unchanged. Dogfooding
should include several real cases in which durable cues are materially fairer
than the meaning-derived fallback, including at least one cue with multiple
accepted catalogued words.

# How To Interpret And Evolve The Frontier

The stability frontier is the repository's rolling boundary between:

- decisions and contracts that are stable enough for the current build wave to
  rely on; and
- questions that still require focused human judgment before independent
  implementation should proceed.

The current frontier is maintained above. Like every tracked file, each
worktree sees the frontier as of its base revision; it is not a cross-worktree
live update channel. This document explains how to interpret, use, and evolve
it.

## Purpose

The frontier is a compact operating contract for the next build wave. It should
let a human or agent answer, without reconstructing the entire roadmap:

- What concrete near-term product outcome are we building toward?
- Which architectural blocks may implementation tasks safely assume?
- Which invariants and constraints must every task preserve?
- Which decisions remain blocking or require close human steering?
- What is deliberately outside the current wave?
- What evidence would show that the frontier can advance?

It is not a replacement for canonical product specs, architecture maps,
milestone plans, or task-specific working memory. It summarizes the subset of
those decisions that matters to current execution and links to deeper authority
where needed.

## Authority

Use this order when documents disagree:

1. Canonical product specs define intended product behavior.
2. Accepted architecture/API documents define implemented system contracts.
3. The accepted current stability frontier defines what the current build wave
   may rely on and what it must not reopen casually.
4. Active notes and task specs contain provisional exploration and handoff
   context.

If the frontier conflicts with a canonical spec or verified implementation
constraint, do not silently choose one. Treat the frontier as stale, record the
evidence, and ask the human to resolve or approve the required movement.

A frontier marked `Draft For Review` is not yet an implementation contract.
Agents may analyze it and propose corrections, but must not treat disputed
statements as settled merely because they appear in the frontier.

## Confidence Levels

Frontier statements generally fall into one of these categories:

- **Invariant** — must remain true across foreseeable implementations.
- **Wave decision** — stable enough to build against for the current product
  slice, without claiming permanent architectural status.
- **Provisional choice** — selected for now with a known reconsideration bar.
- **Blocking decision** — unresolved policy or architecture that prevents safe
  independent implementation across that boundary.
- **Explicit non-goal** — deliberately excluded so it cannot expand the wave by
  accident.

Do not let a convenient wave decision silently become a permanent invariant.
Conversely, do not reopen an accepted invariant inside an ordinary
implementation task.

## Evolution Model

One architectural assumption normally moves through this lifecycle:

```text
unexplored
  -> open / blocking
  -> provisionally settled for the current wave
  -> tested by implementation and dogfooding
  -> durable decision, graduated into a spec or architecture doc
```

At any stage, contradictory evidence may invalidate the assumption and return
it to open/blocking status. `Settled enough` means independent work can proceed
without repeatedly reopening the decision; it does not mean permanently true.

## Evolution Cadence

### During focus work: capture evidence

Record findings, alternatives, and unresolved questions in the active task note
or relevant spec. Do not rewrite the frontier after every thought.

Escalate immediately when evidence shows that a supposedly settled assumption
is unsafe to build against.

### At decision checkpoints: move the boundary

When a blocking block becomes sufficiently clear:

1. graduate the durable detail into its owning spec or architecture document;
2. move accepted parts of `Current gap and focus` into `Settled enough to build
   against`;
3. expose the next blocking decision; and
4. reconsider which tasks are now safe to dispatch independently.

This is the normal incremental movement of the frontier.

### At the end of a build wave: replace the frontier

When the frontier advancement test is met:

1. confirm that durable conclusions have graduated into their owning docs;
2. close or reclassify the completed wave's tasks;
3. replace the near-term product outcome with the next concrete outcome;
4. retain only invariants and still-relevant wave decisions; and
5. define the next advancement test.

Git history normally preserves old frontier snapshots. Do not create a separate
archive unless a superseded frontier contains important reasoning that did not
graduate elsewhere.

## When To Update It

The frontier needs review when evidence changes:

- what implementation workers may safely assume;
- which tasks can proceed independently;
- an invariant, major constraint, or explicit non-goal;
- the near-term product outcome;
- the ordering or dependency of architectural blocks;
- the reconsideration status of a provisional choice; or
- whether the current advancement test has been met.

Ordinary implementation details, isolated bugs, newly imagined future ideas,
task-status changes, and findings already covered by an acknowledged open
question normally do not require a frontier edit.

Keep the frontier compact. If a statement needs detailed field definitions,
transition tables, API schemas, or extensive rationale, that material belongs
in a spec, plan, or active note; the frontier should summarize and link it.

## Agent Workflow

### Before starting work

1. Read the frontier above and determine whether it is accepted or still draft.
   If the dispatch context says a newer frontier materially
   changed, stop and obtain the relevant updated contract rather than assuming
   the branch-local copy is current.
2. Confirm that the task fits the near-term outcome and explicit non-goals.
3. Identify which settled blocks the task may rely on and which blocking
   decisions it must not resolve speculatively.
4. Read the linked canonical specs and active task note for detailed authority.

If a task crosses a blocking boundary without an explicit decision, stop at the
well-defined portion and request human guidance rather than inventing policy.

### During work

- Preserve frontier invariants and constraints.
- Record contradictory evidence or repeated friction in the task's owning note
  or spec.
- Do not silently reinterpret a frontier statement to make implementation
  easier.
- Keep implementation choices reversible when the frontier labels their area
  provisional.

### At handoff

Call out a **frontier movement candidate** when the work shows that:

- a blocking decision is now stable enough to build against;
- an accepted assumption has been invalidated or materially narrowed;
- a non-goal must be reconsidered to achieve the stated product outcome;
- repeated agent blockers show that a supposedly stable contract is still
  underspecified; or
- the advancement test appears to have been met.

State the evidence, the proposed movement, affected tasks, and the durable doc
that should own the decision.

## Human Guidance And Edit Authority

Agents should not independently change the meaning of the frontier's:

- near-term product outcome;
- invariants or major constraints;
- classification of a decision as settled versus blocking;
- explicit non-goals; or
- advancement test.

Agents may propose those changes and should proactively call out when guidance
is needed. After the human explicitly accepts a decision or asks for the edit,
an agent may update the frontier and the owning durable documents together.

Mechanical maintenance—fixing links, reflecting an already-approved decision,
or tightening wording without changing meaning—may be performed within the
scope of an authorized documentation task.

## Relationship To Other Working Documents

```text
active notes and focused design work
  -> capture exploration and evidence

canonical specs and architecture docs
  -> hold accepted durable decisions

current stability frontier in STABILITY_FRONTIER.md
  -> summarizes what the current wave may safely assume

work catalog and task specs
  -> define dispatch candidates inside that boundary
```

A healthy frontier changes noticeably at architectural checkpoints, remains
mostly quiet while ordinary implementation runs, and is replaced when its
near-term product outcome has been demonstrated.
