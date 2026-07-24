# Handle Registry V0 stabilization staging

status: active
type: coordination
created: 2026-07-23
retire-when: its accepted conclusions are synthesized into `SPECS/reflection-handle-registry-v0.md` and the Handle Registry V0 focus task is closed
related:
  - TASKS.md
  - notes/active/2026-07-21-handle-registry-v0-task-spec.md
  - SPECS/reflection-handle-registry-v0.md
  - notes/active/2026-07-20-llm-provider-spike-summary.md
  - notes/active/2026-07-20-m1-artifact-store-planning.md

## Purpose

This is temporary staging space for working through the open decisions in the
Handle Registry V0 stabilization task. It collects provisional reasoning and
polished topic conclusions before they are synthesized into the canonical
registry specification.

This note is not implementation authority and must not outlive this task.
`SPECS/reflection-handle-registry-v0.md` remains the current durable design
record until accepted conclusions are deliberately incorporated there.

## Working model

- Confident or bounded topics may be worked through directly in the primary
  task thread. The agent should exercise independent judgment, surface risks or
  contradictions, and update this note with the resulting provisional
  conclusion.
- Meatier topics may be explored in a subagent task when the user explicitly
  asks for one. The subagent should receive a bounded topic and clear ownership
  of its staging section, may explore alternatives freely, and should leave a
  polished conclusion or clearly framed unresolved decision here when ready.
- Exploratory discussion is not automatically a decision. Each topic section
  should distinguish evidence, alternatives, the current proposed conclusion,
  and unresolved questions where those distinctions matter.
- Conclusions recorded here are inputs to a later whole-contract synthesis.
  They may expose conflicts when considered together; local agreement on one
  topic does not bypass that final consistency pass.
- Existing behavior, canonical product specs, and truthful provenance remain
  constraints. Confidence in a proposed decision does not remove the need to
  call out migration, compatibility, validation, or reversibility risks.

## Topic status vocabulary

- **Open:** under discussion; no proposed conclusion is ready.
- **Proposed:** a preferred conclusion exists but has not passed the final
  cross-topic synthesis.
- **Ready for synthesis:** sufficiently worked through to incorporate into the
  canonical registry unless the final consistency pass exposes a conflict.
- **Deferred:** deliberately excluded from V0 with a safe interim behavior.

## Initial topic intake

These are review prompts, not accepted conclusions:

1. User disposition versus operation-application lifecycle.
2. User edits, user-authored operations, supersession, and provenance.
3. The representational purpose and V0 fate of
   `accept_production_alternate`.
4. Proposal identity and proposal-level durable disposition.
5. Cross-field validation and semantically negated or redundant operations.
6. Exact effects and reconciliation semantics for bad-cue flagging and cue
   repair.
7. Revisable generated content inside `upsert_contrast_content` and
   `repair_production_cue`.
8. Canonical result-contract drift and field-purpose cleanup.
9. Compatibility with existing in-session and out-of-session manual mutation
   paths.
10. Untested `extend_cluster`, duplicate-content, stale-reference, and
    externally-satisfied cases.

## Topic conclusions

Add one section per topic as it is taken up. Prefer a compact structure such as:

```markdown
### Topic

Status: Open

Evidence:

Alternatives:

Proposed conclusion:

Risks or unresolved questions:
```

Omit empty headings when a topic does not need the full structure.

### Proposal review disposition

Status: Proposed

The first lifecycle axis records the current review disposition of a proposal,
separately from whether its operation can or does take effect:

- `pending`: the reflection proposal exists but has not yet been processed by
  the user.
- `deferred`: the user has reviewed the proposal and deliberately postponed a
  decision.
- `accepted`: the user has approved the exact authorized operation. Acceptance
  makes the operation eligible for the separate application lifecycle; it does
  not imply that application is supported, attempted, or successful.
- `dismissed`: the user has judged the proposal unsuitable or not worthwhile
  and rejects it.
- `superseded`: the proposal is no longer operative because a replacement or
  another identified event made it superfluous.

