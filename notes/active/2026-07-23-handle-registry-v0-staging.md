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

## Planning horizons

This work deliberately reasons across two horizons:

1. **First full-prototype alignment.** The handle registry, invocation model,
   lifecycle, provenance, and manual/editing paths need enough end-to-end
   coherence that the user can trust the narrower implementation direction.
   Decisions at this horizon may define eventual durable effects, bounded
   manual-authoring semantics, or unsupported operations without committing the
   current build wave to implement every surface or adapter.
2. **Initial reflection steel thread.** The current stability frontier aims only
   to dogfood one learner-facing post-session reflection path with durable
   asynchronous review and truthful application of accepted, supported
   operations. Its implementation should take the smallest useful slice through
   the full-prototype contract.

The full-prototype picture constrains the steel thread: the narrow slice must
not create payload, identity, lifecycle, or provenance choices that the larger
model already shows to be unsafe. The reverse is not true: describing a coherent
full-prototype capability here does not make it a steel-thread deliverable,
promote it into the current build wave, or override the frontier's explicit
non-goals.

During final synthesis, distinguish:

- contract semantics needed now so the steel thread does not paint itself into
  a corner;
- behavior and surfaces the steel thread must actually implement;
- accepted full-prototype direction whose implementation remains deferred; and
- genuinely open later-product policy.

## Working model

- Confident or bounded topics may be worked through directly in the primary
  task thread. The agent should exercise independent judgment, surface risks or
  contradictions, and update this note with the resulting provisional
  conclusion.
- Meatier topics may be explored in a forked, user-visible task when the user
  explicitly asks for one. The fork should receive a bounded topic and clear
  ownership of its staging section, may explore alternatives freely, and
  should leave a polished conclusion or clearly framed unresolved decision
  here when ready.
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

For proposal-originated operations, the application lifecycle exists only once
the proposal's review disposition is `accepted` and an exact authorized
invocation has been recorded. There is therefore no persisted `not_requested`
application status: an unaccepted proposal simply has no associated application
record. The product may derive “not applicable” when presenting all proposals
together. The same invocation and application machinery may also serve
user-authored operations that have no originating proposal.

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

Those later facts must still be persisted separately. A proposal-review record
is keyed to durable artifact and proposal identities. Authorization creates an
immutable invocation containing the exact approved operation, and application
state and effects are keyed to that invocation. A reflection-originated
invocation is linked through its proposal review; a fully manual invocation may
have no artifact or proposal. Joining the immutable artifact to the linked
review and invocation records provides the complete causal picture: what the
model proposed, what the user ultimately authorized or rejected, what the
application attempted, and what effect—if any—actually occurred.

Lifecycle persistence is therefore proposal-level, not merely item-level. An
item result groups a diagnosis, explanation, and zero or more proposals around
the same evidence item, but each proposal receives its own durable identity and
review record. Proposals nested under one item may be accepted, dismissed,
deferred, or superseded independently; an item-level status cannot substitute
for those individual histories.

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

### Validation boundary and cue-model deferral

Status: Ready for synthesis

Cross-field validation does not require another large architectural design
before the steel thread. V0 should specify the deterministic invariants already
needed to persist and eventually apply typed operations safely, including:

- known handle kinds and explicit handle versions;
- rejection of unknown fields;
- required, well-formed payload fields;
- known and visible referenced entities;
- obvious handle-specific relationships such as distinct target and alternate
  words, prompt targets belonging to the resulting contrast cluster, and
  references matching the supplied evidence snapshot; and
- atomicity and idempotency expectations for supported apply adapters.

Apply-time adapters must additionally revalidate current domain state. These
hard boundaries must not be delegated to the model prompt because they protect
durable state and effect attribution.

Prompt iteration, evaluation, and user review may own semantic qualities that
local code cannot reliably prove, such as whether an intervention is genuinely
useful, generated language is natural, two drafted operations are meaningfully
redundant, or free text rhetorically contradicts the structured operation.
Steel-thread dogfooding should expose those failures and drive prompt,
validator, lint, and review-UI improvements without requiring V0 to pretend
that every semantic judgment is deterministically enforceable.

The durable production-cue model is explicitly not settled by V0. The current
bundle can preserve the cue text and other presentation details exactly as
shown for evidence and provenance, but a nullable or captured cue reference
must not be mistaken for an accepted long-term cue identity scheme.
`repair_production_cue` may remain a typed, reviewable draft operation with a
clear purpose and explicit non-effects, while its apply adapter remains
unsupported until the cue model receives its own post-steel-thread design.

