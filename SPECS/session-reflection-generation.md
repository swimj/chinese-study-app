# Session Reflection Generation

Status: implemented canonical product contract for the initial post-session
reflection flow. Evidence kinds, bundle/result schemas, and resource controls
remain versioned extension points.

This specification defines when post-session reflection may run, which learner
evidence is eligible, how generation remains outside study correctness, and how
failure and retry preserve truthful provenance. Proposal review, authorization,
application, and effect attribution are owned by
[`reflection-proposals-and-handles.md`](./reflection-proposals-and-handles.md).

Related documents:

- [`session-covering-criteria.md`](./session-covering-criteria.md)
- [`study-action-model.md`](./study-action-model.md)
- [`reflection-proposals-and-handles.md`](./reflection-proposals-and-handles.md)
- [`docs/reflection-frontend-architecture.md`](../docs/reflection-frontend-architecture.md)

## 1. Scope And Authority

This specification owns:

- the completed-session boundary at which reflection becomes eligible;
- the relationship among Undo, durable attempt acceptance, and reflection
  evidence;
- the initial evidence-item inclusion contract and its versioning boundary;
- generation idempotency, failure isolation, and deliberate retry semantics;
- the distinction between a generation attempt and a successful immutable
  reflection artifact; and
- the requirement that model resource exposure be explicitly bounded and
  observable.

It does not choose:

- database tables, HTTP routes, frontend components, or process topology;
- a permanent provider, model, price schedule, or batching algorithm;
- proposal review or operation-application semantics;
- a final production-cue or accepted-answer model;
- broad learner-history context; or
- time-budgeted planning or autonomous scheduling.

## 2. Finalized-Session Boundary

Reaching a session summary does not itself make the session immutable. The final
session-affecting transition may remain undoable until the learner finishes the
session. Finish is any of: **Finish session**, Space on that summary, or in-app
navigation away from the completed summary. Mid-session leave does not finish.
Tab close and refresh are not a reliable finish path.

Finalization proceeds in this order:

1. close the final Undo window and flush any accepted deferred study commit;
2. record the durable completed-session summary;
3. freeze the qualifying reflection supplement; and
4. start reflection only when qualifying evidence exists.

If the final study commit or session-summary write fails, reflection must not
start. The learner may retry finalization without fabricating a completed
session or duplicate attempt evidence.

Once finalization succeeds, reflection is best-effort. Generation is kicked off
after the durable finish writes succeed and does not require the summary page
to remain mounted. The learner may leave the summary while generation
continues. Provider failure, invalid output, timeout, or absence of qualifying
evidence does not reopen the session, alter its completion, change covering, or
affect scheduling projection. If they already left, retry remains available
later from Reflections rather than as a blocking return to the summary.

## 3. Evidence Boundary

Reflection input distinguishes three layers:

1. ephemeral presentation and response evidence captured while the session UI
   still knows exactly what the learner saw and typed;
2. durable session, action, attempt, word, and content truth used by the backend
   to validate and enrich that supplement; and
3. the exact validated, bounded bundle supplied to one generation attempt.

The client does not supply enriched domain truth. The backend verifies session,
action, and attempt references before constructing a provider-facing bundle.

### Initial evidence kinds

The initial flow includes review-phase production failures that are either an
explicit no-clue response or a non-empty typed response outside the accepted
answer space snapshotted on the served cue. A learner may mark an otherwise
accepted Hanzi response wrong because they recalled its pronunciation
incorrectly; that remains a study mistake but is not reflection-eligible in the
initial flow. Word-owned accepted space now contains only the target word,
including all migrated durable cues and fallback. No-clue evidence preserves a null raw response and null submitted
word with the explicit `no_clue` discriminator; it is not relabeled as a typed
mistake. Each item preserves at least:

- the target word identity;
- the production cue exactly as shown;
- the raw typed response;
- sufficient action and accepted-attempt identity for backend validation; and
- the versioned word/content context selected by the backend.

