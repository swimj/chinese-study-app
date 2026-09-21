# Hosted beta release and maintenance

Operator guide for the running invite-only Mandarin service. Complementary
procedures cover a human at an interactive terminal and an agent or automation
driving one. They use the same release command and release gates; the latter
additionally defines how to observe a long-running local terminal process
safely.

The service is one 1 GB Fly Machine in `sin`, one encrypted Fly Volume at
`/data`, Clerk authentication, and Litestream replication to a private,
versioned S3 bucket. The application container serves both the API and the
built frontend. Initial bring-up, disposable fixture learners, and the dogfood
cutover are complete; those recipes remain in git history if they must be
re-read.

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
LITESTREAM_ACCESS_KEY_ID
LITESTREAM_SECRET_ACCESS_KEY
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

## Application-only upgrade

Use this path only when the target release has **all** of these properties:

- no SQLite schema migration, data migration, content import, or intentionally
  changed persistent-data interpretation;
- backward-compatible backend and frontend/API behavior for a browser tab that
  still has the previously served frontend loaded;
- no compatibility-affecting runtime configuration change beyond settings
  already understood to be safe for the current service; and
- one Fly Machine and one mounted `/data` volume, accepting a short stop/start
  interruption.

If any condition is false, stop. Do not stretch this pipeline with an ad-hoc
exception.

The command is operator-launched from a clean checkout of the intended commit.
It validates arguments before any live mutation, then drives quiesce, backup
sync, `fly deploy --remote-only`, identity confirmation, read-only smoke, and
reopen without waiting between stages. Its terminal JSON is live, ephemeral
caller output rather than a retained evidence ledger.

### Smoke account

The designated smoke account is the pre-existing Clerk user
`x6nscl63n@mozmail.com`. It must already map to a hosted learner; first-time
authentication bootstraps a learner even on GET and would violate the no-write
boundary. A password is not used: `hosted:smoke` mints a short-lived Clerk
session with `CLERK_SECRET_KEY` and revokes it. Never print the token.

Protected hosted configuration, in ignored
`deploy/fly/.generated/fly.toml` `[env]` or a Fly secret:

- prefer `APP_SMOKE_CLERK_USER_ID=user_…`
- `APP_SMOKE_CLERK_EMAIL` is only a resolver for that id

A `fly secrets set` of a new variable restarts the Machine; putting the values
in the generated Fly env applies them on the next deploy, which this command
performs.

### Post a pre-upgrade banner

Hours before a planned window, post a signed-in chrome notice from the **currently
running** image. Do not bake the message into the upgrade itself. Quote the
message so spaces survive `fly ssh`:

```bash
fly ssh console --app <app-name> --command \
  "npm run hosted:banner -- --data-dir=/data --actor-id=<operator> --message='Planned downtime tonight for upgrade'"
```

The notice is visible to signed-in learners on the next Home load (including
returning from a session). It expires after 24 hours. Successful
`hosted:upgrade` reopen also clears it and no-ops when none exists. Clear
manually with `--clear=true` instead of `--message`.

This first banner capability is itself a schema-changing release
(`app_schema:0005_service_banner`). Use the offline migration procedure for
that landing; later app-only upgrades can post and clear banners without a
schema change.

### Human operator procedure

From the intended commit, with a prepared generated Fly config and an
authenticated Fly CLI:

```bash
git rev-parse HEAD
npm run hosted:upgrade -- \
  --app=<app-name> \
  --actor-id=<operator> \
  --confirm-source-revision=<full-40-character-sha> \
  --confirm-eligible-release=true
```

`--confirm-source-revision` must match `HEAD`. Image-source paths must be
clean. The command supplies `APP_REVISION` as a Docker build arg, so a manual
`fly deploy` without that arg will fail closed.

`hosted:inspect` reports the baked app version and source revision. Public
`/healthz` stays a small health endpoint.

If any stage from quiescence onward fails, the command exits non-zero, emits
the failed stage and best-known running identity, and **does not reopen**.
Investigate, fix forward, or restore service manually. This slice has no
automatic rollback.

### Agent or automated terminal-driver procedure

An agent drives the same command, but must distinguish a terminal update from
the command's completion. The upgrade runner is a foreground local process; it
does not become a fire-and-forget Fly job after it starts.

1. Apply the same eligibility and clean-checkout checks as the human procedure,
   then start **one** `hosted:upgrade` process.
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
   Only its final `upgrade-result` says whether the runner completed, failed,
   and reopened controls.
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

## Schema-changing releases and service controls

For a schema-changing release, stop new provider work, then stop writes. The
health response exposes only control state and the active provider-work count;
wait for that count to reach zero before forcing a backup sync.

