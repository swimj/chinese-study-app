# Hosted Beta Tenancy Table Map

Status: historical pre-design inventory. It was complete for the 18-table
schema inspected at the time, but it predates the reflection and production-cue
subsystems and is not a current hosted-beta inventory or implementation
contract. The private-beta service-boundary design must refresh it from the
current schema. Its preserve-the-layers rationale remains useful unless the
new design explicitly replaces it.

This document classified every table in the SQLite schema that existed when it
was written by present role and likely hosted ownership. It answered the
initial inventory question in
[`beta-web-service-plan.md`](./beta-web-service-plan.md) without choosing a
database engine, request/user context, migration shape, or tenancy
implementation.

## Reading The Map

Today the database file is the effective ownership boundary: one local database
contains one learner's content, state, history, and database-level provenance.
No current table has a row-level tenant discriminator. The classifications
below are therefore logical hosted-beta classifications, not descriptions of
enforced behavior.

The likely hosted ownership categories are:

- **Shared content/reference** — reusable across learners and normally curated
  or loaded by the service.
- **User-owned learner state/history** — belongs to one learner even when the
  service computes, projects, or summarizes it.
- **Service-operational/provenance** — describes service/database operation,
  imports, or maintenance rather than a learner's study model.
- **Mixed/unresolved** — currently combines ownership classes or may contain
  both shared and user-authored variants.

“Ownership column” below means that a future schema needs an explicit
learner/content owner boundary. It does not select a column name or design how
request context supplies it.

## Near-Term Deferral Constraint: Preserve The Layers

The shared-versus-personal customization policy can be deferred while the
single-user reflection experience takes shape without creating a major
architecture trap, but only if near-term customization remains **logically
additive and reversible relative to its source**.

This does not mean every table must be physically append-only. It means that
when an operation may later prove to be a personal preference, private
override, corpus correction, or candidate universal improvement, the system
should preserve enough information to distinguish:

- the base or pre-operation content/state;
- the proposal and evidence that motivated the operation;
- the user-authorized operation;
- the applied effect; and
- the resulting personal layer or disposition.

A user-visible removal should therefore normally be represented as suppression,
hiding, retirement, replacement, or another attributable disposition rather
than immediately erasing or mutating the source in place. It is easier to
collapse a proven overlay into a new universal base later than to reconstruct
base and personal layers after their differences have been destroyed.

This is an information-preservation rule, not a permanent product or storage
policy. Genuine privacy/account deletion, security cleanup, corrupt-data
removal, and an explicitly authorized universal correction may still require
destructive deletion or replacement. Nor does this rule require event sourcing,
indefinite retention, or a particular overlay schema.

Reflection is likely to expand the range of content customizations before their
eventual ownership is understood. Preserving the layers lets the first
single-tenant experience feel seamlessly personal while keeping later options
open: retain a private customization, promote a broadly useful improvement,
improve the base corpus, or deliberately collapse a distinction once policy is
clear.

The current stability frontier requires original evidence, proposal,
authorization, disposition, and actual effect to remain distinguishable;
requires implementation to remain narrow and reversible; and now explicitly
applies this broader content-preservation constraint to customization
operations. The frontier carries the current-wave invariant, while this section
records its rationale, interpretation, and exceptions.

## Historical Table Inventory (18-table snapshot)

