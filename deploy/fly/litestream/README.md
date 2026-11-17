# Hosted Litestream build

This directory owns the narrowly patched backup binary used by the Fly image.
It explains the source pin, lifecycle guarantees, and checks needed to maintain
or retire the patch.

The Dockerfile builds `0.5.16-study-wal1` from upstream v0.5.16 commit
`6d61ef5d007756d62e473daee4c760ac395a55c6`, applying `continuity.patch`.
The patch backports [upstream PR 1561](https://github.com/benbjohnson/litestream/pull/1561)
as inspected at commit `51fd1e54d5611eb1109d96c9305ee64e608fc88c`.
Adaptations for 0.5.16 are the DB field placement, the older void-returning
`Replica.Start` method, and the test's explicit LTX import. The upstream source
and derived patch are covered by its [Apache-2.0 license](https://github.com/benbjohnson/litestream/blob/v0.5.16/LICENSE).

The changes set SQLite `PERSIST_WAL` on every pooled connection, attach the
protective read transaction before launching `-exec`, and defer snapshots and
compaction until startup verification succeeds. The startup guard matters:
newly initialized page metadata alone must not permit a snapshot under a stale
transaction ID. Remote replica recovery remains in the cancellable sync path.

This preserves continuity through ordinary restarts without disabling normal
checkpoints or weakening the fallback when WAL history is missing. It does not
make `wal_autocheckpoint=0` an acceptable substitute: that pragma does not prevent
last-connection cleanup. Node 22 does not expose the C file-control operation.
Offline migrations instead keep this binary running while the app is stopped;
see the [migration runbook](../../../docs/ops/schema-migrations.md#hosted-target-code-and-stopped-process).

## Verification

Apply the patch to a clean checkout of the pinned upstream commit, then run:

```sh
go test -race -run 'TestDB_PersistWALOnEveryConnection|TestDB_CloseKeepsWALAfterMonitorCheckpoint|TestStore_OpenDefersReplicaRecovery|TestStore_CompactDBWaitsForStartupSync|TestStore_CompactDB' -count=3 .
go test -timeout 3m . ./cmd/litestream
go build -trimpath -tags osusergo,netgo,sqlite_omit_load_extension \
  -ldflags '-s -w -X main.Version=0.5.16-study-wal1' -o /tmp/litestream-patched ./cmd/litestream
```

From this application checkout, run the explicit disposable integration suite
(the ordinary unit suite does not require a Litestream installation):

```sh
LITESTREAM_BINARY=/tmp/litestream-patched node --import tsx --test tests/integration/litestream-continuity.test.ts
node --import tsx --test tests/hosted-upgrade.test.ts tests/hosted-migration.test.ts
```

It exercises two restarts after a shutdown checkpoint, a protected atomic
schema/data migration, the shipped shell/worker/migration CLI, RC replacement
with a retained WAL, full integrity-checked restores with data comparison,
and the full-baseline fallback after deliberately losing continuity on a
synthetic fixture. The Litestream continuity workflow runs this suite inside
the actual hosted Linux image. It requires permission to create a local Unix socket.
`KEEP_LITESTREAM_TEST_DATA=1` retains synthetic test artifacts for inspection.
The original 0.5.16 binary should fail the WAL-preserving shutdown regression.

Before production promotion, exercise the built Node 22 Linux image in isolated
rehearsal. An old binary can discard the WAL when it stops for the first patched
deployment; that transition may still require a full baseline. No disk resize,
production restart, or deletion of old backups is part of this source change.

Retire the patch when a released upstream version includes equivalent lifecycle
and startup-verification protections and passes the same tests. Updating the
version string alone does not establish that the defects are fixed.

## Upstream follow-up (checked November 16, 2026)

The latest official release is [0.5.18](https://github.com/benbjohnson/litestream/releases/tag/v0.5.18).
It and the current `main` still lack the pooled persistence/startup fix.
[PR 1616](https://github.com/benbjohnson/litestream/pull/1616), including
[commit 9b3e5bc](https://github.com/benbjohnson/litestream/commit/9b3e5bc21750538c310101a0916c8d2c887dd29a),
proposes combining PRs 1560, 1601, and 1561; all four PRs remain open and unmerged.
The combined proposal also addresses correctness after unproven WAL resets,
incremental fully backfilled checkpoints, and physical retained-WAL reclamation.
Those broader changes are not in this local 1561 backport. Its reported stale-WAL
restore regressions warrant evaluation before choosing the production binary;
our clean-shutdown tests do not establish correctness for those other scenarios.
No maintainer release date was found in the public PR discussions inspected.
