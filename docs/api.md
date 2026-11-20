# HTTP API index

The [vocabulary product contract](../SPECS/vocabulary-learning.md) defines intended
behavior; the [architecture contract](../SPECS/vocabulary-architecture.md) defines
structural constraints. The [implementation guide](vocabulary-learning.md) explains
the current runtime. Earlier-runtime entries below support retained records and
compatibility; they do not reopen retired Mandarin write paths.

`createApp` in [server/index.ts](../server/index.ts) owns the middleware chain and
registration order; route handlers live in `register<Area>Routes` modules under
[server/routes/](../server/routes/), [server/vocabulary/](../server/vocabulary/), and
other subsystem folders. Express matches in registration order, so a new route
that overlaps an existing pattern must be registered on the intended side of it.
Frontend client: [src/services/api.ts](../src/services/api.ts).

Base URL: `http://localhost:5174` in development (override with
`VITE_API_BASE`). Production builds default to the same origin as the served
frontend.

## Public health and frontend

`GET /healthz` verifies database access and returns `status`, persisted service
controls, and the active provider-work count without learner data. In production,
Express serves the built frontend and applies an SPA fallback outside `/api`.

`GET /api/service-access` returns `{ allowed: boolean }` with `Cache-Control:
no-store`. It checks operator-only access using the verified Clerk subject when
present, without resolving or bootstrapping a learner. Anonymous callers can
use this probe; it grants no application-data access.

## Authentication and service access

Normal local dogfood uses `APP_AUTH_MODE=trusted_local` (the default) and its
configured `APP_LEARNER_ID`. The hosted-style path uses `APP_AUTH_MODE=clerk`.
Except for the access-status probe, API routes require a verified Clerk session,
derive the learner from the server-side Clerk-subject mapping, and return
`401 AUTH_REQUIRED` or `403 ACCOUNT_DISABLED` before domain work when applicable.
Clients never send a learner id. The frontend obtains a short-lived Clerk
session token and sends it as a bearer token; local setup is documented in the
README's Clerk fixture section.

When the persisted operator-only control is enabled, non-operators receive
`503 OPERATOR_ONLY` on application API reads and writes before learner resolution
or bootstrap. Responses are not cacheable. Operators are identified by
`APP_OPERATOR_CLERK_USER_IDS`; trusted-local mode retains the same explicit
operator allowlist/sentinel rules as operator endpoints. An empty allowlist
admits nobody while operator-only access is enabled.

Maintenance independently rejects mutating API requests with
`503 MAINTENANCE_MODE`, including operator requests. Provider-backed work also
respects `503 PROVIDER_WORK_DISABLED`. Operator-only access does not pause
background jobs or override either control.

## Adaptive vocabulary

Mandarin study uses the authenticated `/api/vocabulary` family. Commands are
validated in `server/vocabulary/study-routes.ts`; the server derives the learner.
Start uses the supplied time zone for the 4 a.m. local new-word
quota boundary. Older clients omitting it retain UTC calendar-day behavior.

| Method/path | Result or effect |
| --- | --- |
| `POST /sessions` | Compose ready work and return its first encounter; accepts the browser IANA `timeZone`; `400` names why nothing is ready (introductions or replacement content still preparing, or no ready material) |
| `GET /sessions/:id` | Current owned projection and exact material |
| `POST /sessions/:id/next` | Select ready material; stable `clientActionId` retries; optional `activeDurationMs` drives a timed session's recorded budget wrap-up |
| `POST /sessions/:id/commands` | Response, exercise reaction (v1 command `feedback`), skip, coverage, more, mode, Undo, resume, finish, timed `studyMore` (409 unless the budget ended a completed session) |
| `POST /sessions/:id/note` | Timed sessions only: save or clear (`""`) the optional completion line, at most 500 characters; 409 for classic sessions |
| `POST /sessions/:id/completion` | Freeze `throughSequence` after flush, with optional reported active duration |
| `GET /sessions/:id/completion` | Current completion and server deadline |
| `POST /sessions/:id/completion/cancel` | Cancel exact `completionId` before closure |
| `POST /sessions/:id/completion/close` | Apply exact completion idempotently |
| `GET /completion/current` | Pending/failed completion, without active-session restoration |
| `GET /words` | Owned words and current modes/schedule hints |
| `POST /words/:id`, `/mode`, `/refresh`, `/dismiss` | Explicit enrollment and word controls |
| `GET /feedback`, `/feedback/attention` | Read-only own lessons and lightweight attention |
| `GET /study-days` | Recent finished vocabulary study dates and today for the Home week and Start label. Optional `timeZone` uses the local 04:00 study day |
| `GET /statistics` | UTC daily session/response/coverage totals, active-time availability, and current modes |
| `GET /progress` | Learner progress indicators from closed vocabulary-runtime history; optional `timeZone` sets the 04:00 local study day (400 if invalid). Computed on request; each call logs a `vocabulary.progress.computed` cost line |
| `POST /feedback/:id/seen`, `/feedback/jobs/:id/retry` | Acknowledge lesson or explicitly retry own failed feedback |

### Add-word chat

All routes below use `/api/vocabulary/intake` and an authenticated Mandarin
learner. The wire contract is in
[`src/domain/vocabulary-intake.ts`](../src/domain/vocabulary-intake.ts).
Responses omit private command snapshots and raw tool results.

| Route | Purpose |
| --- | --- |
| `GET /` | Recent turns in chronological order with current cards. Use the returned `before` turn cursor to fetch the preceding page. |
| `POST /turns` | Accepts `clientTurnId` and text up to 4,000 JavaScript characters. Sends JSON `progress`, `completion`, `done` or `error` events as server-sent events. `progress` carries a transient stage; `completion` carries `assistantText` and `cards` together after commit. The same ID and text replay an accepted turn. An error with `retryWithNewId: true` confirms a failed attempt and permits a fresh retry identity; uncertain transport loss retains the original ID. |
| `GET /cards?outstanding=true` | Lists live word or sense proposals, words awaiting preparation and attention cards. Enrolled unstudied cards show `added` throughout preparation. |
| `GET /cards/:id` | Reads the current owned card. |
| `GET /attention` | Counts proposals and cards with attention. |
| `POST /cards/:id/commands` | Runs `add`, `add_sense`, `set_senses` or `undo` with a stable `clientActionId`, expected card version and current learner/catalog/selection versions. `add_sense` confirms an existing-word sense proposal without a selection payload. A stale action returns 409. |