| Table | Present role | Likely hosted ownership | Boundary needed before hosted beta | Planning confidence |
| --- | --- | --- | --- | --- |
| `words` | Stores lexical content (`hanzi`, reading, meanings, examples, base priority) together with personal notes and the learner's lifecycle, learning streak, and coverage dates. | **Mixed/unresolved.** Base lexical fields are plausible shared corpus content; notes and all lifecycle/progress fields are user-owned. | **Split or equivalent explicit overlay.** Shared lexical identity/content must be distinguishable from per-learner state and notes. Decide whether base priority is corpus ranking or learner policy. | **Human confirmation required** for the content/state boundary; the existence of mixed ownership is certain. |
| `word_meanings` | Stores ordered meaning text and a mutable flag controlling whether each meaning appears on production prompts. Rows are seeded from lexical content, while the visibility flag is changed through a learner-facing action. | **Mixed/unresolved.** Meaning text/order is plausible shared content; prompt visibility is a learner preference. | **Split or shared-content customization policy.** Avoid letting one learner's visibility choice mutate a shared meaning row. Decide whether meaning text itself can ever be privately edited. | **Human confirmation required** for customization behavior; per-learner visibility is certain. |
| `user_word_priority` | Stores manual priority bumps, tiers, next-session requirement, and update time for an unstudied word. | **User-owned learner state/history.** | **Ownership column/boundary.** Uniqueness must be scoped to a learner and word rather than only the word. | **Safe planning conclusion.** |
| `word_lookup_aliases` | Provides normalized lookup aliases with relation, source, tags, confidence, and creation provenance; currently used for French priority lookup and loaded from corpus tooling. | **Shared content/reference** under current behavior. | **Explicit policy.** Keep current corpus aliases shared by default; if personal aliases are later allowed, they need a separate user-owned variant rather than silently changing this classification. | **Safe planning conclusion** for current aliases; future personal aliases need human confirmation. |
| `app_metadata` | Holds key/value database build and maintenance facts, including corpus-build provenance and completed maintenance markers. | **Service-operational/provenance.** | **Split or explicit key-scope policy.** Deployment/schema markers, shared content-import facts, and provenance for a particular learner import must not share an undefined global scope. | **Safe role classification; human confirmation required** for key scoping and retention. |
| `word_study_admission_state` | Stores whether and when a review-phase word may be admitted to study. | **User-owned learner state/history.** | **Ownership column/boundary.** The current word-only key is valid only because the database is single-learner. | **Safe planning conclusion.** |
| `word_skill_state` | Stores enabled state, intervals, last-study/due times, and ease per word and skill. It is the scheduler's durable projection of learner evidence. | **User-owned learner state/history.** | **Ownership column/boundary.** Skill-state identity must be scoped to a learner, word, and skill. | **Safe planning conclusion.** |
| `daily_new_word_intake` | Counts completed new-word intake by UTC day for current policy enforcement. | **User-owned learner state/history.** | **Ownership column/boundary.** A day key cannot be global across learners. Timezone policy is separate and remains out of scope here. | **Safe planning conclusion.** |
| `review_session_summaries` | Stores per-session completion/failure counts used to calculate daily and rolling failure-rate analytics. | **User-owned learner state/history.** It is derived data, but still describes one learner. | **Ownership column/boundary.** Also decide whether this derived summary is disposable/rebuildable or part of supported export/history. | **Safe ownership conclusion; human policy needed** for retention/rebuildability. |
| `study_sessions` | Identifies a learner's study session and tracks start/end plus event-processing state and timestamps. | **User-owned learner state/history**, with service-managed processing fields. | **Ownership column/boundary.** Operator processing responsibility does not make the underlying session service-owned. Retention and support-access policy remain explicit decisions. | **Safe ownership conclusion; human policy needed** for retention and operator access. |
| `study_attempt_events` | Records accepted post-undo learner responses, outcomes, ratings, served-content references, metadata, and projection status. | **User-owned learner state/history.** These rows are also high-value diagnostic and forensic evidence. | **Ownership column/boundary plus explicit provenance policy.** Decide retention, export/deletion behavior, support access, and how much response content is appropriate to retain. | **Safe ownership conclusion; human confirmation required** for forensic/privacy policy. |
| `study_events` | Records management and other study events, payload/content references, and projection status; these events can explain later scheduler, suppression, intake, or feedback state. | **User-owned learner state/history.** Service projection metadata does not change the event's learner ownership. | **Ownership column/boundary plus explicit provenance policy.** Decide retention, deletion, support visibility, and required evidence when a source event is removed. | **Safe ownership conclusion; human confirmation required** for forensic/privacy policy. |
| `word_skill_relevance` | Stores learner-specific relevance decisions such as production suppression, with optional source-event provenance. | **User-owned learner state/history.** | **Ownership column/boundary.** The projection and its source event must resolve within the same learner boundary. | **Safe planning conclusion.** |
| `contrast_candidate_intake` | Stores learner mistake/management intake, candidate text, optional matched corpus word, personal note, status, and source evidence. | **User-owned learner state/history.** Candidate text and notes may be sensitive even when linked to shared words. | **Ownership column/boundary plus explicit lifecycle policy.** Decide retention after resolution and whether any candidate may be promoted into shared content only through an explicit curation action. | **Safe ownership conclusion; human policy needed** for retention and promotion. |
| `study_content_feedback` | Stores a learner's bad-prompt reports/resolutions, notes, content target, action kind, and optional source event. | **User-owned learner state/history** at capture time, with a possible service support/curation workflow. | **Ownership column/boundary plus explicit access/aggregation policy.** Service review must not erase who owns the report or imply that one learner's resolution is global. | **Safe ownership conclusion; human policy needed** for admin visibility, aggregation, and global resolution semantics. |
| `contrast_clusters` | Stores manually editable cluster titles and notes; clusters can come from dev/seed data or be created and merged through the learner-facing intake/editor flow. | **Mixed/unresolved.** The same shape currently represents seeded/curated content and personal authored content. | **Ownership/scope discriminator or shared/user split, plus publication policy.** Decide whether notes are editorial, personal, or separately modeled. | **Human confirmation required.** |
| `contrast_cluster_members` | Relates words to clusters and stores editable nuance notes and display order. Membership participates in both seeded clusters and learner-created/edited clusters. | **Mixed/unresolved**, inherited from the cluster, with additional ambiguity around personal versus editorial nuance notes. | **Ownership inherited from an explicitly scoped cluster, with an explicit customization policy.** A learner must not directly mutate membership or notes of shared content unless that behavior is deliberately supported. | **Human confirmation required.** |
| `contrast_prompts` | Stores editable prompt text and explanations for a cluster target; prompts can be seeded or created/edited from intake and are used as served study content. | **Mixed/unresolved.** The current shape does not distinguish curated shared prompts from private learner-authored prompts. | **Ownership/scope discriminator or shared/user split, plus publication and override policy.** Feedback and attempt provenance must continue to identify the content actually served. | **Human confirmation required.** |

