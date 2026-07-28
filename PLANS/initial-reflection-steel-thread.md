# Initial Post-Session Reflection Steel Thread

Status: accepted implementation milestone; Slice 0 contract alignment complete.

This plan defines the smallest end-to-end reflection path that exercises the
durable contract in
[`SPECS/reflection-proposals-and-handles.md`](../SPECS/reflection-proposals-and-handles.md)
against real study data. It is a milestone checklist, not a second source of
truth for proposal or handle semantics.

Related documents:

- [`TASKS.md`](../TASKS.md) — current stability-frontier snapshot
- [`STABILITY_FRONTIER.md`](../STABILITY_FRONTIER.md) — frontier operating rules
- [`notes/active/2026-07-10-session-evidence-bundle-design.md`](../notes/active/2026-07-10-session-evidence-bundle-design.md)
- [`notes/active/2026-07-10-session-lifecycle-code-verification.md`](../notes/active/2026-07-10-session-lifecycle-code-verification.md)
- [`notes/active/2026-07-20-llm-provider-spike-summary.md`](../notes/active/2026-07-20-llm-provider-spike-summary.md)

## 1. Milestone Outcome

A naturally completed review session containing at least one typed production
mistake can make one server-side reflection call. Valid output becomes a durable
artifact. The user can leave, return to a minimal reflection queue, review each
proposal independently, edit its typed payload, defer or dismiss it, and accept
it.

Acceptance:

- immediately applies supported operations through validated adapters;
- truthfully records unsupported operations without changing study state;
- preserves the original proposal, exact authorized operation, application
  outcome, and caused effects separately; and
- never affects session completion or scheduling correctness when generation,
  validation, review, or application fails.

The milestone is successful when this path is useful enough to dogfood and
produces concrete evidence for improving prompts, validation, operation
editors, and later cue design.

## 2. Scope Decisions

The steel thread deliberately chooses:

- one reflection batch per completed session;
- review-phase typed production mistakes as the only initial evidence-item
  source;
- one monolithic `gpt-5.6-luna-high` call;
- the `session_reflection_bundle.v1` input envelope, populated only
  with qualifying `production_mistake` items;
- the canonical `session_reflection_result.v4` output;
- synchronous local SQLite persistence;
- proposal-level review rows rather than item-level lifecycle rows;
- a small dedicated reflection page rather than a general workbench; and
- immediate application after acceptance when a supported adapter exists.

Qualifying production mistakes have a non-empty typed response. The response
may resolve to a known word or remain unmatched text. Ordinary no-clue events,
learning/unstudied actions without durable attempt-event support, session-note
items, and contrast-selection reflection signals remain outside this steel
thread.

The frontend submits ephemeral evidence—especially response and cue text as
shown—before completed-session state is torn down. The backend validates
session and attempt identity, enriches current word/content context, constructs
the bounded bundle, calls the provider, validates the result, and persists the
artifact.

Attempt ids remain in the client supplement only to validate that the typed
mistake belongs to the complete durable action batch. The model-facing bundle
does not include attempt rows or a derived attempt-shape summary: the session's
required closing successes are workflow mechanics, not useful reflection
evidence. Word snapshots likewise omit production relevance and bad-prompt
metadata. In-session suppression, bad-prompt reporting, or dismissal removes
the affected action from reflection evidence instead. Reintroducing managed
items or multi-attempt interpretation requires a deliberate future bundle
schema decision.

## 3. Initial Operation Inventory

The result validator and review UI support exactly these four operation
versions:

| Operation | Current implementation relationship | Milestone obligation | Apply result after acceptance |
| --- | --- | --- | --- |
| `suppress_definition_production@1` | In-session and out-of-session suppression already implement adjacent durable behavior | Add a thin invocation-aware adapter over a shared production-suppression domain command | `applied` or truthful non-effect outcome |
| `create_contrast_cluster@1` | Cluster/member/prompt primitives and intake composition exist, but no registry adapter owns this exact atomic payload | Implement one atomic creation adapter with complete effect references | `applied` or truthful non-effect outcome |
| `repair_production_cue@1` | No durable cue model or faithful adapter exists | Validate, render, and allow typed editing/acceptance; do not apply | `unsupported` |
| `accept_production_alternate@1` | No grading or answer-class implementation can represent the effect truthfully | Validate, render, and allow typed editing/acceptance; do not apply | `unsupported` |