The allowlisted `GET /api/operator/vocabulary/intake/findings` lists the latest
100 redirected components and learner-confirmed shared sense additions.
`GET /api/vocabulary/word-collection` includes current `preparationStatus` for
stashed, unstudied words.

`/api/operator/vocabulary` provides allowlisted cases, drafts, preview, approval,
application, closure, and failed-work retries. Proposal mutations carry expected
versions; application requires exact approval and an idempotency key. See
[the implementation guide](vocabulary-learning.md) for content authority.

`POST /api/operator/vocabulary/proposals/:id/approval-requests` accepts
`{ expectedVersion, requestId, notes? }` and returns `202` with the persisted request
receipt. Authentication and request-shape checks run before acknowledgement;
proposal validation and application run in the background. Repeating the same
request ID and payload returns its existing receipt; conflicting reuse is rejected.
`GET /api/operator/vocabulary/approval-requests` returns `{ items }` with request
states `queued`, `running`, `succeeded`, or `attention`, retained errors, and
application receipts. `POST /api/operator/vocabulary/approval-requests/:id/retry`
accepts an empty body and requeues an attention request with the same identities.
The existing explicit preview, approve, and apply routes retain their contracts.

`GET /api/operator/vocabulary/no-proposal-cases` lists completed original
exercise-improvement judgments with no proposal and no operator closure; `?status=closed` lists closed reviews.
`POST /api/operator/vocabulary/cases/:id/second-opinions` accepts optional `notes`
and queues an advisory review of the retained no-change judgment. Case workspace
jobs expose the advisory status and result; the existing job retry and case close
routes apply. This path does not create or apply a content proposal.

`GET/PUT /api/operator/vocabulary/words/:id/sense-coverage` reads or edits shared
word selection. PUT requires `expectedVersion` and explicit `includedSenseIds`
(or compatible `excludedSenseIds`). An empty list explicitly selects none.
Responses include canonical senses, selection status and mapped production counts.
Historical case coverage is no longer an editable API.

### Sense/content reconciliation

The Needs attention matcher uses the routes below; queue discovery and grouped
child records come from `GET /api/operator/vocabulary/attention-queue`.
All routes below use `/api/operator/vocabulary/reconciliation` and require operator
authorization. Word IDs in paths are URL-encoded. The domain layer also enforces
operator authority; these routes do not authorize arbitrary sense mutations.

| Route | Contract |
| --- | --- |
| `GET /` | List words with divergent prepared teaching mappings or a saved resolution |
| `GET /:wordId` | Return retained source comparison, active senses, saved resolution, application plan and replacement progress |
| `POST /:wordId` | Save `{expectedVersion, status: "draft" \| "resolved", draft, refreshSource?}`; `expectedVersion` is null for a first save |
| `POST /:wordId/apply` | Apply `{expectedVersion, planFingerprint}`; exact replay returns the applied workspace |
| `POST /:wordId/retry` | Empty body; retry failed replacement work under unchanged applied authority |

The draft contains `defaultSenseIds`, per-use `{useId, decision, senseId, rationale}`
decisions, an overall `rationale`, and free-text `unsupportedChanges`. Decisions are
`map`, `reject`, or `unsupported`. Rationale strings may be empty; written reasons
are optional. Saving preserves linguistic work without changing
inventory, content eligibility, or provider demand. `refreshSource` explicitly
captures current evidence while retaining the submitted judgment for re-review.

The plan exposes a fingerprint, precise blockers, retained/retired content and
source/package IDs, and required replacement stages. Apply requires the resolved
version and unchanged dependency plan. The first handler preserves sense identities,
changes only nonempty defaults over existing active senses, and replaces affected
teaching. `replacementPracticeRequired` is false when every selected default sense
has at least one mapped teaching use; otherwise it requires full selected-scope
practice generation. Unsupported inventory changes remain blocked. Progress
distinguishes `not_required`, `pending`, `ready`, and `failed`, including stage errors.
Invalid input returns 400, unauthorized access 403, unknown words 404, and stale or
blocked application/retry 409. Internal failures return 500 without exposing internals.

`GET/PUT /api/operator/vocabulary/cases/:id/repair-target` reads or changes pending
single-exercise target intent. A selected sense requires reassessment; reset clears
pending intent. Application and manual editing enforce this intent server-side.
`POST /api/operator/vocabulary/proposals/:id/word-defaults-revision` accepts
`expectedVersion`, `expectedWordVersion`, and `includedSenseIds`. It atomically
saves word defaults and the repertoire selection, returning `{proposal, coverage}`.
Deselected exercises remain in proposal history for restoration. Newly selected
senses without retained exercises require generation; an empty result requires
dismissal or new generation. Conflicts leave both defaults and proposal unchanged.
`POST /api/operator/vocabulary/proposals/:id/word-defaults-reassessment` accepts
`expectedVersion`, `expectedWordVersion`, `expectedCaseVersion`,
`expectedContentVersion`, `includedSenseIds`, and `modelChoice`. It atomically saves
shared defaults, captures the exact nonempty selection and admits reassessment,
returning `{coverage, caseId, jobId, item}`. Admission conflicts roll back all writes.
Generation failures retain the saved defaults and original proposal. Success uses
the existing reassessment replacement flow; no content is automatically applied.
All routes require operator authority. Source content, mappings and catalog versions
remain approval/application checks; shared-default edits alone do not invalidate
captured generation results.

