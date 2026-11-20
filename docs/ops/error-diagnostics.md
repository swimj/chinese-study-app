# Error logging and diagnostics

This document maps the application's current error and diagnostic surfaces.
It answers two questions: where to look after a failure, and what each surface
can and cannot prove. Deployment and Grafana setup remain in the
[hosted observability runbook](./hosted-observability.md).

## First-pass triage

| What the learner saw | First place to look | What it establishes |
| --- | --- | --- |
| `Failed to fetch` with a client incident ID during a review or contrast commit | `hosted:inspect-client-incidents` | The browser's auth-token or fetch promise rejected. A matching backend success proves the commit completed; no matching success does not prove it never arrived. |
| An HTTP error without an ID | Service metrics, `fly logs`, then the relevant domain store | The browser received an HTTP response. Existing route-specific logging varies. |
| A shared introduction or teaching-exercise preparation failure | Operator view's [Preparation failures tab](#shared-word-preparation-failures) | The shared word/stage status, last error, and recorded attempt history. |
| General-practice preparation fails after teaching | Content improvement → Needs attention | The failed preparation's source, attempt count, retained invocation, and whether operator retry is available; see [preparation retries](../vocabulary-learning.md#preparation-retries). |
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

The legacy accepted-review, contrast, and review-summary commit routes that
emitted `study_commit.*` events and wrote `/data/study-commit-diagnostics.jsonl`
have been removed. Nothing writes the sidecar now, and its 30-day pruning ran
only on a new failed write, so an existing file on the volume no longer ages out.
It remains private operational evidence; see
[hosted observability](./hosted-observability.md#diagnose-a-failed-study-commit)
to read it. Deleting it is an explicit operator decision.

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

Open the bookmark-only operator view at `/operator/failures` and select
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

General practice prepared after committed teaching completion has a separate
failure queue in **Content improvement → Needs attention**. An empty Preparation
failures tab therefore does not establish that general practice is ready. The
[vocabulary runtime](../vocabulary-learning.md#post-teaching-practice-preparation)
explains that preparation lifecycle and its retry controls.

The [operator API reference](../api.md#operator-view) lists the failure and retry
endpoints and their access requirements. The
[word content generation guide](../word-content-generation.md) explains stage
dependencies, component reuse, and publication eligibility.

## Reflection diagnostics

The legacy session reflection runtime has been removed, so the server no longer
emits `reflection.*` lifecycle events, appends `reflection-provider-diagnostics.jsonl`,
or writes failure artifacts under `<APP_DATA_DIR>/reflection-failures/`.
Reflection generation run rows remain in SQLite as retained records and travel
with the normal database backup.

The failure-artifact directory was pruned only when the removed runtime started,
so any files still present no longer expire. They contain private learner data
(answers and model-generated text) and are not backed up. To check, list
`/data/reflection-failures` through authenticated Fly SSH; deleting them is an
explicit operator decision. The provider diagnostics file had no pruning policy
and is likewise no longer written.

Vocabulary reflection diagnostics are separate; see the
[vocabulary learning guide](../vocabulary-learning.md).

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
