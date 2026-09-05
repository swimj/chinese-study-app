# SWI-51 app-only hosted upgrade pipeline

status: active
type: work-bundle
created: 2026-09-04
retire-when: the first app-only upgrade pipeline is dispositioned and its accepted operational contract has graduated into docs/ops/
related:
  - STABILITY_FRONTIER.md
  - docs/private-beta-service-boundary.md
  - docs/ops/hosted-beta-deployment.md
  - https://linear.app/swimj/issue/SWI-51/define-and-prove-hosted-versioning-upgrade-release-rollback-and

## Purpose

This is the implementation packet for SWI-51's first useful delivery. It gives
an operator one command that drives an **application-only** upgrade of the
single hosted dogfood service through its eligible happy path: quiesce, deploy,
confirm, smoke, and reopen.

It is not the eventual release, migration, rollback, or recovery system. The
separate [release maturity map](2026-09-04-swi-51-release-maturity-map.md)
captures that later work.

## Delivery boundary

The first delivery is one strict, operator-launched `hosted:upgrade` command,
with a runbook for its configuration and failure handling. Once explicitly
started for an eligible target, it drives the happy path without waiting for the
operator between stages. It is not a generalized CI/CD system or an automatic
rollback/recovery command.

An eligible release must have all of these properties:

- no SQLite schema migration, data migration, content import, or intentionally
  changed persistent-data interpretation;
- backward-compatible backend and frontend/API behavior for a browser tab that
  still has the previously served frontend loaded;
- no compatibility-affecting runtime configuration change beyond settings
  already understood to be safe for the current service; and
- one Fly Machine and one mounted `/data` volume, accepting a short stop/start
  interruption rather than attempting zero-downtime deployment.

If any condition is false, this pipeline is not authorized for the release. Do
not stretch it with an ad-hoc exception; return to the relevant later design
item first.

## Required implementation outcome

The completed slice must provide the following.

1. **Release, build, and deployment identity.** The command keeps three things
   distinct:
   - The **planned release identity** is the human-facing app version and exact
     Git commit selected from the local checkout before mutation.
   - The **actual build identity** is the immutable image reference/digest that
     Fly reports for the image built from that commit.
   - The **actual deployment identity** is the specific Fly installation of
     that image: the platform release and Machine coordinates/versions reported
     after deploy and its observed time. It is an observed fact, not merely a
     logical name for the target release.

   `hosted:inspect` reports the app version and exact source revision baked into
   the running image. `APP_REVISION` must be supplied at image build time rather
   than silently remaining `unknown`. The pipeline captures Fly's actual build
   and deployment coordinates from control-plane output. Public `/healthz`
   remains a small health endpoint; release identity need not be added there.
2. **A self-driving happy path.** `hosted:upgrade` uses the existing
   `hosted:*` controls and Fly commands to execute the fixed sequence. It emits
   machine-readable stage results and exits successfully only after reopening
   the target service.
3. **A pre-reopen confirmation.** Before writes reopen, the operator proves the
   new process is healthy, its reported revision matches the intended commit,
   and a real authenticated read succeeds.
4. **Self-authenticated application read smoke.** A hosted-side
   `hosted:smoke` helper mints a short-lived Clerk session token for one
   designated, pre-existing smoke user, performs the representative API GET,
   validates the result, and does not print the token. The smoke is read-only
   with respect to application data; its temporary Clerk session is an expected
   external-auth side effect and should be revoked when practical.
5. **Ephemeral command result, not a ledger.** The command emits content-free
   JSON containing planned release, actual build and deployment identities,
   operator, timestamps, per-stage outcome, and failure detail. This supports
   the immediate caller (including an agent) but is **not** retained evidence:
   terminal history and transient task output are not a source of truth. The
   first cut deliberately has no durable invocation ledger. Git history and
   Fly's release/image/Machine history are the independently retained facts that
   can be triangulated afterward; they do not necessarily retain the pipeline's
   smoke result or exact path through the command. A local `/data` record would
   share the service Volume's failure domain and is not presented as recovery
   evidence.

## Command contract

The operator supplies an app, actor, and explicitly confirmed target to one
command. The command must validate its arguments before any live mutation,
print structured stage events without credentials, and run these stages in
order:

