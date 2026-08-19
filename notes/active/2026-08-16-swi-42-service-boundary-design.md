# SWI-42 private-beta service-boundary design

status: winding-down
type: work-bundle
created: 2026-08-16
retire-when: SWI-42 is accepted/dispositioned and the hosted-beta implementation steel thread is dispatched
related:
  - STABILITY_FRONTIER.md
  - PLANS/hosted-beta-tenancy-table-map.md
  - PLANS/beta-web-service-plan.md
  - docs/private-beta-service-boundary.md
  - PLANS/hosted-beta-implementation-steel-thread.md
  - notes/active/2026-08-14-meta-project-direction-todo.md
  - https://linear.app/swimj/issue/SWI-42/define-the-private-beta-service-boundary-and-hosted-architecture

This is medium-lived working memory for the exploratory design. It is not an
accepted architecture contract and does not need to mirror the task
conversation. Update it when a finding, fork, rationale, or decision is worth
carrying across drill-downs or session boundaries.

## Outcome

Produce a human-accepted private-beta service contract and hosted architecture
decision that is specific enough to generate an implementation steel thread
without letting infrastructure defaults silently choose product ownership.

The accepted frontier remains authoritative. In particular, this design must
preserve the invite-only Mandarin cohort, isolated learner state,
shared/versioned base content as a distinct concept, normal optional
reflection, intentional releases, recoverable data, bounded support access,
and primary dogfood-history migration as proof.

## Working model

The top-level task owns the integrated design, cross-topic tradeoffs, decision
checkpoints, and final recommendation. Bounded drill-downs may investigate
schema ownership, tenancy options, identity/auth, release/recovery, operational
trust, or vendor fit. Each drill-down returns evidence, alternatives, and open
questions to this note; it does not independently accept a coupled decision.

Use this decision ladder so exploration visibly converges:

1. **Settled input** — accepted frontier or canonical product contract.
2. **Verified evidence** — current code, schema, operating behavior, or a
   primary vendor capability verified for this task.
3. **Alternative** — a credible option evaluated against explicit criteria.
4. **Candidate decision** — the current recommendation and rationale, still
   reversible and awaiting a checkpoint.
5. **Accepted decision** — explicitly accepted by the human.
6. **Graduated contract** — written into the canonical architecture/spec owner
   and represented in the implementation steel thread.

Do not move sticky topology, ownership, identity, migration, or authorization
choices from candidate to accepted without a human checkpoint. Vendor
selection follows the service contract and criteria.

### Progress rhythm

- Periodically consolidate durable findings here rather than transcribing chat.
- Keep a short decision register and unresolved-question list.
- At each checkpoint, state what is now known, the credible alternatives, the
  current recommendation, what it commits us to, and its reconsideration
  trigger.
- Graduate accepted detail into canonical docs only when the coupled decision
  is stable enough; update the frontier only after explicit approval.

## Design workstreams

1. Refresh the durable-object and table inventory from current code and schema.
2. Define logical ownership and historical content-version references.
3. Compare the four required physical-tenancy/storage topologies.
4. Define account/request identity and authorization enforcement boundaries.
5. Define migration, release, backup, restore, rollback, and failure contracts.
6. Define operational trust, provider exposure, diagnostics, recovery, and
   bounded support access.
7. Apply the resulting criteria to auth, hosting, database, and deployment
   vendors.
8. Synthesize the hosted-beta implementation steel thread, acceptance gates,
   follow-ups, and proposed canonical-doc/frontier changes.

The workstreams are coupled but need not be explored in strict sequence. The
inventory and service invariants should precede topology acceptance; vendor
shortlisting should follow the contract criteria.

## Decision register

