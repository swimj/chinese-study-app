# Documentation index

Use this index to find the document or section that answers your question. The
[documentation principles](documentation-principles.md#documentation-map)
define the target hierarchy independently of today's folders and labels.

The **Target** paragraphs describe the job of each document group. **Existing
sources** identify available material. The dated inventory below records known
gaps between that material and the target, including areas awaiting assessment.

## Entry points

- [Root README](../README.md) owns product/repository orientation and where to
  go next. Its legacy body still needs reconciliation, as recorded below.
- [AGENTS.md](../AGENTS.md) is the entry point for agent instructions about
  conducting work: documentation authoring, implementation/testing/review, and
  specialized procedures.
- This index routes readers to knowledge about the application and records the
  bounded adoption inventory below. Each linked document or section maintains
  its current explanation.

## Product model and intended guarantees

**Target:** coherent shared concepts and guarantees, refined by feature/domain
models and contracts. Several documents can explain the shared model.
Readers should recover the vocabulary, relationships, learner lifecycle, and
promises without first reconstructing the current implementation.

**Existing sources:** [product and feature routes](../SPECS/README.md) lead to
word lifecycle, scheduling, session behavior, introduction, debrief, reflection,
and other areas. [STABILITY_FRONTIER.md](../STABILITY_FRONTIER.md) collects
cross-cutting constraints and unsettled decisions. The
[service-boundary document](private-beta-service-boundary.md) contains ownership,
identity, persistence, and operational-trust guarantees.

These sources remain to be reconciled into the target hierarchy. In particular,
the frontier and service-boundary document mix several roles. Their existing
guarantees remain relevant while the documentation is reorganized.

## Current architecture and implementation

**Target:** explain actual components, data flow, mechanisms, and limitations,
linking to the intended guarantees they realize and any known gaps.

**Existing starting points:**

- [Architecture map](architecture.md): runtime layout and code navigation;
  currently identifies itself as navigation-only.
- [API map](api.md), [database map](server-db.md), and
  [frontend map](../SPECS/frontend-architecture-map.md): focused code references.
- [Introduction guide](word-introduction-in-app.md),
  [structured review content](structured-review-content.md), and
  [reflection frontend](reflection-frontend-architecture.md): feature realization.
- [Content model](word-content-model.md) and [content quality](content-quality.md):
  additional model, implementation, and operator material to reconcile with
  the relevant feature explanations.
- [What’s New blog](whats-new.md): content/publication contract, live operator
  editor and command, and release-note skill.
- [Test coverage map](testing.md): test files and the domains they exercise.

The maps provide useful navigation. The target also calls for explanatory
accounts of the mechanisms and causal relationships behind that structure.

## Operations guides

**Target:** maintained procedures and safety conditions, with learner use,
hosted operations, and contributor development clearly separated.

- Hosted operation: [release and maintenance](ops/hosted-beta-deployment.md),
  [observability](ops/hosted-observability.md),
  [diagnostics](ops/error-diagnostics.md), and
  [schema migrations](ops/schema-migrations.md).
- Contributor environments: [scripts](scripts.md) and the
  [introduction lab](word-introduction-lab.md).

The hosted service is the current learner path. These guides provide the
existing operational references; their coverage and accuracy need verification
for the operation being performed.

## Rationale and supporting history

The relevant model, contract, or implementation document should explain
important decisions or link their rationale. Use
[working notes](../notes/README.md), [PLANS](../PLANS/),
[archived specs](../SPECS/archive/), and
[older in-repo vision](vision/) only for a specific historical or exploratory
question. Accepted decisions and useful reasons should be linked from the
current explanatory document.

[Steward](../AGENTS.md#11-project-context-and-task-scope) maintains current
vision and priorities. The older in-repo vision copies remain to be assessed
for useful rationale and historical context.

## Known adoption gaps

Observed on **2026-10-07**, from the
[PR #315 review](https://github.com/swimj/chinese-study-app/pull/315#pullrequestreview-5437854523)
and the linked repository documents. This finite inventory records observed
structural gaps and assessment limits within this change's scope. The target
above remains the standard while these gaps are open; detailed work follows
the relevant document or existing issue/PR.

1. **Root README still mixes orientation with former usage and implementation
   detail.** Its opening now routes correctly; the retained body includes
   local-study clone advice, French try-out instructions, and machine-local
   links. Close this gap when the landing page is concise and retained material
   has been reconciled into appropriate current guides or labeled history.
2. **Shared product-model explanations need reconciled boundaries.** Current
   explanations are spread across word/session/scheduling specs and the frontier. Close when
   each shared concept and guarantee has a clear explanatory document or
   section, and links show how feature contracts refine those definitions.
   Resolve duplicated or conflicting accounts as part of that work.
3. **The technical overview is primarily a map.** `architecture.md` explicitly
   calls itself navigation-only. Close when the actual architecture has an
   explanatory document for components, data flow, state boundaries, and
   mechanisms, distinct from the normative product model and linked to it.
4. **Several existing documents mix roles that need clearer boundaries.** The
   service-boundary document includes guarantees, alternatives, the hosted
   package, one-time migration, and acceptance scenarios. The frontier combines direction,
   constraints, and unresolved decisions; the content-model checkpoint combines
   model and implementation evidence. Close each remaining instance by
   identifying the document or section for each explanation and reconciling
   the content into current explanation, contract, rationale, or history.
5. **Feature documents await area-by-area assessment.** `SPECS/README.md` lists
   the current sources. Assess the explanatory responsibilities and
   contract/realization boundaries in each area. Close this gap incrementally,
   recording the documents reconciled and the areas still awaiting assessment.
6. **Legacy planning and vision material needs a retention decision.** The
   PR #315 review identified that in-repo plans are no longer routinely used
   and vision may already have a home in the Steward workspace. Close when
   useful decisions have a current explanatory document and retained materials
   have a deliberate reference or historical role. Changes to retained files
   follow the scope of the task carrying out that assessment.

Update or remove an entry as its evidence changes or its exit condition is met;
put detailed work in the owning document or an existing issue/PR. Remove this
temporary inventory when its listed gaps are closed, using the relevant
documentary evidence to establish closure.