1. **Declare the target.** From the selected checkout, validate the
   eligible-release conditions and its prepared
   `deploy/fly/.generated/fly.toml`, capture the current inspection result, and
   derive the planned app version and Git commit. The command has no independent
   Machine-size, region, or environment override flags.
2. **Quiesce.** Disable new provider work, enable maintenance, confirm the
   persisted controls, and wait for `activeProviderWorkCount` to reach zero.
3. **Make the current backup explicit.** Force a Litestream sync while
   maintenance remains enabled and require success. This is an operational
   precaution, not a named recovery point or restore proof.
4. **Build and deploy.** The pipeline invokes the existing single-machine
   `fly deploy --remote-only` path using that checkout's prepared generated
   config. This first cut intentionally builds as part of deployment: there is
   no separate image build, registry push, promotion, or pre-built-image input.
   It supplies `APP_REVISION` from the selected Git commit and captures the
   actual image reference/digest and Fly deployment coordinates from the
   resulting platform output.
5. **Confirm the target before reopening.** Require `/healthz` success, inspect
   the new process, and compare its app version/source revision with the planned
   release. Compare the actual image and Fly deployment identity captured at
   build/deploy time with the platform's post-deploy state.
6. **Smoke with writes still closed.** Fetch the served frontend entry point,
   then invoke `hosted:smoke` on the hosted Machine. It performs the
   authenticated representative GET (for example `/api/session-payload`) as a
   **pre-existing** invited smoke user. The account must already map to a
   learner: current authentication bootstraps an unknown subject even on a GET,
   so an unfamiliar identity would violate the no-write boundary.
7. **Reopen.** Disable maintenance first, then re-enable provider work and
   confirm both controls.

If any stage from quiescence onward fails, the command exits non-zero, emits the
actual running identity and failed stage, and leaves maintenance and provider
work disabled. It must never reopen automatically after failure. The operator
then decides whether to investigate, fix forward, or manually restore service;
this slice provides no automatic rollback or recovery action.

## Required inputs before implementation dispatch

- a prepared `deploy/fly/.generated/fly.toml` in that checkout, a locally
  authenticated Fly CLI, and the intended `fly deploy --remote-only` invocation;
- a local checkout at the intended Git commit, from which the command can supply
  the exact source revision at build time;
- a dedicated, active, pre-existing Clerk smoke account, bootstrapped once in
  the hosted database; its stable `user_…` identifier is retained as protected
  hosted configuration (not its email/password); and
- confirmation that the hosted command can use the existing `CLERK_SECRET_KEY`
  to mint a short-lived smoke session without printing it; and
- the human's confirmation that the initial target release meets the eligible
  release conditions above.

## Acceptance criteria

- One explicitly confirmed command carries an eligible target from quiescence to
  successful reopen without operator intervention between stages.
- The command builds and deploys the selected checkout in one invocation, then
  records the planned release, actual image, and actual Fly deployment identity.
- The running image reports its exact baked source revision through
  `hosted:inspect`.
- The documented sequence maintains the service in maintenance through backup
  sync, deploy, identity confirmation, and smoke.
- The smoke uses an existing account, performs no intended learner write, never
  exposes its token, and makes the upgrade fail on an unexpected result.
- A failed command cannot silently reopen writes or provider work.
- Focused tests cover added identity/inspection behavior; the normal build and
  relevant script checks pass.

## Explicit non-goals

- schema/data/content migrations or compatibility enforcement;
- an exact, independently persisted release-evidence ledger;
- a named recovery point, restore rehearsal, or semantic restore proof;
- a durable record of each pipeline invocation or its smoke outcome;
- automatic rollback, reverse migrations, or automated fix-forward;
- a write smoke, isolation proof, per-learner maintenance window, or durable
  active-work tracking;
- handling breaking browser/frontend-to-backend contract changes;
- zero downtime, multiple machines, generalized CI/CD, or generalized rollback
  and recovery orchestration.

## Stop conditions

Stop and return for design input rather than implementing around any of these:

- the target needs a schema/data/content/config compatibility decision;
- the prior frontend is not safe against the target backend;
- the required smoke account cannot be used without creating a learner, or the
  hosted runtime cannot safely mint its short-lived session; or
- Fly cannot supply a trustworthy source revision/image identity for the
  deployed target.
