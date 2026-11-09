# Prepare missing repertoire in bulk

This runbook is for operators using `npm run content:bulk-repertoire -- <action>`
to fill missing shared general production repertoires. It covers cohort planning,
off-host generation, inspection and offline application. The
[repertoire preparation guide](../implementation/repertoire-preparation.md)
explains the reusable generate-and-apply mechanism and where contributors would
change its input/output policies for another scenario.

The existing command handles tracked words with no authored repertoire. It does
not top up or replace existing pools, generate teaching, or alter learner
schedules, modes, progress or Maintain curation. Its selection and publication
policies are implemented in code, not configurable cohort/publication options.

## Plan the cohort

`plan` opens an existing database read-only in one coherent transaction. Tracked
means not dismissed and either studied or in the stash, for an enabled learner.
Teaching history is not required. Authored general production in any scope or
availability excludes a word; dictionary fallbacks, teaching exercises, contrasts,
and word-choice exercises do not count as repertoire. Outstanding proposals are
found through case identities, content bases, and proposed/source targets,
including case-less proposals. Queued or running reflection jobs, running
inventory/selection/practice preparation, and pending sense reconciliations also
exclude their words.

Each learner's candidates sort by production due time and word ID. A studied
word without a date counts as due now; an unstudied word without a date sorts
last. Round-robin turns select one globally unique word per learner. Duplicate
words do not consume a turn; exhausted queues redistribute capacity. The
manifest retains allocations and beneficiary learners, separately from the
shared lexical input sent to providers.

```sh
npm run content:bulk-repertoire -- plan \
  --database=/absolute/restored/app.db --limit=<cohort-size> \
  --source-revision=<verified-source-sha> --out=<private-manifest.json>
```

Review the manifest's exclusions and allocations before spending on generation.
The manifest captures source state, not a reservation: application rechecks
eligibility and source freshness against the target database.

## Generate and inspect

Choose the model, reasoning effort, run size and concurrency for the intended
content and operating budget. An initial small run can support content review
and a rough cost estimate. These settings do not change the cohort eligibility
or publication rules.

```sh
npm run content:bulk-repertoire -- generate \
  --input=<private-manifest.json> --out=<private-run-directory> \
  --limit=<run-size> --model=<model-id> --effort=<reasoning-effort> \
  --concurrency=<maximum-in-flight-calls> \
  --allow-provider-calls
```

Load `OPENAI_API_KEY` and optionally `OPENAI_BASE_URL` through protected
environment configuration. A generation run without `--allow-provider-calls`
only records or checks its configuration; it does not validate retained outputs.
`--limit` selects the first words from the manifest. Use a separate run directory
when changing the selected word set, model or effort, including expanding a pilot
to a larger run. There is no CLI spending cap; limit and concurrency are not cost
guarantees.

The ordinary inventory and useful-selection providers build and validate the
prerequisite calls. Known inventories/defaults are reused. Partial inventories
need operator review. An explicit empty selection remains empty. General
repertoire uses canonical sense evidence with the shared general-exercise prompt,
schema, local sense references and validation. The `result.json` in each numbered
word directory records `ready`, `empty_inventory`, `empty_selection`, or
`empty_repertoire`. The generation summary's `completed` count includes all four
outcomes; `bundle` includes only `ready`
results. Inspect those status fields to assess readiness. The `report` command
summarizes provider-call costs, not per-word readiness.

Inspect representative cues for faithful meaning, answer scope and usable recall
practice. `ready` establishes a nonempty structurally validated result, not
individual editorial approval. Empty outcomes are retained without changing
selected coverage and do not enter application bundles.

The rolling dispatcher replenishes slots independently. Provider remaining/reset
headers govern request/token pacing, with bounded 429/5xx retries. Its initial
concurrency ceiling is configurable from 1 to 1,000; it bounds simultaneous calls
rather than guaranteeing throughput. Other organization traffic can still cause
throttling. Network failures with uncertain outcomes are not automatically retried.

## Evidence, resume, and cost

Run artifacts contain sensitive cohort metadata and belong in protected ignored
storage, such as `tmp/bulk-repertoire/`. Raw provider responses are persisted
before output parsing, including refusals and malformed output. Attempts retain
timing, request identity, usage, and pricing evidence. Each successful stage is
cached before its dependent stage starts.

