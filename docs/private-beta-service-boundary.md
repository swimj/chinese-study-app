# Private-Beta Service Boundary

Status: accepted architecture contract (2026-08-19).

This document defines the ownership, identity, persistence, publication,
release, recovery, and operational-trust boundary for the invite-only hosted
Mandarin beta. Product behavior remains owned by the canonical specs. The
implementation sequence and proof gates live in
[`PLANS/hosted-beta-implementation-steel-thread.md`](../PLANS/hosted-beta-implementation-steel-thread.md).

## Service Model

The beta runs one application service against one embedded SQLite database.
The database contains both service-visible reusable content and explicitly
learner-owned state. Authentication is managed externally, but the service
owns stable learner identity and every authorization decision.

```text
browser -> managed authentication -> Express service -> shared SQLite file
                                      |                    |
                                      |                    +-> Fly Volume
                                      +-> model API
                                      +-> Litestream -> independent object storage
```

This is a bounded single-instance, single-writer design for roughly three to
eight learners. Shared SQLite is a deliberate wave decision, not a claim that
SQLite is the permanent service database.

## Account And Authorization Contract

- One invited beta account maps to exactly one stable local learner identity.
  External provider identity is represented by an explicit
  `(auth_provider, provider_subject) -> learner_id` mapping and is never the
  ownership key for study data.
- The server derives the authenticated principal. An ordinary client cannot
  choose, submit, or override a learner id.
- Every private read, write, provider call, background action, recovery action,
  and durable effect receives explicit learner context. Private persistence
  operations do not have an optional or process-global learner fallback.
- Authorization is enforced below the HTTP handler, at the domain or
  persistence boundary. Every reference between learner-owned rows must resolve
  within the same learner boundary; a reference to shared content proves no
  ownership.
- Sign-out ends the relevant session. Local account disablement prevents new
  study and provider work without deleting history.
- Invite, recovery, disablement, support access, and exceptional repair are
  attributable administrative actions. Support uses a distinct principal,
  read-only access by default, and registered repair commands rather than
  learner impersonation or improvised database edits.

Public signup, organizations, billing identities, a general role hierarchy,
and a self-service recovery product are outside this beta contract.

## Durable Ownership Inventory

The current schema has 42 steady-state application tables. Temporary migration
tables and SQLite internals are excluded. Existing mixed tables must be split
or given an equivalently explicit ownership/scope boundary before real hosted
learner data is accepted.

The machine-auditable inventory is
[`server/db/ownership-manifest.ts`](../server/db/ownership-manifest.ts). Its
schema-completeness test requires every new steady-state table to be classified
before it can land.

### Learner-owned state, evidence, and history

- `user_word_priority`, `word_study_admission_state`, `word_skill_state`,
  `daily_new_word_intake`, `review_session_summaries`, `study_sessions`,
  `study_attempt_events`, `study_events`, and `word_skill_relevance`.
- `reflection_artifacts`, `reflection_generation_runs`,
  `reflection_proposal_reviews`, `reflection_operation_invocations`,
  `reflection_quality_annotations`, and `reflection_help_inbox`.
- `intake_triage_runs`, `intake_triage_assessments`, and
  `intake_triage_assessment_dispositions`.
- `production_cue_evidence_records`, `production_cue_evidence_projection`, and
  `production_recheck_demands`.
- `production_cue_lifecycle_events` and `production_cue_activation_state` in
  their current meaning. They record each learner's authorized cue activation
  history and projection and are explicitly learner-owned.
- `learner_word_state` and `learner_word_meaning_preferences`, split from the
  shared lexical roots formerly mixed into `words` and `word_meanings`.

These records remain private even when they motivate reusable shared content.
Service processing fields and provider provenance do not convert learner
evidence into service-owned data.

### Shared content and reference data

- Lexical identity and imported lexical content currently represented by
  `words`, `word_meanings`, and `word_lookup_aliases`.
- Reusable contrast content currently represented by `contrast_clusters`,
  `contrast_cluster_members`, and `contrast_prompts`.
- Reusable production content currently represented by `production_tasks`,
  `production_cues`, `production_cue_accepted_words`, and post-reveal
  `production_cue_supplements`.
- A new or explicitly repurposed shared publication lifecycle records
  `shared_trial`, `available`, `quarantined`, and `retired`. It is separate
  from the current learner activation history and from learner suppression.

