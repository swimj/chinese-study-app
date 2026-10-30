# Initialize default useful senses

This procedure resolves unknown shared usefulness without replacing canonical
inventories or teaching sources. Start with a restored rehearsal database and
review the report before applying a batch to the intended database. Database
schema migration and usefulness initialization are separate operations.

`initialize-vocabulary-defaults.ts` requires an explicit database path, uses
read-only mode by default, and requires the current schema. It reports each word
as known, imported, selector or attention. Imported active senses with valid exact
source links initialize deterministically. Inventory-only words need a selector
over their existing canonical IDs. Missing/stale canonical import links or versions, and model-empty recommendations,
require operator review. This differs from missing uses in a newer current teaching
document: valid active canonical import links can initialize defaults even when
that newer document has unresolved uses. The latter is preparation attention; it
does not block this initializer or rewrite a prepared package. This procedure
does not reconcile either kind of source discrepancy.

```sh
node --import tsx scripts/initialize-vocabulary-defaults.ts --database /absolute/rehearsal/app.db --limit 100
node --import tsx scripts/initialize-vocabulary-defaults.ts --database /absolute/rehearsal/app.db --limit 100 --apply
```

The first command creates neither jobs nor provider calls. The second applies only
deterministic import selections. Known policies, including explicit none, are
unchanged. A report's `nextWordId` is a cursor; continue with `--after VALUE` to
review another bounded batch. Repeating a batch preserves prior decisions and
completed selector work.

To initialize inventory-only words, configure the normal OpenAI provider and add
`--include-model-selection` alongside `--apply`. Each selector has a durable lease
and bounded retry budget. A deferred result reports its next attempt state; rerun
after its due time. Exhaustion requires an explicit operator retry or manual
selection. The report retains failures without aborting unrelated words.

For a one-time serving-policy cutover, account for every word in the preflight
census. The 2026-10-30 read-only cohort at source revision `e960db93` contained:

1. 531 words whose 929 active canonical senses have exact teaching-import links:
   apply deterministic initialization in bounded batches.
2. 67 inventory-only words: run selector initialization in bounded batches, or
   record an explicit operator selection for each word.
3. Review all remaining unknown selections, model-empty recommendations and other
   operator findings. Retain their invocation evidence and an explicit disposition.

Do not call the corpus cutover complete merely because the deterministic batches
finished. A mapped single-sense improvement intentionally does not initialize
word defaults, so some inventory-only words may never encounter a lazy trigger.
Rerun the dry-run census and account for every unresolved word before claiming
completion. Lazy initialization remains useful for subsequent words; serving
continues using its unknown-policy fallback until selection is established.

Before a hosted application, follow the [stopped-writer procedure](schema-migrations.md)
for direct database work and retain database identity, source revision, dry-run and
apply reports. Do not run this CLI against a live writer. After initialization,
inspect operator findings and serving eligibility. Existing pools and historical
learner encounters are unchanged; no exercises or senses are retired by this helper.
