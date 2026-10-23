# Vocabulary content-improvement architecture

The adaptive vocabulary content-improvement pipeline separates sense admission,
local exercise repair, and optional pure-cue promotion. This architecture reference
shows provider-call boundaries and the authority of their outputs. Implementation
and release readiness are tracked separately.

![Provider-call flow for backend vocabulary content improvement. Blue boxes are model calls; other nodes are backend decisions and persistence.](../diagrams/content-improvement-provider-flow.png)

## Reading the flow

- **Sense readiness** reuses an established inventory or imports usable bootstrap
  uses without a provider call. Otherwise, it requests a sense-only inventory.
  Partial or inconsistent inventories require operator inspection.
- **Mapping** assesses the authored exercise. A single intended sense admits local
  improvement; a laundry list routes to a fresh repertoire. An unmappable cue or
  inventory gap stops generation with an operator finding. The mapped sense is
  authorial context, not a clue the learner necessarily saw.
- **Local improvement** preserves that sense and the exercise's accepted answers.
  Local drafts and a pure-cue referral are independently optional. Raw responses
  and learner reactions inform assessment without dictating the result.
- **Promotion** resolves referral words to lexical identities and examines
  overlapping pure cues in the same publication scope. It can reject the referral,
  reuse a suitable cue, extend membership while retaining its stimulus, axis and
  existing answers, or propose a new cue. It does not reconcile individual words'
  exercise collections. Unresolved identities retain an operator finding and any
  local drafts.
- **Application** remains operator-controlled. New or extended pure cues join any
  local repairs in a reviewable proposal. Reuse and rejection are retained
  assessments; neither publishes an edit.

The ordinary single-sense path makes two calls, or three with promotion, plus one
if sense generation is necessary. Completed admission stages are retained by exact
input and contract, so an unchanged retry reuses their outputs. Failed provider
work requires explicit retry; source and sense changes fence stale results.

Teaching issues go to a manual inbox. Existing pure-cue repairs, recognition,
contrast, and other exercises outside single-word admission use the general
improvement call. Learner-facing feedback and scheduling compensation run through
an independent feedback job.

See the [vocabulary contract](../../SPECS/vocabulary-learning.md) for learning and
review authority, and the [implementation guide](../vocabulary-learning.md) for
runtime details.

## Updating the picture

The [rendering source](../diagrams/render-content-improvement-flow.py) keeps layout,
labels, and colors editable. Regenerate the checked-in PNG with Python and Pillow:

```sh
python3 docs/diagrams/render-content-improvement-flow.py
```

The renderer uses Arial on macOS or DejaVu Sans elsewhere; `--font` and
`--bold-font` accept alternate TrueType font paths. Inspect the rendered image
when changing labels or routing, and keep this explanation aligned with it.