For the production-cue flow, the provider receives the target word and one
singular immutable snapshot of the cue actually served. The V0 task identity is
deterministic from that word and is supplied at the trusted provider boundary,
not copied through model evidence or output. The provider does not receive the
task's other active or inactive cues. A fallback snapshot has a null durable cue
id; durable cue snapshots retain their exact cue id, type, text, and accepted-
word set. This keeps model context and proposal authority causal to the attempt.
Duplicate detection against other task content belongs at proposal review or
application time, not in provider evidence.

The V4 bundle additionally snapshots the nullable post-reveal production-cue
supplement served with that exercise. A supplement retains its immutable id,
English frame, complete target-language example, and English translation. It
is distinct from the pre-reveal cue text because it did not influence recall or
grading. Supplying it prevents reflection from proposing a second V1 supplement
for an exercise that already has one.

Attempt references prove that the captured mistake belongs to the finalized,
durably accepted action batch. Workflow-only reinforcement attempts need not be
copied into the model-facing bundle.

An undone transition contributes no evidence. Evidence is also removed when the
corresponding action is canceled or excluded through an in-session management
path whose durable meaning is that the exercise should not be reflected on.

The V3 bundle introduced an untrusted learner-request marker on a
review-phase production action. The marker may be set before or after the
response, survives Undo, and can be explicitly removed. It becomes eligible
only after its full action batch is durably accepted; it is removed with a
canceled, dismissed, or managed-away action. A marked correct response is
eligible, but the marker never changes grading, covering, scheduling,
reinforcement, or completion. When the action also has a production failure,
the V3 bundle has one item with both the original failure evidence and the
marker.

The marker and all learner-authored fields are hints, not strict content
management directives. Backend reconstruction remains authoritative, and the
prompt treats the marker only as a request for useful feedback. V4 retains that
marker and pairs with the V7 diagnosis result contract; every item has a non-empty
learner-facing explanation even when no proposal is warranted. V5 and V6
results remain readable for immutable stored artifacts.

All newly constructed initial diagnosis bundles use V4, including sessions containing
only ordinary failure evidence or no served supplement. V2 and V3 remain
readable for immutable stored artifacts and exact-bundle retries, but new
diagnosis does not branch by marker or supplement presence. The staged flow
then retains V5 enriched evidence with a final V8 result, as described below.

Learner-authored session notes, contrast-selection signals, learning/unstudied
actions, and broader history require explicit evidence-kind and bundle-schema
extensions. Adding them must not silently reinterpret stored bundles from an
earlier version.

## 4. Generation Attempts And Artifacts

A generation attempt records one invocation of a versioned reflection flow over
one exact bounded bundle. A successful reflection artifact is a separate,
immutable product record containing the validated result and the provenance
defined by the reflection proposal specification.

For dogfood model comparison, an explicit generation request creates a distinct
candidate artifact even when the source session and reflection flow match an
earlier candidate. The initial post-session request may select a configured
model randomly; a deliberate retry reuses the exact stored bundle and defaults
to the source run's model when that model is still a configured comparison arm.
Same-model retry of a retired model is refused; the operator must select another
configured model. Each candidate retains its originating generation-run identity.

Provider output is untrusted. It must pass strict structural and cross-reference
validation before a successful artifact and its proposal-review rows are
materialized. Invalid or truncated output may be retained as a failed generation
attempt for observability, but it is not a reflection artifact and creates no
proposal or operation authority.

Provider credentials and calls remain backend concerns. Provider/model identity,
prompt version, bundle schema, result schema, and available response metadata are
preserved so later review can distinguish what actually ran.

### Staged pure-cue promotion

New initial requests use `initial_post_session_reflection.v4`; new deferred
second opinions use `deferred_second_opinion.v3`. Only the current staged
generation contract and prompt identities can execute. Older artifacts remain
readable, but their runs cannot be retried or their evidence repackaged into
second opinions. Pending obsolete proposals cannot be authorized or applied.
There is no one-shot retry compatibility path and no silent evidence upgrade.

