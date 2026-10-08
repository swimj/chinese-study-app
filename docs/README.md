# Documentation index

Use this index to find the document or section that answers your question. The
[documentation principles](documentation-principles.md#documentation-map)
define the target hierarchy independently of today's folders and labels.

The **Target** paragraphs describe the job of each document group. **Existing
sources** identify available material. The dated inventory below records known
outstanding gaps between that material and the target.

## Entry points

- [Root README](../README.md) owns product/repository orientation and where to
  go next. Its legacy body still needs reconciliation, as recorded below.
- [AGENTS.md](../AGENTS.md) is the entry point for agent instructions about
  conducting work: documentation authoring, implementation/testing/review, and
  specialized procedures.
- This index routes readers to knowledge about the application and records the
  known outstanding gaps below. Each linked document or section maintains
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

[What’s New](whats-new.md#content-and-publication) defines the blog’s publication
and unread-update contract; its persistence and operator sections explain how
the application realizes those promises.

## Current architecture and implementation

**Target:** explain actual components, data flow, mechanisms, and limitations,
linking to the intended guarantees they realize and any known gaps.

**Existing starting points:**

- [Architecture map](architecture.md): runtime layout and code navigation;
  currently identifies itself as navigation-only.
- [API map](api.md), [database map](server-db.md), and
  [frontend map](../SPECS/frontend-architecture-map.md): focused code references.
- [Operator panel guide](operator-panel.md): how to reach and use the
  bookmark-only operator surface.
- [Structured review content](structured-review-content.md),
  [reflection frontend](reflection-frontend-architecture.md), and
  [content quality](content-quality.md): related feature realization and operator
  material.
- [Operator content improvement](content-improvement.md): correction review,
  safe application, agent API, and retained evidence for generation improvements.
- [Test coverage map](testing.md): test files and the domains they exercise.

The maps provide useful navigation. The target also calls for explanatory
accounts of the mechanisms and causal relationships behind that structure.

### Word content

| Reader's question | Explanation |
| --- | --- |
| How are the meanings, examples, introductions, and recall exercises that learners see represented? | [Word content data representation](word-content-representation.md): source/package identity, stimuli, answer contracts, snapshots, and compatibility |
| How does the application generate that content and make a complete package available? | [Generating and publishing word content](word-content-generation.md): authoring, validation, retained work, retries, and publication |
| How does a learner receive prepared content, and how does using it affect study progress? | [Serving word content during study](word-content-serving.md): preparation demand, private association, session selection, and first-encounter/Practice integration |

The [word bootstrap and introduction contract](../SPECS/word-bootstrap-and-introduction.md)
defines the intended content model and feature guarantees. The
[local introduction aid](word-introduction-lab.md) retains the launch reference
for the original teaching-prompt exploration.

## Operations guides

**Target:** maintained procedures and safety conditions, with learner use,
hosted operations, and contributor development clearly separated.

- Hosted operation: [release and maintenance](ops/hosted-beta-deployment.md),
  [observability](ops/hosted-observability.md),
  [diagnostics](ops/error-diagnostics.md), and
  [schema migrations](ops/schema-migrations.md).
- Operator interface: [operator panel guide](operator-panel.md), with the
  [API reference](api.md#operator-view) describing its HTTP contracts.
- Blog publication: [manual editor and operator command](whats-new.md#manual-operator-editor),
  including the skill’s interactive draft-review procedure.
- Contributor environments: [scripts](scripts.md) and the
  [local introduction development aid](word-introduction-lab.md).

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

This table records observed documentation problems left open beyond the task
that found them. Add new findings; when part of a row is addressed, replace it
with the remaining problem or problems. Remove resolved rows. Absence can mean
unassessed or reconciled; the table is not a coverage record. Keep detailed work
with the relevant document or issue/PR.

The initial findings come from the
[PR #315 review](https://github.com/swimj/chinese-study-app/pull/315#pullrequestreview-5437854523)
and the referenced documents.

| Date added | Outstanding description |
| --- | --- |
| 2026-10-07 | The root README mixes product/repository orientation with former local-study clone advice, French try-out instructions, and machine-local links. Its retained material needs appropriate current guides or an explicit historical role. |
| 2026-10-07 | Shared product concepts and guarantees are spread across word/session/scheduling specifications and the frontier. Their explanatory boundaries, duplicated accounts, and links from feature contracts need reconciliation. |
| 2026-10-07 | `architecture.md` is primarily a navigation map. The system-level explanation of components, data flow, state boundaries, and mechanisms remains missing. |
| 2026-10-07 | The service-boundary document mixes guarantees, alternatives, the hosted package, one-time migration, and acceptance scenarios. The frontier combines direction, constraints, and unresolved decisions. These documents still need clearer responsibilities. |
| 2026-10-07 | Legacy in-repo plans and vision copies need a retention decision: useful conclusions need current explanatory homes, and retained historical material needs a deliberate reference role alongside the Steward workspace. |
| 2026-10-08 | The local introduction lab is an exploratory development aid. Its longer-term role and the documentation needed for it remain undecided; a reusable local prompt-development workflow has not been specified. |
