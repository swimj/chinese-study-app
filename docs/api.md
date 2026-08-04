# HTTP API index

Routes are defined in [server/index.ts](../server/index.ts). Frontend client: [src/services/api.ts](../src/services/api.ts).

Base URL: `http://localhost:5174` (override with `VITE_API_BASE`).

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

## Session composition

| Method | Path | Handler domain |
| --- | --- | --- |
| GET | `/api/session-payload` | `session-composition` |

## Study sessions and attempts

| Method | Path | Handler domain |
| --- | --- | --- |
| POST | `/api/study-sessions/:sessionId/accepted-review-attempt-batch` | `study-sessions` |
| POST | `/api/study-sessions/:sessionId/accepted-contrast-selection-attempt` | `study-sessions` |
| POST | `/api/study-sessions/:sessionId/manage-study-action` | `study-management` |
| POST | `/api/study-sessions/:sessionId/reflections` | `reflection` |
| POST | `/api/review-session-summaries` | `analytics` |

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

### Generate

The request body is the `SessionReflectionEvidenceSupplementV1` object itself,
not a wrapper. The current milestone accepts one or more qualifying typed
production-mistake supplement items containing the cue as shown, raw typed
response, and the complete ordered ids of the accepted attempt batch. The
backend uses those ids only to validate durable session/action identity, then
enriches each into a canonical `production_mistake` bundle item without attempt
rows, attempt summaries, or production-management metadata.
For the initial flow, the backend includes only the first two eligible enriched
items in stable evidence order. The run record retains both eligible and
included counts; omitted items are intentionally unreflected in this
provisional flow.

A successful response is exactly:

```ts
{
  artifactId: string;
  proposalCount: number;
  status: 'created' | 'existing';
}
```

`created` returns `201`; an idempotent hit for the same
`(sessionId, initial_post_session_reflection.v1)` returns `200` and does not
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
estimate only: known initial Luna runs persist their complete versioned price
basis, `pricingAsOf`, and USD estimate at write time; unknown or partial usage
returns those pricing fields as `null` rather than guessing. The endpoint does
not expose saved bundles, raw prompts, provider responses, or diagnostics. Its
`retryable` flag is true only for a failed run whose bundle is retained and
whose session/flow does not already have a successful artifact.

`POST /api/reflection-generation-runs/:runId/retry` reuses that run's exact
saved bundle and returns the same response shape and `201`/`200` semantics as
initial generation. The retry is a new append-only generation run; it never
rewrites the failed attempt. Missing runs return `404`, and concluded runs that
cannot be retried return `409`.

### Queue and detail

`review` is required and must be `open` or `all`. The open query includes
artifacts having at least one `pending` or `deferred` proposal. The all query
returns recent history, including informational artifacts with no proposals.
The response is:

```ts
{ artifacts: ReflectionArtifactSummaryDto[] }
```

Each summary includes artifact/session/flow identity, generation and
provider/model/prompt metadata, bundle/result schema versions, and item,
proposal, and open-proposal counts.

Detail returns a `ReflectionArtifactDetailDto` directly. It adds the exact
evidence bundle, validated result, and one joined proposal detail per immutable
proposal. Each proposal detail contains its item locator, original proposal,
current review status, and nullable invocation/application status.
Both reads return `200` on success. Invalid queue filters return `400`, missing
artifacts return `404`, and unexpected read failures return `500`.

### Proposal review and authorization withdrawal

Proposal review accepts only this strict union; unknown fields are rejected:

```ts
type ReviewProposalRequest =
  | { action: 'defer' }
  | { action: 'dismiss'; reason: string | null }
  | { action: 'accept'; operation: ReflectionOperation };
```

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

## Study management (outside session)

| Method | Path | Handler domain |
| --- | --- | --- |
| POST | `/api/study-management/production/suppress` | `study-management` |
| POST | `/api/study-management/production/bad-prompt` | `study-management` |

## Contrast clusters and prompts

Adding a cluster member makes that word eligible for contextual-selection
practice by ensuring normal relevance and enabled, initialized scheduler state.
Removing a word from every cluster removes its available contrast content and
is the supported way to stop contrast practice for that word; contrast actions
do not expose generic skill suppression.

| Method | Path | Handler domain |
| --- | --- | --- |
| GET | `/api/contrast-clusters` | `contrast` |
| POST | `/api/contrast-clusters` | `contrast` |
| PATCH | `/api/contrast-clusters/:clusterId` | `contrast` |
| POST | `/api/contrast-clusters/:clusterId/members` | `contrast` |
| PATCH | `/api/contrast-clusters/:clusterId/members/:wordId` | `contrast` |
| DELETE | `/api/contrast-clusters/:clusterId/members/:wordId` | `contrast` |
| POST | `/api/contrast-clusters/:clusterId/prompts` | `contrast` |
| PATCH | `/api/contrast-prompts/:promptId` | `contrast` |
| POST | `/api/contrast-prompts/:promptId/resolve-bad-feedback` | `contrast` |
| DELETE | `/api/contrast-prompts/:promptId` | `contrast` |

## Contrast intake

| Method | Path | Handler domain |
| --- | --- | --- |
| GET | `/api/contrast-intake/groups` | `contrast` |
| GET | `/api/contrast-intake/words` | `contrast` |
| POST | `/api/contrast-intake/words/:targetWordId/resolve` | `contrast` |
| POST | `/api/contrast-intake/words/:targetWordId/merge-suggested-clusters` | `contrast` |
| POST | `/api/contrast-intake/groups/accept` | `contrast` |
| POST | `/api/contrast-intake/groups/dismiss` | `contrast` |
| POST | `/api/contrast-intake/groups/create-cluster` | `contrast` |
| POST | `/api/contrast-intake/groups/add-to-cluster` | `contrast` |
| POST | `/api/contrast-intake/groups/add-prompt` | `contrast` |

Domain column matches [server-db.md](./server-db.md) modules.
