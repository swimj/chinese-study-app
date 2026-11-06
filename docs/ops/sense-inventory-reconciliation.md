# Reconcile existing sense inventories

This procedure applies reviewed target-use inventory corrections to an existing
Mandarin database. The offline tool supports a conservative pass: keep existing
senses unchanged or retire them. It preserves retained learner sessions, progress,
immutable source documents and version history. It does not merge, split, add or
rewrite senses, or adopt a generated candidate's default-useful selection.

For live operator reconciliation of divergent teaching snapshots while preserving
canonical identities, use the separate
[Sense reconciliation workspace](../operator-panel.md#sense-reconciliation).
Its application is version-fenced and queues replacements. The offline commands
below retain their stopped-writer boundary and do not save that workspace's drafts.

Use the [inventory policy](../../SPECS/vocabulary-architecture.md#canonical-senses-and-useful-selection)
to judge linguistic scope and the [comparison tooling](../testing.md#sense-inventory-comparison-and-reconciliation)
to generate candidates. Model output is a proposal. An omitted use alone is not
permission to retire its established sense. A `retain` group may have an empty
`candidateIndexes` array when the candidate omitted a valid existing use.

## Prepare and review while the service remains available

Work from an identified coherent database snapshot. Keep its recovery point and
application revision with the export. All commands use
`node --import tsx scripts/reconcile-sense-inventory.ts` as their prefix.

1. `export --database /absolute/snapshot.db --word-ids ID,ID --out /absolute/export.json`
   captures lexical inputs, inventories and dependencies in a read transaction.
   Split the exported array into individual case snapshots for review.
2. Generate candidate inventories with `trial`, using the same lexical input as
   runtime. Retain exact calls and outputs. Have an agent or operator classify each
   existing sense and candidate as retain, retire, or a decision requiring further
   review. Keep additions and restructuring outside this apply batch.
3. `check --snapshot CASE.json --candidate CANDIDATE.json --judgment JUDGMENT.json
   --out CHECK.json` checks full identity accounting and source/candidate hashes.
4. `report --snapshot CASE.json --candidate CANDIDATE.json --judgment JUDGMENT.json
   --out REPORT.json` lists affected content and operational blockers, and includes
   a per-word plan template. Review every content decision and provide a rationale.
   `REVIEW_REQUIRED` is a placeholder, not an accepted decision. Required retirements
   cannot be changed to keep.
5. Assemble approved templates into a JSON document:

   ```json
   {
     "operationId": "target-senses-batch-001",
     "actorId": "reviewing-operator",
     "plans": ["replace this string with each approved per-word plan object"]
   }
   ```

   Run `hash-plan --plan APPROVED.json` and retain the resulting SHA-256 alongside
   the reviewed plan. Reusing an operation ID with a different plan is an error.

Every active sense and candidate is accounted for. Retain preserves the existing
sense's ID, wording and version; candidate wording is not substituted. Retire
creates a new retired version with its old wording. Current defaults and explicit
review selections lose retired IDs but gain no new ones. Unknown defaults remain
unknown if senses survive; an empty inventory resolves to `[]`.

## Read the dependency report

A source document can contain several senses. Its removal affects more than the
exercises mapped to a retired sense: other exercises can pin the document for
post-answer teaching, and introductions can bind its exercises. Resetting the
word's current preparation pointer alone does not remove those references.

The report identifies those dependencies and requires retirement of content that
would continue serving removed uses or a contaminated source. Unmapped or mixed
content needs an explicit keep/retire disposition. A keep judgment must assess the
actual authored content; a matching word ID is insufficient. Dictionary recognition
fallbacks without contaminated pins do not automatically require retirement.

Running work, unresolved reflection work/proposals, unsupported semantic decisions,
or missing content dispositions prevent application. Resolve the listed blocker,
then export and review again. Historical dependencies are retained evidence, not
permission to rewrite past encounters or clear learner progress.

## Rehearse, then apply with writers stopped

Follow the [hosted stopped-writer procedure](schema-migrations.md#operator-procedure)
for maintenance, a verified recovery backup, stopping app/provider processes,
integrity checks and reopening. Maintenance mode alone does not stop writers.
Rehearse on a copy first; this command neither deploys code nor creates a backup.
The runtime sense-policy change must be in the target application release.

After stopping writers, re-export to check whether the reviewed snapshots remain
current. Changes to inventory, content, selection or work dependencies require a
new reviewed plan and hash; do not replace hashes blindly to force application.
Progress-only changes in learner senses, schedules and retained history are
preserved and do not invalidate the plan. Stash and reserve changes still do. The apply operation rechecks the same inputs while
holding SQLite's immediate write lock.

```bash
node --import tsx scripts/reconcile-sense-inventory.ts apply \
  --database /absolute/app.db \
  --plan /absolute/approved-plan.json \
  --expected-plan-sha256 REVIEWED_SHA256 \
  --confirm-app-stopped=true \
  --out /absolute/new-receipt.json
```

The entire batch applies in one transaction. It uses versioned sense/content and
word-selection writes, resets affected current preparation pointers, settles obsolete
queued authoring demand, and queues replacement teaching where useful senses and
learner demand remain. Attempt history and immutable artifacts remain available.
Existing failed selection readiness is preserved; use its ordinary explicit retry
if it prevents replacement preparation.
Foreign-key and integrity checks must pass before commit. Any failed precondition
or write rolls back the entire batch.

The database retains an operation receipt. Repeating the same operation and plan
returns that receipt without duplicating changes; use a fresh output filename.
The receipt file is reserved before mutation so an existing output cannot be
silently overwritten. A failed run can leave an empty reserved output file; the
database receipt is authoritative if execution was interrupted after commit.

Verify the affected inventories, default selections, content availability and
preparation queue against the receipt. Confirm empty-inventory words stay stashed
and out of new sessions, surviving words retain progress, and retained sessions
still display their original material. Reopen the target app and provider work
using the hosted runbook, then observe replacement preparation and representative
new sessions before treating the repair as delivered.


Run the offline inventory workflow after migration `0067_vocabulary_repair_targets`. Export fresh
version-2 dependency snapshots and regenerate reports/plans; pre-cleanup dry-run
artifacts remain evidence but cannot authorize application. Historical case scopes
are preserved byte-for-byte and no longer pruned. Open cases whose pending or
accepted repair target names a retiring sense block reconciliation: reset pending
intent, reassess with a retained sense, or explicitly resolve the case first.
Resolved repair intent remains historical evidence. Reconciliation never chooses
another repair sense or changes an operator's pending instruction.

## Live reconciliation migration rehearsal

Migration `0069_sense_content_reconciliation` creates empty current-resolution and
immutable revision-history tables, with an index and history guards. It does not
scan or transform the existing corpus, regenerate content, or change learner state.
The release is schema-changing and must use the ordinary isolated rehearsal and
stopped-writer migration procedure, not the application-only upgrade route.

On a populated restored database, verify that migration records the new schema,
the two new tables are empty, existing senses/content/session records are preserved,
and foreign-key/integrity checks pass. Check that rerunning the migration is a
ledger no-op and a fresh database has the same schema. No application of a resolution
is implied by deployment.

Separately rehearse an explicitly approved bounded resolution on a disposable copy:
save and reopen a blocked decision without live effects; inspect the dependency
plan; apply a supported decision; verify retirement, queued preparation, unchanged
canonical identities and retained sessions; and verify exact replay. Exercise
replacement failure/retry and late-publication fencing with controlled providers.
Record simulated generation separately from any authorized real provider work.
Do not treat fixture success as approval to apply a real linguistic decision.
