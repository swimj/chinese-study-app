# HTTP API index

Routes are defined in [server/index.ts](../server/index.ts). Frontend client: [src/services/api.ts](../src/services/api.ts).

Base URL: `http://localhost:5174` (override with `VITE_API_BASE`).

## Authentication

Normal local dogfood uses `APP_AUTH_MODE=trusted_local` (the default) and its
configured `APP_LEARNER_ID`. The hosted-style path uses `APP_AUTH_MODE=clerk`:
every API route requires a verified Clerk session, derives the learner from the
server-side Clerk-subject mapping, and returns `401 AUTH_REQUIRED` or
`403 ACCOUNT_DISABLED` before domain work when applicable. Clients never send
a learner id. The frontend obtains a short-lived Clerk session token and sends
it as a bearer token; local setup is documented in the README's Clerk fixture
section.

## Content diagnostics

| Method | Path | Handler domain |
| --- | --- | --- |
| GET | `/api/content-diagnostics?kind=word\|contrast_cluster\|production_cue&q=<query>&limit=50` | Read-only content projection |

The diagnostic query requires non-empty `q` input and applies the bound in SQL
before hydrating the selected records. It returns only the selected kind and a
`hasMore` signal; it does not read or count the corpus before a user query.
Word items include
cluster membership and production-task cue counts; cluster items include
members and prompts; durable production-cue items include their anchor and
accepted words, lifecycle state, provenance, and current evidence projection.
It does not expose a content mutation path.

## Shared content reports

| Method | Path | Handler domain |
| --- | --- | --- |
| POST | `/api/shared-content/production-cues/:cueId/reports` | Learner-private shared-content report |

The JSON body contains `category` (`incorrect`, `misleading`, `unsafe`, or
`other`) and an optional string `note`. The authenticated learner is derived at
the request boundary; clients never submit a learner id. A report is private,
idempotent per learner and published cue, and does not itself change shared
eligibility. Operator quarantine is a separate backend command and is not
exposed as a learner-controlled HTTP endpoint.

## Status

| Method | Path | Handler domain |
| --- | --- | --- |
| GET | `/api/status` | Config / health |

`GET /api/status?studyDayKey=YYYY-MM-DD` also returns `sessionActiveTimeMetrics`: today's completed active-session duration, plus 3-day and 7-day calendar-day averages in milliseconds. Averages include zero-activity days.

The status payload also returns `dailyNewWordLimit`, the durable configured
limit used when composing a new session. Update it with a JSON body containing
`dailyNewWordLimit` as a non-negative integer:

| Method | Path | Handler domain |
| --- | --- | --- |
| PATCH | `/api/learning-policy/daily-new-word-limit` | Config / learning policy |

Changing the limit does not rewrite the current UTC day's completed-new-word
count and does not mutate an already-started frontend session.

## Words and meanings

| Method | Path | Handler domain |
| --- | --- | --- |
| GET | `/api/words/search` | `words` |
| GET | `/api/words/:id/meanings` | `words` |
| PATCH | `/api/words/:id/personal-notes` | `words` |
| PATCH | `/api/words/:id/user-priority` | `priority` |
| POST | `/api/words/:id/complete-learning-session` | `words` |
| POST | `/api/words/:id/complete-unstudied-session` | `words` |
| POST | `/api/words/:id/dismiss` | `words` |
| PATCH | `/api/words/:wordId/meanings/:meaningId` | `words` |

## Priority / unstudied intake

| Method | Path | Handler domain |
| --- | --- | --- |
| GET | `/api/priority/unstudied` | `priority` |
| GET | `/api/priority/unstudied/top` | `priority` |
| POST | `/api/priority/unstudied/add-by-hanzi` | `priority` |

