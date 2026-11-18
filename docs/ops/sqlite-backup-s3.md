# Configure S3 for standalone SQLite backups

Use this guide to prepare the AWS destination before enabling uploads on the
Fly backup receiver. Each object holds one gzip-compressed SQLite database.
The [hosted backup runbook](hosted-backups.md) covers capture, receiver setup,
and isolated restore.

## Enable and verify access logging

1. Open **S3 → General purpose buckets**, select the intended backup bucket,
   and check its Region, **Properties → Server access logging**, and existing
   destination. Record the source account and bucket. Server access logging
   covers the whole source bucket, including its legacy prefixes.
2. Use a separate, private general purpose log bucket in that account and
   Region. For this setup use an unversioned bucket, Block Public Access on,
   bucket-owner-enforced Object Ownership, default SSE-S3 encryption, and
   Requester Pays and Object Lock off. Leave access logging off on the log
   bucket to avoid recursive log delivery.
3. On the log bucket, add the [14-day log expiration rule](../../deploy/fly/sqlite-backup-s3/access-log-lifecycle.json)
   under **Management → Lifecycle rules**. It expires only `backup-access/`.
   Grant the S3 log delivery service write access to that prefix with the
   [destination policy statement](../../deploy/fly/sqlite-backup-s3/access-log-bucket-policy.template.json),
   filling in the actual log bucket, source bucket and 12-digit source account.
   Merge statements with existing policy. A versioned log bucket also needs
   noncurrent-version and expired-marker cleanup to bound storage.
4. In the source bucket's **Properties → Server access logging**, choose
   **Edit → Enable**, select the S3 bucket destination and `backup-access/`
   prefix, then save. Review the resulting log bucket policy, including any
   statement the console added. Check the resource prefix, source ARN, and
   source account on the effective delivery grant. If the source already sends
   logs elsewhere, check who uses them before changing that destination.
5. With a known operator principal, list a unique probe prefix, for example
   `aws s3api list-objects-v2 --bucket "$BACKUP_BUCKET" --prefix "sqlite-backups/$SOURCE_APP/log-probe-$(date -u +%Y%m%dT%H%M%SZ)/" --max-keys 1`.
   Record the prefix, UTC time and principal. In delivered logs, find the
   request URI carrying that prefix (possibly URL-encoded) and confirm the
   requester, successful status, and S3 request ID. Save this evidence before
   enabling receiver uploads. Delivery can take hours and individual records
   can be missing or duplicated. If needed, repeat with a fresh probe prefix.

Direct delivery to S3 incurs storage and normal charges for accessing the log
files. AWS charges no delivery fee. Backup object storage, upload requests and
restore downloads have their own charges. Reconcile transfer costs with AWS
billing. An access record's bytes sent measures response bytes, including
downloaded content. Use compressed upload size from the receiver for sent
backups. [AWS logging setup](https://docs.aws.amazon.com/AmazonS3/latest/userguide/enable-server-access-logging.html) ·
[Logging costs and delivery](https://docs.aws.amazon.com/AmazonS3/latest/userguide/ServerLogs.html) ·
[Access log fields](https://docs.aws.amazon.com/AmazonS3/latest/userguide/LogFormat.html) ·
[Regional S3 pricing](https://aws.amazon.com/s3/pricing/)

## Scope the backup lifecycle

Use an S3 Standard destination with bucket versioning **Enabled**. Check
encryption, Object Lock, replication, existing contents under `sqlite-backups/`
and overlapping lifecycle rules before applying the
[backup rules](../../deploy/fly/sqlite-backup-s3/backup-lifecycle.json).
The rules cover every existing and future key under that prefix. Reserve it
for standalone copies. Other backup history uses different prefixes.

Merge the two supplied rules into the bucket's existing lifecycle configuration
under unique IDs. The S3 API replaces the complete lifecycle configuration
on update. Export the current configuration first, review the merged result
and read it back after saving. Preserve rules and any transition settings for
other data. Keep the two-day current expiration, one-day noncurrent expiration,
and expired-delete-marker cleanup scoped to the exact `sqlite-backups/` prefix.
Leave the number of newer noncurrent versions to retain unset.

Every successful upload has a capture-specific key. S3 calculates current
expiration from object creation and rounds the eligibility time up to midnight
UTC. Expiration adds a delete marker and hides the copy from normal listing
and restore. Noncurrent expiration is measured from when that version became
noncurrent. Lifecycle acts asynchronously. The rules give neither an exact
72-hour physical deletion time nor three days of ordinary restore access.
If uploads stop, current copies age out independently of later successes,
potentially leaving **zero available S3 recovery points**. Track the newest
verified capture's start time. S3 `LastModified` records the upload time and
can make a delayed copy of an old capture look fresh. [AWS lifecycle timing](https://docs.aws.amazon.com/AmazonS3/latest/userguide/intro-lifecycle-rules.html) ·
[Versioned expiration](https://docs.aws.amazon.com/AmazonS3/latest/userguide/lifecycle-expire-general-considerations.html)

## Separate writer and restore credentials

Substitute the actual bucket and Fly **source app** in the two IAM templates.
Use dedicated principals, check their effective grants, and record which
principal handles uploads versus restores. Two keys on the same IAM user
produce the same requester identity in the access log.

| Principal | Granted access |
| --- | --- |
| [Receiver writer](../../deploy/fly/sqlite-backup-s3/writer-iam.template.json) | Single conditional `PutObject` under `sqlite-backups/<source-app>/`. A retry can use `HeadObject` to verify a prior upload. S3 requires `s3:GetObject` for HEAD, so this grant also permits reading an object with a known key. |
| [Restore reader](../../deploy/fly/sqlite-backup-s3/reader-iam.template.json) | `ListBucket` with `--prefix "sqlite-backups/$SOURCE_APP/"` or a narrower prefix, and `GetObject` on current copies there. |

Neither principal needs deletes, version administration, access-log delivery
rights or access to Litestream history. Supply writer credentials only to the
receiver through its hosted secret mechanism. Keep the reader in the operator's
separate restore context. The writer requests SSE-S3 (`AES256`). Choose a
backup bucket whose policy permits that explicit encryption setting.

The writer supplies `If-None-Match: *` and a SHA-256 checksum of the compressed
bytes. The conditional grant requires that header. The destination key includes
the source app, UTC capture date, capture start and backup ID. A single S3 PUT
supports up to 5 GB. Record the first successful upload, correlate its
request with the access log under the writer identity, and verify an isolated
restore using the reader and the hosted backup runbook.
[Conditional writes](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes-enforce.html) ·
[Single PUT limit](https://docs.aws.amazon.com/AmazonS3/latest/userguide/upload-objects.html) ·
[HEAD permissions](https://docs.aws.amazon.com/AmazonS3/latest/API/API_HeadObject.html)
