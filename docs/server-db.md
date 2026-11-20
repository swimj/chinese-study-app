# Server database module map

The [vocabulary product contract](../SPECS/vocabulary-learning.md) defines intended
behavior; the [architecture contract](../SPECS/vocabulary-architecture.md) defines
structural constraints. The [implementation guide](vocabulary-learning.md) explains
the current runtime. Earlier-runtime entries below support retained records and
compatibility; they do not reopen retired Mandarin write paths.

Use this map to locate persistence responsibilities and understand the current
storage boundaries, initialization, and domain-specific write paths. Persistence
lives under [`server/db/`](../server/db/); callers and tests use the stable
[`server/db.ts`](../server/db.ts) barrel.

Migration `0027_correct_cue_repair_recovery` adds the immutable operator-only
`operator_reflection_cue_recoveries` audit. Its rows preserve the outcome of repairs applied before the
legacy reflection runtime was retired.

Migration `0035_definition_fallback_quality` extends the content quality kind
constraint for exact definition fallback snapshots. It preserves existing
encounters and ratings and requires the offline schema-upgrade procedure.

## Modules

| Module | Responsibility |
| --- | --- |
| [`connection.ts`](../server/db/connection.ts) | Config resolution per `initDbConnection()`, SQLite singleton (`getDb` / `setDb`) |
| [`statement-timing.ts`](../server/db/statement-timing.ts) | `setDb` wraps the live connection so every statement and transaction is timed for [request timing](ops/hosted-observability.md#diagnose-a-slow-request) |
| [`types.ts`](../server/db/types.ts) | Row/DTO types, scheduling constants, public type re-exports |
| [`persistence.ts`](../server/db/persistence.ts) | `initializeDatabase`, the frozen baseline schema and dev seeding, word/meaning/priority reads and edits, learner settings and learning policy, and the legacy word-state writes the vocabulary fixture builder still uses |
| [`unstudied-admission.ts`](../server/db/unstudied-admission.ts) | Experimental diet/stash unstudied admission selector |
| [`deck-words.ts`](../server/db/deck-words.ts) | Shared resolved deck-ID cache for session composition and whole-deck browsing; fresh details by ID and batched learner study dates |
| [`reflections.ts`](../server/db/reflections.ts) | Schema creation and validation for the retained legacy reflection tables |
| [`content-sharing.ts`](../server/db/content-sharing.ts) | Read-only weekly exact-content second-learner milestones, cross-origin shared cue attempts, current word overlap, and bounded evidence examples |
| [`content-quality.ts`](../server/db/content-quality.ts) | Historical exact-content ratings for the operator ledger |
| [`reflection-quality.ts`](../server/db/reflection-quality.ts) | Schema for the retained dogfood item quality-tag overlay |
| [`reflection-help-inbox.ts`](../server/db/reflection-help-inbox.ts) | Schema for retained explanation-only Help inbox rows keyed by `(artifact_id, item_id)` |
| [`whats-new.ts`](../server/db/whats-new.ts) | Shared blog posts, publication ordering, revision conflicts, and immutable attributable save history; see [What’s New](whats-new.md) |
| [`whats-new-attention.ts`](../server/db/whats-new-attention.ts) | Learner-private per-post first badge exposure and read timestamps, twelve-hour expiry, and legacy cursor compatibility |
| [`intake-triage.ts`](../server/db/intake-triage.ts) | Dormant intake-triage schema creation and validation retained for database compatibility |
| [`domain-commands.ts`](../server/db/domain-commands.ts) | Contextual-selection eligibility for trusted-local contrast seeding |
| [`production-cues.ts`](../server/db/production-cues.ts) | Schema creation and validation for legacy production tasks, cues, evidence and supplements, plus stored supplement decoding |
| [`schema.ts`](../server/db/schema.ts) | Re-exports `applyProductionContrastExerciseSeed` and `initializeDatabase` for init ordering |
| [`ownership-manifest.ts`](../server/db/ownership-manifest.ts) | Auditable ownership, enforcement, history, migration, and lifecycle classification for every durable application table |
| [`identity.ts`](../server/db/identity.ts) | Stable learner records, auth-provider mappings, learner settings, learner params, and explicit Clerk-free bootstrap |
| [`shared-content-bootstrap.ts`](../server/db/shared-content-bootstrap.ts) | Strict checksummed shared-only hosted Mandarin import and provenance validation |
| [`hosted-operations.ts`](../server/db/hosted-operations.ts) | Persisted service controls, current service banner, attributable learner disablement, diagnostics, sentinels, and restore validation |
| [`word-introductions.ts`](../server/db/word-introductions.ts) | Immutable shared bootstrap/teaching, publication leases, explicit shared reads, and private exact-package opening/completion |
| [`session-word-outcomes.ts`](../server/db/session-word-outcomes.ts) | Reads historical word outcomes for review summaries |
| [`session-debrief.ts`](../server/db/session-debrief.ts) | Learner-private exact inventories and interests snapshots, debrief queue/results, attempt cost and latency records, fenced completion and explicit retry |
| [`content-reactions.ts`](../server/db/content-reactions.ts) | Learner Save / Not for me reactions to connection notes and feedback lessons, append-only reaction history, the Saved collection read and the operator summary |
| [`preparation-work.ts`](../server/db/preparation-work.ts) | Shared word/stage demand, three-attempt budget, restart recovery, failure diagnostics and audited operator retry; migration 0018 |
| [`sense-content-reconciliation.ts`](../server/db/sense-content-reconciliation.ts) | Operator-authorized saved judgments, versioned dependency plans, atomic live application and replacement retry |
| [`sense-content-reconciliation-state.ts`](../server/db/sense-content-reconciliation-state.ts) | Applied canonical authority, generation publication fences, replacement readiness and durable practice demand |
| [`usage-pulse.ts`](../server/db/usage-pulse.ts) | Content-free daily cohort usage snapshots and live today pulse for the operator page |
| [`learner-context.ts`](../server/db/learner-context.ts) | Required learner context for private persistence operations |
| [`hanzi-lookup.ts`](../server/db/hanzi-lookup.ts) | Mandarin punctuation-stripped hanzi lookup key, matching production normalization |
| [`learner-scoped-tables.ts`](../server/db/learner-scoped-tables.ts) | Physical learner-owned tables plus current-learner compatibility views/triggers |
| [`scoped-content-tables.ts`](../server/db/scoped-content-tables.ts) | Learner/shared scope filtering and write boundaries for contrast and production content |
| [`learner-ownership-guards.ts`](../server/db/learner-ownership-guards.ts) | Same-owner private references and accessible-cue enforcement beneath HTTP |
| [`index.ts`](../server/db/index.ts) | Internal re-export barrel |

These modules group exports from the underlying implementations.

| Shim | Key exports |
| --- | --- |
| [`words.ts`](../server/db/words.ts) | `getWords`, `searchWords`, meanings |
| [`priority.ts`](../server/db/priority.ts) | Unstudied priority queues, `listUnstudiedPriorityMatchesByTarget`, `addUnstudiedUserPriorityByHanzi` |
| [`session-composition.ts`](../server/db/session-composition.ts) | Dual-pool unstudied admission re-exports |
| [`analytics.ts`](../server/db/analytics.ts) | Learner admission settings and the historical summary writer used by fixtures |

The legacy session composition, study-event, study-management, scheduler,
contrast-authoring, completion, recovery-highlight, and reflection lifecycle
code was removed with the retired Mandarin study model; its tables remain in the
baseline schema for retained records.

## Reflection persistence

The legacy reflection tables preserve evidence, results, learner decisions and
applied effects. Startup still validates their schema. The learner Feedback badge reads vocabulary feedback from its own tables.

Migration `0069_sense_content_reconciliation` adds operator-owned current resolution
records and immutable per-version history. A resolution stores the linguistic draft,
reviewed source snapshot, applied plan, canonical authority, and canonical practice
authoring snapshot with sense versions. Draft/resolved rows
have no serving authority; an applied row governs fresh serving until required
replacements are ready. The applied plan records whether repertoire generation
is required or teaching-use coverage validates carry-forward; it can also record
unambiguous exercise sense-link updates. Saving a later draft preserves the
previous applied authority. Practice jobs identify either a teaching source or a
reconciliation; the latter has no teaching-source foreign key. The migration
creates reconciliation tables and rebuilds the practice queue while preserving
existing jobs, without rewriting content, senses or learner records. See the
[migration rehearsal note](ops/sense-inventory-reconciliation.md#live-reconciliation-migration-rehearsal).

The vocabulary feedback path uses `learner_state_effects` for both closure's
immutable pre-lapse snapshots and judgment-linked compensation receipts. The
[compensation module](../server/db/vocabulary-lapse-compensation.ts) writes the
outcome in the feedback judgment transaction. Compensation uses the existing
schedule JSON for reset gates and requires no schema migration.

The retained reflection schema includes the following tables, initialized and validated from
[`reflections.ts`](../server/db/reflections.ts) (quality overlay from
[`reflection-quality.ts`](../server/db/reflection-quality.ts); Help inbox from
[`reflection-help-inbox.ts`](../server/db/reflection-help-inbox.ts)):

| Table | Responsibility |
| --- | --- |
| `reflection_artifacts` | Immutable successful evidence/result provenance with an optional source session |
| `reflection_generation_runs` | Append-only provider-attempt log, including the exact validated bundle used for retry, failed/truncated attempts, normalized usage, and a persisted price snapshot |
| `reflection_proposal_reviews` | One mutable review status for each immutable `(artifact, item, proposal index)` locator; `inbox_seen_at` is Help-pager display, not a disposition |
| `reflection_operation_invocations` | Immutable authorized operation plus its mutable application status, effects, and non-effect reason |
| `reflection_quality_annotations` | Optional item tag-set overlay keyed by `(artifact_id, item_id)` |
| `reflection_help_inbox` | Open explanation-only Help membership keyed by `(artifact_id, item_id)`; includes the disposition and Help-pager display timestamp |

Artifacts preserve the exact bounded bundle, validated result, generation time,
provider/model/prompt metadata, and schema versions. Same-owner guards require
a non-null source study session and every private provenance link to belong to
the artifact learner. Completed one-time remediation artifacts have a null
source session while their V4 bundles retain synthetic shape-only identifiers.
Triggers prevent artifact updates, proposal-identity rewrites, and
invocation-authorization rewrites.

The public SQL names above are current-learner views. Their physical tables use
the `learner_owned_` prefix and carry required `learner_id`; persistence guards
reject private references whose parent belongs to another learner.

Generation runs retain the provider attempt, recorded pricing basis and
available diagnostics. Historical invocations identify the authorized operation
and its recorded effects. These rows can be inspected in the database or a backup.

## Reflection generation modules

The legacy session reflection generation runtime (evidence assembly, generation
service, lifecycle logging, failure artifacts and provider diagnostics) has been
removed with its routes. Shared model plumbing remains:

| Module | Responsibility |
| --- | --- |
| [`server/reflection/model-arms.ts`](../server/reflection/model-arms.ts) and [`model-routing.ts`](../server/reflection/model-routing.ts) | Model choices and routing used by vocabulary reflection |
| [`server/reflection/luna-provider.ts`](../server/reflection/luna-provider.ts), [`glm-provider.ts`](../server/reflection/glm-provider.ts) | Pinned provider model configurations and the provider config type reused by vocabulary reflection |
| [`server/reflection/run-pricing.ts`](../server/reflection/run-pricing.ts) | Versioned direct-provider estimates plus OpenRouter response-cost preservation |
| [`server/llm/`](../server/llm/) | Provider-neutral HTTP, OpenAI-compatible request, token/finish-reason, JSON-schema validation, and static run-pricing primitives |

## Retired intake triage storage

The intake-triage advisor and its generation, API, and application paths are
retired. The three existing tables remain dormant provenance; schema creation,
indexes, validation, and ownership classification stay in place so existing
databases remain readable until the planned migration removes them.

## Learner and content scope

The hosted service keeps multiple learners' private state alongside shared
content in one SQLite database. The [account and authorization
contract](private-beta-service-boundary.md#account-and-authorization-contract)
defines the intended isolation guarantees. This section explains how identity,
query scoping, and relationship checks currently realize that boundary.

### From authenticated account to learner context

`learners.learner_id` is the durable ownership key. A Clerk subject identifies an
account at the authentication provider; `learner_auth_mappings` maps that subject
to a learner. Adding a Clerk mapping for an existing local learner can therefore
preserve the ownership keys on their private history. In Clerk mode,
[authentication middleware](../server/authentication.ts)
resolves the verified subject before entering `/api` handlers. The
[identity module](../server/db/identity.ts) resolves an existing mapping or
creates the learner and mapping in one immediate transaction, so concurrent
first requests converge on one identity. Missing authentication returns 401;
a disabled learner returns 403 before the handler runs.

The middleware enters `runWithLearnerId`, whose `AsyncLocalStorage` context
carries the learner through the request's asynchronous work. The SQLite
connection stays shared: its `current_learner_id()` function calls
`requireLearnerId()` to read the active context. The [context
module](../server/db/learner-context.ts) throws when Clerk-mode work needs a
learner but none is present. Trusted-local mode retains a configured-learner
fallback for local use; that fallback is unavailable in hosted Clerk mode.

Work resumed outside a request needs its own context. For example, the
[session-debrief worker](../server/session-debrief/worker.ts) selects a queued
job with its learner ID, enters that learner's context, and checks that the
learner remains enabled before claiming the job and calling the provider.
Entering context itself selects an ID; it does not authenticate an account or
check disablement.

### Scoped queries and stored relationships

Many established private SQL names, such as `study_sessions`, are
[compatibility views](../server/db/learner-scoped-tables.ts) over physical
`learner_owned_*` tables. A view filters rows by `current_learner_id()` and omits
the ownership column. Its insert trigger supplies that ID; its update and delete
triggers restrict the affected rows to that learner. This preserves existing
domain queries while separating private records. For example, two learners can
use the same logical session ID because the stored key includes `learner_id`.
Other persistence modules query private tables with an explicit learner
predicate, such as the learner-parameter queries in the identity module.

Query scoping and reference integrity do different jobs. The [application
connection](../server/db/connection.ts) enables SQLite foreign-key enforcement.
The physical study-event tables have composite foreign keys containing
`learner_id`, so an event cannot name a session belonging only to another learner.
[Same-owner
triggers](../server/db/learner-ownership-guards.ts) check additional private
relationships, such as a reflection artifact's source session. These checks
protect the stored relationship even when a write reaches the physical table.
A reference to shared lexical content supplies no proof of private ownership.

This is application-controlled scoping, not a SQLite permission boundary against
arbitrary SQL. Direct reads and writes to a physical table bypass the view's
filtering and write routing. Same-owner constraints still check stored
relationships; they do not establish that the caller may act as the supplied
learner. Operator and service-wide work therefore need their own authorized scope.
The [ownership manifest](../server/db/ownership-manifest.ts) identifies table
ownership and enforcement points when inspecting or extending a persistence path.
Schema-completeness tests require every steady-state table to be classified;
temporary migration tables and SQLite internals are excluded.

### Focused verification

[Learner-isolation tests](../tests/learner-isolation.test.ts) exercise private
overlays, duplicate logical session IDs, and cross-owner session rejection.
[Clerk authentication tests](../tests/clerk-authentication.test.ts) cover stable
mapping, missing/disabled accounts, and separate reflection-run ledgers. These
are focused checks of those paths, not a complete authorization audit.

### Shared content and learner overlays

Lexical content lives in shared `lexical_words` and
`lexical_word_meanings`. Learner lifecycle/notes and meaning visibility live in
`learner_word_state` and `learner_word_meaning_preferences`. The legacy
`words` and `word_meanings` names remain compatibility views so the domain API
does not need a simultaneous rewrite.

Legacy contrast artifacts and production cues use physical `scoped_*` tables.
Learner views expose shared content and the learner's own private rows.
`shared_content_publications` and its event ledger retain publication status
and history. Private authorization, evidence and reports remain in learner-owned
tables. The [dogfood backfill](../server/db/shared-content.ts) still inspects and
publishes qualifying historical content during explicit cutover preparation.

## Init order

[`server/db.ts`](../server/db.ts) runs:

1. `initDbConnection()` — reads current `APP_*` env and opens `app.db`
2. `initializeDatabase()` — creates a fresh baseline schema and applies shipped
   versioned migrations. Fresh-only `create…` constructors use strict SQL and
   create each object once; they are never repair or upgrade entrypoints. Trusted-local mode bootstraps its configured learner;
   Clerk mode creates learners after verified first sign-in. Existing databases
   must already have the exact current migration ledger and schema fingerprint;
   startup validates them without installing schema objects or running backfills.

Tests that dynamic-import `server/db.ts?test=…` rely on this running once per import URL.

`server/db/migrations.ts` owns the explicit offline runner and compatibility
check. See [schema migrations](ops/schema-migrations.md) for initial adoption,
transaction/failure behavior, and how to add future migrations. Existing
contrast eligibility repair remains in fresh initialization and explicit dev
seed application, rather than rewriting persisted eligibility at every restart.

`daily_study_minutes` in `learner_settings` stores the timed paradigm's 10, 20 or
30 minutes; an absent row means the default 20. `vocabulary_timed_session_records`
belongs to timed sessions only; see
[timed daily practice](vocabulary-learning.md#timed-daily-practice-prototype).

The `learner_settings` row keyed by `(learner_id, daily_new_word_limit)` stores
the learner's configured limit as JSON. The row keyed by
`(learner_id, unstudied_admission_source)` stores `"mixed"` or `"stash_only"`.
These settings are independent of `daily_new_word_intake.new_study_count`, the
per-study-day counter incremented only when an unstudied word is completed.
Study callers supply this key: ordinary client commits use a 04:00 local
boundary, while a deferred final commit uses the UTC date frozen at summary
entry. The key need not equal the UTC reporting date. Usage independently sums
`review_session_summaries.new_word_count`, persisted from accepted session word
outcomes when the summary is written. The summary's UTC completion day owns the
whole session's Usage count; see [Usage metrics](operator-panel.md#usage-metrics).
The [new-learner policy](../SPECS/diet-deck-distribution.md#25-new-user-defaults-and-retired-placement-intake)
owns their initial values.

`identity.ts` saves the initial admission source only when inserting a new
learner, for both local and external identities. Repeated bootstrap preserves
existing rows and leaves an absent source setting absent. The reader retains
`mixed` as the legacy fallback, so changing the creation-time policy does not
change existing learners. A missing daily-limit row instead reads the current
`DEFAULT_DAILY_NEW_WORD_LIMIT`.

`diet-profile.ts` reads saved deck weights and provenance, or constructs an
unpersisted effective profile from the policy default when the setting is
absent. The manifest must contain the required default deck; an incomplete
manifest fails explicitly. Parsing and subsequent profile updates preserve
historical intake evidence. These paths require no schema migration or rewrite
of saved settings and study history.

Character display preferences also use `learner_settings`: `character_presentation`
stores `"simplified"`, `"traditional"`, or `"both"`; `sentence_character_presentation`
stores `"simplified"` or `"traditional"`. Both default to `"simplified"` without a row.
The sentence preference is independent of the card preference and survives
switches away from Both. These are display preferences, with no corpus rewrite
or schema migration.

`learner_params` is the sibling per-learner key-value store for non-setting
parameters (`learner_id`, `param_key`, `value_json`, `updated_at`). Historical blog read cursors remain in this store. Per-post read and exposure
timestamps live in `learner_whats_new_attention`. The [blog explanation](whats-new.md#unread-updates)
maintains their meaning and compatibility behavior; its
[persistence section](whats-new.md#persistence-and-live-updates) describes the
current-post and revision tables introduced by migration `0028_whats_new_blog`.

Legacy single-learner databases are not mutated during startup and are no
longer supported. The sole dogfood database completed the one-time SWI-47
learner-ownership migration before its import tooling was retired.

## Primary tests by area

See [testing.md](./testing.md). DB-touching suites import `server/db.ts` with a temp `APP_DATA_DIR`.

## Shared word introduction

`word-introductions.ts` persists immutable word-content and teaching-package
documents, publishes validated content through the existing shared registry,
serializes each word's bootstrap/teaching stages using expiring claims, and keeps
learner package-open/completion events private. See
[content generation](word-content-generation.md#publication-and-availability) for
shared publication and [serving](word-content-serving.md#private-association-api)
for private package association.

`review-content.ts` stores caller-scoped immutable canonical review records and
shared bootstrap-review preparation claims. Production cue and
pure-cue modules write/rematerialize these records while retaining legacy
projection identities for lifecycle/evidence. See
[structured-review-content.md](structured-review-content.md).

## Prepared-word reserve

Migration 0019 adds `learner_word_preparation_reserve` and
`learner_word_reserve_requests`, and normalizes daily
new-word limits above 20. Reserve candidates remain private demand; authored
bootstrap, teaching, review and their operational attempts are shared. The
reserve target is twice the configured limit, at most 40, counting queued and
ready candidates. Reconciliation must preserve stash/diet/deck policy and compute
quotas before filtering for preparation readiness. Failed slots remain reserved
to bound replacement demand.

[`server/vocabulary/preparation-reserve.ts`](../server/vocabulary/preparation-reserve.ts)
selects candidates through the vocabulary admission planner and queues their
bootstrap/teaching work. [`server/db/word-reserve.ts`](../server/db/word-reserve.ts)
persists learner-private membership and reconciliation requests. The
[teaching-reserve explanation](vocabulary-learning.md#teaching-reserve) describes
membership policy and the actions that request reconciliation.

The worker in `server/word-content/preparation-worker.ts` runs in the backend
process, polls every 30 seconds, and permits two concurrent stages. The surrounding
runtime also polls for pending reserve-reconciliation requests every 30 seconds.
Explicit wakes after learner actions or operator retries run immediately; due
retries and work without a wake wait for the next poll. Existing introduction/review
leases remain publication authority; the work journal does not replace them.
Maintenance/provider controls and shutdown draining apply.
Expired-attempt recovery uses a 30-second check interval, independently of the
dispatch polling and explicit wakes for new work. Failed checks retry
on the next worker step. An empty check is read-only. When the check finds an
expired attempt, recovery acquires a write transaction and re-reads expired jobs
before updating their outcomes and leases. An attempt expiring after an empty
check waits for a later check.
During maintenance, idle polls read service controls but skip recovery and
preparation queue access. Recovery resumes on its next due check after maintenance
ends, even if provider dispatch is disabled or unconfigured. Stopped workers do
not poll; shutdown waits for already-running work to finish.
No migration regenerates the corpus or invalidates compatible authored content.

## Session completion persistence

Migration `0036_session_completion` adds three learner-private tables:

| Table | Responsibility |
| --- | --- |
| `learner_session_word_outcomes` | Immutable before/after word status and presentation snapshots keyed by learner/session/word/action kind; repeat accepted outcomes reuse the saved snapshot |
| `learner_session_completions` | Frozen completion input, fixed deadline, provisional/confirmed report, and pending/cancelled/closed/failed state keyed by learner/session/revision |
| `learner_session_reflection_dispatches` | Frozen reflection supplement and queued/running/succeeded/skipped/failed dispatch state, active token, lease and result; references its same-owner completion revision |

These rows preserve earlier session history. Current vocabulary completion uses
its [own session and dispatch records](vocabulary-learning.md).
See the [migration note](ops/migration-notes.md#durable-session-completion-0036)
for the original installation.

## Session debrief persistence

Migration `0023_session_debrief` adds `learner_session_debrief_jobs` and
`learner_session_debrief_attempts`, both with required learner identities and
composite same-owner foreign keys. Migration `0048_vocabulary_connections`
preserves historical summary-backed jobs and adds exact vocabulary completion
sources. Each job references either its historical summary or its same-learner,
same-session closed vocabulary completion; it cannot mix both sources. All learner
operations use explicit current-learner predicates. Operational worker routing
reads only due identities before restoring each learner context.

Vocabulary closure freezes encountered word/pinyin rows and the learner's
`debrief_interests` setting in the same transaction as the closed completion.
The adapter in `server/vocabulary/connections.ts` reads the exact projection and
served content revisions; it writes no legacy summary or learning state. Missing interests read as empty text.
Inventories with fewer than 15 eligible rows after filtering persist as
ready-empty without an attempt; larger eligible inventories queue generation up
to the shared 1000-unit session cap. At enqueue, recent ready jobs serve as the connection
ledger: their immutable `updated_at` is the result-save time, and their note
references resolve against the saved input. Two connected sessions in the last
72 hours suppress a word. The full inventory stays in `input_json`, alongside
`excludedRefs`; claim returns only eligible rows and completion validates those
references. Missing `excludedRefs` on older snapshots means no exclusions.
Retries reuse the selection; any inventory with fewer than 15 eligible rows is ready-empty.
No new table or migration is needed. See the [cooldown contract](../SPECS/session-debrief.md#recent-connection-cooldown)
for counting and word-matching semantics. Worker
recovery, enumeration, claim and explicit retry settle old small queued/failed
jobs without generating, preserving existing ready results and attempt records.
Ready results and concluded attempts are immutable. Queue recovery, leases,
token fencing, provider controls and draining shutdown live in
`server/session-debrief/worker.ts`; provider transport/validation and the
approved byte-identical v7 prompt live beside it. This flow does not use
reflection artifacts, evidence, runs, proposals, or model-selection policy.


## Learner content reactions

Migration `0072_learner_content_reactions` adds `learner_content_reactions`, one
current row per learner subject, and the append-only
`learner_content_reaction_events`. A subject is either a connection note
(`session_id`, `note_index`, with a same-learner foreign key to its debrief job)
or a lesson (`message_id` in `learner_messages`). Partial unique indexes enforce
one reaction per subject; CHECK constraints keep reasons to `not_for_me` and
personal notes to `saved`. Clearing deletes the current row; every change of
reaction or reasons, including a clear, appends an event with its surface.
Note-only edits are not events. Writes verify that the note index exists in the
learner's own ready result or that the lesson is the learner's own. Both tables
start empty; no backfill.


## Model invocation ledger

Migration `0025_model_invocations` adds the content-free, operator-only
`model_invocations` journal with a required learner foreign key. The shared provider
transport records the start before sending a request and stores spend and its
pricing basis independently of domain validation. Requests interrupted by process exit can
remain running with unknown spend; this is not proof that the provider charged zero.
No historical backfill is attempted.

The same migration adds a nullable historical requester column to shared
`word_preparation_work`. New demand records its requesting learner; the background
worker restores that identity for provider calls. Shared content stays shared. Old
unattributed pending work pauses until fresh learner demand or an operator retry
provides a real requester; retries are attributed to the requesting operator's
learner identity. This release requires the ordinary offline schema-migration
procedure and is not eligible for a code-only release.


Migration `0026_model_invocation_outcomes` preserves existing invocation rows and
pricing while adding nullable `latency_ms` and the `timed_out` / `invalid_response`
statuses. Legacy latency remains unknown. Transport timing uses a monotonic clock;
timeouts store the configured request budget. An internal invocation ID is returned
to provider validation; word preparation passes it through an optional observer to
its domain normalizers. A late same-learner validation update changes only
`completed` to `invalid_response`, retaining measured latency and spend. Unrelated
persistence, lease, or publication failures do not mislabel a valid model response.
This is an offline schema migration, with no provider calls or history reclassification.

Schema 0080 stores SHA-256 references for authored system and developer instructions.
The provider receives the original full request. The ledger keeps per-call inputs,
output schemas, settings and responses in SQLite. It stores the ordered prompt
references alongside the request and records where the adapter appended schema
instructions. A captured template has its own reference. Older invocations with
only a provenance hash still have no captured template.

For an investigation, open the database read-only in a repository checkout and call
`readInvocationPromptEvidence(db, invocationId)` from
[`invocation-prompt-archive.ts`](../server/db/invocation-prompt-archive.ts).
It returns the exact captured template and serialized provider request, verifying
each Git blob against its digest. The optional third argument selects an archive
directory. Hosted machines carry the digest catalog and the active prompt sources.
The historical archive lives in Git under `artifacts/invocation-prompts/`.
[Look up the archived system prompt by hash or use and version](prompt-development.md#look-up-a-system-prompt)
directly from a checkout. Hosted writes reject an unregistered authored prompt
before the provider call. The
[prompt authoring procedure](prompt-development.md#register-and-retain-invocation-prompts)
covers registration and retention.

Improvement-job checkpoints use the same archive for the system prompt in their
saved input contract. The checkpoint key remains the hash of the original full
input, so a retry can find a stage completed before the migration. The checkpoint
retains the exercise input, schema, result, and invocation link. The offline
reader `restoreImprovementStageInput` resolves the prompt reference and checks
the reconstructed input against the checkpoint key.

Local experiments can also use unpublished prompts. For an on-disk development
database, preserve the adjacent `invocation-prompt-blobs/` directory when moving
or backing up the database. Hosted captures use only reviewed Git blobs.

Migration `0076_prune_trivial_unstudied_words` deletes never-touched, non-stash unstudied `learner_words` rows (with their default schedule and legacy state rows) that nothing else references; see its [rule and rehearsal note](ops/migration-notes.md#trivial-unstudied-word-pruning-0076). It requires the offline schema migration procedure.

## Teaching set storage

Migration `0074_teaching_sense_sets` keys preparation pointers by word and
`teaching_set_key`, and shared work by word, key and stage. Source documents
carry the key; composite foreign keys prevent work or preparation pointers from
using another set's source. The `default` key preserves the existing default
lesson policy. Concrete keys encode sorted distinct canonical sense IDs; their
actual source-use mappings remain separate evidence. Existing artifacts,
publications, learner events, leases and attempt/retry records are preserved.
See [teaching set identity](vocabulary-learning.md#teaching-set-identity) for
runtime use and the [migration rehearsal note](ops/migration-notes.md#teaching-set-foundation-migration)
for release checks.

## Review scheduling columns and due times

Migration `0077_vocabulary_due_columns` keeps the scheduling facts that review
reads filter or order on in real columns of `learner_word_schedules` and
`learner_pure_cue_schedules`, not in `scheduler_state_json`. Domain code still
works with one merged state object; `server/db/vocabulary-schedule-columns.ts` is
the only place that splits it for a write or merges a row on read. Guard triggers
reject a write that puts a moved key back into JSON or omits a positive interval.

`review_due_at` (production schedules and recognition/contextual-selection states)
is maintained by triggers from each row's own columns, and covering indexes lead
with the learner and due time. Pure cues store no due time: a learner's cue set is
small, so one covering index serves the whole read and roles are decided in code. See the
[rehearsal note](ops/migration-notes.md#vocabulary-due-columns-0077).

## Independent introduction components

`word_introduction_components` retains validated teaching and practice outputs across failed companion calls, keyed by exact bootstrap content, component stage, and generation key. Writes require the current teaching lease. `word_teaching_package_components` links the published immutable package to each component and its model/invocation provenance. Package readiness is still atomic; existing packages need no regeneration. Migration `0029_introduction_components` adds these tables and requires the offline schema-migration release procedure.

## Operator content improvements

`content_improvement_cases` owns revision-checked operator drafts and resolved
outcomes. `content_improvement_revisions` retains immutable snapshots of each
saved revision, including accepted before/after evidence. These operational
records are operator-only and can contain private authored content; they do not
change its ownership or expose learner responses.

`content_improvement_replacements` retains explicit successor links used by
future cue, supplement, contrast and introduction selection. Existing learner
introduction pins may retain their predecessor. `operator_pure_cue_repairs`
records the bounded in-place wording repair before a guarded update. The
correction transaction owns application and audit together. See the
[API map](api.md#operator-content-improvement) for historical read access. Migrations
`0032` and `0033` require the offline schema migration procedure.

### Vocabulary sense coverage

`server/db/vocabulary-sense-coverage.ts` owns `vocabulary_word_sense_coverage`,
`vocabulary_case_sense_coverage` and append-only
`vocabulary_sense_coverage_history` (migration `0062`). Word defaults exclude
active senses from shared general production. Case selections override that
coverage for a review; SQL null inherits and `[]` selects none. Versioned writes
and backend events preserve operator/service provenance without altering sense
identity, authored content or learner history.

Migration `0063_vocabulary_proposal_drop_actions` rebuilds
`application_content_changes` to admit `retire`, preserving previous receipt rows
and foreign keys and retaining immutable application history. Retirement points
to the retired source revision and its content-history change; it creates no
replacement content identity.

Migration `0064` creates `vocabulary_default_selection_readiness`, owned by
`server/vocabulary/default-useful-selection.ts`. Its lease, due time and bounded
attempt count are separate from inventory creation. Recommendations retain their
invocation and canonical IDs; model-empty findings remain unknown until an operator
chooses useful senses. Shared default-useful IDs are nullable coverage state in
`0061`; schema installation does not initialize that data.
