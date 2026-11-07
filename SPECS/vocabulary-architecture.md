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

An improvement review case owns an immutable encounter group and a continuing
operator review lifecycle. Holistic reflection jobs are numbered within that
case; model invocations and provider retries belong to a job. Only one job may
be queued or running per case. Advisory opinions retain their exact reviewed
proposal version and do not become the authoritative assessment.

Standalone operator case notes persist independently of review actions. Saving a
note neither resolves the case nor supplies instructions to a model. Action
commentary belongs to its explicit action. Reassessment may include optional
operator editorial instructions and an explicitly selected second opinion;
submission captures that opinion's exact result for retries. Its analysis remains
advisory, and editorial requests do not silently change the selected target,
authoring boundaries, or application authority.

Operator reassessment pins the current source identity and version at submission.
A difference from the historical assessed version requires explicit operator
confirmation. Queuing reassessment freezes the case's proposal and review edits,
resolution, approval, and repair-target changes until that job terminates. Shared
word policy retains its own authority and consistency checks. Successful
publication atomically selects the new assessment and supersedes the prior
current proposal; failure or timeout leaves the prior review material intact.
The case identity and original creation time remain stable. Previous jobs,
proposals, invocations, and decisions remain attributable within the case.

Source identity and version govern reassessment consistency. A later source
revision invalidates queued or in-flight work and proposals based on that version.
The new job maps the source unless it captures an operator-selected repair target.
Original served snapshots
remain distinct from its pinned current source. Retry retains the pinned version;
it does not silently move to another source or supersede a newer assessment.
Case review resolution is separate from job completion and approval progress:
queued authorization is not successful application. Pending and failed approvals
remain attributable, and application receipts prevent duplicate effects.

