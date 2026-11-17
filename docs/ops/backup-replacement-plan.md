# Replace Litestream with hourly SQLite backups

Implementation and operational checkpoint for the temporary backup service agreed
with Justin on November 17, 2026. This plan records the scope and acceptance
criteria; the maintained runbook must describe the final implementation.

## Authorization and agreed policy

Justin authorized implementation, runbook, review publication, provisioning a
separate Fly backup Machine with a 15 GB volume, rehearsal, and production cutover
only after a verified backup and isolated restore. Preserve existing S3 recovery
points. Do not delete old backup history or expand capacity beyond this agreement
without a concrete reason and agreement. Production app is
`chinese-study-beta-swimj`, Machine `d8917eec526978`, volume
`vol_r7ynq9xdzj0n66yr`, Singapore. Last supplied evidence shows a 3 GB production
volume and approximately 1.34 GB SQLite database; reconcile live state before ops.

- Keep the latest four successful verified hourly backups.
- Keep one pre-switchover backup per release, at most three release backups,
  expiring after seven days (whichever limit removes a backup first).
- Failed or incomplete backups never evict a good copy. Allow room for a new
  copy before pruning. Retention uses timestamped files, not in-place overwrites.
- Approximate tolerated failure-time data loss is one hour plus completion time;
  missed jobs extend it. This is a deliberate stopgap, not continuous replication.
- Create a verified pre-release backup before cutover and a post-migration backup
  before reopening, with role/retention semantics explicit in implementation.

## Architecture

One small backup service owns the hourly timer, non-overlap, receipts, verification,
and retention, with files and durable per-backup receipts on its independent persistent volume.
Place it in the same Fly region on a different physical host from production.
Production exposes authenticated private backup access, not a general-purpose
shell. Production uses SQLite's online backup API to create a coherent standalone
file; do not copy an active main database file alone. Transfer completed backups
on Fly's private network. Stage on suitable scratch space, not the crowded live
volume. Bound memory, scratch use, transfer size/time, and concurrent work.

Release tooling requests a tagged backup and waits for a verified durable receipt.
The receiver validates incoming backups before atomic publication and pruning.
The service must handle interrupted requests/restarts idempotently and report
actual successful-backup age. Independent monitoring must detect a stopped
backup service; inspect existing monitoring before introducing another provider.
No secrets or learner contents in logs or committed artifacts.

## Implementation sequence

1. Start from latest main (fetched `422d54807b26617165486e7ac1959e37158fbf38`).
   Read current persistence, release, rehearsal, monitoring, and API contracts.
2. Implement source-side consistent backup and authenticated private transfer;
   implement receiver scheduling, safe publication, receipts, retention and status.
3. Adapt app-only release, offline migration, rehearsal/restore and inspection
   paths to the new backup mechanism. Ensure production can transition while
   preserving its existing backup until replacement is proven. Remove Litestream
   runtime only at the verified cutover, not as an untested prerequisite.
4. Add focused behavior/integration tests and build/type checks. Review independently.
5. Publish one cohesive review PR; reconcile merge/release procedure before deploy.
6. Provision private backup service/15 GB volume, verify placement, credentials,
   durable receipts, source load/scratch requirements, isolated restore, retention,
   scheduler restart and failure reporting. Rehearse exact deploy image.
7. Reconcile production identity/health/disk, quiesce, obtain verified recovery
   point, deploy exact tested image, run health/smoke/backup and restore gates,
   reopen only after success. Preserve release evidence. No blind retry on lost
   terminal sessions. Clean up disposable rehearsal resources after verification.
8. Update maintained runbooks and this checkpoint with observed outcomes, costs,
   residual limits, resource identities, PR and deployment evidence.

## Evaluation

- Concurrent application writes yield a consistent restorable SQLite backup.
- Interrupted transfer, full destination, corrupt payload and source failure do
  not publish a success receipt or delete good history.
- Four-hourly / three-release / seven-day bounds, duplicate release requests,
  restart reconciliation, and atomic file/receipt publication are tested.
- Authenticated private operations reject unauthenticated requests; learner HTTP
  endpoints do not expose backups. Data/credentials are absent from log output.
- Release failure leaves controls closed and never accepts a stale receipt as a
  fresh pre-release or post-migration backup.
- Isolated restore passes integrity, foreign keys, schema and app/sentinel checks.
- Actual Fly deployment proves hourly scheduling and backup receiver independence
  from an app restart, with explicit external stale-backup detection.

## Background and evidence

Litestream `0.5.16-study-wal1` was deployed in release 88; release 89 still produced
an approximately 638 MB first-transaction backup. Original shutdown logs and
first-sync debug reason were unavailable. Controlled local/Fly rehearsal showed
incremental restarts, but did not reproduce all production lifecycle behavior.
Avoid spending this task on further WAL-continuity debugging.

AWS report attributes most spend to transfer out, but lacks download logs.
Monthly free transfer exhaustion may explain the apparent billing step; daily
usage quantities were not supplied. Bucket grew to approximately 272 GB, and
versioned retention is not yet audited. Do not assume all cost is Litestream or
promise immediate elimination of existing storage charges.

Current pricing checked: Fly volume $0.15/GB-month (15 GB = $2.25/month), plus
backup compute and snapshots. Same-region private transfer is free under current
published pricing; check organization pricing/placement before provisioning.
Hourly copies avoid remote compaction downloads. Storage growth requires alerts.

Source incident bundle:
`/Users/justin/Downloads/litestream-production-handoff-2026-11-16.tar.gz`.
Extracted read-only investigation copy:
`/tmp/litestream-production-investigation/litestream-production-handoff-2026-11-16`.
Prior patch PR: https://github.com/swimj/chinese-study-app/pull/551 (merged).


## Implementation checkpoint — 2026-11-17

- Source/receiver/client plus release, migration, rehearsal and RC integration
  implemented; 52 focused tests pass on Node22. Full regression suite running.
- Independent review caught and fixed destination-sidecar restore contamination;
  restore now refuses existing DB, WAL, SHM, or rollback journal.
- Provisioned app `chinese-study-backups-swimj` in personal organization and
  encrypted 15GB `vol_vwn5mznm7py8wo1v`, zone `1623`, Singapore. Production volume
  zone is `4b3a`. Backup volume scheduled snapshots disabled to retain bounded copies.
- Production unchanged; receiver Machine/image not yet deployed. Source scratch
  has ~7.4GB available; production /data has ~1.6GB available.
- Public GitHub repository permits free scheduled watchdog; workflow implemented
  but default-branch activation and failure-notification proof remain pending.