`GET /api/priority/unstudied` is the stash manage list: unstudied words with a
user-priority overlay, ordered tops newest-first by overlay `updated_at`, then
other stash by the same timestamp. Corpus frequency no longer ranks that list.
`bump_count` is still written on overlay updates and is treated as zero/nonzero
stash membership; the payload no longer includes approximate rank, percentile
baseline, or bump-boosted effective priority.

`GET /api/priority/unstudied/top` is the advisor-aware intake queue. It excludes
words with any explicit positive priority override and returns an
`intakeTriage` annotation per word plus `analysisCandidateCount`.

## Intake triage advisor

The durable product contract is
[`SPECS/intake-triage-advisor.md`](../SPECS/intake-triage-advisor.md).

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/api/intake-triage/runs` | Analyze fresh eligible entries in the current top 50 |
| POST | `/api/intake-triage/assessments/:id/accept` | Apply an actionable assessment atomically |
| POST | `/api/intake-triage/assessments/:id/dismiss` | Hide advice without changing the word |

Generation returns `201`; no candidates or a concurrent run returns `409`,
missing provider configuration returns `503`, and safe provider failures return
`502`. Assessment actions return `404` for an unknown id and `409` for stale,
already-reviewed, or non-actionable advice. Clients never submit a word id or
effect with an assessment action.

A successful run response includes its app run/client-request id, nullable
provider response id, included word count, and nullable estimated USD cost. The
provider request and raw response are transient; API reads expose only the
translated annotations attached to priority words.

## Session composition

| Method | Path | Handler domain |
| --- | --- | --- |
| GET | `/api/session-payload` | `session-composition` |

The session payload contains the three study-item buckets plus a frozen
production answer catalog of canonical `{ wordId, hanzi, traditional }` rows.
Unstudied membership is the experimental dual-pool admitted set from
[`SPECS/study-action-model.md`](../SPECS/study-action-model.md#experimental-dual-pool-unstudied-admission)
(stash/diet split of remaining daily new-word quota, plus require bypass).
Review production items also freeze their selected durable cue or meaning-
derived fallback, accepted-word ids, and nullable recheck-demand id. The
nullable `traditional` form is canonical content; lookup aliases are excluded.

## Study sessions and attempts

| Method | Path | Handler domain |
| --- | --- | --- |
| POST | `/api/study-sessions/:sessionId/accepted-review-attempt-batch` | `study-sessions` |
| POST | `/api/study-sessions/:sessionId/accepted-contrast-selection-attempt` | `study-sessions` |
| POST | `/api/study-sessions/:sessionId/manage-study-action` | `study-management` |
| POST | `/api/study-sessions/:sessionId/reflections` | `reflection` |
| POST | `/api/review-session-summaries` | `analytics` |

Accepted review production events must include their exact frozen
`metadata.production` snapshot. The accepted-review batch transaction appends
cue evidence, applies the bounded anchor scheduler response, consumes or creates
the 48-hour one-shot recheck demand, and marks the attempt events projected as
one atomic operation.

`POST /api/review-session-summaries` accepts a non-negative integer `activeDurationMs` alongside the existing completion counts. The `sessionId` upsert replaces all summary fields, including the duration.

## Post-session reflection

The durable contract is
[`SPECS/reflection-proposals-and-handles.md`](../SPECS/reflection-proposals-and-handles.md).
Request/result types live in
[`src/domain/reflection-evidence.ts`](../src/domain/reflection-evidence.ts) and
[`src/domain/reflection.ts`](../src/domain/reflection.ts).

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/api/study-sessions/:sessionId/reflections` | Generate or return the session's initial reflection |
| GET | `/api/reflection-artifacts?review=open\|all` | Load the unresolved queue or recent history |
| GET | `/api/reflection-generation-runs` | Load the compact dogfood log of concluded provider attempts |
| POST | `/api/reflection-generation-runs/:runId/retry` | Retry a failed run from its saved bounded evidence bundle |
| GET | `/api/reflection-artifacts/:artifactId` | Load immutable evidence/result plus current proposal/application statuses |
| POST | `/api/reflection-proposals/:proposalId/review` | Defer, dismiss, or authorize one proposal |
| POST | `/api/reflection-invocations/:invocationId/withdraw-authorization` | Withdraw a pending or unsupported authorization |
| PUT | `/api/reflection-quality` | Upsert the tag set on one reflection item |
| DELETE | `/api/reflection-quality` | Clear quality tags for one reflection item |
| GET | `/api/reflection-quality-stats` | Aggregate dogfood quality rates by model arm |
| GET | `/api/reflection-help-inbox` | List open explanation-only Help inbox rows |
| DELETE | `/api/reflection-help-inbox` | Mark one explanation-only Help item Done by deleting its inbox row |
| POST | `/api/reflection-artifacts/:artifactId/items/:itemId/manual-invocations` | Authorize a registered operation against an explanation-only item |

