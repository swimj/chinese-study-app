# Reflection Proposals And Handles

Status: accepted canonical product contract. The core V1 proposal, review,
authorization, application, and provenance lifecycle is implemented.
`repair_production_cue@1` and `accept_production_alternate@1` remain
intentionally unsupported. The V2 production-cue repair behavior is accepted
and implemented for the current build wave.

This specification defines how learner-facing reflection describes bounded
changes, how a user reviews or revises those proposals, and how an authorized
operation is applied with truthful provenance. It is intentionally independent
of one milestone: later implementations should extend this contract through
explicit operation and result-schema versions rather than replace its lifecycle
or identity model.

Related documents:

- [`SPECS/study-action-model.md`](./study-action-model.md)
- [`SPECS/session-covering-criteria.md`](./session-covering-criteria.md)
- [`SPECS/session-reflection-generation.md`](./session-reflection-generation.md)
- [`notes/active/2026-07-10-session-evidence-bundle-design.md`](../notes/active/2026-07-10-session-evidence-bundle-design.md)
- [`notes/active/2026-07-20-llm-provider-spike-summary.md`](../notes/active/2026-07-20-llm-provider-spike-summary.md)
- [`PLANS/hosted-beta-tenancy-table-map.md`](../PLANS/hosted-beta-tenancy-table-map.md)

## 1. Scope And Authority

This specification owns:

- the boundary among reflection results, proposals, authorized invocations, and
  applied effects;
- proposal-level review disposition and operation-level application status;
- immutable artifact and mutable lifecycle responsibilities;
- operation identity, versioning, validation, idempotency, and effect
  attribution;
- user revisions, user-authored operations, and supersession semantics;
- the shared domain-command boundary beneath reflection and manual editing;
- the currently defined reflection operation contracts; and
- the accepted V0 production-task, cue-repair, and cue-evidence boundary.

It does not choose:

- database tables or HTTP routes for a particular implementation milestone;
- the exact reflection trigger or evidence-generation boundary, which are owned
  by [`session-reflection-generation.md`](./session-reflection-generation.md),
  or a provider prompt or review-page layout;
- a universal schema-generated workbench;
- a final multi-sense production-task ontology or general answer-class model;
- general word-priority or scheduling-policy operations;
- automatic authority for model output; or
- a universal command framework for the application.

The reflection model has proposal-only authority. No model result changes study
or content state without an explicit user authorization and successful
application through a registered adapter.

## 2. Conceptual Model

The model deliberately separates facts that were previously compressed into a
single proposal lifecycle:

```text
bounded evidence
  -> immutable reflection artifact
       -> immutable item result
            -> immutable proposal
                 -> mutable proposal review
                      -> immutable authorized invocation
                           -> mutable application status
                                -> attributable domain effects
```

### Reflection artifact

A reflection artifact is a generate-once provenance record. It preserves:

- the bounded evidence supplied to reflection;
- model, prompt, input-schema, and result-schema versions;
- the validated result;
- every original item result and proposal exactly as generated; and
- generation time and source-session identity where available.

User review, edited operations, application status, and effects do not mutate
the artifact body.

### Item result

An item result is the model's analysis of one evidence item. The current result
contains diagnosis tags, one required learner-facing explanation, optional
questions, and zero or more proposals. Older immutable result versions may
also contain the retired observation and unhandled-need fields.

An item result does not own proposal disposition. Several proposals under one
item may be reviewed independently, and an informative item with no proposal
has no synthetic operation lifecycle.

### Handle operation

A handle operation is one typed, versioned, bounded change that can be
authorized and, when an adapter exists, applied atomically. “Handle” names the
registered product capability; “operation” names one exact payload for that
capability.

A question, recommendation, `no_change` judgment, or missing capability is not
a handle. No change is represented by an empty proposal list. The current
result does not ask the model to inventory missing capabilities: dogfood did
not establish a reliable authoring behavior or useful consumer for that field.
The model must not squeeze a missing capability into the nearest registered
operation.

### Proposal

A proposal wraps one operation with the model's rationale and presentation
grouping. It is immutable and receives a durable identity when its artifact is
materialized.

One proposal contains one atomic operation. A compound recommendation such as
“repair the production cue and add contrast practice” produces two proposals.
They may share a presentation group, but they remain independently reviewable.