The server persists a continuation and exact diagnosis input before calling the
provider. Diagnosis uses `staged_reflection_diagnosis_result.v1`: each item is
either ordinary explanation/proposals or a shared-axis handoff, never both.
The handoff describes an expressive instinct, its boundaries, and why the
original response was valid for the served cue. Only explicit handoffs trigger
enrichment with both words' active production cues and intersecting pure cues;
diagnosis tags alone do not route an item. New targeted cues are owner-only.

The active staged prompts target Mandarin; French is retired experimentation,
not a supported staged-reflection path. The model receives a content-focused
projection, not the complete durable evidence bundle. Stage-one input omits
cue/task/attempt identities, deterministic answer membership, study-profile
configuration, and the persistence source label. A correct requested review,
stored with a null response kind, is shown to the model as
`responseKind: correct`. The full evidence remains available internally for validation,
normalization, and exact continuation checkpoints.

Stage-one repair, suppression, and supplement wire operations omit `wordId`.
Normalization resolves the containing `itemId` against that retained bundle
and uses its `targetWord.wordId`; contrast membership remains model-authored.

Stage-one repair output describes non-empty `replacementCues` (cue type and
text), not persistence-level create/replace/deactivate operations. The adapter
derives creation versus replacement, the served cue identity, and target-only
acceptance from the original evidence. Standalone cue retirement remains a
durable/manual capability, not a stage-one model choice. Suppression remains
a separate semantic judgment about low production value, never an automatic
translation of cue retirement. A target-only answer set is a storage invariant;
natural cue design aims for strong target evocation, not guaranteed linguistic
uniqueness. Subsequent practice can reveal ambiguity worth revisiting.

Before either initial or second-opinion diagnosis, stable greedy admission
excludes items whose target/identified response words overlap an already kept
item. Initial admission then applies its item cap. Continuations record
`overlapOmittedItemCount` separately from eligible/included counts. This bounded
best-effort policy does not detect every shared destination conflict.

The exact diagnosis, enriched final evidence, and bounded promotion input are
saved before the conditional promotion-only call. That call uses a separate
strict wire contract and Mandarin prompt, without model-facing study-profile
configuration. It may
return explicit disagreement or leave either word without distinctive drafts;
the latter is the accepted production-proxy policy, not a generation failure.
Stage two normally trusts the handoff and owns content reconciliation and the
final learner explanation, including when it disagrees. Disagreement yields
visible non-actionable feedback, never an ordinary proposal fallback. No model
directs a database tool loop, and no intermediate learner artifact is created.

The final V8 result excludes multi-answer word-owned drafts. Ordinary items
retain stage-one feedback; routed items receive only stage-two feedback and
its coordinated promotion or explicit disagreement outcome. Stage-one handoffs
have no ordinary proposals to merge or discard. Each actual provider call has its own
run, prompt/schema identity, usage, and failure accounting. A promotion run's
eligible and included counts are the items in its retained promotion input,
not the diagnosis bundle size. The final artifact
links to the completing run; its continuation retains the chain.

See [`pure-cue-elicitation.md`](./pure-cue-elicitation.md) for promotion,
compensation, and standalone scheduling policy.

## 5. Failure And Deliberate Retry

Every generation failure is isolated from session correctness. A failure may be
shown to the learner or dogfood operator, but retry is an explicit reflection
action rather than a retry of study completion.

When a failed attempt retained a complete validated bundle and no successful
artifact exists for the source session and flow, the product may offer a
deliberate retry. Retry:

- reuses the exact backend-owned bundle rather than reconstructing current word
  or content context;
- creates a new generation-attempt record for each new provider call;
- still passes provider output through the current strict result validator;
- materializes a distinct successful candidate artifact with provenance back to
  its source run;
- never automatically authorizes or applies a resulting proposal; and
- refuses same-model retry when the source run's model is no longer a
  configured comparison arm. Retry with an explicit current model remains
  available when the bundle is still retryable.

A failure outside the current flow/bundle/prompt contract is not retryable,
even if its evidence was retained. Study forward to obtain current evidence;
the service does not upgrade historical work into a new generation contract.