### Generate

The request body is a `SessionReflectionEvidenceSupplementV1` or V2 object
itself, not a wrapper. It contains one or more qualifying review-production
items, including the cue as shown, nullable raw response, complete ordered ids
of the accepted attempt batch, and the optional V2 learner-request marker. The
backend uses those ids only to validate durable session/action identity, then
enriches each into a canonical V4 `production_mistake` bundle item without
attempt rows, attempt summaries, or production-management metadata. V4 keeps
the exact nullable post-reveal supplement separate from the pre-reveal cue;
new generation returns the strict V7 result contract.

A successful response is exactly:

```ts
{
  artifactId: string;
  proposalCount: number;
  status: 'created' | 'existing';
}
```

`created` returns `201`; an idempotent hit for the same
`(sessionId, initial_post_session_reflection.v2)` returns `200` and does not
call the provider again. Evidence validation errors return `400`, missing
sessions or referenced entities return `404`, missing provider configuration
returns `503`, provider/structured-output failures return `502`, and
unexpected persistence failures return `500`. Typed generation failures use
`{ error, code }`; internal failures expose only a safe `{ error }`.

Generation is best-effort after study commits and the review-session summary
are durable. It never rewrites study attempts, completion, or scheduling state.

### Generation run log

`GET /api/reflection-generation-runs` returns the most recent concluded
provider attempts, newest first:

```ts
{ runs: ReflectionGenerationRunDto[] }
```

Each record is separate from immutable artifacts so failed or truncated provider
attempts can appear without implying that a usable reflection was created. It
includes provider/configured model and provider model, `succeeded` or `failed`
state, failure code, response and finish metadata when available, eligible and
included evidence counts, and nullable normalized token categories. Cost is an
estimate for direct-provider arms: known initial Luna runs persist their
complete versioned price basis, `pricingAsOf`, and USD estimate at write time.
Successful OpenRouter runs instead persist its response's `usage.cost` as the
amount charged, with `openrouter-usage-cost.v1` recorded as the source basis;
the routed upstream price mix remains deliberately unmodeled. If that field is
unavailable but complete token usage is present, the existing static
transport/model estimate remains a fallback; unknown or partial usage returns
those pricing fields as `null` rather than guessing. Each run also
preserves nullable provider-request, bundle-schema, and result-schema
provenance. Failed runs may expose a versioned diagnostic with phase
`provider_transport`, `truncation`, `json_parse`, `structural_schema`, or
`domain_validation`, bounded path/rule/message issues, and capped
rejected-output context. This is intentionally verbatim in the local dogfood
environment; only its size is bounded. Productization must add the appropriate
retention and secret-handling policy before broader deployment. Legacy rows
without detail return null diagnostics.
The endpoint does not expose saved bundles, raw prompts, or provider response
envelopes. Its `retryable` flag is true only for a failed run whose bundle is retained and
whose session/flow does not already have a successful artifact.

### Comparison arms

