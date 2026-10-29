# Vocabulary content-improvement architecture

The adaptive vocabulary content-improvement pipeline shares canonical inventory
and default-useful sense selection with teaching bootstrap, then separates sense admission,
local exercise repair, optional pure-cue promotion, and existing pure-cue review.
This implementation reference describes current provider-call boundaries,
retained stage results and publication fences. The
[architecture contract](../../SPECS/vocabulary-architecture.md) prescribes the
authority boundaries; the [operator workflow](../operator-panel.md#content-improvement-workflow)
explains review controls.

![Provider-call flow for backend vocabulary content improvement. Blue boxes are model calls; other nodes are backend decisions and persistence.](../diagrams/content-improvement-provider-flow.png)

## Reading the flow

- **Sense readiness** reuses the canonical inventory. Fresh establishment makes
  one inventory/default-useful selection call, preserving real peripheral senses
  without selecting them automatically. Legacy documents alone do not establish
  or remap an inventory; unresolved legacy state requires operator/cutover work.
- **Mapping** assesses the authored exercise. A single intended sense admits local
  improvement; a laundry list routes to a fresh repertoire. An unmappable cue or
  inventory gap stops generation with an operator finding. The mapped sense is
  authorial context, not a clue the learner necessarily saw.
- **Local improvement** preserves that sense and the exercise's accepted answers.
  Local drafts and a pure-cue referral are independently optional. Raw responses
  and learner reactions inform assessment without dictating the result.
- **Repertoire generation** shares ordinary preparation's general-exercise
  authoring call and validation, using the reflection job's selected model.
  The explicit default-useful selection (or review override) supplies uses and available examples. The adapter
  preserves structured clozes and post-answer teaching notes in a proposal: one
  operation replaces the source and the others add exercises. Generation leaves
  the live exercise pool unchanged until operator application.
- **Promotion** resolves referral words to lexical identities and examines
  overlapping pure cues in the same publication scope. It can reject the referral,
  reuse a suitable cue, extend membership and update its integrated teaching note,
  or propose a new cue. Extension preserves the stimulus, axis and existing answers.
  Promotion does not reconcile individual words'
  exercise collections. Unresolved identities retain an operator finding and any
  local drafts.
- **Application** remains operator-controlled. New or extended pure cues join any
  local repairs in a reviewable proposal. Reuse and rejection are retained
  assessments; neither publishes an edit.

The ordinary single-sense path makes two calls, or three with promotion, plus one
if sense generation is necessary. Completed admission stages are retained by exact
input and contract, so an unchanged retry reuses their outputs. Failed provider
work requires explicit retry, except sense preparation, which retries automatically
within its three-attempt cycle. Source and sense changes fence stale results.

Only general production encounters enter provider work. Recognition and contrast
remain fully recorded in the session log but create no provider calls, including
within mixed-word feedback aggregation. Teaching issues go to a manual inbox.

## Admission, repair and promotion

### Single-word assessment

Single-word local improvement drafts wording changes and additional variants of
the supplied exercise while preserving its accepted-answer membership. Operators can
edit the full authored draft, including its answer relationships, before preview.
Automatic proposals for new contrast clusters or learner suppression are not
supplied by this adapter. Single-word admission can additionally propose pure-cue
creation or membership extension through the separate shared-practice assessment
below.

Single-word production improvement first establishes the word's sense inventory
and separately assesses the authored cue before attempting a sense association.
A defensible single sense admits a sense-specific local assessment with
independently optional local operations and a shared-practice referral. A gloss
laundry list spanning distinct senses automatically generates a fresh repertoire proposal: one replacement retires the laundry list
and additional exercises extend the pool, without retiring other cues. The
repertoire draws on the word's active inventory; the discarded list has no sense
association or requirement to preserve its old glosses. Reflection invokes the same
general-exercise authoring contract as ordinary preparation, retaining the complete
general v4 brief, structured direct/cloze stimuli, optional teaching notes, and
output validation. It keeps the reflection job's selected model. Established
senses supply the lexical uses and any retained examples; missing examples are
not invented. The response adapter preserves the source's accepted answers and
publication scope and creates proposal operations instead of publishing exercises.
All content application requires operator approval. An uninterpretable exercise or an
apparent inventory gap for a single intended use stays in the operator inbox
with its mapping rationale;
neither triggers automatic repair or sense expansion. Operators can close these
findings after inspection. Learner feedback and compensation remain independent.

An operator-requested reassessment creates a separate case and pins the current
exercise identity and version at submission. When it differs from the historical
assessed source version, the operator must confirm the current version before
queueing work. The selected model performs fresh mapping and final assessment,
even for an unchanged source version; the child does not reuse the parent job's
mapping. A single-sense assessment can invoke promotion when referred; a laundry
list runs repertoire generation. Pure cues use their standalone assessment.
The resulting proposal is based on the pinned current version. The original
encounters remain historical context; their responses and reactions are not
supplied as learner evidence for the independent operator assessment.
Source version and sense-state fences reject subsequent changes before accepting
results, and proposal application revalidates its bases. Failures remain available
for explicit retry against the same pinned source.

### Existing pure-cue assessment

Existing pure cues use a dedicated standalone `pure-cue-improvement.md` call,
not the generic improvement fallback. Its input supplies complete original
content and current members, projected encounters, and lexical resolutions of
effective rejected responses. Missing or ambiguous lexical identities do not
remove raw-response evidence, but cannot authorize new member IDs. The result
is extension, stimulus repair, or explanation-only. Extension preserves the
stimulus, axis, current members and accepted forms while replacing the complete
teaching note; repair changes only the stimulus. The accumulated teaching note
integrates all members, mostly in English with Chinese where helpful. Both
changes require manual application and leave individual word repertoires alone.
The call uses prompt/schema version 1 and projection `vocabulary-admission.v1`,
retains invocation provenance and source/lexical fences, and does not use the
admission stage-result cache.

### Promotion

A referral supplies advisory written forms, a shared purpose, and rationale;
local operations retain their original answer contract. Raw responses can suggest
an alternative even without a resolved lexical record. `pure-cue-promotion.ts`
resolves the forms to lexical identities, using the source to disambiguate its own
target. Missing or ambiguous candidates remain an operator-attention finding.
Resolved candidates lead to a same-job assessment of active, overlapping pure
cues in the source's publication scope and owner. It can reject, reuse, extend,
or create. Extension preserves the existing prompt, reveal axis, all answer
members and their accepted forms; every added member must suit that same task.
Creation and extension author complete, mostly English teaching notes, preserving
useful accumulated nuance on extension. Creation authors a new shared-purpose
cue from resolved candidates. Both become operations alongside any local edits in one manual proposal; rejection and reuse
remain recorded assessments. Private reactions inform judgment without becoming
shared authored text. This stage does not reconcile the participating words'
exercise repertoires or change scheduling and compensation.

### Versions and retained stage results

`single-improvement.md` uses prompt version 3 and schema
version 2; mapping retains prompt version 2 and schema version 1. Repertoire uses
the shared general-exercise prompt v4 and schema version 1. Its retained stage
identity includes that authoring contract, so older repertoire stage results do
not satisfy a new invocation. Existing saved proposals and second opinions remain
bound to their original versions; an upgrade does not regenerate them.
Promotion uses prompt version 3, schema version 2 and projection
`vocabulary-admission.v1`. Admission stages retain and reuse
results by exact contract/input within the same job, with publication fences for
source and sense state and, for promotion, resolved identities and inspected cues.

Sense establishment reuses existing inventories or authored bootstrap uses before
requesting a sense-only generation call. It does not regenerate teaching or
practice content as a side effect. Mapping and generation retain evaluated source
versions and invocation provenance; publication is fenced against changed sources
and maintenance controls. A mapped sense explains authorial intent, not what the
learner was necessarily told by the original cue.

See [worker routing and retry controls](../vocabulary-learning.md#background-work-and-operator-repair)
for model selection, provider gates and preparation retry budgets.

## Queued operator application

Approve and apply persists an exact-version operator request before returning its
acknowledgement. The frontend advances from that receipt and uses queue status
reads to discover completion or attention failures. It does not label a queued
request as applied.

`server/vocabulary/approval-requests.ts` keeps an append-only JSON-lines journal
at `APP_DATA_DIR/vocabulary-approval-requests.jsonl`, alongside the database on
the persistent volume. Memory indexes the journal for scheduling. One worker
processes requests serially and yields between applications; maintenance mode
pauses processing. The worker uses the existing real-writer rollback preview,
source and sense fences, exact-version operator review, and atomic application.
The review and application commit together in SQLite. A stable request-derived
application key lets replay recover the receipt if the SQLite commit succeeded
before the completion journal append.

Only newline-terminated journal records count as committed; startup discards an
incomplete final append and rejects malformed committed records. Periodic atomic
compaction retains pending and attention work plus a recent completion tail.
The journal is outside SQLite and Litestream replication. A lost volume can lose
in-flight authorizations; the proposals remain available in the database for
operator reconciliation. The journal does not request provider calls.

## Dictionary fallback publication scope

Corpus dictionary fallbacks and the repertoires generated from them are shared
authored study content. New fallbacks use a stable shared identity per word, skill
and role. Existing learner-specific fallback identities remain usable to preserve
deactivation and retirement. Composition chooses one stock fallback for each
objective and excludes duplicate stock copies from the shared pool. Authored
variants remain ordinary candidates.

### Compatibility for migration 0058

Migration `0058_shared_dictionary_baselines` positively identifies stock
dictionary fallbacks by their service origin, original identity and unchanged
authored body, assessment and answers. It appends a scope-only shared content
revision while retaining the original identity and historical snapshots.
Unresolved service-generated repertoires whose entire proposal still matches
those source versions receive a new shared proposal revision and updated bases.
Operator-edited proposal revisions are retained for manual reassessment.
Prior approvals and opinions remain bound to the earlier revision; fresh review
is required. Assessed-source provenance retains the version actually examined.
Resolved proposals, edited fallbacks, private imports and unrelated proposals
are retained as recorded. Skipped or substantively stale proposals still require
manual reassessment.

An old encounter can resolve to the audited scope-only successor during review.
This permission requires the migration's revision attribution and unchanged
authored material; a subsequent authored edit retains the normal drift fence.
Encounter evidence, learner state, provider results and stage caches remain
immutable. A second opinion is advisory and does not regenerate a proposal.
The migration makes no provider calls and applies no proposed content.

## Updating the picture

The [rendering source](../diagrams/render-content-improvement-flow.py) keeps layout,
labels, and colors editable. Regenerate the checked-in PNG with Python and Pillow:

```sh
python3 docs/diagrams/render-content-improvement-flow.py
```

The renderer uses Arial on macOS or DejaVu Sans elsewhere; `--font` and
`--bold-font` accept alternate TrueType font paths. Inspect the rendered image
when changing labels or routing, and keep this explanation aligned with it.

## Scoped production coverage

`server/db/vocabulary-sense-coverage.ts` owns nullable shared default-useful IDs,
compatible excluded IDs and review included IDs. A null shared selection is
unknown (`selectionEstablished: false`), while `[]` is explicitly none. A null
review selection inherits defaults; an explicit review selection establishes that
review's effective coverage even when shared defaults remain unknown. Each scope has a compare-and-swap version,
immutable change history and backend events. Mapping still receives every active
sense and no mutable policy metadata. A single mapped sense is the explicit
input to local improvement, even when currently excluded from serving. A
laundry-list assessment captures review IDs or shared defaults once for its
repertoire invocation. A captured scope records whether selection is established. Unknown repertoire
scope initializes shared defaults asynchronously; unresolved findings record `needs_coverage`; an explicit empty scope records `no_senses_requested`,
does not call authoring, and leaves the source active without a proposal.

Admission retains `generationScope`: exact sense IDs plus mapped-source,
review-override or word-default provenance. Captured policy versions are audit
evidence, not approval or publication dependencies. Backend-normalized mapping
evidence persists the first requested scope in the existing stage-result cache;
`canonical-generation-scope-v1` identifies that backend normalization without changing the mapper's wire schema. Retrying the same assessment preserves its
scope and completed content results after serving policy changes. A new
reassessment can request a new scope. Content calls, their cache identities and
publication fences omit mutable serving metadata. Source content, mapping,
canonical catalog and publication-authority fences remain active. Serving policy metadata does not invalidate ordinary content approval/application.

Shared defaults filter mapped general production at `listVocabularyExercises`
and shared production-proxy checks. Established selection admits only active
selected identities; later inventory additions do not become useful implicitly.
Unknown selection preserves the existing exclusion-based serving policy.
General preparation validates the immutable bootstrap document's complete mapped
canonical scope through `legacy_sense_imports`, retaining use/example identities
and exact current canonical versions. Shared useful policy gates only new automatic
demand: unknown policy records a durable prerequisite; explicit none or no source
intersection creates no new authoring demand. The worker initializes unknown
defaults before claiming an authoring attempt. Existing work remains discoverable and runs against its original full document across
policy edits. The generation key contains the source/authoring contract, without
policy versions; source/catalog/version changes still fence publication.
Unmapped content stays eligible under the existing fallback policy. A sense
coverage change does not rewrite content, learner attempts or served snapshots.

Operator GET/PUT routes are `/api/operator/vocabulary/words/:id/sense-coverage`
and `/api/operator/vocabulary/cases/:id/sense-coverage`. PUT requires the current
nonnegative `expectedVersion` and shared `includedSenseIds` (or compatible `excludedSenseIds`), versus nullable
review `includedSenseIds`. Shared exclusion controls explicitly establish the
complementary useful selection; they do not interpret an absent selection. Review reassessment copies overrides into the child case;
proposal edits remain separate editorial inputs and are not reassessment input.

## Explicit retirement proposals

A proposal can `retire` an active general production exercise without creating a
successor. Approval changes only its live availability and version. Its content
identity, schedules, deactivations, teaching references, and historical encounters
remain retained. The content history records the underlying availability update;
the application receipt records the explicit `retire` decision.

Retirement retains a compulsory comparison snapshot, but execution reads the exact
live source rather than applying that snapshot as an authored edit. Preview and
application use the same ordered content transitions; preview rolls back history,
events and writes. A failure in another operation rolls back the entire application.
Sense selection is configured directly through review coverage or word defaults;
content proposals never mutate that policy.

## Shared inventory, useful selection and teaching enrichment

`ensureVocabularySenses` owns the canonical inventory. Fresh lexical words receive
one inventory/default recommendation call using `sense-inventory.md`. Inventory and
nonempty initial useful selection publish atomically. The model's zero-usefulness
finding retains the inventory, stores its recommendation/invocation and leaves
usefulness unknown for operator review. Mapping can still improve a single use.

`ensureVocabularyDefaultUsefulSelection` conditionally initializes unknown defaults.
It selects active teaching-imported identities deterministically when their exact
source links are valid. Inventory-only words use `default-useful-selection.md`, an
adaptation of the inventory brief's full editorial reasoning that only returns
existing sense IDs. The selector cannot rewrite labels, notes, sense versions or
inventory membership. An operator's concurrent selection wins; the recommendation
remains auditable. Explicit `[]` is preserved and suppresses unknown-selection findings.

`vocabulary_default_selection_readiness` gives the selector its own lease and
bounded retry cycle. Inventory and selector attempts share the attempt journal,
with selector work IDs prefixed `default-selection:`. Provider failures retry after
30/60 seconds; exhausted cycles and model-empty recommendations become operator
findings. Maintenance, lost leases and source races defer work under a fresh claim
without invalidating a structurally valid model response. Provider orchestration
and administrative retries live above database persistence modules.

A laundry-list reflection first persists its validated mapping. A separate
backend-only record captures generation scope in the same stage store. Selection
initialization can wait or fail without repeating the mapper or marking its
invocation invalid. Captured scope is immutable on retry. Single-sense improvement
never waits for useful selection.

Teaching completion synchronously records general-practice demand in its completion
transaction. When defaults are unknown, `default_selection_pending` marks that work
as a prerequisite rather than an authoring attempt. The practice worker performs
initialization under its provider-work gate, then clears the marker once. Selector
waiting consumes no authoring attempts. Saved operator policy resolves selector
attention and requeues affected prerequisite work. Source mapping failures are
operator-visible, nonretryable findings; source reconciliation is a separate action.

One immutable source has one automatic practice lifecycle across prompt revisions.
Ready pools, including ready-empty results, are reused. Exhausted and in-flight work
are not replaced with new rows or budgets. A queued lifecycle adopts the current
provider contract at claim with an audit event while retaining its identity and
attempt counts. Running work keeps its captured contract. Explicit operator retry
starts a new bounded cycle; prompt revision alone does not.

Bootstrap preflight obtains inventory and useful selection before claiming an
example-enrichment lease. `WordBootstrapInput.canonicalSenses` selects the enrichment
prompt/schema; the independent local lab keeps its inventory experiment. Enrichment
returns exactly the captured IDs and example references; server assembly supplies
canonical labels/notes. Publication checks canonical IDs/versions and catalog, then
records exact immutable `legacy_sense_imports` links before invoking the content
importer in the same transaction. Teaching/review components use document scope and
preflight its current canonical mappings; policy edits do not invalidate components
or change a prepared package's lesson.

Operator workspace and review-batch metadata include a read-only
`defaultSelectionFinding` when model-empty or exhausted initialization needs review.
It carries the reason, recommended IDs and invocation ID, and disappears whenever
an explicit word policy is saved. This finding never blocks single-sense content
approval. [The initialization procedure](../ops/default-useful-selection.md) describes
bounded dry runs, deterministic imports and optional model-backed batches.

Reveal snapshots prefer explicit source-use links in the selected document,
allowing reflection-first canonical senses to obtain later teaching examples
without changing their descriptions or replaying historical encounters. Retained
legacy description-source links remain readable for their original documents.
