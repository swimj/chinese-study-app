# Release rehearsal and hosted release candidates

This guide helps release operators validate a candidate on restored production
data using separate Fly compute. Ephemeral headless rehearsal is the common
path for every schema or data migration; the browser RC workflow supports manual
application testing. The [beta release runbook](hosted-beta-deployment.md) owns
production deployment and the [migration guide](schema-migrations.md) owns the
actual stopped-writer migration.

## Ephemeral rehearsal

`hosted:rehearse` creates a performance-1x Machine and its own temporary volume
in a dedicated, secret-free Fly app. It synchronizes the production backup and
restores the latest coherent recovery point. Production keeps serving throughout;
a few minutes of subsequent activity are acceptable. Headless rehearsal needs
no Clerk or provider credentials, does not start the application, and does not
replicate the disposable database back to S3.

```text
sync source → create Machine/volume → restore → prechecks → migrate → postchecks
                                                                  ↓
                                              save evidence → destroy both resources
```

Every schema or data migration uses this path. An app-only release uses it when
changed behavior warrants realistic-data validation. The release agent can add
checks in conversation with Justin as understanding develops; there is no fixed
exhaustive rehearsal suite. Run CPU-heavy checks here before entering production
maintenance, and reserve production for its real migration, built-in integrity
checks, and essential live assertions and smoke.

### Prepare the app and source access

Create a dedicated Fly rehearsal app with no staged application secrets. Its
Machine is created for each run; no permanent Machine or application service is
needed. Keep this app distinct from production and from the browser RC app,
whose runtime secrets would broaden headless access unnecessarily.

```bash
fly apps create <rehearsal-app>
fly secrets list --app <rehearsal-app>
```

Confirm the secrets list is empty before preparation.

Use an IAM identity with the read-only source policy in
[`iam-policy.rc-source-readonly.template.json`](../../deploy/fly/iam-policy.rc-source-readonly.template.json).
Store its `LITESTREAM_ACCESS_KEY_ID`, `LITESTREAM_SECRET_ACCESS_KEY`,
`LITESTREAM_BUCKET`, `LITESTREAM_REGION`, and `LITESTREAM_REPLICA_PATH` in an
absolute, mode-600 file outside tracked source or in ignored `.generated/`
storage. The identity must have no write or delete permission on the source.
Credentials are supplied temporarily for restore; never put key values on the
command line or in release evidence.

Build and push the candidate image with its exact `APP_REVISION`, or use an
already-built digest-qualified candidate. The image used for rehearsal is the
image used for the release. Choose enough temporary volume space for the
database, SQLite temporary work, and any comparison copies the selected checks
need. Preparation accepts `--region=sin`, `--vm-size=performance-1x`, and
`--volume-size-gb=3`; these are also its defaults. Migration resource hints can
justify larger allocations.

For a new candidate, use the generated production configuration for its build
arguments, overriding the destination app. `--build-only` pushes an image without
deploying the application or changing production's Machine:

```bash
git rev-parse HEAD
fly deploy --app <rehearsal-app> \
  --config deploy/fly/.generated/fly.toml \
  --remote-only --build-only --push \
  --image-label rehearsal-<full-40-character-sha> \
  --build-arg APP_REVISION=<full-40-character-sha>
fly auth docker
docker buildx imagetools inspect \
  registry.fly.io/<rehearsal-app>:rehearsal-<full-40-character-sha>
```

Record the `Digest` from the registry inspection and construct
`registry.fly.io/<rehearsal-app>@sha256:<digest>`. Use that immutable reference
below, not the tag. The build configuration must include the intended frontend
build arguments; image identity alone cannot correct a wrong build configuration.

### Prepare, check, and migrate

```bash
npm run hosted:rehearse -- \
  --action=prepare \
  --app=<rehearsal-app> \
  --source-app=<beta-app> \
  --image=registry.fly.io/<image-app>@sha256:<candidate-digest> \
  --schema=migrate \
  --source-backup-env-file=<absolute-read-only-source-env> \
  --run-dir=<absolute-ignored-run-directory>
```

Preparation leaves the application stopped so checks can run against the
restored source before migration. Use `--schema=unchanged` for app-only work;
pending migrations are then a refusal. For `--schema=migrate`, inspect and run
the migration author's preservation checks before applying the pending batch.

```bash
npm run hosted:rehearse -- --action=check \
  --run-dir=<absolute-run-directory> --script=<absolute-before-check-script>
npm run hosted:rehearse -- --action=migrate --run-dir=<absolute-run-directory>
npm run hosted:rehearse -- --action=check \
  --run-dir=<absolute-run-directory> --script=<absolute-after-check-script>
npm run hosted:rehearse -- --action=status --run-dir=<absolute-run-directory>
```

