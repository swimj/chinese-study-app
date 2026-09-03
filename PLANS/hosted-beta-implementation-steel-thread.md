# Hosted-Beta Implementation Steel Thread

Status: accepted implementation plan (2026-08-19). Slices through hosted
dogfood cutover are complete; the intentional release and recovery proof
remains tracked by SWI-51. Dispatch remains controlled through Linear.

This plan converts the accepted
[`private-beta service boundary`](../docs/private-beta-service-boundary.md) into
one demonstrable path: a fresh invited learner and the migrated dogfood learner
can study in the same hosted service, remain isolated, use shared content, and
survive an intentional release plus exercised restore.

## Execution Contract

- Preserve the current study and reflection behavior defined by the canonical
  specs. Hosting does not authorize learning-model redesign.
- Use one shared SQLite database and make learner context unskippable before
  placing real beta data in it.
- Keep real learner data out of the platform spike and incomplete ownership
  schemas.
- Keep Fly/Clerk provisional. Switch only to the named fallback when a spike
  gate fails; do not change product ownership to accommodate a vendor.
- Deliver reviewable slices with focused invariant tests and the normal build.
  Schema/persistence changes update the persistence implementation and tests
  together.
- Stop for human input if a current mixed table cannot be assigned to the
  accepted shared/private model without changing product semantics.

## Slice 0 — Disposable Platform-Risk Spike

Build the smallest disposable deployment using one Fly Machine and Volume,
Clerk restricted invitations, SQLite WAL, Litestream to independent object
storage, and basic metrics.

Prove:

- restricted invite, sign-in, sign-out, revocation, and local disablement;
- volume persistence across a deploy and process restart;
- one-writer SQLite behavior with WAL and Litestream running together;
- independently restored data in an isolated environment;
- a controlled harmless schema migration and pre-reopen rollback; and
- visibility of database/WAL size, lock/busy behavior, transaction latency,
  backup age, application errors, and provider usage/cost.

Gate: either record a reproducible successful path or switch Fly to Railway
and/or Clerk to WorkOS AuthKit. Do not proceed on a backup that has not restored
successfully.

## Slice 1 — Explicit Ownership Foundation

Introduce stable learners, provider-account mappings, authenticated request
context, learner ownership on every private table, shared publication state,
scoped operational metadata, and schema/import ledgers. Split mixed roots such
as lexical content versus word state, or implement an equivalently explicit
boundary. Split the current learner cue activation lifecycle/projection from
the new shared publication lifecycle. Enforce same-learner private references.

Required tests:

- all learner-private persistence entry points require learner context;
- no optional/global learner fallback exists;
- two learners using the same shared word/content identities cannot read,
  update, schedule from, reflect on, or invoke provider work against each
  other's state;
- adversarial cross-learner identifiers fail across the complete 42-table
  durable-object graph; and
- shared-content references alone never authorize private rows.

Gate: no real learner deployment while this slice is partial. Human review
confirms the refreshed ownership map and the dogfood import mapping before the
next data-bearing slice.

## Slice 2 — Authenticated Fresh-Learner Path

Wire Clerk verification to the local account mapping and thin HTTP boundary.
Support restricted invite, sign-in/out, fresh learner bootstrap, account
disablement, and attributable support context.

Demonstrate end to end:

```text
invite -> sign in -> local learner mapping -> fresh bootstrap
  -> study -> complete -> optional reflection -> return later
```

Provider work carries the originating learner context, stays failure-isolated,
and obeys cost/resource bounds. Ordinary logs remain content-free.

Gate: two fresh identities complete the path while automated negative tests
try every exposed cross-learner route and provider action.

## Slice 3 — Shared Content Loop

Implement immutable reusable artifacts, lineage, `shared_trial`, `available`,
`quarantined`, and `retired` publication states, plus uniform random selection
among eligible artifacts. Preserve exact served versions and answer spaces.

Keep learner evidence, source analysis, suppression, activation history, and
feedback private. Model shared repair/quarantine and any task-level disposition
as operations separate from learner relevance.

Gate: learner A approves a validated repair that enters `shared_trial` and can
be served to learner B without exposing A or A's evidence. B can report it;
quarantine makes it ineligible while historical attempts remain truthful.

## Slice 4 — Dogfood Preparation And Migration

First run the separate idempotent, agent-assisted historical bad-prompt
proposal/review tool. Then rehearse and run the deterministic import against
recoverable copies.

The migration assigns the dogfood learner, classifies imported content,
preserves private history and immutable provenance, scopes metadata, and emits
a machine-readable validation report. Cutover stops local writes, takes a final
backup, imports transactionally, validates, and retains the source read-only.
There is no dual write.

Gate: representative counts and invariants match; the dogfood learner's
scheduling and history work; a second learner remains isolated; and eligible
shared content can be served without source evidence.

## Slice 5 — Intentional Release And Recovery Proof

With both the migrated and fresh account present:

1. enter maintenance and quiesce writes/provider work;
2. record an independent pre-release recovery point;
3. apply one harmless but real versioned schema migration and deploy its app;
4. smoke both accounts, cross-account isolation, shared content, study, and
   optional reflection;
5. reopen writes and record some new representative activity;
6. restore the independent backup into an isolated environment; and
7. validate identity separation, content lineage, learner histories, and the
   understood recovery point.

Gate: release and restore runbooks are repeatable by the operator, backup age
is observable, failure/rollback limits are recorded, and routine diagnosis
does not require improvised production edits.

## Steel-Thread Completion Gate

The implementation path is complete only when all of the following are
demonstrated together:

- two invited accounts use one hosted service with tested private-data and
  provider-work isolation;
- a fresh learner repeatedly completes the supported desktop study loop;
- dogfood history is migrated with scheduling, attempts, reflection, content,
  and provenance intact;
- learner-authorized reusable content can enter the optimistic shared trial
  loop without publishing private evidence;
- provider failure remains outside session correctness;
- one intentional schema release succeeds under planned maintenance; and
- an independent backup restores successfully and the recovered data passes
  the two-identity isolation smoke test.

## Explicit Follow-Ups, Not Steel-Thread Scope

- commonly-suppressed content priors and explicit learner overrides;
- quality scoring, embeddings, personalized weighting, and growth evaluation;
- self-service export/deletion and launch-grade privacy/analytics policy;
- Postgres migration, horizontal scaling, and zero-downtime releases;
- general administration UI, public signup, billing, and organizations; and
- broad onboarding, mobile/offline clients, or learning-model expansion.