For ordinary product behavior, `pending` and `deferred` are both unresolved and
may be presented again. Their distinction records whether the user has already
considered the proposal and may support different UI treatment. `dismissed` and
`superseded` are both terminal and normally leave the active review queue, but
their distinction preserves why the proposal left it.

The axis is more accurately called **review disposition** than strictly **user
disposition**. `superseded` may be established by reconciliation with a
replacement or external state rather than by a direct user judgment. Any
supersession must therefore retain its actor/source, reason, and link to the
replacement or satisfying event where one exists.

For V0, `dismissed` is the coarse negative quality or fitness judgment. Quality
is broad here: the diagnosis, intervention choice, drafted content, or fit for
the learner may be inadequate. Earlier planning listed `dismissed` separately
from `marked-wrong`, and the provider-spike handoff proposed finer adjudication
categories such as wrong diagnosis, wrong intervention, and weak drafted
content. The artifact-store note also used “dismissed Tuesday, reopened
Thursday” as an illustration of durable review history, but that was not an
accepted transition contract and blurred dismissal with what is now called
deferral. Those notes did not establish a concrete non-quality dismissal case.
The disposition can therefore remain coarse while optional dismissal or
adjudication metadata records finer reasons when the initial learning loop
needs them. A proposal made unnecessary by another action is `superseded`, not
`dismissed`.

Tentative transitions:

```text
pending  -> accepted | dismissed | deferred | superseded
deferred -> accepted | dismissed | superseded
```

For V0, all of `accepted`, `dismissed`, and `superseded` are terminal review
dispositions. `accepted` preserves the historical fact that the exact operation
was authorized and transfers subsequent handling to the application lifecycle.
The separate axes intentionally represent combinations such as `accepted` plus
application-pending and `accepted` plus application-applied without introducing
combined disposition values.

If the user changes their mind after acceptance but before an effect occurs,
V0 may record a special terminal application outcome such as
`authorization_withdrawn` rather than reopening the review disposition. This
is expected to be a minority path. A future version may make current user
authorization independently mutable if real use shows that withdrawal and
reauthorization need first-class behavior.

An accepted proposal later found to be already satisfied should normally remain
historically accepted; the separate application/reconciliation record should
state that no effect was caused by this proposal. User-edited replacements and
their relationship to `superseded` remain part of the provenance topic.

### Accepted-operation application lifecycle

Status: Proposed

The application lifecycle exists only for proposals whose review disposition is
`accepted`. There is therefore no persisted `not_requested` application status:
an unaccepted proposal simply has no application lifecycle record. The product
may derive “not applicable” when presenting all proposals together.

Proposed V0 statuses:

- `unsupported`: the operation kind and payload are valid, but the application
  has no apply adapter for that handle version. This is a nonterminal blocked
  state, not an application failure. It is valuable during the first dogfood
  because the user may accept a useful operation before its adapter exists.
- `pending`: an apply adapter exists and the exact accepted operation is queued
  or being processed, but no terminal application outcome has committed.
  Entering this state should trigger application automatically; it does not
  represent a second user-review step.
- `applied`: this application successfully committed the exact authorized
  durable effect and recorded its effect references. Terminal.
- `failed`: application did not commit a durable effect because of an
  application or infrastructure error. Terminal for V0, with a truthful error
  record and no automatic retry. A later retry model, if needed, should
  introduce explicit application-attempt history rather than making terminal
  outcomes ambiguous.
- `stale`: apply-time validation found that the accepted operation's
  preconditions no longer hold and the exact operation is no longer safely
  applicable. No effect is attributed to the proposal. Terminal.
- `already_satisfied`: the operation's intended durable postcondition is
  already true because of a manual path, another proposal, or another external
  event. The application records the satisfying source/effect where available
  but must not claim that this proposal caused it. Terminal. This name is
  preferred over `externally_satisfied`, whose meaning is less immediate. An
  adapter may use this outcome only when the relevant domain state proves the
  intended postcondition deterministically; approximate semantic similarity is
  not enough to claim satisfaction.
