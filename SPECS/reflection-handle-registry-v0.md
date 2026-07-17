# Reflection Handle Registry V0

Status: accepted for the first M0 provider-spike iteration; design contract,
not implemented behavior.

This document defines the initial constrained operations that a post-session
reflection model may propose. Its immediate consumer is the M0 LLM provider
spike: candidate models should produce the same bounded result shape so their
Mandarin judgment and structured-output reliability can be compared.

The registry is intentionally narrower than the long-term handle inventory in
the agentic vision. It concentrates on the production-mistake and
contrast-content cases in the current reflection exemplars, while keeping each
operation close to an existing application primitive or a small, explicit
schema gap.

Related documents:

- [`notes/active/2026-07-06-session-reflection-workflow.md`](../notes/active/2026-07-06-session-reflection-workflow.md)
- [`notes/active/2026-07-10-session-evidence-bundle-design.md`](../notes/active/2026-07-10-session-evidence-bundle-design.md)
- [`SPECS/study-action-model.md`](./study-action-model.md)
- [`docs/vision/initial_agentic_srs_product_focus.md`](../docs/vision/initial_agentic_srs_product_focus.md)

## 1. Scope

V0 defines:

- the minimum reflection-result envelope needed by the LLM spike
- a hard-coded list of allowed learner-facing handle kinds
- one payload schema for each kind
- the boundary between proposing, accepting, and applying a handle
- proposal lifecycle states and transition rules
- validation and idempotency expectations for a later apply path

V0 does not define:

- database tables for reflection artifacts
- the reflection review UI
- provider-specific JSON-schema syntax
- model prompts or model-selection criteria
- developer-facing backlog items, handle-gap reports, extraction candidates,
  or bundle-gap reports
- a general planner, maintenance-tier model, or arbitrary word-priority policy

Developer-facing outputs are typed development artifacts, not handles. They do
not mutate learner study or content state and must not be forced through this
registry.

## 2. Core Decisions

### Handles are operations, not observations

A handle describes one bounded durable change that could be applied after user
confirmation. An observation, diagnosis, explanation, or recommendation may
exist without a handle.

In particular, `no_change` is not a handle. The model represents that judgment
with an empty `proposals` list. This prevents a non-operation from acquiring a
misleading accepted/applied lifecycle.

### Every model-emitted handle is proposal-only

The reflection model never writes durable state. For V0:

```text
model output -> validate -> show proposal -> user accepts -> application applies
```

`proposal-only` describes the model's authority. It does not mean every
accepted proposal is forever manual. A registry entry separately declares
whether an apply adapter is available.

### Acceptance and application are distinct

Acceptance records user authorization for the exact validated payload.
Application records that the operation actually changed durable state.

An accepted proposal must not be silently rewritten to fit current
implementation constraints. If its exact operation is not supported, it
remains accepted and unapplied until an adapter exists, or it is superseded by
a new proposal.

### One proposal contains one atomic operation

Cases such as “repair the cue and add contrast practice” produce two proposals.
They may share a `proposalGroupKey` for presentation, but the user can accept,
dismiss, defer, and apply them independently.

### The result may acknowledge a missing handle

The model must not squeeze an unsupported idea into the nearest allowed
payload. The learner-facing result may report a bounded `unhandledNeed`; the
developer-facing prototype can turn the same finding into a handle-gap
development artifact.

## 3. Minimal Reflection Result Contract

The result contract is included only far enough to give handle proposals their
context and make provider outputs comparable. Detailed artifact persistence is
deferred.

Application-generated UUIDs are intentionally absent from model output. Keys
need only be unique within one result; the artifact store can assign durable
ids after validation.

```ts
type SessionReflectionResultV2 = {
  schemaVersion: 'session_reflection_result.v2';
  bundleSchemaVersion: 'session_reflection_bundle.v0';
  summary: string;
  itemResults: ReflectionItemResultV0[];
};

type ReflectionItemResultV0 = {
  itemId: string;
  uncertain: boolean;
  diagnosisTags: ReflectionDiagnosisTagV0[];
  observation: string;
  learnerExplanation: string | null;
  proposals: ReflectionHandleProposalV0[];
  questions: ReflectionClarifyingQuestionV0[];
  unhandledNeeds: ReflectionUnhandledNeedV0[];
};

type ReflectionDiagnosisTagV0 =
  | 'valid_or_near_valid_alternate'
  | 'cue_overlap_hides_usage_difference'
  | 'production_cue_overloaded'
  | 'form_or_sound_interference'
  | 'grammar_or_usage_role_interference'
  | 'ordinary_retrieval_noise'
  | 'persistent_confusion'
  | 'insufficient_evidence';

type ReflectionClarifyingQuestionV0 = {
  questionKey: string;
  question: string;
  reason: string;
};

type ReflectionUnhandledNeedV0 = {
  needKey: string;
  description: string;
  whyExistingHandlesDoNotFit: string;
};
```

