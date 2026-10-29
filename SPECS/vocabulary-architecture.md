# Vocabulary architecture contract

This contract defines the state, authority, and consistency boundaries that
implementations of Mandarin vocabulary study must preserve. The
[product contract](vocabulary-learning.md) owns learning policy and the learner
and operator experience. The [implementation guide](../docs/vocabulary-learning.md)
describes the components and mechanisms that realize these constraints. This
document consolidates existing constraints; it does not certify deployed behavior.

## Session authority and retained evidence

Session composition captures admitted words, starting learner state, eligible
content versions, teaching repertoires, answer criteria, and reveal facts. The
player can choose dynamically within that composition. Content discovery and
publication are separate from advancing the active session: ordinary actions
use retained material, with live ownership and access checks. This keeps later
content edits from changing the task against which a response is judged.

The server derives learner identity and validates commands. Clients cannot
supply authoritative grades, arbitrary served snapshots, or another learner's
identity. Ordered actions and exact encounters are durable evidence; projections
and caches derive from that evidence rather than becoming independent authorities.
Stable command identities make retries distinguishable from new interactions.
Undo changes effective evidence while retaining the original observations.

The presentation layer receives only identities and content safe to display at
the current reveal state. Concealment applies to accessibility labels and metadata
as well as visible text. Presentation components emit intents; they do not decide
coverage, scheduling, or authorization.

## Completion and failure boundaries

Finalization flushes pending interactions and identifies an acknowledged action
boundary. Closure applies learning effects, saves completion and effect receipts,
and queues post-session work atomically. Repeated closure cannot apply effects
twice. A pending completion has a server-owned deadline; browser navigation and
timers cannot redefine durable acceptance. Failed closure remains retryable.

Model calls are outside live grading and the completion transaction. Provider
failure cannot invalidate completed study. Local completion processing and
provider dispatch have separate control boundaries so pausing model work does
not prevent durable closure. Background authoring and repair use retained work
and bounded retries rather than unbounded speculative generation.

## Content identity, ownership, and revision

Current content and immutable full revision history preserve identity separately
from authored representation. Updates preserve identity; replacement creates a
new identity and retires the predecessor. Schedules, deactivations, and teaching
bindings do not silently move to a replacement. Historical served material stays
interpretable after either operation.

Teaching binds exact authored exercise versions to its introduction. General
practice selection uses eligible standalone exercises at composition. Sense
associations may be unresolved without inventing identities or blocking all
word-level study. Revisions and preparation refresh preserve established sense
identities and learner history.

Shared content does not confer access to private learner evidence. The server
enforces ownership below HTTP handlers as well as at the API boundary. Service
processing retains source-learner attribution separately from content ownership.
Compatibility imports preserve recorded scope until an explicit, source-bounded
correction changes it.

## Generation, review, and application authority

Backend preparation can publish structurally validated shared material under its
bounded authoring policy. Internal reflection instead proposes content changes;
an operator reviews and authorizes application of an exact proposal version.
A persisted request can acknowledge that authorization before background
validation and application complete. Preparation
and reflection repertoire generation share the general-exercise authoring contract;
their adapters retain these distinct publication and proposal authorities. Preview
and application validate source versions and effect scope. Application records
an idempotent receipt; stale bases or changed drafts require renewed validation
and approval. Advisory second opinions cannot authorize or apply changes.

Operator reassessment pins the current source identity and version at submission.
A difference from the historical assessed version requires explicit operator
confirmation. Source identity and version govern reassessment consistency;
structural content comparisons do not substitute for version authority. A later
source revision invalidates queued or in-flight work and proposals based on that
version. Fresh mapping and assessment belong to the new case. Its link to the
original assessment preserves provenance without making its encounters evidence
for the new assessment. Retry retains the pinned version; it does not silently
move the request to another revision.

Learner feedback and bounded scheduling compensation have authority independent
of content review. Reading a lesson is not content approval, and applying a
proposal is not scheduling compensation. Receipts prevent repeated compensation
and explicit learner mode and refresh choices remain protected.

Provider output is untrusted. Retained requests, results, model settings, and
source/version links support diagnosis without turning provenance into automatic
dependency propagation. Retry preserves original evidence and the selected job
model, except that sense mapping may switch from Luna to ZAI after its bounded
availability retry budget is exhausted. Mapping retries do not consume prerequisite
preparation or later authoring budgets. Provider-work and maintenance controls
continue to govern execution.
The implementation guide owns routing weights, retry delays, and cache policies.