Resume with the same command and run directory, including `--allow-provider-calls`
and an available `OPENAI_API_KEY`. Configuration and request hashes must match.
Completed output is replayed through current prompt builders and validators
without provider calls; unfinished stages can make new paid calls.
A retained successful attempt can recover a missing stage file. Concurrent runs
are excluded by `run.lock`. After verifying that its owning local process is dead,
`--recover-run-lock` permits recovery.
An uncertain attempt blocks another dispatch of that request unless
`--retry-uncertain` is supplied; other words can continue. Inspect retained
evidence before opting in because that retry may incur duplicate provider spend.

```sh
npm run content:bulk-repertoire -- report --input=<run-directory> --out=<cost-report.json>
```

Reports distinguish provider-reported charges, token-based standard-price
estimates, and unknown cost. Retained estimates include model rates and their
source/date. If accounting is corrected, reports retain the earlier estimate
alongside the recalculated amount; original response artifacts stay unchanged.
Reasoning tokens are part of completion tokens, not an extra charge.
Cache reads/writes are separate categories. These are API usage costs before
credit grants, not a claim about the account's cash bill. Missing usage is never
treated as free. A small pilot estimates the bulk run only approximately.

## Preflight and application

Inspect representative trial content and rehearse application on an ephemeral
restored production database using the [release rehearsal procedure](hosted-release-candidate.md).
Verify word eligibility, canonical binding, retained invocation evidence,
idempotent replay, actual Practice/Maintain serving, and preserved learner state.
Verify that the target application includes the shared authored-repertoire guard
so a later teaching request cannot generate a duplicate repertoire. Application
imports retained output without provider calls; production application needs
its own authorization, independently of generation and rehearsal.

```sh
npm run content:bulk-repertoire -- bundle --input=<run-directory> \
  --actor=<operator-id> --operation-id=<unique-run-id> --out=<bundle.json>
npm run content:bulk-repertoire -- apply --database=/absolute/app.db \
  --input=<bundle.json> --expected-sha256=<printed-bundle-hash> \
  --out=<new-receipts.jsonl> --confirm-app-stopped
```

`bundle` collects all nonempty validated results present in the run directory;
it does not offer a per-word approval selector. Confirm the bundle's contents
and record the printed hash before application. Application follows the
[stopped-writer data-maintenance procedure](schema-migrations.md): disable
provider work, enter maintenance, drain work, verify a fresh recovery backup,
and stop application writers. Maintenance mode alone is insufficient. The
command requires maintenance/provider controls and an existing schema-current
database; it does not migrate schemas or stop processes itself.

Each word is an independent transaction. Eligibility and exact lexical,
inventory, selection, and fallback source snapshots are rechecked. Stale or
conflicting words are reported as blocked. Retained prerequisite responses are
replayed through ordinary domain publication without network access, rebinding
call-local sense IDs to production canonical identities. General content uses
the same materialization helper as background preparation. Imported model
invocations retain execution times, prompts, responses, usage, costs, and
input/output sense/content links.

Successful application records an operator-attributed backend event containing
the operation ID, exact result hash, selected-coverage fingerprint, invocation IDs
and content IDs. It does not fabricate individually reviewed proposals or rewrite
failed attempts.
The committed event is the idempotency receipt; a retry after an interrupted
receipt-file write returns it instead of publishing again. Reusing an operation
identity with different content or authority is rejected.

Publication is additive. Practice and Solidify prefer usable authored repertoire
over fallbacks automatically. Dictionary fallback identities remain available
for Maintain, which still requires separate explicit curation for authored
content. Existing content and learner history are preserved. The shared runtime
guard recognizes authored repertoire regardless of whether it came from this
tool, an operator proposal, or ordinary background preparation, including a
publication that arrives while another generation is in flight.
Explicit sense-reconciliation replacement work keeps its separate authority;
existing exercises do not cancel an approved replacement plan.

The receipt stream identifies applied words with `replayed: false` or
`replayed: true`, and records blocked words with their reasons. The final summary
counts successful words, including replays, as `applied`, alongside `blocked`.
Integrity/FK checks run before reporting completion. Keep the service
closed on integrity failure; retain diagnostics and use the verified recovery
point. Reopen only after the runbook's required inspection and smoke checks.