`POST /api/operator/vocabulary/cases/:id/reassessments` accepts `modelChoice`,
required `expectedContentVersion`, and optional `originProposal` with
`proposalId` and `expectedVersion`. It returns the canonical `caseId` and the new
`jobId`; the case identity does not change. The source version is pinned at
submission and a changed version requires operator confirmation. One queued or
running job is allowed per case. Reassessment freezes case review mutations
until termination; success selects the new assessment and supersedes the prior
current proposal, while failure preserves it. Historical proposals retain their
assessment-job provenance. Advisory opinions do not select a new authoritative
assessment. Workspaces expose `case.review` and each job's `caseSequence`,
separately from the provider retry `attemptNumber`. Source changes remain
conflicts rather than silently changing the requested assessment.

`POST /api/operator/vocabulary/cases/:id/pure-cue-resolutions` accepts `modelChoice`,
`expectedContentVersion` and `selections` of `{form, wordId}`. For a pending lexical
identity finding, it validates exact dictionary choices and queues a promotion-only
continuation with the retained referral and evidence. Source, mapping, catalog or
identity drift is a conflict. The returned `caseId` and `jobId` identify an
assessment, not approval or application. Case reads supply `pureCueIdentityOptions`.

Review batches include `currentSources` for all proposal evidence bases, including
create-only proposals. Batch and workspace `assessment` metadata attributes the
finalized contributing invocations and sense mapping, separately from proposal
authorship.

Proposal detail/list and case reads include `resolvedAt`: receipt application time
for applied proposals, latest closure event time for dismissed proposals or closed
cases, and `null` when unresolved or authoritative historical evidence is missing.
The operator Archive uses this timestamp for its 12-hour default; search covers
all retained entries. Proposal dismissal and completed no-change review closure
accept omitted or empty `reason`. Teaching and unresolved sense/promotion
assessment closures still require a nonempty resolution.

Single-word improvement results can include `pureCueReferral` (null or
`{candidateWords: string[], sharedPurpose: string, rationale: string}`) and a
`pureCuePromotion` assessment. Referral forms are advisory. Promotion records
`reject`, `reuse`, `extend`, `create`, or `needs_operator` when identities cannot
be resolved unambiguously. Creation and extension require complete teaching notes
and join any local edits in the existing reviewed proposal; there is no separate
automatic publication route.
The [implementation guide](vocabulary-learning.md) describes scope, retained
answers, and same-job stage reuse.

Existing pure-cue improvement uses a dedicated assessment with `extend`, `repair`,
or `explanation_only`. Extension preserves stimulus, axis and existing answers
while replacing the integrated teaching note; repair changes only the stimulus.
Both await operator application. Raw response evidence remains available when
lexical resolution is missing or ambiguous, but extension requires a uniquely
resolved ID from an effective rejected response. Learner feedback is independent.
Only general production encounters enter provider jobs; recognition and contrast
remain in session evidence and are excluded from provider feedback aggregation
and improvement dispatch.

`GET /api/operator/vocabulary/practice-preparation/failures` lists retained failed
authoring work. `POST /api/operator/vocabulary/practice-preparation/:id/retry`
queues an explicitly authorized retry within the attempt limit; worker gates
still govern provider execution. Work identifies either a teaching `sourceContentId`
or a `reconciliationId`; canonical reconciliation work has a null teaching source.

The operator practice-preparation failure response includes
`defaultSelectionFindings`: word-level unknown-default findings with `wordId`,
`hanzi`, nullable originating `caseId`, reason, recommended sense IDs and invocation
ID. The projection is read-only and independent of proposal/case completion. Saving
explicit word defaults, including `[]`, removes that word from the projection.


Mandarin legacy `/api/study-sessions/*` writes, legacy word completion/dismissal,
introduction open/complete, review-summary commits, learner proposal/application,
and old operator content-editor writes return `409 VOCABULARY_CUTOVER`.
Both methods of `/api/session-payload` are retired because even GET composed
and reserved work. Reload into the new client. The legacy study and reflection
route handlers themselves have been removed; this fence keeps the explicit 409
answer for stale clients.

## Content diagnostics

