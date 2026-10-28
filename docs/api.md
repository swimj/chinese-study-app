# HTTP API index

The [vocabulary product contract](../SPECS/vocabulary-learning.md) defines intended
behavior; the [architecture contract](../SPECS/vocabulary-architecture.md) defines
structural constraints. The [implementation guide](vocabulary-learning.md) explains
the current runtime. Earlier-runtime entries below support retained records and
compatibility; they do not reopen retired Mandarin write paths.

Routes are defined in [server/index.ts](../server/index.ts). Frontend client: [src/services/api.ts](../src/services/api.ts).

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
Preview and Start use the supplied time zone for the 4 a.m. local new-word
quota boundary. Older clients omitting it retain UTC calendar-day behavior.

| Method/path | Result or effect |
| --- | --- |
| `GET /session-preview` | Prospective ready item count, preparation status, and opaque sampling seed; accepts the browser IANA `timeZone` query parameter and queues bounded missing teaching preparation |
| `POST /sessions` | Compose ready work and return its first encounter; accepts the browser IANA `timeZone`; optional `previewSeed` reuses the preview's pure-cue sampling draw |
| `GET /sessions/:id` | Current owned projection and exact material |
| `POST /sessions/:id/next` | Select ready material; stable `clientActionId` retries |
| `POST /sessions/:id/commands` | Response, exercise reaction (v1 command `feedback`), skip, coverage, more, mode, Undo, resume, finish |
| `POST /sessions/:id/completion` | Freeze `throughSequence` after flush, with optional reported active duration |
| `GET /sessions/:id/completion` | Current completion and server deadline |
| `POST /sessions/:id/completion/cancel` | Cancel exact `completionId` before closure |
| `POST /sessions/:id/completion/close` | Apply exact completion idempotently |
| `GET /completion/current` | Pending/failed completion, without active-session restoration |
| `GET /words` | Owned words and current modes/schedule hints |
| `POST /words/:id`, `/mode`, `/refresh`, `/dismiss` | Explicit enrollment and word controls |
| `GET /feedback`, `/feedback/attention` | Read-only own lessons and lightweight attention |
| `GET /statistics` | UTC daily session/response/coverage totals, active-time availability, and current modes |
| `POST /feedback/:id/seen`, `/feedback/jobs/:id/retry` | Acknowledge lesson or explicitly retry own failed feedback |

`/api/operator/vocabulary` provides allowlisted cases, drafts, preview, approval,
application, closure, and failed-work retries. Proposal mutations carry expected
versions; application requires exact approval and an idempotency key. See
[the implementation guide](vocabulary-learning.md) for content authority.

`GET /api/operator/vocabulary/no-proposal-cases` lists completed original
exercise-improvement judgments with no proposal and no operator closure; `?status=closed` lists closed reviews.
`POST /api/operator/vocabulary/cases/:id/second-opinions` accepts optional `notes`
and queues an advisory review of the retained no-change judgment. Case workspace
jobs expose the advisory status and result; the existing job retry and case close
routes apply. This path does not create or apply a content proposal.

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
still govern provider execution.

