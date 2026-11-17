# Backup cost and observability follow-up

Agreed priorities as of November 17, 2026. Keep the temporary Fly backup service
operating while reducing the database footprint in a separate workstream.
Returning to Litestream is the intended direction for incremental backups and a
recovery destination outside Fly, but reactivation is deferred until footprint
work and the cost, observability, and recovery gates below are satisfied.

This is a decision and action record, not a production cutover procedure. The
[backup runbook](hosted-backups.md) governs the current service; the
[release runbook](hosted-beta-deployment.md) governs releases. The original
[replacement plan](backup-replacement-plan.md) records the stopgap's design.

## Current position

Production uses full SQLite online backups sent to a separate Fly Machine. Keep
the latest four successful hourly copies and at most three pre-release copies,
with release copies expiring after seven days. Existing S3 history is preserved.
Both live data and new backups currently depend on Fly; a separate Machine and
volume do not provide provider independence.

The November 17 inspection found seven consecutive scheduled backup completions,
approximately 61 minutes apart. Each copied about 1.34 GB in 80 seconds and took
about seven minutes including receiver verification. Four hourly copies and one
release copy were retained; the backup volume had about 7.7 GiB available.
These are point-in-time observations, not ongoing health guarantees.

The independent GitHub backup-health workflow was active on main but had no
scheduled executions after setup. A fresh manual execution passed. Automatic
notification coverage remains unproven until the scheduling gap is resolved.

The Fly inventory check found exactly two running Machines: production
`d8917eec526978` and backup receiver `d8d99041a02e78`. The rehearsal app had no
Machines. Neither running Machine had a Litestream process. Under the stated
boundary that this workload runs only in this Fly account, current zombie
instances are excluded from the main investigation. Historical callers remain
part of traffic attribution if evidence points to them.

## Mechanics and remaining hypotheses

SQLite WAL records revised database pages, not logical row-level commands. A
small logical change can write complete pages and affected index pages.
Litestream packages changed WAL pages into LTX files, with compression and
consolidation. Page-based logging can amplify small updates, but it does not
mean normal replication copies the whole database. Efficiency depends on page
churn, batching, compression, and backup maintenance.

When WAL continuity is lost, Litestream can write a full-state fallback into the
initial change stream. That large input then passes through successive merge
stages. It is not a permanent baseline that every subsequent merge must reread:
normal merges advance through new transaction ranges. Once the large input has
passed through a stage, later merges can be small again. Another continuity loss
can repeat the expensive sequence.

The saved incident evidence contains approximately 627 MB and 638 MB outputs
propagating across merge stages. This supports restart-fallback amplification as
a plausible contributor. It does not establish the total historical S3 downloads
or prove that restart events alone explain sustained costs in quiet periods.

Compaction resembles an LSM merge: read immutable files, consolidate page
versions, and write a larger file. Local inputs avoid S3 reads; missing local
inputs require downloads. Running the merge on Fly makes those S3 reads subject
to network charges. Bounding individual file size can limit individual work and
retry cost, but does not alone eliminate aggregate traffic across merge stages.

The old configuration requested hourly full snapshots retained for seven days.
At an illustrative 630 MB compressed snapshot, that is about 15 GB uploaded per
day and 106 GB across 168 snapshots, before change files or other retained data.
Scheduled snapshots are built locally: these uploads explain storage growth,
not by themselves S3 egress. The new full-copy system also moves substantial
bytes, about 32 GB/day at 1.34 GB per hourly copy, but has bounded retention and
uses Fly's private network.