### Inventory Totals

| Likely hosted ownership | Table count |
| --- | ---: |
| Shared content/reference | 1 |
| User-owned learner state/history | 11 |
| Service-operational/provenance | 1 |
| Mixed/unresolved | 5 |
| **Total** | **18** |

## Cross-Table Boundaries

### Mixed Ownership Is Concentrated, Not Pervasive

The highest-risk mixture is the lexical root: reusable word/meaning content and
learner progress/preferences currently share rows. The contrast-content graph
has a different form of mixing: the same table shapes hold seeded content and
content created or edited through a personal workflow. Those two cases need not
receive the same eventual solution, but both need an explicit boundary before
multi-user writes are allowed.

The remaining learner-state and history tables have comparatively clear logical
ownership. Their foreign keys to lexical content do not themselves enforce
learner isolation, so hosted-beta planning cannot treat a shared word reference
as a substitute for a learner owner boundary.

### Shared-Content Customization

Current behavior allows a learner to change meaning visibility and freely
create/edit contrast content. If base meanings or curated contrast content
become shared, a hosted service needs to distinguish at least these product
intentions:

- personal preference over shared content;
- private content authored by a learner;
- a private variant or override of shared content; and
- a deliberate curation/publishing action that creates or changes shared
  content.

The default recommendation is that ordinary learner actions never mutate the
shared base. A private preference or private variant should remain private
unless a separate authorized curation flow says otherwise. This is a product
ownership recommendation, not a schema design.

### Provenance And Forensics

Attempt events, general study events, feedback, intake, and projected relevance
form an explanatory chain. The service may need that chain to debug scheduling
or prove what action produced a state change. That forensic value does not make
learner responses, notes, or event history service-owned.

Hosted-beta policy must say:

- which raw responses, notes, content references, and payloads are retained;
- whether account export/deletion includes derived projections and operational
  copies;
- when support/admin users may inspect learner evidence;
- whether resolved feedback/intake remains as history; and
- what remains when a source event or referenced shared content is removed or
  revised.