### Review, invocation, and application

Proposal review records whether the proposal remains open, was accepted, was
rejected, or became superfluous. Acceptance points to an immutable invocation
containing the exact operation the user authorized.

The invocation is the application and idempotency boundary. Its application
status records whether that authorized operation is unsupported, pending,
applied, failed, stale, already satisfied, or withdrawn.

A fully user-authored operation has an invocation and application status
without a fabricated reflection proposal.

## 3. Reflection Result Contract

The result contract includes only fields with an identified reflection,
review, or validation purpose. It deliberately has no top-level `summary`: the
provider spike did not establish a concrete consumer for one, while item-level
output already carries the actionable content.

```ts
type SessionReflectionResultV6 = {
  schemaVersion: 'session_reflection_result.v6';
  itemResults: ReflectionItemResultV2[];
};

type ReflectionItemResultV2 = {
  itemId: string;
  diagnosisTags: ReflectionDiagnosisTagV1[];
  learnerExplanation: string;
  proposals: ReflectionProposalV1[];
  questions: ReflectionClarifyingQuestionV1[];
};

type ReflectionProposalV1 = {
  proposalGroupKey: string | null;
  rationale: string;
  operation: ReflectionOperation;
};

type ReflectionClarifyingQuestionV1 = {
  question: string;
  reason: string;
};

```

V4 and V5 results remain readable under their frozen contracts. V6 removes
`observation` because dogfood established the learner explanation as the useful
item-level text surface, and removes `unhandledNeeds` because the current model
and product do not use them reliably. New generation uses V6; stored V4/V5
artifacts remain immutable.

The current diagnosis vocabulary is:

```ts
type ReflectionDiagnosisTagV1 =
  | 'valid_or_near_valid_alternate'
  | 'cue_overlap_hides_usage_difference'
  | 'production_cue_overloaded'
  | 'form_or_sound_interference'
  | 'grammar_or_usage_role_interference'
  | 'ordinary_retrieval_noise'
  | 'persistent_confusion'
  | 'insufficient_evidence';
```

Diagnosis tags classify analysis; they do not authorize effects or select
application behavior. `insufficient_evidence` is the model's item-level
uncertainty marker and may coexist with tags for the interpretations that
remain plausible. Use it when the model lacks enough evidence to stand
confidently behind a material part of its diagnosis or recommendation. Learner
uncertainty is a separate observed fact and belongs in the evidence or learner
explanation instead.

Questions are conversational output. They do not enter the operation registry
or acquire proposal/application states. A later resumable conversation design
may add a separate lifecycle for questions without pretending they are durable
mutations.

The model does not generate durable identifiers. `itemId` echoes the
backend-supplied evidence-item id so results can be correlated and validated.
`proposalGroupKey`, when present, is only a model-emitted label for grouping
proposals within one item; it is not durable identity. Materialization assigns
durable artifact and proposal ids. Questions have no separate identity in this
schema because they have no independent lifecycle.

Provider output uses a strict schema:

- unknown fields, operation kinds, and operation versions are rejected;
- every input item appears exactly once and no unknown item is introduced;
- a non-null proposal group key is scoped to its containing item; and
- all strings and collections satisfy their operation-independent structural
  constraints.

## 4. Operation Identity And Registry

The operation kind and version travel with the operation itself so proposal,
edited, and fully manual paths cannot lose the version boundary:

```ts
type ReflectionOperation =
  | SuppressDefinitionProductionOperationV1
  | CreateContrastClusterOperationV1
  | RepairProductionCueOperationV1
  | RepairProductionCueOperationV2
  | AcceptProductionAlternateOperationV1;
```

Every registered `(kind, version)` entry defines:

- purpose and intended learner outcome;
- exact payload and field semantics;
- structural and cross-field validation;
- evidence-time reference rules;
- apply-time preconditions;
- atomic durable effect;
- explicit non-effects;
- idempotency and already-satisfied test;
- effect-reference requirements;
- editor availability separately from apply-adapter availability; and
- whether an adapter can implement that exact version faithfully.

Adapter availability is version-specific runtime capability, not part of model
authority. A valid operation may be proposed and accepted while its adapter is
unsupported.