`questions` are conversational output, not handles: asking a question does not
change study state. A later resumable conversation design may give questions
their own lifecycle without putting them in the operation registry.

`uncertain` means the model does not have enough evidence to stand confidently
behind some material part of its interpretation or recommendation. It does not
mean the learner felt uncertain while answering; learner uncertainty belongs
in the observation. An uncertain result may still
offer a carefully qualified proposal, although a clarifying question or no
proposal is usually preferable when the missing fact could change the durable
operation.

V0 deliberately has no top-level verdict taxonomy. Whether an item was an
ordinary lapse, a useful correct-but-fragile signal, a content problem, or a
mixture is expressed by the observation, diagnosis tags, and proposals. This
avoids forcing every reflection item into one mutually exclusive class before
real prototype output shows that such a class is operationally useful.

V0 does not require model-emitted evidence citations. Each item result is
already scoped by `itemId`, and proposals are nested inside that result. Items
are judged independently in this iteration; cross-item observations are
deferred. Operation references remain strictly validated against the
corresponding input item because they can drive durable application behavior.

## 4. Common Proposal Envelope

```ts
type ReflectionHandleKindV0 =
  | 'flag_bad_production_cue'
  | 'suppress_definition_production'
  | 'upsert_contrast_content'
  | 'repair_production_cue'
  | 'accept_production_alternate';

type ReflectionHandleProposalV0 = {
  proposalKey: string;
  proposalGroupKey: string | null;
  handleVersion: 1;
  rationale: string;
  operation: ReflectionHandleOperationV0;
};

type ReflectionHandleOperationV0 =
  | FlagBadProductionCueOperationV0
  | SuppressDefinitionProductionOperationV0
  | UpsertContrastContentOperationV0
  | RepairProductionCueOperationV0
  | AcceptProductionAlternateOperationV0;
```

The operation union is discriminated by `kind`. Provider schemas should use a
strict union with unknown properties rejected. `rationale` explains why the
operation is appropriate; it must not be parsed to discover application data.

Priority and model confidence are deliberately not operation fields. They may
later belong to the surrounding reflection artifact, but changing application
semantics based on model confidence would mix judgment metadata with the
authorized operation.

## 5. Registry Entries

Apply-support labels mean:

- `existing_adapter`: current domain behavior is already close enough that a
  thin validated apply path should suffice
- `small_composition_adapter`: existing primitives exist, but the handle needs
  a new atomic orchestration boundary
- `schema_first`: needed to evaluate correct reflection judgment, but durable
  application waits for a small product schema decision

All five kinds remain model `proposal-only`, regardless of apply support.

| Kind | Durable effect | Apply support |
| --- | --- | --- |
| `flag_bad_production_cue` | Flags the shown production cue as problematic | `existing_adapter` |
| `suppress_definition_production` | Suppresses definition-based production for one word | `existing_adapter` |
| `upsert_contrast_content` | Creates or extends a cluster and adds draft prompts | `small_composition_adapter` |
| `repair_production_cue` | Replaces or layers the cue used for production | `schema_first` |
| `accept_production_alternate` | Accepts one known alternate for one cue | `schema_first` |

### 5.1 `flag_bad_production_cue`

Purpose: record that the definition-based production cue shown for a word is
unfair, misleading, overloaded, or otherwise unsuitable in its current form.

Apply support: `existing_adapter`.

```ts
type FlagBadProductionCueOperationV0 = {
  kind: 'flag_bad_production_cue';
  wordId: string;
  sourceCue: ProductionCueRefV0;
  issues: Array<
    | 'underdetermined'
    | 'misleading_gloss_overlap'
    | 'overloaded'
    | 'wrong_register_or_domain'
    | 'other'
  >;
  note: string;
};
```

