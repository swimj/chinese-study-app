# SWI-51 hosted release and recovery design

status: winding-down
type: work-bundle
created: 2026-09-03
retire-when: SWI-51 is dispositioned and its accepted release contract has graduated into the owning architecture and operations documents
related:
  - STABILITY_FRONTIER.md
  - docs/private-beta-service-boundary.md
  - PLANS/hosted-beta-implementation-steel-thread.md
  - docs/ops/hosted-beta-deployment.md
  - https://linear.app/swimj/issue/SWI-51/define-and-prove-hosted-versioning-upgrade-release-rollback-and

This is medium-lived working memory for the SWI-51 scope and design phase. It
tracks questions, candidate decisions, deferrals, and the intended incremental
delivery shape. It is not an accepted release contract, implementation task
specification, or substitute for Linear status.

**Superseded as the planning surface.** This document is retained as raw design
exploration. The straightened implementation packet is
[`2026-09-04-swi-51-app-only-upgrade-pipeline.md`](2026-09-04-swi-51-app-only-upgrade-pipeline.md);
the directional later-work map is
[`2026-09-04-swi-51-release-maturity-map.md`](2026-09-04-swi-51-release-maturity-map.md).
Those documents take precedence if this exploratory record conflicts with them.

## Current context

As of 2026-09-03, the real hosted application and dogfood cutover prerequisites
owned by SWI-50, SWI-56, and SWI-57 are complete. SWI-51 is in Linear `Todo` as
the selected next Focus, but has not yet entered implementation.

The hosted service was initially assembled deliberately through an
operator-driven, one-off deployment rather than a generalized release pipeline.
That manual state is useful evidence for this design. The accepted long-term
SWI-51 outcome remains an identifiable, repeatable upgrade and recovery process
over valued hosted data.

## Human direction for the first increment

Begin with a deliberately simple **application upgrade pipeline**. Do not make
schema compatibility, preflight validation, rollback, or the complete recovery
proof prerequisites for that first increment.

Work through the broader design inventory in order so that deferrals are
conscious. Understanding an item does not automatically place its implementation
in the first increment.

This creates two distinct horizons:

1. **First useful delivery:** reproducibly build, identify, deploy, and confirm
   an application-only upgrade through the existing operator-driven hosted path.
2. **Full SWI-51 trust gate:** add explicit schema/content/config compatibility,
   migration, quiescence, recovery-point, rollback/fix-forward, restore, and
   evidence contracts, then exercise them against the hosted dogfood service.

The first delivery must avoid design choices that make the second horizon
materially harder, but it need not prematurely implement the second horizon.

## Design inventory

Work through these items in order for awareness and candidate decisions. At
each checkpoint, classify the resulting implementation as first increment,
later SWI-51, or evidence-triggered follow-up.

Progress: **6 of 15 substantive design topics complete** (1 release identity,
4 startup/readiness/migration separation, 6 pre-reopen smoke testing, 8
release evidence, 13 configuration compatibility, 14 operator command
semantics — app-only scoping). Items 2, 3, 5, 7, 9, 10, 11, 12, and 15 are
scoped and deferred for the first increment. All 15 substantive design topics
are now scoped; the next checkpoint is delivery/review packaging.

1. **Release identity — complete (2026-09-03).** Application version is the
   human-facing release label; exact Git commit identifies source; image digest
   identifies the built artifact; and deployment identity records one
   installation of that artifact and its material configuration. Persistent-data
   compatibility state is observed alongside a release but is not part of
   the application build identity. Evidence is critical metadata associated
   with an identifiable release or deployment attempt, not part of release
   identity itself.
2. **Migration model** — define immutable ordered migrations, checksums,
   preconditions, postconditions, transaction boundaries, retry behavior, and
   fresh-database versus upgrade behavior. **Deferred for the first increment**
   (first increment is application-only; no schema change to exercise).
3. **Application/schema compatibility** — define which image may start or serve
   writes against which schema and content states, including unknown, pending,
   failed, or partially recorded migrations. **Deferred for the first
   increment**: building it now would not exercise the compatibility check
   because the happy path carries no schema change. The happy path still
   *records* schema state (migration count) alongside release identity so the
   evidence shape is forward-compatible, but it does not *enforce* compatibility.