Content Bin uses this read-only API to inspect words, contrast clusters, and
durable word-owned production cues. The [frontend map](../SPECS/frontend-architecture-map.md#entry-and-navigation)
explains navigation between connected items.

| Method | Path | Handler domain |
| --- | --- | --- |
| GET | `/api/content-diagnostics?kind=word\|contrast_cluster\|production_cue&q=<query>&limit=50` | Read-only content projection |

The diagnostic query requires non-empty `q` input and applies the bound in SQL
before hydrating the selected records. It returns only the selected kind and a
`hasMore` signal; it does not read or count the corpus before a user query.
Word items include `latestBootstrapContent`: `{ createdAt, content }` for the
latest eligible [bootstrap document](word-content-representation.md#source-documents-and-teaching-packages),
ordered by creation time then content id, or `null` when none is available,
as well as cluster membership.

Word details separate the exercise cue from optional material shown after reveal:

- `productionTask` contains the task id and total/active durable cue counts for
  the current learner, or is `null` when the word has no production task.
- `productionCues` lists durable cues as `{ id, text, cueType, availabilityStatus }`,
  including inactive cues and cues without supplements. Use these identities to
  open cue details; a cue's presence in the list does not mean it can serve.
- `productionCueSupplements` contains post-reveal English frames, example
  sentences, and translations. Its `cueId` identifies the attached durable cue,
  or is `null` for a task-level meaning-derived supplement. That fallback
  supplement is not itself a durable cue.

The [response types](../src/domain/content-diagnostics.ts) define these fields.
Cluster items include members and prompts; durable production-cue items include
their anchor and accepted words, lifecycle state, provenance, and current evidence
projection.
It does not expose a content mutation path.

## Status

| Method | Path | Handler domain |
| --- | --- | --- |
| GET | `/api/status` | Config / health |

Home reads study time and progress from `GET /api/vocabulary/progress`.
The status response includes the active service banner (message, posting and
expiry times, and optional kickoff), or null when no notice is active.

The status payload also returns `dailyNewWordLimit` and
`unstudiedAdmissionSource`, the resolved settings used when composing a new
session. The [new-learner policy](../SPECS/diet-deck-distribution.md#25-new-user-defaults-and-retired-placement-intake)
defines their initial values. Update them with JSON bodies containing
`dailyNewWordLimit` as an integer from 0 through 20 or
`unstudiedAdmissionSource` as `"mixed"` or `"stash_only"`:

| Method | Path | Handler domain |
| --- | --- | --- |
| PATCH | `/api/learning-policy/daily-new-word-limit` | Config / learning policy |
| PATCH | `/api/learning-policy/unstudied-admission-source` | Config / learning policy |

Changing either setting does not rewrite the current study day's
completed-new-word count and does not mutate an already-started frontend
session.

The status payload also returns learner-private character preferences:
`characterPresentation`: `"simplified"` (default), `"traditional"`, or `"both"`,
and `sentenceCharacterPresentation`: `"simplified"` (default) or `"traditional"`.
Standalone session word labels use stored character fields; `"both"` renders
`simplified / traditional` when the forms differ. A missing or identical
traditional field is shown as the stored hanzi.

Sentences, examples, Chinese explanation text, and clozes on the main session
surfaces are converted for display. Simplified or Traditional card presentation
also determines the sentence script. With Both, sentences follow the separate
sentence preference; a revealed answer inserted into a sentence uses that one
script. The sentence preference is retained when changing the card setting.
Conversion preserves stored content and exact attempt evidence. See
[character presentation](../SPECS/character-presentation.md).

| Method | Path | Handler domain |
| --- | --- | --- |
| PATCH | `/api/learner-settings/character-presentation` | Learner settings |
| PATCH | `/api/learner-settings/sentence-character-presentation` | Learner settings |
| PATCH | `/api/learner-settings/daily-study-minutes` | Accept/return `{dailyStudyMinutes:10\|20\|30}`; read by timed sessions; status returns it with `timedSessions`; invalid values return 400 |
| PATCH | `/api/learner-settings/study-introduction-order` | Accept/return `{studyIntroductionOrder:"random"\|"first"\|"paced",studyIntroductionSpacing:number}`; atomically saves private order and integer spacing 1–10 (default 3); status returns both fields; existing boolean preferences map to Random/Introductions first; invalid values return 400 |

The first route accepts
`{ "characterPresentation": "simplified" | "traditional" | "both" }` and returns
that saved field. The second accepts
`{ "sentenceCharacterPresentation": "simplified" | "traditional" }` and returns
that saved field. Unsupported or missing values return `400`. Neither route
accepts a client-selected learner; writes use the authenticated learner context.

## Operator view

| Method | Path | Handler domain |
| --- | --- | --- |
| GET | `/api/operator/usage-pulse` | Operational cohort pulse |
| GET | `/api/operator/repertoire-quality?view=cues&page=1` | Repertoire authoring cohorts and paginated cues or repairs |
| GET | `/api/operator/repertoire-quality/detail?view=cues&id=…` | Exact cue or repair revision history |
| GET | `/api/operator/content-sharing?weekStart=YYYY-MM-DD` | Reconstructed UTC-week content reuse and bounded shared-content examples |
| GET | `/api/operator/model-invocations?from=YYYY-MM-DD&to=YYYY-MM-DD` | User-attributed model calls in an inclusive UTC date range |
| GET | `/api/operator/word-preparation/failures` | Shared preparation failures and attempt history |
| GET | `/api/operator/teaching-sets` | Shared teaching sets, retained package counts, and recorded preparation costs; unknown costs remain explicit |
| POST | `/api/operator/word-preparation/:workId/retry` | Retry paused work; empty `{}` body and operator actor audit |
| GET | `/api/operator/service-banner` | Current active banner |
| PUT | `/api/operator/service-banner` | Set a custom banner with `{ message, expiresAt? }` or a planned update with `{ kickoffAt }` |
| DELETE | `/api/operator/service-banner` | Clear the current banner |

Operator routes require the caller’s Clerk user id (or trusted-local learner id /
`trusted_local` sentinel) in `APP_OPERATOR_CLERK_USER_IDS`. An empty allowlist
fails closed with `403 OPERATOR_FORBIDDEN`. See the
[operator panel guide](operator-panel.md) for the bookmark-only UI and its
workflows.

`GET /api/operator/content-sharing` defaults to the current UTC week. Optional
`weekStart` must be a valid Monday date key no later than the current week;
malformed, repeated, or future values return `400`. The operator-only response
contains weekly exact-content reuse metrics, learner-originated cue reuse,
bounded examples, and current study-overlap context. It is read-only and
reconstructs historical weeks from available evidence. See
[sharing metric definitions](operator-panel.md#content-sharing) for counting
rules and coverage limits.

`GET /api/operator/usage-pulse` returns content-free cohort aggregates: live
`today` plus the last 7 completed UTC-day snapshots (`dau`, sessions, new words,
practice completed, review correct/wrong, mean stash, active session time,
inactive learners over seven days, and abandoned sessions). The
configured hosted smoke learner (`APP_SMOKE_CLERK_USER_ID`) is omitted from the
inactive-7d count. See [usage metric definitions](operator-panel.md#usage-metrics)
for units and historical availability.

The repertoire quality routes accept `view=cues` or `view=repairs`. Lists
require a one-based `page` and accept an optional `model=sol` or `model=luna`
for cues. The response carries aggregate counts, the snapshot capture time,
and up to 25 rows of the selected list. Details require the opaque `id` from a
list row and return `404` when it is absent from the current snapshot. Invalid
parameters return `400`. Both routes omit learner identifiers, responses, and
feedback text.

An operator request builds the initial snapshot in a worker with a read-only
database connection. After ten minutes, the next request starts a single
background refresh and serves the previous snapshot. Refresh failures retain
the last usable snapshot and allow a retry after one minute. If no snapshot
is available, the route returns `503`. See [repertoire quality metrics](operator-panel.md#repertoire-quality-metrics)
for evidence and counting rules.

`GET /api/operator/model-invocations` returns `{ rows }`: timestamp,
provider/model identifier, invocation type, learner identity and display name,
`initiator` (learner ID, `Operator`, or `Service`) and `initiatorDisplayName`,
`latencyMs`, status, USD spend, and its reported/estimated/unknown basis. Optional
dates are validated; omitting them returns the full ledger without silent
truncation. Unknown costs remain unknown and are counted separately.
The ledger records actual production transport attempts from this release onward,
including failed attempts. Latency covers the provider request through response
receipt, excluding later domain validation and persistence. A timeout records
`timed_out` with the configured request timeout as its latency. Other transport
failures record `failed` with measured latency. Invalid JSON, malformed responses,
truncation, or rejected schema/domain output record `invalid_response`; validation
may update an already `completed` call to this status without changing its cost or
latency. Completed still does not imply published model output. Historical calls
and unfinished calls have null latency; elapsed times are never invented. It
stores no prompts, answers, or response bodies. OpenRouter `usage.cost` takes
precedence over token-price estimates. Other current transports supply token usage
rather than per-request USD charges; estimates use pinned pricing snapshots.
Existing usage-pulse spend snapshots retain their reflection/intake scope. No
historical invocation rows or missing user attribution are fabricated.

Planned service updates accept `{ kickoffAt }`, an ISO timestamp with an explicit
time zone, normalized to UTC. Kickoff must be after posting; expiry is 24 hours
after kickoff. Do not combine kickoff with a custom message or expiry. The
response includes `kickoffAt` for planned updates; clients format the standard
notice in the viewer's browser zone. `message` supplies generic fallback text.
Custom and pre-existing notices omit `kickoffAt` and render their authored text.
Replacing a planned update with a custom notice clears its kickoff.

Custom service-banner messages are single-line text up to 280 characters.
Omitting `expiresAt` for a custom message uses the 24-hour default. `PUT` returns
`{ serviceBanner: { message, postedAt, expiresAt, kickoffAt? } }`; `GET` returns that shape or
`{ serviceBanner: null }`, and `DELETE` returns `{ status }` with `cleared` or
`noop`. Invalid messages, kickoff timestamps, or expiry timestamps return `400`. Writes use the
authenticated operator as the audit actor. Preparation retry preserves
successful earlier stages; ordinary learner requests do not reset exhausted
budgets.

## Words and meanings

| Method | Path | Handler domain |
| --- | --- | --- |
| GET | `/api/words/search` | `words` |
| GET | `/api/words/:id/meanings` | `words` |
| PATCH | `/api/words/:id/personal-notes` | `words` |
| PATCH | `/api/words/:id/user-priority` | `priority` |
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
`POST /api/priority/unstudied/add-by-hanzi` accepts `{ hanzi, requiredForNextSession?,
wordIds? }`. It trims the submitted text and combines exact `hanzi` matches with
matches on the punctuation-stripped Mandarin lookup key used by production
answers. Only unstudied words are eligible; alias lookup is not used. The backend
accepts only the Mandarin study profile; the French try-out profile is retired.

When multiple matches exist and `wordIds` is omitted, the handler returns
`{ needsSelection: true, query, matches }` without writing overlay rows so the
client can present a chooser. With one match and no `wordIds`, the handler adds
that match; an explicit nonempty `wordIds` subset selects the additions. Success
returns `{ addedCount, words }`. For a well-formed request, no matches returns 404.
If there are matches, an empty selection or IDs outside them returns 400.
See the [HTTP handler](../server/routes/words-routes.ts) for input validation and
response shapes.

## Diet profile

The [diet contract](../SPECS/diet-deck-distribution.md) defines profile
initialization and adjustment behavior. A profile response contains `version`,
`weights`, `provenance`, and `updatedAt`, with optional historical `intake`
evidence. Provenance actors are `learner-nudge`, `operator`, and historical
`intake` entries.

Operator jumps (100% weight on a chosen deck, provenance actor `operator`)
are performed with `scripts/set-diet-deck.ts`; there is no HTTP endpoint.

## Attention and What's New

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/whats-new` | Read shared published blog posts |
| GET | `/api/operator/whats-new` | Operator-only current posts including drafts |
| PUT | `/api/operator/whats-new` | Operator-only validated, revision-checked post save |
| GET | `/api/whats-new-attention` | Read per-post learner attention and active badge IDs without starting clocks |
| POST | `/api/whats-new-attention` | Record visible badge exposure or reading for a published-post snapshot |

### Attention badges

The learner Feedback badge reads `GET /api/vocabulary/feedback/attention`.
What’s New uses the per-post attention endpoints below.

### What’s New blog

`GET /api/whats-new` returns `{ posts: WhatsNewPost[] }` containing published
posts. Operator-only `GET /api/operator/whats-new` returns the same shape,
including drafts. `PUT /api/operator/whats-new` requires the existing operator
allowlist and accepts `WhatsNewWriteRequest`; success returns the saved
`WhatsNewPost`. The [shared types](../src/domain/whats-new.ts) define these
shapes, and the [operator command](whats-new.md#operator-command) shows a full
write-input example. Invalid content returns 400, stale revisions return 409,
and missing operator access returns 403. The write endpoint has a scoped 1 MiB
JSON limit to accommodate escaped content within the domain bounds.

`GET /api/whats-new-attention` returns the current learner's
`{ items, unseenPostIds, nextExpiryAt, serverNow }`, using the
[attention type](../src/domain/whats-new-attention.ts). Each item has `postId`,
nullable `firstBadgeSeenAt`, and nullable `readAt`. `unseenPostIds` contains
published posts that are unread and either never exposed in a visible badge or
still inside their own twelve-hour window. `nextExpiryAt`
is the earliest active expiry or null; `serverNow` permits clock-offset-aware
client expiry. Reading this endpoint changes no state.

`POST /api/whats-new-attention` accepts
`{ postIds: string[], kind: 'badge-seen' | 'read' }` and returns the same state.
The client submits the exact published-post IDs represented by the visible
aggregate badge or visible per-post markers, or the individual post opened for
reading. Each first timestamp is durable and idempotent. A new post receives
its own clock without extending an older one. Both operations use server UTC
time and only affect the signed-in learner. Missing/unknown fields, invalid
kinds, empty or duplicate IDs, more than 1000 IDs, and unknown or draft post
IDs return 400 without partial writes.
Existing legacy cursors retain acknowledged reads, with their parameter update
time used as `readAt`; a learner without a cursor starts with all published
posts eligible, however old their publication dates are.

## Client incidents

`POST /api/client-incidents` accepts an authenticated batch of 1–20 strictly
bounded `client_transport_incident.v1` records. The current schema accepts only
authentication or native-fetch failures from accepted-review and accepted-
contrast commit routes. A valid batch returns `204`; malformed records return
`400`. Upload is diagnostic-only and never retries or changes the associated
study commit. See [error logging and diagnostics](./ops/error-diagnostics.md#client-transport-incidents).

## Contrast clusters and intake (retired HTTP)

Contrast-cluster management routes (`/api/contrast-clusters*`,
`/api/contrast-prompts*`) and projected contrast-intake triage routes
(`/api/contrast-intake/*`) are retired. Cluster/prompt creation for study now
goes through reflection `create_contrast_cluster` application and persistence
primitives. The vestigial `contrast_candidate_intake` table and reader are
retired; pre-SWI-47 databases are no longer supported by current builds.

Domain column matches [server-db.md](./server-db.md) modules.

## Local introduction lab

These development-only routes require `APP_WORD_CONTENT_WORKBENCH=1`, dev mode,
trusted-local authentication, Mandarin, and a loopback client. The
[lab guide](word-introduction-lab.md) documents its isolated launch command.
They return local drafts, never publish study content or record learner progress.

| Route | Result |
| --- | --- |
| `GET /api/intro-lab/status` | Generation availability and configured model |
| `GET /api/intro-lab/drafts` | Saved immutable draft envelopes |
| `POST /api/intro-lab/bootstrap` | Generate and save content from lexical input |
| `POST /api/intro-lab/drafts/:id/teaching` | Generate and save a new draft with teaching pinned to the saved content |
| `POST /api/intro-lab/import` | Validate and save supplied content with optional teaching |

Bootstrap input is `{ hanzi, traditional, pinyin, guidance }`. Import input is
`{ content, teaching?, origin? }`, where origin is `sample` or `imported`.
Success returns the draft itself; failures return `{ error }`. Invalid output
is never archived, and teaching failure preserves its input bootstrap draft.

## Shared word introduction (Mandarin)

Mounted after authentication and maintenance controls. See
[serving word content](word-content-serving.md#private-association-api) for the
package-association mechanism and its separation from study progress.

| Method | Route | Effect |
| --- | --- | --- |
| POST | `/api/words/:wordId/introduction/open` | Exact packageId; privately pin an eligible ready package without generation |
| POST | `/api/words/:wordId/introduction/complete` | Exact packageId; private navigation marker only |

Preparation uses the stored lexical word through the reserve workflow and never pins a package.
Missing words return 404; unavailable/withdrawn sources return 409.
Opening and completing accept only `{ "packageId": "..." }`.

Review preparation is independent and requested after the first durable study
commit. Opening a lesson does not wait for, trigger, or retry review.
Automatic retries and operator recovery own failures; usable teaching and existing
review fallback remain available.

## Content quality

- `GET /api/operator/content-quality/ratings`: operator-allowlisted current
  non-null ratings ordered by last change plus the total count. Learner
  identifiers are omitted; the operator table applies its date window and
  snapshot aggregation to these rows.

See [content quality](content-quality.md) for supported target shapes and
interpretation; the shared wire types live in `src/domain/content-quality.ts`.

## Session debrief

Vocabulary session closure enqueues Connections atomically from its retained
server projection; callers do not supply an inventory. The first inventory and
learner interests snapshot remain immutable across retries. The retired
`POST /api/review-session-summaries` returns 409 without effects. Historical
Connections remain readable through the same endpoints.

Inventories with 0–14 eligible rows after the
[recent connection cooldown](../SPECS/session-debrief.md#recent-connection-cooldown)
are ready with zero notes and no provider attempt; 15–1000 eligible rows queue
generation. The exercise count records the admitted inventory before cooldown.
See the [Connections input contract](../SPECS/session-debrief.md#completion-and-input)
for encounter membership and the provider input bound.

| Method | Path | Response |
| --- | --- | --- |
| GET | `/api/session-debriefs/latest` | `{debrief}` for the latest completed debrief record, or null |
| GET | `/api/session-debriefs/:sessionId` | `{debrief}`, or 404 |
| POST | `/api/session-debriefs/:sessionId/retry` | `{debrief}` requeued from failed, or ready-empty for a failed inventory with fewer than 15 eligible rows; 404 for absent/private records, 409 for other states |
| PATCH | `/api/learner-settings/debrief-interests` | Accept/return `{debriefInterests:string}`; at most 1000 characters, empty allowed |

`GET /api/status` includes `debriefInterests` with an empty default. All routes
use server-derived identity. A debrief DTO contains `sessionId`, `completedAt`
(UTC), `exerciseCount` (inventory rows), `status` (`queued`, `running`, `ready`,
`failed`), `notes` (null until ready, including an empty ready array), `error`
(nullable learner-safe failure text), and `attemptCount`. Notes contain `text`,
exact input `refs`, and nullable `followUp`. No provider call is awaited by the
summary or retry endpoint. Interrupted attempts require explicit retry; queued
jobs resume after restart. See [the contract](../SPECS/session-debrief.md).
## Operator content improvement

Current review and application use `/api/operator/vocabulary`; see
[Adaptive vocabulary](#adaptive-vocabulary) and the
[operator workflow](operator-panel.md#content-improvement-workflow).
`/api/operator/content-improvements` retains authenticated operator GET access to
historical cases and evidence. Mandarin writes, including validation and closure,
return `409 VOCABULARY_CUTOVER`. GET `/`, `/:id` and `/:id/history` expose
retained cases and revision evidence; the [route implementation](../server/content-improvement-routes.ts)
defines their read shapes.

### Vocabulary word collection

`GET /api/vocabulary/word-collection` supplies the shared Words browser. Query
parameters are `view=recent|personal|deck`, `q`, comma-separated `mode` values,
`lapses=0|1`, `limit` (1–100), and nonnegative `offset`. It returns `words`,
`total`, `hasMore`, and `currentDeck`. Current vocabulary state owns modes and
enrollment; retained study history supplies compatible dates. Closed effective
responses respect Undo and exclude pure-cue responses from word lapse evidence.

### Vocabulary learner feedback inbox

`GET /api/vocabulary/feedback` returns owner-scoped `messages`, `jobs`, and
legacy-compatible `failures`. Messages include `subjectLabel`, `caseId`, body,
creation time and seen time. Jobs expose queued/running/failed status, subject
label, case identity, creation time and a learner-safe error. Completed jobs are
represented by their messages; operator proposals and provider diagnostics are
not included. `POST /api/vocabulary/feedback/:messageId/seen` marks only that
message read. The existing job retry endpoint requeues the selected failed item.

Feedback messages also expose nullable `dismissedAt`. Owner-only POST actions
`/api/vocabulary/feedback/:messageId/dismiss` and `/restore` are idempotent.
Dismissal excludes a message from unread attention without changing its body,
seen time, scheduling or content-improvement state. GET retains dismissed
messages for the learner’s history.

### Learner content reactions

| Method | Path | Response |
| --- | --- | --- |
| GET | `/api/content-reactions` | `{reactions}`: the learner's current Save / Not for me states |
| PUT | `/api/content-reactions` | Replace one subject's state from `{subject, reaction, reasons, note, surface}`; `reaction: null` clears. Returns `{reaction}` (null when cleared); 400 for invalid input, 404 for a note or lesson the learner does not own |
| GET | `/api/saved-collection` | `{connections, lessons}` for the Saved page |
| GET | `/api/operator/content-reactions` | Operator-only totals, reasons, connection rates by prompt and model, and items marked Wrong |

A subject is `{kind:'connection', sessionId, noteIndex}` or
`{kind:'lesson', messageId}`. Reasons apply only to `not_for_me`; a note only to
`saved`. The `tenuous_connection` reason is valid only for connection subjects;
a lesson request containing it returns 400. Surfaces are `home`, `feedback` and
`saved`. Input types and validation live in
[`src/domain/content-reactions.ts`](../src/domain/content-reactions.ts).

### Case review queue and history

`GET /api/operator/vocabulary/attention-queue` returns `{items,total,offset}`.
It accepts `offset` (nonnegative), `limit` (1–50, default 20), optional `anchorId`
for preserving selection during refresh, and optional `kind`: `defaults`,
`approval`, `preparation`, `dispatch`, `case`, or `reconciliation`. Each display item has a stable
`id`, title, reason, creation time, optional case identity, and type-specific
existing action identifiers. Eligibility and retry hints are derived from current
source records; mutations still enforce their own authority and version checks.
Reconciliation items use `id: "reconciliation:<wordId>"` and include `wordId`,
`sourceContentId`, `resolutionId`, decision `status`, replacement `progress`, and
`children`. Children identify a source or an explicitly related preparation
failure with `id`, `kind`, `sourceId`, nullable `sourceContentId`, optional
`reconciliationId`, `caseId`, `reason` and
`createdAt`. Counts and offsets apply after grouping. Unrelated same-word failures
remain separate. Completed resolutions and their covered preparation failures leave
active attention without deleting source records.
The read does not resolve work or enqueue provider calls. Full case and proposal
payloads are loaded only on drill-in through their existing endpoints.
Case items report `sourceSuperseded` when their assessed source is confirmed
changed or retired. `POST /api/operator/vocabulary/cases/:id/dismiss-superseded`
rechecks that condition and the absence of outstanding proposals in its write
transaction before resolving the case; it retains the job and case evidence.

`GET /api/operator/vocabulary/case-queue` returns a bounded display projection of
canonical improvement cases. Parameters are `view=review|history` (default
`review`), `limit` (1–50, default 20), and the opaque `cursor` returned by the
previous page. `direction=next|previous` defaults to `next`; `edge=first|last`
selects a queue end, preserving a supplied cursor's archive time window.
The response is `{items,nextCursor,previousCursor,anchorCursor,total,startIndex}`.
`total` counts the matching queue independently of the loaded page; `startIndex`
is its zero-based global offset. `anchorCursor` retains query/time context even
when a page has neither a previous nor a next page. Identity selection uses
keyset order in either direction; exact counts scan matching indexed identities,
without hydrating their evidence or proposal bodies. Review orders unresolved
cases by original creation time, then case ID, oldest first. Queued approvals and
approval failures stay out of that ready-review list; their operational status
is available through the existing attention endpoints. Teaching cases are reviewable before an assessment or proposal exists. Other
cases without a completed assessment or proposal remain in Needs attention when
no job is queued or running.

History orders resolved cases by resolution time and case ID, newest first.
Without `search`, it shows the last 12 hours; the cursor preserves that time
window across pages. A nonempty `search` spans retained history and searches case
and proposal IDs, word ID, Hanzi, Pinyin, proposal rationale, and original served
cue text. Search is literal (SQL wildcard characters have no special meaning),
at most 200 characters, and is only available for History. Cursors are bound to
their view and search query.

Each item contains case version/state, numbered current and active job identity,
the current proposal reference, readable served evidence (including nullable
`presentedAt`) and proposed changes,
the stored semantic axis for reused shared cues, model attribution, current source/version comparisons, and concise advisory
opinion status. These are display-only projections, not complete authored drafts.
Raw encounter snapshots, model requests/results, and full editing bodies are
omitted. `latestJob` retains the most recent job's status, sequence, advisory flag,
and error code while a failed reassessment retains its freeze; the previous
authoritative assessment remains displayed. `requiresDetails` means the authored material cannot be faithfully
reviewed through the compact card and needs the existing full workspace before
approval. `assessment` belongs to the displayed proposal; `currentAssessment`
identifies the case's authoritative judgment, which can differ for a retained
alternative. Up to 20 unresolved alternative references are included alongside
`alternativeCount`; the full workspace retains every alternative.

`GET /api/operator/vocabulary/case-queue/:id` refreshes one card. Optional
`proposalId` selects a retained proposal belonging to that canonical case without
changing the case's current selection. Existing case-workspace and proposal
detail routes provide complete editing and historical evidence on demand.

`POST /api/operator/vocabulary/case-queue/:id/resolve` takes a positive
`expectedVersion` and optional text `reason`, and returns the updated card.
Omitted, empty, and whitespace notes are accepted for teaching and unresolved
assessments as well as completed no-change judgments. Closure events retain the
operator-supplied `reason` separately from assessment outcome and source context.
`needsDecision` and `finding` describe the retained assessment, not a required
comment; `reassessment.reason` explains an ineligible current source.
This is the Done action for no-proposal or unresolved assessments; ordinary
proposal cards use the exact-version proposal dismissal route. Dismissing a
proposal resolves its case only when no unresolved alternatives remain.
`POST /api/operator/vocabulary/case-queue/:id/abandon-reassessment` takes the
positive `expectedVersion` and exact `jobId` of a failed or identity-paused
reassessment. It restores the preceding assessment, releases its review lock,
and retains the abandoned job as history. Stale versions, running jobs, and
already-abandoned jobs return a conflict.

`POST /api/operator/vocabulary/case-queue/:id/reassess` takes `expectedVersion`,
`expectedContentVersion`, `modelChoice`, and optional
`originProposal: {proposalId,expectedVersion,includeInAssessment?}`,
`editorial: {instructions,secondOpinionRequestId?}`, and
`responseIdentities: {options,selections}` for ambiguous responses, where
`options` is the displayed array of `{form,choices}` snapshots and `selections`
is an array of `{form,wordId}`. The single-card read supplies current options
for existing assessments and captured options for pending identity decisions.
The server checks the snapshots and selections against the current dictionary
before queuing; omitting choices queues a fresh assessment to refresh the
candidates. Set `originProposal.includeInAssessment` to `true` to include that
exact saved proposal revision as material for critique. Omission or `false`
keeps it out of a fresh assessment. A continuation retains direction, opinion
and proposal selections from the paused assessment, along with any new direction. Instructions are optional
text up to 10,000 characters. The selected second opinion must be successful and
belong to the displayed assessment or exact proposal version; the server captures
its result rather than trusting submitted opinion text. It returns
`{caseId,jobId,item}`.
Both compare the case review version atomically with the mutation: a stale card
returns 409 instead of acting on an unseen newer assessment. Existing proposal
approval continues to authorize an exact saved proposal version. All these
routes require operator authority; invalid queries return 400.

`GET /api/operator/vocabulary/case-queue/:id/fallback-repertoire` returns the
active sense inventory, default sense IDs, and published practice in the
fallback's scope. The POST route at the same path takes `expectedVersion`,
`expectedContentVersion`, `expectedCatalogVersion`, `expectedWordVersion`,
`senseIds`, and `modelChoice`. It queues a versioned generation request
and returns `{caseId,jobId,item}`. The requested senses apply to that job.

`POST /api/operator/vocabulary/case-queue/:id/notes` takes `expectedVersion`,
`requestId` (nonempty, at most 200 characters), and `text` (nonempty after
trimming, at most 10,000 characters). It returns the updated card with optional
`notes: [{noteId,text,createdAt,actorId}]`. New notes require an open editable
case. Replaying the same request identity, case, actor, and trimmed text returns
the current card without appending again; conflicting reuse returns 409. Notes
persist independently of assessment and closure, and do not become model input.
Cards also expose optional `activity` with up to 20 recent action commentaries:
`{activityId,action,text,createdAt,actorId,secondOpinionRequestId?,priorProposal?}`. Actions are
`done`, `dismiss`, `approve`, `reassess`, or `second_opinion`. `activityHasMore`
indicates older retained entries beyond this compact projection. Activity follows
canonical case lineage and includes nonempty operator commentary; reassessment
may also carry a selected opinion reference or `priorProposal: {proposalId,version}` without text.
Standalone notes remain in `notes` rather than appearing twice.

### Operator sense selection

Word defaults and pending repair targets have separate endpoints and lifecycles,
described in the operator vocabulary API above. Word
selection changes shared policy; repair intent stays pending until reassessment.
Neither operation applies proposed content. Invalid payloads return 400 and
version conflicts return 409.

### Exercise retirement proposals

Vocabulary content proposals support `retire` alongside `create`, `update_existing`
and `replace`. Retirement names the exact `sourceContentId`, `expectedVersion`,
access scope, rationale and compulsory comparison `content` snapshot. The server
retires the live active general production source without creating a successor.
Save, preview, exact-version approval and idempotent application use the same
proposal routes; retirement never writes repair intent or word defaults.

Operator case workspaces and proposal review-batch snapshots include nullable
`defaultSelectionFinding`: `status: needs_operator`, `reason`, `invocationId` and
`recommendedSenseIds`. It is read-only and returns null after any explicit shared
selection, including none. The finding does not block single-sense generation or
content approval. Practice-preparation failures expose prerequisite selection and
source-mapping findings; `retryable` is false while mappings need operator review
or a model-empty recommendation awaits a selection.
