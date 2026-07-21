# Handle Registry V0 post-spike stabilization

status: active
type: work-bundle
created: 2026-07-21
retire-when: Handle Registry V0 is accepted as implementation-ready and the durable decisions are incorporated into `SPECS/reflection-handle-registry-v0.md`
related:
  - TASKS.md (Focus)
  - SPECS/reflection-handle-registry-v0.md
  - notes/active/2026-07-20-llm-provider-spike-summary.md
  - notes/active/2026-07-20-m1-artifact-store-planning.md
  - notes/active/2026-07-10-session-evidence-bundle-design.md
  - spikes/llm-provider/contracts.ts

## Purpose and history

Finish the Handle Registry V0 contract after the provider spike supplied real
feedback about which operation shapes the reflection model can usefully emit.

The registry and provider spike intentionally formed a feedback loop rather
than a simple one-way dependency:

```text
provisional registry
  -> end-to-end reflection prompt and strict result contract
  -> provider and fixture evaluation
  -> observed proposal shapes, awkward fields, and handle gaps
  -> post-spike registry stabilization
```

The existing registry spec is accepted for the first provider-spike iteration.
This task decides what must change before it becomes an implementation-ready
contract for the first product prototype. It must not silently treat open
questions recorded here as already accepted product behavior.

## Outcome

An accepted V0 specification that an implementation task can use to build
validation, artifact persistence, proposal review, and supported apply adapters
without inventing handle-related product policy.

## Deliverables

### 1. Handle-related type contract

Define the handle-related types required by the first prototype, including the
necessary boundaries among:

- reflection item and proposal identity;
- the operation discriminated union;
- registry-entry metadata and versioning;
- user disposition and operation application;
- provenance, supersession, and user-authored revisions or operations, to the
  extent V0 needs them; and
- invocation/apply results where they affect durable semantics.

For every field, record or make evident at least one of:

1. an immediate critical consumer or invariant; or
2. an important near-to-medium-term architectural distinction that would be
   costly to recover after artifacts exist.

Remove fields that serve neither purpose. Avoid speculative generality that
does not constrain an identified near-term risk.

Canonical definitions belong in the registry spec. Reconcile the provider
spike's copied contract types when necessary, without treating the spike copy as
the durable source of truth.

### 2. First-prototype handle inventory

Confirm the complete list of handles valid for the first product prototype.
Use the provider fixtures and reflection exemplars as evidence, not as a demand
to support every imaginable remediation.

Each observed intervention must map to exactly one of:

- a confirmed V0 handle;
- a deliberate `unhandledNeed`; or
- an explicitly deferred handle or product decision.

Choosing no handle must remain a valid outcome. The registry must not make the
model squeeze an unsupported need into the nearest operation.

### 3. Complete specification for each handle

Each confirmed handle entry must define, either directly or through shared
registry rules:

- purpose and learner intent;
- why it is one atomic operation;
- payload and field rationale;
- structural and cross-field validation;
- durable references and visibility requirements;
- current-state preconditions and staleness behavior;
- apply-support classification;
- idempotency and effect attribution expectations;
- equivalent or adjacent existing manual behavior;
- explicit non-effects; and
- any inverse/remediation behavior that V0 must support, or an explicit
  statement that reversal is deferred.

### 4. Lifecycle requirements

The lifecycle must support all of the following without pretending unsupported
behavior has occurred:

- The user may accept a valid handle before an apply adapter exists.
- Review, acceptance, dismissal, deferral, editing, and later application may
  happen asynchronously, after the originating study session has ended.
- Application revalidates current domain state because a proposal may become
  stale while awaiting review or implementation.
- Application failure does not erase acceptance or falsely claim a durable
  effect.
- The original model proposal, the exact user-authorized operation, and the
  eventual application result remain distinguishable for provenance.
- A proposal already satisfied or invalidated by another path can be reconciled
  without falsely attributing that external effect to the proposal.

As part of this task, decide whether the current single proposal-state sequence
is sufficient or whether user disposition and application status should be
modeled as separate axes. Do not adopt a more general state machine merely for
symmetry; choose the smallest model that represents the cases above truthfully.