Mandarin legacy `/api/study-sessions/*` writes, legacy word completion/dismissal,
introduction open/complete, review-summary commits, learner proposal/application,
and old operator content-editor writes return `409 VOCABULARY_CUTOVER`.
Both methods of `/api/session-payload` are retired because even GET composed
and reserved work. Reload into the new client. Historical read endpoints
below remain useful for retained records; they do not define the new study flow.

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
an unsuccessful last learning day after a prior successful learning day
(never-succeeded / just-graduated learning words excluded); omit or `0`/`false`
leaves that filter off.
The lapses predicate is independent of the selected stages. Results are ordered
learning (last study date descending, missing last), unstudied (pronunciation),
review (last study date descending, missing last), then word id. For
paged views, limit is 1–100; offset is a nonnegative integer.
Invalid parameters, including unknown status or lapses values, return 400. These legacy query semantics are distinct from the current
[vocabulary word collection](#vocabulary-word-collection).

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

The status payload also returns `serviceBanner`: `null`, or `{ message, postedAt, expiresAt, kickoffAt? }`
for the current unexpired operator-posted signed-in notice. Expired and cleared
notices are omitted. Operators can also read and manage the banner through the
operator API below.

The status payload also returns `dietDecksActive`: deck-based diet admission
is active when the Mandarin profile has a deck manifest. The former
`dietIntakeRequired` field has been removed.

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
| PATCH | `/api/learner-settings/study-new-words-first` | Accept/return `{studyNewWordsFirst:boolean}`; legacy private learner setting, default false; selects Introductions first when true and Random when false, retaining the saved spacing; also returned in status; invalid values return 400 |
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
| GET | `/api/operator/content-sharing?weekStart=YYYY-MM-DD` | Reconstructed UTC-week content reuse and bounded shared-content examples |
| GET | `/api/operator/model-invocations?from=YYYY-MM-DD&to=YYYY-MM-DD` | User-attributed model calls in an inclusive UTC date range |
| GET | `/api/operator/word-preparation/failures` | Shared preparation failures and attempt history |
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
practice completed, review correct/wrong, proposals accepted, mean stash, total
active session time, and sparse scenario counts). The
configured hosted smoke learner (`APP_SMOKE_CLERK_USER_ID`) is omitted from the
inactive-7d count. See [usage metric definitions](operator-panel.md#usage-metrics)
for units and historical availability.

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
`POST /api/priority/unstudied/add-by-hanzi` still exact-matches `hanzi`, then
for Mandarin also matches the punctuation-stripped lookup key used by
production answers, and adds every unstudied hit. French continues to use
exact plus alias lookup and ignores that key.

`POST /api/priority/unstudied/add-by-hanzi` accepts `{ hanzi, requiredForNextSession?,
wordIds? }`. Exact (and French alias) lookup still resolves unstudied matches.
When multiple matches exist and `wordIds` is omitted, the handler returns
`{ needsSelection: true, query, matches }` without writing overlay rows so the
client can present a chooser. A single match, or an explicit `wordIds` subset of
those matches, adds the selected rows and returns `{ addedCount, words }` as
before.

## Diet profile

The [diet contract](../SPECS/diet-deck-distribution.md) defines profile
initialization and adjustment behavior. A profile response contains `version`,
`weights`, `provenance`, and `updatedAt`, with optional historical `intake`
evidence. Provenance actors are `learner-nudge`, `operator`, and historical
`intake` entries.

| Method | Path | Handler domain |
| --- | --- | --- |
| POST | `/api/diet/nudge` | `diet-profile` |

`POST /api/diet/nudge` accepts `{ direction: 'easier' | 'harder' }` and shifts
a fixed internal weight quantum from the current max-weight deck toward the
adjacent deck (harder = successor by deck order, easier = predecessor),
renormalized, with provenance appended. It is clamped at the ends: a nudge
past the first/last deck is a no-op (`changed: false`, no provenance entry).
Returns `200` with `{ profile, changed }`; `400` for an invalid direction;
`409` when the deck manifest is unavailable on the installation.

The `/api/diet/intake` and `/api/diet/intake/assess` routes are retired.

Operator jumps (100% weight on a chosen deck, provenance actor `operator`)
are performed with `scripts/set-diet-deck.ts`; there is no HTTP endpoint.

## Session composition

The review bucket includes word-owned items and standalone pure-cue items
(`itemType: pure_cue_production`). Pure-cue items have a server-issued frozen
snapshot and no target word. Their admission is independent of word review;
fragile cues are due-date admitted and strong cues use proportional sampling.

`POST /api/study-sessions/:sessionId/pure-cue-assessments` accepts
`{ attemptId, snapshotId, sessionActionId, events, reinforcementSkipped? }`. Each event supplies
`eventId`, `occurredAt`, `response`, `outcome`, `submittedWordId`, and `rating`.
The server verifies outcomes against its saved snapshot and covering rules,
uses its own commit clock, and returns 204. An identical retry is idempotent;
conflicting evidence or a snapshot already consumed by another action is 400.
No member-word scheduler or admission state is changed.

Word-review completion accepts optional `commitIntent.reinforcementSkipped`;
pure-cue completion accepts optional top-level `reinforcementSkipped`. Both are
booleans and default to `false` when omitted. Only `true` allows a recorded lapse
with fewer than three subsequent consecutive successful recalls to complete.
`true` is rejected for clean or already-covered evidence; an unfinished batch
without it is rejected. Validation also applies to retries. These commits preserve
supplied attempts and ordinary lapse scheduling, add no successful recall, and
imply no compensation. Empty batches, inconsistent evidence, and events after
normal coverage remain invalid. The flag is a completion instruction, not a
separate stored attempt or scheduler state.

| Method | Path | Handler domain |
| --- | --- | --- |
| GET | `/api/session-payload` | Immediate composition from currently ready content |
| POST | `/api/session-payload` | `{ "studyDayKey": "YYYY-MM-DD" }`; bounded session-entry preparation and ready payload |

The session payload contains the three study-item buckets, admitting at most
1000 units in total, including standalone pure cues in review. Above that cap,
slots follow the live scheduler's 50/30/20 review/learning/unstudied weights,
redistributing unused slots from smaller buckets and retaining internal order.
Review production
items freeze their selected durable cue or meaning-derived fallback, the canonical
`{ wordId, hanzi, traditional }` rows whose ids define the accepted set used for
client grading, and nullable recheck-demand id. Unstudied membership is the
experimental dual-pool admitted set from
[`SPECS/study-action-model.md`](../SPECS/archive/study-action-model.md#experimental-dual-pool-unstudied-admission)
(mixed stash/diet split of remaining daily new-word quota, or stash-only when
that source is selected). Mandarin applies readiness within those pools without
a require bypass; legacy non-Mandarin selection remains unchanged. Entry waits
up to 30 seconds total, then may return fewer or no new words. Mandarin new-word
items include exact teaching/source snapshots; the active player does not fetch
or generate missing introductions. Quotas are computed before readiness filtering,
so temporary stash preparation delays do not transfer slots to diet.
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
| GET | `/api/session-completions/current` | `session-completion` |
| GET | `/api/study-sessions/:sessionId/completion` | `session-completion` |
| POST | `/api/study-sessions/:sessionId/completion` | `session-completion` |
| POST | `/api/study-sessions/:sessionId/completion/undo` | `session-completion` |
| POST | `/api/study-sessions/:sessionId/completion/close` | `session-completion` |
| POST | `/api/review-session-summaries` | `analytics` |
| POST | `/api/client-incidents` | `client diagnostics` |

Completion POST accepts the
[`StageSessionCompletionRequest`](../src/domain/session-completion.ts):
`revisionId`, canonical ISO UTC `startedAt`, UTC `studyDayKey`, `summary`,
`pendingCommit` (a deferred final action or null), and `reflectionEvidence`
(a supported evidence supplement or null). The summary requires canonical
`completedAt`, non-negative integer completion/failure counts and
`activeDurationMs`, and may include a learning count and exact debrief inventory.
Completion cannot precede start, and failure count cannot exceed completion
count. Final action validation uses the owning study persistence contract;
review, contrast, and pure-cue commits must match the route session.

Stage/read/cancel/close return `SessionCompletion`: session/revision IDs,
`status` (`pending`, `cancelled`, `closed`, or `failed`), `closeAt`, `serverNow`,
`completedAt`, `canUndo`, deterministic word `report`, and nullable `error`.
Staging previews the final action without accepting it and freezes a 15-second
server deadline. Repeating the exact revision preserves its deadline; changing
its input conflicts. Undo and close POST accept `{ revisionId }`. Undo cancels
only before expiry; close accepts the final action, summary, and generation work
atomically and can close early or retry failed closure. Repeated cancellation or
successful closure returns the saved result.

Current GET returns `{ completion: SessionCompletion | null }` for the learner's
pending/failed completion. Session GET returns its latest revision and may close
an overdue pending revision. Every operation is learner-scoped. Explicit input
errors return `400`, missing completion returns `404`, lifecycle or revision
conflicts return `409`, and persistence failures return `500`. Browser unload is
not required; server recovery closes acknowledged overdue completions. See the
[earlier completion contract](../SPECS/archive/session-progress-and-completion.md#session-completion).

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

The homepage exercise failure rate reads saved session totals and daily
compensation counters. New session-summary writes include word reviews and
standalone pure cues in the existing completion/failure fields: each exercise
counts once, with one failure if it lapsed even when reinforcement succeeds.
All exercise types use the summary's UTC completion day. Repeated summary writes
replace totals rather than incrementing them.

The legacy `reviewFailureRateDays` response field names describe these combined
exercise counts. `compensatedReviewActionSessions` reads a learner-private daily
counter incremented transactionally when a word-production or pure-cue scheduler
restoration first applies. Pending/unavailable restorations and already-restored
retries add nothing. Compensation-only days are included by UTC application date.
Daily/rolling failure-rate fields remain unadjusted; the homepage derives each
window's adjusted failure rate as
`max(0, sum(failures) - sum(compensations)) / sum(completions)` and compensation
rate as `sum(compensations) / sum(completions)`. Both rates are null without
completions; compensation counts remain visible and rates are not capped at
100%. No matching of source-failure dates is required.

Migration `0022_exercise_compensation_days` starts the compensation table empty.
There is no backfill: old summaries retain their word-only totals, and old
restorations are not counted. New restorations of old failures do count. This is
a forward-looking rough signal; rollout-spanning windows mix old and new coverage.

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

This section describes the retained earlier reflection API. Its historical
contract is
[`SPECS/archive/reflection-proposals-and-handles.md`](../SPECS/archive/reflection-proposals-and-handles.md).
Request/result types live in
[`src/domain/reflection-evidence.ts`](../src/domain/reflection-evidence.ts) and
[`src/domain/reflection.ts`](../src/domain/reflection.ts).

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/api/study-sessions/:sessionId/reflections` | Generate or return the session's initial reflection |
| POST | `/api/deferred-reflection-second-opinions` | Generate a selected deferred-item second opinion |
| GET | `/api/reflection-artifacts?review=open\|all` | Load the unresolved queue or recent history |
| GET | `/api/reflection-generation-runs` | Load the compact dogfood log of concluded provider attempts |
| POST | `/api/reflection-generation-runs/:runId/retry` | Retry a failed run from its saved bounded evidence bundle |
| GET | `/api/reflection-artifacts/:artifactId` | Load immutable evidence/result plus current proposal/application statuses |
| POST | `/api/reflection-proposals/:proposalId/review` | Defer, dismiss, reopen, or authorize one proposal |
| POST | `/api/reflection-invocations/:invocationId/withdraw-authorization` | Withdraw a pending or unsupported authorization |
| PUT | `/api/reflection-quality` | Upsert the tag set on one reflection item |
| DELETE | `/api/reflection-quality` | Clear quality tags for one reflection item |
| GET | `/api/reflection-quality-stats` | Aggregate dogfood quality rates by model arm |
| GET | `/api/attention-badges` | Unseen Help-queue count, durable reflection generation state, unseen failed generation-run ids, failed-run seen-through cursor, and What’s New read cursors |
| POST | `/api/reflection-inbox-seen` | Stamp one Help card as displayed |
| GET | `/api/whats-new` | Read shared published blog posts |
| GET | `/api/operator/whats-new` | Operator-only current posts including drafts |
| PUT | `/api/operator/whats-new` | Operator-only validated, revision-checked post save |
| POST | `/api/whats-new-seen-sequence` | Ensure or advance the What’s New publication sequence |
| GET | `/api/whats-new-attention` | Read per-post learner attention and active badge IDs without starting clocks |
| POST | `/api/whats-new-attention` | Record visible badge exposure or reading for a published-post snapshot |
| POST | `/api/whats-new-seen` | Ensure or advance the What’s New seen-through date |
| POST | `/api/failed-reflection-runs-seen` | Advance the failed-reflection-run seen-through timestamp |
| GET | `/api/reflection-help-inbox` | List open explanation-only Help inbox rows |
| DELETE | `/api/reflection-help-inbox` | Mark one explanation-only Help item Done by deleting its inbox row |
| POST | `/api/reflection-help-inbox/defer` | Move one explanation-only Help item into second-opinion staging |
| POST | `/api/reflection-artifacts/:artifactId/items/:itemId/manual-invocations` | Authorize a registered operation against an explanation-only item |

### Generate

The request body is a `SessionReflectionEvidenceSupplementV1` or V2 object
itself, not a wrapper. It contains qualifying review-production
items, including the cue as shown, nullable raw response, complete ordered ids
of the accepted attempt batch, and the optional V2 learner-request marker. The
backend uses those ids only to validate durable session/action identity, then
enriches each into a canonical V4 `production_mistake` bundle item without
attempt rows, attempt summaries, or production-management metadata. V4 keeps
the exact nullable post-reveal supplement separate from the pre-reveal cue;
new staged generation materializes the current V10 result contract. The items
array may be empty for a pure-cue-only session: the server reconstructs eligible
pure-cue first responses from durable assessments and invokes the independent
pure-cue provider flow. Either call can succeed if the other fails.

A successful response is exactly:

```ts
{
  artifactId: string;
  proposalCount: number;
  status: 'created' | 'existing';
  additionalArtifactIds?: string[];
  partialFailure?: string;
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
{
  runs: ReflectionGenerationRunDto[];
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

The reflection service has a backend-only comparison-arm registry. Initial
bundles with at most 10 included items sample GLM-5.3 Flash high at 70% and
GPT-5.6 Luna high at 30%. Larger bundles sample GPT-6 Sol high at 60%, GLM at
20%, and Luna at 20%. Ordinary and pure-cue bundles are routed independently
using their actual item counts. Explicit choices and manual second opinions
do not use these weights. Terra, GLM Flash max, and Gemini remain registered
but are withdrawn from the default pool and learner-facing pickers. OpenRouter
arms require `OPENROUTER_API_KEY` and use OpenRouter's normal eligible-provider routing;
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
configured comparison arm return `409`. An explicit current model may
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
items still open in Help, plus `deferredHelpInbox` for explanation items staged
for a second opinion.

`GET /api/reflection-help-inbox` returns `{ entries }` for every still-open
explanation item. Success returns `200` with:

```ts
type ReflectionHelpInboxEntry = {
  inboxId: string;
  artifactId: string;
  itemId: string;
  openedAt: string;
  disposition: 'open' | 'deferred' | 'requested_second_opinion';
};
```

`DELETE /api/reflection-help-inbox` accepts `{ artifactId, itemId }` and
removes that item from Help. Success returns `200` with `{ done: true }` when
an open or deferred row existed (same end state: gone from Help and from
second-opinion staging) or `{ done: false }` when none did. Terminal
`requested_second_opinion` rows are not deleted. Missing artifact/item still
return `404`. There is no learner-facing undo.

Done leaves the artifact body unchanged, so By session and raw artifact reads
still show the item.

`POST /api/reflection-help-inbox/defer` accepts `{ artifactId, itemId }` and
returns `{ deferred: true }` when an open row moved to second-opinion staging.
The second-opinion request accepts `helpInboxIds` alongside `proposalIds`.

### Attention badges

`GET /api/attention-badges` returns the cheap nav-badge payload:

```ts
{
  reflectionUnseenCount: number;
  reflectionGenerating: boolean;
  failedReflectionRunIds: string[];
  failedReflectionRunsSeenThroughAt: string | null;
  whatsNewSeenThroughDate: string | null;
  whatsNewSeenThroughSequence: number | null;
}
```

`reflectionUnseenCount` is pending Help proposals plus open explanation-only
inbox rows whose `inbox_seen_at` is still null. It is not the Help queue length.
`reflectionGenerating` is true when this learner has a queued or running durable
post-session reflection dispatch, including after browser navigation or reload.
It becomes false for succeeded, skipped, or failed dispatches. The client uses it
for the Reflections spinner; it does not count artifacts or pending proposals.
`failedReflectionRunIds` are concluded generation runs whose durable `state` is
`failed` and whose `completed_at` is later than the learner’s stored
seen-through timestamp, newest completion first. A null cursor means every
failed run is unseen. The client hides both Reflections markers while that tab
is current and gives the failure marker priority over the count. Opening Run
meta durably acknowledges currently failed runs. `failedReflectionRunsSeenThroughAt`
is that ISO-8601 UTC cursor in `learner_params`
(`failed_reflection_runs_seen_through_at`), or null if it has never been
written.

The What’s New cursor fields follow the
[blog's unread-update contract](whats-new.md#unread-updates).

`POST /api/reflection-inbox-seen` accepts one of:

```ts
| { kind: 'proposal'; proposalId: string }
| { kind: 'explanation'; artifactId: string; itemId: string }
```

It stamps `inbox_seen_at` once and returns `{ marked, reflectionUnseenCount }`.
Missing proposals return `404`. A missing explanation inbox row is a no-op
`200` so Done races do not fail the pager.

`POST /api/failed-reflection-runs-seen` accepts `{}` or `{ seenThroughAt }`
where `seenThroughAt` is an ISO-8601 UTC timestamp. An empty body uses the
server clock. Success advances the cursor monotonically and returns
`{ failedReflectionRunIds, failedReflectionRunsSeenThroughAt }`, where the ids
are the remaining unseen failed runs.

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

The compatibility `POST /api/whats-new-seen-sequence` accepts
`{ throughSequence: number, mode: 'ensure' | 'seen' }` and returns
`{ whatsNewSeenThroughSequence: number }`. An invalid mode, negative/noninteger
sequence, or sequence beyond publication history returns 400.
The retained `POST /api/whats-new-seen` accepts
`{ throughDate: string, mode: 'ensure' | 'seen' }`, where the date is
`YYYY-MM-DD`, and returns `{ whatsNewSeenThroughDate: string }`.
The [blog contract](whats-new.md#unread-updates) explains acknowledgement,
initialization, and compatibility behavior.

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

- `POST /api/content-quality/encounters`, body `{target, encounterId}`: record an
  idempotent visible-content encounter and return `{contentKey, rating}` for the
  authenticated learner. References are validated against accessible content.
- `PUT /api/content-quality/ratings`, body `{contentKey, rating}`: set `up`,
  `down`, or `null` to clear the learner's standing vote; requires a prior own
  encounter. This does not modify study or content state.
- `GET /api/operator/content-quality`: operator-allowlisted aggregate triage.
  Optional `kind`, `since`, `until` (inclusive UTC dates), `limit`, and `offset`
  select an exposure cohort with current standing votes. Returns full-filter
  totals and paginated exact-content snapshots without learner identifiers.
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
### Session recovery highlights

`GET /api/study-sessions/:sessionId/recovery-highlights` returns `{ highlights }` for a learner-owned completed summary. Missing, unfinished, and other-learner sessions return `404`; empty IDs return `400`. This independent read uses accepted attempts and currently applied corrections; it does not generate reflection or alter scheduling. See [the feature contract](../SPECS/session-recovery-highlights.md) for thresholds and evidence references.

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
