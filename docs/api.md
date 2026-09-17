# HTTP API index

Routes are defined in [server/index.ts](../server/index.ts). Frontend client: [src/services/api.ts](../src/services/api.ts).

Base URL: `http://localhost:5174` in development (override with
`VITE_API_BASE`). Production builds default to the same origin as the served
frontend.

## Public health and frontend

`GET /healthz` is the only public operational endpoint. It verifies database
access and returns `status`, persisted maintenance/provider-work flags, and the
active provider-work count without learner data. In production, Express serves
the built frontend and applies an SPA fallback outside `/api`; `/api/*` remains
authenticated. Mutating API requests return `503 MAINTENANCE_MODE` while
maintenance is active. Provider-backed requests additionally return
`503 PROVIDER_WORK_DISABLED` when that control is off.

## Authentication

Normal local dogfood uses `APP_AUTH_MODE=trusted_local` (the default) and its
configured `APP_LEARNER_ID`. The hosted-style path uses `APP_AUTH_MODE=clerk`:
every API route requires a verified Clerk session, derives the learner from the
server-side Clerk-subject mapping, and returns `401 AUTH_REQUIRED` or
`403 ACCOUNT_DISABLED` before domain work when applicable. Clients never send
a learner id. The frontend obtains a short-lived Clerk session token and sends
it as a bearer token; local setup is documented in the README's Clerk fixture
section.

## My words

`GET /api/my-words?view=recent|personal|deck&q=<query>&status=unstudied,learning,review&lapses=1&limit=50&offset=0`
returns `{ words, hasMore, total, currentDeck }` for the current learner. `currentDeck`
is a display `{ label }` for the placed learner's current deck mix, or null
when placement/deck data is unavailable. Each entry contains the
word, nullable UTC-day `lastStudiedAt`, and nullable `personalUpdatedAt`.
`total` is the full matching count for the current collection, stage filter,
lapses filter, and search — not the size of the returned page.
`recent` selects learning/review words; `personal` selects retained non-sunk
personal overlays including waiting words. `deck` includes all non-dismissed
words in positive-weight current HSK decks, including unseen words. Missing
placement/manifest or any Beyond HSK weight returns an empty list and null
metadata. The deck view returns the entire explicit deck mix with `hasMore:
false`; omit limit/offset for it (these parameters only page recent/personal
collections). Search is applied across the whole selected collection. Optional
`status` is a comma-separated subset of `unstudied`, `learning`, `review`
(repeated `status` parameters are also accepted). Omitted, empty, or all three
values mean no stage narrowing. Combined with search as AND. Recently studied
ignores `unstudied`; if that leaves no stages, the collection's learning and
review membership is used. Optional `lapses=1` or `lapses=true` further keeps
words with a projected Forgot/incorrect attempt in the last three UTC days or
an unsuccessful last learning day; omit or `0`/`false` leaves that filter off.
The lapses predicate is independent of the selected stages. Results are ordered
learning (last study date descending, missing last), unstudied (pronunciation),
review (last study date descending, missing last), then word id. For
paged views, limit is 1–100; offset is a nonnegative integer.
Invalid parameters, including unknown status or lapses values, return 400. See [the product contract](../SPECS/my-words.md).

## Content diagnostics

| Method | Path | Handler domain |
| --- | --- | --- |
| GET | `/api/content-diagnostics?kind=word\|contrast_cluster\|production_cue&q=<query>&limit=50` | Read-only content projection |

The diagnostic query requires non-empty `q` input and applies the bound in SQL
before hydrating the selected records. It returns only the selected kind and a
`hasMore` signal; it does not read or count the corpus before a user query.
Word items include
cluster membership, production-task cue counts, and any post-reveal production
cue supplements (english frame, example sentence, translation, and whether
the supplement is attached to a durable cue or the meaning-derived fallback);
cluster items include
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

The status payload also returns `serviceBanner`: `null`, or `{ message, postedAt, expiresAt }`
for the current unexpired operator-posted signed-in notice. Expired and cleared
notices are omitted. The banner is not public; it is on this authenticated
status read only.

The status payload also returns two diet-deck flags (SPECS/diet-deck-distribution.md):
`dietDecksActive` (deck-based diet admission is active: Mandarin profile with a
deck manifest present) and `dietIntakeRequired` (deck mode active and the learner
has no stored diet profile yet — the first-run placement intake should be shown).