```bash
fly ssh console --app <app-name> --command \
  'npm run hosted:control -- --data-dir=/data --control=provider-work --enabled=false --actor-id=<operator>'
fly ssh console --app <app-name> --command \
  'npm run hosted:control -- --data-dir=/data --control=maintenance --enabled=true --actor-id=<operator>'
curl --fail https://<app-name>.fly.dev/healthz
fly ssh console --app <app-name> --command \
  'litestream sync -wait -timeout 60 -socket /data/litestream.sock -json /data/app.db'
```

For schema-changing releases, including migration baseline adoption, follow the
[offline migration procedure](schema-migrations.md). The app-only
`hosted:upgrade` command cannot perform these releases.

### Idle the Machine for offline work

Use this when a schema-changing release or other volume-local work cannot run
inside the normal Litestream-plus-app process. Disable provider work, enter
maintenance, wait for active provider work to reach zero, and force a
Litestream sync first (see the commands above). Then save the full Machine
configuration, create an on-demand Fly Volume snapshot, and replace the normal
command with an idle process while skipping health checks. The Volume stays
mounted. Confirm the Litestream socket and SQLite sidecars are absent. Do not
delete them merely to bypass a refusal—investigate an unclean stop.

```bash
fly machine status --app <app-name> --display-config <machine-id>
fly volumes snapshots create <volume-id>
fly machine update --app <app-name> --command 'sleep infinity' \
  --skip-health-checks <machine-id>
```

After the offline work, restore the saved normal Machine configuration with the
recorded target image. Do not start the normal application against an
unbaselined or pending schema; see the
[offline migration procedure](schema-migrations.md).

Create an attributable marker before an important release, record its id in
the release evidence, deploy, inspect, and smoke-test. Reopen writes first and
provider work last. Clear any pre-upgrade banner after reopen; `--clear=true`
no-ops when none exists:

```bash
fly ssh console --app <app-name> --command \
  'npm run hosted:sentinel -- --data-dir=/data --sentinel-id=<release-id> --actor-id=<operator>'
fly deploy --config deploy/fly/.generated/fly.toml --remote-only --ha=false
fly ssh console --app <app-name> --command \
  'npm run hosted:control -- --data-dir=/data --control=maintenance --enabled=false --actor-id=<operator>'
fly ssh console --app <app-name> --command \
  'npm run hosted:control -- --data-dir=/data --control=provider-work --enabled=true --actor-id=<operator>'
fly ssh console --app <app-name> --command \
  'npm run hosted:banner -- --data-dir=/data --clear=true --actor-id=<operator>'
```

## Learner access

To disable or re-enable local service access for a learner, also disable or
re-enable the Clerk account and run the attributable local control:

```bash
fly ssh console --app <app-name> --command \
  'npm run hosted:learner-control -- --data-dir=/data --learner-id=<id> --disabled=true --actor-id=<operator>'
```

## Operator recovery

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

`npm run hosted:inspect` reports the baked app version and source revision,
SQLite mode, bounded row counts and database sizes, control state, and
Litestream sync age without printing credentials or replica coordinates.
Investigate immediately if sync age approaches one hour.

After backup or migration changes, restore into an isolated path that is not
the mounted live volume. Use the exact deployed image and an ephemeral Machine
(or the same image locally), supply only the S3 restore credentials, and run:

```bash
mkdir -p /tmp/hosted-restore
litestream restore -integrity-check full \
  -o /tmp/hosted-restore/app.db \
  "s3://${LITESTREAM_BUCKET}/chinese-study-app/hosted-beta"
npm run hosted:verify-restore -- \
  --data-dir=/tmp/hosted-restore \
  --sentinel-id=<release-id> \
  --minimum-learners=2
```

The validator fails unless SQLite integrity passes, shared content exists, the
expected sentinel exists, and the required learner count is present. Delete
only the isolated restore Machine/path after recording the image revision,
replica recovery point, sentinel, result, operator, and timestamp. Never test a
restore by overwriting `/data/app.db` on the live Machine.

## Failure boundaries

- If `/healthz` fails, inspect `fly logs` and do not reopen maintenance.
- If backup freshness is unknown or older than one hour, stop writes and repair
  replication before continuing.
- If a migration or smoke test fails before writes reopen, restore the recorded
  pre-release recovery point with the matching old image.
- After writes reopen, do not roll back blindly: a restore can discard accepted
  learner activity. Keep maintenance on and choose explicit forward repair or
  an acknowledged recovery point.
- Never log Clerk secrets, provider keys, S3 keys, bearer tokens, learner notes,
  raw provider responses, or replica URLs in tickets or deployment evidence.