Shared content is immutable. Corrections create distinct attributable content
or an explicit disposition rather than rewriting history. A repair operation
preserves causal provenance without assuming that its inputs and outputs are
versions of one stable artifact. Attempts and evidence retain the exact content
reference, fallback, answer space, and other served snapshot required to
interpret the historical event; they do not carry publication identity.

### Service and import metadata

`contrast_candidate_intake` was a vestigial local experiment and is retired
rather than tenant-adapted. The polymorphic `study_content_feedback` log is
replaced by narrow learner-owned definition-fallback and
contrast-prompt exclusion state. Migration preserves active bad-prompt intent,
its useful note, and explicit legacy origin without conflating it with general
production suppression; resolved history remains in the migration validation
report. SWI-49 owns later shared-artifact reporting and quarantine.

The former `app_metadata` keyspace is replaced by `learner_settings`,
`schema_migrations`, and `content_imports`. Release and migration ledgers are
service-operational records; they do not grant access to learner content.

SWI-47 implements this boundary with physical learner-owned tables behind
current-learner compatibility views, shared lexical tables plus learner
overlays, and explicit `learner`/`shared` scope on contrast and production cue
artifacts. Ordinary application writes create learner-private generated
content; shared publication remains a later service operation.

## Shared Content Contract

The beta has no canonical or blessed content tier. Imported corpus content is
a reproducible bootstrap snapshot, not a quality claim.

Reusable generated content normally enters `shared_trial` after the source
learner explicitly approves its durable effect and the artifact passes strict
local validation and sanitization. Private evidence, notes, analysis, and
learner identity are never published with it. Publication states are:

- `shared_trial` — eligible for ordinary serving under optimistic publication;
- `available` — eligible service-visible content, including imported content;
- `quarantined` — immediately ineligible while a problem is investigated; and
- `retired` — historically retained but no longer eligible.

For the first beta, selection is uniform random across all eligible artifacts
for the same learning purpose, including imported and trial content. The
randomness is injectable in tests. Later ranking, personalization, feedback,
or embedding-based policy is a refinement of the probability distribution,
not a reason to weaken identity or provenance.

Learner suppression remains private relevance/curriculum state. Reporting a
bad artifact may cause a shared quarantine or retirement, and a future shared
task-level disposition is a separate operation. A possible "commonly
suppressed" prior is deferred; explicit learner admission or prioritization
must override such a default if it is introduced.

## Persistence And Reconsideration

One shared SQLite database gives shared publication coherent local
transactions, makes row ownership explicit now, and avoids a premature rewrite
of the synchronous persistence layer. Its accepted costs are cohort-wide
failure blast radius, pervasive learner scoping, single-writer contention, and
no natural file-level restore for one learner.

Observe lock wait time, busy errors, transaction latency, database/WAL size,
backup replication age, and restore health. Reconsider Postgres when sustained
contention affects learners, multiple app instances become necessary,
backup/restore tooling proves inadequate, cohort or data volume exceeds this
bounded beta, or a managed database creates enough reliability value to justify
the migration. Do not build a speculative dual-database abstraction now.

### Alternatives considered

- One service/database per learner offers a strong physical boundary but makes
  native shared content, coordinated releases, backup, and support a fan-out
  problem.
- Multiple learner SQLite files behind one service reduce cohort-wide database
  blast radius but retain the same shared-content coordination problem and add
  connection, migration, and restore orchestration.
- Shared Postgres is the conventional multi-user destination and improves
  concurrency and managed operations, but it requires a meaningful rewrite of
  the current synchronous SQLite persistence before the bounded cohort has
  evidence that the benefit is needed.
- A raw AWS, AliCloud, or other VM can run the selected shape, but makes this
  project own more OS, TLS, deploy, and monitoring assembly. Fly is selected as
  a convenience layer, not as a core application dependency.
- Serverless/ephemeral hosts and remote-SQLite products change the local
  persistent-file or driver model and are not architecture-neutral choices.

These alternatives can be revisited without changing the logical ownership,
identity, content, and history contracts above.

## Release, Backup, And Recovery

The beta accepts planned downtime and targets a recovery point of at most
approximately one hour of acknowledged activity. Losing that activity remains
a serious incident; the target calibrates current investment rather than
normalizing loss.

- Continuously replicate SQLite WAL changes to independently owned object
  storage, alert when replication age exceeds the target, retain identifiable
  recovery points, and treat host snapshots only as a secondary layer.
- Exercise an isolated restore before learners are invited and after material
  backup or migration changes. A backup is not operationally valid until its
  restore has been proven.