4. **Startup, readiness, and migration separation — complete (app-only
   scoping, 2026-09-03).** For the application-only happy path:
   - **Migration authority** — not applicable (no migration). Deferred with
     items 2/3.
   - **Database compatibility enforcement** — trivially satisfied (schema
     unchanged); enforcement deferred with item 3. The happy path records schema
     state but does not gate on it.
   - **Process liveness vs. read/write readiness** — for app-only, the new
     process is read- and write-ready as soon as the volume mounts and the schema
     is compatible (which it is). No need to split `/healthz` into
     liveness/readiness/write-readiness for the happy path. The pipeline instead
     uses a post-deploy *confirmation gate* (maintenance off, provider work
     enabled, representative read succeeds) built from existing controls.
   - **Provider readiness / quiescence** — `fly deploy` on our single-machine,
     single-volume topology is a stop-then-start volume hand-off, not blue-green:
     the new machine cannot mount `/data` until the old one stops, so there is a
     real downtime gap (SIGTERM with 60s `kill_timeout` on the old machine; Fly
     edge returns errors until the new machine passes `/healthz` within its 45s
     grace period). The data is never at risk (DB file unchanged, WAL replays);
     what is at risk is (a) long provider work cut off mid-flight by SIGTERM and
     (b) live sessions seeing transient request failures during the gap.
   - **Backup health** — the DB is not mutated by an app-only deploy, so a full
     pre-release recovery-point ceremony is not required; the happy path verifies
     Litestream sync age is within the accepted freshness threshold and forces a
     sync only if stale.

   Net: item 4 yields three real decisions for the happy path (recorded as
   D7/D8/D9); the remainder defers with items 2/3.
5. **Maintenance and quiescence — scoped and deferred (2026-09-03).**
   Full contract: inventory every write and provider path, define drain
   behavior, and prove that unsafe in-flight work has stopped. A read-only
   inventory was performed against the deployed code (see "Item 5 inventory"
   below). Substantial machinery already exists: two durable SQLite control
   flags (`maintenance_mode`, `provider_work_enabled`) with operator CLI and
   `/healthz` exposure; an HTTP maintenance gate blocking non-GET `/api` writes;
   a provider-work gate rejecting new LLM jobs when disabled; durable reflection
   run lifecycle records (`reflection_generation_run_starts` / `_runs`); graceful
   HTTP/DB shutdown; and a runbook-documented quiescence sequence.
   For the app-only happy path, D7's procedure (disable provider work → wait
   `activeProviderWorkCount` → 0 → enable maintenance → verify freshness →
   deploy → reopen) is executable today with existing machinery, and the first
   pipeline may remain operator-driven. The full item 5 contract is therefore
   **deferred** to the schema path / later SWI-51 work. Deferred gaps include:
   in-flight provider work is not cancelable and can outlive Fly's 60s
   `kill_timeout` (arms up to 900s); `activeProviderWorkCount` is in-memory and
   resets to 0 on restart (not a durable post-deploy proof); GET `/api/*` can
   bootstrap a learner row during maintenance (maintenance gate is non-GET
   only); no durable in-flight tracking for intake triage; no orphan/stuck
   detection for surviving reflection `run_starts`; no composite quiescence-proof
   endpoint; no machine-readable write-path manifest; operator scripts bypass
   all gates; no maintenance-safe auth-bootstrap policy.

   **Active-session treatment (clarification, 2026-09-03).** A "session" is not
   a long-lived backend process; it is a learner mid-session who will issue more
   HTTP writes, with the client owning in-flight session state. The happy path
   therefore treats active sessions as "announce a maintenance window, then
   shoot any sessions still active at the request boundary": once maintenance
   is on, the learner's next write receives a clean 503 and the client retains
   its in-flight state to resume/undo after reopen. The one non-clean case is an
   active session mid-reflection-LLM-call at SIGTERM; the D7 provider-work drain
   (wait `activeProviderWorkCount` → 0 before deploy) is what converts that hard
   kill back into a cleanly stopped session. This is accepted for the early cut
   on two assumptions: (1) the client handles a mid-session 503 gracefully
   (shows maintenance / allows resume or undo) rather than breaking — a frontend
   behavior not yet verified; (2) "announcing" is operator/concierge-level (the
   operator informs the small invited cohort), not necessarily an in-app banner.
