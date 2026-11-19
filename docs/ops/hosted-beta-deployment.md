# Hosted beta release and maintenance

Operator guide for the running invite-only Mandarin service. Start with
[Releasing](#releasing) for the rules every release follows and the decisions
left to the release agent. The remaining sections cover configuration, learner
access, and operator recovery.

The service is one 1 GB Fly Machine in `sin`, one encrypted Fly Volume at
`/data` and Clerk authentication. The application container serves both the API
and the built frontend. The [backup service](hosted-backups.md) captures
standalone SQLite copies every six hours on a separate Fly Machine and archives
recent copies to S3. Initial bring-up, disposable fixture learners, and the
dogfood cutover are complete; those recipes remain in git history.

## Runtime configuration

Generated Fly config lives at ignored `deploy/fly/.generated/fly.toml`, copied
from [`deploy/fly/fly.template.toml`](../../deploy/fly/fly.template.toml).
Never commit generated configuration or keys. Stage runtime secrets without
placing their values in a tracked file. Using a temporary
permission-restricted input file with `fly secrets import --stage` is
preferable to command-line `NAME=value` arguments. The required names are:

```text
CLERK_PUBLISHABLE_KEY
CLERK_SECRET_KEY
OPENAI_API_KEY
ZAI_API_KEY
OPENROUTER_API_KEY
APP_BACKUP_SOURCE_TOKEN
APP_BACKUP_RECEIVER_TOKEN
```

The two OpenAI arms use `OPENAI_API_KEY`, both GLM-5.3 Flash arms use
`ZAI_API_KEY`, and Gemini uses `OPENROUTER_API_KEY`. Hosted provider calls are
direct. Do not enable
`APP_USE_LOCAL_PROVIDER_PROXY`; that switch exists only for local dogfood.

The Clerk development instance remains invite-only. The Fly origin must stay
listed on that instance. `CLERK_AUTHORIZED_PARTY` is that origin.

## Invite a learner

Invite from an operator checkout, not the Clerk Dashboard and not `fly ssh`.
Dashboard invitations have no app return URL, so on a Clerk development
instance the email link opens Account Portal on `accounts.dev`. `hosted:invite`
attaches `CLERK_AUTHORIZED_PARTY` so the recipient sets a password on the study
origin and lands signed in on Home. First authenticated API use creates the
stable local learner; the invitation itself does not.

Keep invitation addresses in environment variables so they never appear in
command arguments or tracked output:

```bash
# Put CLERK_SECRET_KEY, CLERK_AUTHORIZED_PARTY, and one HOSTED_INVITE_EMAIL in
# a chmod-600 env file, then load it without echoing values.
set -a
source deploy/fly/.generated/clerk-invite.env
set +a
npm run hosted:invite -- --email-env=HOSTED_INVITE_EMAIL
```

Replace only `HOSTED_INVITE_EMAIL` between recipients.

Clerk development invitation email still comes from Clerk and is often prefixed
as development mail. Warn recipients to check spam. A production Clerk instance
with a custom sending domain is the later fix for that; it is not required for
the app-origin password page.

If you still use the Clerk Dashboard to invite, set Account Portal → Redirects
after sign-up, after sign-in, and after logo click to `/`. That is not enough
for a first-time invitee on a development instance: `$DEVHOST` is detected per
browser, and a recipient who never loaded the app stays on Clerk's default
page.

## Releasing

An agent drives every release. Tooling enforces the mechanical rules below and
stops without reopening when one fails. Within those rules the agent
chooses what the specific change needs. When a situation falls outside them, or
a tool refuses for a reason the agent believes is wrong, the agent stops,
explains what is unusual, proposes concrete steps, and waits for Justin's
approval before acting. Report any such step in the handoff.

### Rules

- **The schema decides the release kind.** `hosted:upgrade` compares the
  production migration ledger with the checkout before touching the service.
  The default code-only mode refuses pending or unknown migrations;
  `--mode=migrate` refuses a target without pending migrations or one that does
  not extend the production ledger. Content imports and operator data repairs
  use their own procedures.
- **Rehearse every migration first.** `--mode=migrate` requires a passed
  [rehearsal](hosted-release-candidate.md#ephemeral-rehearsal) of the same image
  digest, against this app, that applied exactly the migrations production has
  pending, with every check run against the copy passing. It does not prescribe
  which checks ran.
- **Back up after writes stop before migrating.** Restoring that backup is the
  migration's rollback; the migration wrapper refuses a pre-release backup
  older than an hour.
- **Deploy behind maintenance.** A restart ends any learner's session in
  progress, so production deploys run with writes closed and provider work
  drained.
- **Deploy an identified build.** The checkout is clean at the confirmed
  revision, the image carries that `APP_REVISION`, and a promoted image is
  digest-qualified and verified as the one serving.
- **Reopen only after identity and smoke pass.** A failed stage leaves controls
  as they were and never reopens.
- **Run one release process at a time.** A lost terminal session is unknown
  state; reconcile before acting (see the [terminal procedure](#agent-or-automated-terminal-driver-procedure)).
- **Recovery before reopening:** for a code-only release, redeploy the image
  recorded as `previousDeployment`; the database is untouched. For a migration,
  restore the pre-release backup with the matching old image. **After
  reopening**, prefer forward repair. Restoring a backup discards accepted
  learner activity and is a last resort that Justin decides.

### Judgment

- **Rehearsal checks.** Rehearsal runs a migration's author checks
  automatically. Add whatever else the change calls for, including comparison
  scripts written during the release.
- **Rehearsal for a code-only release.** Use it when a bounded check on
  restored data can answer a release question, such as the latency of a query
  at production data volume. Use the [browser RC](hosted-release-candidate.md#browser-rc-overview)
  when a substantially changed screen needs judging on real data. Bugs that
  depend on a sequence of learner actions belong to development testing.
- **Compatibility the tooling cannot check.** A browser tab that loaded the
  previous frontend must keep working against the new API, and runtime
  configuration or topology changes must be safe for the running service. If
  either is in doubt, raise it before deploying.
- **Timing and notice.** Choose when to run the window and whether to post a
  [banner](#post-a-pre-upgrade-banner) first.
- **Extra checks.** Add checks the change calls for and record what ran. Pass
  `--reopen=false` to stop after smoke with the service closed, run them, then
  reopen with the [service controls](#service-controls-and-offline-work).
- **Handoff.** Report the outcome, the backup receipt, `previousDeployment`, and
  any instructions or manual steps the release relied on that this runbook does
  not cover, so they can become tooling or guidance.

### Backups during a release

[Scheduled backups](hosted-backups.md) every six hours are the standing
recovery points. A code-only release also captures a verified release backup of
the outgoing revision **before** entering maintenance. The capture runs online,
so it adds no learner downtime, and it limits what a last-resort restore would
discard to activity during roughly the last few minutes before the release. It
is not the rollback mechanism for a code-only release.

A migration release captures its pre-release backup after writes stop, because
restoring that backup is its rollback. After the target starts and the service
reopens, it captures an online post-release backup of the migrated database so a
later restore need not replay the migration.

### Code-only release

`hosted:upgrade` runs these stages from a clean checkout of the intended commit,
on the single Fly Machine with its mounted `/data` volume:

1. **declare**: validate the checkout, Fly config, and optional image; read the
   production migration ledger and refuse a schema change; record the serving
   image as `previousDeployment`.
2. **backup**: capture the online release backup described above.
3. **quiesce**: disable provider work, enable maintenance, and wait for active
   provider work to drain.
4. **build-deploy**: deploy the digest-qualified image, or build remotely with
   `APP_REVISION`.
5. **confirm**: wait for health, then verify the running revision, version, Machine,
   image, and unchanged migration ledger while still closed.
6. **smoke**: check the served frontend and an authenticated read-only request
   as the [smoke account](#smoke-account).
7. **reopen**: reopen writes, then provider work, and clear any banner.

### Run the command

With a prepared generated Fly config and an authenticated Fly CLI:

```bash
git rev-parse HEAD
npm run hosted:upgrade -- \
  --app=<app-name> \
  --actor-id=<operator> \
  --confirm-source-revision=<full-40-character-sha> \
  --image=registry.fly.io/<rc-app>:<release-tag>@sha256:<tested-digest>
```

`--confirm-source-revision` must match `HEAD`. Supply `--image` with the exact
tested digest when a rehearsal or RC produced one. Omit it to build remotely
from the clean checkout with `APP_REVISION`; a manual `fly deploy` without that
build argument fails. `hosted:inspect` reports the baked app version and source
revision.

The command exits non-zero on any failure and emits the failed stage, the
best-known running identity, and `previousDeployment`. A failure before
**quiesce** leaves the service open and unchanged. A later failure leaves it
closed; inspect the failed stage, then fix forward or roll back before
reopening. To roll back, check out the previous revision and rerun this command
with `--image` set to the `previousDeployment` image reference and digest.

### Agent or automated terminal-driver procedure

An agent drives the same command, but must distinguish a terminal update from
the command's completion. The upgrade runner is a foreground local process; it
does not become a fire-and-forget Fly job after it starts.

1. Make the [judgment calls](#judgment) for the change, including any
   rehearsal, then start **one** `hosted:upgrade` process in the right mode,
   with the tested digest when available.
2. Start the process with access to the authenticated Fly CLI state. In a
   managed sandbox that blocks the operator's `~/.fly` directory, request the
   required elevated execution permission on the first launch; do not make an
   unprivileged trial first. A `failed ensuring config directory perms` error
   is only a local sandbox preflight failure, reaches no Fly stage, and says
   nothing about the service or release eligibility.
3. Preserve the terminal session handle returned by the execution environment.
   A response that has partial output or a session handle but no exit status
   means the runner is still active. It is not a failure and it is not evidence
   that Fly has finished deploying.
4. Poll or stream that exact session until it returns a terminal exit status.
   Only its final `upgrade-result` or `migration-release-result` says whether
   the runner completed, failed, and reopened controls.
5. Do not start a second upgrade merely because output is quiet, an outer tool
   invocation has yielded, or a remote build is taking longer than expected.
   Deploy, health, and smoke stages can legitimately take minutes.
6. If the terminal session itself is genuinely lost before an exit status,
   treat the release as **unknown execution state**, not failed. First perform
   read-only reconciliation of Fly status, public `/healthz`, and hosted
   release identity. Do not assume controls were reopened or retry the upgrade
   until that reconciliation establishes the state and an operator chooses the
   next recovery action.

This procedure deliberately does not claim durable release history or resumable
execution. The final terminal result is still per-invocation evidence; a lost
local runner remains an operational recovery case.

### Migration release

`hosted:upgrade --mode=migrate` runs these stages:

1. **declare**: validate the checkout, Fly config, and image; compute the
   pending migrations from the production ledger; check the rehearsal record;
   record the serving image as `previousDeployment`.
2. **quiesce**: disable provider work, enable maintenance, and drain.
3. **backup**: capture the pre-release backup of the outgoing revision.
4. **idle**: update the Machine to the target image with an idle command and
   skipped health checks, keeping the volume. The application stops.
5. **migrate**: run the [migration wrapper](schema-migrations.md#hosted-migration-wrapper)
   over SSH against the pre-release receipt.
6. **start**: deploy the same image from the Fly config, restoring the normal
   process.
7. **confirm**: verify health, identity, closed controls, and that the ledger
   now has exactly the target migrations.
8. **smoke** and **reopen**, as for a code-only release.
9. **post-backup**: capture the online post-release backup.

```bash
npm run hosted:upgrade -- \
  --mode=migrate \
  --app=<app-name> \
  --actor-id=<operator> \
  --confirm-source-revision=<full-40-character-sha> \
  --image=registry.fly.io/<image-app>:<release-tag>@sha256:<rehearsed-digest> \
  --rehearsal-run-dir=<absolute-rehearsal-run-directory>
```

The result reports `databaseState`, which decides recovery after a failure:

| `databaseState` | Meaning | Recovery before reopening |
| --- | --- | --- |
| `unchanged` | Failure before the migration ran | Redeploy `previousDeployment`, or fix and rerun |
| `unknown` | The migration did not report success, or its session was lost | Read `db:migrate --status=true` on the idle Machine before choosing |
| `migrated` | The migration committed; the previous image refuses this schema | Fix forward on the target, or restore `preReleaseBackup` with `previousDeployment` |

A failed **post-backup** happens after reopening. The service is serving; repair
backup access and capture a manual backup.

### Smoke account

The designated smoke account is the pre-existing Clerk user
`x6nscl63n@mozmail.com`. It must already map to a hosted learner; first-time
authentication bootstraps a learner even on GET and would violate the no-write
boundary. A password is not used: `hosted:smoke` mints a short-lived Clerk
session with `CLERK_SECRET_KEY`, reads `GET /api/vocabulary/statistics`, validates
the learner statistics response, and revokes the session. This probe does not
reserve words or create a study session. Never print the token.

Protected hosted configuration, in ignored
`deploy/fly/.generated/fly.toml` `[env]` or a Fly secret:

- prefer `APP_SMOKE_CLERK_USER_ID=user_…`
- `APP_SMOKE_CLERK_EMAIL` is only a resolver for that id

A `fly secrets set` of a new variable restarts the Machine; putting the values
in the generated Fly env applies them on the next deploy, which this command
performs.

### Post a pre-upgrade banner

Hours before a planned window, use the operator **Service banner** panel in the
**currently running** app. Enter the estimated update kickoff in your local
time, or select UTC, to preview and publish the standardized update notice.
Learners see the kickoff formatted in their browser time zone. This time describes
when the update is expected to start; the notice expires 24 hours after that
kickoff. The panel shows the actual expiry separately.

For other announcements, use the custom-message path. Its editor starts with
the current banner text, including a standardized update notice when one is
active. Publishing a custom message replaces that banner and sets its expiry
to 24 hours after saving.

The CLI remains available for a custom notice. Do not bake the message into the
upgrade itself. Quote the message so spaces survive `fly ssh`:

```bash
fly ssh console --app <app-name> --command \
  "npm run hosted:banner -- --data-dir=/data --actor-id=<operator> --message='Planned downtime tonight for upgrade'"
```

The notice is visible to signed-in learners on the next Home load (including
returning from a session). CLI notices expire 24 hours after posting. Successful
`hosted:upgrade` reopen also clears it and no-ops when none exists. Clear
manually with `--clear=true` instead of `--message`.

## Service controls and offline work

Operator recovery procedures and manual release steps use these controls
directly. Close provider work first, then writes, and wait for `/healthz` to
report zero active provider work. Capture a release backup with the running
source revision:

```bash
fly ssh console --app <app-name> --command \
  'npm run hosted:control -- --data-dir=/data --control=provider-work --enabled=false --actor-id=<operator>'
fly ssh console --app <app-name> --command \
  'npm run hosted:control -- --data-dir=/data --control=maintenance --enabled=true --actor-id=<operator>'
curl --fail https://<app-name>.fly.dev/healthz
fly ssh console --app <app-name> --command \
  'npm run --silent hosted:backup -- --action=create --kind=release --id=<unique-backup-id> --release-id=<release-id> --source-app=<app-name> --source-revision=<running-full-sha>'
```

Reopen writes first and provider work last, then clear any pre-upgrade banner;
`--clear=true` no-ops when none exists:

```bash
fly ssh console --app <app-name> --command \
  'npm run hosted:control -- --data-dir=/data --control=maintenance --enabled=false --actor-id=<operator>'
fly ssh console --app <app-name> --command \
  'npm run hosted:control -- --data-dir=/data --control=provider-work --enabled=true --actor-id=<operator>'
fly ssh console --app <app-name> --command \
  'npm run hosted:banner -- --data-dir=/data --clear=true --actor-id=<operator>'
```

### Idle the Machine for offline work

Use this when volume-local work cannot run inside the normal app process. After
closing the service and capturing a backup as above, replace the normal command
with an idle process while skipping health checks. The volume stays mounted.
Confirm the application and workers have stopped. Preserve the database and any
SQLite sidecars; never delete WAL files to bypass a refusal.

```bash
fly machine update --app <app-name> --command 'sleep infinity' \
  --skip-health-checks <machine-id>
```

Recovery procedures that also call for a volume snapshot take one before the
operation:

```bash
fly volumes snapshots create <volume-id>
```

To return to service, deploy the intended image from the generated Fly config,
which restores the normal process, then verify and reopen as above:

```bash
fly deploy --app <app-name> --config deploy/fly/.generated/fly.toml \
  --image <digest-qualified-image> --ha=false --strategy immediate
```

Do not start the normal application against an unbaselined or pending schema;
startup refuses it. Create an attributable marker before an important manual
operation and record its id in the evidence:

```bash
fly ssh console --app <app-name> --command \
  'npm run hosted:sentinel -- --data-dir=/data --sentinel-id=<release-id> --actor-id=<operator>'
```

## Operator-only access

Timed daily sessions are the default once migration `0071_timed_daily_sessions`
is applied. To roll new sessions back to classic rules without a restart, run
`hosted:control` with `--control=timed-sessions --enabled=false`; sessions already
open keep the paradigm they started under, and skip counts stay stored but unread.

Use operator-only access to run the application for diagnostics while blocking
other learners. It preserves normal operator application behavior, subject to
the independent maintenance and provider-work controls. The configured
`APP_OPERATOR_CLERK_USER_IDS` allowlist determines access; an empty allowlist
blocks everyone. Confirm your Clerk user is already in that configuration
before enabling the control.

This control requires migration `0056_operator_only_access`. Its initial release
uses the [offline migration procedure](schema-migrations.md); it is not a
code-only release. Later control changes do not require restarting the
service:

```bash
fly ssh console --app <app-name> --command \
  'npm run --silent hosted:control -- --data-dir=/data --control=operator-only --enabled=true --actor-id=<operator>'
```

Verify `GET /api/service-access` reports `allowed: false` without an operator
session and `allowed: true` with your verified operator session. Verify a
non-operator application request returns `503 OPERATOR_ONLY` and your browser
can enter. The probe does not bootstrap accounts. Ordinary smoke-account checks
are blocked unless that account is explicitly an operator; do not expand the
allowlist just to make a smoke check pass.

For normal interactive operator diagnostics, maintenance must be off. Choose
provider work independently: leaving it enabled retains the background workload
for all learners, while disabling it pauses new provider dispatch globally.
Operator-only access does not stop local background processing, cancel running
requests, or create a separate diagnostic database. Operator actions use the
live database and retain their normal effects.

Non-operators see a maintenance screen in the updated frontend. Existing tabs
switch when an API call is rejected; older frontend bundles may display their
usual request error, but the backend blocks their access. Frontend assets and
health checks remain reachable. To reopen learner access, run the same command
with `--enabled=false`, then verify access with an ordinary existing account.
The setting survives restarts and deployments; release automation must not
implicitly clear it. Keep a service offline at the infrastructure level when
no public access at all is wanted.

## Learner access

To disable or re-enable local service access for a learner, also disable or
re-enable the Clerk account and run the attributable local control:

```bash
fly ssh console --app <app-name> --command \
  'npm run hosted:learner-control -- --data-dir=/data --learner-id=<id> --disabled=true --actor-id=<operator>'
```

## Operator recovery

### Apply a reviewed pure cue batch

Use the released maintenance command to apply an editorial batch to active
shared pure cues. Each manifest change supplies the cue's `contentId`,
`expectedVersion`, and `rationale`. Supply an `edit` with any of `axis`,
`stimulus`, and `teachingNote`, or a `split` array with a draft for each
accepted member. A split draft supplies `wordId`, `stimulus`, `teachingNote`,
and the eligible `senseId` when the inventory is established. The enclosing
JSON object has a batch `rationale` and a `changes` array.

Rehearse on a disposable, consistent copy. Use the operator's allowlisted Clerk
subject and keep the manifest, preview, and receipt in private operator evidence.
Preview opens the existing database read-only. It returns the resolved operations
and their digest without making provider calls.

```bash
npm run --silent hosted:maintain-pure-cues -- \
  --data-dir=/absolute/data --manifest=/absolute/batch.json --actor-id=<operator>
```

For production, follow the maintenance procedure to disable provider work, enter
maintenance, wait for active provider work to drain, and obtain a verified release backup. Take
a fresh recoverable snapshot. Preview on the live file and compare the operations
with the approved editorial batch. Pass its exact digest to the same command.

```bash
npm run --silent hosted:maintain-pure-cues -- \
  --data-dir=/data --manifest=/absolute/batch.json --actor-id=<operator> \
  --confirm-plan=<digest>
```

The preview lists overlapping drafts and proposals awaiting review. They remain
in review with their original source versions. An approved proposal or pending
approval blocks the batch. Apply rechecks service controls, source versions,
proposal overlap, and split sense eligibility under one write transaction. It
records approval and an application receipt through the normal proposal writer. A split retires the shared cue and
creates the individual exercises together. Historical cue versions and learner
schedules stay attached to the retired identity. If output is lost, look up the
application by its `pure-cue-maintenance/<digest>` idempotency key. A repeated
application reports the existing receipt ID.

Verify the receipt against the expected revisions, confirm new exercises have
only their intended member, and check source history and schedule retention.
Check general production coverage and current mode eligibility for split words.
Reopen with the standard controls and verify health.

### Backfill missing GPT-6 Luna invocation costs

`hosted:backfill-luna-costs` estimates unknown direct-OpenAI `gpt-6-luna`
invocation costs from retained token usage. It covers terminal attempts, including
failed or invalid responses with usage, and preserves known costs, running calls,
and original invocation evidence. Missing or invalid usage, requests outside the
Standard/default 30-minute cache pricing basis, and input beyond 272K tokens are
reported as skipped. The command makes no provider calls.

Run this as a separate accounting repair after deploying the command, rather
than as part of the code-only release pipeline. Preview opens the existing
database read-only without application startup or schema migration:

```bash
fly ssh console --app <app-name> --command \
  'npm run --silent hosted:backfill-luna-costs -- --data-dir=/data'
```

Review the candidate IDs, skipped reasons, total estimated USD, and plan digest.
Apply that exact plan with an attributable operator:

```bash
fly ssh console --app <app-name> --command \
  'npm run --silent hosted:backfill-luna-costs -- --data-dir=/data --apply=true --actor-id=<operator> --confirm-plan=<digest>'
```

Apply rechecks the evidence and pricing inside one write transaction; a changed
plan refuses all updates. Each repaired row stores `estimated` spend and the
pinned pricing basis, with operator, UTC repair time, and plan digest in
`pricing_json.backfill`. Retain the command output as operation evidence.
Preview again to verify the repaired IDs are absent. Repeating a freshly
previewed plan changes no already-priced rows. Service controls are independent
of this accounting-only repair.

### Recover failed cue repairs from correct requested reviews

`hosted:recover-correct-cue-repairs` selects the latest accepted current-contract
fallback repair per word for an explicit learner, while that word has no stored
production cues (including retired ones). It preserves the failure and recovered
effects in an immutable operator audit. No hand-written SQL or provider calls
are needed; the command leaves service controls to the operator.

This command ships with `0027_correct_cue_repair_recovery`. Deploy using the
[offline schema-release procedure](schema-migrations.md), applying the migration
before target startup. Recovery may run in that window or a later maintenance
window:

1. Disable provider work, enable maintenance, and wait for `/healthz` to report
   zero active provider work. Obtain a verified release backup and take a fresh volume snapshot
   before recovery, using the commands above.
2. Preview the plan from the deployed image:

   ```bash
   fly ssh console --app <app-name> --command \
     'npm run --silent hosted:recover-correct-cue-repairs -- --data-dir=/data --learner-id=<learner-id>'
   ```

   Review `candidates`, `skipped`, and `digest`. Output identifies words and
   invocations without learner responses or provider payloads; retain it as
   private operator evidence. The October 7 incident inspection found 69 distinct
   current-contract word candidates; always re-preview the live selection.
3. Confirm that digest to recover the selected batch atomically:

   ```bash
   fly ssh console --app <app-name> --command \
     'npm run --silent hosted:recover-correct-cue-repairs -- --data-dir=/data --learner-id=<learner-id> --actor-id=<operator> --apply=true --confirm-plan=<digest>'
   ```

   A changed plan refuses all writes; adapter or audit failure rolls back every
   recovery. On failure, retain maintenance and investigate before re-previewing.
4. Preview again: recovered invocations should be absent. Verify the returned
   ids, target identity, health, and authenticated hosted smoke. Original failures
   and recovered effect refs are in `operator_reflection_cue_recoveries`; the
   same invocations now report applied.
5. Reopen writes first and provider work last using the existing control commands;
   clear any pre-upgrade banner. Recovery remains a deliberate operator action.

### Provision a reflection test card

For operator smoke only, prepare one untouched shared word as a due
**production** review card for one named learner. This creates private learner
state only, does not modify shared content, refuses to overwrite existing
progress, and records an attributable operator action. It is not an HTTP
endpoint or a general-purpose state editor. Do not run it against a live
beta learner's real progress.

```bash
fly ssh console --app <app-name> --command \
  'npm run hosted:provision-review-test -- --data-dir=/data --learner-id=<id> --actor-id=<operator>'
```

Sign in as that learner, complete the production card with an intentionally
incorrect response (or select **Ask reflection to review**), finish the
session, and exercise the generated reflection. A second request for the same
learner/word fails rather than altering real progress.

### Recover one captured reflection completion

If a provider completion was captured externally after the Machine died before
the app persisted it, this narrow operator command can import it through the
normal immutable artifact writer. It accepts only a V4 evidence bundle and V7
response, runs the same structural and domain checks as the production
provider path, and creates Help Inbox entries only for result items that have
no proposal. It is idempotent for the exact same payload and refuses to replace
a different artifact for that session.

Upload the two JSON files to a node-writable, non-live path first. With
provider work disabled and maintenance enabled, run:

```bash
fly ssh console --app <app-name> --command \
  'npm run hosted:recover-reflection-completion -- \
    --data-dir=/data \
    --learner-id=<learner-id> \
    --bundle-path=/data/recovery/<bundle>.json \
    --result-path=/data/recovery/<result>.json \
    --provider=openai \
    --model=gpt-5.6-terra-high \
    --prompt-version=reflection-v9'
```

Record only the returned summary (`artifactId`, proposal count, and Help Inbox
count); do not put the learner bundle or provider response into shell history,
logs, or the repository.

## Backup and isolated restore proof

The [backup runbook](hosted-backups.md) owns retention, private configuration,
pre-switchover receipts, isolated restore, and independent S3 recovery.
`hosted:inspect` reports the age of the latest scheduled capture from the live
receiver. An unavailable receiver is unknown freshness, not a cached success.
Use `hosted:backup --action=restore` into an isolated path and
`hosted:verify-restore` with the expected sentinel and learner count after backup
or migration changes. Preserve the receipt, image identity, and validation result.

## Failure boundaries

- If `/healthz` fails, inspect `fly logs` and do not reopen maintenance.
- If scheduled Fly backup freshness is unknown or exceeds 6h15m, stop writes and
  repair local backups. An S3 freshness failure needs separate investigation on
  the receiver. The [backup runbook](hosted-backups.md) describes both checks.
- If a code-only release fails before writes reopen, keep them closed and fix
  forward or redeploy the recorded `previousDeployment` image. The database is
  unchanged, so no restore is needed.
- If a migration release fails before writes reopen, follow the
  [migration rollback](schema-migrations.md#failure-and-rollback): restore the
  pre-release backup with the matching old image.
- After writes reopen, do not roll back blindly: a restore can discard accepted
  learner activity. Keep maintenance on and choose explicit forward repair or
  an acknowledged recovery point.
- Never log Clerk secrets, provider keys, S3 keys, bearer tokens, learner notes,
  raw provider responses, or replica URLs in tickets or deployment evidence.

## One-time recovery of the Enough-for-today session

`scripts/recover-enough-session.ts` repairs the specific failure where the last
“Enough for today” action completed a finishing vocabulary session, but the
client's extra Next request prevented completion staging. It is an incident
script, not an active-session recovery interface. It changes no schema and
starts no server or workers. Use the same reviewed code for rehearsal and apply.

The script requires an explicit learner and session. Preview opens an existing
SQLite file read-only and returns the exact action boundary, covered/uncovered
word IDs, historical times, and a digest. It refuses existing completion
revisions, subsequent or overlapping study, later learning effects, changed word
mode versions, and later scheduling timestamps. It cannot prove the absence of
unlogged manual SQL changes; inspect the incident history before use.

Stage time is the final retained action's timestamp; close time is 15 seconds
later, matching the ordinary Undo window. Unknown active duration stays null.
Completion, learning effects, and downstream queue timestamps use that historical
close time. The JSON receipt separately records the actual recovery time. Retain
the preview and receipt as private operator evidence; output contains IDs and
counts but no answer text. Reserve reconciliation's request time also becomes
historical; queue processing happens when workers resume.

1. Identify the session through read-only diagnostics and verify the failure
   signature and absence of intervening activity. Follow this runbook's
   maintenance procedure: disable provider work, enable maintenance, drain
   providers, obtain a verified release backup, and take a fresh recoverable snapshot. Keep
   learner writes and workers quiescent through preview and apply.
2. Rehearse on a consistent disposable database copy. Preview:

   ```bash
   node --import tsx scripts/recover-enough-session.ts \
     --database=/absolute/path/study.db --learner-id=LEARNER --session-id=SESSION
   ```

   Review the IDs, boundary and timestamps. Apply **to the copy** using its digest:

   ```bash
   node --import tsx scripts/recover-enough-session.ts \
     --database=/absolute/path/study.db --learner-id=LEARNER --session-id=SESSION \
     --apply=true --confirm-plan=DIGEST
   ```

   Compare schedules, coverage, unchanged action history, completion/effect rows,
   and queued downstream work. Account for any UTC date boundary in the proposed
   close time. Do not infer successful recovery from the exit code alone.
3. Preview the live file again during maintenance, review that plan, and apply
   its digest with the same command. The script rechecks under `BEGIN IMMEDIATE`
   and stages/closes in one transaction. A changed plan or failed closure rolls
   back all recovery writes. A repeated invocation refuses the existing revision
   rather than applying effects twice. If output is lost, inspect the completion
   and dispatch before retrying; do not delete records to make a retry pass.
4. Retain the receipt and verify one closed completion and one post-session
   dispatch, historical scheduling, and unchanged answers. Reopen using the
   normal maintenance procedure. Verify evidence ingestion and the applicable
   reflection, Connections, reserve reconciliation, and teaching-preparation
   work progress through their ordinary workers. Queued work is not evidence
   that provider processing succeeded. Check Home/history and service health.

A refusal is a stop for investigation, not a reason to weaken the checks. This
script does not reconcile later study, recover browser-only duration, or replay
model calls itself. Running it on production is a separate operator action from
reviewing or merging its PR.
