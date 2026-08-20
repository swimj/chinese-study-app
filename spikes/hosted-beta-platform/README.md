# Hosted beta platform spike (SWI-46)

This is a disposable, synthetic-data-only harness for proving the hosted beta
platform shape without exposing the current local product application. It keeps
Clerk authentication, local account authorization, SQLite persistence,
Litestream replication, restore, migration, maintenance, observability, and
cost evidence inside one bounded spike.

The container runs TypeScript through Node 22's native type stripping so the
runtime image installs production dependencies only; `tsx` remains a local
development convenience.

It is not a production deployment. In particular, a Clerk development instance
on the Fly-provided domain does not prove production custom-domain or DNS setup.

## Local run

Set a Clerk development publishable key and secret key without putting them in
the repository, then use a temporary data directory:

```bash
spike_data_dir=$(mktemp -d /private/tmp/swi46-platform.XXXXXX)
APP_DATA_DIR="$spike_data_dir" \
  CLERK_AUTHORIZED_PARTY="http://127.0.0.1:5174" \
  CLERK_PUBLISHABLE_KEY="..." \
  CLERK_SECRET_KEY="..." \
  npm run spike:platform
```

The harness listens on port `5174` by default and binds all interfaces so the
Fly proxy can reach it; use the loopback URL for local work. All ordinary logs
and metrics omit email addresses, tokens, session identifiers, and synthetic
row contents.

## Live shape

- One Fly Machine in Singapore (`sin`), `shared-cpu-1x`, 512 MB.
- One 1 GB Fly Volume mounted at `/data`; SQLite runs in WAL mode with a busy
  timeout.
- Litestream 0.5.16 supervises the Node process and replicates `/data/app.db` to
  an independently administered S3 bucket in `ap-southeast-1`.
- Node 22 runs the server and Clerk Express 2.1.60 is locked in
  `package-lock.json`. Clerk invite-only mode plus application invitations are
  used; Organizations are outside this spike. The frontend loads exact ClerkJS
  6.29.2 and Clerk UI 1.30.5 CDN assets from the Frontend API domain.
- Generated resource names, private evidence, and credentials stay under the
  ignored `.generated/` or `evidence/private/` paths, or in provider secret
  stores. They must never be committed.

Copy `fly.template.toml` to `.generated/fly.toml`, replace the disposable app
name, and validate before deploying:

```bash
fly config validate -c spikes/hosted-beta-platform/.generated/fly.toml
fly deploy -c spikes/hosted-beta-platform/.generated/fly.toml --remote-only --ha=false
```

## Reproducible disposable run

Choose unique disposable names and record them only in `.generated/`. Confirm
the quoted Fly price remains within the experiment cap before creation.

```bash
export SWI46_APP="REPLACE_WITH_DISPOSABLE_APP_NAME"
export SWI46_BUCKET="REPLACE_WITH_GLOBALLY_UNIQUE_BUCKET_NAME"
export SWI46_IAM_USER="REPLACE_WITH_DISPOSABLE_IAM_USER"
export SWI46_FLY_ORG="REPLACE_WITH_FLY_ORG"

fly apps create "$SWI46_APP" --org "$SWI46_FLY_ORG"
fly volumes create app_data --app "$SWI46_APP" --region sin --size 1 --vm-size shared-cpu-1x --yes

aws s3api create-bucket --bucket "$SWI46_BUCKET" --region ap-southeast-1 \
  --create-bucket-configuration LocationConstraint=ap-southeast-1
aws s3api put-public-access-block --bucket "$SWI46_BUCKET" \
  --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
aws s3api put-bucket-encryption --bucket "$SWI46_BUCKET" \
  --server-side-encryption-configuration 'Rules=[{ApplyServerSideEncryptionByDefault={SSEAlgorithm=AES256}}]'
aws s3api put-bucket-versioning --bucket "$SWI46_BUCKET" --versioning-configuration Status=Enabled

aws iam create-user --user-name "$SWI46_IAM_USER"
# Copy iam-policy.template.json under .generated/ and replace the bucket placeholder.
aws iam put-user-policy --user-name "$SWI46_IAM_USER" \
  --policy-name swi46-litestream-prefix \
  --policy-document file://spikes/hosted-beta-platform/.generated/iam-policy.json
aws iam create-access-key --user-name "$SWI46_IAM_USER"
```

