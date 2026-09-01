# Hosted beta deployment and recovery

This is the operator runbook for the first invite-only Mandarin deployment.
The supported shape is one Fly Machine in `sin`, one encrypted Fly Volume at
`/data`, Clerk authentication, and Litestream replication to a private,
versioned S3 bucket. The application container serves both the API and the
built frontend. Initial bring-up uses disposable shared content and learners.
The dedicated dogfood cutover below later replaces that entire fixture
database; it is not a merge.

## One-time prerequisites

1. Create a Clerk development instance, disable public sign-up, and retain its
   publishable and secret keys. Add the final `https://<app>.fly.dev` origin.
2. Create a private S3 bucket in `ap-southeast-1`, enable versioning and default
   encryption, block all public access, and create a dedicated IAM principal.
   Adapt [`deploy/fly/iam-policy.template.json`](../../deploy/fly/iam-policy.template.json)
   so it can access only `chinese-study-app/hosted-beta` in that bucket.
3. Copy [`deploy/fly/fly.template.toml`](../../deploy/fly/fly.template.toml) to
   ignored `deploy/fly/.generated/fly.toml` and replace every `REPLACE_WITH_*`
   value. The Clerk publishable key is public but is needed by both the frontend
   build and the backend Clerk middleware; it is not a secret.
4. Log in with `fly auth login` and AWS credentials appropriate for creating
   the bucket and IAM principal. Never commit generated configuration or keys.

Create the Fly resources once:

```bash
fly apps create <app-name>
fly volumes create app_data --app <app-name> --region sin --size 1
```

Stage runtime secrets without placing their values in a tracked file. Using a
temporary permission-restricted input file with `fly secrets import --stage`
is preferable to command-line `NAME=value` arguments. The required names are:

```text
CLERK_PUBLISHABLE_KEY
CLERK_SECRET_KEY
OPENAI_API_KEY
ZAI_API_KEY
OPENROUTER_API_KEY
LITESTREAM_ACCESS_KEY_ID
LITESTREAM_SECRET_ACCESS_KEY
```

All five configured model arms remain available: the two OpenAI arms use
`OPENAI_API_KEY`, GLM uses `ZAI_API_KEY`, and the Gemini and Claude arms use
`OPENROUTER_API_KEY`. Hosted provider calls are direct. Do not enable
`APP_USE_LOCAL_PROVIDER_PROXY`; that switch exists only for local dogfood.

## First deployment

Deploy exactly one Machine and wait for the health check:

```bash
fly deploy --config deploy/fly/.generated/fly.toml --remote-only --ha=false
curl --fail https://<app-name>.fly.dev/healthz
```

Initialize the fresh database with the small, reproducible shared Mandarin
artifact. This command refuses dev mode, trusted-local authentication, seeds,
non-Mandarin profiles, checksum mismatches, and conflicting re-imports.

```bash
fly ssh console --app <app-name> --command \
  'npm run bootstrap:hosted:mandarin -- --data-dir=/data'
fly ssh console --app <app-name> --command \
  'npm run hosted:inspect -- --data-dir=/data --litestream-socket=/data/litestream.sock'
```

Invite two dummy users in Clerk and complete invitation acceptance in separate
browser profiles. First authenticated use creates each stable local learner.
Verify for both users: sign-in, home/status load, adding or selecting a word,
one study session, one provider-backed reflection/intake action, sign-out, and
sign-in again. Confirm that one user cannot see the other's notes, priorities,
session history, or reflections. Exercise all five model arms once; a failure
in one arm must remain attributable and must not prevent another arm working.

### Provision a reflection test card for a dummy learner

For beta smoke testing only, the operator can prepare one untouched shared word
as a due **production** review card for one named dummy learner. This creates
private learner state only, does not modify shared content, refuses to overwrite
existing progress, and records an attributable operator action. It is not an
HTTP endpoint or a general-purpose state editor.

```bash
fly ssh console --app <app-name> --command \
  'npm run hosted:provision-review-test -- --data-dir=/data --learner-id=<id> --actor-id=<operator>'
```

Sign in as that learner, complete the production card with an intentionally
incorrect response (or select **Ask reflection to review**), finish the
session, and exercise the generated reflection. Preserve the command JSON and
the learner/word pair as beta test evidence. A second request for the same
learner/word fails rather than altering real progress.

## Release and maintenance controls

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

Create an attributable marker before an important release, record its id in
the release evidence, deploy, inspect, and smoke-test. Reopen writes first and
provider work last:

```bash
fly ssh console --app <app-name> --command \
  'npm run hosted:sentinel -- --data-dir=/data --sentinel-id=<release-id> --actor-id=<operator>'
fly deploy --config deploy/fly/.generated/fly.toml --remote-only --ha=false
fly ssh console --app <app-name> --command \
  'npm run hosted:control -- --data-dir=/data --control=maintenance --enabled=false --actor-id=<operator>'
fly ssh console --app <app-name> --command \
  'npm run hosted:control -- --data-dir=/data --control=provider-work --enabled=true --actor-id=<operator>'
```

To disable or re-enable local service access for a learner, also disable or
re-enable the Clerk account and run the attributable local control:

```bash
fly ssh console --app <app-name> --command \
  'npm run hosted:learner-control -- --data-dir=/data --learner-id=<id> --disabled=true --actor-id=<operator>'
```

## One-time primary dogfood cutover

This special-purpose path replaces the disposable hosted database, including
the eight-word bootstrap, local mappings for the two test learners, and their
activity. It does not delete their Clerk accounts. A test account that signs in
afterward becomes a fresh learner against the migrated shared corpus.

Use one reviewed application image. Deploy and smoke that image against the
disposable hosted data first, then record its immutable image reference and the
current Machine id. Do not build a different image after dogfood data is
promoted.

### Rehearse and review an offline candidate

Stop local dogfood study before the final run. Preparation uses SQLite
`VACUUM INTO` to create a coherent standalone snapshot, then mutates only that
new copy. It refuses an existing output directory, requires exactly the
trusted-local dogfood learner, binds the supplied Clerk subject without
reassigning either side of an existing identity, applies the accepted
`shared_trial` backfill, and writes a content-free manifest containing the
database hash and Clerk-subject fingerprint. The candidate starts in
maintenance with provider work disabled.

Run this once as a rehearsal and inspect its JSON report. For the final run use
a new cutover id and output directory. Obtain the exact Clerk user id from the
Clerk dashboard; the dogfood account must not sign in against the replaced
database until this binding is present.

```bash
SWI57_SOURCE_DIR=/absolute/path/to/local-dogfood-data
SWI57_OUTPUT_ROOT="$(mktemp -d)"
SWI57_CUTOVER_ID=swi-57-dogfood-YYYYMMDD
SWI57_CLERK_SUBJECT=user_REPLACE_ME

npm run hosted:prepare-dogfood -- \
  --source-data-dir="$SWI57_SOURCE_DIR" \
  --output-data-dir="$SWI57_OUTPUT_ROOT/prepared" \
  --learner-id=dogfood-local \
  --clerk-subject="$SWI57_CLERK_SUBJECT" \
  --actor-id=<operator> \
  --cutover-id="$SWI57_CUTOVER_ID"
```

Record the final source snapshot time, `snapshotSha256`, `databaseSha256`,
representative before/after counts, and exact shared-trial ids. Keep the local
source unchanged and available read-only through initial hosted verification.

### Stage and validate on the Fly Volume

Create a node-writable staging directory and upload both candidate files under
non-live names. Never upload directly over `/data/app.db`.

```bash
SWI57_APP=<app-name>
SWI57_MACHINE=<machine-id>
SWI57_REMOTE_DIR="/data/incoming/$SWI57_CUTOVER_ID"

fly ssh console --app "$SWI57_APP" --command \
  "install -d -o node -g node '$SWI57_REMOTE_DIR'"
fly ssh sftp put --app "$SWI57_APP" --machine "$SWI57_MACHINE" --user node \
  "$SWI57_OUTPUT_ROOT/prepared/app.db" "$SWI57_REMOTE_DIR/app.db"
fly ssh sftp put --app "$SWI57_APP" --machine "$SWI57_MACHINE" --user node \
  "$SWI57_OUTPUT_ROOT/prepared/manifest.json" "$SWI57_REMOTE_DIR/manifest.json"

fly ssh console --app "$SWI57_APP" --command \
  "npm run hosted:promote-dogfood -- \
    --data-dir=/data \
    --incoming-db='$SWI57_REMOTE_DIR/app.db' \
    --manifest='$SWI57_REMOTE_DIR/manifest.json' \
    --cutover-id='$SWI57_CUTOVER_ID' \
    --litestream-socket=/data/litestream.sock"
```