Handle versioning protects that deferral. A later cue design must not silently
reinterpret an accepted V0 payload. If the eventual model cannot implement the
exact accepted operation faithfully, that handle version remains unsupported
or reaches an honest non-applied outcome; a revised operation or newer handle
version requires its own authorization.

### Bad-production-prompt stopgap versus durable cue operations

Status: Ready for synthesis

The existing `bad production prompt` behavior is not an apply adapter for the
draft `flag_bad_production_cue` operation. Today the app records word-scoped
feedback against the synthetic `definition_based_production` target and excludes
that word's production action from scheduling while the feedback remains open.
It does not identify or flag an independently durable cue. The similarity in
names previously made this look like a harmless generalization, but the two
contracts are not compatible.

The existing behavior has a useful but deliberately temporary product purpose:
stop presenting a definition-based production exercise that is likely to make
the learner spend time overfitting to an unsuitable definition prompt. Its
intake visibility also leaves a practical backlog of words to revisit, but that
backlog has intentionally been deferred until there is a desirable cue model
and a clear content target to optimize toward. It must not accidentally become
the foundation of that future model.

This remains semantically distinct from `suppress_definition_production`.
Suppression says definition-based production is not a worthwhile training goal
for the word even if a good prompt could be written; surnames are the obvious
example. Bad-prompt deferral says recall may still be valuable, but the current
set of glosses produces a low-value exercise. The two states may currently have
the same scheduling consequence, but they carry different product judgments,
reversibility expectations, and backlog meaning.

`bad_production_prompt` is legacy compatibility state, not a reflection handle,
and V0 should not add a narrowly renamed operation merely to expose it through
the registry. The canonical registry also must not retain
`flag_bad_production_cue: existing_adapter` as currently written: the legacy
mutation cannot implement that newer generalized contract. Whether a durable
cue-level flag is useful at all belongs to the later cue-model design; it must
not be inferred from the existence of the legacy state.

Continued reliance on this manual bad-prompt path is explicit product debt. It
is a tolerated user-operated escape hatch for avoiding low-value exercises
until reflection offers more productive handles and the product has a cue model
worth repairing content toward. Its temporary usefulness does not make it part
of the V0 registry or a pattern that new reflection behavior should reproduce.

After the cue model is designed, a cue-repair family may supersede the stopgap.
Repair need not always mean supplying replacement text: deleting a cue or
disassociating it from a target word may be the correct repair. The exact
operation shapes and any migration or reconciliation of existing bad-prompt
feedback belong to that later design. Existing feedback may serve as evidence
or a review queue, but must not be automatically reinterpreted as a precise
command against future cue entities.

### Top-level reflection summary

Status: Ready for synthesis

Remove the top-level `summary` field from the V0 reflection result contract.
It began as a plausible default presentation surface, but the provider spike
did not establish a clear product job, review action, or persistence need for
it. Item-level observations, explanations, questions, unhandled needs, and
proposals already carry the actionable reflection output.

V0 should not ask the model to generate text merely because it might be useful
somewhere. If dogfooding reveals a concrete cross-item synthesis need, the
summary can return later with a defined consumer and semantics rather than
constraining the steel thread now.

### User editing and provenance

Status: Ready for synthesis

The full-prototype direction uses a typed manual handle workbench as its clean
substrate: the user selects an operation kind and edits its structured fields,
such as target word or target unit, related content, and any handle-specific
disambiguators. Reflection is a convenience path into that same model. A
reflection proposal supplies a prefilled structured operation; accepting or
editing it ultimately produces the same kind of exact authorized invocation as
authoring an operation manually. Both paths must converge on the same domain
validation and apply adapter.

This convergence should not become a universal schema-generated form. Each
operation kind may need a purpose-built editor, especially for compound
operations such as contrast-content upserts. The shared contract is the typed,
versioned operation envelope and the validated command beneath the UI, not a
requirement that JSON Schema alone determine the interaction. The backend
remains authoritative: manual entry and proposal editing cannot bypass
cross-field validation, current-state checks, or application invariants.

The generated reflection artifact and its original proposal remain immutable.
Editing a proposal does not rewrite what the model proposed. On authorization,
the system persists an immutable invocation containing the exact operation the
user approved and links the proposal review to that invocation. Capturing every
intermediate form edit or keystroke is unnecessary for V0; the durable causal
record needs the original proposal and the final authorized operation.

The proposal should remain the center of the reflection-review model even
though application is technically a property of an invocation. The accepted
variant of the proposal-review discriminated union therefore carries both the
acceptance mode and the authorized invocation identity:

