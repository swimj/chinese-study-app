# SWI-51 release maturity map

status: active
type: work-bundle
created: 2026-09-04
retire-when: SWI-51's accepted release and recovery contract has graduated into its owning docs
related:
  - notes/active/2026-09-04-swi-51-app-only-upgrade-pipeline.md
  - docs/private-beta-service-boundary.md
  - docs/ops/hosted-beta-deployment.md
  - https://linear.app/swimj/issue/SWI-51/define-and-prove-hosted-versioning-upgrade-release-rollback-and

## Role of this map

This is directional working memory for the work after the first app-only
upgrade pipeline. It deliberately records promising distinctions and open
questions without declaring a release/recovery contract in advance.

## Direction established so far

- **Identity versus evidence.** A release has a human-facing app version, exact
  Git revision, built-image identity, and deployment identity. Evidence is
  associated metadata about what actually happened; it is not another component
  of release identity.
- **Build versus persisted data.** A build can be identified cold; an upgrade
  must also account for the data it inherits. Compatibility and migration state
  belong beside a deployment/release record, not inside build identity.
- **Single-machine reality.** The present topology has a real interruption at
  deploy time. Maintenance and provider draining are useful operational controls
  even before schema upgrades, but they do not by themselves prove recovery.
- **Browser version skew.** An open browser retains the old frontend while the
  backend changes. The early pipeline is limited to backward-compatible changes.
  A reload prompt is a convenience only; it cannot make a broken API contract
  safe.
- **Evidence independence.** A record stored with the application database or
  on the same Fly Volume shares part of the service's fate. Mature recovery
  evidence needs an independently managed location and a deliberate retention
  policy.

## Later work, in useful dependency order

1. **Migration and compatibility contract.** Define ordered/checksummed
   migrations, fresh-versus-upgrade behavior, app/schema/content compatibility,
   startup authority, and treatment of unknown or partial state.
2. **Quiescence and recovery point.** Inventory writes and provider work; define
   durable drain semantics, maintenance-safe authentication, forced sync,
   identifiable recovery points, and what must be true before a data-changing
   release starts.
3. **Preflight and rehearsal.** Add the checks whose failure would change an
   operator decision: compatibility, credentials, disk/headroom, backup health,
   recovery-image availability, and representative-copy rehearsal.
4. **Verification before reopen.** Decide when the service needs a controlled
   write smoke, two-identity isolation proof, and semantic checks beyond SQLite
   integrity and simple row counts.
5. **Recovery action policy.** Separate app rollback, compatible old-image
   operation, reverse migration, restore, and forward repair. Define the point
   after which rollback is unsafe and fix-forward is mandatory.
6. **Independent release evidence.** Choose the external system of record and
   its immutable, content-free evidence schema: planned/actual identities,
   migration/recovery-point coordinates, config fingerprint, quiescence,
   deploy, smoke, reopen, and failure path.
7. **Breaking client/backend changes.** Choose either an expand/contract API
   window or a deliberately managed no-live-client maintenance procedure;
   neither is supplied by version-reload signaling alone.
8. **Proof migration and failure exercise.** Select a harmless real migration,
   rehearse it, then test interrupted migration, stale backup, drain failure,
   wrong-image recovery, deploy failure, smoke failure, and semantic isolation
   failure.

## Questions to resolve when each becomes active

- What exact schema/content state representation is sufficient for compatibility
  decisions? A migration count alone is only a diagnostic, not a state proof.
- Which runtime configuration changes alter compatibility, and what minimal
  redacted fingerprint should release evidence retain? Do not capture a broad
  environment dump merely because it is available.
- What external evidence store has the right access, retention, and incident
  properties: a release system, object storage, or another operator-owned log?
- Which provider jobs need durable lifecycle/cancellation semantics, and which
  can be safely abandoned and retried?
- At what cohort size or data value does a controlled write smoke become worth
  its special-account/per-learner-window machinery?
- What recovery objective and downtime budget justify more than the current
  single-machine/manual operating model?

## Evidence from dogfood use that should steer priorities

- actual deployment duration and user-visible interruption;
- whether maintenance, provider drain, and Litestream sync are understandable
  and reliable in practice;
- identity or configuration facts that are difficult to recover afterward;
- failure cases that make an operator uncertain what is actually running; and
- signs that open-browser compatibility or a write smoke is causing real risk.

Nothing in this map authorizes implementation by itself. Promote one bounded
item into a task-spec packet only when it becomes active work.