| ID | Decision | Current rung | Notes |
| --- | --- | --- | --- |
| D1 | Shared content and learner-private state ownership model | graduated contract | Private learner evidence and state; optimistic shared content trial; no canonical tier; uniform random selection among eligible immutable artifacts. |
| D2 | Physical tenancy and storage topology | graduated contract | One service and one shared SQLite database with explicit learner ownership; Postgres remains a later evidence-triggered migration. |
| D3 | Account, request identity, and authorization boundary | graduated contract | One account to one learner; server-derived explicit learner context; separate attributable support principal; conventional auth implementation. |
| D4 | Release, migration, rollback, backup, and restore contract | graduated contract | Hourly recovery target, planned maintenance, pre-release backup, smoke gate, exercised restore, and deterministic dogfood cutover. |
| D5 | Operator support, diagnostics, privacy, export/delete, and provider trust contract | graduated contract | Candid provider disclosure; no training by default with bounded retention; bounded cost/logging; attributable support; export and general deletion tooling deferred. |
| D6 | Vendor/topology package | graduated provisional choice / spike-gated | Fly.io + one Volume + Litestream to independent S3-compatible storage; Clerk auth; embedded SQLite; retain current OpenAI reflection path. Railway and WorkOS AuthKit are the fallback pair. |
| D7 | Hosted-beta implementation steel thread and acceptance gates | graduated plan | Two identities, dogfood migration, isolation, shared content, intentional release, and exercised restore form the end-to-end proof. |

## Consolidation — 2026-08-19

The accepted decisions have graduated into
[`docs/private-beta-service-boundary.md`](../../docs/private-beta-service-boundary.md).
The ordered implementation slices and acceptance gates have graduated into
[`PLANS/hosted-beta-implementation-steel-thread.md`](../../PLANS/hosted-beta-implementation-steel-thread.md).
`STABILITY_FRONTIER.md` now treats the design boundary as settled and the steel
thread as the next implementation focus. This note remains only as the richer
exploration and research record until SWI-42 receives final disposition.

## Initial evidence

- The current runtime is one Express process opening one globally configured
  SQLite database; the database file is the implicit learner boundary.
- The HTTP API has no account or authorization context.
- The historical tenancy map covered 18 tables and explicitly predates the
  reflection and production-cue subsystems; it is useful rationale but not a
  current inventory.
- The historical web-service plan assumed Postgres early. SWI-42 explicitly
  reopens that assumption because the current synchronous SQLite persistence
  layer makes it a meaningful rewrite rather than a neutral hosting step.
- Current reflection generation retains bounded but potentially sensitive
  evidence and diagnostics. Provider credentials and calls are backend-only;
  broader deployment still needs retention, disclosure, access, and secret
  handling policy.

## Refreshed current inventory

Verified from the current persistence implementation on 2026-08-16: the live
schema has **30 steady-state application tables**. The historical 18 tables are
all still present. The 12 additions are four reflection tables and eight
production-task/cue tables. Temporary migration tables and SQLite internals are
not included.

### Historical 18, still present

- Mixed content and learner state: `words`, `word_meanings`.
- Shared/reference under current behavior: `word_lookup_aliases`.
- Learner-owned state and history: `user_word_priority`,
  `word_study_admission_state`, `word_skill_state`,
  `daily_new_word_intake`, `review_session_summaries`, `study_sessions`,
  `study_attempt_events`, `study_events`, `word_skill_relevance`,
  `contrast_candidate_intake`, and `study_content_feedback`.
- Mixed shared/private content shapes: `contrast_clusters`,
  `contrast_cluster_members`, and `contrast_prompts`.
- Operational metadata with an undefined scope namespace: `app_metadata`.

### Four reflection additions

- `reflection_artifacts` — immutable successful evidence bundle, validated
  result, and provider/model/prompt/schema provenance.
- `reflection_generation_runs` — every concluded provider attempt, including
  exact retry bundle, diagnostic output, usage, and price snapshot.
- `reflection_proposal_reviews` — learner disposition for immutable proposals.
- `reflection_operation_invocations` — immutable authorization plus mutable
  application status, effects, and errors.

These are learner-owned evidence and authorization history with service
provenance. `reflection_generation_runs` is the sharpest retention boundary:
local dogfood intentionally retains failed-output diagnostics verbatim within
size bounds. Hosted beta needs explicit provider-egress, secret-scrubbing,
retention, support-access, export, deletion, and cost-record policy.

### Eight production-task/cue additions

- `production_tasks` — deterministic default-production task per word;
  logically shared/reference if its word is shared.
- `production_cues`, `production_cue_accepted_words` — immutable cue content
  and accepted-answer space; currently mixed/unresolved because
  manual/reflection-created cues may be private.
- `production_cue_lifecycle_events`, `production_cue_activation_state` —
  append-only lifecycle and current projection; currently cannot distinguish a
  learner overlay from shared editorial state.