- For each schema-changing release: enter maintenance, quiesce writes and
  in-flight provider work, create an identified pre-release backup, apply the
  rehearsed versioned migration, start the matching app, smoke-test two learner
  identities plus shared content and the core path, record the result, then
  reopen writes.
- Before writes reopen, an incompatible failure restores the pre-release
  backup. After reopening, recovery may discard new writes, so rollback limits
  and forward repair must be explicit. Zero-downtime dual-schema releases are
  not required.
- Recovery is operator-assisted and same-day rather than governed by a formal
  availability SLA.

## Dogfood Migration Contract

The primary dogfood database is the only required legacy import. External beta
learners start fresh.

Rehearse a deterministic, versioned, transactional migration on recoverable
copies. It assigns the dogfood learner, separates shared and private data,
preserves immutable history and served snapshots, scopes metadata, and emits a
machine-readable validation report. Cutover stops local writes, takes a final
backup, imports and validates, and establishes the hosted service as sole
writer. The original remains read-only through initial verification; there is
no dual-write period.

Imported corpus content becomes `available`. Active reusable custom cues,
clusters, and prompts become `shared_trial` after a one-time authorization and
sanitization check. Inactive/replaced content retains truthful history. All
learner evidence, responses, scheduling, priorities, suppressions, feedback,
and authorization history remains owned by the dogfood learner.

Historical bad-prompt cleanup is a separate idempotent, agent-assisted proposal
workflow with operator review. Nondeterministic model judgment never runs
inside the deterministic migration.

## Operational Trust

- Tell beta learners that optional reflection sends bounded relevant study
  evidence to a third-party model API. Use commercial terms with no training
  by default, documented bounded retention, and no accidental opt-in sharing.
  Zero provider retention is not required.
- Keep credentials server-side. Bound requests, tokens, and cost, and provide a
  reflection kill switch; provider failure never blocks session correctness.
- Ordinary logs exclude learner answers, evidence, prompts, generated output,
  credentials, and secrets. Sensitive diagnostics are separately restricted
  and time-bounded; use 30 days as the initial maximum unless the selected
  provider or a concrete support need requires a shorter period.
- Tell learners this is a small supported beta: the operator may inspect data
  for an explicit support purpose, but routine product discovery is expected
  to use direct feedback rather than general usage mining.
- Do not build or promise beta export, self-service deletion, or a general
  deletion product. Support immediate disablement. Handle an explicit removal
  request manually against live data and allow backups to age out under the
  disclosed retention policy. Define a launch-grade privacy, export, deletion,
  and analytics contract before widening the cohort.

## Provisional Vendor Package

The selected package is provisional until the platform spike proves it:

- one Fly.io Machine in Singapore or Tokyo, with one encrypted Fly Volume;
- SQLite in WAL mode and Litestream replication to independent, encrypted,
  versioned S3-compatible storage;
- Clerk restricted-mode invitations and authenticated sessions, mapped to
  stable local learner identities; and
- the current OpenAI reflection integration under the trust controls above.

Fly Volume storage is local and unreplicated; generic Fly release commands
cannot mount it. Therefore migrations use a controlled maintenance/startup or
attached-Machine path, and autoscaling/autostop remain off unless proven
compatible with the single-writer and continuous-backup contract.

The spike must prove invite restriction, sign-in/out and revocation, local
disablement, volume persistence across deploys, WAL/Litestream behavior,
independent point-in-time restore, controlled migration/rollback, and required
metrics. If Fly fails, use Railway while preserving independent backup. If
Clerk fails, use WorkOS AuthKit. Switching either does not reopen this service
contract.

## Acceptance Scenarios

Use two real identities in every end-to-end gate:

1. A fresh invited learner signs in, receives fresh private state, studies,
   completes and returns to a session, optionally reflects, and cannot observe
   or affect the dogfood learner's private state or provider work.
2. The dogfood learner signs in after deterministic migration with
   representative scheduling, attempts, reflection, cue, and provenance state
   intact. The fresh learner may receive eligible shared content derived from
   that account without receiving its source evidence or identity.
3. Both identities and their separation survive one intentional schema release
   and an isolated restore from independent backup. Quarantining a shared
   artifact stops it being served without corrupting either learner's history.

These scenarios are necessary implementation gates, not merely post-launch
manual checks.

## Deferred Decisions

Deferred beyond the steel thread are a commonly-suppressed prior, sophisticated
content weighting and evaluation, user-facing export/deletion, Postgres,
multi-instance service operation, zero-downtime releases, a general admin UI,
broader privacy/analytics governance, public signup, billing, and
organizations.
