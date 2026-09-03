# Current Stability Frontier

Status: accepted current build-wave boundary (2026-09-03).

## Near-term product outcome

Turn the live hosted Mandarin dogfood service into a deliberately releasable,
recoverable, and supportable private beta, then invite a small trusted cohort:

```text
hosted dogfood history and a separate test identity
  -> identified, rehearsed releases over valued data
  -> recoverable upgrades and bounded diagnosis
  -> concierge-assisted invitation of trusted learners
  -> repeated desktop study and normal optional reflection
  -> feedback that primarily tests learning value
```

The target cohort remains roughly three to eight trusted, serious
intermediate-or-beyond learners who are compatible with the current corpus and
typed-production model. The service is now real: the primary dogfood history
runs on Fly, and a separate test identity has exercised the intended isolation
boundary. That is credible evidence for the mechanism, not yet evidence from
independent beta users or proof that every operational path is mature.

The outcome is not a public launch, universal onboarding system, or broad
curriculum. It is a small service whose releases and failures can be understood
well enough that early-user feedback is not dominated by improvised deployment,
data-recovery anxiety, or unexplained prototype friction.

## Current gap and focus

The hosted-beta steel thread has advanced through real-app deployment, explicit
learner ownership, Clerk-backed identity, shared-content publication, primary
dogfood migration, and hosted cutover. The deployed service contract is owned
by
[`docs/private-beta-service-boundary.md`](docs/private-beta-service-boundary.md);
the current operational baseline is recorded in
[`docs/ops/hosted-beta-deployment.md`](docs/ops/hosted-beta-deployment.md), and
performance observation is recorded in
[`docs/ops/hosted-observability.md`](docs/ops/hosted-observability.md).
[`PLANS/hosted-beta-implementation-steel-thread.md`](PLANS/hosted-beta-implementation-steel-thread.md)
is now useful as historical sequencing and proof context; SWI-51 owns its one
remaining release-and-recovery gate rather than reopening the earlier slices.