- `production_cue_evidence_records`, `production_cue_evidence_projection` —
  raw/authorized cue evidence and derived counts; learner-owned.
- `production_recheck_demands` — one-shot scheduler/history demands linked to
  source and consuming attempts; learner-owned.

The current schema also relies on immutable/no-delete triggers and partial
unique indexes to preserve reflection and production provenance. Hosted design
must retain the semantic invariants even if the physical database changes.

### Inventory implications

- A shared content reference does not prove learner ownership of a state or
  evidence row; every learner-owned cross-reference needs an unskippable
  same-learner boundary.
- Contrast content and production cues have the same unresolved shape: seeded
  or base content and learner-created content occupy one record shape without
  an explicit scope.
- Account export/delete policy may conflict with intentionally immutable audit
  chains. The design must define supported erasure/anonymization boundaries
  rather than assuming either indefinite retention or destructive cascades.
- `app_metadata` needs explicit deployment, shared-content-version, and
  learner-import scopes before migration/release logic relies on it.
- Historical attempts, reflection evidence, authorized operations, and cue
  evidence require enough content identity/version context to remain truthful
  when shared content changes.

## Open questions

- What is the complete current table/durable-object inventory, including
  production tasks, cues, reflection artifacts, generation runs, reviews,
  invocations, operational metadata, and retained payloads?
- Which current mixed rows must be physically split for beta, and which can be
  preserved through an explicit scoped overlay or copy-on-write contract?
- What minimum shared-content version identity must historical attempts,
  evidence bundles, proposals, and applied effects retain?
- Which topology gives adequate isolation and recoverability for 3-8 learners
  without creating unsafe manual operational fan-out?
- Where is learner identity introduced and how is it made unskippable across
  reads, writes, provider calls, background recovery, migration, and support?
- What is the smallest release/restore contract that is both honest and
  testable before valuable beta data accumulates?
- What support data can an operator see by default, what requires escalation,
  and how are exceptional repairs attributable?

## Content-sharing design tension

### Human input — 2026-08-18

The product intent leans more strongly toward native/default content sharing
than the initial private-by-default recommendation reflected. Requiring every
learner to encounter the same bad default, pay for reflection, and process a
repair wastes the obvious compounding benefit of improved content. Any
learning value in friction should be intentionally designed rather than an
accidental consequence of isolated content.

Additional considerations:

- The starting corpus may itself bias the apparent need for customization,
  although its glosses come from widely used Pleco data; this raises questions
  about whether conventional dictionary content is fit for production study,
  not merely whether this corpus is unusually weak.
- Private-only content simplifies the first hosted migration, but if sharing
  remains intended it defers rather than removes the architectural,
  operational, and UI complexity of promotion.
- Explicitly private content is likely useful eventually, but may be a later
  feature rather than a defining beta capability.
- AI generation may create a higher surface-quality floor than unconstrained
  learner-authored material. Longer-term learner feedback, usage outcomes,
  embeddings, and scheduling/selection policy could rank content by quality
  and learner fit rather than relying on one universal artifact.

### Reframed axes — candidate model, not accepted

The earlier question incorrectly collapsed three separate concerns:

1. **Provenance/ownership** — who or what produced the content and which
   private evidence motivated it.
2. **Publication status** — whether the content is private, a service-visible
   candidate, beta-visible, quarantined, retired, or otherwise shareable.
3. **Learner activation** — which version is active, suppressed, preferred, or
   historically served for a particular learner.

This permits shared-first product intent without letting one learner's ordinary
action directly overwrite a shared content artifact. A generated repair can be a
service-level candidate with private source evidence, become active for its
source learner immediately after authorization, and later become available to
other learners through a lightweight publication gate. Historical attempts
continue to reference the exact version served.

The open design question is therefore not simply “private or shared by
default.” It is: which generated outputs may enter a shared candidate pool,
what gate permits broader serving, and which learner-specific evidence and
activation choices must remain private?

### Human direction — optimistic publication, 2026-08-18

The desired orientation is optimistic sharing rather than routine manual
curation. Model quality plus the source learner's judgment is expected to be a
high enough initial bar that an approved reusable artifact should normally
become available to other learners automatically. Requiring operator review of
every candidate would create unwanted toil and could suppress material that an
operator underrates but other learners value.

