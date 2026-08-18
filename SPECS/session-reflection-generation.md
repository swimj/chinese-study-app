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
session-affecting transition may remain undoable until the learner explicitly
finishes the session.

Finalization proceeds in this order:

1. close the final Undo window and flush any accepted deferred study commit;
2. record the durable completed-session summary;
3. freeze the qualifying reflection supplement; and
4. start reflection only when qualifying evidence exists.

If the final study commit or session-summary write fails, reflection must not
start. The learner may retry finalization without fabricating a completed
session or duplicate attempt evidence.

Once finalization succeeds, reflection is best-effort. The learner may leave the
summary while generation continues. Provider failure, invalid output, timeout,
or absence of qualifying evidence does not reopen the session, alter its
completion, change covering, or affect scheduling projection.

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
initial flow. The accepted words are treated as a cue-scoped equivalence class
for this exclusion; the legacy fallback's accepted space contains only the
target word. No-clue evidence preserves a null raw response and null submitted
word with the explicit `no_clue` discriminator; it is not relabeled as a typed
mistake. Each item preserves at least:

- the target word identity;
- the production cue exactly as shown;
- the raw typed response;
- sufficient action and accepted-attempt identity for backend validation; and
- the versioned word/content context selected by the backend.

For the production-cue V2 flow, the provider receives the target word and one
singular immutable snapshot of the cue actually served. The V0 task identity is
deterministic from that word and is supplied at the trusted provider boundary,
not copied through model evidence or output. The provider does not receive the
task's other active or inactive cues. A fallback snapshot has a null durable cue
id; durable cue snapshots retain their exact cue id, type, text, and accepted-
word set. This keeps model context and proposal authority causal to the attempt.
Duplicate detection against other task content belongs at proposal review or
application time, not in provider evidence.

Attempt references prove that the captured mistake belongs to the finalized,
durably accepted action batch. Workflow-only reinforcement attempts need not be
copied into the model-facing bundle.

An undone transition contributes no evidence. Evidence is also removed when the
corresponding action is canceled or excluded through an in-session management
path whose durable meaning is that the exercise should not be reflected on.

The V3 bundle additionally permits an untrusted learner-request marker on a
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
prompt treats the marker only as a request for useful feedback. V3 pairs with
the current V6 result contract; every item has a non-empty learner-facing
explanation even when no proposal is warranted. V5 remains readable for
immutable stored artifacts.

All newly constructed provider bundles use V3, including sessions containing
only ordinary failure evidence. V2 remains readable for immutable stored
artifacts and exact-bundle retries, but new generation does not branch between
V2 and V3 based on whether a marker happened to be present.

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

## 5. Failure And Deliberate Retry

Every generation failure is isolated from session correctness. A failure may be
shown to the learner or dogfood operator, but retry is an explicit reflection
action rather than a retry of study completion.

When a failed attempt retained a complete validated bundle and no successful
artifact exists for the source session and flow, the product may offer a
deliberate retry. Retry:

- reuses the exact backend-owned bundle rather than reconstructing current word
  or content context;
- creates a new generation-attempt record rather than overwriting the failed
  attempt;
- still passes provider output through the current strict result validator;
- materializes a distinct successful candidate artifact with provenance back to
  its source run;
- never automatically authorizes or applies a resulting proposal; and
- refuses same-model retry when the source run's model is no longer a
  configured comparison arm. Retry with an explicit current model remains
  available when the bundle is still retryable.

A legacy failure without a retained valid bundle is not retryable. Changing the
evidence, provider-flow contract, or intended interpretation requires a new
versioned generation rather than calling an exact-bundle retry.

## 6. Bounded Resource Exposure

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