The provider-spike operations change as follows:

- remove `flag_bad_production_cue`; legacy bad-prompt feedback is not its
  adapter and no durable cue-level flag has been designed;
- rename and narrow `upsert_contrast_content` to
  `create_contrast_cluster@1`; the model cannot select `extend_cluster`;
- remove cue-snapshot scope and the retrospective-credit variant from
  `accept_production_alternate`;
- remove the separate `uncertain` boolean and use the
  `insufficient_evidence` diagnosis tag for model uncertainty;
- remove model-generated proposal, question, and unhandled-need keys; durable
  proposal ids are assigned during materialization; and
- remove the top-level result `summary`.

Choosing no operation remains valid. Missing deletion, cue disassociation,
cluster extension, general-priority, or other unsupported needs use
`unhandledNeeds`.

Provider cases that previously required bad-cue flagging should retain the
diagnosis in item output. They propose `repair_production_cue` only when they
contain a concrete replacement; otherwise they emit no operation and may
record an `unhandledNeed`.

## 4. Legacy Bad-Production-Prompt Debt

The existing `bad_production_prompt` behavior remains available through current
in-session and out-of-session manual paths. It is a word-scoped band-aid:
definition production is withheld because the current gloss set produces a
low-value exercise even though recall may still be worth training.

This differs from `suppress_definition_production`, which says definition
production is not a worthwhile training goal even if a good prompt could be
written.

Continued manual bad-prompt use is explicit product debt and a temporary
user-operated escape hatch. Keep it until reflection offers more productive
handles and a desirable cue model supplies a target worth repairing toward.
The steel thread must not:

- expose it as a reflection operation;
- treat it as a production-cue entity or adapter;
- remove its current UI/API paths; or
- migrate its backlog into future cue operations automatically.

## 5. End-To-End Flow

```text
completed review session
  -> flush final accepted attempt commit
  -> submit typed production evidence supplement
  -> backend validates session/attempt references and enriches context
  -> one Luna call
  -> strict result and operation validation
  -> immutable artifact + proposal review rows
  -> return artifact identity without changing session outcome

later or immediately
  -> reflection queue/detail
  -> proposal-level defer, dismiss, edit, or accept
  -> immutable authorized invocation
  -> supported adapter or explicit unsupported state
  -> persisted application result and effect attribution
```

Generation is best-effort and outside session correctness. The completed
session UI should trigger the request once after the final commit flush and
show a non-blocking generating/succeeded/failed status. Ending or leaving the
session remains allowed. Once the server has received the request it may finish
the synchronous provider call even if the client navigates away.

For the first cut, `(sessionId, reflection flow version)` is the idempotency
boundary. Repeating a successful request returns the existing artifact rather
than generating a duplicate. A failed request with no artifact may be retried
while the client still holds the evidence supplement. Durable replay after the
ephemeral session state is gone is deferred.

## 6. Persistence Contract For This Milestone

Use three conceptual SQLite tables. Exact column spelling may follow repository
conventions, but the responsibilities and identities below are required.

### `reflection_artifacts`

One immutable row per successful steel-thread generation:

- durable artifact id;
- source session id and reflection-flow idempotency key;
- generation timestamp;
- provider/model and prompt version;
- bundle and result schema versions;
- the exact bounded evidence bundle as JSON; and
- the validated reflection result as JSON.

Invalid or provider-failed output does not create a successful artifact. A
separate durable failure ledger is not required.

### `reflection_proposal_reviews`

Seed one mutable row per proposal, not per item:

- durable proposal id;
- artifact id;
- immutable item id and zero-based proposal index locating the original
  proposal in the artifact;
- current review disposition;
- updated timestamp;
- acceptance mode and accepted invocation id when accepted; and
- supersession metadata when applicable.

Enforce uniqueness for `(artifactId, itemId, proposalIndex)`. Items with no
proposals do not receive fake review rows. The artifact JSON remains the source
for original proposal content.

### `reflection_operation_invocations`

One immutable authorized operation plus its mutable application status:

