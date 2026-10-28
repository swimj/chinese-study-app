# Stability frontier

Current implementation boundary for adaptive vocabulary delivery.

## Purpose and current direction

This is the architectural boundary implementation agents can build against:
settled assumptions, constraints to preserve, and decisions that need deliberate
judgment. It is not a task queue, a release certificate, or a complete system map.
The direct task instruction supplies execution scope; older planning prose does
not silently override it. See [AGENTS.md](AGENTS.md) for source reconciliation.

The Mandarin product uses adaptive vocabulary modes and a flexible exercise pool.
The [vocabulary contract](SPECS/vocabulary-learning.md) owns the current learner
loop; [its implementation guide](docs/vocabulary-learning.md) owns the runtime
and cutover. Word mode, exercise selection, scheduling, and content repair have
separate authority. Simple initial policies can evolve without replacing those
boundaries. This snapshot does not certify deployment or operational readiness.

The persistent steward at `/Users/jw/dev/chinese-study-steward` holds the product
north star in `vision.md`, weekly priorities in `outlook.md`, and unresolved
thinking in `chewing.md`. Its `AGENTS.md` governs the steward, not implementation
workers. Those files provide alignment when available; this repository retains
the contracts needed to implement tasks without that workspace. Weekly priorities
belong there and in task instructions, not in this frontier.

## Safe implementation assumptions

- **Study loop:** interactions append exact evidence; finalization applies durable
  learning effects once. Coverage and recall are distinct. Mode belongs to a word,
  while recognition, contrast, and pure cues retain their appropriate scheduling.
- **Content:** complete current objects and full version history support shared
  repair. Teaching has an exclusive repertoire bound to its introduction; ordinary
  practice draws from the current pool at session composition. Each session retains
  its repertoire while controls choose dynamically within it. Unresolved sense
  associations allow word fallback.
- **Reflection:** private learner lessons and internal content proposals run
  independently. Operators approve content applications. Backend judgment can
  compensate scheduling without learner approval or content publication.
- **Hosted boundary:** Mandarin, invite-only desktop web, one-origin frontend
  and Express API, shared SQLite, Clerk identity, and Fly/Litestream are the
  current beta baseline. Hosted dogfood history is valued data; the preserved
  local source is a recovery artifact, not another writer. The
  [service contract](docs/private-beta-service-boundary.md) and
  [operator runbook](docs/ops/hosted-beta-deployment.md) own the details. French
  remains retired experimentation, not a compatibility promise.
- **Bounded beta operations:** concierge onboarding, operator-assisted support,
  and planned downtime remain acceptable. Public signup, billing, a general
  admin product, mobile-specific work, and multi-instance infrastructure are
  not prerequisites for improving this experience. Reconsider topology from
  observed contention, availability, recovery, or growth needs.

## Invariants to preserve

- Authenticated learners cannot read, mutate, schedule from, reflect on, or
  invoke provider work against another learner's private state or evidence.
  The server derives identity, authorization extends below HTTP handlers, and
  shared-content references confer no private access. Support access is bounded
  and attributable.
- Shared content, publication status and provenance, private evidence and
  suppressions, authorized operations, applied effects, and historical served
  snapshots remain distinguishable. Current content can be updated or replaced through explicit operator authority;
  immutable full history preserves attributed before/after material and every
  original served exercise. Identity-bound relationships do not silently transfer. See the service and feature specs
  for publication, preparation, and repair rules.
- Reflection/provider failure cannot invalidate a completed study session.
  Model output is untrusted. Reflection-proposed durable effects require strict
  validation, explicit operator authorization for content application, and truthful
  attribution. Scheduling compensation has separate bounded backend authority. Shared word preparation instead uses its explicit validated
  application-publication policy; it does not fabricate learner approval. Model
  judgment does not enter live-session grading.
- Provider calls and secrets stay on the backend. Provider evidence follows the
  bounded evidence contract and beta disclosure. Aggregate metrics and ordinary
  lifecycle logs are content-free; targeted failure diagnostics follow the
  [documented privacy and retention boundary](docs/ops/error-diagnostics.md).
- Migrations preserve history and provenance or fail loudly before destructive
  partial application. Releases are intentional and identifiable, with explicit
  compatibility, deploy ordering, rollback limits, and recovery steps.
  Application-only upgrades must satisfy the runbook's narrow eligibility rules.
- Schema-changing releases quiesce writes and provider work, take an identified
  recovery point, rehearse migration, smoke both identities, and reopen only
  after checks pass. Backup requires exercised isolated restore of representative
  data; unknown freshness or age over one hour requires stopping writes, with
  investigation as freshness approaches that limit. Never restore blindly over
  reopened writes: identify lost activity and choose restore or fix-forward
  deliberately. Routine support must not depend on improvised database edits.
- Visual and interaction work preserves study, Undo, completion, reflection,
  and proposal-authorization semantics. Removing technical language from the
  learner experience must not remove necessary choices or misrepresent effects.

## Unsettled boundaries and deliberate decisions

- **Experience and content quality:** the existing loop is a base to improve,
  not a claim that it is already inviting or coherent enough for test learners.
  Concrete design and content-quality tasks may proceed within existing
  semantics. A change to learning policy, authorization, or what evidence means
  needs an explicit decision and corresponding spec changes.
- **Reflection compatibility:** churn across persisted evidence, generated
  artifacts, proposals, and application adapters is an upcoming architectural
  concern. Current supported compatibility and stale-result behavior remain
  binding. A general redesign, migration policy, or retirement of historical
  compatibility needs a scoped decision; mentioning the concern does not
  authorize a parallel rebuild.
- **Release and recovery maturity:** upgrade, inspection, diagnostics, migration,
  and restore mechanisms exist. Their existence does not establish completion
  of the older schema-release/restore proof over valued history, or readiness
  for every future release. Use actual release and rehearsal evidence for the
  relevant change; do not infer it from a plan, command, or successful app-only
  deployment. The [older steel thread](PLANS/hosted-beta-implementation-steel-thread.md)
  preserves proof context, not the next Focus assignment.
- **Invitation confidence:** isolation tests and operator-controlled test
  identities provide bounded evidence, not independent learner experience or
  exhaustive security validation. Widening invitations remains Justin's
  decision, informed by actual study experience, content/reflection safety and
  correctability, and basic support/recovery readiness. Recurring harmful or
  materially misleading reflection remains a blocker; dismissible weak
  suggestions do not require prompt perfection.

## Maintaining the boundary

Correct stale descriptions and reflect explicit decisions in the frontier and
owning docs together. Surface material conflicts among instructions, specs, and
verified implementation; do not silently declare either intent or code correct.
Continue well-defined work and ask only where an unresolved product or
architectural choice is necessary to proceed.

Propose a boundary change when evidence invalidates an assumption or supports a
new settled contract. Do not independently relax invariants or turn a proposal
into accepted direction. Readiness claims require the relevant observed proof,
not implementation alone. This branch-local document neither dispatches work nor
tracks live task state.
