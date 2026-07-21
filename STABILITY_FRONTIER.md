# Working With The Stability Frontier

The stability frontier is the repository's rolling boundary between:

- decisions and contracts that are stable enough for the current build wave to
  rely on; and
- questions that still require focused human judgment before independent
  implementation should proceed.

The live frontier is maintained near the top of [`TASKS.md`](TASKS.md). This
document explains how to interpret, use, and evolve it.

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
statements as settled merely because they appear in `TASKS.md`.

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

1. Read the live frontier in `TASKS.md` and determine whether it is accepted or
   still draft.
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

stability frontier in TASKS.md
  -> summarizes what the current wave may safely assume

task queue and task specs
  -> dispatch concrete work inside that boundary
```

A healthy frontier changes noticeably at architectural checkpoints, remains
mostly quiet while ordinary implementation runs, and is replaced when its
near-term product outcome has been demonstrated.