A gate should still exist as a fallback control when evidence shows a clear
quality drop. Possible later assistance includes a judgment agent, but the
default operating model should not depend on manual pre-publication review.

Candidate refinement, not yet a complete accepted contract:

- Learner approval activates the artifact for the source learner and normally
  moves sanitized reusable content into a shared trial/probation state.
- Shared trial content may be served to other eligible learners without manual
  review; this is distinct from immediately replacing the baseline default
  for everyone.
- Exact immutable versions, a stable baseline fallback, attributable feedback, and
  rapid retirement provide the initial quality circuit breaker.
- Manual or agent-assisted review is exception-triggered by reports, anomalous
  outcomes, validation conflicts, or a demonstrated quality drop rather than
  required for every publication.
- Private evidence and learner-authored notes never become shared merely
  because the derived reusable artifact is shared.

Still to decide: which artifact kinds qualify for automatic shared trial,
whether source-learner approval is sufficient for every eligible kind, how
selection distributes trial content, what signals trigger quarantine or
retirement, and what evidence changes how strongly trial content is selected.

### Human direction — no canonical-content assumption, 2026-08-18

The design should not introduce a `canonical` or “blessed content” layer for
the beta. The project's evidence is precisely that widely used or
authoritative-looking source material may still be a poor fit for a particular
learning task. The imported base is a reproducible starting snapshot and
fallback, not a claim of superior pedagogical truth.

Immutability, provenance, release reproducibility, and delta layering do not
require canonical authority. Keep these concerns separate:

- **Content identity and lineage:** immutable artifact/version plus its source
  and derivation.
- **Publication lifecycle:** shared trial, available, quarantined, or retired.
- **Selection policy:** how likely an eligible artifact is to be served for a
  learner/context, informed by mixed quality and learning signals.
- **Release snapshot:** which content versions and policies a deploy can
  reproduce, without declaring them universally best.
- **Learner-private state:** evidence, notes, reflection analysis, scheduling,
  preferences, and activation history; never shared as content.

An initial imported artifact may remain a stable fallback because it is
operationally useful and reproducible, not because it is canonical. Evidence
may shift selection toward or away from any published artifact without
rewriting its historical identity.

### Candidate beta selection policy — 2026-08-18

When multiple shared artifacts are eligible for the same learning purpose,
start with uniform random selection. Conceptually, selection policies may be
probability distributions over the eligible set, but the beta does not need a
general optimizer or policy framework before actual use reveals a need.

The minimal contract is:

- first filter out artifacts that are ineligible for the learner/context,
  quarantined, retired, or explicitly suppressed for that learner;
- select uniformly at random from the remaining eligible artifacts, including
  imported baseline artifacts; origin does not imply a special weight;
- use a defined task-level fallback only when no content artifact is eligible;
- persist the exact artifact/version and served answer space with the attempt;
  reproducibility concerns the historical fact of what was served, not replay
  of the random draw; and
- keep selection randomness injectable/deterministic in tests without making a
  production seed part of the product contract.

Later evidence may change weights, eligibility, or contextual fit. That is a
refinement of the distribution rather than a rewrite of content identity or
publication lifecycle.

### Accepted beta content direction — 2026-08-18

- Learner evidence, notes, reflection analysis, scheduling, preferences, and
  activation history are private and never shared as content.
- Reusable generated content normally enters shared trial automatically after
  source-learner approval and sanitization.
- Shared content has immutable identity, lineage, and publication status; the
  beta has no canonical or blessed content tier.
- Trial and available content are eligible for automatic serving. Quarantined
  and retired content are not.
- Selection is uniform random across eligible content for the same learning
  purpose, including imported content; later weighting is a refinement.
- Every historical attempt preserves the exact artifact/version and answer
  space served.
- Imported content is a reproducible bootstrap snapshot, not an authority
  claim.

## Account and request identity — candidate contract

Most of this boundary should use conventional hosted-service practice rather
than novel product policy:

- One beta account maps to exactly one learner identity. No organizations,
  shared accounts, billing identities, or general role hierarchy.
- Authentication establishes a server-side principal. Clients never select or
  assert a learner id for an ordinary learner request.