Registering an adapter later must not reinterpret stored payloads. If a later
product model cannot faithfully implement an older accepted operation, that
version remains unsupported. A revised operation version requires fresh user
authorization.

## 5. Current Operation Contracts

These are the currently defined operations. A milestone may expose only a
subset, and adapter availability is declared by the milestone or
implementation—not inferred from this list.

### `suppress_definition_production` version 1

```ts
type SuppressDefinitionProductionOperationV1 = {
  kind: 'suppress_definition_production';
  version: 1;
  wordId: string;
};
```

Purpose: stop scheduling definition-cued production for a word because that
training goal is not worthwhile for the learner even if a good prompt could be
written. Recognition and contextual-selection practice remain unchanged.
Surnames are the clearest motivating example.

Validation and application:

- `wordId` must resolve to a known, visible word in the evidence available to
  the proposal;
- apply-time validation must resolve the word in current state;
- the atomic effect sets definition-production relevance to suppressed;
- an already-suppressed word produces `already_satisfied`, not a duplicate
  attributed effect; and
- the effect reference identifies the resulting relevance record or equivalent
  domain state.

Non-effects:

- it does not say the current prompt is defective;
- it does not alter recognition, contextual selection, word priority, or
  general word lifecycle;
- it does not create contrast content; and
- it does not delete meanings or production evidence.

### `create_contrast_cluster` versions 1 and 2

```ts
type CreateContrastClusterOperationV1 = {
  kind: 'create_contrast_cluster';
  version: 1;
  title: string;
  clusterNote: string | null;
  members: Array<{
    wordId: string;
    nuanceNote: string | null;
  }>;
  prompts: Array<{
    targetWordId: string;
    promptText: string;
    explanation: string | null;
  }>;
};

type CreateContrastClusterOperationV2 = Omit<
  CreateContrastClusterOperationV1,
  'version'
> & {
  version: 2;
};
```

Purpose: create a concrete contrast-learning unit, including enough drafted
content to make the distinction trainable rather than merely placing it in an
intake backlog.

Validation shared by both versions:

- `title` and all prompt text are non-empty after trimming;
- the operation contains at least two distinct members;
- member word ids are unique, known, visible, and supported by the supplied
  evidence context;
- every prompt target is one of the operation's members;
- duplicate prompts within the payload are rejected; and
- nullable notes and explanations remain editable generated content, not
  application instructions hidden in prose.

Version 1 retains its original at-least-one-prompt rule for stored-payload and
authorized-invocation compatibility. Version 2 requires at least two prompts
targeting every member. New generation emits version 2; both versions share the
same application behavior.

Application creates the cluster, members, annotations, and prompts atomically.
It also enforces the contrast-membership policy for every member by ensuring
`contextual_selection` relevance `normal` and enabled, initialized scheduler
state. Effect references identify every created content entity and only the
eligibility records actually changed by this invocation. A deterministic exact
match to an already-existing complete content-and-eligibility postcondition may
produce `already_satisfied`; approximate thematic overlap is not sufficient.

Non-effects:

- it does not extend, merge, overwrite, or delete an existing cluster;
- it does not revise or delete existing prompts;
- it does not automatically resolve unrelated intake rows;
- it does not change recognition or production scheduling, production grading,
  word admission, or lifecycle state; and
- it does not imply a finite contrast-practice burst.

Cluster extension is deliberately a later operation. A future reconciliation
surface may detect overlap and offer a user-authored extension or merge, but it
must not silently redirect an accepted create operation.

### `repair_production_cue` version 1

```ts
type RepairProductionCueOperationV1 = {
  kind: 'repair_production_cue';
  version: 1;
  wordId: string;
  proposedCues: Array<{
    cueType:
      | 'definition_gloss'
      | 'cloze'
      | 'minimal_context'
      | 'register_or_domain_hint';
    text: string;
  }>;
  repairIntent:
    | 'narrow_to_learner_relevant_sense'
    | 'add_distinguishing_anchor'
    | 'add_contextual_triangulation'
    | 'split_overloaded_cue';
};
```

The V1 enum remains unchanged for stored-payload compatibility. Its `cloze`
and `register_or_domain_hint` values do not define the V0 cue taxonomy used by
V2; cloze-shaped prompts are `minimal_context` in V0, while register and domain
details belong in cue text.

