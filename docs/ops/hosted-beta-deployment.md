# Hosted beta deployment and recovery

This is the operator runbook for the first invite-only Mandarin deployment.
The supported shape is one Fly Machine in `sin`, one encrypted Fly Volume at
`/data`, Clerk authentication, and Litestream replication to a private,
versioned S3 bucket. The application container serves both the API and the
built frontend. Local dogfood data is not part of this deployment.

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
