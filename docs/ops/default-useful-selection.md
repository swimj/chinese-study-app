# Initialize default useful senses

This procedure resolves unknown shared usefulness without replacing canonical
inventories or teaching sources. Start with a restored rehearsal database and
review the report before applying a batch to the intended database. Database
schema migration and usefulness initialization are separate operations.

`initialize-vocabulary-defaults.ts` requires an explicit database path, uses
read-only mode by default, and requires the current schema. It reports each word
as known, selector or attention. Every established nonempty inventory with unknown
defaults needs a selector over its existing canonical IDs, including senses
imported from teaching. Source provenance does not establish usefulness. Missing
or stale teaching mappings remain a separate preparation concern; this initializer
neither blocks on those links nor repairs them. Model-empty recommendations require
operator review and leave defaults unknown.

```sh
node --import tsx scripts/initialize-vocabulary-defaults.ts --database /absolute/rehearsal/app.db --limit 100
node --import tsx scripts/initialize-vocabulary-defaults.ts --database /absolute/rehearsal/app.db --limit 100 --apply --include-model-selection
```

The first command creates neither jobs nor provider calls. The second requires the
normal OpenAI provider and initializes unknown selections in a bounded batch.
Without `--include-model-selection`, `--apply` skips words requiring selection;
there is no deterministic teaching-import batch. Known policies, including explicit
none, are unchanged. A report's `nextWordId` is a cursor; continue with `--after VALUE`
to review another bounded batch. Repeating a batch preserves prior decisions and
completed selector work.

Each selector has a durable lease and bounded retry budget. A deferred result
reports its next attempt state; rerun after its due time. Exhaustion requires an
explicit operator retry or manual selection. The report retains failures without
aborting unrelated words.

For a corpus-wide serving-policy cutover, account for every unknown selection in
the preflight census. Run selector initialization in bounded batches or record an
explicit operator selection for each word. Retain invocation evidence and an
explicit disposition for model-empty recommendations and other operator findings.
A mapped single-sense improvement intentionally does not initialize word defaults,
so some words may never encounter a lazy trigger. Rerun the dry-run census before
claiming completion. Serving continues using its unknown-policy fallback until
selection is established.

Before a hosted application, follow the [stopped-writer procedure](schema-migrations.md)
for direct database work and retain database identity, source revision, dry-run and
apply reports. Do not run this CLI against a live writer. After initialization,
inspect operator findings and serving eligibility. Existing pools and historical
learner encounters are unchanged; no exercises or senses are retired by this helper.
