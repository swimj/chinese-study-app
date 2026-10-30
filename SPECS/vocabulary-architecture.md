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

A word has one canonical inventory of supported meanings and uses, including
peripheral uses where linguistically real. Its persisted **default useful** sense
selection is a separate editorial decision shared by teaching bootstrap and
reflection. A review may explicitly override the selection, including selecting a
peripheral use; exercise improvement trusts that selected use and assesses the
exercise rather than deciding its popularity again.

An absent/null shared selection is unknown; it means neither every sense nor no
senses. An explicitly saved empty selection selects none. Fresh inventory
establishment makes both inventory and default selection in one shared call.
Teaching bootstrap captures selected canonical IDs and versions, then enriches
exactly those identities with examples. Later policy edits do not retarget that
invocation or invalidate its immutable output.

Mapping examines the full active inventory and may identify an excluded sense.
It improves a single mapped sense independently of serving defaults. A repertoire
invocation captures explicit review sense IDs or seeds them from shared defaults;
those IDs and their source are immutable invocation inputs. An explicit empty
scope requests no generation and leaves the source unchanged. No serving-policy
change implies exercise retirement.

Reassessment copies an explicit review selection; inherited defaults remain
inherited for the new invocation. Later review/default changes do not invalidate
in-flight reflection, completed content generation, or content edit approval.
Actual source/version, mapping and canonical sense changes still fence content
work. Serving independently filters mapped exercises without rewriting them.

A review selection applies to that review and future reassessments; null inherits
the shared defaults when a new invocation captures its scope. Unknown selection
requires operator coverage review before repertoire generation; a mapped single
sense supplies its own explicit scope. General preparation uses its immutable
source document's full mapped canonical scope. Established useful policy with
an intersecting source sense creates new automatic demand; existing queued work
continues across policy edits. Teaching and review components likewise retain
their document scope and package coherence. Canonical source, version and catalog
changes still fence new publication.

Recognition, existing prepared teaching packages, unmapped fallback exercises and
historical encounters preserve existing serving behavior. Existing legacy rich
documents/inventories are not remapped or assigned defaults by ordinary runtime;
valid existing source mappings remain usable without inventing a useful selection.
A separately authorized legacy default-selection cutover is pending.

Content proposals can retire unsuitable general production exercises without
replacement. Operators can separately exclude existing senses from review
coverage or shared word defaults. Exact-version approval preserves learner
history and linguistic identity. Policy operations retain coverage version and
catalog fences; content operations retain source, mapping and catalog fences.

Exercise improvement trusts the mapped sense's necessity, including specialized
or personalized uses, and judges fidelity of the exact lexical target rather
than serving popularity. It can propose retiring an individual exercise when no
faithful repair is apparent; it does not propose sense exclusion. A nonempty
requested scope whose model returns no faithful exercises can propose retiring
only the assessed source. This quality decision is distinct from an empty
requested scope, which performs no generation and proposes no content change.
Every retirement remains operator-reviewed.

Proposal review groups exercises by readable sense labels and supports reversible
item selection before saving a new revision. Excluding a replacement retains its
source; excluding all operations does not imply application, retirement or sense
policy changes. Structured cue editing preserves the stimulus kind and keeps its
rendered prompt consistent with its authored fields.