- Every learner-private read, write, provider invocation, background job,
  recovery action, and durable effect receives explicit learner context.
- Authorization is enforced beneath the HTTP handler at the service/domain or
  persistence boundary so a forgotten route check cannot expose another
  learner's data.
- Shared-content references do not establish ownership of learner rows.
  Cross-references among private rows must remain within one learner boundary.
- Sign-out invalidates the relevant authenticated session. Account disablement
  prevents new work and provider calls without deleting history.
- Invite creation and operator-assisted recovery are explicit administrative
  actions with attributable audit records; public signup and self-service
  recovery are deferred.
- Background work stores the learner identity that authorized or originated
  it; it never infers a learner from process-global configuration.
- Operator support uses a distinct support principal and explicit support
  context rather than impersonating a learner. Repair uses registered,
  attributable commands rather than improvised production-database edits.

Authentication mechanism, session transport, provider, token/session expiry,
and deployment integration remain downstream engineering/vendor choices as
long as they satisfy this contract.

Material trust choices still needing human orientation are the default scope
of operator visibility into raw learner evidence, the required reason/consent
for support access, and the beta posture for export and deletion. These belong
with the operational-trust discussion but constrain identity design.

### Accepted beta identity and support direction — 2026-08-18

- Use conventional hosted authentication rather than inventing credentials or
  protocols. Keep external account identity distinct from the stable learner
  identity even though the beta maps them one-to-one.
- Beta learners receive candid disclosure that this is a small supported beta,
  not a mature high-privacy service. The operator may inspect private data for
  an explicit support purpose, intends not to mine usage data for routine
  product discovery, and expects most product learning to come from direct
  learner feedback.
- Support access remains attributable and read-only by default. Exceptional
  repair uses a narrow recorded operation rather than routine direct database
  editing.
- Serious launch-grade privacy, analytics-governance, export, deletion, and
  formal access policy may be deferred until the service approaches a serious
  launch.
- Deferral does not weaken baseline beta invariants: authenticated learners
  cannot cross account boundaries; credentials and provider secrets remain
  server-side; private evidence is not published as shared content; and
  accidental or unexplained operator access is not normal behavior.

## Accepted beta physical topology — 2026-08-18

Use one hosted service and one shared SQLite database with explicit learner
ownership for all private state and evidence. Shared content lives natively in
the same database under the accepted publication and selection model.

Rationale:

- shared content is a core product behavior rather than a later replication
  layer;
- explicit ownership work happens before further development deepens the
  implicit single-learner schema;
- learner-authorized private effects and automatic shared publication can use
  coherent local transactions rather than cross-database coordination;
- the 3-8 learner beta does not currently justify a Postgres rewrite; and
- one service/database avoids per-learner migration, backup, deployment, and
  support fan-out.

Accepted costs and constraints:

- every private query and cross-reference needs enforced learner scoping;
- one database defect has cohort-wide blast radius;
- per-learner restore is not naturally a file-level operation;
- the hosted beta remains a single-database/single-writer system; and
- SQLite write contention and transaction latency should become observable
  once the service is running.

Postgres remains a credible later destination. Settling logical ownership now
reduces the risk that future product development blocks semantic migration.
Do not build a speculative dual-database abstraction or constrain the current
design to an imagined lowest common SQL subset. Physical migration cost may
still grow with data volume, SQLite-specific triggers/constraints, and service
availability requirements, so retain explicit reconsideration triggers:

- sustained lock waits, write contention, or transaction latency that affects
  learner operations;
- need for multiple concurrent application instances or horizontal scaling;
- backup/restore or operational tooling that proves inadequate;
- cohort or data-volume growth beyond the bounded beta assumptions; or
- a managed-service requirement that materially improves reliability enough to
  justify the rewrite.

## Release, backup, and recovery — candidate contract

### Accepted recovery calibration — 2026-08-18

- Target recovery point objective: at most approximately one hour of
  acknowledged activity lost after a catastrophic storage failure.
- Such loss would still be a serious and embarrassing incident, not normal
  behavior; the objective calibrates investment rather than lowering concern.
- Do not build replication or high-availability machinery aimed at five-nines
  durability during the product-experimentation beta.
- Backup failure, staleness beyond the target, and failed restore verification
  must be visible to the operator rather than silently degrading the promise.