- invocation id;
- origin kind and proposal/replacement reference when present;
- creation timestamp;
- operation kind, version, and exact validated JSON;
- application state and update timestamp;
- safe error or stale reason where applicable;
- caused effect references for `applied`; and
- satisfying references for `already_satisfied`.

No append-only transition-event tables are required. The current projection
must preserve final causal truth. The operation/application columns may later
split physically without changing the product contract.

Do not implement the artifact-store planning note's older per-item disposition
table or duplicate an operation payload into an item row. That shape predates
the proposal-level lifecycle decision.

## 7. API Boundary

The first implementation should provide these semantic endpoints. Naming may
follow existing API conventions, but collapsing the authorization and
application semantics is not allowed.

### Generate

```text
POST /api/study-sessions/:sessionId/reflections
```

Input: a strictly validated evidence supplement containing the initial
cue-as-shown, raw typed response, and links to the relevant accepted attempt
events. These links are validation-only and are not copied into the provider
bundle. The client does not supply enriched word/content truth.

Behavior:

1. verify the session and attempt references;
2. build and validate the bundle;
3. call the configured backend provider;
4. validate the result;
5. atomically persist the artifact and pending proposal-review rows; and
6. return the artifact id and a compact generation result.

The route must never roll back or alter already-committed study attempts or
session completion.

### Review queue and detail

```text
GET /api/reflection-artifacts?review=open|all
GET /api/reflection-artifacts/:artifactId
```

The open view includes artifacts with `pending` or `deferred` proposals. The
all view supplies a recent artifact history so an informational reflection with
no proposals remains discoverable after the completed-session UI is gone.
Detail joins immutable item/proposal content to current proposal review,
invocation, and application statuses.

Informational item results with no proposals remain visible in artifact detail
and history but require no disposition.

### Review one proposal

```text
POST /api/reflection-proposals/:proposalId/review
```

Use a strict action union:

```ts
type ReviewProposalRequest =
  | { action: 'defer' }
  | { action: 'dismiss'; reason: string | null }
  | { action: 'accept'; operation: ReflectionOperation };
```

For acceptance, the backend validates the supplied operation, compares its kind,
version, and payload to the immutable original, determines `exact` versus
`revised`, creates the invocation, and initializes application as `pending` or
`unsupported`.

Supported application begins immediately after authorization. Return the
updated proposal review and application result. If application is separated
from the authorization transaction, a durable `pending` row must be recoverable
and safely reprocessed by invocation id after a process interruption.

The steel-thread UI does not create different-kind replacements or fully manual
invocations, although the persistence model must not preclude them.

Authorization withdrawal is an application transition, not a rewrite of
accepted proposal review:

```text
POST /api/reflection-invocations/:invocationId/withdraw-authorization
```

It is valid only while the application is `unsupported` or safely cancellable
`pending`. The proposal's historical disposition remains `accepted`.

## 8. Minimal Review Surface

Add a `Reflections` destination reachable outside an active session, with an
open-proposal queue and a minimal recent-artifact history.

The queue/detail surface must:

- show source-session time and each immutable item observation;
- render questions and unhandled needs as informational content;
- display each proposal separately even when grouped;
- show original rationale and typed operation fields;
- expose `defer`, `dismiss`, `accept`, and operation-specific edit controls;
- compute exact versus revised acceptance on the backend;
- disclose apply support before acceptance;
- make unsupported acceptance and its standing-authorization meaning clear;
- show application state, non-effect reason, and caused effects after review;
- allow authorization withdrawal while an accepted operation is still
  unsupported or pending; and
- keep `pending` and `deferred` proposals resumable in the open queue.

Operation-specific editors are required for the four emitted operations.
Generated title, notes, member annotations, prompts, and cue drafts remain
editable. The steel thread does not build a from-scratch manual workbench,
different-kind replacement UI, JSON editor, or schema-generated universal form.

There is no top-level reflection summary surface.

## 9. Validation And Adapter Requirements

### Result and authorization validation

- reject unknown fields, kinds, and versions;
- require exactly one result per supplied item;
- enforce key uniqueness;
- resolve all word references against the corresponding evidence item;
- reject operation references to invisible or unknown entities;
- apply all deterministic operation-specific rules from the canonical spec;
- revalidate edited operations on the backend; and
- never parse rationale, observations, or notes to discover application data.

