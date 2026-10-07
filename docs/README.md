# Documentation index

Use this index to find the explanation that owns your question. The
[documentation principles](documentation-principles.md#target-hierarchy-and-ownership)
define the target hierarchy independently of today's folders and labels.

This index adopts that routing model and identifies current sources and gaps.
It does not certify those sources as complete, accurate, or correctly factored.
The distinction matters: the target can be sound while a linked document still
needs substantial work.

## Entry points

- [Root README](../README.md) owns product/repository orientation and where to
  go next. Its legacy body still needs reconciliation, as recorded below.
- [AGENTS.md](../AGENTS.md) owns contributor execution guidance: scope, safety,
  conventions, verification, and delivery. Its task routes select relevant
  context rather than mandate the whole corpus.
- This index owns documentation navigation and the bounded adoption inventory
  below. It routes to current owners; it does not duplicate their explanations.

## Product model and intended guarantees

**Target:** a coherent product-wide model, refined by feature/domain owners.
Readers should recover the vocabulary, relationships, learner lifecycle, and
promises without first reconstructing the current implementation.

**Existing sources:** [product and feature routes](../SPECS/README.md) lead to
word lifecycle, scheduling, session behavior, introduction, debrief, reflection,
and other areas. [STABILITY_FRONTIER.md](../STABILITY_FRONTIER.md) collects
cross-cutting constraints and unsettled decisions. The
[service-boundary document](private-beta-service-boundary.md) contains ownership,
identity, persistence, and operational-trust guarantees.

These sources have not yet been reconciled into the target ownership hierarchy.
In particular, the frontier and service-boundary document mix several roles.
Their existing guarantees remain relevant; rerouting them does not authorize
changing product behavior or discarding safety constraints.

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
  the relevant feature owners.

An implementation map is a useful source, but its existence does not establish
that the system's mechanisms and causal relationships are explained adequately.

## Operations and contributor workflows

**Target:** maintained procedures and safety conditions, with learner use,
hosted operations, and contributor development clearly separated.

- Hosted operation: [release and maintenance](ops/hosted-beta-deployment.md),
  [observability](ops/hosted-observability.md),
  [diagnostics](ops/error-diagnostics.md), and
  [schema migrations](ops/schema-migrations.md).
- Contributor work: [testing](testing.md), [scripts](scripts.md),
  [introduction lab](word-introduction-lab.md), and
  [development and review](stacked-feature-development-and-review.md).

These are the relevant existing routes, not evidence of a fresh operational
audit. The old README's stable local-study clone workflow is no longer the
default way to use the product.

## Rationale and supporting history

The affected current owner should explain important decisions or link their
rationale. Use [working notes](../notes/README.md), [PLANS](../PLANS/),
[archived specs](../SPECS/archive/), and
[older in-repo vision](vision/) only for a specific historical or exploratory
question. They are not required layers of the target hierarchy or sources of
automatic execution authority.

The [steward context in AGENTS.md](../AGENTS.md#11-project-context-and-task-scope)
identifies an existing owner for north-star and priority material. The older
vision copies still need a deliberate disposition; this index does not declare
them migrated, current, or worth retaining wholesale.

## Known adoption gaps

Observed on **2026-10-07**, from the
[PR #315 review](https://github.com/swimj/chinese-study-app/pull/315#pullrequestreview-5437854523)
and the linked repository documents. This is a finite inventory of known structural gaps in this change's
scope, not an exhaustive accuracy audit or a separate task backlog. The target
above remains the standard while these gaps are open.

1. **Root README still mixes orientation with former usage and implementation
   detail.** Its opening now routes correctly; the retained body includes
   local-study clone advice, French try-out instructions, and machine-local
   links. Close this gap when the landing page is concise and retained material
   has been reconciled into appropriate current guides or labeled history.
2. **The product-wide model lacks a reconciled owner.** Current explanations
   are spread across word/session/scheduling specs and the frontier. Close when
   readers have one coherent route through shared concepts, cross-cutting
   promises, and subordinate feature contracts, with duplicated or conflicting
   ownership resolved.
3. **The technical overview is primarily a map.** `architecture.md` explicitly
   calls itself navigation-only. Close when the actual architecture has an
   explanatory owner for components, data flow, state boundaries, and mechanisms,
   distinct from the normative product model and linked to it.
4. **Several existing documents combine unrelated roles.** The service-boundary
   document includes guarantees, alternatives, the hosted package, one-time
   migration, and acceptance scenarios. The frontier combines direction,
   constraints, and unresolved decisions; the content-model checkpoint combines
   model and implementation evidence. Close each instance by establishing clear
   ownership and reconciling its sections into current explanation, contract,
   rationale, or history. A new heading or index label alone does not close it.
5. **Feature/domain ownership and contract/realization boundaries are unreviewed.**
   `SPECS/README.md` now offers routes rather than blessing its former taxonomy.
   Close this gap incrementally for each area actually reconciled, recording
   the bounded result and any remaining areas rather than declaring all specs
   conformant from one pilot.
6. **Legacy planning and vision material has no settled disposition.** The
   PR #315 review identified that in-repo plans are no longer routinely used
   and vision may already have a home in the steward workspace. Close when useful decisions
   have a current owner and retained materials have a deliberate reference or
   historical role. Do not delete, relocate, or revive them just from this list.

Update or remove an entry as its evidence changes or its exit condition is met;
put detailed work in the owning document or an existing issue/PR. Remove this
temporary inventory when its listed gaps are closed. No elapsed date, passing
test run, or partial edit makes an unresolved entry disappear automatically.
