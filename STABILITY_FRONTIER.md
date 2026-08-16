# Current Stability Frontier

Status: accepted current build-wave boundary (2026-08-15).

## Near-term product outcome

Run an invite-only hosted Mandarin beta for a small trusted cohort:

```text
invite-only account and shared versioned Mandarin content
  -> isolated learner state and a concierge-assisted start
  -> repeated desktop study through the current core learning loop
  -> normal optional post-session reflection with explicit authorization
  -> intentional releases that preserve history
  -> recoverable data and bounded operator support
```

The target cohort is roughly three to eight trusted, serious
intermediate-or-beyond learners who are compatible with the current corpus and
typed-production model. The outcome is not a public launch, universal
onboarding system, or broad curriculum. It is a credible service in which early
users can study safely enough that their feedback primarily tests learning
value rather than local-installation friction or data fragility.

## Current gap and focus

The bounded reflection and production-cue repair loop has met the prior
advancement test. New reflection can propose V2 cue changes; the learner can
review, revise, and authorize them; supported application preserves immutable
cue and attempt provenance; and later study actions serve active cues using
their exact snapshotted answer spaces. The durable behavior is owned by
[`SPECS/session-reflection-generation.md`](SPECS/session-reflection-generation.md),
[`SPECS/reflection-proposals-and-handles.md`](SPECS/reflection-proposals-and-handles.md),
and [`SPECS/study-action-model.md`](SPECS/study-action-model.md).

The application is still a local, implicit-single-learner system. One process
opens one SQLite database through global configuration; the HTTP API has no
account or authorization boundary; shared corpus content and learner state are
not physically separated; and there is no accepted hosted topology, migration
and release contract, restore procedure, or bounded support-access model.

The next focused decision is therefore a **private-beta service-boundary
design**, not immediate infrastructure implementation. It must produce accepted
contracts for account and request identity, learner-data isolation,
shared/versioned content and private overlays, physical tenancy and storage,
authentication, migration, release and rollback, backup/restore, diagnostics,
and operator access. It must compare credible topologies rather than assume
Postgres merely because the service is hosted. Linear remains authoritative for
when this work is actually selected or dispatched.

A steady-state desktop UX audit and interaction brief may proceed
asynchronously if portfolio capacity permits. It should improve density,
scrolling, keyboard flow, focus behavior, and interaction consistency while
preserving the current broad page model unless evidence shows that model itself
is the recurring problem.

## Settled enough to build against

- The first hosted beta is Mandarin-only. French remains retired experimentation
  rather than a compatibility or launch promise.
- The first cohort is invite-only and intentionally narrow. External learners
  start from fresh beta state; generalized import is not required. Migration of
  the primary dogfood history into its hosted account is the required proof
  that valuable existing data can move safely.
- Reflection is a normal default beta feature, not a hidden experiment. Using
  it remains optional; failure remains outside session correctness; and no
  proposed durable effect occurs without explicit learner authorization and
  truthful supported application.
- Reflection launch quality is governed by safety and correctability.
  Recurring harmful or materially misleading categories block launch; ordinary
  weak suggestions that can be dismissed or corrected do not require prompt
  perfection before beta.
- Invite-only sign-in, sign-out, and operator-assisted account recovery and
  support are sufficient. Public signup, billing, and a general role system are
  not required.
- The beta optimizes the steady-state desktop core loop. It preserves the
  current broad page model initially and improves the common interaction
  grammar incrementally rather than making a big-bang information-architecture
  redesign a prerequisite.
- Initial onboarding may be concierge-assisted. A polished self-service
  onboarding system is deferred until the steady-state experience is more
  settled.
- Shared content is a versioned base concept; learner state, private
  customization, evidence, and candidate improvements must remain
  distinguishable from it. Promotion of a learner change into shared content
  is deferred, and ordinary learner actions must not automatically mutate the
  global base.
- Release, migration, rollback, backup, restore, and supportability constrain
  the first hosted persistence design. They are not cleanup work to add after
  beta data accumulates.
- Production tasks and cues remain content beneath word-based scheduling, not
  independently scheduled SRS objects. Served actions and accepted attempt
  evidence preserve the exact task, cue or fallback, answer space, response,
  and session-time result.
- Provider credentials and calls remain on the backend. Model output remains
  untrusted proposal input subject to strict validation, bounded resource
  exposure, explicit authorization, and registered application adapters.

## Decisions the next focus must settle

- **Physical tenancy and storage.** Compare at least isolated service/database
  per learner, multiple learner databases behind one service, shared SQLite
  with explicit learner ownership, and shared Postgres with explicit learner
  ownership. Select against cohort needs, isolation risk, migration cost,
  operational fan-out, and future shared-content requirements.
- **Account and request context.** Define how authenticated identity reaches
  every learner-owned read, write, provider request, and support operation, and
  where authorization is enforced.
- **Content and state ownership.** Refresh the complete schema inventory and
  define shared corpus identity/versioning, learner-owned scheduling and
  history, private generated content and overlays, operational metadata scope,
  and historical references across content revisions.