The next intended Focus is
[SWI-51](https://linear.app/swimj/issue/SWI-51/define-and-prove-hosted-versioning-upgrade-release-rollback-and):
define and prove the release identity, compatibility, upgrade, rollback versus
fix-forward, and recovery contract on the real service. Several application
updates have already been deployed successfully, but through operator- and
agent-guided best effort rather than one accepted repeatable release procedure.
SWI-51 should make the safe path explicit without expanding into zero-downtime
delivery or a general CI/CD platform. Linear remains authoritative for when the
task is actually declared in flight.

Early hosted use has exposed operational and performance problems that local
dogfood could mask. Bounded route/process/storage observability machinery,
reflection recovery diagnostics, and session-payload latency fixes have landed.
One study commit failure could not be diagnosed after the fact because its
caught error was not logged;
[SWI-59](https://linear.app/swimj/issue/SWI-59/make-hosted-study-commit-failures-attributable)
owns that narrow follow-up. These signals justify an operational feedback loop,
not a speculative infrastructure rewrite or broad observability program.

## Settled enough to build against

- The first hosted beta is Mandarin-only. French remains retired experimentation
  rather than a compatibility or launch promise.
- The service currently runs the built frontend and Express API from one origin
  on one 1 GB Fly Machine in Singapore, with one encrypted Volume, one shared
  SQLite database, Clerk authentication, and Litestream replication to
  independently owned versioned object storage. This is the tested beta
  topology, not a permanent platform claim.
- The primary dogfood history has been deterministically migrated and cut over
  to its hosted learner identity. Hosted state is the active valued history;
  the preserved local source is a recovery artifact, not an alternate writer.
- A separate test identity has signed into the same service and observed an
  isolated fresh learner view. The ownership manifest, persistence guards, and
  negative tests remain the stronger contract; the manual check does not claim
  independent security validation or multi-user operating experience.
- The first external cohort is invite-only and intentionally narrow. External
  learners start from fresh beta state; generalized import is not required.
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
- Shared reusable content is immutable and has explicit publication status and
  attributable publication provenance; there is no canonical or blessed tier.
  The beta does not assume that corrections form a stable artifact identity or
  numbered version series. Imported
  content is an `available` bootstrap snapshot. Validated reusable content
  normally enters `shared_trial` after source-learner authorization and
  sanitization, while source evidence and all learner state remain private.
  Eligible content is initially selected uniformly at random.
- One externally authenticated account maps to one stable local learner
  identity. The server derives request identity; clients never choose a learner
  id; authorization is enforced below HTTP handlers; and support uses a
  distinct attributable principal.
- Planned downtime is acceptable. Schema-changing releases will quiesce writes
  and provider work, take an identified pre-release recovery point, run a
  rehearsed versioned migration, smoke both identities, and reopen only after
  the gate passes. SWI-51 owns the exact repeatable mechanism and compatibility
  policy; the operational principle is already settled.
- Independent Litestream backup and isolated restore are part of the beta
  design, not post-launch cleanup. Backup freshness approaching one hour is a
  stop-writes condition until investigated.
- Production tasks and cues remain content beneath word-based scheduling, not
  independently scheduled SRS objects. Served actions and accepted attempt
  evidence preserve the exact task, cue or fallback, answer space, response,
  and session-time result.
- Provider credentials and calls remain on the backend. Model output remains
  untrusted proposal input subject to strict validation, bounded resource
  exposure, explicit authorization, and registered application adapters.
- Ordinary hosted metrics and logs are content-free. Route, process, SQLite,
  WAL, backup, provider-work, and deployment observations may be retained for
  bounded operations; learner answers, notes, prompts, generated output,
  credentials, and raw identifiers do not belong in ordinary telemetry.
- Canonical learning and reflection behavior remains in
  [`SPECS/learning-review-model.md`](SPECS/learning-review-model.md),
  [`SPECS/session-covering-criteria.md`](SPECS/session-covering-criteria.md),
  [`SPECS/study-action-model.md`](SPECS/study-action-model.md),
  [`SPECS/session-reflection-generation.md`](SPECS/session-reflection-generation.md),
  and
  [`SPECS/reflection-proposals-and-handles.md`](SPECS/reflection-proposals-and-handles.md).

## Purposely unsettled boundaries

- **Release truth and recovery:** SWI-51 must settle how app, schema, migration,
  shared-content/bootstrap, and material configuration identity are reported;
  which combinations may run; how partial migrations fail closed; and when
  application rollback, schema reversal, backup restore, or fix-forward is
  safe. Existing manual updates are evidence for the workflow, not its accepted
  contract.
- **Operational diagnosis:** aggregate hosted metrics are available in the
  deployed code and operator runbook, but routine application failures are not
  uniformly attributable. Add targeted safe correlation and diagnostics from
  observed incidents; do not adopt broad distributed tracing or retain learner
  content by default.
- **Multi-user confidence:** the test identity demonstrates the intended
  isolation illusion under operator control. Confidence must now come from
  repeated negative tests, post-release smoke, and actual trusted-user use—not
  from assuming that one manual check exhausts the ownership graph.
- **Support and recovery practice:** invite, disablement, inspection,
  maintenance, backup, cutover, and restore commands exist, but routine support
  and release evidence still depend too much on expert interpretation. Accept
  the minimum runbook-backed operator workflow before widening the cohort;
  defer a general admin product.
- **Learner-facing beta quality:** the first active-session keyboard and action
  coherence slice has landed, while broader density, navigation, and polish
  remain open. Hosted use should continue surfacing reliability, latency,
  reflection-correctability, and desktop-interaction problems. Fix concrete
  blockers and high-leverage friction without turning launch preparation into
  prompt perfection, a comprehensive redesign, or a broad new learning-model
  wave.
- **Scaling boundary:** the current single-Machine SQLite topology remains the
  default. Reconsider it only from observed contention, availability,
  operational fan-out, recovery, or cohort-growth evidence.

## Invariants and constraints

- No authenticated learner may read, mutate, schedule from, reflect on, or
  invoke provider work against another learner's private state or evidence.
  References to shared content do not establish learner ownership.
- Shared content identity, publication status and provenance, learner-owned
  suppressions, source evidence, authorized operations, applied effects, and
  historical served snapshots remain distinguishable wherever their difference
  affects interpretation or recovery. A causal repair record does not by itself
  assert that old and new content are versions of one stable artifact.
- Ordinary learner actions never rewrite shared content in place. Reusable
  content may enter optimistic shared trial only through the accepted,
  validated, sanitized, and learner-authorized publication operation. Private
  evidence and learner identity never become shared content.
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
  fail loudly before destructive partial application. The hosted dogfood state
  is now valued production-like data, not a disposable deployment fixture.
- A release is intentional and identifiable. Schema compatibility, deploy
  ordering, rollback limits, and recovery steps are defined before the release
  can carry valued beta data.
- Backup is not considered complete until restore has been exercised against a
  representative beta dataset.
- Never restore blindly over live state after writes reopen. State the recovery
  point and acknowledged activity that would be lost, then choose an explicit
  restore or fix-forward path.
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
- Zero-downtime or multi-instance releases, fully automated CI/CD, large-scale
  observability, enterprise operations, or infrastructure designed for an
  unproven public-user load.
- Automatic model authority over study state, content state, account state, or
  shared publication without the required learner authorization and local
  validation.

## Frontier advancement test

The frontier advances when the live hosted service is deliberately operable
over valued data and ready for the first real cohort, not merely because more
updates have happened to deploy successfully:

1. The running service reports sufficient app, schema, migration,
   shared-content/bootstrap, and material configuration identity to explain
   what is deployed and reject an incompatible or ambiguous startup state.
2. SWI-51's maintenance, preflight, backup, migration, deploy, two-identity
   smoke, and reopen sequence is recorded and exercised through one harmless
   schema-bearing release over the migrated dogfood history.
3. Rollback versus fix-forward limits are stated before reopening, and an
   independent restore of post-release representative data succeeds in an
   isolated target with the expected release identity and learner histories.
4. Repeated tests and post-release observation show that the dogfood and test
   identities cannot cross private state, reflection evidence, durable effects,
   or provider work. Shared-content references continue to confer no private
   access.
5. Routine study, reflection, backup, and deployment failures are diagnosable
   through bounded content-free identifiers, metrics, and documented operator
   procedures. A failure that blocks continued study must not remain
   permanently opaque merely because the process stayed alive.
6. At least one non-developer trusted learner can be concierge-onboarded,
   complete the supported desktop study loop repeatedly, use or skip normal
   reflection, and return later without developer intervention to reconstruct
   state.
7. The supported desktop loop is coherent enough that first-cohort feedback can
   evaluate learning value rather than being dominated by avoidable latency,
   broken interaction flow, deployment fragility, or data-recovery uncertainty.

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