6. **Pre-reopen smoke testing — scoped (2026-09-03).** A deploy smoke is the
   one layer that catches a *broken deployed artifact in the deployed
   environment* (bad build, wrong/missing env var, frontend bundle that did not
   build, Clerk key mismatch, volume mount issue, Litestream misconfig) — failures
   that unit tests (which run against code, not the image) and `/healthz`
   (process up + DB reachable, but not auth/frontend/API/provider end-to-end)
   cannot see. For the app-only happy path the smoke is **read-only before
   reopen**: `/healthz` passes + a representative authenticated read as a test
   identity (`/api/status`, `/api/session-payload`). This is a lightweight
   automation of the operator's own dogfood squint and catches the
   "image is broken in prod" class without needing writes enabled.
   **Deferred:** the real study write smoke (needs per-learner write-window
   machinery that the current global maintenance gate does not provide) and the
   two-identity isolation proof. The isolation property is owned by the existing
   negative-test suite + post-release observation, not a per-deploy manual smoke;
   singling out isolation for per-deploy treatment was arbitrary (no more at
   risk on a typical release than study correctness, undo, completion, or
   reflection). A formal pre-reopen write smoke becomes worth it when there are
   real learners to shield from a broken deploy — a later-cohort concern.
7. **Recovery-point protocol** — define marker, forced backup synchronization,
   independently identifiable recovery point, matching old image, and ordering.
   **Deferred for the first increment (2026-09-03):** important, but easier to
   scope once the app-only happy path is nailed down more concretely. For the
   happy path, D8's verify-freshness step is the interim recovery-point posture
   (the DB is not mutated by an app-only deploy, so a named pre-release recovery
   point is not required to protect data); a lightweight identifiable marker
   for fix-forward reference may be worth adding when the full protocol is
   scoped.
8. **Release evidence — scoped (2026-09-03).** Current state is scattered: the
   app DB holds *ledgers* (`schema_migrations`, `content_imports`,
   `deployment_sentinels`, `operator_actions`, `service_controls`) that carry
   pieces of release-relevant truth but no unified release-evidence record; the
   Fly control plane holds independent deployment/image/machine history but is
   Fly-owned and not structured to the app's release identity; operator-side
   notes are manual and the runbook warns against relying on shell history.
   For the app-only happy path, step 8 emits **one content-free release-evidence
   record per release whose fields match the item-1 release-identity
   structure**: app version, git commit (`APP_REVISION`), image digest, schema
   migration count/state, content/import state, deployment time, controls state,
   smoke result, operator, and outcome (success/failed). No new behavioral
   machinery — just a defined record format emitted at step 8.
   **Storage (first increment):** app-owned but off-the-app-DB — a content-free
   JSON file on the volume (`/data/release-evidence/<release-id>.json`). This is
   durable, non-circular (a release record inside the DB it describes would be
   restored along with the DB, which is odd for recovery proof), and its format
   is exactly item 1's structure so it seeds the full evidence ledger later
   without a migration. **Mature end state (deferred):** entirely off-app
   storage (e.g. an object-store/S3 bucket) so release evidence is fully
   independent of the host and volume; not required for the first increment.
9. **Rollback versus fix-forward — deferred (2026-09-03).** Distinguish app
   rollback, compatible old app operation, reverse migration, backup restore,
   and forward repair before and after acknowledged writes reopen. Deferred for
   the first increment. Note for the happy path: because an app-only upgrade
   carries no schema migration, **app rollback is trivially available** —
   redeploy the previous image; the DB is unchanged so the old image runs
   cleanly against it. Fix-forward remains the default posture, but
   redeploy-old-image is always available as a fallback without needing a
   reverse migration or backup restore. The full rollback/fix-forward decision
   boundary (especially after acknowledged writes reopen, and for the
   schema-bearing case) is scoped later.