Create a Clerk development instance in **Invite-only** access mode. Keep
disposable-email blocking off when using distinct Relay masks. Copy keys into a
non-echoing handoff, not shell history or tracked files. Create
`.generated/fly.toml` from the template with the exact app origin. Stage these
Fly secrets through stdin:

```text
CLERK_PUBLISHABLE_KEY=...
CLERK_SECRET_KEY=...
LITESTREAM_ACCESS_KEY_ID=...
LITESTREAM_SECRET_ACCESS_KEY=...
LITESTREAM_BUCKET=...
```

```bash
fly secrets import --app "$SWI46_APP" --stage
fly deploy --app "$SWI46_APP" -c spikes/hosted-beta-platform/.generated/fly.toml --remote-only --ha=false
fly status --app "$SWI46_APP"
fly machines list --app "$SWI46_APP"
fly volumes list --app "$SWI46_APP"
```

Keep invitation addresses in environment variables so they never appear in
command arguments or tracked output:

```bash
# Put CLERK_SECRET_KEY, CLERK_AUTHORIZED_PARTY, and one SWI46_INVITE_EMAIL in
# chmod-600 .generated/clerk.env, then load it without echoing values.
set -a
source spikes/hosted-beta-platform/.generated/clerk.env
set +a
npm run spike:platform:clerk -- invite-and-revoke --email-env=SWI46_INVITE_EMAIL
# Replace only SWI46_INVITE_EMAIL in the ignored file, reload, then:
npm run spike:platform:clerk -- invite --email-env=SWI46_INVITE_EMAIL

fly ssh console --app "$SWI46_APP" --command \
  "node --experimental-strip-types /app/spikes/hosted-beta-platform/scripts/set-account-enabled.ts --enabled=false"
fly ssh console --app "$SWI46_APP" --command \
  "node --experimental-strip-types /app/spikes/hosted-beta-platform/scripts/set-account-enabled.ts --enabled=true"
fly ssh console --app "$SWI46_APP" --command \
  "node --experimental-strip-types /app/spikes/hosted-beta-platform/scripts/clerk-admin.ts revoke-sessions"
# Optional stronger provider disablement proof (not exercised in the recorded run):
fly ssh console --app "$SWI46_APP" --command \
  "node --experimental-strip-types /app/spikes/hosted-beta-platform/scripts/clerk-admin.ts ban-user"
fly ssh console --app "$SWI46_APP" --command \
  "node --experimental-strip-types /app/spikes/hosted-beta-platform/scripts/clerk-admin.ts unban-user"
```

After committing a unique synthetic sentinel, require remote transaction
agreement. `/metrics` reads Litestream's content-free `last_sync_at` over its
private socket and reports availability and age; alert at 3,600 seconds for the
accepted one-hour RPO.

```bash
fly ssh console --app "$SWI46_APP" --command \
  "node --experimental-strip-types /app/spikes/hosted-beta-platform/scripts/seed-sentinel.ts --sentinel-id=REPLACE_WITH_SAFE_SYNTHETIC_ID"
fly ssh console --app "$SWI46_APP" --command \
  "litestream sync -wait -timeout 60 -socket /data/litestream.sock -json /data/app.db"
```

For a release rehearsal, enable maintenance, verify private writes return 503,
force the identified pre-release sync above, migrate, validate v2, and keep
writes closed. Before reopening, an incompatible release must stop the matching
process, replace the database and WAL sidecars from that recovery point, start
the matching v1 app, smoke-test, and only then disable maintenance. After writes
reopen, v1 restore may discard acknowledged activity, so forward repair is the
default and destructive rollback requires an explicit incident decision.

Record the immutable image reference printed by `fly image show --app
"$SWI46_APP"`, then restore with that image into a temporary Machine with no
source Volume. App-level Fly secrets supply the same scoped S3 credentials.

