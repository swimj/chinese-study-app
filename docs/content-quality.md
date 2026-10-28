# Content quality ratings

This guide explains the operator panel's retained content-rating ledger: how to
inspect exact rated material and interpret the aggregates. Current vocabulary
reactions are session evidence described by the
[product contract](../SPECS/vocabulary-learning.md#reactions-feedback-content-repair-and-authority)
and [study UI guide](implementation/vocabulary-ui.md). This ledger describes
ratings captured through the earlier content-quality path, not all current
vocabulary reactions.

## Reading the ledger

The operator page (`#operator-usage`) shows a single table of current non-null
learner/content ratings, defaulting to the last seven UTC days by last-change
time. Date bounds, item text, content type, and vote can be filtered in the
table; column headings sort it. A table control switches between individual
ratings and an aggregate by exact content snapshot, with Helpful, Not helpful, and
rated-pair counts. Changing a vote moves its ledger row; clearing it removes the
row. Earlier vote states are not retained.

This is a sparse, voluntary impression ledger, not a representative quality
score or causal comparison of models. It deliberately focuses on ratings rather
than un-rated displays. Exact content snapshots remain inspectable in either
table view.

Access uses the existing operator allowlist. The operator can inspect the exact
rated material, including private authored material, but this view does not
include learner identifiers, responses, private notes, or reflection bundles.
Quality evidence is not fed to any model provider.

## Storage and interpretation

A stored rating belongs to one learner and exact content identity/revision.
Its snapshot and available generation provenance identify the material rated;
a later authored revision is not evidence that the learner rated that revision.
Recorded displays are browser observations, not proof of attention or learning.

`src/domain/content-quality.ts` defines the retained shapes;
`server/db/content-quality.ts` resolves and reads the ledger. Migrations
`0021_content_quality` and `0035_definition_fallback_quality` introduced its
storage and definition-fallback snapshots. The operator panel uses
`ContentQualityPanel`; current corrections use the
[Content improvement workflow](operator-panel.md#content-improvement-workflow).