- `authorization_withdrawn`: after acceptance but before any effect, the user
  withdrew permission to apply the operation. No effect occurred and no
  automatic application or retry is allowed. Terminal V0 escape hatch for an
  expected minority case.

Tentative transitions:

```text
accepted + supported   -> pending
accepted + unsupported -> unsupported

pending     -> applied | failed | stale | already_satisfied
             | authorization_withdrawn
unsupported -> pending | authorization_withdrawn
```

`pending` may be very short-lived when application is attempted in the same
request as acceptance, but a durable intermediate state may still be needed to
preserve acceptance and recover truthfully if the process stops between
recording authorization and recording the application outcome.

`stale` and `superseded` describe related superfluity at different boundaries.
An unaccepted proposal made irrelevant during review may be `superseded`. Once
accepted, its historical disposition remains accepted; an apply-time
precondition failure is `stale`, while an already-achieved intended effect is
`already_satisfied`.

Acceptance of an `unsupported` operation grants standing authorization for the
exact operation to be attempted if an adapter for that handle version later
becomes available. Once selected for processing, the application transitions
directly from `unsupported` to `pending` and follows the ordinary apply-time
revalidation path. There is no compound `unsupported_now_pending` state:
`pending` records the current truth, while lifecycle history may record when
support became available and whether enqueueing was triggered by acceptance,
adapter availability, or an administrative/manual scan.

Detecting newly supported proposals and enqueueing them may remain
lower-priority implementation work. The V0 contract need only preserve the
transition and enough versioned identity to make later processing possible.
The user must remain able to reach `authorization_withdrawn` before an effect
occurs, and a future non-dogfood UI should disclose the standing-authorization
meaning when an unsupported operation is accepted.

Long-term presentation of `unsupported` is a separate product question whose
answer may depend on whether the user is a developer/dogfood user or an ordinary
learner. It does not need to change the truthful V0 persistence state. If worth
tracking beyond this focus task, capture it as product debt in Linear rather
than expanding the handle-registry contract.

### Artifact immutability and review state

Status: Proposed

The generated reflection artifact should remain immutable. It captures the
bounded evidence, model/prompt/schema provenance, validated reflection result,
and original model proposals exactly as generated. User disposition, edited or
final authorized operations, application status, and effect attribution do not
mutate that artifact body.

Those later facts must still be persisted in separate proposal-review and
application records keyed to durable artifact and proposal identities. Joining
the immutable artifact to those records provides the complete causal picture:
what the model proposed, what the user ultimately authorized or rejected, what
the application attempted, and what effect—if any—actually occurred.

Persisting disposition somewhere is necessary for asynchronous review,
resuming the review queue, unsupported operations, and outcomes such as
`dismissed` or `deferred` that leave no domain effect from which they could be
reconstructed. It is not necessary, or desirable, to embed disposition in the
generate-once artifact.

A mutable current-state projection is sufficient to reconstruct the final
causal picture if it preserves the original artifact reference, exact authorized
operation, terminal disposition/application outcome, and effect references. A
complete chronology of intermediate transitions such as defer-then-accept would
instead require append-only review/application events or equivalent history.
Whether V0 needs that full chronology remains a storage-contract question; it
does not change the artifact immutability boundary.

### Production alternate

Status: Ready for synthesis

The motivating case for `accept_production_alternate` is a pair such as
怪不得/难怪. Although a register distinction may exist, the present product
does not clearly benefit from requiring the learner to produce one rather than
the other. Suppressing definition production for both words would also be too
strong: the useful skill is intuitive production of an ordinary way to express
“no wonder.”

The provider spike exposed a second, importantly different judgment. In several
cases, the learner's non-target answer was reasonable given the particular cue
even though the target and answer were not generally acceptable production
alternates. That may justify describing the completed attempt as reasonable or
the cue as underdetermined, but it must not silently create durable future
grading policy between the two words.

