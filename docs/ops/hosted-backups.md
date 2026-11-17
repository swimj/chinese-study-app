# Hosted SQLite backup operations

This runbook explains the temporary hourly backup service, release recovery
points, isolated restore, and the guarded transition from Litestream. It describes
the implementation; deployment and successful production cutover must be recorded
separately in release evidence.

## Recovery policy and storage

The receiver keeps the latest four successful hourly backups and at most three
pre-switchover release backups. Release backups expire after seven days; the count
or age limit removes them, whichever comes first. A post-migration or post-deploy
capture is an hourly backup, preserving the release slot for the previous image's
recovery point. Keep the matching immutable image digest with each release receipt.
Failed or incomplete captures never replace a good backup. A completed copy is
verified and durably published before retention prunes older copies.

The intended data-loss window is approximately one hour plus capture, transfer,
and verification time. Missed jobs extend it. This is a deliberate stopgap, not
continuous replication or a long-term archive. Preserve existing S3 history;
receiver retention does not remove it or eliminate its storage charges.

The source uses SQLite's online backup API to produce a coherent standalone file
while the app runs. It pins one WAL read transaction for the copy so other
connections cannot repeatedly restart it; the worker deadline bounds checkpoint
delay and WAL growth. It stages in `/tmp`, outside the live `/data` volume, then
streams the completed file over Fly's private network. Do not copy an active
`app.db` alone. Capture concurrency is one; scratch admission accounts for main
file, WAL, and margin. The default transfer bound is 4 GiB. Verify actual scratch
capacity, CPU impact, and capture duration with realistic data before cutover.

The receiver owns the hourly timer, retries, verification, receipts, and retention
on a separate Fly Machine in the same region with a 15 GB persistent volume.
Verify a different physical host from production. Budget for seven retained full
copies, an incoming copy, and operational margin; growth requires capacity review.
A receiver restart reconciles disk state and resumes scheduling. Successful manual
captures also satisfy the hourly freshness interval.

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
selects the latest retained capture. Four hourly copies do not promise a 24-hour
recovery point. Missing history is a refusal, not permission to silently choose a
newer point. Litestream remains in the image for explicitly selected legacy S3
restores; preserve those credentials and recovery points separately.

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

## Transition and release gates

1. Reconcile live image, controls, database/volume sizes, backup freshness, and
   the receiver's independent placement. Provision the authorized 15 GB receiver
   and private credentials without removing existing replication.
2. Keep Litestream running during replacement proof. Configure and test the
   source and receiver, obtain a verified capture, and restore it in isolation.
   Exercise interrupted capture, receiver restart, hourly scheduling, retention,
   and unavailable/stale status. Retain the evidence.
3. Only after backup and isolated restore proof, quiesce the production app and
   capture a fresh release backup. Deploy the exact rehearsed image with the
   direct app command. Preserve legacy S3 history and local sidecars; do not
   delete them as an incidental cleanup step.
4. Verify identity and smoke, obtain the new image's verified hourly backup,
   perform the required restore checks, and reopen writes before provider work.
   Migration releases use the stopped-process wrapper in the migration guide.
   A failure leaves controls closed; a committed migration is not undone by a
   failed backup.

The runtime command after cutover starts the app directly, without a Litestream
replication daemon. Merely merging code or retaining the binary is not cutover
proof. A service awaiting cutover uses its existing Litestream command/config and
legacy recovery procedure until the replacement gates succeed.

## Freshness and independent observation

`GET /backup-healthz` queries the live receiver and returns 200 only for a verified
capture no older than 75 minutes, measured from capture start. Unknown, unreachable,
or stale state returns 503. `hosted:inspect` reports the same capture age. If age
exceeds 75 minutes or becomes unknown, stop writes and investigate source errors,
receiver reachability, scratch and persistent free space, and the last receipt.
A failed attempt does not refresh age or evict good history.

The GitHub `production backup health` workflow polls every 30 minutes once merged
to the default branch. Scheduled Actions can be delayed; this is a best-effort
watchdog, not guaranteed paging. Configure failure notifications for the operator
and exercise a failure before treating it as delivered monitoring.

An independent observer must poll this endpoint and notify the operator, including
when the receiver is stopped. The workflow must be active on the default branch; the endpoint alone is not
activated monitoring. Record the observer and an exercised
failure notification before declaring the operational monitoring gate complete.


## Scratch and volume operations

Initialize a new receiver volume's `/data/backups` directory with ownership for
its runtime user (`node` in the app image) and mode 700 before starting the service.
The backup volume disables automatic Fly snapshots to avoid an extra unbounded
copy policy; the four-hourly/three-release files are the retained recovery set.
Keep production's existing volume snapshot settings unchanged.

A forced source-process kill can leave `/tmp/sqlite-backup-*` scratch directories.
Before deleting one, confirm no backup source worker is using it. Normal failures
and graceful shutdown clean their own scratch; never delete SQLite files in the
production data directory as scratch cleanup.