The status payload also returns `dailyNewWordLimit` and
`unstudiedAdmissionSource`, the durable configured limit and unstudied
admission source used when composing a new session. `unstudiedAdmissionSource`
is `"mixed"` (default 50/50 stash/diet split) or `"stash_only"`. Update them
with JSON bodies containing `dailyNewWordLimit` as a non-negative integer or
`unstudiedAdmissionSource` as `"mixed"` or `"stash_only"`:

| Method | Path | Handler domain |
| --- | --- | --- |
| PATCH | `/api/learning-policy/daily-new-word-limit` | Config / learning policy |
| PATCH | `/api/learning-policy/unstudied-admission-source` | Config / learning policy |

Changing either setting does not rewrite the current UTC day's
completed-new-word count and does not mutate an already-started frontend
session.

## Operator usage pulse

| Method | Path | Handler domain |
| --- | --- | --- |
| GET | `/api/operator/usage-pulse` | Operational cohort pulse |

Bookmark-only frontend surface: `#operator-usage` (not in primary nav).
Requires the caller’s Clerk user id (or trusted-local learner id / `trusted_local`
sentinel) to appear in `APP_OPERATOR_CLERK_USER_IDS`. Returns content-free
cohort aggregates: live `today` plus the last 7 completed UTC-day snapshots
(`dau`, sessions, new words, model spend, median stash, median session time,
and sparse scenario counts). The configured hosted smoke learner
(`APP_SMOKE_CLERK_USER_ID`) is omitted from the inactive-7d count. Empty
allowlist fails closed with `403 OPERATOR_FORBIDDEN`.

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
| POST | `/api/priority/unstudied/add-by-hanzi` | `priority` |

`GET /api/priority/unstudied` is the stash manage list: unstudied words with a
user-priority overlay, ordered tops newest-first by overlay `updated_at`, then
other stash by the same timestamp. Corpus frequency no longer ranks that list.
`bump_count` is still written on overlay updates and is treated as zero/nonzero
stash membership; the payload no longer includes approximate rank, percentile
baseline, or bump-boosted effective priority.

## Diet profile

The durable contract is
[`SPECS/diet-deck-distribution.md`](../SPECS/diet-deck-distribution.md) (§2.3,
§2.5, §2.6). The diet profile is a versioned JSON value in the
`learner_settings` store (`diet_profile`): deck weights, provenance
(`intake` / `learner-nudge` / `operator`), and `updatedAt`. When unset it
defaults to 100% weight on the first deck by manifest order. Deck machinery
is never user-visible.

| Method | Path | Handler domain |
| --- | --- | --- |
| POST | `/api/diet/nudge` | `diet-profile` |
| POST | `/api/diet/intake` | `diet-profile` |
| POST | `/api/diet/intake/assess` | `diet-placement` |

`POST /api/diet/nudge` accepts `{ direction: 'easier' | 'harder' }` and shifts
a fixed internal weight quantum from the current max-weight deck toward the
adjacent deck (harder = successor by deck order, easier = predecessor),
renormalized, with provenance appended. It is clamped at the ends: a nudge
past the first/last deck is a no-op (`changed: false`, no provenance entry).
Returns `200` with `{ profile, changed }`; `400` for an invalid direction;
`409` when the deck manifest is unavailable on the installation.

`POST /api/diet/intake` accepts
`{ answers: Array<{ prompt: string, answer: string }>, selfSelect?: 'complete-beginner' | 'some-basics' | 'intermediate' | 'advanced-or-heritage' | null }`.
It stores the raw natural-language answers plus the resulting initial
placement in the diet profile. Intake answers are profile evidence, never
study actions: no attempt events, no covering, no commits. The v1 placement
mapping is fixed (self-select maps directly onto the deck ladder by manifest
order; absent self-select starts on the first deck). Returns `201` with the
stored profile; `400` for invalid input; `409` when the deck manifest is
unavailable.

`POST /api/diet/intake/assess` accepts `{ answers, providerDisclosureAccepted: true }`, where
`answers` contains one or two exact `{ prompt, answer }` pairs (each prompt is
at most 200 characters, each answer at most 2,000 characters, and the combined
answer text at most 4,000 characters). The explicit flag records authorization
to send those answers to the configured provider. On a validated response, the
server maps its next HSK 2.0 learning level internally and atomically stores the
resulting diet profile and intake evidence. The provider never receives deck
configuration, learner identity, history, or corpus data. It returns `201` on
success, `400` for invalid input or missing disclosure, `409` for a concurrent
or stale placement, `502` for provider or output validation failure, and `503`
when hosted provider work is disabled. It never writes study actions, attempts,
covering, or commits. The existing manual `/api/diet/intake` route remains the
explicit self-select/skip fallback and does not call a provider.