Candidate implementation-independent consequences:

- frequent online backups to storage independent from the live database,
  initially hourly;
- mandatory pre-migration/release backup;
- restore exercised before inviting learners and after material changes to the
  backup mechanism or schema/migration path;
- operator-assisted same-day recovery rather than a formal uptime SLA; and
- retention of recent recovery points plus identifiable release checkpoints,
  with exact storage policy selected alongside the host.

### Accepted release availability posture — 2026-08-18

Planned downtime is acceptable for the private beta; continuous availability
has little product importance at this stage. Use a maintenance window for every
schema-changing release:

1. stop new sessions and writes and quiesce in-flight work;
2. create the identified pre-release backup;
3. apply the rehearsed versioned migration;
4. start the matching application version;
5. smoke-test two learner identities, isolation, shared content, and the core
   study path;
6. reopen writes only after the smoke gate passes; and
7. record the release, schema version, result, and recovery point.

Before writes reopen, an incompatible failure restores the pre-release backup
without losing learner activity. After reopening, database restore would lose
new writes, so rollback limits and forward repair must be explicit. Do not add
online dual-schema compatibility or zero-downtime migration machinery unless
availability requirements materially change.

## Primary dogfood-history migration — candidate contract

- The current primary dogfood database is the sole required legacy migration;
  external beta learners start fresh.
- Develop and rehearse migration against recoverable copies. The source remains
  untouched until the hosted result is verified and remains retained read-only
  through the initial cutover period.
- A versioned deterministic migration assigns the dogfood learner identity,
  separates shared content from learner-private state, preserves historical
  references and immutable served snapshots, and emits a machine-readable
  validation report.
- The import is transactional or fails before declaring the hosted account
  usable. It must not leave a partially trusted learner history.
- Cutover stops local writes, takes a final source backup, runs the rehearsed
  migration, validates the hosted account, and then establishes the hosted
  service as the sole writer. Do not dual-write or allow ambiguous split-brain
  history.

Recommended initial classification:

- imported lexical, meaning, alias, and seeded study content becomes ordinary
  `available` shared content, without a canonical-quality claim;
- existing active learner/reflection-created reusable cues, clusters, and
  prompts become `shared_trial` after a one-time migration authorization and
  sanitization check;
- inactive or historically replaced content is retained with its truthful
  inactive/retired state for provenance, not reactivated;
- learner notes, attempts, responses, reflection evidence/analysis, scheduling,
  priorities, suppressions, feedback, and authorization history remain owned
  by the dogfood learner; and
- operational/import metadata receives an explicit deployment,
  content-snapshot, or learner-import scope rather than remaining in an
  ambiguous global keyspace.

Acceptance compares representative counts and invariants and exercises actual
behavior: the dogfood learner signs in with scheduling/history intact; prior
attempts and reflection/cue provenance remain interpretable; a second learner
cannot access private history; shared eligible content can be served without
exposing its source evidence; and the migrated state survives an intentional
release plus exercised restore.

### Suppression and historical bad-prompt backlog

Active reusable custom content is accepted for migration as `shared_trial`.
Suppression needs a semantic split rather than a blanket rule that every
reflection mutation becomes shared:

- Current `suppress_definition_production` means the training goal is not
  worthwhile **for the learner even if a good prompt could be written**. It is
  learner curriculum/relevance state and should remain private.
- A report that a particular cue or prompt is defective is content feedback.
  Its resulting artifact disposition—quarantine or retirement—is shared.
- A conclusion that a production task is unsuitable for essentially every
  learner is a shared task-level eligibility/disposition decision, distinct
  from learner suppression and requiring its own explicit operation.

Therefore reflection application is not uniformly shared: generated reusable
content and content-level dispositions may be shared, while changes whose
meaning is learner preference, relevance, scheduling, or evidence remain
learner-private. Operation kind/scope must make this explicit.

The historical bad-prompt backlog is valuable migration-preparation work. Use
a one-time reflection-like agent-assisted workflow to classify each report and
propose one of: create shared-trial replacement content; quarantine/retire a
specific shared artifact; make a learner-private suppression; propose a shared
task-level disposition; or leave unresolved. The operator reviews the bounded
proposal set.