- **Release and recovery.** Define schema migration ownership, compatibility
  rules, deploy ordering, failure behavior, rollback limits, backup cadence,
  restore verification, and the dogfood-history migration path.
- **Operational trust.** Define secrets, logs, diagnostics, provider cost
  bounds, data egress disclosure, account recovery, privacy/delete/export
  posture, and bounded operator access.
- **Vendor selection.** Choose authentication, hosting, database, and
  deployment vendors only after the service contract supplies the criteria.
  Vendor convenience must not silently choose the product ownership model.

These decisions are coupled enough to share one design focus. They are not
permission to provision services, rewrite persistence, or dispatch the hosted
implementation before the resulting contract is accepted.

## Invariants and constraints

- No authenticated learner may read, mutate, schedule from, reflect on, or
  invoke provider work against another learner's private state or evidence.
  References to shared content do not establish learner ownership.
- Shared base content, its version, learner-owned overlays or suppressions,
  source evidence, authorized operations, applied effects, and historical
  served snapshots remain distinguishable wherever their difference affects
  interpretation or recovery.
- Ordinary learner customization never silently mutates shared base content.
  Shared-content promotion requires a separately designed and authorized
  workflow when repeated evidence justifies one.
- Existing study-session behavior remains correct if reflection generation,
  proposal review, cue application, or the external model provider fails,
  times out, returns invalid output, or is never used.
- Model judgment never enters live-session grading. A model-authored durable
  change requires strict local validation, explicit learner authorization, a
  supported adapter, and truthful effect attribution.
- Account, authorization, and provider secrets remain server-side. Data sent to
  a model provider must follow an explicit beta disclosure and the existing
  bounded evidence contract.
- Migration and upgrade paths must preserve learner history and provenance or
  fail loudly before destructive partial application. The dogfood migration
  runs against a recoverable copy until the hosted result is verified.
- A release is intentional and identifiable. Schema compatibility, deploy
  ordering, rollback limits, and recovery steps are defined before the release
  can carry valued beta data.
- Backup is not considered complete until restore has been exercised against a
  representative beta dataset.
- Operator support access is bounded by an accepted support model. Routine
  diagnosis and recovery must not depend on improvised production-database
  edits; any exceptional repair mechanism must be deliberate, attributable,
  and runbook-backed.
- UI redesign must preserve the correctness of the existing study, Undo,
  completion, reflection, and proposal-authorization flows. Visual or
  interaction polish does not authorize semantic rewrites.
- Sticky identity, ownership, migration, and authorization decisions receive
  more care than easily reversible presentation or vendor configuration
  choices.

## Explicit non-goals for this wave

- French compatibility or a multilingual beta promise.
- Public self-service signup, billing, subscriptions, teams, organizations, or
  a generalized role hierarchy.
- Generalized data import for external users; external beta accounts start
  fresh.
- Automatic promotion of learner-created cues, clusters, gloss improvements,
  or other candidate changes into shared content.
- A content marketplace, public/community publishing system, or complete
  shared-content curation workflow.
- A time-budgeted planner, autonomous scheduling changes, multi-agent
  reflection, or a general tutor/chat product.
- A mobile app, native offline sync, or mobile-specific polish. The initial
  supported experience is desktop web.
- A big-bang information-architecture replacement or polished self-service
  onboarding.
- Prompt perfection, a comprehensive reflection evaluation harness, or
  eliminating every dismissible low-quality suggestion before launch.
- Broad new exercise types or core learning-model expansion unless evidence
  shows that the bounded beta loop cannot function without them.
- Large-scale observability, enterprise operations, or infrastructure designed
  for an unproven public-user load.
- Automatic model authority over study state, content state, account state, or
  shared publication.

## Frontier advancement test

The frontier advances after the private beta operates as a real service, not
merely when hosting code merges:

1. At least two accounts can sign in to the same accepted beta system, and
   isolation tests plus observed behavior show that their private learner data,
   evidence, reflections, and provider requests do not cross.
2. A non-developer learner can be concierge-onboarded, complete the supported
   desktop study loop repeatedly, use or skip post-session reflection, and
   return later without developer intervention to reconstruct state.
3. Reflection remains safe and non-blocking under provider failure and invalid
   output, and durable model-proposed effects still require explicit learner
   authorization and truthful application.
4. The primary dogfood history is migrated into its hosted account with
   representative scheduling, attempt, reflection, cue, and provenance state
   intact, then survives at least one intentional application/schema release.
5. Backup and restore are exercised successfully against representative beta
   data, with release and recovery steps recorded well enough to repeat.
6. Routine account recovery and study/reflection diagnosis can be performed
   through bounded support access and documented procedures rather than
   improvised production-database edits.
7. The supported desktop core loop has coherent density, scrolling, keyboard,
   focus, and interaction behavior sufficient that first-cohort feedback can
   evaluate the learning product rather than being dominated by prototype UI
   friction.

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