### 5. User override and provenance decision

`User override` is not yet one accepted behavior. Resolve or explicitly defer
the relevant cases separately:

1. **Edit before acceptance:** the user changes a model-proposed payload before
   authorizing it. Decide how the original proposal and final authorized
   operation are both preserved; a user-authored revision that supersedes the
   original is one candidate.
2. **User-authored operation:** the user invokes a registry operation that the
   model did not propose. Decide whether this is a proposal with a different
   origin or a separate manual invocation of the same domain command.
3. **Externally satisfied proposal:** an existing manual path performs the
   durable change before proposal application. Reconcile it without claiming
   that the proposal caused the effect.
4. **Reversal after application:** decide whether V0 needs an explicit inverse
   operation. Do not mutate history by reopening a terminal proposal merely to
   represent reversal.
5. **Force invalid, stale, or unsupported operation:** default posture is that
   user authority may select or edit valid operations but does not bypass
   domain invariants. Any exception requires an explicit decision.

Only persistence-relevant semantics belong in the core registry contract. Pure
presentation affordances can remain UI concerns.

### 6. Invocation-path compatibility audit

Inventory the paths that currently perform the same or adjacent durable work
as proposed handles. At minimum cover:

- in-session `manage-study-action` operations: `suppress_skill`,
  `add_contrast_candidate`, `suppress_skill_and_add_contrast_candidate`, and
  `bad_prompt`;
- out-of-session production suppression and bad-prompt reporting;
- existing contrast-cluster, member, and prompt creation/edit paths; and
- the future reflection-proposal application path.

For each path, record:

- the initiating surface and actor;
- its durable domain effect and current provenance;
- the equivalent V0 handle, if any;
- whether it should remain a parallel entry point, converge on a shared domain
  command/apply adapter, or eventually be deprecated;
- how duplicate, already-satisfied, conflicting, and stale operations are
  reconciled; and
- whether the path can produce a state outside the lifecycle or invariants
  modeled by the registry.

The likely architectural direction to evaluate is:

> Handles need not be the only way a user invokes durable operations, but
> reflection application and manual UI paths should converge on the same
> validated domain commands and preserve truthful origin/effect provenance.

This task must make a compatibility decision for existing paths. It does not
need to remove or reimplement those paths.

## Definition of done

The task is done when:

- [ ] The first-prototype handle inventory is explicitly confirmed.
- [ ] Canonical handle-related types are defined and pass the field-purpose
      test.
- [ ] Every confirmed handle has a complete, internally consistent entry.
- [ ] Provider-spike cases are covered by a handle, intentional unhandled need,
      or explicit deferral.
- [ ] The lifecycle truthfully represents unimplemented handles, asynchronous
      review, staleness, application failure, and effect attribution.
- [ ] User edit/override/provenance cases are decided or explicitly deferred
      with a safe V0 behavior.
- [ ] Existing manual and session-originated mutation paths are inventoried and
      assigned compatibility decisions.
- [ ] Remaining questions are classified as non-blocking implementation
      details or later registry versions rather than left implicit.
- [ ] `SPECS/reflection-handle-registry-v0.md` contains the accepted durable
      decisions and no longer depends on this note to interpret core behavior.
- [ ] An implementation agent could build validation and persistence without
      inventing handle-related product policy.

## Non-goals

- Implement artifact tables or migrations.
- Implement the reflection review UI.
- Implement runtime validation or every apply adapter.
- Remove or deprecate existing manual UI/API paths during this task.
- Finalize production-cue storage, answer classes, general priority policy, or
  other schema-first handle dependencies that remain explicit later work.
- Generalize the registry into a universal command framework.
- Build automatic proposal application or allow the model to mutate durable
  state directly.

## Expected durable output

Update `SPECS/reflection-handle-registry-v0.md` as decisions settle. A useful
final structure should include:

- the canonical type contract;
- the confirmed registry entries;
- lifecycle and provenance invariants;
- an invocation compatibility matrix;
- explicit V0 non-goals and deferred handles; and
- enough acceptance examples or transition cases to remove ambiguity.

This note remains working memory and should be retired once those conclusions
have graduated into the spec.