This operation flags the current cue; it does not supply replacement content.
Use `repair_production_cue` separately when a concrete replacement is proposed.
The current app's bad-prompt feedback is the likely first adapter, although the
apply path must preserve the exact cue/action provenance when available.

### 5.2 `suppress_definition_production`

Purpose: disable definition-based production for a word when exact production
from a definition cue is a poor fit.

Apply support: `existing_adapter`.

```ts
type SuppressDefinitionProductionOperationV0 = {
  kind: 'suppress_definition_production';
  wordId: string;
  reason:
    | 'recognition_only_is_better_fit'
    | 'answer_space_too_open'
    | 'low_value_for_learner'
    | 'other';
  note: string;
};
```

This is narrower than a generic `suppress_skill`: V0 reflection only has a
well-understood product reason to suppress definition-based production.
Recognition and contextual-selection state are unchanged.

### 5.3 `upsert_contrast_content`

Purpose: create a new contrast cluster or extend an existing one, including
member nuance notes and one or more draft prompts.

Apply support: `small_composition_adapter`.

```ts
type UpsertContrastContentOperationV0 = {
  kind: 'upsert_contrast_content';
  destination:
    | { mode: 'create_cluster'; clusterId: null; title: string }
    | { mode: 'extend_cluster'; clusterId: string; title: null };
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
```

Validation rules:

- a new cluster must contain at least two distinct member word ids
- every proposal must contain at least one prompt
- every prompt target must be one of the resulting cluster's members
- extending a cluster may add members, revise supplied member nuance notes, and
  add prompts; it must not remove existing content
- all prompt and title strings are non-empty after trimming
- applying the operation is atomic even though it composes existing cluster,
  membership, and prompt primitives

V0 does not let the model revise or delete an existing prompt through this
operation. Destructive or identity-sensitive edits require the exact prompt id
and deserve a separate handle after real reflection cases demonstrate the need.

### 5.4 `repair_production_cue`

Purpose: propose a fairer cue for the learner-relevant production target,
without bloating the word's broad reference meanings.

Apply support: `schema_first`.

```ts
type RepairProductionCueOperationV0 = {
  kind: 'repair_production_cue';
  wordId: string;
  sourceCue: ProductionCueRefV0;
  replacementCues: Array<{
    cueType: 'definition_gloss' | 'cloze' | 'minimal_context' | 'register_or_domain_hint';
    text: string;
  }>;
  repairIntent:
    | 'narrow_to_learner_relevant_sense'
    | 'add_distinguishing_anchor'
    | 'add_contextual_triangulation'
    | 'split_overloaded_cue';
};
```

```ts
type ProductionCueRefV0 = {
  cueId: string | null;
  textAsShown: string;
};
```

This handle is retained despite the current lack of a durable cue-stack model
because cue repair is central to the exemplar set and therefore to model
evaluation. The first prototype can display and score the draft without
applying it. Before application is implemented, the product must decide whether
V0 edits meaning visibility, stores a dedicated production cue, or introduces
a small cue stack.

### 5.5 `accept_production_alternate`

Purpose: declare that a known word should count as an acceptable answer for a
specific production cue, without claiming the words are interchangeable in all
contexts.

Apply support: `schema_first`.

```ts
type AcceptProductionAlternateOperationV0 = {
  kind: 'accept_production_alternate';
  cue: ProductionCueRefV0;
  targetWordId: string;
  alternateWordId: string;
  acceptance: 'fully_acceptable_for_cue' | 'near_valid_creditworthy_answer';
  subtletyNote: string | null;
};
```

The cue scope is mandatory. This operation must not create a global synonym
edge or automatically create contrast practice. Application waits for the
answer-class decision already identified as a separate product spike. It is in
the evaluation registry because a model that cannot distinguish a valid
alternate from a useful contrast is not meeting the reflection quality bar.

## 6. Lifecycle

```ts
type ReflectionProposalStateV0 =
  | 'proposed'
  | 'accepted'
  | 'applied'
  | 'dismissed'
  | 'deferred'
  | 'superseded';

type ReflectionProposalLifecycleV0 = {
  state: ReflectionProposalStateV0;
  stateChangedAt: string;
  deferredUntil: string | null;
  supersededByProposalId: string | null;
  application: {
    applySupported: boolean;
    attemptCount: number;
    lastAttemptedAt: string | null;
    lastError: string | null;
    appliedAt: string | null;
    effectRefs: Array<{ type: string; id: string }>;
  };
};
```

