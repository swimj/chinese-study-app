# Testing map

Use the [preview testbed](preview-testbed.md) to discover and launch presentation,
application-shell, and isolated real-backend scenarios.

This map helps contributors select checks for affected behavior and understand
what those checks exercise. The [development principles](development-principles.md#preserve-behavior-across-implementation-changes)
describe how to preserve implementation and regression evidence during a change.

Run full suite: `npm test` (Node test runner, `tests/*.test.ts`).

For live vocabulary-chat prompt regression, use the [intake evaluation set](evaluation/vocabulary-intake.md):
55 named cases, exact fixture/runner links, execution commands and scoring caveats.

## Verify coverage through the current application path

Select tests by the behavior and execution path they exercise, as well as by
filename or subsystem. For each important retained behavior, inspect the test's
imports, setup, mocks, and assertions alongside the current application's callers.
Establish whether the test reaches shared production code, a replacement adapter,
or only an earlier implementation.

Use complementary checks at the boundaries affected by the change:

- Shared policy and component tests preserve the applicable input cases and
  expected outcomes. Adapt setup when an interface changes without weakening
  those expectations to match the replacement.
- Adapter tests exercise the new request, persistence, and lifecycle translation,
  including relevant failures, retries, and ordering constraints.
- Focused integration or mounted-controller tests exercise the application's
  actual composition of those parts. Mock external transport where needed, while
  retaining the wiring whose correctness is in question. Calling a helper directly
  does not establish that the current controller calls it.
- Browser checks exercise affected interactions and rendered behavior. Static
  rendering cannot establish event handling, focus, or asynchronous transitions;
  use the real component/controller in fixtures and verify visual changes in their
  actual container as required by `AGENTS.md`.

These are complementary sources of evidence, not a requirement to add every kind
of test for every change. Reuse existing cases and fixtures where their semantics
fit, and add the smallest meaningful check for an uncovered boundary. When a
regression escapes, reproduce it through the active path and retain that case as
coverage; adding an assertion only to an unused helper leaves the gap open.
Report manual fixture results separately from automated suite results.

## Coverage retained across the vocabulary cutover

Select the shared policy cases and the vocabulary suite that calls the policy
from the affected learner flow. Historical conversion tests start with populated
legacy tables so they can check both the source records and the vocabulary result.

| Shared or adapted boundary | Coverage |
| --- | --- |
| Review interval, ease and urgency | `review-policy.test.ts` covers recall credit, lapse, urgency and tie breakers. `vocabulary-selected-skill-scheduling.test.ts` checks the schedule written at closure for each selected skill. `vocabulary-composition.test.ts` checks selection. |
| Physical bracket reactions and event guards | `content-quality-keyboard.test.ts` and `vocabulary-keyboard.test.ts` exercise reaction shortcuts, Chinese punctuation and typing guards. |
| Home Start, inbox controls, summary disclosures and deadline | `vocabulary-home-overview.test.ts`, `shared-inbox-chrome.test.ts` and `vocabulary-completion-panel.test.ts` cover availability, paging, clock skew and rendered summary states. |
| Words collections and shared page | `vocabulary-words.test.ts` covers vocabulary membership and mode authority. `my-words-page.test.ts` checks presentation. |
| Preparation-wide outage classification and pause | `preparation-provider-failure.test.ts` covers error classification. `word-preparation-worker.test.ts` and `vocabulary-preparation.test.ts` exercise pause, attempt budgets and recovery through their workers. |
| Pure-cue stimulus repair | `vocabulary-pure-cue-improvement.test.ts` rejects empty, unchanged and untrimmed stimuli and checks that repairs preserve answer and reveal fields. |
| Pure-cue proxy admission | `production-proxy.test.ts` checks the common policy. `vocabulary-import.test.ts` runs the same cases through offline conversion and vocabulary selection, preserving source schedules and relevance. `vocabulary-composition.test.ts` and `vocabulary-study.test.ts` exercise eligibility, preview, Start and fallback serving. |
| Queued operator approvals | `vocabulary-reflection.test.ts` covers persisted admission, exact authorization, restart replay, stale revisions, overlap rollback, maintenance/retries, torn journal records, compaction, and crash after commit; `vocabulary-reflection-http.test.ts` covers ACK/auth/request identity; `vocabulary-operator-approval-state.test.ts` covers frontend receipt merging and attention resolution |
| Durable completion and proposal receipts | `vocabulary-session-persistence.test.ts` and `vocabulary-reflection.test.ts` include pending/approved and applied database-reopen cases with idempotent replay |
| General-exercise authoring and reflection adaptation | `vocabulary-general-exercise-authoring.test.ts`, `vocabulary-preparation.test.ts` and `vocabulary-improvement-admission.test.ts` cover shared guards, empty-result operator attention, exercise retirement, trusted selected senses, coverage-independent mapping, and publication/proposal adapters; `vocabulary-reflection.test.ts` covers application and scope |

When replacing an admission path, inventory its eligibility gates as well as its
ranking and schedule calculations. For each preserved gate, identify the owning
contract, the old behavioral test, and an assertion through the replacement
selector or controller. Derived content policies need populated-content fixtures;
copied schedule fields alone cannot establish admission equivalence.

Browser fixtures exercise mounted interactions and asynchronous acknowledgements.
The shared chrome tests exercise component markup and deadline calculations.

## Browser regression checks

`tests/browser/operator-learner-isolation.html` mounts the actual application root
with mocked transport. It checks pathname entry, operator rail navigation and
browser Back, focus/visibility/polling isolation, a full-page study-return link,
and learner mounting at `/` even with an obsolete operator hash. It does not
exercise live Clerk sign-in redirects or preserve study sessions across page loads.


### Comparing a replacement UI with the earlier app

For vocabulary UI parity work, boot the pre-cutover application as well as the
current application. Record the baseline commit, run each against its own
version-compatible disposable fixture, and keep provider work disabled. Never
point the earlier server at a current or valued database.

Capture matching viewport screenshots for normal Home, expanded Connections,
collapsed Connections, and Session Settings, plus each changed study interaction.
Match updates visibility and fixture content before comparing layout. Check the
Start card in both normal and compact states, an empty Start's error,
settings controls, keyboard order, and scrolling at narrow/enlarged sizes.
Compare the screenshots directly: a test/build pass or a newly written snapshot
is not evidence that an omitted control was intentional. Record intended model
changes separately from regressions and unresolved differences; fix regressions
before declaring parity. Keep the screenshots and baseline identity with the
review evidence so the next iteration can use the same comparison.


### Case review queue

`/tests/browser/vocabulary-case-review.html` exercises the production case queue
page with compact synthetic cards and explicit full-workspace hydration. Visible
request counters distinguish queue/history/card reads from workspace, full proposal,
and attention reads. Fixture controls complete/fail a reassessment, change shared
source metadata without changing case version, resolve a case externally, lose an
approval acknowledgement, and fail pending approval. `?usage` mounts the production
operator container; `?narrow&largeText` uses a 480px panel with enlarged text.
`?reuse` shows existing shared practice before edits; `?reuse=missing` and
`?reuse=retired` exercise unavailable references. Combine with `narrow&largeText`
to check wrapping and keyboard access to the cue disclosure.
The fixture uses local synthetic responses and never calls a provider.
`?identities&usage` starts with an ambiguous response awaiting a dictionary
choice; the reassessment controls and completion/failure buttons simulate the
queue lifecycle. Add `narrow&largeText` to inspect the selection in a small panel.
`/tests/browser/vocabulary-attention.html?assessmentFailure&view=attention` starts
with a failed assessment; the fixture can fail the next retry or acknowledge it.

Verify in-batch navigation makes no detail fetch, cross-page and end-wrap navigation,
exact totals, encounter time labels, collapsed sense counts, source drift, note
focus/Enter/IME behavior, action visibility in the outer operator container,
case identity through reassessment, cursor after Done, lazy Archive/Needs attention,
exact-request approval retry, full editor hydration and unsaved-change guards.
`vocabulary-case-queue-model.test.ts` covers the active window projection, equal-case-
version source changes, deduplication, removal cursor, and retry/approval visibility.
Backend/API coverage lives in `vocabulary-case-queue.test.ts`.

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
the real hook. Its `?mode=enough` and `?mode=skip` cases end the last open word
while finishing and verify completion stages and closes without requesting another
exercise. `?mode=enough-active` checks that active study advances after wrapping
a word. These are browser checks with mocked transport, separate from `npm test`.
`/tests/browser/vocabulary-recognition-motion.html` uses the real
controller and card surface: reveal, then Correct or Forgot. Its PASS result checks
that the rating is saved and the outgoing card reflects the acknowledged recall
before requesting the successor. `?production=1` starts on a production card.
Submitting the accepted form 字 reveals the answer and offers Wrong (pointer or
1) beside Next; a non-matching answer saves immediately and does not offer that
control. Add `&pure=1&retained=1` to restore a saved pronunciation rejection
with multiple accepted members; the retained-answer check verifies its label and
chosen member. Undo withdraws that response, allowing a fresh written-miss check.
Add `&narrow=1` for a 420px panel with enlarged text. `?covered=1` checks the covered card's rightward
departure; `?retry=1` fails the first save so Retry save must retain the departure.
`/tests/browser/saved-items.html` renders the Saved page and the Home
connections reader against in-memory reactions; `?scenario=empty` and
`?scenario=home` select the other states, and **Fail next save** checks the
restore-on-failure path. The Feedback fixture uses the same in-memory reactions.
`/tests/browser/vocabulary-ui.html` provides presentation scenarios, including
`?state=Cloze%20reveal` for an old snapshot containing an unrelated bootstrap
example and `?state=Teaching` for target ruby and hover/focus pronunciation.
Both support narrow-panel and enlarged-text controls.
`/tests/browser/vocabulary-contrast-keyboard.html` exercises 1–9/0 selection
and Enter submission through the active controller; `?count=3` checks bounds
and `?production=1` checks Escape priority for the open reaction note.
The reaction note accepts Cmd+Enter on Mac and Ctrl+Enter elsewhere through
the Send note control. In this fixture, `#contrast-result` exposes
`data-reactions` for checking written comments separately from answer submissions.
Exercise plain Enter, IME composition, blank input, and the delayed pending save;
the bracket shortcuts address Helpful / Not helpful separately.
`?pure=1` checks that accepted input 诉求 fills the cloze instead of the first
accepted member 意见, during both immediate and acknowledged reveal. The motion fixture
`?slow=1` checks opaque paper while the next encounter is delayed;
`tests/vocabulary-proposal-review.test.ts` covers compact grouping, readable sense
references, reversible inclusion, malformed draft guards, structured cue editing,
cloze validation, consequential change signals and retained evidence bases.
`tests/vocabulary-sense-coverage-ui.test.ts` covers affected scope selection,
exercise impact, label merging and read-versus-write navigation policy. The compact
review browser fixture's `?repertoire=1&usage=1` scenario opens a real case card
in the operator panel. Use Selected senses directly on the card, toggle a chip,
use Save selection, then reselect and save to restore it. Unsaved defaults block
approval and navigation; Discard edits restores access. Add `&narrow=1` to check the
embedded layout. These browser scenarios are separate from `npm test`.
Use the [disposable vocabulary fixture](vocabulary-learning.md#contributor-verification)
for end-to-end study against the actual API and SQLite.

`shared-dictionary-baselines-migration.test.ts` verifies populated stock-baseline
scope correction, new proposal revisions with prior approvals retained, immutable
evidence, learner control preservation, rollback, repeat execution and fresh/upgrade
schema equivalence. `vocabulary-study.test.ts` exercises shared baselines across
two learners and legacy identity/deactivation/retirement compatibility;
`vocabulary-reflection.test.ts` covers review and application from an old
encounter across the audited scope-only revision, and substantive drift rejection.


All HTTP is intercepted, so these fixtures do not modify learner data.

## By domain

| Test file | Domain | Imports |
| --- | --- | --- |
| `vocabulary-session*.test.ts`, `vocabulary-study*.test.ts`, `vocabulary-composition.test.ts` | Commands, independent skills, coverage, exact evidence, retry, closure, and bounded selection | Pure reducer + temporary SQLite + HTTP boundaries |
| `vocabulary-content.test.ts`, `vocabulary-import.test.ts`, `vocabulary-cutover.test.ts` | Identity/history, teaching bindings, legacy conversion and cutover refusal | Temporary SQLite |
| `vocabulary-reflection*.test.ts`, `vocabulary-processing.test.ts`, `vocabulary-preparation.test.ts` | Private feedback, manual authority, worker fencing, compensation and generation retry | Temporary SQLite + injected providers |
| `vocabulary-sense-readiness.test.ts`, `vocabulary-improvement-admission.test.ts`, `vocabulary-pure-cue-promotion.test.ts`, `vocabulary-pure-cue-improvement.test.ts` | Sense admission, local repair/repertoire routing, pure-cue promotion and review, teaching-note preservation, production-only provider eligibility, retained stages and stale evidence fences | Temporary SQLite + injected providers; linguistic eval seams in [prompt README](../server/vocabulary/reflection-prompts/README.md#local-evaluation-seams) |
| `vocabulary-prompt-experiments.test.ts` | Retained experimental inputs/outputs and structural validation | Offline archive; no paid calls |
| `teaching-sense-sets.test.ts` | Set identity, worker source/lease/readiness/recovery isolation, default compatibility after policy edits, and concrete-set repair mappings | Temporary migrated SQLite + injected provider |
| `word-content-lab-provider.test.ts` | Real request shape, strict teaching output, truncation and malformed output | Provider with injected fetch |
| `word-content-lab-service.test.ts` | Two-stage local generation, immutable archive, exact references, invalid output and identity conflicts | Injected lab provider + temporary draft archive |
| `word-content-lab-api.test.ts` | Local opt-in, host/origin gates, route response contracts | Express lab router |
| `introduction-player.test.ts` | Paced navigation, rehearsal matching, retry/finish, IME and keyboard guards | Pure local player |
| `new-learner-preview.test.ts` | Fresh learner setup, existing-data protection, reset-link output, and welcome-only browser marker reset | Preview command + temporary SQLite |
| `ui-annotation-fixtures.test.ts` | Relative UTC dates in the annotation seed that the vocabulary fixture imports | `server/seeds/ui-annotation-data.ts` |
| `vocabulary-session-fixtures.test.ts` | Full 12-word vocabulary composition, Solidify threshold range, persisted prior override, and summary choice through real finalization | Fresh fixture command + temporary SQLite |
| `session-composition.test.ts` | Daily new-word limit, admission source and character settings | Learning policy through `server/db.ts` |
| `diet-intake-placement-api.test.ts` | Retired placement endpoints and removed intake status gate | `server/index.ts` registered routes + temporary SQLite |
| `diet-profile.test.ts` | Default diet selection, operator deck changes and historical intake compatibility | `server/db/diet-profile.ts` + temporary SQLite |
| `unstudied-admission.test.ts` | Experimental dual-pool unstudied admission selector, including stash-only source | `server/db/unstudied-admission.ts` |
| `session-completion.test.ts` | Summary duration replacement and personal notes | Summary and learner persistence through `server/db.ts` |
| `card-characters.test.ts` | Study-card simplified/traditional character formatting | `src/domain/card-characters.ts` |
| `sentence-characters.test.ts` | Script conversion, Taiwan variants, comparison preservation, and contextual cloze alignment | OpenCC + sentence display helpers |
| `sentence-character-settings.test.ts` | Private sentence preferences, retention, status, and HTTP validation | Temporary SQLite + Express app |
| `session-character-settings-panel.test.ts` | Conditional sentence selector and remembered script | Settings panel server render |
| `cloze-prompt.test.ts` | Display normalization of manual blank markers, reveal, and ambiguous-text fallback | `ClozePrompt.tsx` server render |
| `study-attempt-events.test.ts`, `study-management.test.ts` | Historical study-session, attempt and management schema | Temporary SQLite |
| `reflection-run-pricing.test.ts` | Pinned token-category pricing math, partial usage handling, and unknown-rate unavailability | `server/reflection/run-pricing.ts` |
| `model-invocation-cost-backfill.test.ts` | Read-only preview, exact-plan confirmation, shared live/backfill cache accounting, preserved evidence/known spend, skipped unsupported usage, atomic rollback and repeatability | Temporary SQLite + `hosted:backfill-luna-costs` CLI |
| `reflection-store.test.ts`, `reflection-application.test.ts` | Historical reflection schema validation, production task creation trigger and immutable cue facts | Temporary SQLite |
| `whats-new-blog.test.ts` | Migration/seeding, authored preview backfill and preserved revisions, atomic revisions, draft visibility, publication ordering, live connection updates, and input bounds | Temporary SQLite + shared parser |
| `whats-new-api.test.ts` | Published feed, operator permissions, invalid writes, stale revisions and sequence endpoint | Express app + temporary SQLite |
| `whats-new-attention.test.ts` | Per-post badge exposure/expiry and reads, legacy cursor preservation, learner isolation, exact snapshots, restart/concurrent connections, migration preservation and schema equivalence | Temporary SQLite + fresh Node processes |
| `trivial-unstudied-words-migration.test.ts` | `0076` pruning rule: trivial unstudied rows, schedules and default legacy state deleted; stash, dismissal, intended use, studied modes, non-default schedules, every attachment kind and session references kept; dictionary untouched; per-table attachment rows; frozen classification of 0076's learner/word tables; rollback on a violated postcondition; repeat run | Temporary SQLite |
| `whats-new-command.test.ts` | Live command writes, actor history, conflict rejection, missing targets, old schema refusal and no bootstrap | CLI subprocess + temporary SQLite |
| `whats-new-frontend.test.ts` | Independent expiry windows, foreground/viewport exposure, safe previews and full-text rendering, unloaded-feed acknowledgement | Pure selectors + visibility observer + React server render |
| `vocabulary-reflection.test.ts` | Vocabulary feedback badge counts and failed or active generation | Vocabulary feedback reads |
| `reflection-attention.test.ts` | Reflections nav badge hiding, failure-over-count priority, and generating state | `src/features/attention/reflection-attention.ts` |
| `session-debrief-cooldown.test.ts` | Two-session rolling 72-hour cooldown, distinct-session counting, learner isolation, exact expiry, frozen retries, alternatives and all-filtered completion | `server/db/session-debrief.ts` |
| `session-debrief-loader.test.ts` | Pending-only polling, request abort/fencing, retry races and lost response recovery | `session-debrief-loader.ts` |
| `home-connections.test.ts` | Completed-session presentation preferences, deferred ready introduction, exact previews, bounded ring navigation, arrow-key guards, loop cue, waiting/failure/empty states | Home connections state/keyboard models + server-rendered component |
| `content-reactions.test.ts` | Reaction input validation, one current reaction per subject, append-only history, ownership, Saved collection window and operator summary, HTTP routes | DB module + API against a disposable database |
| `content-reactions-ui.test.ts` | Exclusive Save / Not for me toggles, reasons and notes, S/X guards, Home reaction rendering, Saved grouping, filtering and visit-stable membership | Reaction state, controls and Saved list helpers |
| `session-debrief-ui.test.ts` | Exact stepped text, empty/loading/failure, safe keyboard navigation, blank optional interests and settings visibility | Debrief card and settings server render + keyboard model |
| `user-priority.test.ts` | User priority patches | Dynamic `server/db.ts` |
| `my-words.test.ts` | Vocabulary deck membership, study dates, lexical identity caching and collection HTTP validation | Dynamic `server/db.ts`, `server/index.ts` |
| `my-words-page.test.ts` | Word detail, stage chips, and collection empty/error presentation | `MyWordsPage.tsx` server render |
| `priority-page-model.test.ts` | Stash manage-list overlay recency sort | `src/features/priority/priority-page-model.ts` |
| `priority-match-selection.test.ts` | Stash add-by-target multi-match chooser helpers and picker markup | `priority-match-selection.ts`, `PriorityPage.tsx` |
| `priority-aliases.test.ts` | Mandarin priority lookup and alias schema | Dynamic `server/db.ts` |
| `word-meanings.test.ts` | Word meanings CRUD | Dynamic `server/db.ts` |
| `dev-db-bootstrap.test.ts` | Dev DB bootstrap | Dynamic `server/db.ts` |
| `learner-isolation.test.ts` | Fresh local/external learner defaults, preserved settings, shared lexical visibility, private overlays/content, duplicate private ids, cross-owner references | Dynamic `server/db.ts` + raw scoped connection |
| `clerk-auth-gate.test.ts` | Clerk loading vs sign-in vs invite sign-up vs app gate; invitation tickets mount SignUp | `src/auth/clerk-auth-gate.ts`, `ClerkAuthGateViews.tsx` |
| `canonical-words.test.ts` | Canonical wordlist scripts | `scripts/lib/canonical-words.ts` |
| `cc-cedict.test.ts` | CC-CEDICT parsing | `scripts/lib/cc-cedict.ts` |
| `subtlex.test.ts` | SUBTLEX parsing | `scripts/lib/subtlex.ts` |
| `hosted-dogfood-cutover.test.ts` | Coherent offline dogfood preparation, strict Clerk binding, manifest validation, source preservation, stopped-process promotion, and retained fixture rollback | Hosted dogfood cutover scripts and library |
| `hosted-operations.test.ts` | Hosted service controls, service banner, sentinels, learner disablement, and restore-validation helpers | `server/db/hosted-operations.ts` |
| `hosted-upgrade.test.ts` | Code-only release command: identity confirmation, dirty-tree, unmerged-revision, dropped-env, and schema-change refusal, build before the window, recent scheduled backup or `--fresh-backup` capture before quiesce, digest-only deploy, smoke-failure stays closed with the previous image recorded, reopen banner clear | `scripts/lib/hosted-upgrade.ts` |
| `release-tracker.test.ts` | Release tracker: plans by mode, stage timing, `hosted:upgrade` event mirroring and outcomes, history ordering and file safety | `scripts/lib/release-tracker.ts` |
| `hosted-build.test.ts` | Image build: clean-checkout refusal, build-only push with `APP_REVISION`, registry digest resolution, token kept off command lines and output | `scripts/lib/hosted-build.ts` |
| `hosted-migration-release.test.ts` | Migration release: rehearsal gate refusals, stage order, idle-Machine migration, `databaseState` after failures, deferred reopen, post-release backup | `scripts/lib/hosted-migration-release.ts` |
| `hosted-rc.test.ts` | RC config boundary, T-minus restore selection, code-only/schema workflows, migration ordering, exact-image identity, and fail-closed behavior | `scripts/lib/hosted-rc.ts` |
| `hosted-smoke.test.ts` | Read-only Clerk smoke: existing-learner gate, token mint/revoke, no token leakage | `scripts/lib/hosted-smoke.ts` |
| `observability.test.ts`, `litestream-metrics.test.ts` | Bounded route labels, private Prometheus listener, daemon telemetry allowlist, missing-data behavior, HTTP deadlines/size limits, and metrics-port validation | `server/observability.ts`, `server/litestream-metrics.ts` |
| `request-flight-recorder.test.ts` | Ring retention and filters, per-route aggregation, process samples, query validation, and loopback-only endpoint | `server/request-flight-recorder.ts` |
| `request-timing.test.ts` | Exclusive request phases, SQLite statement and transaction attribution, context across body parsing, `Server-Timing`, slow-request events, and phase metrics | `server/request-timing.ts`, `server/db/statement-timing.ts` |
| `content-sharing.test.ts`, `content-sharing-api.test.ts` | UTC weekly second-learner milestones, exact frozen revisions, repeat deduplication, shared-only review content, cross-origin cue attempts, and operator access/input validation | SQL reporting module + temporary SQLite/Express API |
| `content-sharing-page.test.ts` | UTC week navigation, reuse evidence, current overlap distinction, missing generation data, safe labels, and empty weeks | Presentation helpers + React server render |
| `usage-pulse.test.ts` | Daily cohort exercise/time totals, lower-bound practice with missing records, mean stash, snapshot idempotency, smoke-learner inactive exclusion, operator allowlist, and usage-pulse, preparation-retry, model-invocation, and service-banner API behavior | `server/db/usage-pulse.ts`, operator routes and access control |
| `client-incident-diagnostics.test.ts` | Account-scoped client queue bounds/retention, visible IDs, private sidecar deduplication/pruning, and inspection | Client/server incident diagnostic modules |
| `client-incident-api.test.ts` | HTTP validation and bounded persistence for the client-incident upload route | `server/index.ts`, `server/client-incident-diagnostics.ts` |

## Retained vocabulary sessions

`vocabulary-study.test.ts` covers admission-time repertoire freezing, published
content and settings changes between sessions, cold hydration, Maintain
recognition fallback, and live HTTP routes that do not wake workers. Its SQL
assertions guard against full context/history reads and live content discovery.
The optional scaling experiment is documented in
[vocabulary runtime](vocabulary-learning.md#retained-session-payload-and-hot-path-work).
The [composition comparison](evaluation/trials/2026-11-07-session-composition.md)
records reserve, review, cue and payload work counts, lifecycle coverage, and
the summary-mode browser checks.

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

[`scripts/review-exercise-fidelity-trial.ts`](../scripts/review-exercise-fidelity-trial.ts)
prepares standalone synthetic single/repertoire/mapping requests without opening
an application database. It defaults to six development/retention controls and Luna high with
strict schemas; `--model-choice` selects another registered reflection arm.
`--profile auto` uses preparation settings for general cases and reflection
settings otherwise. `--cases` selects up to eight cases, including the separate
worked-example smoke cases. `--baseline-revision` retains the source prompt and
v4/v5 contract from Git. Add `--allow-provider-calls` only for authorized live
comparisons, run baseline and candidate sequentially, and review linguistic
quality separately from schema validation. See the
[prompt evaluation notes](../server/vocabulary/reflection-prompts/README.md#local-evaluation-seams)
for validation limits and bounded evidence.

### Sense inventory comparison and reconciliation

The live operator workflow is covered separately by
`tests/sense-content-reconciliation.test.ts`: saved unsupported decisions without
live effects, stale evidence, atomic rollback and replay, preserved canonical
identities, applied authority across a later draft, replacement failure/retry,
and progress through ordinary workers with injected providers.
It also checks read access while another connection reserves the WAL writer,
single-snapshot saves, and compatibility with previously saved offline snapshots.
`tests/sense-inventory-reconciliation-snapshot.test.ts` checks embedded references,
the complete teaching-binding closure, and equivalent active dependencies in
online and offline snapshots. `tests/vocabulary-attention.test.ts` checks batched
reconciliation hydration across pages with bounded classification-query counts.
`tests/sense-content-reconciliation-routes.test.ts` exercises the HTTP boundary;
`tests/reconciliation-testbed.test.ts` verifies the synthetic A → C / replacement B
fixture and its unmapped-source failure. These tests do not establish linguistic
correctness or production repair readiness.

Use `npm run testbed -- start reconciliation` for the actual operator route with
SQLite save/apply persistence. The [preview scenario](preview-testbed.md#sense-reconciliation-scenario)
keeps providers disabled, so replacement stays pending. UI evaluation should
distinguish saving a judgment, applying supported consequences, and waiting for
replacement; include an unsupported decision, reload, source drift, failure/retry
where available, narrow layout, enlarged text and keyboard access.

[`scripts/reconcile-sense-inventory.ts`](../scripts/reconcile-sense-inventory.ts)
connects fresh inventory generation to a separate, reviewable assessment of
existing canonical identities. Its read-only preparation commands are:

- `export --database ABSOLUTE_DB --word-ids ID,ID --out NEW_JSON` opens SQLite
  read-only and captures lexical inputs, catalog/sense versions, coverage and
  direct content, import, learner-sense, stash and bootstrap dependencies in one
  read transaction. Use an identified local snapshot for hosted-data review.
- `trial --input SNAPSHOTS_JSON --archive ABSOLUTE_DIRECTORY --variant NAME`
  prepares exact requests for 1–32 words. It sends the same `{word}` lexical input
  as runtime; existing inventories are retained for comparison but withheld from
  generation. `--baseline-revision 17a5a357` freezes the historical v2 prompt and
  nonempty schema. The candidate uses the current prompt and v3 empty-capable
  schema. Authorized live runs add `--allow-provider-calls` and an explicit
  `--max-provider-calls` budget of at most 32. Run baseline and candidate batches
  sequentially with unique variant names. Requests, outputs and hashes are retained.
- `check --snapshot CASE_SNAPSHOT --candidate CANDIDATE_JSON --judgment REVIEW_JSON
  --out NEW_REPORT` validates a semantic review against the exact snapshot and
  candidate hashes. Each active old sense and candidate index must occur exactly
  once in explicit retain, revise, retire, create or restructure groups. Retain
  can match one candidate or keep an omitted existing use; revise is one-to-one.
  Split/merge decisions need restructure groups.

The [synthetic fixtures](../scripts/fixtures/sense-inventory-cases.json) include
motivating failures, related targets and construction-dependent controls. The
[retained comparison review](../scripts/fixtures/sense-inventory-review.json)
records generated inventories, exact-call hashes, agent judgments and limits,
including the failed baseline 垂 call. Its reconciliation demonstrations use
synthetic existing inventories; they do not establish production migration
readiness. Mapping-prompt linguistic comparisons were not run in that trial.
Live trials create a judgment template for each successful candidate. An agent or
operator supplies the semantic judgment and rationale; the checker verifies
coverage, identity and structural consistency, not linguistic truth. Its reports
always state `semanticJudgmentVerified:false` and `applyReady:false`.

`report` expands the reviewed retirements into source, content, teaching-binding,
preparation and pending-work dependencies. `hash-plan` binds the approved batch;
`apply` validates it again under an immediate write lock and applies conservative
retain/retire decisions atomically. See the [reconciliation runbook](ops/sense-inventory-reconciliation.md)
for content decisions, stopped-writer rehearsal, receipts and recovery.

`tests/sense-inventory-reconciliation.test.ts` covers structural comparison and
read-only CLI export, current request preparation, and historical v2 requests.
The historical test commits [retained source snapshots](../tests/fixtures/sense-inventory-v2/README.md)
to a temporary Git repository and exercises the real CLI's revision reads,
schema selection, and provenance without requiring checkout history or provider
calls. `tests/sense-inventory-reconciliation-apply.test.ts` uses
migrated SQLite fixtures to cover dependency decisions, stale-plan rejection,
multiword rollback, idempotence, preparation refresh, and preserved learner history.

## When changing…

| Area | Run first |
| --- | --- |
| New-learner defaults / diet profile | `diet-profile.test.ts`, `diet-intake-placement-api.test.ts`, `learner-isolation.test.ts` |
| Vocabulary composition and scheduling | `vocabulary-composition.test.ts`, `vocabulary-composition-reads.test.ts`, `vocabulary-selected-skill-scheduling.test.ts` |
| Session closure and word lifecycle effects | `vocabulary-session-persistence.test.ts`, `vocabulary-study.test.ts` |
| Contrast conversion and contextual selection | `vocabulary-import.test.ts`, `vocabulary-selected-skill-scheduling.test.ts` |
| Priority / aliases | `user-priority.test.ts`, `priority-aliases.test.ts` |
| Clerk frontend session gate | `clerk-auth-gate.test.ts` |
| Hosted Clerk invitations | `hosted-clerk-invite.test.ts` |
| Vocabulary feedback and proposal application | `vocabulary-reflection.test.ts`, `vocabulary-reflection-http.test.ts` |
| Feedback and What’s New attention HTTP | `vocabulary-reflection-http.test.ts`, `whats-new-api.test.ts` |
| Schema or bootstrap | `dev-db-bootstrap.test.ts` + any db-touching tests above |
| Hosted metrics / Grafana export | `observability.test.ts`, `request-timing.test.ts`, `hosted-runtime.test.ts` |
| Hosted code-only upgrade pipeline | `hosted-upgrade.test.ts`, `hosted-build.test.ts`, `hosted-smoke.test.ts` |
| Hosted RC restore and deployment pipeline | `hosted-rc.test.ts`, `hosted-upgrade.test.ts`, `hosted-operations.test.ts`, `clerk-authentication.test.ts` |
| Ephemeral migration rehearsal lifecycle, isolation, checks, and the production gate | `hosted-rehearsal.test.ts` |
| Hosted migration release pipeline | `hosted-migration-release.test.ts`, `hosted-migration.test.ts` |
| Hosted service banner | `hosted-operations.test.ts`, `hosted-runtime.test.ts`, `app-chrome-nav.test.ts` |
| Client transport incident capture/upload | `client-incident-diagnostics.test.ts`, `client-incident-api.test.ts` |

Tests that dynamic-import `server/db.ts` set `APP_MODE=study` and
`APP_DATA_DIR` to a temp directory before import. Node's test context selects
the stable `test-learner` unless a test supplies `APP_LEARNER_ID` explicitly.

Provider tests inject transport responses. The
[vocabulary backend provider trials](#vocabulary-backend-provider-trials)
exercise real model generation when a live comparison is needed.

## Other focused coverage

`usage-exercise-totals-migration.test.ts` covers populated upgrade preservation,
unknown historical values, learner-scoped writes, repeat migration, fresh schema
equivalence, and the acceptance time index.

`vocabulary-timed-admission.test.ts` covers timed admission: the per-minute review
bound, top-of-ranking admission with lazy content checks, replacement of a failing
candidate, one urgency ranking of review words and fragile cues with the overdue
threshold for pressing, strong-cue rechecks outside the bound with fragile rechecks
ranked, strong slots scaled to admitted
review, and closure that reads no schedules. Session-level timed behavior,
including the ordinary draw over every rested item (so pressing items never have
worse odds), exhaustion and unreached new words, is in
`vocabulary-study.test.ts` and `vocabulary-timed-selection.test.ts`.

`vocabulary-composition-reads.test.ts` compares the indexed review and pure-cue
reads with the full-scan reference in `scripts/lib/session-composition-reference.ts`
over randomized learner states, clocks and cue seeds, and checks the review read's
query plan.

`vocabulary-due-columns-migration.test.ts` covers moving scheduling facts from
JSON into columns with merged state preserved, due times against hand-computed
dates, trigger maintenance after later writes, guards against keys written back
into JSON, covering index reads, and a rolled-back batch for an underivable
schedule. Hand-built vocabulary fixtures apply 0077 through
`tests/helpers/vocabulary-due-columns.ts`.

`usage-new-word-totals-migration.test.ts` covers populated new-word backfill,
learner-scoped summary counts, unknown legacy history, completed-session UTC
attribution, saved snapshot correction, admission preservation, repeated
migration, and fresh/upgrade schema equivalence. `usage-pulse.test.ts` exercises
summary totals, evening EDT, midnight sessions, idempotent retries, and snapshot
rollback and refresh.

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

The shared inventory/default-selection boundary is covered by
`tests/vocabulary-unified-bootstrap.test.ts` and
`tests/vocabulary-default-useful-selection.test.ts`: canonical identity across
reflection/teaching order, selector-backed initialization regardless of teaching
provenance, selector leases, operator precedence and model-empty attention.
`tests/vocabulary-preparation.test.ts` covers completion prerequisites and preserving
ready pools and retry budgets across authoring-contract revisions.

### Repair targets and repertoire revisions

`vocabulary-reflection.test.ts` and `vocabulary-reflection-http.test.ts` cover
pending target set/reset, failed and successful reassessment, captured-target
validation, stale alternatives/retries, approval admission, and application-time
binding changes. `vocabulary-improvement-admission.test.ts` checks source
immutability and mapping bypass for explicit operator targets.
`vocabulary-repertoire-revision.test.ts` covers narrowing without losing source
replacement intent and restoring retained exercises without undoing manual edits
or deletions. Reflection tests cover atomic default/proposal saves, remove/restore
cycles, selected-only application, conflicts, and missing-exercise generation requirements. `schema-migrations.test.ts`
checks populated migration preservation and absence of inferred operator intent.

The compact review browser fixture supports `hideControls=1`, `narrow=1`, and
`largeText=1`. Open Reassess, set its target/model options, and submit. Check
Escape/Close dismissal and focus return, same-sense selection, pending Apply/Edit blocking,
failed reassessment and Reset. With `repertoire=1`, toggle a Selected senses chip off and Save selection; its group disappears.
Reselect and save to restore the same exercises. Check empty-selection errors
and Discard edits recovery. Fixture
transport establishes UI behavior; backend tests establish persistence and guards.

The compact fixture supports `targetReadFailure=1` and `holdTargetRead=1` to
verify that an unresolved target read leaves Apply/Edit available. Combine
`targetReadFailure=1&targetPending=1` to check that approval rejection is visible
on the card. With `targetPending=1`, use Fail target refresh then refocus the page to trigger automatic refresh: the
known pending restriction must remain. Release target reads completes held reads.

### Needs attention

`/tests/browser/vocabulary-attention.html` mounts the production operator shell and
case-review entry with synthetic attention responses. Click Needs attention. Its
29 items cover every type, the twenty-item page boundary, standalone approvals,
learner-feedback jobs, and nonretryable preparation. `?narrow&largeText` renders a
480px viewport with enlarged text; `?empty`, `?slow`, and `?saveFailure` cover
alternate states. No provider calls or persistent application data are used.

Verify that the defaults card discloses its blocked practice records and counts
once. A defaults failure retains checked senses and blocks navigation. A successful
save removes the finding. Retry advances only on acknowledgement; failed retry
retains the item; type filtering, full-count wrap and remembered selection work;
and Open proposal reaches a standalone editor without a workspace request. Open
the feedback case, retry, then use Finish feedback to observe job completion while
the editor stays open. Hold/release reads exercise responses crossing navigation
and edits. Expand sense notes and details, use keyboard controls, and inspect long
labels in the narrow fixture. `vocabulary-attention.test.ts` covers authoritative
membership, teaching-case review/closure, legacy fallbacks, preparation pagination,
anchor refresh, approval staleness, HTTP validation and operator access.


The compact repertoire fixture includes an ungenerated mathematical-function sense.
Selecting it leaves a draft; ordinary Save selection rejects missing retained
exercises. Open Save selection and reassess, choose a model, and submit: the old
proposal remains frozen while the selection is saved. `?repertoire=1&selectionQueueFailure=1`
keeps the draft and reports queue failure. Verify both compact and full review,
chip keyboard toggles, Discard edits, and wrapping with `narrow=1&largeText=1`.
`vocabulary-reflection.test.ts` and HTTP coverage establish atomic queue admission,
rollback, retained proposals and captured-scope publication. Admission provider tests
establish exact selection despite later defaults, retry reuse and pre-call catalog,
identity and routing fences. Browser fixtures use no providers or application data.

For task-level UI observations, use the [independent evaluator
procedure](evaluation/independent-ui-evaluation.md) with any suitable preview.
The [coordinator procedure](evaluation/coordinator.md) owns early planning,
preview preparation, triage, and delivery reporting.

The attention browser fixture accepts `?canonical&view=attention` to display a
practice failure tied to a canonical reconciliation rather than a teaching source.
Combine with `narrow&largeText` to verify the source identity disclosure wraps.
This fixture simulates API responses; worker independence is covered by the
controlled-provider reconciliation tests.

### Drag edge scrolling

`/tests/browser/drag-edge-scroll.html` exercises the production scroll hook in a
real DOM scroll pane. Run regression checks center no-scroll, continued upper/lower
edge scrolling, and cleanup on drop/cancellation using synthetic drag events.
Native dragging and matching use the reconciliation testbed separately.

### Reconciliation repertoire reuse

`tests/sense-content-reconciliation.test.ts` covers complete teaching-use coverage
skipping bootstrap, many uses mapping to one sense, unchanged defaults, retained
exercise provenance, audited sense-link updates, and ambiguous/private remapping
blockers. It checks teaching replacement completion and restarted preparation do
not enqueue practice after a carry-forward decision. Missing selected-sense
coverage exercises full canonical generation, existing publication fences/retry,
and both completion orders. Already-applied plans retain their recorded policy.


### Session composition repertoire boundary

`/tests/browser/vocabulary-finish-return.html` mounts the production study
controller, reducer and surface with simulated HTTP. It starts with a covered
word, an open production exercise, and an unstarted due word. Choose Finish for
now, then Complete everything due: the current card and typed input should be
preserved, Undo should restore wrap-up, and normal continuation should reach
the unstarted word. `?last=1` omits unstarted work so the final answer and Next
exercise reach completion. `?narrow=1` uses a 420px panel with 125% text.
Reload resets the fixture. It does not establish HTTP or persistence behavior;
`vocabulary-study.test.ts` covers those domain transitions in temporary SQLite,
including independent cues, retries, closure fencing and duplicate effects.

`tests/vocabulary-study.test.ts` verifies reachable pools, teaching-to-Solidify
More, fixed active modes, legacy mode replay/retries, and future-state edits after
closure. `RUN_PAYLOAD_BENCHMARK=1 node --import tsx --test --test-name-pattern='measure reachable payload' tests/vocabulary-study.test.ts`
reports serialized payload bytes and SQL query preparations for the same small
synthetic repertoire in each starting mode. Baselines are materialized before
measurement; wall-clock samples exclude HTTP and hosted contention.

`/tests/browser/vocabulary-summary-mode.html` runs the real study controller and
surface with simulated completion transport. Keep the summary open, verify mode
choices are disabled while pending, then choose a future mode after closure.
`?fail=1` fails close; select Allow close and use Retry to recover. `?narrow=1`
uses a 420px panel and enlarged text. The evidence counter records session mode
commands, completion cancellations, and future-state writes; ordinary summary
mode changes should issue only the latter after closure. Backend tests separately
establish persistence and command rejection.