10. **Preflight and rehearsal — deferred (2026-09-03).** Define compatibility,
    integrity, disk, credential, backup, recovery-image, quiescence, and
    representative-copy gates before production mutation. Deferred for the first
    increment: observability itself is a sibling lane of maturity and is
    currently too nascent to support the actually valuable preflight checks
    (e.g. meaningful disk/credential/representative-copy gates) that might
    exist. For the happy path, the lightweight preflight is already constituted
    by earlier steps — quiescence (D7), backup freshness (D8), identity match +
    read-only smoke (step 5/6, D13), and the backward-compatibility assumption
    (D12). The heavier gates (representative-copy rehearsal, recovery-image,
    integrity/disk/credential gates backed by real observability) are scoped
    later, alongside the observability lane's maturity.
11. **Semantic validation — deferred (2026-09-03).** Validate learner
   isolation, scheduler/history, reflection provenance, shared publication
   lineage, content/import identity, and pending durable work in addition to
   SQLite integrity and row counts. Deferred for the first increment: this is
   largely the recovery-proof / schema-path contract. The existing
   `hosted:verify-restore` already performs SQLite integrity, row counts,
   shared-content presence, and sentinel presence, which covers the happy-path
   need alongside the read-only smoke (D13); the deeper semantic validation
   (isolation, scheduler, provenance, lineage, pending durable work) is scoped
   later with the recovery proof.
12. **Proof migration — deferred wholesale (2026-09-03).** Choose one harmless
    but real schema-bearing change that exercises the eventual migration and
    recovery contract without inventing unrelated product behavior. Deferred
    wholesale for the first increment: its whole purpose is to exercise the
    migration/recovery contract, which the app-only happy path deliberately
    excludes. No forward-looking candidate is recorded now; a proof migration
    will be chosen when the schema path is scoped.
