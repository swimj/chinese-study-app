# Offline schema migrations

This guide helps operators apply versioned database changes safely and
contributors write new migrations. It covers baseline adoption, the shared
release and recovery procedure, and migration-specific effects on existing data.

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

Use this procedure for first baseline adoption and every migration applied to
an existing database, including data-only migrations. All require a
stopped-writer maintenance window; `npm run hosted:upgrade` is app-only and
cannot perform these changes. The migration runner does not deploy or back up a
database automatically.

1. Rehearse with the target release and a coherent restored copy of the current
   database. Record the source/target revisions and the migration command output.
2. Disable provider work, enable maintenance, and wait for active requests and
   provider work to drain. Sync Litestream and record a verified recovery point.
   Retain the pre-release backup and its matching application image for recovery.
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
schema drift. Fresh databases initialize with the frozen baseline and apply the
same shipped migrations before serving; existing databases never migrate on
startup.

### Hosted target code and stopped process

Use the [idle-Machine procedure](hosted-beta-deployment.md#idle-the-machine-for-offline-work):
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
exercise a test-only optional column. The first application migration,
`0001_deferred_second_opinion.sql`, adds nullable `source_proposal_ids_json`
columns to both physical reflection generation tables and updates their
learner-scoped views and insert triggers. Existing history retains NULL
provenance; immutable-update and learner-filtered-delete behavior is preserved.
`0002_requested_second_opinion_disposition.sql` rebuilds
`learner_owned_reflection_proposal_reviews` so second-opinion retirement is a
distinct review disposition rather than a dismissed sentinel reason, and maps
any existing sentinel rows. The current-learner view is dropped and recreated
with the physical table.
`0004_usage_daily_snapshots.sql` adds the operational daily cohort pulse table.
`0005_service_banner.sql` adds the singleton current operator-posted service
banner. `0006_inbox_seen_at.sql` adds Help-queue `inbox_seen_at` columns.
`0007_learner_params.sql` adds the per-learner non-settings key-value store
and copies any existing `whats_new_seen_through_date` rows out of
`learner_settings`.
`0008_normalized_hanzi.sql` adds `lexical_words.normalized_hanzi` and indexes
nonempty keys. Its `after` hook backfills the Mandarin production
punctuation/whitespace strip. Display `hanzi` is unchanged.
`0013_deferred_explanation_items.sql` gives explanation-only Help rows a
learner-scoped deferred/retired disposition and stores selected explanation
inbox ids on staged generation continuations. Existing inbox rows remain open.
`tests/deferred-second-opinion-migration.test.ts` and
`tests/requested-second-opinion-disposition-migration.test.ts` verify history
preservation, ownership, immutability, repeat execution, and fresh/upgrade
equivalence.

`schema_migrations` retains historical markers. The reserved `app_schema:` id
namespace holds the ordered migration ledger, with the migration checksum and
post-migration schema fingerprint in `details_json`. Unknown/gapped versions,
changed migration SQL, and subsequent DDL drift fail closed. Historical markers
outside that namespace remain independent. Hosted diagnostics already include
these rows in their migration count.

## Pure-cue release

`0009_pure_cues.sql` adds shared pure-cue content and accepted membership,
private `learner_pure_cue_state`, immutable private served snapshots and attempts,
and restore-once production scheduler compensation snapshots with source-attempt
links. It rebuilds the publication-kind constraint to include `pure_cue`, retaining
existing publications, their events, private provenance, and integrity guards.
Attempt history is not rewritten. The unmerged pure-cue schema is introduced
directly in its shared-content form; there is no migration from an earlier
draft of the feature.

`0010_strict_word_cues.sql` resets every word-owned cue's accepted membership to
its task's target, including inactive and shared cues, then enforces owner-only
membership inserts. It drops the retired production recheck view/table and all
outstanding 48-hour demands. No semantic promotion or proxy assignment occurs.
Open sessions must be restarted; old multi-answer/recheck commits fail closed.
This intentionally discards obsolete membership and recheck state, so retain the
pre-upgrade backup if historical inspection of that state is needed.

`0011_reflection_generation_continuations.sql` adds exact staged-reflection
continuations and per-provider-call links. Legacy generation runs and artifacts
are preserved without synthetic continuation links.

`0012_pure_cue_teaching_notes.sql` separates holistic reveal teaching from the
semantic axis on pure cues and served snapshots. Existing rows receive empty
teaching notes; axis text and historical answers are not interpreted or moved.
Separate operator cleanup of old mixed axis notes is outside this migration.
Authorized extension rewrites retain immutable private teaching revisions and
leave already-served snapshots unchanged. Reflection execution cuts over to the
new diagnosis/cleanup contracts; historical results remain readable.

## Rehearsal presentation cleanup

`0020_rehearsal_presentation.sql` clears only an exact match for the former
hard-coded recall preamble in `word_teaching_packages.package_json` rehearsal
instructions. It retains the instruction field as an empty string. All packages
are eligible, including quarantined and retired publications; their publication
status, identity, provenance, stimuli, answer contracts, and other content stay
unchanged. Custom or extended instructions are preserved, as are persisted
session snapshots and learner history. Nonmatching package JSON is not rewritten.

This data migration temporarily removes and restores the package immutability
trigger within the runner's transaction. Existing browser sessions retain their
original snapshots; session presentation suppresses this exact preamble without
rewriting those snapshots.

## Content quality overlay

`0021_content_quality.sql` adds immutable authored-content snapshots, private
idempotent encounter records, and one optional standing rating per learner and
content revision. Existing content, study history, and reflection annotations
are untouched. No previous encounters or votes are inferred. See
[content quality](../content-quality.md) for the encounter and rating model.

## Exercise compensation counters (0022)

`0022_exercise_compensation_days` creates an empty learner-private daily counter
table. It performs no backfill or rewrite of summaries, attempts, or restoration
history. New session completions include pure-cue totals in the existing summary
fields; only newly applied compensations increment the daily counter.

Windows crossing rollout intentionally mix earlier word-only summaries with
new combined exercise totals.

## Session debrief (0023)

`0023_session_debrief` creates empty learner-private debrief jobs and attempts,
with composite ownership references to completed summaries. Existing summaries,
study history and reflection records are unchanged. There is no historical
inventory inference or provider backfill. Queued jobs resume after restart;
expired running attempts become failed and require an explicit learner retry to
avoid replaying an unknown upstream outcome.

## What’s New blog rollout

`0028_whats_new_blog.sql` creates the shared current-post table and immutable
revision history, and copies the former bundled notes into published rows with
publication sequences. Historical notes retain their text; source commit
provenance remains null because a publication date cannot prove a deployed
revision. The blog uses a separate learner publication-sequence cursor while
retaining the legacy date cursor for compatibility.

Subsequent [blog edits](../whats-new.md) use normal live transactions and need no
maintenance window or migration.

## Introduction component retention (0029)

`0029_introduction_components.sql` adds empty tables for retained teaching and
practice components and their published-package provenance links. The migration
does not rewrite existing content or packages, backfill component records, or
invoke providers. Existing packages and learner pins remain compatible without
component links; historical packages therefore have no component-level
provenance reconstructed by this upgrade.

The [word content generation guide](../word-content-generation.md) explains how
new preparation retains and publishes components.

## Home updates and per-post notifications

`0030_whats_new_previews.sql` adds the required summary field and backfills
previews from the twelve imported blog posts. Authored summaries apply only
when a post still matches its original title and body; edited/custom content
gets neutral title-based text. Each post receives an attributed new revision,
while its old immutable revisions, publication sequence, status, body, and
provenance remain intact. Concurrent operators must reload after migration
because the current revision advances.

`0031_whats_new_attention.sql` adds empty per-learner/post exposure and read
state. Existing legacy read boundaries remain effective. No historical
first-exposure time is invented; unseen posts start their 12-hour window only
after their navigation badge becomes visible in the new client.

## Usage exercise totals (0034)

`0034_usage_exercise_totals` adds nullable completed-learning counts to session
summaries and the corresponding learner-scoped view. Legacy submissions leave
unknown counts NULL; retries that omit the count retain an already-known value.
It adds daily snapshot fields for practice, completed review outcomes, acceptance
events, mean stash, and total active session time, plus a partial creation-time
index for proposal-acceptance invocations. Existing snapshots gain review, time,
and acceptance totals from durable records. Historical practice and mean stash
remain NULL; no attempts, word state, or debrief inventories are interpreted to
reconstruct them. Legacy spend and median columns remain stored but are retired
from the usage API. This release requires the offline schema upgrade procedure.

## Practice correct-day usage (0035)

Migration 0035 creates a learner-private ledger of unique word correct days,
seeded from each word's latest stored successful UTC date. It clears only the
practice field of old usage snapshots, whose encounter totals used a different
definition. Other snapshot fields and learner progress are preserved. Complete
historical counts cannot be reconstructed from latest word state; availability
starts on the migration UTC day with recoverable gains; complete recording
covers subsequent days. Pre-migration resets are unrecoverable.
This requires the stopped-writer offline migration procedure above.
