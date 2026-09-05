# Hosted observability

This runbook owns the first production performance-observability surface for
the hosted beta. The view is Fly's managed Grafana, separate from the learner
application and protected by Fly organization access. The application exposes
content-free Prometheus metrics only on the private metrics listener; it does
not add an `/admin` route, a learner-facing page, or a public `/metrics`
endpoint.

The initial slice is deliberately small. It is intended to identify where
hosted latency is being introduced and to provide a stable seam for adding
deeper measurements after a hotspot is observed. It does not introduce a
second telemetry vendor, distributed tracing, long-retention analytics, or
large-scale alerting infrastructure.

## Data boundary

The metrics contain only bounded operational dimensions:

- normalized Express route templates, HTTP methods, and status codes;
- request latency, response sizes, and in-flight counts;
- process CPU, memory, uptime, and event-loop delay;
- bounded application version and Fly deployment identifier labels;
- SQLite database and WAL file sizes;
- Litestream backup availability and replication age; and
- maintenance/provider-work control state and provider work in flight.

Raw URLs, query strings, route parameter values, learner identifiers, answers,
notes, prompts, generated output, provider payloads, credentials, and replica
coordinates must never become metric labels or values. Do not add a label for
learner, word, session, artifact, invocation, provider request, exception
message, or arbitrary URL. New label dimensions require an explicit bounded
cardinality and privacy review.

That restriction applies to aggregate metrics, not to failure records whose
purpose is reconstructing one broken write. A failed accepted-review attempt,
contrast-selection attempt, or completed-session summary writes a private
diagnostic record containing the exact parsed request body, server-derived
learner id, session/action/event/word ids, response status, full error message,
stack and cause chain, and runtime release identity. Those details are
deliberately retained because omitting them makes deterministic commit failures
impossible to diagnose after the browser session is gone. Authorization headers,
credentials, cookies, and unrelated request headers are never recorded.

Fly adds its own `app`, `instance`, `host`, and `region` labels when scraping.
Do not emit those labels from the application.

## Diagnose a failed study commit

Every successful accepted-review or contrast-selection commit emits a compact
`study_commit.succeeded` JSON event. It includes learner/session/action/word and
event-id correlations, the submitted outcome and rating, and elapsed time. This
makes an ambiguous retry diagnosable: an operator can tell whether the same
event id was already committed before a later request failed.

Every caught study-commit failure receives a UUID diagnostic id. The API returns
that id to the frontend, which includes it in the visible error. The process also
writes:

- one compact `study_commit.failed` JSON event to stderr for immediate `fly logs`
  inspection; and
- one complete line in `/data/study-commit-diagnostics.jsonl`, on the attached
  volume beside `app.db`.

The compact failure event includes the diagnostic id, route/status, elapsed
time, learner, session, action, event and target-word correlations, plus the
exact error name, message, code and related scalar details. It omits the attempt
response and full body.
The sidecar contains the complete diagnostic, including the submitted payload
and stack.

Read recent records without opening or copying the database:

```bash
fly ssh console --app <app-name> --command \
  'npm run --silent hosted:inspect-study-commits -- --data-dir=/data --limit=20'
```

If the learner supplied a diagnostic id, select that record directly:

```bash
fly ssh console --app <app-name> --command \
  'npm run --silent hosted:inspect-study-commits -- --data-dir=/data --diagnostic-id=<id>'
```

The file is failure-only and survives an application restart, but it is not part
of the SQLite/Litestream backup stream. Treat it as private operational evidence
and inspect or preserve it before replacing the Machine or volume. On the first
failed write of each UTC day, the application removes valid records older than
30 days. Malformed lines are preserved for manual diagnosis rather than silently
discarded.

## Deploy and open the admin view

Merging this change does not alter the running Fly app. The repository has no
automatic Fly deployment workflow, and the ignored generated Fly configuration
does not update when its tracked template changes.

When the operator is ready to activate observability, update
`deploy/fly/.generated/fly.toml` from the tracked template while preserving its
app-specific values, including the live Machine memory setting. Confirm it
contains both `APP_METRICS_PORT = "9091"` and:

