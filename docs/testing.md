# Testing map

Run full suite: `npm test` (Node test runner, `tests/*.test.ts`).

## Coverage retained across the vocabulary cutover

Legacy tests remain in the top-level test glob, but a legacy-only test does not
establish coverage of the new Mandarin path. Preserve shared semantic cases at
the common policy/component boundary, and exercise new persistence adapters
separately. Changed lifecycle rules are not forced through legacy controllers.

| Shared or adapted boundary | Coverage |
| --- | --- |
| Review interval/ease and urgency/ranking | `review-policy.test.ts` plus old `study-actions` / `session-composition` tests and new `vocabulary-selected-skill-scheduling` / `vocabulary-composition` tests |
| Physical bracket reactions and event guards | `content-quality-keyboard.test.ts`, `vocabulary-keyboard.test.ts`; Chinese punctuation vectors exercise both resolvers |
| Home start, card inbox chrome, summary disclosures, deadline | Existing Home/completion tests, vocabulary Home/completion tests, and `shared-inbox-chrome.test.ts` |
| Words collections and shared page | `my-words-page.test.ts`, legacy `my-words.test.ts`, and `vocabulary-words.test.ts`; vocabulary mode authority requires the new adapter suite |
| Preparation-wide outage classification and pause | `preparation-provider-failure.test.ts`, old `word-preparation-worker.test.ts`, new `vocabulary-preparation.test.ts`; item budgets and running sibling publication remain separate |
| Pure-cue stimulus repair | Old repair tests and `vocabulary-pure-cue-improvement.test.ts` use the shared nonempty/changed/trimmed stimulus invariant |
| Pure-cue proxy admission | `production-proxy.test.ts` and `vocabulary-import.test.ts` run shared cases through the common policy and both storage adapters; `pure-cues.test.ts` exercises the legacy composer; `vocabulary-composition.test.ts` covers current content eligibility and `vocabulary-study.test.ts` covers preview/Start and persisted fallback serving |
| Durable completion and proposal receipts | `vocabulary-session-persistence.test.ts` and `vocabulary-reflection.test.ts` include pending/approved and applied database-reopen cases with idempotent replay |

When replacing an admission path, inventory its eligibility gates as well as its
ranking and schedule calculations. For each preserved gate, identify the owning
contract, the old behavioral test, and an assertion through the replacement
selector or controller. Derived content policies need populated-content fixtures;
copied schedule fields alone cannot establish admission equivalence. In particular,
the proxy migration tests compare legacy adapters with new selection, while the
legacy composer test separately covers their old orchestration. A passing legacy
suite is not evidence that the new path invokes those gates.

Do not infer full hook or browser coverage from shared chrome tests. The old and
new completion protocols, feedback selection identities and content application
models remain separate. Manual browser fixtures still cover their interaction
wiring; full automated mounted-controller/fetch-race coverage is not implied.

## Browser regression checks


### Comparing a replacement UI with the earlier app

For vocabulary UI parity work, boot the pre-cutover application as well as the
current application. Record the baseline commit, run each against its own
version-compatible disposable fixture, and keep provider work disabled. Never
point the earlier server at a current or valued database.

Capture matching viewport screenshots for normal Home, expanded Connections,
collapsed Connections, and Session Settings, plus each changed study interaction.
Match updates visibility and fixture content before comparing layout. Check the
Start card's ready count in both normal and compact states, loading/empty states,
settings controls, keyboard order, and scrolling at narrow/enlarged sizes.
Compare the screenshots directly: a test/build pass or a newly written snapshot
is not evidence that an omitted control was intentional. Record intended model
changes separately from regressions and unresolved differences; fix regressions
before declaring parity. Keep the screenshots and baseline identity with the
review evidence so the next iteration can use the same comparison.


### Current browser fixtures

