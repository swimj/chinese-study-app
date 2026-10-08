# Error logging and diagnostics

This document maps the application's current error and diagnostic surfaces.
It answers two questions: where to look after a failure, and what each surface
can and cannot prove. Deployment and Grafana setup remain in the
[hosted observability runbook](./hosted-observability.md).

## First-pass triage

| What the learner saw | First place to look | What it establishes |
| --- | --- | --- |
| `Failed to fetch` with a client incident ID during a review or contrast commit | `hosted:inspect-client-incidents`, then study-commit success logs for the same event IDs | The browser's auth-token or fetch promise rejected. A matching backend success proves the commit completed; no matching success does not prove it never arrived. |
| An application error with `Diagnostic ID: ...` during a study commit | `hosted:inspect-study-commits -- --diagnostic-id=...` | The request reached the commit handler and the handler caught a validation or persistence failure. |
| An HTTP error without an ID | Service metrics, `fly logs`, then the relevant domain store | The browser received an HTTP response. Existing route-specific logging varies. |
| A word introduction or review preparation failure | Operator view's [Preparation failures tab](#shared-word-preparation-failures) | The shared word/stage status, last error, and recorded attempt history. |
| A reflection-generation failure | Reflections run log, reflection lifecycle logs, then the provider diagnostics sidecar | The durable run state and safe provider classification; transport metadata is available for provider failures. |
| An intake-triage generation failure | Intake-triage run rows in SQLite | Expected provider/domain failures are durable, but there is no user-facing run-history inspector yet. |
| A generic aborted request in Grafana | Prometheus route/method/outcome metrics | A response closed before completion. It is aggregate telemetry, not a per-request log, and `GET /api/*` may be unresolved to a specific route. |

## Client transport incidents

Client transport incidents cover only these durable commit requests:

- accepted review-attempt batches; and
- accepted contrast-selection attempts.

The frontend records an incident when either the Clerk token provider rejects
(`phase: authentication`) or native `fetch()` rejects (`phase: fetch`). HTTP
responses, including 4xx and 5xx responses, resolve the fetch promise and keep
using the existing API error contract. The error shown in the application adds
`Client incident ID: <uuid>`.

A fetch rejection is intentionally treated as ambiguous. It can happen before
the request reaches the application, while a request or response is in flight,
or after the backend has committed but before the browser receives the
response. The incident therefore does not trigger a commit retry and does not
claim that the commit failed. Correlate its event IDs with
`study_commit.succeeded` logs and durable attempt state.

The bounded incident contains:

- client time, app version, normalized route, method, failure phase, and elapsed
  time;
- session, action, and at most 20 event IDs;
- browser online and visibility state; and
- bounded error name and message.

It excludes the request body, answers, raw URL, auth token, headers, cookies,
stack, learner content, and arbitrary browser state. The server reconstructs an
allowlisted record rather than persisting extra client-supplied fields.

Pending incidents are stored in browser local storage under a Clerk-user-scoped
key (or the single trusted-local scope). The queue is capped at 20 records and
records older than 30 days are excluded when the queue is accessed. The
frontend tries to upload the queue after authenticated app startup and whenever
the browser emits `online`. A failed upload leaves the queue intact; successful
uploads are deduplicated by diagnostic ID on the server and removed locally.

Uploaded incidents produce a compact `client_transport.received` stderr event
and one private line in `/data/client-transport-incidents.jsonl`. The full file
adds the authenticated learner ID, server receipt time, and runtime release
identity. It is mode `0600`, is not part of SQLite/Litestream backup, and prunes
valid records older than 30 days on the first receipt of a UTC day. Malformed
lines are preserved.

Inspect recent uploaded incidents:

```bash
fly ssh console --app <app-name> --command \
  'npm run --silent hosted:inspect-client-incidents -- --data-dir=/data --limit=20'
```

Inspect one learner-supplied ID:

```bash
fly ssh console --app <app-name> --command \
  'npm run --silent hosted:inspect-client-incidents -- --data-dir=/data --diagnostic-id=<id>'
```

Known limits: an incident cannot upload until a later request succeeds; clearing
site data removes the pending record; local-storage failure can prevent durable
capture; and this slice does not provide automatic commit retry, reconciliation,
request timeouts, or session resume.

## Study-commit diagnostics

Accepted review and contrast commits emit `study_commit.succeeded` stderr JSON
events with stable learner/session/action/event correlations, outcome, rating,
and elapsed time. These events are failure-isolated and are the primary way to
match an ambiguous client incident to a backend-observed success. They are
ordinary process logs, not a durable success ledger; repository policy does not
specify Fly log retention.

