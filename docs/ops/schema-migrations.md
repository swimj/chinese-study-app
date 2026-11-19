# Offline schema migrations

This guide helps operators apply versioned database changes safely and
contributors write new migrations. It covers the schema baseline, the release
and recovery procedure, and how to write and test a migration. What individual
migrations change is recorded in the [migration notes](migration-notes.md).

## Baseline

Only the current schema is supported. The frozen
`server/db/migrations/baseline-schema.json` records SHA-256 hashes of every
application table, index, view, and trigger in the fresh baseline, and
`baseline-deployed-variant.json` records the exact fingerprint overrides
accepted for the deployed database. The `app_schema:0000_baseline` ledger entry
marks adoption; every later migration builds on it. Earlier schemas have no
upgrade path. Disposable old development databases can be explicitly reset with
`npm run reset:dev-data`; startup does not rebuild an incompatible database.

## Operator procedure

Every migration applied to an existing database, including data-only migrations
and first baseline adoption, needs a stopped-writer window.

**Hosted production** uses the migration release pipeline described in the
[release runbook](hosted-beta-deployment.md#migration-release). It requires a
passed [rehearsal](hosted-release-candidate.md#ephemeral-rehearsal) of the same
image, captures the pre-release backup after writes stop, migrates on the idle
Machine, and starts the target only after the migration commits.

**Local databases and isolated restored copies** use the generic runner from the
**target release**, with the app and workers stopped:

```bash
npm run db:migrate -- --database=/absolute/path/app.db --status=true
npm run db:migrate -- --database=/absolute/path/app.db --confirm-app-stopped=true
```

Status is read-only and reports applied/pending ids; an unversioned database is
validated against the baseline only when applying. The confirmation is an
operator assertion, not process detection. The runner also takes SQLite's
immediate write lock, but this cannot stop an application from resuming later.
Maintenance mode alone is not a stopped writer. Preserve the database together
with any SQLite sidecars; never copy a live main file alone as a backup or
delete WAL files to bypass a problem.

The CLI does not import backend initialization and needs no Clerk credentials,
learner id, seed configuration, or running server. Normal startup rejects a
missing baseline, pending or unknown version, edited applied migration, or
schema drift. Fresh databases initialize with the frozen baseline and apply the
same shipped migrations before serving; existing databases never migrate on
startup.

Rehearsal does not replace the production recovery point, actual migration, or
integrity checks. The migration runner checks foreign keys and SQLite integrity
itself. Exhaustive table hashing, repeated full scans, and compression are not
default production-release gates; keep expensive comparisons on the isolated
copy whenever they do not require live production state.

### Hosted migration wrapper

The pipeline runs this wrapper over SSH on the idle Machine, which already runs
the target image. Run it by hand only through the release runbook's
[escape hatch](hosted-beta-deployment.md#releasing):

```bash
fly ssh console --app <app-name> --command \
  'sh /app/deploy/fly/migrate-with-litestream.sh --confirm-app-stopped=true --pre-release-backup-id=<id> --release-id=<release-id> --previous-revision=<running-full-sha>'
```

The wrapper retains its historical filename but does not run Litestream. It
requires `APP_REVISION` for the target image, `FLY_APP_NAME`, and the private
receiver configuration from the [backup runbook](hosted-backups.md). It checks
the receiver for the supplied pre-release receipt: release kind, release id,
previous source revision, source app, and capture age no more than one hour must
match. It then runs the atomic migration and prints the migration result with
that receipt. It never reopens service controls or captures a post-migration
backup; the pipeline captures that online after the target starts. A lost
result is unknown execution state; read `db:migrate --status=true` before acting.

Large migrations need space for their actual SQLite WAL and temporary work. If
the migration needs sustained CPU beyond the production Machine's steady-state
allocation, resize that Machine during the stopped-writer window, retaining its
attached volume, then restore its saved size before reopening. Rehearsal timing
and resource evidence inform this choice.

The existing `hosted:control`, `hosted:inspect`, and restore helpers initialize
the backend and therefore also refuse incompatible schemas. Use source-release
controls before stopping and target-release controls after successful migration.

### Failure and rollback

On migration failure, keep the app stopped, inspect the error, correct the
unapplied migration, and rehearse again. A failed batch records no completed
steps. Successful repeat runs are no-ops. There is no automatic down migration.

After success, an older migration-aware application rejects a newer schema.
Use a corrective forward migration or restore the identified pre-release backup
and its matching application image. Pre-infrastructure releases cannot enforce
this version check: do not use them against a migrated database. Restore before
reopening writes whenever possible; after reopening, restoration can discard
accepted learner activity and needs an explicit recovery decision.

## Writing the next migration

Give the release agent a concise rehearsal note alongside the migration's tests
and review description, as a new section in the
[migration notes](migration-notes.md). Describe the affected records, intended changes,
preservation invariants, and how to verify them on a populated restored database.
Name any table rebuild, broad scan, large temporary copy, or other operation
likely to need extra CPU, memory, disk, or time. State useful resource estimates
when measured rather than inventing a universal threshold.

When a preservation invariant can be asserted mechanically, ship it as an
optional author check beside the SQL: `server/db/migrations/<NNNN_name>.rehearsal.sh`.
Rehearsal runs it automatically with `REHEARSAL_PHASE=before` before migrating and
`REHEARSAL_PHASE=after` afterwards, as `sh -eu` from `/app` with `APP_DATA_DIR=/data`.
A before run can save state under `$REHEARSAL_WORK_DIR` for the after run to
compare. Exit nonzero on a violated invariant. The script runs only on restored
copies, never production, and is reviewed with the migration.

Author checks are a starting point, not a closed checklist. The release agent
may find them insufficient and add its own checks, including comparisons written
during the release. Prefer assertions about affected data and durable behavior.
Do not turn a one-off exhaustive comparison into a standing requirement for
unrelated releases. See the [rehearsal runbook](hosted-release-candidate.md#prepare-check-and-migrate)
for running checks and retaining their evidence.

Add a SQL file under `server/db/migrations/` and append its definition to
`schemaMigrations` in `server/db/migrations.ts`, loading the file relative to
`import.meta.url` with `fs.readFileSync`. For example:

```ts
{
  id: 'app_schema:0002_add_optional_column',
  sql: fs.readFileSync(new URL('./migrations/0002_add_optional_column.sql', import.meta.url), 'utf8'),
}
```

Use increasing four-digit ids and stable descriptive names. Never edit an
applied file, change the frozen baseline, or add schema changes to startup
`create…` functions. Creation helpers use strict `CREATE TABLE`, `CREATE INDEX`,
`CREATE VIEW`, and `CREATE TRIGGER` statements, with each object created once.
Calling a constructor against an existing schema is a programming error and
fails. Retired upgrade/rebuild helpers are not part of fresh setup. These
creation helpers define the baseline for fresh installs; future changes belong in migrations so new and upgraded databases
follow the same path. A migration may explicitly update persistent views,
indexes and ownership guards when its column changes require that.

Write ordinary transactional SQLite SQL, using physical tables and explicit
learner ids for data writes. Do not include transaction control (`BEGIN`,
`COMMIT`, `ROLLBACK`, savepoints), `PRAGMA foreign_keys`, use `VACUUM`, or perform
external side effects. A migration may also set `after` for a same-transaction
TypeScript backfill when SQLite cannot express the transform; `0008` uses this
for Unicode punctuation stripping. Do not register domain SQL functions on the
generic runner. The runner disables foreign keys around the migration
transaction because SQLite cannot alter CHECK constraints or drop a table with
incoming foreign keys while they are enabled, and that pragma is a no-op inside
a transaction. `PRAGMA foreign_key_check` after each migration remains the
integrity gate. The runner owns one transaction around the entire pending
batch, including ledger records; a failure rolls that batch back. It checks
foreign keys and SQLite integrity before recording each migration. This first
implementation does not support nontransactional migrations or large resumable
backfills.

Test on a previous-version database containing representative rows. Assert data
preservation, defaults/nullability, failed-migration rollback, repeated-run
behavior, and equivalence with a fresh installation. The infrastructure tests
exercise a test-only optional column.

`schema_migrations` retains historical markers. The reserved `app_schema:` id
namespace holds the ordered migration ledger, with the migration checksum and
post-migration schema fingerprint in `details_json`. Unknown/gapped versions,
changed migration SQL, and subsequent DDL drift fail closed. Historical markers
outside that namespace remain independent. Hosted diagnostics already include
these rows in their migration count.