The stored assessment retains the model's `nextLearningLevel` and rationale.
For a reduced manifest, the internal placement may use the first available
lower HSK 2.0 deck; the tail deck is never an intake placement target.
An installation must retain an HSK 2.0 Level 1 deck to offer provider-assisted
intake, because all supported next-learning levels rely on that baseline.

Operator jumps (100% weight on a chosen deck, provenance actor `operator`)
are performed with `scripts/set-diet-deck.ts`; there is no HTTP endpoint.

## Session composition

| Method | Path | Handler domain |
| --- | --- | --- |
| GET | `/api/session-payload` | `session-composition` |

The session payload contains the three study-item buckets. Review production
items freeze their selected durable cue or meaning-derived fallback, the canonical
`{ wordId, hanzi, traditional }` rows whose ids define the accepted set used for
client grading, and nullable recheck-demand id. Unstudied membership is the
experimental dual-pool admitted set from
[`SPECS/study-action-model.md`](../SPECS/study-action-model.md#experimental-dual-pool-unstudied-admission)
(mixed stash/diet split of remaining daily new-word quota, or stash-only when
that source is selected, plus require bypass).
The nullable `traditional` form is canonical content; lookup aliases are excluded.
Typed production grading uses only that frozen accepted-answer snapshot. The
server derives `submittedWordId` at commit: accepted results from the frozen
accepted set, and rejected typed responses from a best-effort unique catalog
match. The payload does not include the shared word catalog.

## Study sessions and attempts

| Method | Path | Handler domain |
| --- | --- | --- |
| POST | `/api/study-sessions/:sessionId/accepted-review-attempt-batch` | `study-sessions` |
| POST | `/api/study-sessions/:sessionId/accepted-contrast-selection-attempt` | `study-sessions` |
| POST | `/api/study-sessions/:sessionId/manage-study-action` | `study-management` |
| POST | `/api/study-sessions/:sessionId/reflections` | `reflection` |
| POST | `/api/review-session-summaries` | `analytics` |
| POST | `/api/client-incidents` | `client diagnostics` |

Accepted review production events must include their exact frozen
`metadata.production` snapshot. The accepted-review batch transaction appends
cue evidence, applies the bounded anchor scheduler response, consumes or creates
the 48-hour one-shot recheck demand, and marks the attempt events projected as
one atomic operation.

Caught accepted-review and contrast-selection commit failures return a
`diagnosticId` alongside the safe `error`. The frontend includes this id in its
visible error. The server retains a private failure record keyed by that id with
the exact parsed request, error chain, and release identity; see the hosted
observability runbook. Successful commits emit a failure-isolated structured
lifecycle event with stable learner/session/action/event correlations, outcome,
rating, and elapsed time so an ambiguous retry can be paired with an earlier
durable success.

`POST /api/review-session-summaries` accepts a non-negative integer `activeDurationMs` alongside the existing completion counts. The `sessionId` upsert replaces all summary fields, including the duration.
Caught summary persistence failures use the same diagnostic-id contract so the
otherwise-lost completion counts and active duration remain inspectable.

`POST /api/client-incidents` accepts an authenticated batch of 1–20 strictly
bounded `client_transport_incident.v1` records. The current schema accepts only
authentication or native-fetch failures from accepted-review and accepted-
contrast commit routes. A valid batch returns `204`; malformed records return
`400`. Upload is diagnostic-only and never retries or changes the associated
study commit. See [error logging and diagnostics](./ops/error-diagnostics.md#client-transport-incidents).

## Post-session reflection

The durable contract is
[`SPECS/reflection-proposals-and-handles.md`](../SPECS/reflection-proposals-and-handles.md).
Request/result types live in
[`src/domain/reflection-evidence.ts`](../src/domain/reflection-evidence.ts) and
[`src/domain/reflection.ts`](../src/domain/reflection.ts).

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/api/study-sessions/:sessionId/reflections` | Generate or return the session's initial reflection |
| POST | `/api/deferred-reflection-second-opinions` | Generate a selected deferred-proposal second opinion |
| GET | `/api/reflection-artifacts?review=open\|all` | Load the unresolved queue or recent history |
| GET | `/api/reflection-generation-runs` | Load the compact dogfood log of concluded provider attempts |
| POST | `/api/reflection-generation-runs/:runId/retry` | Retry a failed run from its saved bounded evidence bundle |
| GET | `/api/reflection-artifacts/:artifactId` | Load immutable evidence/result plus current proposal/application statuses |
| POST | `/api/reflection-proposals/:proposalId/review` | Defer, dismiss, reopen, or authorize one proposal |
| POST | `/api/reflection-invocations/:invocationId/withdraw-authorization` | Withdraw a pending or unsupported authorization |
| PUT | `/api/reflection-quality` | Upsert the tag set on one reflection item |
| DELETE | `/api/reflection-quality` | Clear quality tags for one reflection item |
| GET | `/api/reflection-quality-stats` | Aggregate dogfood quality rates by model arm |
| GET | `/api/attention-badges` | Unseen Help-queue count plus What’s New seen-through date |
| POST | `/api/reflection-inbox-seen` | Stamp one Help card as displayed |
| POST | `/api/whats-new-seen` | Ensure or advance the What’s New seen-through date |
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
returns `503`, provider/structured-output failures return `502`, explicit
non-Luna requests after the daily spend cap return `409`, and
unexpected persistence failures return `500`. Typed generation failures use
`{ error, code }`; internal failures expose only a safe `{ error }`.

Generation is best-effort after study commits and the review-session summary
are durable. It never rewrites study attempts, completion, or scheduling state.

### Generation run log

`GET /api/reflection-generation-runs` returns the most recent concluded
provider attempts, newest first, plus the current UTC-day spend-cap state:

```ts
{
  runs: ReflectionGenerationRunDto[];
  spendCap: {
    lunaOnly: boolean;
    spentUsd: number;
    capUsd: number;
    dayKey: string;
    resetsAt: string; // next UTC midnight
  };
}
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
and GPT-5.6 Terra are sampled with equal probability for initial generation.
Gemini 3.6 Flash remains registered so it can be re-offered later, but it is
not in the default candidate pool or learner-facing pickers. Once that learner's
UTC-day estimated spend surpasses $0.50, unselected initial generation uses only
Luna. OpenRouter arms require
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
cannot be retried, same-model retries whose source model is no longer a
configured comparison arm, and non-Luna retries after the daily spend cap,
return `409`. An explicit current model may still
retry a retained bundle whose source model has been retired, unless the spend
cap has restricted the learner to Luna.

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
  | { action: 'reopen' }
  | { action: 'accept'; operation: ReflectionOperation }
  | { action: 'replace'; operation: ReflectionOperation };
```

Dismiss `reason` is an optional freeform note on the proposal review row. Item
quality tags are a separate overlay and are not written by dismiss.
`reopen` returns a learner-dismissed proposal to `pending` so it re-enters Help.
Second-opinion retirement (`requested_second_opinion`) cannot be reopened.

Defer, dismiss, and reopen return:

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
`accepted` (exact/revised), `dismissed`, `requested_second_opinion`, and
`superseded` with `user_replacement`. Pending, deferred, and system
supersession are excluded from disposition rates. Second-opinion retirement
increases the terminal denominator without counting as a dismiss. Tag counts include every present item tag row (including
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

### Attention badges

`GET /api/attention-badges` returns the cheap nav-badge payload:

```ts
{
  reflectionUnseenCount: number;
  whatsNewSeenThroughDate: string | null;
}
```

`reflectionUnseenCount` is pending Help proposals plus open explanation-only
inbox rows whose `inbox_seen_at` is still null. It is not the Help queue length.
`whatsNewSeenThroughDate` is the learner’s stored YYYY-MM-DD cursor, or null if
it has never been written. The client grandfathers a missing cursor against the
current catalog and counts later posts itself.

`POST /api/reflection-inbox-seen` accepts one of:

```ts
| { kind: 'proposal'; proposalId: string }
| { kind: 'explanation'; artifactId: string; itemId: string }
```

It stamps `inbox_seen_at` once and returns `{ marked, reflectionUnseenCount }`.
Missing proposals return `404`. A missing explanation inbox row is a no-op
`200` so Done races do not fail the pager.

`POST /api/whats-new-seen` accepts `{ throughDate, mode }` where `throughDate`
is `YYYY-MM-DD` and `mode` is `ensure` (fill only when unset) or `seen`
(monotonic max). Success returns `{ whatsNewSeenThroughDate }`.

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