For staged flows, a promotion retry reuses the saved diagnosis and exact
promotion input, without refreshing cues or regenerating diagnosis. Normal
stages use the same selected model; an explicit retry-model override applies to
the stage being called. If diagnosis is already saved and no promotion call is
needed, retrying artifact persistence makes no provider call and preserves the
original diagnosis model identity. Provider success followed by preparation or
artifact-persistence failure remains visible and retryable, with usage retained.

## 6. Bounded Resource Exposure

### Deferred second-opinion requests

A learner may deliberately compose a non-session reflection request from one
or more deferred proposals. The backend resolves each selection to its
learner-owned immutable source evidence, deduplicates a shared evidence item,
and sends no prior proposal text, disposition, later attempt, or refreshed
content state to diagnosis. A subsequent promotion stage enriches current cue
state exactly once and saves it for retries. The current request is capped at the same twenty-five distinct
evidence items as initial reflection; an over-limit request is rejected rather
than truncated or partitioned automatically.

The composed envelope is versioned separately from a session bundle and has no
source-session id. Private generation-run provenance retains selected proposal
ids, while the provider envelope contains only its version, generation time,
and remapped original evidence items. It never fabricates a session or sends
prior proposal/review identifiers. It remaps provider item
ids to avoid collisions between original artifacts. Model/provider/run/result
validation now follows the same staged diagnosis/promotion flow. Its diagnosis
envelope is `curated_reflection_diagnosis_bundle.v2`; final enriched evidence is
`curated_reflection_bundle.v2`, with explicit study profile and no fabricated
source session. Stored V1 curated evidence remains readable. A provider or validation failure
leaves every selected original deferred. On successful durable materialization,
only included selections that remain deferred are retired atomically. Selections
omitted by word-overlap admission remain deferred. The current
implementation records that retirement as the terminal review disposition
`requested_second_opinion`; it is distinct from an explicit learner dismissal.

Every reflection flow must put an explicit upper bound on model resource
exposure. The mechanism may be a fixed evidence-item cap, deterministic
partitioning, dynamic batching, or a later policy with equivalent safety. The
bound and the handling of excluded eligible items must be inspectable.

The initial twenty-five-item cap is a provisional dogfood control, not a permanent
product invariant. Replacing it must preserve:

- deterministic accounting of eligible versus included evidence;
- truthful visibility of partial coverage;
- strict validation for every provider result;
- no artifact materialization from truncated or invalid output; and
- failure isolation from study state.

Token categories, finish/stop metadata, and cost estimates may be exposed for
dogfood observability. Price estimates must identify or preserve the rate
snapshot used; they are operational intuition, not learning evidence or a
correctness signal.

### Daily spend cap

Each learner has a provisional **$0.50 UTC-day** spend cap on persisted
reflection generation estimates. The UTC day is taken from `completed_at`.
Null estimates count as zero. Intake triage is out of scope.

Once same-day estimated spend **surpasses** $0.50:

- unselected initial generation routes only to Luna;
- explicit non-Luna choices (retry and second opinion) are refused rather than
  silently rewritten;
- Luna remains available with no second cap.

The run that first crosses the threshold still completes on the model that
started. Overlapping in-flight expensive runs are not reserved against the cap.
This is a generous beta guardrail, not a billing product.

The generation-run log returns the current cap state so selectors can disable
non-Luna arms and show when Luna-only routing resets (next UTC midnight,
formatted in the learner's timezone).

## 7. Integration Invariants

- Reflection generation never directly mutates learner, scheduling, or content
  state.
- A successful artifact grants proposal-only authority; every durable effect
  still requires explicit authorization and a supported application adapter.
- Reflection review remains available asynchronously after the source session
  and its ephemeral UI state are gone.
- Original evidence and generated conclusions remain distinguishable from later
  user edits, authorization, application status, and effects.
- Expanding reflection input must use versioned evidence contracts rather than
  scraping untyped frontend state or prose.
- Structural validation constrains application authority but does not by itself
  solve semantic prompt-injection risk from learner- or content-supplied text.