Purpose: preserve a concrete, reviewable draft of a fairer production cue when
the current gloss-derived exercise is a poor test of the desired recall.

The proposal's source item and cue-as-shown snapshot provide evidence and
provenance. They are not embedded as a purported durable cue identity in the
operation. Proposed cue text must be non-empty, the collection must be
non-empty, and the target word must be known and visible.

This version does not settle the durable production-cue model. An adapter may
exist only if later product design can implement the exact accepted operation
without silently editing broad lexical meanings or inventing cue identity. If
that proves impossible, version 1 remains a useful accepted draft and stays
unsupported.

Non-effects:

- it does not mutate word meanings or meaning visibility;
- it does not deactivate the current definition-production exercise;
- it does not apply a cue stack that does not yet exist;
- it does not establish accepted answers; and
- it cannot express cue deletion or target disassociation.

Deletion, disassociation, or another repair form remains outside this operation
until the cue model can define its target and semantics.

### `repair_production_cue` version 2

The V2 contract applies learner-authorized changes to the accepted V0
production-task and cue model. Its exact semantic shape is:

```ts
type ProductionCueTypeV0 =
  | 'definition_gloss'
  | 'minimal_context'
  | 'circumstance';

type ProductionCueDraftV2 = {
  cueType: ProductionCueTypeV0;
  text: string;
  acceptedWordIds: string[];
};

type ProductionCueChangeV2 =
  | { kind: 'create'; cue: ProductionCueDraftV2 }
  | {
      kind: 'replace';
      cueId: string;
      replacements: ProductionCueDraftV2[];
    }
  | { kind: 'deactivate'; cueId: string };

type CueEvidenceJudgmentV2 =
  | {
      kind: 'accepted_answer_space_omission';
      sourceAttemptId: string;
      submittedWordId: string;
    }
  | {
      kind: 'misleading_or_overloaded_cue';
      sourceAttemptId: string;
    };

type RepairProductionCueOperationV2 = {
  kind: 'repair_production_cue';
  version: 2;
  wordId: string;
  taskId: string;
  changes: ProductionCueChangeV2[];
  sourceAttemptJudgments: CueEvidenceJudgmentV2[];
};

type ProductionCueEffectRef =
  | { type: 'production_cue'; id: string }
  | { type: 'production_cue_lifecycle_event'; id: string }
  | { type: 'production_cue_evidence_judgment'; id: string };
```

The strict model-facing wire form omits the fixed `version` field, the V0
default-production `taskId`, and each judgment's `sourceAttemptId` from
`RepairProductionCueOperationV2`. After strict schema validation, the provider
boundary stamps `version: 2`, derives the task id from the model-authored
`wordId`, and derives each judgment's canonical source attempt id from the
matching backend-owned evidence item. Legacy model-supplied attempt ids are
ignored; they never select provenance or application targets.
Both arrays remain required on the wire, including when
`sourceAttemptJudgments` is empty.

The behavioral contract is:

- `taskId` identifies the word's `default_production` task in V0;
- one invocation may explicitly create, replace (including one-to-many split),
  or deactivate cue identities atomically;
- a cue draft uses one V0 cue type (`definition_gloss`, `minimal_context`, or
  `circumstance`), non-empty stimulus text, and an accepted set of known visible
  word ids that includes `wordId`; the answer space is always explicit and may
  not contain duplicates; register and domain details are expressed in the cue
  text rather than as a separate type;
- new or edited cue content always receives a new cue id; replacement
  deactivates only the named cue, and unrelated cues retain their identity and
  activation state;
- deactivation is terminal logical deletion: the immutable cue and its
  lifecycle remain durable historical facts, but the cue cannot be reactivated;
  a later cue with the same or similar content is an ordinary new create with a
  new attributable cue id and no lifecycle continuity with the deleted cue;
- a source-attempt judgment, when the required array is non-empty, appends a later learner-authorized
  assessment to cue evidence; it never edits the source attempt; and
- deactivating all durable cues re-exposes the meaning-derived fallback subject
  to its existing production-suppression state.