Content identity/versioning matters to truthful provenance: an event should
remain interpretable against the content actually served. This map identifies
that requirement but deliberately does not design version tables, snapshots, or
migration mechanics.

## Historical Conclusions To Revalidate

These conclusions followed directly from the behavior and schema inspected at
the time. The service-boundary design should use them as hypotheses and
revalidate them against current persistence and retired workflows:

1. The current database file is an implicit single-learner boundary; row-level
   tenancy is not enforced anywhere.
2. Manual priority, admission, skill scheduling, daily intake, session
   analytics, sessions, events, relevance, contrast intake, and feedback all
   describe one learner and must be isolated as learner-owned data.
3. Derived or service-projected learner data remains learner-owned even when
   the service computes it or uses it for diagnostics.
4. Base lookup aliases are reusable reference content under current behavior.
5. The lexical root mixes shared-corpus candidates with learner state and
   customization.
6. The contrast-content graph cannot safely be called either wholly shared or
   wholly private because current seed and learner-authoring paths use the same
   records.
7. Operational/content-import provenance needs a defined scope; a generic
   database-wide metadata namespace is insufficient for a multi-user service.
8. Ownership and referential integrity are separate concerns: references to
   shared content do not prove that two learner-owned rows belong to the same
   learner.

## Recommendations

These are defaults for the next planning step, not accepted product decisions:

1. Treat reusable lexical fields as shared base content and learner lifecycle,
   notes, scheduling, and prompt preferences as per-learner state or overlays.
2. Keep the current corpus lookup aliases shared unless a concrete personal
   alias use case appears.
3. Treat learner-created contrast clusters, membership annotations, and prompts
   as private by default. Treat publication into a curated shared library as a
   separate authorized action.
4. Treat session/event/feedback/intake records as learner-owned data with
   explicit, minimal operator access. Define support and forensic retention
   separately from ownership.
5. Give metadata keys an explicit scope before hosted import or migration work
   relies on them.
6. Preserve enough content provenance that historical attempts and management
   actions remain truthfully interpretable when shared content changes.

## Open Product Questions Requiring Human Confirmation

1. Is the hosted corpus authoritative shared content with per-learner state, or
   may each learner own an independently mutable word record?
2. Can learners edit meaning text and examples, or only choose personal prompt
   visibility and attach notes? If editing is allowed, is it a private override
   or a proposed shared correction?
3. Are seeded contrast clusters/prompts globally curated, assigned per study
   profile, or copied into private learner space during onboarding?
4. What is the exact distinction among an editorial cluster note, a personal
   learner note, and a private rewrite of shared contrast content?
5. Can private contrast content be promoted to shared content? If so, who may
   do it, and does promotion copy, transfer, or reference the private source?
6. Does resolving bad-prompt feedback mean “resolved for this learner,”
   “reviewed by support,” or “fixed globally”? The current field cannot express
   that distinction.
7. What retention, export, deletion, and support-access rules apply to raw
   responses, event payloads, intake notes, feedback notes, and their derived
   projections?
8. Which metadata facts are deployment-wide, shared-content-version-specific,
   or tied to one learner's import?
9. When referenced shared content changes or is removed, what minimum historical
   evidence must remain so attempt and management provenance stays truthful?

At the time, these questions did not prevent using the map as a complete
18-table inventory. They did prevent treating the five mixed tables, metadata
scope, or forensic retention as settled implementation contracts. The current
schema additions independently make the inventory incomplete today.

## Historical Completeness Check

The inventory source was the `CREATE TABLE` list in `createSchema()` in
`server/db/persistence.ts`, cross-checked against the table list in
`validateSchema()`. Temporary `*_next` tables used only while rebuilding a
table during a lightweight migration were excluded because they were not part
of the steady-state schema. This check establishes historical completeness
only; it must not be used as evidence that the current schema still has 18
tables.

The concrete check compares:

1. the distinct steady-state table names created by `createSchema()`; and
2. the backticked identifiers in the first column of the inventory above.

It must report 18 schema tables, 18 inventory rows, no missing names, no extra
names, and no duplicate inventory rows. This is an invariant-style set and
multiplicity comparison rather than an assumption based on a partial schema
reading.