The reflection service has a backend-only comparison-arm registry. Luna, GLM,
Gemini 3.6 Flash, Claude Sonnet 5, and GPT-5.6 Terra are sampled with equal
probability for initial generation. OpenRouter arms require
`OPENROUTER_API_KEY` and use OpenRouter's normal eligible-provider routing;
they do not pin one upstream host or disable fallbacks. Missing credentials fail
only the selected arm with the existing `503` typed failure; they never affect
finalization or other arms. OpenRouter's returned cost is preserved for a
successful routed run; complete usage without a returned cost uses the existing
model estimate, while unavailable usage remains unpriced.

`POST /api/reflection-generation-runs/:runId/retry` reuses that run's exact
saved bundle and returns the same response shape and `201`/`200` semantics as
initial generation. The retry is a new append-only generation run; it never
rewrites the failed attempt. Missing runs return `404`. Concluded runs that
cannot be retried, and same-model retries whose source model is no longer a
configured comparison arm, return `409`. An explicit current model may still
retry a retained bundle whose source model has been retired.

### Queue and detail

`review` is required and must be `open` or `all`. The open query includes
artifacts having at least one `pending` or `deferred` proposal. The all query
returns recent history, including informational artifacts with no proposals.
The response is:

```ts
{ artifacts: ReflectionArtifactSummaryDto[] }
```

Each summary includes artifact/session/flow identity, generation and
provider/model/prompt metadata, bundle/result schema versions, proposal and
open-proposal counts, and a `readState` discriminator. Available artifacts have
`readState: "available"` and a numeric item count. An artifact that cannot be
reconstructed by the current reader has `readState: "unreadable"` and a null
item count; it remains in the list without failing sibling artifacts or the
page-wide request.

Detail returns a `ReflectionArtifactDetailDto` directly. It adds the exact
evidence bundle, validated result, and one joined proposal detail per immutable
proposal. Each proposal detail contains its item locator, original proposal,
current review status, and nullable invocation/application status.
Both reads return `200` on success. Invalid queue filters return `400`, missing
artifacts return `404`, and a detail request for an unreadable artifact returns
`500`. Systemic list failures still return `500`.

### Proposal review and authorization withdrawal

Proposal review accepts only this strict union; unknown fields are rejected:

```ts
type ReviewProposalRequest =
  | { action: 'defer' }
  | {
      action: 'dismiss';
      reason: string | null;
    }
  | { action: 'accept'; operation: ReflectionOperation }
  | { action: 'replace'; operation: ReflectionOperation };
```

Dismiss `reason` is an optional freeform note on the proposal review row. Item
quality tags are a separate overlay and are not written by dismiss.

Defer and dismiss return:

```ts
{ review: ProposalReviewStatus; invocation: null; application: null }
```

Accept revalidates the operation against the proposal evidence and current
entities, classifies it as exact or revised, stores an immutable invocation,
and immediately applies supported operations. Successful review returns `200`
with:

```ts
{
  review: ProposalReviewStatus;
  invocation: OperationInvocation;
  application: OperationApplicationStatus;
}
```

Replace revalidates a different operation kind or version against the same
proposal evidence, writes a `user_replacement` invocation, and supersedes the
original proposal. It uses the same response and application behavior as
acceptance.

Cue repair and production-alternate acceptance return a truthful
`unsupported` application without a domain write. Supported application may
return `applied`, `already_satisfied`, `stale`, or `failed`.

Withdrawal accepts no fields (the client sends `{}`) and is valid only from
`pending` or `unsupported`. It leaves the accepted proposal historical
disposition unchanged and returns `200` with:

```ts
{
  invocation: OperationInvocation;
  application: OperationApplicationStatus;
}
```

Review/withdraw validation and invalid lifecycle transitions return `400`;
missing proposal/invocation ids return `404`; unexpected failures return `500`.

### Quality tags and model-arm stats

Quality tags are a dogfood overlay on reflection items. They do not change
proposal disposition, invocations, or application. Artifact detail includes
`qualityItemTags` for items that have a tag row.