13. **Configuration compatibility — scoped (2026-09-03).** Three parts:
   - **Record safe identity without secrets** — this is *deployment/runtime
     configuration identity* (env/config the release ran with: `APP_STUDY_PROFILE`,
     `APP_AUTH_MODE`, `APP_MODE`, `LITESTREAM_BUCKET`/`REGION`,
     `CLERK_AUTHORIZED_PARTY`, configured model arms, `APP_USE_LOCAL_PROVIDER_PROXY`,
     port/metrics), with secrets redacted (`CLERK_SECRET_KEY`, provider keys,
     Litestream keys). It is **not** per-user/learner config — learner settings
     are application data, not deployment configuration. For the happy path this
     folds into D14: the release-evidence record captures redacted deployment
     config as part of release identity (item 1's "material runtime/configuration
     compatibility assumptions without exposing secrets"). No new machinery beyond
     D14.
   - **Classify compatibility-affecting vs operational settings** — deferred
     (full-contract activity). The happy path's D12 assumption implicitly bounds
     which config changes are safe (only backward-compatible ones).
   - **Frontend-build vs backend-runtime configuration / client-backend
     compatibility** — this is the substance of the D12 backlogged item. The
     common web-app patterns are: (1) force-reload on version mismatch (frontend
     checks a build-hash endpoint on focus/reconnect and reloads itself);
     (2) backward-compatible overlap window (expand/contract — backend supports
     old + new during a window, then drops old); (3) versioned API. **Important
     refinement (2026-09-03):** force-reload-on-mismatch is NOT a compatibility
     guarantee. It only works when the old frontend is still *functional* against
     the new backend (a compatible change) — it is a "prompt reload" UX nicety,
     not a compatibility mechanism. It breaks down when the frontend holds state
     genuinely incompatible with the new backend: in-memory session state is
     discarded on reload (the D11 "shoot the session" outcome, not preserved),
     and if the break touches a response shape the old frontend parses, the old
     frontend may throw before it can poll the version endpoint — i.e. "the
     frontend reloads itself" is not well-defined when the frontend is already in
     a broken state (force-reload assumes a stable reload channel: the version
     endpoint + auth must remain backward-compatible even when everything else
     changes). So there is no clean general mechanism to ship a genuinely
     breaking change to live clients. The real options for a breaking change are
     (a) a maintenance window with no live clients during the break (reuses
     D7/D11 machinery — quiesce, ensure no active sessions, deploy frontend +
     backend together, clients return fresh), or (b) expand/contract overlap
     window (backend carries both contracts during a window, then drops old).
     Both are heavier and deferred with D12. Net: the happy path (D12,
     backward-compatible only) needs no reload machinery for correctness;
     force-reload is at most an optional prompt-reload nicety, and the
     breaking-change case requires the maintenance-window or expand/contract
     approach. This app has no versioned API, no service worker, no reload
     signal today.
14. **Operator command semantics — scoped minimal (2026-09-03).** Make
    commands strict, attributable, machine-readable, resumable where safe, and
    resistant to accidental live mutation or reliance on remembered shell
    history. Valuable for the happy path because the happy path *is* an
    operator-driven command sequence. Minimal scope for the first increment:
    (a) the upgrade pipeline is expressed as strict, attributable,
    machine-readable operator commands following the existing `hosted:*`
    conventions (strict args via `readStrictArguments`, required `--actor-id`,
    JSON output, content-free) — precedent already exists in `hosted:control`,
    `hosted:sentinel`, `hosted:inspect`, `hosted:verify-restore`; (b) the
    app-only upgrade is captured as a single reproducible command or documented
    runbook rather than remembered shell history (the SWI-51 outcome: "reproducible
    enough that future upgrades do not depend on improvised production-database
    edits or remembered shell history"); (c) commands fail loudly on bad input
    and never silently mutate live state. **Deferred:** full resumability,
    full failure-mode command coverage, and a generalized command framework.
15. **Failure matrix and verification — deferred wholesale (2026-09-03).** Cover
    incompatible and corrupt states, interrupted migrations, stale backup,
    insufficient disk, drain failure, deploy failure, smoke failure, wrong-image
    restore, and semantic isolation/provenance failure. Deferred wholesale for
    the first increment: the failure matrix is the full SWI-51 trust-gate
    verification surface and depends on the schema-path machinery (migrations,
    recovery points, rollback) that the happy path excludes. The happy path
    relies on the operator-driven gates already scoped (D7 quiescence, D8 backup
    freshness, D13 read-only smoke, D9 identity confirmation) for its limited
    failure coverage; systematic failure-injection coverage is scoped later with
    the schema path.

### Delivery/review packaging

After the substantive design topics are understood, decide whether
implementation is one cohesive PR or a small stack separating identity,
migration/compatibility, orchestration/validation, and deployed proof. This is
not counted among the 15 design topics.

**Decision (2026-09-03): one cohesive PR.** The first-increment implementation
surface is bounded and serves a single end-to-end deliverable — a reproducible
app-only upgrade happy path — with no clearly independent top-level workstream
that would benefit from a stack. The surface:

1. Wire `APP_REVISION` to the git commit at image build time (D9) —
   `deploy/fly/fly.template.toml` `[build.args]` and the deploy command / generated
   `fly.toml`.
2. Extend `hosted:inspect` and `/healthz` to report app release identity
   (version, git commit, image digest) (D9) — `server/observability.ts`,
   `getHostedOperationalDiagnostics` in `server/db/hosted-operations.ts`,
   `scripts/inspect-hosted-service.ts`, and the `/healthz` handler in
   `server/index.ts`.
3. Emit the content-free release-evidence record to
   `/data/release-evidence/<release-id>.json` (D14) — a new or extended
   operator script following `hosted:*` conventions.
4. Express the upgrade pipeline as a reproducible operator command or documented
   runbook following `hosted:*` conventions (D16) — a new `hosted:upgrade` script
   or a runbook section in `docs/ops/hosted-beta-deployment.md`, plus the
   matching doc update. Per repo convention, docs changed alongside
   implementation remain part of the same PR.

The quiescence (D7), backup-freshness verify (D8), and read-only smoke (D13)
steps reuse existing machinery (`hosted:control`, Litestream sync, `/healthz`,
authenticated read) and add no new code. This is a small, cohesive surface that
fits one PR. If the human prefers a stack, the only natural split would be
(identity wiring + inspect/healthz) vs (evidence record + runbook), but the
shared context and small size make one PR the cleaner default.

## First-increment boundary: accepted

The first increment is a reproducible **application-only upgrade happy path**
for straightforward changes with no database schema change. Concretely, for a
given target release the operator runs:

1. **Record identities** — capture the currently-running app identity (version,
   git commit, image digest) via `hosted:inspect`, and the target identity
   (the commit being deployed and the image it will produce).
2. **Quiesce** — disable provider work, wait for `activeProviderWorkCount` to
   reach 0, then enter maintenance. Confirm via `/healthz`.
3. **Verify backup freshness** — confirm Litestream sync age is within the
   accepted threshold; force a sync only if stale.
4. **Deploy** — `fly deploy --config deploy/fly/.generated/fly.toml --remote-only --ha=false`.
5. **Confirm the target** — wait for `/healthz` to pass on the new machine, then
   `hosted:inspect` to confirm the running app identity matches the target
   (version, git commit, image digest) and schema state is unchanged.
6. **Read-only smoke (before reopen)** — as a test identity, perform a
   representative authenticated read (`/api/status`, `/api/session-payload`) to
   confirm the deployed artifact works end-to-end in the deployed environment
   (catches bad build / config / env / frontend-bundle / auth failures that
   `/healthz` and unit tests cannot see). Writes remain closed.
7. **Reopen** — disable maintenance (writes reopen), then re-enable provider work.
8. **Record** — note source/target identities, deploy outcome, and confirmation
   result for this release.

Explicitly **not** provided by this increment: schema migration execution,
compatibility preflight/enforcement, representative-copy rehearsal, a named
recovery point, pre-reopen two-identity write smoke, rollback/fix-forward
machinery, or a durable release-evidence ledger. These remain within the full
SWI-51 outcome and are tracked by items 2/3/5–15.

### Happy-path compatibility assumption (client/backend skew)

The browser owns in-flight session state and does **not** auto-reload on a
backend deploy. A learner with a tab open across the deploy boundary is
therefore running the **previously-deployed frontend** against the **new
backend** — the API gate stops new writes with a 503 but does not reload the
client. The app-only happy path therefore assumes the target backend is
**backward-compatible with the previously-deployed frontend** that live tabs may
still be running (no breaking API contract change, no session-state semantics
change that an open tab would hit). "Simple upgrade" thus means not only
"no schema change" but also "no breaking client/backend contract change." A
deploy that violates this assumption is out of scope for the happy path and
belongs to the incompatible-change design item below.

### Build-time identity gap (evidence)

`deploy/fly/fly.template.toml` `[build.args]` only passes
`VITE_CLERK_PUBLISHABLE_KEY`. `APP_REVISION` is never supplied, so the
Dockerfile's `APP_REVISION` defaults to `unknown` and `buildInfo.deployment` in
`server/observability.ts` falls back to `FLY_IMAGE_REF`/`FLY_MACHINE_VERSION`.
The git-commit leg of release identity is therefore absent on the deployed
image today. D9 requires wiring `APP_REVISION` to the git commit at build time
(e.g. a build arg derived from `git rev-parse HEAD` in the deploy command or
generated `fly.toml`). This is a concrete first-increment implementation task.

## Candidate implementation deferrals

These remain within the eventual SWI-51 outcome but are intentionally eligible
to follow the first application-only upgrade pipeline:

- schema migration execution and compatibility enforcement;
- comprehensive preflight and representative-copy rehearsal;
- pre-reopen two-identity write smoke;
- explicit rollback/fix-forward machinery;
- independently named recovery points and semantic restore proof;
- a durable release-evidence ledger and external evidence bundle;
- failure-injection coverage beyond the application-only path;
- **incompatible server/frontend change handling** — server changes that are
  not backward-compatible with a previously-deployed frontend still running in
  live browser tabs. Today there is no mechanism to force or prompt a client
  reload across a deploy (no service worker, no version-handshake/reload
  signal), so such a change cannot be safely rolled through the happy path.
  Needs a design item covering: a client/backend version-skew compatibility
  contract, a reload-or-reject signal, and a deploy strategy for breaking API
  changes (distinct from schema migration). This is a frontier-adjacent
  concern under "Release truth and recovery" that item 3's current
  app/schema framing does not cover.

## Explicit non-goals to preserve

- zero-downtime or dual-schema deployment;
- fully automated CI/CD or a generalized promotion system;
- Postgres, multiple app instances, or multi-region recovery;
- automatic destructive rollback;
- generalized import or another dogfood cutover;
- public signup, billing, generalized administration, or external invitations;
- learning-model or broad product redesign.

## Decision register

| ID | Decision | Current rung | Notes |
| --- | --- | --- | --- |
| D1 | First delivery is a simple application-only upgrade pipeline | human direction / candidate scope | Reproducible build, deploy, identity, and confirmation first; do not require the entire schema/recovery program. |
| D2 | Work through the full inventory before final deferral choices | human direction | Awareness first; implementation scope is classified incrementally. |
| D3 | Release identity model | accepted for current design | Application version is a user-facing release label; Git commit identifies exact source; image digest identifies the artifact; and deployment identity identifies an installation plus material configuration. Intermediate builds do not inherently require a version bump. |
| D4 | Maintenance/backup steps in the application-only slice | unresolved | Decide after release identity and minimum pipeline semantics are clearer. |
| D5 | Full migration compatibility policy | deferred design checkpoint | Do not accept a consequential policy without human review. |
| D6 | Release evidence relationship | accepted for current design | Evidence is critical metadata associated with a release or deployment attempt, but it is not part of release identity. Persist only evidence whose actual result, coordinates, failure, or path dependence matters. |
| D7 | Quiescence for app-only upgrade | accepted for first increment | Enter maintenance + drain provider work (wait `activeProviderWorkCount` to 0) before `fly deploy`; reopen writes first, provider work last. Rationale: single-machine/single-volume deploy is a stop-then-start hand-off with a real gap, so proactive maintenance gives learners a clean 503 and ensures no write is mid-flight at SIGTERM rather than rug-pulling active sessions with transient errors. |
| D8 | Backup discipline for app-only upgrade | accepted for first increment | Verify Litestream sync age is within the accepted freshness threshold before deploy; force a sync only if stale. The DB is not mutated by an app-only deploy, so a full pre-release recovery-point ceremony is deferred to the schema path. |
| D9 | Release identity surface for app-only upgrade | accepted for first increment | Extend `hosted:inspect` (and optionally `/healthz`) to report app release identity — version, git commit (`APP_REVISION`), and image digest — so the operator can confirm "the target is running" from the runbook's own inspect command without scraping Prometheus. Requires wiring `APP_REVISION` to the git commit at image build time (currently `unknown` — see evidence gap below). |
| D10 | Item 5 (maintenance & quiescence) full contract | deferred for first increment | Substantial quiescence machinery already exists and is sufficient to execute D7's operator-driven procedure for the app-only happy path. The full item 5 contract (durable in-flight tracking, orphan detection, cancelable provider work, composite quiescence-proof endpoint, write-path manifest, maintenance-safe auth bootstrap) is deferred to the schema path / later SWI-51 work. |
| D11 | Active-session treatment in the happy path | accepted for early cut | Active sessions are treated as "announce maintenance window, then shoot remaining at the request boundary" (next write → clean 503; client retains in-flight state to resume/undo). The provider-work drain (D7) is what makes the one long case (mid-reflection-LLM-call) clean instead of a hard kill. Accepted for the early cut on two assumptions: client handles mid-session 503 gracefully (not yet verified), and "announcing" is operator/concierge-level for the small invited cohort. |
| D12 | Client/backend version skew across a deploy | accepted as happy-path assumption; incompatible case backlogged | The browser does not auto-reload on a backend deploy, so a live tab runs the old frontend against the new backend. The happy path assumes the target backend is backward-compatible with the previously-deployed frontend (no breaking API contract or session-state semantics change); no reload machinery is needed for correctness in that case. Incompatible server/frontend changes are out of scope for the happy path and backlogged as a deferred design item. Force-reload-on-mismatch is NOT a solution for the breaking case (it only prompts reload for compatible changes; it does not handle incompatible held state, and "the frontend reloads itself" is not well-defined when the frontend is already broken). The real options for a breaking change are a maintenance window with no live clients (reuses D7/D11) or an expand/contract overlap window — both heavier, both deferred. |
| D13 | Pre-reopen smoke for app-only upgrade | accepted for first increment | Read-only smoke before reopen: `/healthz` + a representative authenticated read (`/api/status`, `/api/session-payload`) as a test identity. This is the one layer that catches a broken deployed artifact in the deployed environment (bad build/config/env/frontend-bundle/auth) that unit tests and `/healthz` cannot see — a lightweight automation of the operator's dogfood squint. The real study write smoke (needs per-learner write-window machinery) and the two-identity isolation proof (owned by negative tests + post-release observation, not a per-deploy smoke) are deferred. |
| D14 | Release evidence for app-only upgrade | accepted for first increment | Step 8 emits one content-free release-evidence record per release whose fields match the item-1 release-identity structure (app version, git commit, image digest, schema state, content/import state, deployment time, controls state, smoke result, operator, outcome). Stored app-owned but off-the-app-DB as a JSON file on the volume (`/data/release-evidence/<release-id>.json`) — durable, non-circular, and the seed of the full evidence ledger. Mature end state (entirely off-app, e.g. S3) is deferred. |
| D15 | Configuration compatibility (item 13) | scoped for first increment; deeper parts deferred | Deployment/runtime config identity (env/config the release ran with, secrets redacted — not per-user config) folds into D14's evidence record. Classification of compatibility-affecting settings and frontend-build vs backend-runtime compatibility are deferred; force-reload-on-mismatch is noted as the candidate pattern for the D12 backlogged incompatible-change item. |
| D16 | Operator command semantics (item 14) | scoped minimal for first increment | The upgrade pipeline follows existing `hosted:*` conventions (strict args, required `--actor-id`, JSON output, content-free) and is captured as a single reproducible command or documented runbook rather than remembered shell history; commands fail loudly and never silently mutate live state. Full resumability, failure-mode command coverage, and a generalized command framework are deferred. |
| D17 | Failure matrix and verification (item 15) | deferred wholesale | Systematic failure-injection coverage is the full SWI-51 trust-gate verification surface and depends on schema-path machinery the happy path excludes. The happy path relies on the operator-driven gates already scoped (D7/D8/D9/D13) for its limited failure coverage. |

## Evidence to collect from manual hosted use

- exact build/image currently running and how confidently it can be recovered;
- manual steps and configuration needed for an upgrade;
- deployment duration, restart behavior, and user-visible interruption;
- whether database, WAL, learner state, and provider work behave as expected;
- missing or ambiguous status signals;
- steps easiest to omit or perform out of order;
- which facts are currently recorded only in shell history or human memory.

## Immediate next checkpoint

Items 2 (migration model) and 3 (application/schema compatibility) are
deferred for the first increment by human direction; they remain in scope for
the full SWI-51 trust gate and will be scoped when the first application-only
pipeline is proven. Item 4 (startup/readiness/migration separation) is scoped
for the app-only case. Item 5 (maintenance and quiescence) is scoped and its
full contract deferred (D10); the app-only happy path relies on existing
machinery plus the D7 procedure. Item 6 (pre-reopen smoke testing) is scoped:
read-only smoke before reopen (D13); the write smoke and two-identity isolation
proof are deferred (isolation owned by negative tests + post-release
observation).

The next checkpoint is **delivery/review packaging**: decide whether the
app-only upgrade happy path is one cohesive PR or a small stack. The first
increment's implementation surface is bounded: wire `APP_REVISION` to the git
commit at build time (D9); extend `hosted:inspect`/`/healthz` to report app
release identity (D9); emit the content-free release-evidence record to
`/data/release-evidence/<release-id>.json` (D14); and express the upgrade
pipeline as a reproducible operator command/runbook following `hosted:*`
conventions (D16). The read-only smoke (D13) and quiescence/freshness steps
(D7/D8) reuse existing machinery. This is a small, cohesive surface that likely
fits one PR, but the packaging decision is the human's.

**Design scoping complete (2026-09-03).** All 15 substantive design topics are
scoped, the delivery/review packaging decision is recorded (one cohesive PR),
and the first-increment boundary is accepted. The design phase for the app-only
upgrade happy path is finished. Implementation is a separate dispatch step:
per repo WIP/Linear policy, the human controls when the implementation is
declared in flight and dispatched. The active note remains medium-lived working
memory until SWI-51 is dispositioned and its accepted release contract has
graduated into the owning architecture and operations documents.