`/tests/browser/service-access.html` exercises the real service-access boundary
with mocked API responses. Use `?restricted` to verify the study app never mounts
for a restricted learner; `?restricted&compact` renders the boundary in a 380px
container with enlarged text. Restrict an already-open app, issue a learner
request, and inspect lifecycle counts to verify it unmounts. Reopen and retry,
then restrict and switch to operator to verify access is rechecked for the new
account. The HTTP gate, no-bootstrap probe, migration preservation, and stale
account response fencing are covered by `operator-only-access.test.ts`,
`schema-migrations.test.ts`, and `service-access-client.test.ts`.

The current Mandarin flow uses `/tests/browser/vocabulary-controller.html`
(and `?mode=undo`) to exercise cancellation and delayed acknowledgements through
the real hook. `/tests/browser/vocabulary-recognition-motion.html` uses the real
controller and card surface: reveal, then Correct or Forgot. Its PASS result checks
that the rating is saved and the outgoing card reflects the acknowledged recall
before requesting the successor. `?covered=1` checks the covered card's rightward
departure; `?retry=1` fails the first save so Retry save must retain the departure.
`/tests/browser/vocabulary-ui.html` provides presentation scenarios;
`/tests/browser/vocabulary-operator.html` exercises the proposal-first internal review surface (ready suggestions, history, manual edits, and `?second=pending|failed|result`; `?narrow=1&large=1` checks compact enlarged-text layout)
with intercepted HTTP (`?empty=1` for empty lists). These fixtures are separate
from `npm test`. The separate `/tests/browser/vocabulary-operator-production.html`
preview reads a locally installed sanitized excerpt from
`tests/browser/.local/operator-production-preview.json` (gitignored). It replays
historical proposals with their original acceptance/application provenance;
actions only mutate browser memory, not production. Missing excerpts produce an
explicit error. Keep retrieved records out of source control and distinguish
legacy operation schema versions from local proposal revisions. Use the [disposable vocabulary fixture](vocabulary-learning.md#conversion-and-local-verification)
for end-to-end study against the actual API and SQLite. The older session fixtures
below retain coverage of the previous controller, not the current Mandarin path.

`/tests/browser/bootstrap-reveal.html` checks the shared bootstrap teaching
reveal with the actual session controller. Use `?recognition=1` for recognition,
`?frozen=1` for the frozen production correction, and the default for accepted
definition production. It supplies long labels/examples and legacy fallback
content to verify bootstrap precedence, keyboard progression, and reference
wrapping. `bootstrap-reveal-serving.test.ts` checks source eligibility and exact
snapshots without provider calls.

With `npm run dev:frontend` running, open
`/tests/browser/final-reinforcement.html` on the Vite server. This isolated fixture
intercepts all HTTP and exercises the real session controller, HomePage, and
completion screen and retained final answer. It reports PASS after verifying that the final correct
production reinforcement fills all three boxes, Undo restores two, skipping a
revealed reinforcement keeps two, and a subsequent correct retry fills three.
It leaves the completion screen visible for visual inspection. These browser
assertions are separate from `npm test`; server rendering cannot exercise the
retained card's layout-effect lifecycle.

The isolated `/tests/browser/session-completion.html` fixture exercises the real
completion hook and panel against intercepted HTTP with shortened deadlines. It
checks acknowledgement failure and retry with one revision, final Undo,
automatic return, keeping the summary open through backend closure, explicit
return, and Home after remount without restoring the pending completion view. Use `?preview=1` for visual inspection,
`large=1` for enlarged text, and `empty=1` for empty report groups. The fixture verifies browser state;
`durable-session-completion.test.ts` verifies persistence and server expiry.

The isolated `/tests/browser/content-feedback.html` fixture exercises the real
session controller and content-rating buttons: negative-rating feedback requests,
independent explicit requests, clear/switch behavior, failed saves, durable attempt
links, deduplication, and delayed-save navigation. It leaves a production card
visible after PASS; `?preview=1` opens that card directly for layout inspection.
Use `?fallback=1` to run the same checks on definition fallback production,
including the frozen post-answer card. Combine it with `preview=1` and
`large-text=1` to inspect fallback controls at 125% text size.
All HTTP is intercepted, so these fixtures do not modify learner data.

## By domain

| Test file | Domain | Imports |
| --- | --- | --- |
| `vocabulary-session*.test.ts`, `vocabulary-study*.test.ts`, `vocabulary-composition.test.ts` | Commands, independent skills, coverage, exact evidence, retry, closure, and bounded selection | Pure reducer + temporary SQLite + HTTP boundaries |
| `vocabulary-content.test.ts`, `vocabulary-import.test.ts`, `vocabulary-cutover.test.ts` | Identity/history, teaching bindings, legacy conversion and cutover refusal | Temporary SQLite |
| `vocabulary-reflection*.test.ts`, `vocabulary-processing.test.ts`, `vocabulary-preparation.test.ts` | Private feedback, manual authority, worker fencing, compensation and generation retry | Temporary SQLite + injected providers |
| `vocabulary-sense-readiness.test.ts`, `vocabulary-improvement-admission.test.ts`, `vocabulary-pure-cue-promotion.test.ts`, `vocabulary-pure-cue-improvement.test.ts` | Sense admission, local repair/repertoire routing, pure-cue promotion and review, teaching-note preservation, production-only provider eligibility, retained stages and stale evidence fences | Temporary SQLite + injected providers; linguistic eval seams in [prompt README](../server/vocabulary/reflection-prompts/README.md#local-evaluation-seams) |
| `vocabulary-prompt-experiments.test.ts` | Retained experimental inputs/outputs and structural validation | Offline archive; no paid calls |
| `word-content-lab-provider.test.ts` | Real request shape, strict teaching output, truncation and malformed output | Provider with injected fetch |
| `word-content-lab-service.test.ts` | Two-stage local generation, immutable archive, exact references, invalid output and identity conflicts | Injected lab provider + temporary draft archive |
| `word-content-lab-api.test.ts` | Local opt-in, host/origin gates, route response contracts | Express lab router |
| `introduction-player.test.ts` | Paced navigation, rehearsal matching, retry/finish, IME and keyboard guards | Pure local player |
| `new-learner-preview.test.ts` | Fresh learner setup, existing-data protection, reset-link output, and welcome-only browser marker reset | Preview command + temporary SQLite |
| `ui-annotation-fixtures.test.ts` | Fresh annotation setup, relative UTC dates, prepared stash/learning/review serving, Home content, and existing-data protection | Fixture command + temporary SQLite |
| `vocabulary-session-fixtures.test.ts` | Full 12-word vocabulary composition, Solidify threshold range, persisted prior override, and summary choice through real finalization | Fresh fixture command + temporary SQLite |
| `session-composition.test.ts` | Session payload / scheduling composition | Dynamic `server/db.ts` |
| `diet-intake-placement-api.test.ts` | Retired placement endpoints and removed intake status gate | `server/index.ts` registered routes + temporary SQLite |
| `diet-profile.test.ts` | Default diet selection, profile round-trip, nudge/jump behavior, and historical intake compatibility | `server/db/diet-profile.ts` + temporary SQLite |
| `unstudied-admission.test.ts` | Experimental dual-pool unstudied admission selector, including stash-only source | `server/db/unstudied-admission.ts` |
| `session-completion.test.ts` | Session completion commits | Dynamic `server/db.ts` |
| `durable-session-completion.test.ts` | Fixed deadline, cancel/expiry, atomic final acceptance, outcome reporting, restart, and durable reflection dispatch | Completion persistence + worker with temporary SQLite |
| `session-completion-panel.test.ts` | Saving, pending and confirmed completion report, controls and character presentation | Completion panel server render |
| `session-bucket-scheduler.test.ts` | Bucket ordering helpers | `src/domain/study-actions.ts` |
| `session-bucket-state.test.ts` | In-session bucket state | `src/domain/study-actions.ts` |
| `session-selectors.test.ts` | Session UI selectors | `src/features/session/session-selectors.ts` |
| `card-characters.test.ts` | Study-card simplified/traditional character formatting | `src/domain/card-characters.ts` |
| `sentence-characters.test.ts` | Script conversion, Taiwan variants, comparison preservation, and contextual cloze alignment | OpenCC + sentence display helpers |
| `sentence-character-settings.test.ts` | Private sentence preferences, retention, status, and HTTP validation | Temporary SQLite + Express app |
| `session-character-settings-panel.test.ts` | Conditional sentence selector and remembered script | Settings panel server render |
| `cloze-prompt.test.ts` | Display normalization of manual blank markers, reveal, and ambiguous-text fallback | `ClozePrompt.tsx` server render |
| `session-keyboard.test.ts` | Session action/shortcut mapping, empty-answer No clue guards, rating labels, Undo aliases | `src/features/session/session-keyboard.ts` |
| `study-actions.test.ts` | Study action adapters / event derivation | `src/domain/study-actions.ts` |
| `study-attempt-events.test.ts` | Attempt event persistence | Dynamic `server/db.ts` |
| `study-management.test.ts` | Suppress / bad-prompt / management actions | Dynamic `server/db.ts` |
| `study-scheduler-state.test.ts` | Scheduler invariants | Dynamic `server/db.ts` |
| `contrast-content.test.ts` | Contrast clusters and prompts | Dynamic `server/db.ts` |
| `reflection-domain.test.ts` | V3 result/operation validation, registry, exact/revised classification, lifecycle transitions | `src/domain/reflection.ts` |
| `reflection-evidence-validation.test.ts` | Strict supplement/full-bundle shapes, validation-only attempt links, retired attempt/management metadata rejection, and initial-milestone evidence boundary | `src/domain/reflection-evidence.ts` |
| `session-reflection-evidence.test.ts` | Raw production response persistence, evidence accumulation, accepted-attempt links, Undo/drop behavior | Session state + `session-reflection-evidence.ts` |
| `reflection-evidence-enrichment.test.ts` | Completed-session/attempt verification, managed-action exclusion, read-only durable context enrichment, and stable fifty-item initial cap | `server/reflection/evidence.ts` with temporary SQLite fixtures |
| `reflection-provider.test.ts` | Pinned Luna request, lazy credentials, production prompt, strict output validation, sanitized failures, and retained truncation metadata | `server/reflection/luna-provider.ts` with injected fetch |
| `reflection-generation.test.ts` | Prelookup idempotency, provider/materialization/run metadata, included/eligible counts, in-process coalescing, exact saved-bundle failure retry, spend-cap Luna routing | `server/reflection/generation.ts` with injected dependencies |
| `reflection-generation-isolation.test.ts` | Real enrichment/provider failures preserve completed session, summary, and attempt state while recording available run usage | Reflection generation stack + temporary SQLite |
| `reflection-run-pricing.test.ts` | Pinned token-category pricing math, partial usage handling, and unknown-rate unavailability | `server/reflection/run-pricing.ts` |
| `reflection-spend-cap.test.ts` | UTC-day $0.50 reflection spend cap, Luna-only routing threshold, and explicit-model refusal | `server/reflection/spend-cap.ts` |
| `reflection-store.test.ts` | Seven-table schema, session-backed and sessionless provenance, retained failed-run bundles/retryability, immutable run-price reconstruction, atomic artifact/review persistence, queue/detail, review/invocation lifecycle | Dynamic `server/db.ts` |
| `reflection-application.test.ts` | Suppression/contrast/cue adapters, effect attribution, application outcomes, and requested-correct reflection through generation, acceptance, and application | Dynamic `server/db.ts`, real provider with mocked transport |
| `reflection-persistence-reload.test.ts` | Queue/detail/review/application/effect reconstruction across fresh Node processes | Shared temporary `APP_DATA_DIR` |
| `reflection-api.test.ts` | Generation statuses/errors, queue/detail, compact generation run log/retry, strict independent proposal review, quality tag upsert/stats, Help inbox Done, attention badges, durable failed-run acknowledgement, explanation-only manual authorization, apply/withdraw, startup recovery | `server/index.ts` registered Express route handlers + temporary SQLite |
| `reflection-quality.test.ts` | Item quality tag-set upsert, multi-tag coexistence, model-arm disposition + tag stats | `server/db/reflection-quality.ts` + temporary SQLite |
| `reflection-help-inbox.test.ts` | Explanation-only Help inbox seed at materialize, Done delete, manual authorization, independence from proposal disposition, 404 | `server/db/reflection-help-inbox.ts` + temporary SQLite |
| `whats-new-blog.test.ts` | Migration/seeding, authored preview backfill and preserved revisions, atomic revisions, draft visibility, publication ordering, live connection updates, input bounds and legacy sequence attention | Temporary SQLite + shared parser |
| `whats-new-api.test.ts` | Published feed, operator permissions, invalid writes, stale revisions and sequence endpoint | Express app + temporary SQLite |
| `whats-new-attention.test.ts` | Per-post badge exposure/expiry and reads, legacy cursor preservation, learner isolation, exact snapshots, restart/concurrent connections, migration preservation and schema equivalence | Temporary SQLite + fresh Node processes |
| `whats-new-command.test.ts` | Live command writes, actor history, conflict rejection, missing targets, old schema refusal and no bootstrap | CLI subprocess + temporary SQLite |
| `whats-new-frontend.test.ts` | Independent expiry windows, foreground/viewport exposure, safe previews and full-text rendering, unloaded-feed acknowledgement | Pure selectors + visibility observer + React server render |
| `attention-badges.test.ts` | Unseen Help count, sticky `inbox_seen_at`, dismiss/reopen, durable failed-run seen-through cursor, What’s New cursor | `server/db/attention.ts` + temporary SQLite |
| `reflection-attention.test.ts` | Reflections nav badge hiding, failure-over-count priority, and failed-run seen-through comparison | `src/features/attention/reflection-attention.ts` |
| `session-debrief-cooldown.test.ts` | Two-session rolling 72-hour cooldown, distinct-session counting, learner isolation, exact expiry, frozen retries, alternatives and all-filtered completion | `server/db/session-debrief.ts` |
| `session-debrief-inventory.test.ts` | Covered-only frozen inventory, actual contrast target, one-row purecue alternatives, pronunciation absence, Undo | `session-summary.ts` + session state machine |
| `session-debrief-loader.test.ts` | Pending-only polling, request abort/fencing, retry races and lost response recovery | `session-debrief-loader.ts` |
| `home-connections.test.ts` | Completed-session presentation preferences, deferred ready introduction, exact previews, bounded ring navigation, arrow-key guards, loop cue, waiting/failure/empty states | Home connections state/keyboard models + server-rendered component |
| `session-debrief-ui.test.ts` | Exact stepped text, empty/loading/failure, safe keyboard navigation, blank optional interests and French exclusion | Debrief card and settings server render + keyboard model |
| `session-finalization.test.ts` | Explicit summary-entry boundary, commit-before-summary ordering, reflection isolation/retry and stale-response guards | `session-finalization.ts` |
| `reflection-page-model.test.ts` | Item/proposal grouping, help-queue cards from Help inbox membership, deep draft edits for four operations, support and validation presentation | `reflection-page-model.ts` |
| `reflection-operation-editor.test.ts` | Compact V2 cue-change list, hidden restated Hanzi field, and accepted-word chips | `ReflectionOperationEditor.tsx` |
| `reflections-page-run-log.test.ts` | Empty, unavailable-cost, priced run-log, and Luna-only spend-cap selector rendering | `ReflectionsPage.tsx` server render |
| `llm-provider-runner.test.ts` | Spike compatibility shims, provider adapters, fixtures, current V3 validation/viewer behavior | `spikes/llm-provider/` |
| `user-priority.test.ts` | User priority patches | Dynamic `server/db.ts` |
| `my-words.test.ts` | Learner collection membership, study dates, stage/lapses filters, search/pagination, isolation, HTTP validation | Dynamic `server/db.ts`, `server/index.ts` |
| `my-words-page.test.ts` | Word detail, stage chips, and collection empty/error presentation | `MyWordsPage.tsx` server render |
| `priority-page-model.test.ts` | Stash manage-list overlay recency sort | `src/features/priority/priority-page-model.ts` |
| `priority-match-selection.test.ts` | Stash add-by-target multi-match chooser helpers and picker markup | `priority-match-selection.ts`, `PriorityPage.tsx` |
| `priority-aliases.test.ts` | French alias lookup | Dynamic `server/db.ts` |
| `word-meanings.test.ts` | Word meanings CRUD | Dynamic `server/db.ts` |
| `dev-db-bootstrap.test.ts` | Dev DB bootstrap | Dynamic `server/db.ts` |
| `learner-isolation.test.ts` | Fresh local/external learner defaults, preserved settings, shared lexical visibility, private overlays/content, duplicate private ids, cross-owner references | Dynamic `server/db.ts` + raw scoped connection |
| `study-profile.test.ts` | Study profile helpers | `src/study-profile.ts` |
| `clerk-auth-gate.test.ts` | Clerk loading vs sign-in vs invite sign-up vs app gate; invitation tickets mount SignUp | `src/auth/clerk-auth-gate.ts`, `ClerkAuthGateViews.tsx` |
| `canonical-words.test.ts` | Canonical wordlist scripts | `scripts/lib/canonical-words.ts` |
| `cc-cedict.test.ts` | CC-CEDICT parsing | `scripts/lib/cc-cedict.ts` |
| `subtlex.test.ts` | SUBTLEX parsing | `scripts/lib/subtlex.ts` |
| `hosted-dogfood-cutover.test.ts` | Coherent offline dogfood preparation, strict Clerk binding, manifest validation, source preservation, stopped-process promotion, and retained fixture rollback | Hosted dogfood cutover scripts and library |
| `hosted-operations.test.ts` | Hosted service controls, service banner, sentinels, learner disablement, and restore-validation helpers | `server/db/hosted-operations.ts` |
| `hosted-upgrade.test.ts` | App-only upgrade command: identity confirmation, dirty-tree refusal, deploy build-arg, smoke-failure stays closed, reopen banner clear | `scripts/lib/hosted-upgrade.ts` |
| `hosted-smoke.test.ts` | Read-only Clerk smoke: existing-learner gate, token mint/revoke, no token leakage | `scripts/lib/hosted-smoke.ts` |
| `observability.test.ts` | Bounded route labels, request/response histograms, private Prometheus listener, and metrics-port validation | `server/observability.ts` |
| `request-flight-recorder.test.ts` | Ring retention and filters, per-route aggregation, process samples, query validation, and loopback-only endpoint | `server/request-flight-recorder.ts` |
| `request-timing.test.ts` | Exclusive request phases, SQLite statement and transaction attribution, context across body parsing, `Server-Timing`, slow-request events, and phase metrics | `server/request-timing.ts`, `server/db/statement-timing.ts` |
| `content-sharing.test.ts`, `content-sharing-api.test.ts` | UTC weekly second-learner milestones, exact frozen revisions, repeat deduplication, shared-only review content, cross-origin cue attempts, and operator access/input validation | SQL reporting module + temporary SQLite/Express API |
| `content-sharing-page.test.ts` | UTC week navigation, reuse evidence, current overlap distinction, missing generation data, safe labels, and empty weeks | Presentation helpers + React server render |
| `usage-pulse.test.ts` | Daily cohort exercise/time totals, lower-bound practice with missing records, mean stash, snapshot idempotency, smoke-learner inactive exclusion, operator allowlist, and usage-pulse, preparation-retry, model-invocation, and service-banner API behavior | `server/db/usage-pulse.ts`, operator routes and access control |
| `client-incident-diagnostics.test.ts` | Account-scoped client queue bounds/retention, visible IDs, private sidecar deduplication/pruning, and inspection | Client/server incident diagnostic modules |
| `study-commit-diagnostics.test.ts` | Success/failure correlation, exact private payload/error retention, 30-day pruning, diagnostic-id responses, contrast routing, and logging isolation | `server/study-commit-diagnostics.ts`, study-commit API handlers |

## Retained vocabulary sessions

`vocabulary-study.test.ts` covers admission-time repertoire freezing, published
content and settings changes between sessions, cold hydration, Maintain
recognition fallback, and live HTTP routes that do not wake workers. Its SQL
assertions guard against full context/history reads and live content discovery.
The optional scaling experiment is documented in
[vocabulary runtime](vocabulary-learning.md#retained-session-payload-and-hot-path-work).

`vocabulary-session-incremental.test.ts` compares ordinary incremental updates
with full replay through teaching, reactions, pure cues, mode changes and Undo.
`vocabulary-session-cache.test.ts` covers indexed warm reads, rollback and
same-sequence replacement, learner/connection isolation, eviction, and completion
report reuse with fresh status/time metadata. The persistence and completion
suites retain finalization and durable-effects coverage.

## Vocabulary backend provider trials

[`scripts/vocabulary-reflection-trial.ts`](../scripts/vocabulary-reflection-trial.ts)
replays supplied session-log fixtures in a new, isolated archive. `prepare --archive
ABSOLUTE_NEW_DIRECTORY --cases FILE` exercises the completion HTTP API, waits for
closure, ingests evidence and checks expected routing without provider calls.
`run --archive ABSOLUTE_DIRECTORY --allow-provider-calls --max-provider-calls 80`
uses configured credentials and the real reflection/sense providers. Live runs
require authorization for the external calls; the numeric limit caps provider
calls, not jobs. Each job gets one attempt, and proposals remain unapplied.

Preparation preserves the fixture and hashes current source files, including
uncommitted edits. Execution retains per-stage requests/results, invocation
provenance, sense inventories, admission stages, feedback and state effects.
`inspect --archive ABSOLUTE_DIRECTORY` refreshes exported evidence without calls.
Keep historical fixtures/results intact, record input adaptations, and separate
backend execution checks from linguistic judgments. Synthetic actions over real
cue snapshots establish flow coverage, not replay of actual learner sessions.

## When changing…

| Area | Run first |
| --- | --- |
| New-learner defaults / diet profile | `diet-profile.test.ts`, `diet-intake-placement-api.test.ts`, `learner-isolation.test.ts` |
| Session composition / SQL scheduling | `session-composition.test.ts`, `unstudied-admission.test.ts` |
| Session end / word lifecycle commits | `session-completion.test.ts`, `durable-session-completion.test.ts`, `session-finalization.test.ts`; browser completion and final reinforcement fixtures |
| Contrast content | `contrast-content.test.ts` |
| Study management / suppression | `study-management.test.ts` |
| Priority / aliases | `user-priority.test.ts`, `priority-aliases.test.ts` |
| Frontend session state only | `session-selectors.test.ts`, `session-bucket-state.test.ts`, `session-keyboard.test.ts` |
| Clerk frontend session gate | `clerk-auth-gate.test.ts` |
| Hosted Clerk invitations | `hosted-clerk-invite.test.ts` |
| Reflection contracts / validation | `reflection-domain.test.ts`, `reflection-evidence-validation.test.ts`, `reflection-v7-schema.test.ts` |
| Reflection evidence / finalization | `session-reflection-evidence.test.ts`, `session-finalization.test.ts`, `reflection-evidence-enrichment.test.ts` |
| Reflection provider / generation | `reflection-provider.test.ts`, `reflection-generation.test.ts`, `reflection-generation-isolation.test.ts` |
| Reflection persistence / application | `reflection-store.test.ts`, `reflection-application.test.ts`, `reflection-persistence-reload.test.ts`, `reflection-quality.test.ts`, `reflection-help-inbox.test.ts` |
| Reflection HTTP / review UI model | `reflection-api.test.ts`, `reflection-page-model.test.ts`, `reflection-operation-editor.test.ts`, `reflections-page-run-log.test.ts` |
| Schema or bootstrap | `dev-db-bootstrap.test.ts` + any db-touching tests above |
| Hosted metrics / Grafana export | `observability.test.ts`, `request-timing.test.ts`, `hosted-runtime.test.ts` |
| Hosted app-only upgrade pipeline | `hosted-upgrade.test.ts`, `hosted-smoke.test.ts` |
| Hosted service banner | `hosted-operations.test.ts`, `hosted-runtime.test.ts`, `app-chrome-nav.test.ts` |
| Hosted study-commit failures | `study-commit-diagnostics.test.ts` |
| Client transport incident capture/upload | `client-incident-diagnostics.test.ts`, `study-commit-diagnostics.test.ts` |

Tests that dynamic-import `server/db.ts` set `APP_MODE=study` and
`APP_DATA_DIR` to a temp directory before import. Node's test context selects
the stable `test-learner` unless a test supplies `APP_LEARNER_ID` explicitly.

The reflection API suite invokes the actual handlers registered in Express
without binding a TCP port, which keeps the automated suite compatible with
restricted sandboxes. Provider tests inject transport responses and never
require real credentials or external network access. The steel-thread
demonstration still requires a separate manual study-mode run with a real
completed session and `OPENAI_API_KEY`; secrets must not enter fixtures, logs,
or artifacts.

## Reflection lifecycle logs

The backend writes one newline-delimited JSON event to its normal stdout for
each reflection boundary. No prompts, learner responses, provider responses, or
credentials are logged. The events are:

| Event | Meaning |
| --- | --- |
| `reflection.summary_recorded` | Finish saved the completed-review summary. |
| `reflection.generation_requested` | The reflection endpoint received a request. |
| `reflection.provider_started` | Durable evidence formed a bundle and the provider request is about to begin. |
| `reflection.generation_succeeded` | An artifact was materialized. |
| `reflection.generation_failed` | The endpoint failed; `failure` is `invalid_evidence`, `provider`, or `internal`, and `code` is a safe reflection error code when available. Provider failures also include `clientRequestId`. |

Every event includes `at` and `sessionId`; completion/failure events include
`elapsedMs`, and `reflection.summary_recorded` includes the submitted
`activeDurationMs`. Deferred second-opinion requests use the same lifecycle
events with a null `sessionId`; this keeps failures that occur before a durable
generation run visible. Unexpected second-opinion failures also return a
diagnostic id to the learner and write a correlated stderr record containing
the exact error name/message plus bounded request metadata (model and proposal
count, but not proposal ids or request bodies). In a manual run, read the
terminal running `dev:reflection:backend`. A timeout should produce
`provider_started`, followed
about 900 seconds later by `generation_failed` with `failure: "provider"` and
`code: "upstream_failure"`.

For provider failures only, the backend also appends an allowlisted local JSON
record to `reflection-provider-diagnostics.jsonl` beside `app.db` in the active
data directory. It records correlation and classification data: the session and
client request IDs, failure kind, safe error and cause names/codes, and, for HTTP
failures, the status, OpenAI `x-request-id`, and processing-time header. It never
writes request or response bodies, error or cause messages, stacks, or API keys.
Treat the file as private because it still contains local session identifiers.
The `clientRequestId` is sent to OpenAI as `X-Client-Request-Id`, so it can also
be supplied to OpenAI Support if a transport failure gives no server-generated
request ID.

`usage-exercise-totals-migration.test.ts` covers populated upgrade preservation,
unknown historical values, learner-scoped writes, repeat migration, fresh schema
equivalence, and the acceptance time index.

`usage-new-word-totals-migration.test.ts` covers populated new-word backfill,
learner-scoped summary counts, unknown legacy history, completed-session UTC
attribution, saved snapshot correction, admission preservation, repeated
migration, and fresh/upgrade schema equivalence. `usage-pulse.test.ts` exercises
write-time totals, evening EDT, midnight sessions, retries, Undo, and late
completion snapshot refresh.

### Learner feedback preview

`/tests/browser/vocabulary-feedback.html` uses the actual learner Feedback page
and app navigation with an in-memory API. Its scenario picker covers correction,
unfair rejection, a comment after a correct answer, shared-expression feedback,
generation in progress, partial failure with retry, and an empty inbox. Copy is
illustrative, not a retained provider result. The single-card inbox uses previous/next navigation and marks only the displayed
lesson read. Queued and failed items occupy cards in the same queue. Retries simulate
success without provider calls or database writes.

The learner feedback preview also supports Dismiss/Restore and Left/Right/D
shortcuts. Verify dismissal advances to the next card, survives Refresh, and
remains restorable under Dismissed; dropdowns retain their native keyboard input.