The last command is report-only. It must reproduce the manifest validation and
incoming hash before maintenance begins.

### Quiesce, promote, and restart the same image

Disable provider work, enter maintenance, wait for active provider work to
reach zero, force Litestream sync, and create an on-demand Fly Volume snapshot.
Save the full Machine configuration. Update the owning Machine to run an idle
command with health checks skipped; this stops the normal Litestream-plus-app
CMD while leaving the Volume mounted. Confirm the Litestream socket and SQLite
sidecars are absent. Do not delete them merely to bypass a refusal—investigate
an unclean stop.

```bash
SWI57_IMAGE=<recorded-immutable-image-reference>
fly machine status --app "$SWI57_APP" --display-config "$SWI57_MACHINE"
fly volumes snapshots create <volume-id>
fly machine update --app "$SWI57_APP" --command 'sleep infinity' \
  --skip-health-checks "$SWI57_MACHINE"
```

Run promotion only in that stopped-normal-process state:

```bash
fly ssh console --app "$SWI57_APP" --command \
  "npm run hosted:promote-dogfood -- \
    --data-dir=/data \
    --incoming-db='$SWI57_REMOTE_DIR/app.db' \
    --manifest='$SWI57_REMOTE_DIR/manifest.json' \
    --cutover-id='$SWI57_CUTOVER_ID' \
    --litestream-socket=/data/litestream.sock \
    --apply=true \
    --confirm-normal-process-stopped=true"
```

Promotion keeps the previous fixture DB at
`/data/cutover-backups/<cutover-id>/app.db`. Restore the saved normal Machine
configuration with the exact recorded image and start it:

```bash
fly deploy --app "$SWI57_APP" --config deploy/fly/.generated/fly.toml \
  --image "$SWI57_IMAGE" --ha=false
```

The health response must show maintenance enabled and provider work disabled.

Before any hosted study write, prove that Litestream accepted the replacement
database generation. Force a sync, restore the replica to an isolated path, and
validate the dogfood cutover sentinel with the one migrated learner:

```bash
fly ssh console --app "$SWI57_APP" --command \
  'litestream sync -wait -timeout 60 -socket /data/litestream.sock -json /data/app.db'

# Run with the same image and restore credentials, outside /data.
mkdir -p /tmp/swi57-initial-restore
litestream restore -integrity-check full \
  -o /tmp/swi57-initial-restore/app.db \
  "s3://${LITESTREAM_BUCKET}/chinese-study-app/hosted-beta"
npm run hosted:verify-restore -- \
  --data-dir=/tmp/swi57-initial-restore \
  --sentinel-id="$SWI57_CUTOVER_ID" \
  --minimum-learners=1
```

If the forced sync or isolated restore cannot reproduce the cutover sentinel,
keep maintenance enabled and do not study. Repair the replica generation
rollover or configure a new empty replica prefix, then repeat this proof.

### Human smoke, backup proof, and source-of-truth declaration

The dogfood learner first signs in and confirms familiar scheduling, attempts,
history, cues, and reflections. Re-enable writes while keeping provider work
disabled for one representative study smoke. A disposable Clerk account then
signs in fresh and must remain isolated. Re-enter maintenance, force Litestream
sync, and perform the isolated restore proof using the cutover id as the
sentinel and at least two learners. This second proof covers post-cutover writes
and learner isolation; it does not replace the pre-write one-learner proof.

After the restored database validates, reopen writes and provider work. The
human operator explicitly declares hosted dogfood the sole writer. Keep the
final local source and the on-Volume fixture rollback unchanged during the
initial acceptance window. Once hosted study has begun, never roll back blindly:
choose forward repair or an acknowledged recovery point and record the activity
that would be lost.

## Backup and isolated restore proof

`npm run hosted:inspect` reports SQLite mode, bounded row counts and database
sizes, control state, and Litestream sync age without printing credentials or
replica coordinates. Investigate immediately if sync age approaches one hour.

Before inviting learners, and after backup or migration changes, restore into
an isolated path that is not the mounted live volume. Use the exact deployed
image and an ephemeral Machine (or the same image locally), supply only the S3
restore credentials, and run:

```bash
mkdir -p /tmp/swi56-restore
litestream restore -integrity-check full \
  -o /tmp/swi56-restore/app.db \
  "s3://${LITESTREAM_BUCKET}/chinese-study-app/hosted-beta"
npm run hosted:verify-restore -- \
  --data-dir=/tmp/swi56-restore \
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