V0 should retain `accept_production_alternate`, but narrow it to the first
purpose: a durable, directional future-grading rule. Given a production prompt
whose target is `targetWordId`, producing `alternateWordId` counts as an
acceptable answer under the current coarse definition-production model. The
rule is deliberately directional. Accepting B when A is targeted does not imply
accepting A when B is targeted, because the words may have different
definition-based production prompts and different coverage even when they
overlap strongly in one direction. Reflection may propose both directions when
both claims are independently supported.

The operation must therefore not claim a global symmetric synonym edge. It is
also stronger than “the learner deserves credit this time.” The source cue and
attempt may be retained as proposal evidence or provenance, but an ephemeral
cue instance is not the durable scope of the V0 effect. The current
`fully_acceptable_for_cue | near_valid_creditworthy_answer` union conflates the
two purposes and should not survive synthesis in that form. In particular,
cue-induced reasonableness is not sufficient evidence for this handle.

This handle is part of the initial registry deliverable and should have a
specified eventual durable effect even though its apply adapter remains
unsupported. The adapter remains unsupported until production grading can
accept the alternate as communicative success without falsely claiming that
the nominal target word was retrieved.

Cross-field validation should at least require distinct, known target and
alternate words. The prompt and supplied existing-state context should prevent
the model from proposing an already-established directional rule. If a
duplicate nevertheless reaches application because of model error, concurrent
work, or state drift, the adapter should return `already_satisfied` and must not
attribute the existing rule to this proposal. Exhaustively polishing
handle-specific equivalence and reconciliation cases beyond deterministic
duplicates is not required for V0.

The reflection prompt and evaluation set should enforce the boundary:

- propose `accept_production_alternate` only when the alternate should be
  accepted for future production attempts targeting that word;
- do not propose it merely to give retrospective credit for a reasonable answer
  to an ambiguous, overly broad, or misleading cue;
- use cue diagnosis, bad-cue flagging, repair, learner explanation, or an
  unhandled need for the latter case, as appropriate; and
- include cases that distinguish durable directional acceptance from
  cue-specific reasonableness and from a useful contrast relation.

The clean longer-term model is likely cue- or production-task-oriented. A
first-class production task can define the skill being tested and its accepted
answer set: two words may both be valid for one broad task while only one is
valid for a task intended to train a usage, register, or contrast distinction.
Words can remain a source of scheduling demand without being identical to the
task or evidence unit.

Attempt-local “give credit” adjudication is explicitly deferred rather than
smuggled into this handle. A coherent version requires several connected
capabilities:

1. a neutral or non-diagnostic learning outcome that does not increase or
   decrease the nominal target's strength;
2. separation of strength from a possibly shorter retest time;
3. stable identity and versioning for the presented cue or production task;
4. task-specific success and accepted-answer semantics;
5. evidence attribution independent of the nominal target, so one attempt can
   provide different evidence about semantic production, target recall,
   register control, or a newly exposed confusion;
6. cue flagging, repair, or replacement and a more discriminating retest path;
   and
7. an eventual scheduling policy that consumes this richer evidence and
   clarifies the continuing role of words as primary scheduling drivers.

The log-based session trace is a promising foundation for post-hoc
adjudication. It can preserve the presented task, response, initial judgment,
and later evidence or reinterpretation as append-only history, allowing
learning-state projections to be regenerated later rather than destructively
rewriting the attempt. This preserves the option without making projection or
scheduling-policy work a prerequisite for the production-alternate handle.
Later design must still decide when projections are refreshed and how to handle
effects already caused by an earlier projection.

## Final synthesis checklist

Before retiring this note:

- reconcile conclusions across topics rather than copying sections
  independently;
- update the canonical type contract, handle inventory and entries, lifecycle,
  provenance rules, and invocation compatibility matrix together;
- reconcile the provider spike's copied contract with the canonical contract;
- classify remaining questions as safe implementation detail, explicit V0
  deferral, or a blocker requiring human judgment;
- verify that validation and persistence can be implemented without inventing
  handle-related product policy; and
- retire this note after its durable conclusions have graduated into
  `SPECS/reflection-handle-registry-v0.md`.