Validation requires at least one change, allows a cue id in at most one change,
requires at least one replacement for `replace`, and resolves the word, task,
referenced cues, accepted words, and any source attempt against current state.
Every referenced cue must belong to the named task. An accepted-answer-space
judgment must identify the durable submitted word and admit it in the new answer
space. For a durable served cue, that judgment must replace the exact cue; for
the meaning-derived fallback, it may create the first durable cue. A misleading
or overloaded judgment must likewise repair the exact served cue or create a
durable cue for fallback evidence.

Application activates every created or replacement cue immediately and records
created cues, lifecycle events, and later cue-evidence judgments through the
three exact effect-reference variants above. Reapplying an
invocation whose exact postcondition is already present produces
`already_satisfied`. Applying V2 never mutates lexical meanings, changes
meaning visibility, rewrites historical attempts, retroactively changes word
scheduling state, or destructively deletes cues.

The provider evidence for a V2 repair contains the target word and the singular
cue snapshot served by the source attempt. The V0 default-production task id is
derived at the trusted provider boundary. Other active or inactive task cues
are not supplied to generation and do not expand the model's allowed cue or
accepted-word references. A fallback may support creation; a durable served cue
may support replacement or terminal deactivation of that exact cue.

New reflection generation emits V2 directly. V1 remains readable and
unsupported; any later V1-to-V2 migration uses a newly authorized V2 invocation
and supersession rather than reinterpreting the stored V1 payload.

### `accept_production_alternate` version 1

```ts
type AcceptProductionAlternateOperationV1 = {
  kind: 'accept_production_alternate';
  version: 1;
  targetWordId: string;
  alternateWordId: string;
};
```

Purpose: authorize a directional future-grading rule under the current coarse
definition-production model. When production targets `targetWordId`, producing
`alternateWordId` should count as communicative success.

Validation requires two distinct, known, visible words. The source cue and
attempt remain proposal evidence; the durable operation is not scoped to an
ephemeral cue snapshot.

The operation is directional. Accepting B when A is targeted does not accept A
when B is targeted and does not create a global synonym relation. It is
stronger than retrospective credit for one reasonable answer to an ambiguous
cue. Cue-specific reasonableness alone is not sufficient evidence for this
operation.

Application must remain unsupported until grading can:

- recognize the alternate as communicative success;
- avoid claiming that the nominal target word was retrieved; and
- attribute the resulting evidence truthfully.

An exact pre-existing directional rule produces `already_satisfied`. The
operation does not create contrast content, repair a cue, or adjudicate the
historical attempt that motivated reflection.

## 6. Proposal Review Lifecycle

Review disposition is proposal-level:

```ts
type ProposalReviewStatus = {
  proposalId: string;
  updatedAt: string;
  disposition:
    | { kind: 'pending' }
    | { kind: 'deferred' }
    | {
        kind: 'accepted';
        acceptanceMode: 'exact' | 'revised';
        acceptedInvocationId: string;
      }
    | {
        kind: 'dismissed';
        reason: string | null;
      }
    | {
        kind: 'superseded';
        supersession: ProposalSupersession;
      };
};

type ProposalSupersession = {
  source: 'competing_proposal' | 'user_replacement' | 'external_state';
  actor: 'user' | 'system';
  reason: string;
  replacementProposalId: string | null;
  replacementInvocationId: string | null;
  satisfyingEffectRefs: EffectRef[];
};
```

Allowed transitions:

```text
pending  -> deferred | accepted | dismissed | superseded
deferred -> accepted | dismissed | superseded
```

`pending` and `deferred` are unresolved. Their distinction records whether the
user has already considered the proposal and supports different queue
presentation.

`accepted`, `dismissed`, and `superseded` are terminal historical dispositions:

- `accepted` means the user authorized the exact operation stored in the linked
  invocation. It does not mean an effect occurred.
- `dismissed` is the coarse judgment that the diagnosis, intervention, drafted
  content, or learner fit was inadequate.
- `superseded` means another proposal, user-authored replacement, or external
  state made this proposal superfluous. It must retain the satisfying source.

Application outcomes never rewrite an accepted proposal's historical
disposition. Conversely, an unaccepted proposal made unnecessary during review
is superseded rather than given an application result.

An item-level read, archive, or presentation state may be added later if the UI
needs one. It must not substitute for proposal review or be described as
proposal disposition.

## 7. Authorized Invocations

Authorization creates an immutable invocation:

```ts
type OperationInvocation = {
  invocationId: string;
  createdAt: string;
  origin:
    | { kind: 'proposal_acceptance'; proposalId: string }
    | { kind: 'user_replacement'; supersededProposalId: string }
    | { kind: 'manual' };
  operation: ReflectionOperation;
};
```

The exact validated operation is stored in the invocation rather than recovered
later from mutable UI state.

Acceptance modes are factual:

- `exact`: the authorized operation is structurally equal to the original
  versioned proposal operation.
- `revised`: the user retained the same operation kind and version but edited
  one or more payload fields.

There is no subjective minor/major edit boundary. The immutable artifact keeps
the original; the invocation keeps the final authorized operation.

Changing operation kind or version is not a revision. It creates a
user-authored replacement invocation and supersedes the original proposal with
a link to that invocation. A manual operation unrelated to reflection has no
proposal or proposal-review row.

The full manual workbench and reflection editing use the same operation
registry, validators, editors, invocation writer, and apply adapters. This does
not require a universal generated form. Each operation may have a
purpose-built editor, and a learner-facing review surface may expose only a
small subset of the full workbench.

Neither manual entry nor proposal editing can bypass backend validation or
current-state preconditions.

## 8. Application Lifecycle

Every authorized invocation immediately receives one application status:

```ts
type EffectRef = {
  type: string;
  id: string;
};

type OperationApplicationStatus = {
  invocationId: string;
  updatedAt: string;
  state:
    | {
        kind: 'unsupported';
        reason: string;
      }
    | {
        kind: 'pending';
      }
    | {
        kind: 'applied';
        appliedAt: string;
        effectRefs: EffectRef[];
      }
    | {
        kind: 'failed';
        error: string;
      }
    | {
        kind: 'stale';
        reason: string;
      }
    | {
        kind: 'already_satisfied';
        satisfyingEffectRefs: EffectRef[];
      }
    | {
        kind: 'authorization_withdrawn';
      };
};
```

There is no persisted `not_requested` state. An unaccepted proposal has no
invocation or application status.

Transitions:

```text
authorized + supported   -> pending
authorized + unsupported -> unsupported

pending     -> applied | failed | stale | already_satisfied
             | authorization_withdrawn
unsupported -> pending | authorization_withdrawn
```

Semantics:

- `unsupported` means the operation is valid but no faithful adapter exists for
  that exact kind and version. It is not failure.
- `pending` means an adapter exists and application is queued or in progress.
  It is not a second review step.
- `applied` means the authorized postcondition committed and the listed effects
  were caused by this invocation.
- `failed` means no intended effect committed because of application or
  infrastructure error. It is terminal under the current contract and has no
  automatic retry.
- `stale` means current-state preconditions no longer allow the exact operation
  to be applied safely.
- `already_satisfied` means current state deterministically proves the intended
  postcondition was achieved elsewhere. The satisfying effects are referenced
  but not attributed to this invocation.
- `authorization_withdrawn` is the terminal escape hatch when the user revokes
  standing authorization before an effect occurs.

Accepting an unsupported operation grants standing authorization for that exact
version. If a faithful adapter later becomes available, the application may
move from `unsupported` to `pending` after current-state revalidation. The
product must let the user withdraw authorization before any effect.

Adapter-discovery and re-enqueueing policy may be milestone-specific. Whatever
the mechanism, it cannot apply a newer or merely similar operation version
under old authorization.

`stale` and `superseded` operate at different boundaries. Supersession closes an
unaccepted proposal. Staleness terminates application of an already-authorized
invocation.

An invocation state is not itself study content. Session composition or another
domain consumer may use content caused by an invocation only after a truthful
`applied` effect exists, or when an `already_satisfied` result points to the
independently existing domain effect. Mere acceptance, `unsupported`, `pending`,
`failed`, `stale`, or withdrawn authorization creates no selectable content.

## 9. Validation, Idempotency, And Attribution

Validation happens at three boundaries.

### Model-result validation

Before artifact materialization:

- validate known input and result schema versions;
- reject unknown properties and union variants;
- validate one result per supplied item;
- enforce key uniqueness;
- ensure every operation reference is available in the corresponding evidence
  item and resolves to a known, visible entity; and
- enforce structural and deterministic cross-field rules.