Caught review, contrast, and review-session-summary failures return a diagnostic
ID to the browser, emit a compact `study_commit.failed` event, and append the
complete parsed request plus error chain to
`/data/study-commit-diagnostics.jsonl`. That private sidecar is mode `0600`,
keeps valid failures for 30 days using lazy daily pruning, and is not backed up
by Litestream. See [hosted observability](./hosted-observability.md#diagnose-a-failed-study-commit)
for inspection commands and the exact privacy boundary.

This surface only sees requests that enter the route handler. Absence of a
failure record does not establish that a browser request reached the service.

## Service metrics and Grafana

The private Prometheus listener exposes content-free HTTP, process, SQLite,
backup, and runtime-control metrics. HTTP metrics start before JSON parsing and
authentication and record normalized route, method, status, completion versus
abort, latency, response size, and in-flight count. The Grafana failure-rate
view combines 5xx responses and aborted requests.

Metrics are aggregate and carry no learner, session, event, word, raw URL, or
exception-message labels. If Express never resolves a route, an API request may
appear as `/api/*`; a connection closed before response completion has status
`unknown`. They cannot measure browser-to-edge, DNS, TLS, Clerk startup, or a
request that never reached the app. Fly's managed metric history is currently
approximately 15 days. See [hosted observability](./hosted-observability.md) for
queries, dashboard interpretation, and the complete label policy.

## Shared word preparation failures

Open the bookmark-only operator view at `#operator-usage` and select
**Preparation failures**. Access requires an operator identity allowed by
`APP_OPERATOR_CLERK_USER_IDS`; an empty allowlist fails closed. Each entry
identifies the word and preparation stage (`bootstrap`, `teaching`, or `review`),
current status, attempt count, and last error. Expand **Attempt history** for
recorded start/end times, outcomes, and diagnostics. **Refresh failures** reloads
this durable SQLite state.

Automatic retries stop after three attempts for a shared word/stage. For paused
work, **Retry this stage** queues a new attempt budget and records the operator
in the retry ledger. Retry can issue new provider calls; successful earlier
stages and reusable saved components are retained. Retry clears the current
error, so disappearance from the failures list does not establish completion.
Retry does not republish or regenerate withdrawn content: work blocked by
withdrawal pauses again for operator disposition. Ordinary learner requests
cannot reset an exhausted budget.

The [operator API reference](../api.md#operator-view) lists the failure and retry
endpoints and their access requirements. The
[word content generation guide](../word-content-generation.md) explains stage
dependencies, component reuse, and publication eligibility.

## Reflection diagnostics

Reflection work has four complementary surfaces:

1. `reflection.*` stdout lifecycle events cover summary recording, generation
   request, provider start, and terminal success/failure. They contain bounded
   IDs, counts, elapsed time, and safe codes, but not prompts or response bodies.
2. `reflection-provider-diagnostics.jsonl` records allowlisted provider
   transport failures: session/client request IDs, failure kind, safe error
   names/codes, HTTP status, and provider request/timing headers. It excludes
   messages, stacks, prompts, bodies, and API keys. It is best-effort, has no
   pruning policy or dedicated inspector, and is not Litestream-backed.
3. Reflection generation run rows in SQLite record start and terminal states,
   provider/model/token/cost metadata, exact retained evidence, and structured
   failure diagnostics. They survive through the normal database backup path
   and are visible through `GET /api/reflection-generation-runs` and the
   Reflections page. There is no current retention policy; rejected raw model
   output is intentionally retained for dogfood diagnosis and therefore needs
   a retention/secret policy before broader productization.

4. Private JSON failure artifacts are written to
   `<APP_DATA_DIR>/reflection-failures/` (`/data/reflection-failures/` when
   hosted). They include run/client-request/session IDs, model and prompt
   metadata, exact evidence, diagnostic issues, full rejected model text, and
   error messages/stacks/causes for validation or internal failures. Transport
   failures retain only their safe wrapper and allowlisted classification;
   arbitrary upstream bodies, transport messages, and credentials are excluded.
   Files are mode `0600` inside a `0700` directory, are not served through HTTP,
   and are not backed up by SQLite/Litestream. Treat them as private learner
   data, including answers and model-generated text.

On every server startup, the artifact sink removes its own regular files whose
capture timestamp in the filename is at least seven days old. Fresh files,
unrecognized names, directories, and symlinks are left alone. There is no
periodic timer: files can live longer than a week until the next restart.
Capture happens before recording the failed run in SQLite, so a database
logging failure does not discard the independent file. Capture/cleanup errors
emit content-free `reflection.failure_artifact_write_failed` or
`reflection.failure_artifact_cleanup_failed` warnings and never block startup
or replace the generation failure.

To investigate, list `/data/reflection-failures` through authenticated Fly SSH,
then read the JSON file matching the run ID or client request ID from the run
log. Each filename is `failure-<capture epoch milliseconds>-<uuid>.json`.
These diagnostic files are distinct from successful learner reflection artifacts
and grant no proposal authority. Existing SQLite diagnostics keep their prior
retention and bounded output; the seven-day policy applies to the new files.

The UI text “No structured issue detail was recorded.” means an older diagnostic
has an empty `issues` array. Previously, JSON parsing discarded the actual parser
exception; truncation and provider failures also deliberately supplied empty
arrays. New failures record the parse exception, truncation finish reason, or
safe transport classification. Schema/domain failures already included structured
issues. Full output in the private artifact avoids the existing 4,000-character
SQLite/UI excerpt hiding a parse error near the end. Historical failures cannot
recover details that were never retained.

A process interruption can leave a reflection run in `in_flight`. Most
reflection internal failures have only safe lifecycle information; unexpected
deferred second-opinion failures additionally receive a diagnostic ID and a
bounded stderr record.

## Intake-triage diagnostics

Expected intake-triage provider, schema, and domain failures write immutable
terminal run rows to SQLite with learner, timing, provider/model/prompt,
included-count, safe failure code, request/response identifiers, token use, and
cost metadata. They exclude request bodies, raw provider output, and stacks.
There is no retention policy and no run-history API, UI, or inspector; operators
currently need direct database access. Unexpected errors can escape without a
run row, and provider transport causes are collapsed to a safe upstream-failure
classification.

## Generic server and frontend errors

Many route-local server catches intentionally return a generic 500 response and
do not log the caught error. The final Express error handler records only a
fixed message, error name, and status. Aggregate metrics count a completed 5xx,
but there is no universal request ID, route/error stack record, or global
uncaught-exception ledger.

Outside the two accepted-commit routes covered by client incidents, the API
client has no timeout, retry, request ID, or remote frontend telemetry. HTTP
errors show the server's safe message; native fetch and token errors surface
their browser error string. There is no global `window.onerror` or
`unhandledrejection` collection. Expand diagnostics only around an observed,
bounded failure mode rather than copying arbitrary frontend state or learner
content into logs.