```bash
export SWI46_IMAGE="REPLACE_WITH_RECORDED_REGISTRY_IMAGE_REFERENCE"
fly machine run "$SWI46_IMAGE" \
  /bin/sh -lc 'set -eu; mkdir -p /tmp/swi46-restore; \
    litestream restore -integrity-check full -json \
      -o /tmp/swi46-restore/app.db "s3://${LITESTREAM_BUCKET}/swi-46/app"; \
    APP_DATA_DIR=/tmp/swi46-restore node --experimental-strip-types \
      /app/spikes/hosted-beta-platform/scripts/verify-restore.ts \
      --sentinel-id=REPLACE_WITH_SAFE_SYNTHETIC_ID --schema-version=2' \
  --app "$SWI46_APP" --region sin --vm-size shared-cpu-1x --vm-memory 256 \
  --restart no --rm
```

Destroy the restore Machine. After explicit human confirmation, destroy the Fly
app, enumerate and delete **every** S3 object version and delete marker, delete
the versioned bucket, then delete the IAM access key, inline policy, and user.
Verify each returns not-found. Finally delete the Clerk instance. A normal
`aws s3 rb --force` is insufficient for a versioned bucket.

Keep the Machine running only while collecting continuous-backup evidence.
Re-check provider cost before seven days and tear down the exact recorded Fly,
S3, and temporary IAM resources after explicit confirmation.

For the controlled live migration drill, run the administrative scripts on the
Machine that owns the Volume:

```bash
fly ssh console --app "$SWI46_APP" --command \
  "node --experimental-strip-types /app/spikes/hosted-beta-platform/scripts/set-maintenance.ts --enabled=true"
fly ssh console --app "$SWI46_APP" --command \
  "node --experimental-strip-types /app/spikes/hosted-beta-platform/scripts/migrate.ts --to=2"
```

## Proof boundaries

The evidence matrix must distinguish pending-invitation revocation, current
session revocation, provider-level user disablement, and local application
disablement. The recorded run did not exercise provider ban/unban and says so;
it did prove the last case with valid Clerk authentication followed by stable
local `403 ACCOUNT_DISABLED` before private data or provider work.

For persistence, write a unique synthetic sentinel, force Litestream sync,
restore into a clean target with no source Volume, run SQLite full integrity
checking, and verify the sentinel by identifier. Record only identifiers,
timestamps, sizes, counts, latency aggregates, backup age/health, schema
version, restore result, and cost—not content or auth secrets.

Use [`evidence/proof-matrix.md`](evidence/proof-matrix.md) for the sanitized
result. Put any temporary provider exports or resource-specific raw evidence in
the ignored `evidence/private/` directory and delete it during teardown.

## Recommendation

**Conditional go, with the accepted beta bounds.** Fly + one Volume, Clerk invite-only,
SQLite WAL, and Litestream to independently administered S3 passed their
vendor-risk gates for a 3–8 learner, single-Machine beta. Keep autoscaling and
autostop off, alert on backup age over one hour, exercise an isolated restore
before real invitations and after material backup/migration changes, and use
planned maintenance for schema releases. This does not approve learner data
before the ownership foundation is complete.

One narrow proof debt remains: the sentinel was verified across a Machine
restart, but a separate `fly deploy` persistence lookup was not recorded before
teardown. Before any real learner data, repeat `sentinel -> forced sync -> fly
deploy -> sentinel lookup`. This is a bounded operational check, not a reason
to reopen the architecture or switch vendors.

Provider failure and reflection usage/cost were not exercised in this synthetic
platform deployment. The existing product path already stores concluded
provider attempts, failure classifications, token usage, pricing snapshots, and
estimated cost without requiring learner content in ordinary logs; its focused
generation-isolation and pricing tests remain the evidence for those signals.
Verify those existing signals again when Slice 2 places the real reflection path
behind hosted authentication.

The narrow fallbacks remain Railway if Fly's Machine/Volume path fails and
WorkOS AuthKit if Clerk's invitation/session path fails. If backup age or a
repeat restore fails, stop rollout and investigate Litestream/S3 first; only
then reconsider Postgres under the service-boundary triggers.
