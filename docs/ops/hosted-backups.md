# Hosted SQLite backup operations

Use this runbook to operate the private SQLite backup receiver, recover from a
Fly or S3 copy, and check each tier independently. Record deployment and restore
evidence for the actual image and configuration used.

## Recovery policy and storage

For a production incident, put the app in maintenance and prefer forward repair.
When the database is seriously damaged, losing up to roughly one day of activity
is acceptable. Record the chosen capture time and the writes a restore would
discard before reopening. Missed captures or uploads extend the recovery window.

| Recovery point | Cadence and retention |
| --- | --- |
| Scheduled Fly copy | Capture every six hours. The latest five successful scheduled copies span roughly a day once the schedule has filled. |
| Operator and release copies | Keep the latest manual/post-migration copy and up to three pre-switchover release copies. Release copies expire after seven days. Keep the immutable image digest with the release receipt. |
| Independent S3 copy | Every twelve hours the receiver selects a recent verified Fly capture and uploads one standalone gzip file. Under the dedicated prefix, S3 expires current objects after two days and noncurrent versions after one more day. UTC rounding and asynchronous deletion can extend physical retention. |

The private API retains the historical `hourly` kind for scheduled and manual
captures. Manual and release requests have separate retention from scheduled
recovery points. Only a successfully verified new database can displace an old
one. The S3 uploader reuses a receiver file, so it needs no additional capture on
production. The database capture timestamp identifies the recoverable state;
S3 uses upload time for lifecycle expiration.

The source uses SQLite's online backup API to produce a coherent standalone file
while the app runs. It pins one WAL read transaction for the copy so other
connections cannot repeatedly restart it; the worker deadline bounds checkpoint
delay and WAL growth. It stages in `/tmp`, outside the live `/data` volume, then
streams the completed file over Fly's private network. Do not copy an active
`app.db` alone. Capture concurrency is one; scratch admission accounts for main
file, WAL, and margin. The default transfer bound is 4 GiB. Verify actual scratch
capacity, CPU impact, and capture duration with realistic data before cutover.

The receiver owns capture scheduling, retries, verification, receipts, and retention
on a separate same-region Fly Machine. Check available space for ten full files
(five scheduled, one manual, three release, and an incoming copy), filesystem
overhead, and growth. At 1.344 GB per copy the ten files alone need 13.44 GB.
Also check scratch space for an incompressible upload and headroom during a
concurrent capture. Review capacity before enabling the new policy on the 15 GB
volume or after a significant increase in database size.

## Private configuration

Use separate random secrets of at least 32 characters for source and receiver:

| Process | Configuration |
| --- | --- |
| App/source | `APP_BACKUP_SOURCE_TOKEN`, `APP_BACKUP_SOURCE_PORT=9092`, `APP_BACKUP_SCRATCH_DIR=/tmp` |
| App/release CLI | `APP_BACKUP_RECEIVER_URL=http://<backup-app>.internal:9093`, `APP_BACKUP_RECEIVER_TOKEN` |
| Receiver | `APP_BACKUP_SOURCE_URL=http://<source-app>.internal:9092`, `APP_BACKUP_SOURCE_APP=<source-app>`, both tokens, `APP_BACKUP_DIR=/data/backups`, `PORT=9093` |

Source and receiver authenticate every private operation. Do not add public Fly
services for ports 9092 or 9093. The app's ordinary HTTP service stays separate.
Supply secrets through mode-600 files and Fly secret import, never command-line
values or committed configuration. The receiver runs `npm run hosted:backup-service`;
the app starts its source listener only when the source token is configured.
The receiver API token also permits capture requests; treat restore credentials
as privileged even when the operator intends only a download.

## Capture and inspect

Run inside a configured Machine on the private network, or through a private
operator connection. Choose a unique backup id and retain the returned receipt.
For a release, close provider work and writes and drain active work first:

```bash
npm run --silent hosted:backup -- --action=create --kind=release \
  --id=<unique-pre-switchover-id> --release-id=<release-id> \
  --source-app=<production-app> --source-revision=<running-full-sha>
npm run --silent hosted:backup -- --action=status
```

A successful receipt binds the id, kind, release id, source app/revision, capture
times, byte size, and SHA-256 to the verified file. A request timeout or lost SSH
session is unknown outcome: inspect status for the requested id before retrying.
Reuse that id only for the same operation. A receipt for a previous revision or
release is not evidence of a fresh pre-switchover backup.

## Isolated restore proof

Use the exact candidate image on an ephemeral Machine with enough isolated
storage. Supply receiver access temporarily. The output must be an absolute,
nonexistent file in an isolated directory; restore refuses an existing database
or any SQLite WAL, shared-memory, or rollback-journal sidecar. Never restore next
to sidecars from another database.

```bash
mkdir -p /tmp/hosted-restore
npm run --silent hosted:backup -- --action=restore \
  --id=<verified-backup-id> --output=/tmp/hosted-restore/app.db
npm run hosted:verify-restore -- --data-dir=/tmp/hosted-restore \
  --sentinel-id=<release-id> --minimum-learners=2
```

Restore checks size, checksum, SQLite integrity, and foreign keys. The application
validator checks the expected schema/content, sentinel, and learner count. Use the
matching old image for a pre-migration recovery point; rehearse target migrations
separately. Record receipt, image digest, validation result, and timestamp, then
remove only the disposable restore resources after preserving evidence.

`--at=<UTC-timestamp>` selects the newest retained capture completed at or before
that time; it is not point-in-time WAL replay. Without id or timestamp, restore
selects the latest retained capture. A restore before the oldest retained capture
fails. During rollout it takes four complete six-hour intervals to populate a
full day of regularly spaced restore points.