Do not run nondeterministic model judgment inside the schema/data migration.
Run this as a separate idempotent preprocessing or post-import tool that emits
reviewable proposals and records authorized durable effects. The migration
then moves already-recorded state deterministically, and agent failure cannot
leave a partially migrated database.

### Accepted initial suppression scope and future direction — 2026-08-18

- Initial production suppression remains learner-private relevance state.
- Shared content repair, artifact quarantine/retirement, and any future
  task-level disposition remain distinct shared operations.
- A future “commonly suppressed” bucket may provide a shared default or prior
  that saves learners repeated toil without converting individual suppression
  events into universal facts.
- Explicit learner intent must override such a default. Manually prioritizing a
  word, or a future top-down discovery/admission action, may opt that learner
  back into the relevant practice even when the shared prior normally excludes
  it.
- The effective precedence to preserve conceptually is: explicit learner
  override, then assigned/shared default policy, then system fallback.

Do not build the aggregate bucket for the first beta. Preserve enough
provenance to distinguish an explicit learner choice from a default-derived
effective state. Avoid a self-reinforcing loop in which default-derived
suppression is counted as independent evidence that the default is correct.

## Operational trust — candidate beta posture

### Provider training and retention — verified 2026-08-19

Do not conflate model training with provider retention. Current paid/commercial
API terms from major providers commonly exclude customer prompts and outputs
from model training by default while still retaining them temporarily for
abuse monitoring, reliability, or stateful API behavior. Examples inspected:

- OpenAI API: no training unless the customer opts in; ordinary abuse logs may
  retain customer content for up to 30 days, with endpoint-specific application
  state and approval-based modified/zero-retention controls.
- Anthropic API: commercial inputs/outputs are not used for training by
  default and are normally deleted within 30 days, subject to policy/legal
  exceptions and separately agreed zero-retention terms.
- Paid Gemini API: prompts/responses are not used to improve products by
  default, while limited abuse/reliability retention and optional developer
  logging still apply.

Vendor criteria for the beta should therefore require **no training by
default, documented bounded retention, and no accidental opt-in logging or
feedback sharing**. Zero provider retention is not a beta requirement. Recheck
the selected provider's exact endpoint and account settings at implementation
and before launch because terms and feature-specific storage change.

Primary references:

- https://platform.openai.com/docs/models/default-usage-policies-by-endpoint
- https://privacy.anthropic.com/en/articles/7996866-how-long-do-you-store-my-organization-s-data
- https://privacy.anthropic.com/en/articles/7996885-how-do-you-use-personal-data-in-model-training
- https://ai.google.dev/gemini-api/docs/zdr

### Export and deletion scope — candidate refinement

The private beta does not need self-service export, polished portability, or a
general deletion product. Do not promise these features merely to mimic a
mature launch posture.

The minimum boundary worth preserving now is:

- no user-facing export implementation or beta SLA;
- immediate operator account disablement when a learner leaves;
- clear learner ownership on all private rows so later export/deletion is
  tractable;
- shared artifacts do not require a publicly visible or permanently
  identifying link to their source learner; and
- if a beta learner explicitly requests removal, use an operator-run live-data
  purge/anonymization procedure and let independent backups age out under the
  disclosed retention window.

This avoids building a launch feature now while also avoiding indefinite live
retention against an explicit request. Before broadening beyond the trusted
cohort, define and test a complete export/deletion contract and obtain legal
guidance appropriate to the actual users and jurisdictions.

### Accepted beta operational-trust direction — 2026-08-19

- Disclose that optional reflection sends bounded relevant study evidence to a
  third-party model provider.
- Select commercial API terms with no training by default, documented bounded
  retention, and no accidental opt-in sharing; zero retention is not required.
- Keep secrets server-side; enforce request/resource/cost bounds and a
  reflection kill switch so provider failure or spend never blocks study.
- Ordinary operational logs exclude raw answers, evidence, prompts, generated
  output, credentials, and secrets. Restrict and time-bound sensitive
  diagnostics separately.
- Support access remains purpose-bound, attributable, and read-only by default;
  exceptional repair uses recorded commands.
- Do not build or promise beta data export, self-service deletion, or a general
  deletion product. Support immediate account disablement and preserve clear
  ownership/deletion boundaries. Handle an exceptional explicit removal
  request manually against live data and let backups age out normally.
