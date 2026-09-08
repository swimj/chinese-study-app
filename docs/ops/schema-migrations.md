# Offline schema migrations

Schema-changing releases use a maintenance window. `npm run hosted:upgrade`
remains app-only; do not use it for the first baseline adoption or later schema
changes. This mechanism does not deploy or back up a database automatically.

## First adoption

Only the current schema is supported. The frozen
`server/db/migrations/baseline-schema.json` records SHA-256 hashes of all 312
application tables, indexes, views, and triggers in the fresh baseline derived
from revision `3ad618b94762fa3fc5a8f10fbccf8ab5bb0b72e4`, with the additional
physical artifact trigger omitted as described below.

A read-only schema inspection of Fly at that revision on 2026-09-07 found
nine definitions that differ only in identifier quoting.
`baseline-deployed-variant.json` records the exact fingerprint overrides for
this complete variant; it is not a general relaxation of schema matching.
Both accepted variants are adopted by adding a ledger record, without changing
schema objects, application rows, or historical migration markers.

Fresh setup matches Fly by omitting the additional physical-table
`reflection_artifacts_immutable` trigger. The learner-facing view continues to
reject artifact updates. Adding a physical-table guard is deferred to a future
explicit migration; baseline adoption performs no repair.

SQLite internal objects and the two Litestream-managed tables
`_litestream_lock` and `_litestream_seq` are excluded. Their lifecycle is
independent of application schema releases; unexpected objects are still
rejected. Hashes otherwise use the exact SQL recorded by SQLite, including
whitespace. A differently constructed equivalent schema, or any unrecognized
combination of the known differences, can fail this check. Failure names the
differing objects and leaves the database unchanged. Investigate and review
any difference; do not edit hashes or insert a ledger row merely to make a
valued database pass. Production was inspected read-only; adoption has only
been rehearsed locally using schema-only fixtures, not executed on Fly.

Earlier schemas have no upgrade path. Disposable old development databases can
be explicitly reset with `npm run reset:dev-data`. Startup no longer
automatically rebuilds an incompatible development database.

## Operator procedure

1. Rehearse with the target release and a coherent restored copy of the current
   database. Record the source/target revisions and the migration command output.
2. Disable provider work, enable maintenance, and wait for active requests and
   provider work to drain. Sync Litestream and record a verified recovery point.
3. Stop the normal app and provider workers. Maintenance mode alone is not a
   stopped writer. Keep them stopped until the migration finishes. Preserve the
   database together with any SQLite sidecars; never copy a live main file alone
   as a backup or delete WAL files to bypass a problem.
4. Run the following from the **target release**, using the explicit existing
   database file:

   ```bash
   npm run db:migrate -- --database=/absolute/path/app.db --status=true
   npm run db:migrate -- --database=/absolute/path/app.db --confirm-app-stopped=true
   ```

   Status is read-only and reports applied/pending ids; an unversioned database
   is validated against the baseline only when applying. The confirmation is an
   operator assertion, not process detection. The runner also takes SQLite's
   immediate write lock, but this cannot stop an application from resuming later.
5. Start the target release while maintenance remains enabled. Run inspection
   and smoke checks for both learner identities. Reopen writes, then provider
   work, only when these pass.

The CLI does not import backend initialization and needs no Clerk credentials,
learner id, seed configuration, or running server. Normal startup rejects a
missing baseline, pending or unknown version, edited applied migration, or
schema drift. Fresh databases still initialize automatically and apply the
shipped migrations before serving; existing databases never migrate on startup.

### Hosted target code and stopped process

Use the [existing idle-Machine procedure](hosted-beta-deployment.md#quiesce-promote-and-restart-the-same-image):
save the full Machine configuration and immutable source image; retain the
mounted `/data` volume while replacing the normal app/Litestream command with
`sleep infinity` and skipping health checks. Confirm normal processes stopped.
Build/push the target image with its exact `APP_REVISION` **without deploying the
normal application**, then update that same idle Machine to the target image
while retaining the idle command and volume. Run `db:migrate` via SSH in that
target image against `/data/app.db`. Finally restore the normal command using
the recorded target image and saved configuration. Do not start the normal
target application before running the migration; its compatibility check will
refuse an unbaselined or pending database.

The existing `hosted:control`, `hosted:inspect`, and restore helpers initialize
the backend and therefore also refuse incompatible schemas. Use source-release
controls before stopping and target-release controls after successful migration.

## Writing the next migration

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
`COMMIT`, `ROLLBACK`, savepoints), disable foreign keys, use `VACUUM`, or perform
external side effects. The runner owns one transaction around the entire pending
batch, including ledger records; a failure rolls that batch back. It checks
foreign keys and SQLite integrity before recording each migration. This first
implementation does not support nontransactional migrations or large resumable
backfills.

Test on a previous-version database containing representative rows. Assert data
preservation, defaults/nullability, failed-migration rollback, repeated-run
behavior, and equivalence with a fresh installation. The infrastructure tests
exercise a test-only optional column. The first application migration,
`0001_deferred_second_opinion.sql`, adds nullable `source_proposal_ids_json`
columns to both physical reflection generation tables and updates their
learner-scoped views and insert triggers. Existing history retains NULL
provenance; immutable-update and learner-filtered-delete behavior is preserved.
Fresh installations start with the frozen baseline and apply this same SQL.
`tests/deferred-second-opinion-migration.test.ts` verifies history preservation,
ownership, immutability, repeat execution, and fresh/upgrade equivalence.

`schema_migrations` retains historical markers. The reserved `app_schema:` id
namespace holds the ordered migration ledger, with the migration checksum and
post-migration schema fingerprint in `details_json`. Unknown/gapped versions,
changed migration SQL, and subsequent DDL drift fail closed. Historical markers
outside that namespace remain independent. Hosted diagnostics already include
these rows in their migration count.

## Failure and rollback

On migration failure, keep the app stopped, inspect the error, correct the
unapplied migration, and rehearse again. A failed batch records no completed
steps. Successful repeat runs are no-ops. There is no automatic down migration.

After success, an older migration-aware application rejects a newer schema.
Use a corrective forward migration or restore the identified pre-release backup
and its matching application image. Pre-infrastructure releases cannot enforce
this version check: do not use them against a migrated database. Restore before
reopening writes whenever possible; after reopening, restoration can discard
accepted learner activity and needs an explicit recovery decision.
