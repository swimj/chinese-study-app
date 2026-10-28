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

**Current Mandarin entry point:** [Adaptive vocabulary study](../SPECS/vocabulary-learning.md)
owns modes, selection, session behavior and content-review promises. The
[product routes](../SPECS/README.md) distinguish current contracts from earlier
runtime designs retained for interpretation and rationale.

[What’s New](whats-new.md#content-and-publication) defines the blog’s publication
and unread-update contract; its persistence and operator sections explain how
the application realizes those promises.

## Prescriptive architecture

**Target:** accepted structural constraints and their reasons, independent of
particular components or algorithms.

- [Vocabulary architecture contract](../SPECS/vocabulary-architecture.md): session
  authority, retained evidence, atomic completion, content identity and application.
- [Stability frontier](../STABILITY_FRONTIER.md): cross-cutting constraints and
  unsettled decisions; it summarizes boundaries rather than replacing their owners.
- [Service boundary](private-beta-service-boundary.md): identity, ownership,
  persistence and operational trust. Its historical storage inventory is explicitly
  scoped; other mixed responsibilities remain in the gap inventory below.

## Descriptive architecture and implementation

**Target:** explain actual components, data flow, mechanisms, and limitations,
linking to the intended guarantees they realize and any known gaps.

**Existing starting points:**

- [Vocabulary runtime](vocabulary-learning.md): persistence, selection, session
  execution, background preparation and compatibility.
- [Vocabulary study UI](implementation/vocabulary-ui.md): controller/view integration,
  rendering, input behavior and verification surfaces.
- [Architecture map](architecture.md): runtime layout and code navigation;
  currently identifies itself as navigation-only.
- [Vocabulary content-improvement architecture](implementation/vocabulary-content-improvement.md):
  rendered provider-call flow, sense admission, and optional pure-cue promotion.
- [API map](api.md), [database map](server-db.md), and
  [frontend map](../SPECS/frontend-architecture-map.md): focused code references.
- [Operator panel guide](operator-panel.md): how to reach and use the
  bookmark-only operator surface.
- [Structured review content](structured-review-content.md),
  [reflection frontend](reflection-frontend-architecture.md), and
  [content quality](content-quality.md): related feature realization and operator
  material.
- [Test coverage map](testing.md): test files and the domains they exercise.

The maps provide useful navigation. The target also calls for explanatory
accounts of the mechanisms and causal relationships behind that structure.

### Word content

| Reader's question | Explanation |
| --- | --- |
| How are current content identities and learner eligibility represented? | [Content identity and eligibility](vocabulary-learning.md#content-identity-and-eligibility) |
| How does teaching become ready and lead to general practice? | [Background preparation](vocabulary-learning.md#background-work-and-operator-repair) |
| How do reactions produce reviewable content changes? | [Content-improvement pipeline](implementation/vocabulary-content-improvement.md) |
| How do I interpret earlier package records and source artifacts? | [Representation](word-content-representation.md), [generation](word-content-generation.md), and [serving](word-content-serving.md) retain the earlier package account and shared preparation context; current vocabulary selection is owned above. |

The [bootstrap and introduction design](../SPECS/word-bootstrap-and-introduction.md)
retains teaching rationale and earlier package-based realization. The
[local introduction aid](word-introduction-lab.md) supports authoring experiments.
These routes do not certify full reconciliation of the older package guides.

## Operations guides

**Target:** maintained procedures and safety conditions, with learner use,
hosted operations, and contributor development clearly separated.

- Hosted operation: [release and maintenance](ops/hosted-beta-deployment.md),
  [observability](ops/hosted-observability.md),
  [diagnostics](ops/error-diagnostics.md), and
  [schema migrations](ops/schema-migrations.md).
- Operator interface: [operator panel guide](operator-panel.md), with the
  [API reference](api.md#operator-view) describing its HTTP contracts.
- Content correction: [Content improvement workflow](operator-panel.md#content-improvement-workflow)
  explains current vocabulary review and application. The
  [earlier correction reference](content-improvement.md) explains historical records
  and read access; its Mandarin write API is retired.
- Blog publication: [manual editor and operator command](whats-new.md#manual-operator-editor),
  including the skill’s interactive draft-review procedure.
- Contributor environments: [scripts](scripts.md) and the
  [local introduction development aid](word-introduction-lab.md).
- Prompt development: [preserving working behavior while adapting model calls](prompt-development.md),
  including prompt lineage, contract changes, and retained comparison evidence.

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
| 2026-10-07 | The root README mixes product/repository orientation with former local-study clone advice and French try-out instructions. Its retained material needs appropriate current guides or an explicit historical role. |
| 2026-10-28 | Vocabulary product and architecture contracts have separate owners, and the affected earlier lifecycle/reflection contracts have historical scope. The older word-content representation/generation/serving guides and other feature sources listed in SPECS/README.md still need their retained mechanisms and current applicability reconciled; closure requires explicit current versus historical ownership in those sources. |
| 2026-10-07 | `architecture.md` is primarily a navigation map. The system-level explanation of components, data flow, state boundaries, and mechanisms remains missing. |
| 2026-10-07 | The service-boundary document mixes guarantees, alternatives, the hosted package, one-time migration, and acceptance scenarios. The frontier combines direction, constraints, and unresolved decisions. These documents still need clearer responsibilities. |
| 2026-10-07 | Legacy in-repo plans and vision copies need a retention decision: useful conclusions need current explanatory homes, and retained historical material needs a deliberate reference role alongside the Steward workspace. |
| 2026-10-08 | The local introduction lab is an exploratory development aid. Its longer-term role and the documentation needed for it remain undecided; a reusable local prompt-development workflow has not been specified. |