The prompt cannot own these hard boundaries because model output is untrusted
input.

### Authorization validation

Before creating an invocation:

- validate the edited or unchanged operation against its registered version;
- verify the current user may reference every entity;
- classify the operation as exact or revised;
- reject a purported revision that changes kind or version; and
- verify the proposal is still in an authorizable review state.

### Apply-time validation

Immediately before mutation:

- reload current domain state;
- enforce adapter-specific preconditions;
- distinguish exact satisfaction from approximate semantic overlap;
- apply all effects atomically; and
- record effects or a truthful non-effect outcome.

Prompt iteration, evaluation, and user review own semantic qualities that local
code cannot reliably prove: pedagogical usefulness, natural language quality,
meaningful redundancy, and whether free prose rhetorically contradicts a
structured operation. Dogfooding should improve prompts, lint, validators, and
editors without pretending every semantic judgment is deterministic.

Application is idempotent by invocation id. After application reaches a
terminal state, later calls for the same invocation return its recorded result
and never duplicate effects. Idempotency by proposal id is insufficient because
manual and replacement invocations may have no accepted proposal.

`already_satisfied` requires a deterministic domain postcondition. Similar
content, overlapping cluster membership, or a rhetorically related manual
change is not enough to claim satisfaction or borrow its effect attribution.

## 10. Generated Content And Review Quality

Generated content inside an operation remains editable before authorization.
For contrast creation this includes title, cluster note, member nuance notes,
prompt targets, prompt text, and explanations. For V2 cue repair it includes
the cue lifecycle changes, draft cue types and text, accepted-word sets, and
optional source-attempt judgments.

Editing generated content does not rewrite the artifact. Accepting an edited
payload creates a revised invocation. The review system may assess diagnosis,
intervention selection, and drafted-content quality separately even when V1
stores only a coarse terminal `dismissed` disposition plus optional rationale.

The operation editor must not imply apply support. A user may inspect, edit, and
accept a well-formed unsupported operation; the resulting application state
remains visibly unsupported.

## 11. Production-Cue Boundary

The accepted V0 boundary is defined in the production section of
[`study-action-model.md`](./study-action-model.md) and the accepted design memo
[`PLANS/swi-24-production-task-cue-contract.md`](../PLANS/swi-24-production-task-cue-contract.md).
It separates word-based scheduling demand, one default production task per
word, immutable multi-active cue content, cue-scoped accepted-word sets, exact
served snapshots, and append-oriented cue evidence with a non-scheduling
shadow projection.

This is a bounded implementation model, not a final ontology. Sense-specific
tasks, free-form accepted expressions, destructive cue deletion, general
alternate-answer grading, and cue-aware scheduling remain outside V0. Meaning
rows remain base fallback content and must not be reinterpreted as cue rows.
Legacy bad-definition-production feedback and suppression continue to govern
that fallback rather than becoming a generalized cue flag.

Reflection generation for new cue repairs uses V2. When it cannot express a
faithful V2 cue change, it emits no operation. The exact nested V2 wire schema
remains a human-gated orientation decision, but the product behavior it must
represent is settled.

## 12. Manual And Legacy Invocation Compatibility

Handles are not the only way durable operations can originate. New reflection
and manual-workbench paths should converge on the same validators, domain
commands, and apply adapters, while legacy paths may remain parallel until
there is a concrete reason to migrate them.

| Existing path | Registry relationship | Direction |
| --- | --- | --- |
| In-session `suppress_skill` for production | Same durable intent as `suppress_definition_production` when the sampled skill is production | Converge on the same production-suppression domain command; retain session-event provenance |
| Out-of-session production suppression | Same effect as `suppress_definition_production` | Converge on the same domain command; reflection application adds invocation/effect provenance |
| `add_contrast_candidate` | No equivalent operation; it created unresolved intake rather than trainable content | Retired live path; legacy `contrast_candidate_intake` storage may remain readable |
| `suppress_skill_and_add_contrast_candidate` | Former compound convenience over two different concerns | Retired with intake capture; reflection keeps independent proposals and does not gain a compound handle |
| In-session or out-of-session bad production prompt reporting | No registered reflection operation | Remain legacy compatibility behavior; do not treat it as a cue adapter |
| Manual contrast cluster/member/prompt CRUD HTTP | Adjacent primitives for `create_contrast_cluster` | Retired management UI/API; persistence primitives and reflection’s atomic adapter remain |
| Contrast intake “create cluster” | Closest former atomic composition, but its intake-resolution semantics are not part of the handle | Retired with intake triage; do not fabricate intake provenance on the reflection handle |
| Reflection proposal application | Canonical proposal-originated invocation path | Validate, authorize, apply by invocation id, and record exact effects |
| Fully manual workbench | Canonical user-originated invocation path | Use the same operation registry without fabricating a proposal |

