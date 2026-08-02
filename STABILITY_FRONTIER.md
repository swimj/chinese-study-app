# Current Stability Frontier

## Near-term product outcome

Dogfood one learner-facing post-session reflection path:

```text
completed study session
  -> bounded session-evidence bundle
  -> one server-side Luna reflection call
  -> strict local validation
  -> durable reflection artifact with proposal-level review
  -> minimal asynchronous user review
  -> explicit application only for accepted, supported operations
```

The first useful outcome is not a complete agentic learning system. It is a
reflection that can inspect real session evidence, make language-aware and
bounded proposals, survive review after the session ends, and preserve a
truthful record of what the model proposed, what the user decided, and what the
application actually changed.

## Settled enough to build against

- Reflection is post-session and best-effort. It is outside the correctness
  path for study commits, covering, and scheduling.
- `gpt-5.6-luna-high` is the initial reflection model. The first flow uses one
  monolithic model call rather than a planner, debate, or specialist-agent
  pipeline.
- Provider credentials and calls belong on the backend. Model output is
  untrusted input and must pass strict local validation.
- The model has proposal-only authority. It never directly mutates durable
  learner or content state.
- The bounded session-evidence bundle is the provisional input boundary for the
  first reflection flow.
- The initial reflection is written for learner consumption. Developer-facing
  reflection and development artifacts are outside this wave.
- Reflection output and proposal-level review state are durable so review can
  resume asynchronously and provenance survives later application. The
  provisionally settled persistence shape is one immutable provenance/blob row,
  seeded proposal-review rows, and immutable authorized invocations with mutable
  application projections. See
  [`SPECS/reflection-proposals-and-handles.md`](SPECS/reflection-proposals-and-handles.md).
- SQLite is sufficient for the first personal dogfood. Hosted tenancy and
  Postgres follow only after the agentic core proves useful on personal data.

## Invariants and constraints

- Existing study-session behavior remains correct if reflection generation
  fails, times out, produces invalid output, or is never reviewed.
- Every durable operation requires explicit user authorization and domain-level
  validation at application time.
- An accepted handle may remain unapplied when no adapter exists; the UI and
  persistence model must not imply that acceptance changed study state.
- Review, edit, defer, dismiss, accept, and supported application may occur
  asynchronously after the originating session ends.
- The original evidence, model/prompt/schema versions, original proposal,
  user-authorized operation, disposition, and actual effect must remain
  distinguishable wherever they materially differ.
- Until content ownership and customization policy is settled, operations that
  customize learner or content state must preserve the distinguishability of
  base state, user-authorized change, and applied effect. User-visible removal
  or replacement should remain reversible unless true deletion is explicitly
  intended. See the
  [`hosted-beta tenancy table map`](PLANS/hosted-beta-tenancy-table-map.md#near-term-deferral-constraint-preserve-the-layers)
  for rationale and boundaries.
- Existing manual management paths must not conflict with the handle lifecycle
  or create effects that reflection application cannot reconcile truthfully.
- Initial implementation should remain narrow and reversible. Sticky operation
  payload and identity decisions deserve more care than the storage substrate.

## Current blocking decisions

- The accepted V0 operation inventory, proposal/application lifecycle,
  provenance/override semantics, and compatibility boundaries are defined in
  [`SPECS/reflection-proposals-and-handles.md`](SPECS/reflection-proposals-and-handles.md).
  The bounded first implementation contract, post-session trigger/API boundary,
  and minimum review surface are defined in
  [`PLANS/initial-reflection-steel-thread.md`](PLANS/initial-reflection-steel-thread.md).

## Explicit non-goals for this wave

- Multi-agent reflection, planner/debate loops, or content-authoring specialists.
- Time-budgeted session planning or autonomous scheduling changes.
- Hosted-tenancy implementation, authentication, Postgres migration, or beta
  deployment. The bounded ownership-map task may proceed as pre-design but must
  not expand into implementing these areas.
- Developer-facing reflection artifacts or assistant-product-manager behavior.
- A comprehensive evaluation harness or automatic extraction into deterministic
  product logic.
- Automatic application of model proposals.
- Broad user-history context engineering.
- Final production-cue stacks, answer classes, general word-priority handles,
  or a universal command framework unless a confirmed V0 handle strictly
  requires a small decision now.
- Removal of existing manual remediation surfaces merely because an equivalent
  reflection handle exists.

## Frontier advancement test

The frontier advances when a real completed session can produce a useful,
validated learner-facing reflection; the user can return later to review and
disposition its items; accepted, supported operations can be applied with
truthful provenance; and normal study correctness is unaffected when any
reflection step fails or the reflection is never reviewed.

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
2. move a concise summary from `Current blocking decisions` into `Settled
   enough to build against`;
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