## Compatibility and operation

Retired Mandarin write paths cannot mutate current learner or content state.
Historical records remain readable within their ownership boundaries. Schema and
data changes use versioned migrations and the
[stopped-writer procedure](../docs/ops/schema-migrations.md); app-only upgrades
must satisfy the [release runbook](../docs/ops/hosted-beta-deployment.md).
Migration and release evidence are specific to an operation, not implied by
these contracts or by passing implementation tests.

### Canonical senses and useful selection

Three separate records answer different questions:

- The **canonical inventory** describes all supported meanings and uses, including
  peripheral, literary, technical and bound-form senses. Each sense has a stable
  identity and version.
- The **default useful selection** chooses which senses normally deserve teaching
  and mapped production practice. Null means unknown; an operator-saved `[]` means
  explicitly none. A review can supply its own selection, including an uncommon
  use, without changing the word defaults.
- An **invocation scope** records the exact canonical targets that a content call
  will address. Later changes to defaults do not retarget that call or invalidate
  its result. Source, mapping and canonical-version changes still fence publication.

Unknown defaults initialize asynchronously when needed. Active senses imported
from teaching establish their useful selection deterministically. Inventory-only
words receive a selector decision over existing sense IDs; it cannot create or
rewrite senses. A model recommendation of no useful senses preserves the inventory
and remains unknown with an operator finding. It never becomes an operator's
explicit none decision. A concurrent operator decision takes precedence.

| Consumer | Unknown defaults | Explicit none | Selected set |
| --- | --- | --- | --- |
| Mapped general production serving | Preserve exclusion-based eligibility | Filter all mapped production senses | Serve only active selected senses |
| New automatic general practice demand | Record a durable prerequisite and initialize asynchronously | No new demand | Create demand when the immutable source intersects selection |
| Teaching bootstrap | Initialize defaults before capturing enrichment targets | Operator disposition; no enrichment call | Enrich the captured canonical IDs |
| Teaching/review components for a document | Use the document's canonical scope | Use the document's canonical scope | Use the document's canonical scope |
| Repertoire invocation inheriting defaults | Initialize, then capture scope; unresolved findings remain visible | No generation or retirement | Author against the captured IDs |
| Single-sense improvement | Map the full inventory and improve the mapped use | Same | Same |

An explicit review override supplies repertoire scope directly. Reassessment copies
that override; null inherits shared defaults when the new invocation captures its
scope. Default or review edits do not invalidate completed content generation or
ordinary content approval. General preparation likewise retains its immutable
source document's full mapped canonical scope across policy edits. Prepared
teaching packages preserve document/component coherence.

Unmapped fallback exercises, recognition and historical encounters retain their
serving rules. Missing or stale document-to-sense mappings raise an operator finding
before new generation; runtime does not invent reconciliation or remap old sources.
Coverage changes never imply retirement. A proposal may separately retire a general
production exercise, subject to exact source, mapping and catalog checks. Operators
edit sense policy directly with scope-version checks; content proposals never change it.

Exercise improvement trusts the mapped sense's necessity, including specialized
or personalized uses, and judges fidelity of the exact lexical target rather
than serving popularity. It can propose retiring an individual exercise when no
faithful repair is apparent; it does not propose sense exclusion. A nonempty
requested scope whose model returns no faithful exercises can propose retiring
only the assessed source. This quality decision is distinct from an empty
requested scope, which performs no generation and proposes no content change.
Every retirement remains operator-reviewed. New automatic repertoire exercises
must reference a supplied selected sense; an absent or unknown reference fails
validation rather than receiving an invented binding. Legacy and manually authored
unmapped content retain their existing behavior. This reference requirement does
not prescribe cue types or require exercises for every selected sense. An empty
automatic preparation result instead publishes nothing and stops for operator
attention, preserving the valid invocation and recommendation.

Proposal review groups exercises by readable sense labels and supports reversible
item selection before saving a new revision. Excluding a replacement retains its
source; excluding all operations does not imply application, retirement or sense
policy changes. Structured cue editing preserves the stimulus kind and keeps its
rendered prompt consistent with its authored fields.