Semantic quality remains a prompt/evaluation/user-review concern. Add
deterministic lint only where dogfooding demonstrates a clear, reliable rule.

### Suppression adapter

- extract or reuse one domain command for definition-production suppression;
- validate current word visibility/existence;
- return `already_satisfied` when already suppressed;
- preserve legacy session-event provenance for legacy callers;
- attribute only a newly caused relevance effect to the invocation; and
- leave recognition, contextual-selection, priority, and lifecycle untouched.

### Contrast-creation adapter

- validate at least two unique members and one prompt;
- validate prompt targets and all entity references;
- create cluster, members, annotations, and prompts in one transaction;
- return complete effect references;
- be idempotent by invocation id;
- use `already_satisfied` only for a deterministic exact postcondition;
- create a new cluster when overlap is merely approximate; and
- never extend, merge, overwrite, delete, or resolve intake implicitly.

### Unsupported adapters

Accepting cue repair or a production alternate:

- stores the exact authorized invocation;
- creates application state `unsupported` with a clear reason;
- performs no domain write;
- remains withdrawable; and
- is never reinterpreted under a future operation version.

Automatic discovery and application when these operations later gain support is
not required by this milestone.

## 10. Implementation Slices

### Slice 0 — contract and frontier alignment

- [x] Accept the canonical spec and this milestone boundary.
- [x] Update the stability frontier's “per-item disposition” wording to
      proposal-level review and link the canonical spec.
- [x] Replace the artifact-store planning note's per-item persistence assumption
      with the accepted proposal-level shape, or retire that note once this plan
      owns the implementation contract.
- [x] Update provider-spike copied contracts, schema, prompt, fixtures, and
      validators to `session_reflection_result.v4`. Revise and version the
      prompt for the accepted post-spike semantics: emit atomic independently
      reviewable proposals; propose only new contrast clusters; distinguish
      durable directional alternate acceptance from cue-specific retrospective
      credit; never treat legacy bad-prompt state as a handle; and propose cue
      repair only with a concrete draft, otherwise retaining diagnosis and
      using no proposal or an unhandled need.
- [x] Remove `flag_bad_production_cue`, remove `summary`, rename the contrast
      operation, and narrow the alternate payload.

### Slice 1 — durable artifact and lifecycle store

- [ ] Add schema initialization for artifacts, proposal reviews, and
      invocations/application statuses.
- [ ] Add persistence functions through a reflection-focused DB module/barrel.
- [ ] Materialize validated results atomically with one pending review row per
      proposal.
- [ ] Implement review and application transition invariants.
- [ ] Add idempotency and joined read models for queue/detail UI.

### Slice 2 — completed-session evidence and generation

- [ ] Preserve typed production response, cue as shown, and validation-only
      attempt links in a frontend session-evidence accumulator.
- [ ] Trigger reflection only after the final pending study commit flushes.
- [ ] Add backend bundle enrichment and strict validation.
- [ ] Integrate the configured server-side Luna call and prompt version.
- [ ] Persist only valid results and keep all failures outside study
      correctness.
- [ ] Make generation idempotent for the first flow version.

### Slice 3 — proposal review and supported application

- [ ] Add queue, artifact-detail, and proposal-review endpoints.
- [ ] Implement exact/revised authorization and immutable invocation creation.
- [ ] Implement production-suppression and atomic contrast-creation adapters.
- [ ] Persist unsupported cue-repair and alternate applications truthfully.
- [ ] Implement pending recovery if application is not transactional with
      authorization.
- [ ] Return application effects and non-effect reasons to the client.

### Slice 4 — learner-facing review UI

- [ ] Add the Reflections navigation destination and controller boundary.
- [ ] Show completed-session generation progress without blocking session exit.
- [ ] Render item analysis and proposal cards from durable detail.
- [ ] Add defer, dismiss, accept, withdraw, and operation-specific edit flows.
- [ ] Show support before acceptance and status/effects afterward.
- [ ] Keep unresolved proposals resumable across reloads.

### Slice 5 — dogfood hardening

- [ ] Exercise at least one no-proposal result, exact acceptance, revised
      acceptance, dismissal, deferral, supported apply, unsupported acceptance,
      withdrawal, already-satisfied outcome, stale outcome, and failed apply.
