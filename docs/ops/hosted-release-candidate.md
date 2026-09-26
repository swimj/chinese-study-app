# Hosted release-candidate environment

Operator runbook for a stable, manually usable Fly deployment that is separate
from the current beta. An RC refresh builds the intended commit once, restores a
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
authenticated read-only smoke, posts the RC banner, and reopens maintenance
then provider work. Record the returned digest-qualified `immutableImage` for
promotion. The banner expires after 24 hours; repost it with `hosted:banner` if
an RC remains available longer.

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