Exercise-local assessment owns the coherent content plan, including the source's
disposition, a complete shared draft, and any target or response-word practice.
The [content repair contract](vocabulary-learning.md#content-repair-boundaries)
defines source repair, distinctive refinements, and optional enrichment.
Shared-cue integration chooses a compatible destination or creates that exact
draft; it cannot veto the established pedagogical plan. Proposed shared answers
and response-word additions require uniquely resolved lexical identities;
unresolved responses serve as encounter evidence for target improvement.
Operator editorial changes and deliberate selection of proposal parts
remain authoritative; generated components do not impose automatic dependency
propagation. New response-word exercises retain exact lexical identity without
inventing canonical sense mappings.

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

Sense/content reconciliation separates saved linguistic judgment from live
application. A resolution retains the source and sense versions it examined;
unsupported transformations remain saved with explicit application blockers.
An applicable resolution atomically changes current eligibility, selected policy,
and durable replacement requirements. Replacement publication verifies the applied
resolution and its canonical authority. Fresh serving waits for required compatible
content; retained session snapshots and learner progress remain unchanged. See the
[reconciliation contract](sense-content-reconciliation.md) for decision boundaries
and the first handler's scope.

For now, inventory generation groups uses under the supplied simplified spelling
and pronunciation, without a separate inventory for each traditional spelling.
Traditional forms remain lexical data but are not supplied to inventory or
default-selection models. Glosses are optional, non-exhaustive hints; supported
uses can be included and selected even when absent from those hints.

Three separate records answer different questions:

- The **canonical inventory** describes distinct uses of the exact learning target,
  including peripheral, literary and technical uses. Grammatical constructions
  can support a target's own use; meanings realized only through larger compounds
  or fixed expressions belong to those larger targets. Each sense has a stable
  identity and version. An established inventory with zero active senses is a
  valid, settled result, distinct from an inventory that has not been established.
- The **default useful selection** chooses which senses normally deserve teaching
  and mapped production practice. Null means unknown; `[]` means explicitly none,
  either saved by an operator or derived from an established empty inventory.
  Repertoire bootstrap captures this shared selection; there is no separate
  editable case-level repertoire selection.
- An **invocation scope** records the exact canonical targets that a content call
  will address. Later changes to defaults do not retarget that call or invalidate
  its result. Source, mapping and canonical-version changes still fence publication.

Unknown defaults initialize asynchronously when needed. Every established nonempty
inventory receives a selector decision over existing sense IDs, including senses
imported from teaching. Teaching provenance does not establish default usefulness,
and missing or stale teaching links do not block selection over canonical senses.
The selector cannot create or rewrite senses. Existing default selections are
preserved. An established empty inventory resolves unknown defaults to `[]`
without a selector call. A nonempty inventory whose model recommendation selects
no useful senses preserves the inventory and leaves defaults unknown with an
operator finding. That recommendation does not become an operator's explicit none
decision. A concurrent operator decision takes precedence.

An established empty inventory makes the word ineligible for new sessions across
teaching, recognition, production, shared accepted-answer sets and contrast
choices. Stash membership, learner schedules, content history and retained session
snapshots are preserved. Empty inventories create no authoring demand; pending work
settles without provider calls or discarding its evidence. Content improvement
records `no_senses_requested` before mapping or authoring. This eligibility boundary takes
precedence over the nonempty-inventory selection rules below.

| Consumer | Unknown defaults | Explicit none | Selected set |
| --- | --- | --- | --- |
| Mapped general production serving | Preserve exclusion-based eligibility | Filter all mapped production senses | Serve only active selected senses |
| New automatic general practice demand | Record a durable prerequisite and initialize asynchronously | No new demand | Create demand when the immutable source intersects selection |
| Teaching bootstrap | Initialize defaults before capturing enrichment targets | Operator disposition; no enrichment call | Enrich the captured canonical IDs |
| Teaching/review components for a document | Use the document's canonical scope | Use the document's canonical scope | Use the document's canonical scope |
| Repertoire invocation inheriting defaults | Initialize, then capture scope; unresolved findings remain visible | No generation or retirement | Author against the captured IDs |
| Single-sense improvement | Map the full inventory and improve the mapped use | Same | Same |

Repertoire bootstrap captures word defaults. In repertoire review, **Save selection**
updates shared defaults and the proposal in one transaction. Apply writes only
its included exercises. Deselected exercises remain retained with that proposal:
reselecting their sense restores them without a model call. A newly selected sense
without retained exercises requires generation. Removing all proposed exercises
requires dismissal or new generation; it never implies source retirement. Selection
changes preserve an intended source replacement when exercises remain.

For an expanded selection, the explicit **Save selection and reassess** action
saves shared defaults and queues reassessment atomically. It captures the exact
selected senses for that invocation; later default edits do not change them,
including on retry. Shared defaults take effect when the job is admitted. If
admission fails, neither defaults nor a job is saved. If generation later fails,
the saved defaults remain and the previous proposal returns to review. The old
proposal is retained until successful reassessment replaces it; selecting senses
never applies content. Source and canonical-catalog changes still fence generation.
Shared-default edits outside repertoire review do not retarget or invalidate an
existing proposal.
General preparation retains its immutable source document's mapped canonical
scope across policy edits; teaching packages preserve document/component coherence.

Single-exercise assessment records its observed source binding and proposed target
separately. Assessment never changes source content or its sense binding. Only
operator application publishes the reviewed content and binding together. An
operator can set a pending target sense, even the currently assessed sense. That
intent blocks application and manual proposal editing until reassessment uses it;
reassessment skips automated mapping and can still find no faithful repair.
Reset discards pending intent and restores the current assessment's target without
bypassing independent stale-source, catalog or approval checks. Failed reassessment
leaves the intent pending. Successful reassessment records the accepted intent,
including when it produces no proposal; older alternatives cannot bypass it.
Historical case-scope rows remain audit evidence and do not supply generation policy.

For words without an established empty inventory, unmapped fallback exercises and
recognition retain their serving rules. Historical encounters retain their exact
served material. Missing or stale document-to-sense mappings raise an operator finding
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

Excluding a proposal operation does not apply, retire or change sense policy.
Excluding a replacement retains its source. An empty selection cannot be applied.