## Restoring into an app volume

Before activating a restored app, stop its processes and establish the restored
file's runtime ownership. Downloads are mode 600 and owned by the account running
the restore; an SSH restore as root therefore produces a file the `node` app user
cannot open. Restarting the Machine or remounting the volume does not fix this.

Preserve the existing `app.db` owner/group, or use the data directory's owner/group
when there is no previous database. On the standard image this is `node:node`:
run `chown node:node /data/<staged-restore>/app.db` as root after verifying the
runtime identity. Keep mode 600, verify the runtime user can read and write the
file and data directory, and then promote the validated file using the stopped-app
recovery procedure. Do not change ownership recursively or overwrite an active
database. RC promotion performs this ownership adjustment automatically before
moving either database. Root-only rehearsal validation does not prove that the
runtime user can open the restored database.

## Enabling the S3 tier

Deploy the compatible health reader and observer before switching the receiver
to six-hour captures. Preserve the Fly receiver path during initial S3 setup.
[Configure the bucket, access-log delivery, lifecycle rules and separate
writer/reader permissions](sqlite-backup-s3.md). Verify a known request in the
delivered access logs before enabling runtime uploads. Grant writer credentials
only to the receiver. Set `APP_BACKUP_S3_REQUIRED=true` on the hosted app when
activating the tier so a receiver missing its configuration is observable.

Verify one successful upload, an isolated restore, the checksum and capture
timestamp, and the two independent freshness signals. Observe a second scheduled
upload and check the corresponding request logs and bytes. Record failures,
retries and elapsed time. An S3 failure should leave local capture and restore
available. Preserve release-specific backup and stopped-migration gates in the
[release runbook](hosted-beta-deployment.md).

### Isolated S3 restore

Use the restore reader from the S3 setup guide. Select the newest capture at or
before the desired recovery time using the UTC capture timestamp in the object
key. Keep the bucket, key and image revision in the restore evidence. On an
isolated Linux restore host with enough room for both the gzip and the raw
database, set `BUCKET`, `KEY`, and `SOURCE_APP` to the selected backup. Run in Bash
with AWS CLI v2, jq, gzip and sha256sum:

```bash
set -euo pipefail
umask 077
restore_dir=$(mktemp -d)
aws s3api get-object --bucket "$BUCKET" --key "$KEY" --checksum-mode ENABLED \
  "$restore_dir/backup.sqlite.gz" > "$restore_dir/object.json"
jq -e --arg app "$SOURCE_APP" \
  '.ChecksumSHA256 and .Metadata["source-app"] == $app and
   (.Metadata["sqlite-sha256"] | test("^[a-f0-9]{64}$"))' \
  "$restore_dir/object.json" >/dev/null
gzip -dc "$restore_dir/backup.sqlite.gz" > "$restore_dir/app.db.incoming"
expected_bytes=$(jq -er '.Metadata["sqlite-bytes"]' "$restore_dir/object.json")
test "$(wc -c < "$restore_dir/app.db.incoming")" -eq "$expected_bytes"
expected_sha=$(jq -er '.Metadata["sqlite-sha256"]' "$restore_dir/object.json")
printf '%s  %s\n' "$expected_sha" "$restore_dir/app.db.incoming" | sha256sum --check
mv "$restore_dir/app.db.incoming" "$restore_dir/app.db"
jq '.Metadata | {revision: .["source-revision"], capturedAt: .["capture-started-at"]}' "$restore_dir/object.json"
```

Use the matching app image against the isolated directory. Run
`npm run hosted:verify-restore -- --data-dir="$restore_dir" --minimum-learners=2`,
including the expected sentinel ID when known. This validates SQLite integrity
and application contents. Run a read-only `PRAGMA foreign_key_check` on the
restored database and require an empty result. Follow the ownership procedure above for a later app-volume restore.

## Freshness and independent observation

The independent GitHub Actions workflow requests two checks per hour against
the public `/backup-healthz` endpoint. The deployed app queries the receiver. Local freshness
is measured from the last scheduled capture start (6h15m limit), and off-Fly
freshness from the capture represented by the last confirmed S3 upload (13h30m
limit). A missing required tier, stale capture or unreachable receiver fails
the check. During rollout the app recognizes the old hourly receiver and uses
its 75-minute limit. Normal app availability remains on `/healthz`.

For local failure, stop writes and inspect receiver reachability, scratch and
volume headroom, capture errors, and the last verified receipt. For an S3-only
failure, inspect writer configuration, denied requests, retries, scratch space,
and the latest confirmed capture. Continue local captures and restore the
offsite path before lifecycle expiry removes the remaining copies.

A failed manual workflow reached the operator by email on November 17, 2026.
Four scheduled successes were visible through November 18 at 13:27 UTC, with
gaps of five to nine hours despite the half-hour schedule. Check actual run history and subsequent recovery
when evaluating monitoring; an enabled schedule alone gives no delivery bound.

## Scratch and volume operations

Initialize a new receiver volume's `/data/backups` directory with ownership for
its runtime user (`node` in the app image) and mode 700 before starting the service.
The backup volume disables automatic Fly snapshots to avoid an extra unbounded
copy policy. The receiver enforces its scheduled, manual and release limits.
Keep production's existing volume snapshot settings unchanged.

A forced source-process kill can leave `/tmp/sqlite-backup-*` scratch directories.
Before deleting one, confirm no backup source worker is using it. Normal failures
and graceful shutdown clean their own scratch; never delete SQLite files in the
production data directory as scratch cleanup.