`PUT /api/reflection-quality` accepts:

```ts
type UpsertReflectionQualityRequest = {
  artifactId: string;
  itemId: string;
  tags: ReflectionQualityTag[];
  note?: string | null;
};
```

Tags are `praise`, `wrong_diagnosis`, `wrong_intervention`,
`missed_intervention`, `low_quality_content`, `inconsistent`, and `other`.
The set must be non-empty; `other` requires a non-empty note. Last write wins
for the item. Success returns `200` with the stored item tag row. Validation
errors return `400`; missing artifact/item return `404`.

`DELETE /api/reflection-quality` accepts `{ artifactId, itemId }` and returns
`200` with `{ cleared: true }` when a row existed or `{ cleared: false }` when
none did. Missing artifact/item still return `404`.

`GET /api/reflection-quality-stats` returns rates grouped by artifact `model`
(model arm) and `promptVersion`. Terminal user reviews are
`accepted` (exact/revised), `dismissed`, and `superseded` with
`user_replacement`. Pending, deferred, and system supersession are excluded
from disposition rates. Tag counts include every present item tag row (including
items whose proposals are still open). Each arm also includes `failedRunCount`,
`totalCostUsd` (sum of priced generation runs, including validation failures),
and `avgCostPerExactAcceptUsd` when both cost and exact accepts are available.
Small-n counts are returned raw; the surface does not claim statistical
significance. The UI aggregates arms by model and can expand multi-version
models into per-`promptVersion` breakdown rows.

### Help inbox

The Help inbox is the open set of explanation-only items still in Help. Items
with empty proposal lists are added when their artifact is materialized. Items
that carry proposals are not inbox members; their Help presence follows
proposal review. Artifact detail includes `helpInbox` for explanation-only
items still open in Help.

`GET /api/reflection-help-inbox` returns `{ entries }` for every still-open
explanation item. Success returns `200` with:

```ts
type ReflectionHelpInboxEntry = {
  inboxId: string;
  artifactId: string;
  itemId: string;
  openedAt: string;
};
```

`DELETE /api/reflection-help-inbox` accepts `{ artifactId, itemId }` and
removes that item from Help. Success returns `200` with `{ done: true }` when
a row existed or `{ done: false }` when none did. Missing artifact/item still
return `404`. There is no learner-facing undo.

Done leaves the artifact body unchanged, so By session and raw artifact reads
still show the item.

### Manual authorization from explanation-only items

`POST /api/reflection-artifacts/:artifactId/items/:itemId/manual-invocations`
authorizes a registered operation against one explanation-only item's evidence.
It does not fabricate a proposal or rewrite the immutable artifact. The request
body is `{ operation }`; unknown fields are rejected.

The item must exist on the artifact and must have an empty proposal list.
Validation, application, and withdrawal then follow the same invocation path as
proposal acceptance. If the item still has a Help inbox row, that row is
removed in the same authorization transaction.

Success returns `200` with:

```ts
{
  invocation: OperationInvocation;
  application: OperationApplicationStatus;
}
```

Invalid operations, items that already carry proposals, and unknown fields
return `400`. Missing artifact or item ids return `404`. Unexpected failures
return `500`.

## Study management (outside session)

| Method | Path | Handler domain |
| --- | --- | --- |
| POST | `/api/study-management/production/suppress` | `study-management` |

## Contrast clusters and intake (retired HTTP)

Contrast-cluster management routes (`/api/contrast-clusters*`,
`/api/contrast-prompts*`) and projected contrast-intake triage routes
(`/api/contrast-intake/*`) are retired. Cluster/prompt creation for study now
goes through reflection `create_contrast_cluster` application and persistence
primitives. The vestigial `contrast_candidate_intake` table and reader are
retired; pre-SWI-47 databases are no longer supported by current builds.

Domain column matches [server-db.md](./server-db.md) modules.