```toml
[metrics]
  port = 9091
  path = "/metrics"
```

Validate the resulting app-specific configuration before deployment:

```bash
fly config validate --config deploy/fly/.generated/fly.toml
```

`APP_METRICS_PORT=9091` starts a second listener inside the Machine. Port 9091
is not declared as an HTTP service, so the Fly proxy does not publish it. Fly's
metrics collector scrapes it every 15 seconds. The learner application remains
on port 5174.

Deploy through the normal hosted release runbook. Then:

1. Sign in to [Fly managed Grafana](https://fly-metrics.net) with an account
   that has access to the Fly organization.
2. Switch to the organization that owns the app.
3. Import
   [`deploy/fly/grafana/chinese-study-observability.json`](../../deploy/fly/grafana/chinese-study-observability.json).
4. Select the preconfigured Fly Prometheus data source when prompted.
5. Choose the app in the dashboard's **Fly app** selector.

The dashboard JSON is the versioned source of truth. If a useful panel is
created interactively, export it and update the tracked dashboard rather than
leaving the only copy in Grafana.

To verify collection before using the dashboard, open Grafana **Explore** and
query:

```promql
chinese_study_process_uptime_seconds{app="<app-name>"}
```

The series should appear within roughly one minute of a healthy deploy. If it
does not, inspect `fly logs`, confirm the Machine has `APP_METRICS_PORT=9091`,
and confirm the generated Fly configuration retained the tracked `[metrics]`
section. Do not expose port 9091 as a public service to debug scraping.

## Read the performance dashboard

Use one representative slow action and the same time window throughout the
comparison.

1. Treat **Fly edge baseline p95** and **Fly app baseline p95** as pathless
   platform baselines. They include health-check traffic; a gap can show Fly
   proxy/routing, edge-to-Machine, or response-streaming overhead, but it does
   not measure DNS, page startup, Clerk initialization, TLS setup, or
   browser-to-edge transit. Use browser DevTools for those client-side stages;
   add bounded real-user monitoring only if they need ongoing measurement.
2. Compare **Fly app baseline p95** with **Service p95 by route** while
   repeatedly exercising one representative API action. The custom service
   timer starts before parsing/authentication and ends when the response
   finishes, while Fly's app metric measures the proxy's application-side
   request. Agreement confirms the time is inside the Machine; a gap suggests
   proxy/container or response-transfer overhead.
3. Identify which normalized route is slow. Provider-backed routes include the
   upstream wait in their service duration; ordinary synchronous routes are
   dominated by application and SQLite work.
4. Compare response size by route. A large `/api/session-payload` or static
   response can make transfer and serialization visible even when handler work
   is otherwise healthy.
5. Check CPU, event-loop delay, and memory over the same interval. High CPU or
   event-loop delay indicates process saturation or blocking work. Low CPU and
   event-loop delay with one slow route points instead toward I/O, SQLite, or
   an upstream provider.
6. Check database/WAL size, volume use, and backup age for operational context.
   Backup age approaching 3,600 seconds is already a stop-writes condition in
   the hosted deployment runbook. Treat any red availability indicator as an
   operational fault rather than a fresh backup.

This first slice deliberately does not label individual SQL statements or
provider calls. Once a repeatable slow route is identified, add a bounded
timer around the relevant persistence or provider boundary rather than adding
unbounded tracing everywhere.

## Retention and follow-up threshold

Fly currently retains managed metrics for approximately 15 days and does not
provide built-in metric alerting. That is sufficient for the initial beta
profiling loop. Revisit the storage/alerting choice when any of these becomes
true:

- performance regressions need comparison across release windows longer than
  15 days;
- an operational threshold needs unattended notification;
- a route-level hotspot cannot be explained without bounded SQL/provider
  spans; or
- the managed dashboard cannot support the beta's routine diagnosis needs.

If longer retention or alerting becomes necessary, federate the Fly Prometheus
endpoint into an operator-owned monitoring stack. Do not send learner content
to that stack.