- Revisit formal privacy, behavioral-data use, export, deletion, and legal
  obligations before inviting a broader or less personally trusted cohort.

## Vendor shortlist — researched 2026-08-19, provisional choice accepted

Status: accepted as the provisional beta direction on 2026-08-19, contingent
on the narrow integration/restore spike below. A failed spike switches to the
named fallback without reopening the product/service contract.

### Candidate package

- **Application/deployment:** one Fly.io Machine in Singapore or Tokyo, with
  autoscaling/autostop disabled unless proven compatible with continuous backup
  operation and the single-writer contract.
- **Live storage:** embedded SQLite on one encrypted Fly Volume. The Volume is
  explicitly unreplicated local storage, so Fly snapshots are a secondary
  recovery layer rather than the primary backup promise.
- **Independent backup:** Litestream continuously replicating WAL changes to a
  narrowly credentialed, encrypted, versioned S3-compatible bucket independent
  from Fly. Alert on replication age and exercise isolated restore.
- **Authentication:** Clerk restricted mode and invitations, with verified
  provider sessions resolving through a local stable learner-account mapping.
- **Model provider:** retain the current tested OpenAI API path under commercial
  no-training-by-default terms and bounded retention. Revisit only if cost,
  quality, availability, or regional/provider policy gives concrete reason.

### Credible fallback package

- **Railway** is the ease-of-operation hosting alternative. Its volume forces a
  single mounted deployment and its built-in backups explicitly support
  SQLite, but automated cadence is only daily/weekly/monthly, so independent
  hourly replication remains necessary.
- **WorkOS AuthKit** is the auth alternative. It has native closed registration
  and generous pricing, but application-wide invitations may be accepted with
  an email other than the invited address and its Express integration/identity
  portability is less direct for this service.

### Rejected for this beta

- Render is viable but its disk documentation warns against treating volume
  snapshots as custom-database recovery and restricts disk access from
  pre-deploy/one-off jobs.
- Supabase Auth creates an otherwise-unused managed Postgres project and needs
  separate production SMTP; Auth0's private invitation flow is disproportionately
  bespoke; self-hosted Better Auth makes this service own authentication and
  email/security operations.
- Turso/libSQL or other remote SQLite services change the accepted local
  embedded-SQLite architecture. Serverless/ephemeral hosts do not fit a local
  persistent SQLite file. A raw VPS adds OS/deploy/TLS/monitoring toil without
  product benefit.

### Candidate-specific caveats

- Fly Volumes are pinned to one host/region and are not replicated. This package
  is acceptable only because the independent backup/restore contract is real.
- Release commands cannot mount the Fly Volume. Migrations must run through a
  controlled maintenance/startup path or an explicitly attached Machine
  operation, not a generic pre-release command.
- Clerk's managed subject is never the learner owner key. Keep
  `(auth_provider, provider_subject) -> learner_id` locally and enforce local
  disablement even if plan-level provider controls are limited.
- The final implementation spike must verify invite restriction, session
  revocation, volume persistence across deploys, SQLite/WAL/Litestream
  interaction, independent restore, and metrics before vendor choice graduates.

Official starting references:

- https://fly.io/docs/volumes/overview/
- https://fly.io/docs/launch/deploy/
- https://fly.io/docs/monitoring/metrics/
- https://litestream.io/how-it-works/
- https://litestream.io/guides/s3/
- https://clerk.com/docs/guides/secure/restricting-access
- https://clerk.com/docs/guides/users/inviting
- https://clerk.com/docs/expressjs/getting-started/quickstart
- https://docs.railway.com/volumes/reference
- https://docs.railway.com/volumes/backups
- https://workos.com/docs/authkit/invite-only-signup

## Drill-down log

### 2026-08-16 — current schema and durable-object inventory

Code inspection refreshed the historical 18-table map to 30 current tables.
No historical table has been removed; reflection and production-cue behavior
was added as 12 new tables with substantial immutable evidence and provenance.
The inventory supports logical ownership analysis but does not itself select a
physical topology. Primary evidence lives in `server/db/persistence.ts`,
`server/db/reflections.ts`, `server/db/production-cues.ts`, and
`server/db/connection.ts`.