Checks are shell scripts uploaded to the rehearsal Machine and run with
`sh -eu`, working directory `/app`, `APP_DATA_DIR=/data`, and
`APP_DEPLOYMENT_TIER=release_candidate`. They can invoke the candidate's Node
tools against `/data/app.db`. Make assertion failures exit nonzero, and record
what each check establishes. Prefer checks of affected
records and behavior; full-table hashing or broad scans need a concrete purpose,
not repetition because a previous release used them. Scripts may evolve during
the release. If a check mutates the disposable database, say so and distinguish
subsequent results from checks on the untouched post-migration state. Use a
separate working copy for behavioral scenarios when preserving that state matters.

Retain and poll the same foreground terminal session until it exits. Quiet output
or a tool yielding does not establish completion. If the session is lost, inspect
the existing run's status and Fly resource state before creating another run.
A failed check or migration prevents treating the rehearsal as passed.

### Evidence, retention, and cleanup

The new absolute run directory has mode 0700. Keep its mode-600 `manifest.json`,
`restore.json`, and `events.jsonl`, including stage durations, migration output, and custom-check
results. Retain status resource snapshots and relevant Fly metrics. Record the
image digest and source recovery point alongside the selected checks and their
outcomes. Inspect custom output before sharing it: scripts can print learner
data even when runner events are content-free. See
[release-instance observability](hosted-observability.md#release-instance-observability)
for Fly metrics, logs, and diagnosis.

Preparation retains the Machine for follow-up checks. The overall release
procedure destroys it and its volume after collecting evidence unless Justin
verbally asks to keep it:

```bash
npm run hosted:rehearse -- --action=destroy --run-dir=<absolute-run-directory>
```

Confirm both resources are removed. Stopping a Machine alone leaves its volume
allocated. On failure, preserve needed diagnostics before cleanup; use the run
record to identify exact resources if creation or teardown was interrupted.
Retained headless instances support additional SSH/script checks. For authenticated
UI testing, use the separate browser RC workflow below. Record any retention
decision and resource IDs in the handoff so someone owns eventual cleanup.

Mutating commands hold `operation.lock`; status remains available during work.
After a lost terminal, do not remove that lock until you have confirmed the local
runner and its remote command have exited. A recorded `checking` or `migrating`
state is deliberately not retryable: inspect remote processes and evidence,
then normally destroy the disposable run and prepare a fresh one. Do not edit
the manifest back to a ready state to bypass uncertain completion. If only a
stale lock remains after those checks, remove that exact lock file to permit
cleanup. No command automatically breaks a lock or retries an uncertain write.

Successful rehearsal does not replace production's fresh recovery point, actual
migration, or final smoke. A new source schema change since rehearsal requires
reconciliation, but ordinary learner activity during rehearsal does not require
a second pass solely to obtain identical data.

## Browser RC overview

The following sections operate a stable browser deployment separate from beta
and headless rehearsal. An RC refresh builds the intended commit once, restores a
roughly 24-hour-old beta backup, validates and optionally migrates it while the
app is stopped, and then activates it for smoke and subjective testing.

RC data is sensitive because it is derived from beta, but it is disposable.
Never treat activity performed on RC as durable learner activity.

## Safety boundary

The RC environment deliberately has a narrower boundary than beta:

- one distinct Fly app, Machine, `app_data_rc` Volume, backup bucket, and
  generated `deploy/fly/.generated/rc.fly.toml`;
- `APP_DEPLOYMENT_TIER=release_candidate`, which is required by the destructive
  RC database scripts;
- the same Clerk instance and publishable key as beta so copied
  `provider_subject` mappings continue to identify the same learners;
- `APP_ALLOWED_CLERK_USER_IDS` containing only the operator/manual-test account
  and the smoke account. A valid but unlisted Clerk user receives 403 before a
  learner can be bootstrapped;
- temporary, read-only beta-backup credentials used only during restore; and
- a fresh RC Litestream prefix for every restore, so a newly restored database
  never shares a replica history with an older RC generation.

Do not invite users to RC. The same Clerk account intentionally sees different
persisted state on beta and RC; the RC banner makes that distinction visible.

## One-time provisioning

1. Create the RC Fly app. Do not use the beta app or its Volume.

   ```bash
   fly apps create <rc-app>
   fly volumes create app_data_rc --app <rc-app> --region sin --size 1 --yes
   ```
2. Copy [`fly.rc.template.toml`](../../deploy/fly/fly.rc.template.toml) to the
   ignored `deploy/fly/.generated/rc.fly.toml` and replace every placeholder.
   Keep the beta Clerk instance, add the RC origin to Clerk's allowed origins,
   and set `CLERK_AUTHORIZED_PARTY` to the RC origin.
3. Create a separate RC backup bucket or credentials constrained to the RC
   prefix. [`iam-policy.rc.template.json`](../../deploy/fly/iam-policy.rc.template.json)
   is the minimum runtime shape. Stage the RC runtime secrets without putting
   values on the command line:

   ```bash
   chmod 600 deploy/fly/.generated/rc-secrets.env
   fly secrets import --stage --app <rc-app> \
     < deploy/fly/.generated/rc-secrets.env
   ```

   The file needs the Clerk secret, provider keys used for manual testing, and
   the RC bucket's `LITESTREAM_ACCESS_KEY_ID` and
   `LITESTREAM_SECRET_ACCESS_KEY`.
4. Create a different IAM identity with the read-only source policy in
   [`iam-policy.rc-source-readonly.template.json`](../../deploy/fly/iam-policy.rc-source-readonly.template.json).
   Put these values in an absolute, mode-600 file outside the repository or in
   ignored `.generated/` storage:

   ```text
   LITESTREAM_ACCESS_KEY_ID=...
   LITESTREAM_SECRET_ACCESS_KEY=...
   LITESTREAM_BUCKET=<beta-backup-bucket>
   LITESTREAM_REGION=ap-southeast-1
   LITESTREAM_REPLICA_PATH=chinese-study-app/hosted-beta
   ```

   `AWS_SESSION_TOKEN` may also be supplied. The command uploads a temporary
   credential file directly to the idle Machine as mode 600, removes its local
   copy, and installs a remote cleanup trap. These credentials must have no
   `PutObject` or `DeleteObject` permission.
5. Bootstrap the single Machine once if the app has no Machine yet. Build the
   current image with its exact revision, then start it idled so it cannot open
   an empty database before the first restore:

   ```bash
   fly deploy --app <rc-app> \
     --config deploy/fly/.generated/rc.fly.toml \
     --remote-only --build-only --push \
     --image-label bootstrap-<full-40-character-sha> \
     --build-arg APP_REVISION=<full-40-character-sha>
   fly machine run \
     registry.fly.io/<rc-app>:bootstrap-<full-40-character-sha> \
     'sleep infinity' \
     --app <rc-app> \
     --config deploy/fly/.generated/rc.fly.toml \
     --region sin \
     --volume app_data_rc:/data \
     --autostop stop \
     --restart on-failure \
     --vm-size shared-cpu-1x
   ```

   Subsequent commands require exactly one non-destroyed Machine and reuse it.
   Leave it running the normal RC config or idled with `sleep infinity`.

The config intentionally uses Fly auto-stop with zero minimum Machines. `fly`
will auto-start it when the RC origin is visited.

## State model

```text
active -> quiesced -> idle -> restored -> schema-checked/migrated
       -> database promoted -> verified -> active
```

The runner builds before touching the live RC. It then disables provider work,
enters maintenance, drains provider calls, forces a backup sync, and changes
the Machine command to `sleep infinity`. Restore and migration operate on a
staging database; only a fully validated database is atomically promoted to
`/data/app.db`. Any failed stage leaves the service closed or idle and never
reopens it automatically.

The command is a foreground process. Retain and poll the same terminal session
until it exits. Partial output is not completion. If that terminal session is
lost, treat RC as unknown state, run `--action=status`, and reconcile before
starting another refresh.

## App-only RC refresh

Use a clean checkout at the intended full commit. The default recovery point is
exactly 24 hours before command start; override it only when there is a reason.

```bash
git rev-parse HEAD
npm run hosted:rc -- \
  --action=deploy \
  --app=<rc-app> \
  --actor-id=<operator> \
  --confirm-source-revision=<full-40-character-sha> \
  --confirm-disposable-rc-data=true \
  --schema=unchanged \
  --source-backup-env-file=<absolute-path-to-read-only-source-env>
```

This fails closed if the restored backup has a pending migration. It does not
silently turn an app-only release into a schema-changing release.

Add `--image=registry.fly.io/<image-app>@sha256:<tested-digest>` to `deploy` or
`restore` to use the immutable candidate already tested in headless rehearsal.
The runner skips the build and confirms the installed digest before restoring.

## Schema-changing RC refresh

Use the same flow, declaring the expected migration explicitly:

```bash
npm run hosted:rc -- \
  --action=deploy \
  --app=<rc-app> \
  --actor-id=<operator> \
  --confirm-source-revision=<full-40-character-sha> \
  --confirm-disposable-rc-data=true \
  --schema=migrate \
  --source-backup-env-file=<absolute-path-to-read-only-source-env>
```

The runner requires at least one pending migration, applies it to the staged
database while the normal app and Litestream processes are stopped, verifies
that none remain, validates the current schema, and only then promotes it.

For a non-default point, add `--restore-age-hours=<positive-number>`. Keeping
the default near one day makes behavior comparable with beta without making RC
look perfectly synchronized with current usage.

## Prepare now, activate later

`restore` performs build, quiesce, restore, schema work, and database promotion,
then intentionally leaves the Machine idle. Its final JSON reports the
candidate image and unique RC replica path.

```bash
npm run hosted:rc -- \
  --action=restore \
  --app=<rc-app> \
  --actor-id=<operator> \
  --confirm-source-revision=<full-40-character-sha> \
  --confirm-disposable-rc-data=true \
  --schema=unchanged \
  --source-backup-env-file=<absolute-path-to-read-only-source-env>

npm run hosted:rc -- \
  --action=activate \
  --app=<rc-app> \
  --actor-id=<operator> \
  --confirm-source-revision=<full-40-character-sha> \
  --image=registry.fly.io/<rc-app>:rc-<full-40-character-sha> \
  --replica-path=chinese-study-app/hosted-rc/<generation-from-restore-result>
```

Activation starts Litestream on that generation's unique RC prefix, confirms
release identity and closed controls, checks the served frontend, runs the
authenticated read-only smoke, posts the RC banner, and reopens learner writes
while provider work stays paused. Record the returned digest-qualified `immutableImage` for
promotion. The banner expires after 24 hours; repost it with `hosted:banner` if
an RC remains available longer.

Before deliberately testing generation, inspect copied pending work and confirm
it is acceptable to run those jobs on RC. Then explicitly enable provider work:

```bash
fly ssh console --app <rc-app> --command \
  'npm run hosted:control -- --data-dir=/data --control=provider-work --enabled=true --actor-id=<operator>'
```

Use `--enabled=false` when that testing is finished. Provider work consumes real
provider resources even though the database is disposable.

## Auxiliary operations

All commands use `deploy/fly/.generated/rc.fly.toml` and refuse a config that
does not look like the RC boundary.

```bash
# Machine state, command, origin, and service inspection when active
npm run hosted:rc -- --action=status --app=<rc-app>

# Close new writes/provider work, drain, and force an RC backup sync
npm run hosted:rc -- \
  --action=quiesce --app=<rc-app> --actor-id=<operator>

# Quiesce and replace the normal process with sleep infinity
npm run hosted:rc -- \
  --action=idle --app=<rc-app> --actor-id=<operator>
```

Fly's infrastructure-level stop/start remains useful for cost and diagnostics:

```bash
fly machines list --app <rc-app>
fly machine stop --app <rc-app> <machine-id>
fly machine start --app <rc-app> <machine-id>
```

Starting a stopped Machine preserves its configured command. If it was idled,
it starts idled; use `--action=activate` to restore the normal app command.

## Manual acceptance pass

After activation, use the allowlisted manual account at the RC origin and
record the commit, restore timestamp, immutable image, tester, and result.

- Confirm the release-candidate banner and `/healthz` release identity.
- Compare a few recent beta actions with RC; roughly the final day should be
  absent, while older state should match.
- Exercise navigation, keyboard behavior, undo, empty/error states, and the
  UI details whose quality needs subjective judgment.
- Complete a study session, including the corner cases relevant to the release.
- If affected, exercise provider generation, session reflection, proposal
  review/application, and retry/failure isolation.
- Restart the RC Machine and confirm the RC-only changes persist.
- If a second allowlisted account is available, confirm account isolation. Also
  confirm a valid but unlisted Clerk account receives 403 and creates no
  learner row.

RC writes replicate only to the current unique RC prefix. The next refresh
discards the database and uses a new prefix.

## Promote the tested image to beta

For an application-only beta release, pass the exact digest-qualified image
reported by RC to the ordinary beta release command:

```bash
npm run hosted:upgrade -- \
  --app=<beta-app> \
  --actor-id=<operator> \
  --confirm-source-revision=<full-40-character-sha> \
  --confirm-eligible-release=true \
  --image=registry.fly.io/<rc-app>@sha256:<tested-digest>
```

The beta runner refuses mutable tags and confirms Fly is serving that digest.
For schema-changing beta releases, the successful RC migration is evidence,
not authorization to migrate beta online: follow the beta
[offline migration procedure](schema-migrations.md) and use the tested image.

## Failure boundaries

- Never use beta's application credentials on RC. Source credentials are
  restore-only and read-only; normal RC replication uses its own credentials.
- Never restore over the live database directly. A staging restore, full
  Litestream integrity check, raw pre-migration validation, current-schema
  validation, and atomic promotion are mandatory.
- If restore, migration, identity, frontend, or smoke validation fails, leave
  RC closed/idle and fix forward or repeat the disposable refresh.
- Do not activate against an old replica prefix. The path returned by the
  successful restore is part of that generation's identity.
- Do not log source credentials, replica URLs, Clerk secrets, tokens, learner
  notes, or provider payloads. The runner sanitizes emitted failures, but shell
  history and copied terminal output are still operator responsibilities.