- [ ] Exercise compound item output with independently reviewed proposals.
- [ ] Verify a provider error and invalid result leave study completion intact.
- [ ] Record prompt, validation, editor, and cue-model findings without
      expanding the milestone automatically.
- [ ] Update API, DB, frontend architecture, and testing maps with the
      implemented boundaries.

## 11. Verification

Add automated coverage for every new deterministic validation, lifecycle,
persistence, adapter, API, and frontend/controller surface wherever the
repository has a reasonable unit or integration-test seam.

At minimum add focused tests for:

- strict V3 result validation and cross-field operation validation;
- artifact materialization and proposal-level seeding;
- every review transition and invalid transition;
- exact versus revised invocation creation;
- supported, unsupported, stale, already-satisfied, failed, and withdrawn
  application outcomes;
- invocation idempotency and effect attribution;
- atomic contrast creation and rollback;
- generation idempotency;
- generation/provider/validation failure isolation from study state; and
- queue/detail reconstruction across process reload.

If a crucial behavior cannot be covered cleanly because test infrastructure or
an established test seam is missing, record the gap in the steel-thread
handoff. State the uncovered behavior and risk, why the available pattern is
inadequate, the compensating manual verification performed, and the smallest
clean testing capability that would close the gap. Do not silently treat manual
testing as equivalent coverage.

Run:

```text
npm test
npm run build
```

Use one manual study-mode smoke test with a real completed session and provider
credential before declaring the steel thread demonstrated. Do not place secrets
in fixtures, logs, artifacts, or committed configuration.

## 12. Done Criteria

The milestone is complete when:

- [ ] a real completed review session can produce a valid durable reflection;
- [ ] normal study completion remains correct when reflection is absent or
      fails;
- [ ] the user can return later and independently disposition every proposal;
- [ ] original proposal and final authorized operation remain distinguishable;
- [ ] supported acceptance produces only the exact validated effect and records
      it truthfully;
- [ ] unsupported acceptance visibly changes no study/content state;
- [ ] generated contrast/cue content can be edited before authorization;
- [ ] application outcomes survive reload and can be traced to their invocation;
- [ ] legacy manual paths remain functional and reconcilable;
- [ ] focused automated tests cover all new surfaces where a reasonable unit or
      integration-test seam exists, and the full test suite and build pass;
- [ ] any crucial automated-test gap is explicitly documented with its risk,
      cause, compensating verification, and required enabling test capability;
- [ ] the canonical spec, API map, DB map, frontend map, tests, and code agree;
      and
- [ ] dogfooding has produced a concrete next set of prompt/validation/product
      findings without requiring the cue model to be designed prematurely.

These criteria satisfy the current frontier advancement test for the selected
steel-thread slice. Advancing or replacing the frontier remains an explicit
human decision.

## 13. Explicit Non-Goals

- session-note and contrast-selection reflection inputs;
- broad learner-history enrichment;
- durable replay after the frontend loses its evidence accumulator;
- interruption/navigation-away recovery before the generation request reaches
  the server;
- a final cue, production-task, answer-class, or grading model;
- applying cue repairs or production alternates;
- cluster extension, overlap-driven merge UI, or automatic deduplication;
- replacing or removing legacy bad-production-prompt behavior;
- generic manual invocation or different-kind replacement UI;
- automatic application when an unsupported operation later gains an adapter;
- full transition event history or automatic application retry after `failed`;
- planner, scheduling-policy, or attempt-outcome reinterpretation;
- hosted tenancy, publication, or shared-content implementation;
- automatic model authority; and
- a comprehensive evaluation platform.

## 14. Stop Conditions

Stop and request product input rather than inventing policy if implementation
shows that:

- production evidence cannot be captured before teardown without changing
  session correctness;
- the selected result schema cannot represent a recurring high-value reflection
  without semantic distortion;
- a supported adapter cannot preserve atomicity or effect attribution;
- the review UI cannot disclose unsupported standing authorization clearly;
- existing manual mutations make deterministic `already_satisfied` or stale
  classification impossible for a required adapter; or
- the content-ownership deferral would require destructive mutation of base
  content.