Legacy paths that perform equivalent work may satisfy a pending invocation, but
the application must record `already_satisfied` and must not claim that the
invocation caused the legacy effect.

Existing paths do not all need to be rewritten before the first reflection
milestone. They must not create states that the apply adapter cannot validate or
reconcile truthfully.

## 13. Reversal And Content Ownership

There is no generic reversal state or history rewrite. A later change is a new
forward operation against current state. The original proposal, authorization,
application result, and effects remain historical facts.

Any handle-specific follow-up mutation requires its
own registered operation and validation. Until shared-versus-personal content
ownership is settled, reflection-created content and customization must remain
logically distinguishable from base content and attributable to its authorized
invocation. User-visible removal should normally be reversible unless true
deletion is explicitly intended. V2 production-cue deactivation is an explicit
logical deletion: historical facts remain, and any later cue creation is
independent of the deleted cue.

Creating a new private/local contrast cluster is compatible with that boundary.
Silently overwriting base lexical meanings or shared content is not.

## 14. Explicit Deferrals

The following are not defined operations yet:

- extend or merge an existing contrast cluster;
- revise or delete existing contrast prompts;
- destructively delete a production cue or re-anchor it to another task;
- re-enable suppressed definition production;
- change general word or skill priority;
- assign maintenance or protection tiers;
- force next-session focus;
- schedule a finite distinction-practice burst;
- add free-standing explanations outside a defined content model;
- retrospectively rewrite an attempt's learning outcome; and
- create arbitrary future study-action kinds.

The following infrastructure and policy questions are also deferred:

- full proposal/application transition history beyond the current status;
- automatic discovery and enqueueing of newly supported operation versions;
- a complete evaluation harness;
- broad learner-history context;
- hosted tenancy and publication policy;
- a generic manual workbench UI; and
- artifact-level read/archive state.

Real repeated needs should promote a new operation or schema version. They
should not silently broaden an existing payload.

## 15. Canonical Scenarios

### Exact acceptance and successful application

The model proposes version 1 suppression. The user accepts unchanged. The
review becomes `accepted/exact`, an invocation stores the original operation,
and a supported adapter moves the application through `pending` to `applied`
with a relevance effect reference.

### Revised generated content

The model proposes a contrast cluster. The user edits one prompt and accepts.
The artifact retains the original prompt. The review becomes
`accepted/revised`; the invocation stores the edited cluster operation; the
adapter applies only that operation.

### Accepted V1 cue repair remains unsupported

The model proposes a V1 cue repair. The user accepts its direction. The review
is `accepted`, the exact draft is stored in an invocation, and application is
`unsupported`. No cue, meaning, or scheduling state changes. A later V2 repair
requires a fresh authorized invocation and explicit supersession.

### V2 cue repair applies prospectively

The model proposes a V2 replacement that expands one cue's accepted-word set.
The learner accepts it. The adapter creates a new immutable cue, deactivates
only the named prior cue, records attributable effect references, and may
append the authorized later judgment to cue evidence. The motivating attempt,
its served acceptance snapshot, and its word-scheduler outcome are unchanged.

### Already satisfied elsewhere

A manual suppression occurs before an accepted suppression invocation applies.
The invocation remains authorized, but its application becomes
`already_satisfied` with a reference to the existing relevance state. The
manual effect is not attributed to reflection.

### Different-kind replacement

The model proposes suppression, but the user decides contrast content is the
right intervention. The original proposal becomes `superseded`; a
user-replacement invocation stores the contrast operation and links back to the
proposal. The system does not call this a revised acceptance of suppression.

### Stale operation

A referenced word or required relationship no longer exists when application
runs. The accepted review remains historical. The invocation becomes `stale`,
and no effect is attributed.