Allowed transitions:

```text
proposed -> accepted | dismissed | deferred | superseded
deferred -> proposed | accepted | dismissed | superseded
accepted -> applied | deferred | superseded
```

`applied`, `dismissed`, and `superseded` are terminal for that proposal. A later
reversal is a new explicit proposal, preserving the audit trail.

Application failure does not create a seventh lifecycle state. The proposal
remains `accepted`; `application.lastError` records the failure and the exact
operation may be retried. `applied` is set only after the durable operation
commits successfully.

Accepting a `schema_first` handle is allowed. It records user agreement with
the proposed direction, but `applySupported` remains false and the UI must not
claim that state changed.

## 7. Validation And Apply Invariants

Before persistence, the application validates:

1. the result and operation use known schema versions
2. every input bundle item appears exactly once in `itemResults`, with no result
   for an unknown item id
3. every operation reference resolves inside its corresponding input bundle
   item
4. every referenced word, cluster, prompt, and cue that claims a durable id
   exists and is visible to the current learner
5. the payload satisfies its handle-specific cross-field rules
6. proposal keys are unique within the result
7. unknown fields and unknown handle kinds are rejected rather than ignored

Before application, the application additionally validates current state. A
proposal may have become stale after generation. The apply adapter must either:

- apply the exact accepted operation atomically and record effect references,
  or
- leave durable study/content state unchanged and record an application error

Apply is idempotent by durable proposal id. Retrying an already applied
proposal returns its recorded effects and does not duplicate clusters, members,
prompts, or feedback events.

## 8. Initial Evaluation Coverage

The LLM provider spike should include cases that require:

- a legitimate lapse with no proposal
- an unfair cue that merits flagging but no invented repair
- a concrete cue repair
- a valid alternate scoped to one cue
- a real semantic or register boundary needing contrast content
- form/phrase-shape interference despite clearly different meanings
- a low-value production target that should be suppressed
- a compound case producing two independent proposals, such as cue repair plus
  contrast content
- uncertainty that produces a clarifying question or `unhandledNeed` instead
  of a malformed handle

Evaluation should score at least:

- valid strict-schema output
- correct handle selection, including choosing no handle
- correct word/cue/cluster references
- payload completeness and internal consistency
- quality and grounding of the rationale
- restraint: no unsupported mutation smuggled into free text

## 9. Explicitly Deferred Handles

The following vision-level operations are excluded from the reflection V0
registry until their policy or application target is clearer:

- change general word or skill priority
- assign maintenance/protection tier
- force next-session focus
- schedule a finite distinction-practice burst
- add a free-standing word explanation or gist outside contrast content
- revise or delete existing contrast prompts
- restore a suppressed skill
- create arbitrary future study-action kinds

The result can describe these as `unhandledNeeds`. Repeated, high-value gaps
from the developer-facing prototype are the evidence for promoting one into a
later registry version.

## 10. V0 Judgment Decisions

The following choices are settled for the first provider-spike iteration:

1. **Retain `repair_production_cue`.** Cue repair is important to model-quality
   evaluation even before the durable cue model is chosen. It remains
   `schema_first`; accepting a proposal does not imply that it can already be
   applied.
2. **Retain `accept_production_alternate`.** Distinguishing a valid or
   creditworthy alternate from a useful contrast is part of the reflection
   quality bar. Application still waits for the answer-class product decision.
3. **Use one prompt-backed contrast handle.** Reflection creates or extends a
   cluster only when it can also author at least one contextual selection
   exercise. There is no separate unresolved-candidate handle in this
   iteration. Later contrast-management actions can edit, flag, or otherwise
   adjust the resulting content.
4. **Defer finite distinction-practice bursts.** The product lacks the durable
   episode and scheduling machinery, and introducing it is nontrivial. V0 may
   create contrast content but must not imply a finite scheduling policy.
5. **Allow bad-cue flagging and cue repair independently.** A reflection may
   propose both operations: the flag records that the current cue is harmful,
   while repair proposes replacement content. Their acceptance and lifecycle
   remain separate.