References: [SQLite WAL format](https://www.sqlite.org/fileformat2.html#walformat),
[Litestream architecture](https://litestream.io/how-it-works/). Version-specific
behavior above was inspected in the pinned Litestream source revision
`6d61ef5d007756d62e473daee4c760ac395a55c6` used by the custom binary.

## Actions in priority order

### 1. Repair and verify independent backup alerts

Investigate why the GitHub workflow is not executing on its schedule. Establish
recurring checks of backup freshness and receiver unavailability. Verify a
controlled failure reaches Justin and that recovery is visible. A successful
manual run or enabled email preference alone is insufficient evidence.

### 2. Account for existing S3 storage and propose cleanup

Inventory object counts and bytes by database prefix, backup-file type, date,
and current/noncurrent version. Include delete markers and incomplete multipart
uploads where relevant. Relate stored objects to required recovery points and
identify obsolete storage with an estimated monthly saving.

An inventory here means an accounting exercise; it does not require enabling
paid recurring S3 Inventory. Existing listings and metadata may suffice for a
one-time assessment. The managed S3 Inventory feature is an optional billed
reporting mechanism, distinct from access logs and request metrics.

The purpose includes finding removable cost, but inspection is not deletion.
Present exact cleanup scope and recovery consequences before deleting history.
Do not infer that old files are disposable merely because Litestream is stopped.

### 3. Establish S3 observability before resuming dependent workloads

Treat observability as a hard gate before reactivating Litestream or another
S3-dependent runtime workload. Read-only investigation and setup are necessary
preparatory work, not reactivation.

- Map expected callers, credentials, roles, and prefixes.
- Enable S3 access logs with bounded retention and verify delivered records.
- Distinguish replication/maintenance, restore/rehearsal, and operator inspection.
  Within maintenance, distinguish snapshots from compaction where readily
  available; defer more detailed compaction attribution until needed.
- Record app, Machine, revision, purpose, operation ID, bytes, duration, retries,
  and outcome in our operation logs where supported. Avoid secrets and learner
  contents. Do not create high-cardinality metric labels for every operation.
- Reconcile our measurements with S3 access records and AWS billing. Our telemetry
  explains intent; AWS provides an independent record and the charge accounting.

Shared credentials and a generic Litestream user agent cannot reliably separate
all callers. Verify actual identity separation rather than relying on policy
templates. Adding purpose inside Litestream may require instrumentation; do not
assume an external wrapper observes internal operations.

Defer paid CloudWatch request metrics until a specific unresolved question or
alerting requirement justifies them. Use the existing metrics/Grafana facilities
for application-side observations where practical.

### 4. Investigate AWS cost anomaly notifications

Justin saw an anomaly in the AWS console but received no alert. Identify whether
that signal came from Cost Anomaly Detection or another billing feature. Inspect
monitor coverage, alert subscriptions, thresholds, frequency, recipients, and
any required delivery confirmation. Establish why detection did not produce a
notification and configure the appropriate delivery path with Justin.

Keep detection and notification distinct. Verify delivery where supported and
record its limits; a dashboard anomaly is not proof of active notifications.
Billing alerts are a delayed financial backstop, not a replacement for backup
health checks or operational telemetry.

### 5. Rehearse a return to Litestream after footprint work

This work is deferred pending the separate database-footprint workstream. Before
rehearsal, choose a deliberate snapshot frequency, retention, recovery-point
objective, restore-time budget, and operating-cost budget. Daily snapshots are a
candidate to evaluate, not an adopted policy. Recent recovery points can come
from incremental history between snapshots.

Measure steady operation, representative writes, clean restarts, app-only
upgrades, and migration behavior. Verify whether ordinary transitions preserve
incremental continuity. Measure snapshot and compaction traffic, CPU, local disk
headroom, and complete restore behavior. Include a quiet interval to test whether
maintenance alone creates material traffic.

Do not accept an unexplained database-sized fallback as routine. Preserve and
budget for a genuine recovery fallback, and determine whether the pinned binary,
a supported upstream release, or a different backup arrangement meets the gates.

### 6. Cut over only after measured acceptance

Require attributable S3 traffic, verified independent alerts, acceptable measured
cost/resource use, and a successful isolated restore. Use a concrete reviewed
cutover plan and retain the current recovery path until the replacement is
verified. This record does not direct an immediate production switch or deletion
of existing backups.

### 7. Defer exact SQLite churn instrumentation

WAL file size is not cumulative WAL bytes written because SQLite reuses the file.
Use readily available operation and process counters first. Do not add native
SQLite bindings or change checkpoint policy solely to obtain a measurement in
this phase. Reconsider exact WAL/checkpoint counters alongside the broader
Postgres evaluation; a database migration is not a prerequisite for resolving
the immediate backup-cost questions.