```ts
type ProposalReview =
  | { disposition: 'pending' }
  | { disposition: 'deferred' }
  | {
      disposition: 'accepted';
      acceptanceMode: 'exact' | 'revised';
      acceptedInvocationId: string;
    }
  | { disposition: 'dismissed' }
  | {
      disposition: 'superseded';
      supersession: ProposalSupersession;
    };
```

Acceptance modes are deliberately factual rather than qualitative:

- `exact` means the user authorized the proposed versioned operation and
  payload unchanged.
- `revised` means the user retained the same operation kind but authorized an
  edited payload.

For V0, every same-kind payload edit counts as `revised`, regardless of its
extent. A “minor” versus “major” distinction would be subjective, would create
an unstable policy boundary, and is not needed to preserve provenance. If
empirical use later shows that distinction to be useful, it can be derived or
classified from the original and authorized payloads without changing their
identity.

Changing the operation kind is not a revision of the proposal. It creates a
user-authored replacement invocation and leaves the original proposal
`superseded`, linked to that invocation. A proposal displaced by another
proposal is likewise superseded but should retain a distinct reason and link to
the competing proposal or resulting invocation. Supersession metadata should
be able to distinguish at least a competing proposal, a user-authored
replacement, and relevant external state. A fully manual operation unrelated
to reflection has an invocation without a fabricated proposal.

Application state and effect references belong to the authorized invocation.
For reflection-originated work, the proposal review's invocation link allows
the UI and analytics to present the complete proposal-centered story: what the
model proposed, whether the user accepted it exactly or revised it, what exact
operation was authorized, and what application outcome followed. For a
different-kind replacement, the supersession link preserves the corresponding
causal path without falsely recording acceptance of the original operation.

The full manual workbench is a dogfood or administrative surface, not a required
steel-thread deliverable. The steel thread needs only the proposal-review and
operation-specific editing surfaces required by its selected slice; from-scratch
manual invocation of every registry operation may remain deferred. Neither
horizon commits the eventual ordinary learner UI to exposing a general handle
console. A learner-facing flow may remain compact: accept the proposal
unchanged, or choose edit and expand into the relevant structured editor.
Dogfood experience can determine which operation-specific controls later
deserve a more tailored learner-facing presentation. Editor availability and
apply-adapter support must remain distinguishable so an editor does not imply
that an unsupported operation can already take effect.

There is no separate generic reversal mechanism in this model. If the user
later wants to change a past management decision, they make another forward
edit or operation against current state. The original proposal, authorization,
application result, and effect attribution remain historical facts rather than
being mutated or erased. Any handle-specific operation needed to change current
state must still pass ordinary validation and establish its own provenance.

### Contrast extension and other unvalidated cases

Status: Deferred

The provider spike did not exercise `extend_cluster`, duplicate or already
existing contrast content, stale references, externally satisfied operations,
or history-informed decisions. None currently indicates a registry redesign or
blocks the steel thread. They should remain visibly unvalidated and be handled
through targeted prompt, validation, reconciliation, and UI iteration as real
cases appear.

For the first cut, reflection should propose only new contrast clusters rather
than choosing an existing cluster to extend. A plausible later application
layer can compare the proposed cluster with current clusters, surface likely
overlap, and offer an explicit user-confirmed merge or extension action. It
must not silently redirect the accepted operation merely because overlap was
detected.

That reconciliation surface may reasonably be operation-specific rather than a
pure generic workbench. When extending an existing cluster, the selected
cluster's top-level information can remain mostly frozen while the proposed
extension fields—members, notes, and prompts—are presented for review and
editing. The exact replacement/revision semantics and duplicate-content rules
should be designed when this path is implemented; they are not part of the
steel thread.

The other cases already fit the established boundaries at a high level:
apply-time adapters revalidate current references, and duplicate or externally
satisfied effects must produce truthful non-attribution outcomes. Their exact
handle-specific equivalence rules can be learned incrementally. Learner
history, meanwhile, is evidence-bundle context supplied to reflection rather
than a concern of the handle registry itself.

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
- label full-prototype contract direction separately from the behavior and
  surfaces required by the initial reflection steel thread;
- update the canonical type contract, handle inventory and entries, lifecycle,
  provenance rules, and invocation compatibility matrix together;
- reconcile the provider spike's copied contract with the canonical contract;
- classify remaining questions as safe implementation detail, explicit V0
  deferral, or a blocker requiring human judgment;
- verify that validation and persistence can be implemented without inventing
  handle-related product policy; and
- retire this note after its durable conclusions have graduated into
  `SPECS/reflection-handle-registry-v0.md`.
