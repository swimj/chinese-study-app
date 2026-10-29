# Production observation without a laptop

Operators and scheduled agents can investigate the running app from a cloud
checkout, even when Justin's computer is offline. `hosted:observe` collects Fly
release history and executes bounded SQL reads on an explicitly selected app
Machine. It supports ad hoc investigations rather than prescribing a fixed set
of product reports. The existing scheduler still owns when to run, what to
investigate, and when to notify Justin.

## What needs to be set up

Use a private cloud execution environment with:

- a checkout of this repository at the reviewed observer revision;
- Node 22.13 or later and dependencies installed with `npm ci`;
- the official [Fly CLI](https://fly.io/docs/flyctl/install/) on `PATH`;
- network access to GitHub/npm for setup and to Fly's API and SSH transport;
- authorized Fly credentials supplied through the environment's secret store
  as `FLY_API_TOKEN`; and
- the intended app name and existing running Machine ID, obtained from the
  operator's deployment configuration or `fly machine list --app <app> --json`.

The token must support release reads and SSH execution on the target app.
An SSH-capable token is **not** a read-only database credential. This workflow
relocates the existing trusted operator access; it does not introduce a new
credential isolation boundary. Creating or copying credentials into the runner
requires separate approval. Do not put secrets in query files, command arguments,
repository files, CI logs, or reports. A broader access-hardening project is not
required to move the inspection off the laptop.

No app deployment is required for this command on the current Node 22 image.
The observer sends its self-contained JavaScript to Node over the existing SSH
connection; it does not install a file, start the application, or import the
application database initializer. Updating this checkout updates the observer,
not the running product. No new public endpoint or always-on service is added.

Provisioning a runner and granting its credentials are separate from merging
this code. After those steps, verify a metadata-only call before wiring the
existing scheduled task to the new execution environment:

```bash
npm run --silent hosted:observe -- --app=<app> --machine=<machine-id>
```

The call also reads the schema migration ledger. It fails if the Machine/app
identity differs or its baked source revision is unknown. Authentication,
network, stopped-Machine, missing-database and timeout errors are failures to
observe, not evidence of zero usage. The command does not start a stopped Machine.

## Investigate a question

Prepare a private JSON request from the
[example](../../deploy/observation/queries.example.json), then run:

```bash
npm run --silent hosted:observe -- --app=<app> --machine=<machine-id> \
  --queries=/private/path/query-request.json
```

Each query has a unique `name`, a `sql` read statement and optional positional
`params` (strings, finite numbers or null). Use bound parameters for learner IDs,
cutoffs and content. Query the schema before interpreting a deployment whose
schema has changed. `SELECT`, `WITH` and `EXPLAIN QUERY PLAN SELECT` support
cohort joins, aggregate denominators and individual cases. Queries should be
single statements; SQLite prepares the first statement, not a multi-statement
script. Do not include transaction or database configuration commands.

The connection opens `/data/app.db` with SQLite `readOnly` and `query_only`, and
all queries plus the migration ledger use one read transaction. It loads no
application functions or extensions, performs no schema initialization, and
never calls providers or learner HTTP routes. It does not run `hosted:smoke`,
usage-pulse GETs or authentication bootstrap paths. SQL reads still consume
production CPU and can hold a WAL snapshot, so use selective, bounded queries.

Default limits are 500 rows per query, 1 MB of result row data and a five-second
remote process deadline. The request may choose at most 20 queries, 5,000 rows,
4 MB and 15 seconds. Exceeding a limit fails the observation rather than
silently returning a truncated cohort. The disposable remote observer process
kills itself with SIGKILL on its query deadline, including any synchronous SQLite
query still running in its worker. Fly calls
also have a 45-second local transport timeout. Large intermediate SQLite
allocations are not bounded by the row limit; avoid unbounded joins/sorts.

SQLite integers are represented as decimal strings to preserve 64-bit values;
BLOBs are `{ "encoding": "base64", "data": "..." }`. Counts in downstream
reports must account for that representation. Output is private operational
data, not a public artifact: minimize selected fields, retain only needed
provenance, and do not upload production output to a public GitHub PR or CI
artifact. This command does not save files or create another reporting schedule.

## Interpret the evidence

The output separates Fly release history and its read timestamp from the
Machine's baked source revision, app/image/Machine identity, migration ledger,
query results, and query-window timestamps. The request (including SQL/parameters)
and observer payload SHA-256 are included for reproducibility; treat those as
private data too. Release metadata and SQLite reads
are not one atomic cross-system snapshot. A rollout during the call can make
them differ; do not assume the newest release is what the queried Machine ran.
The local observer revision is also distinct from the deployed product revision.

A query of current learner state is not a transition journal. Stored intervals
are not observed waiting times. Generation, registration, exposure, feedback,
queued approval and committed application remain separate events; choose the
joins/window that establish the claim. Keep an investigation's baseline only
after a successful observation, and report gaps rather than advancing it after
a failed call.

For existing incident and timing inspectors, the same cloud environment can run
the established Fly commands in [hosted observability](hosted-observability.md).
Those commands have their own output/side-effect boundaries; this wrapper does
not automatically certify every operator command as read-only.

## Verification before live adoption

`tests/cloud-hosted-observation.test.ts` mocks Fly release/SSH transport while
executing the actual remote payload against a disposable SQLite fixture. It
checks runtime identity, parameter/quoting behavior, unchanged database bytes,
write failures, missing database handling, limits and timeouts. These checks
need no Fly token and make no production calls.

They establish the local protocol and query behavior, not a successful live
connection, credential scope or platform availability. After approved setup,
run the metadata-only invocation and one bounded query, verify the intended
Machine/revision, and then resume the existing daily/weekly investigation
baselines. Do not infer deployment or learner outcomes from mocked tests.
