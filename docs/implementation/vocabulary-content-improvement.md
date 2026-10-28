# Vocabulary content-improvement architecture

The adaptive vocabulary content-improvement pipeline separates sense admission,
local exercise repair, optional pure-cue promotion, and existing pure-cue review.
This implementation reference describes current provider-call boundaries,
retained stage results and publication fences. The
[architecture contract](../../SPECS/vocabulary-architecture.md) prescribes the
authority boundaries; the [operator workflow](../operator-panel.md#content-improvement-workflow)
explains review controls.

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
- **Repertoire generation** shares ordinary preparation's general-exercise
  authoring call and validation, using the reflection job's selected model.
  Active sense descriptions provide uses and available examples. The adapter
  preserves structured clozes and post-answer teaching notes in a proposal: one
  operation replaces the source and the others add exercises. Generation leaves
  the live exercise pool unchanged until operator application.
- **Promotion** resolves referral words to lexical identities and examines
  overlapping pure cues in the same publication scope. It can reject the referral,
  reuse a suitable cue, extend membership and update its integrated teaching note,
  or propose a new cue. Extension preserves the stimulus, axis and existing answers.
  Promotion does not reconcile individual words'
  exercise collections. Unresolved identities retain an operator finding and any
  local drafts.
- **Application** remains operator-controlled. New or extended pure cues join any
  local repairs in a reviewable proposal. Reuse and rejection are retained
  assessments; neither publishes an edit.

The ordinary single-sense path makes two calls, or three with promotion, plus one
if sense generation is necessary. Completed admission stages are retained by exact
input and contract, so an unchanged retry reuses their outputs. Failed provider
work requires explicit retry, except sense preparation, which retries automatically
within its three-attempt cycle. Source and sense changes fence stale results.

Only general production encounters enter provider work. Recognition and contrast
remain fully recorded in the session log but create no provider calls, including
within mixed-word feedback aggregation. Teaching issues go to a manual inbox.

## Admission, repair and promotion

### Single-word assessment

Single-word local improvement drafts wording changes and additional variants of
the supplied exercise while preserving its accepted-answer membership. Operators can
edit the full authored draft, including its answer relationships, before preview.
Automatic proposals for new contrast clusters or learner suppression are not
supplied by this adapter. Single-word admission can additionally propose pure-cue
creation or membership extension through the separate shared-practice assessment
below.

Single-word production improvement first establishes the word's sense inventory
and separately assesses the authored cue before attempting a sense association.
A defensible single sense admits a sense-specific local assessment with
independently optional local operations and a shared-practice referral. A gloss
laundry list spanning distinct senses automatically generates a fresh repertoire proposal: one replacement retires the laundry list
and additional exercises extend the pool, without retiring other cues. The
repertoire draws on the word's active inventory; the discarded list has no sense
association or requirement to preserve its old glosses. Reflection invokes the same
general-exercise authoring contract as ordinary preparation, retaining the complete
general v4 brief, structured direct/cloze stimuli, optional teaching notes, and
output validation. It keeps the reflection job's selected model. Established
senses supply the lexical uses and any retained examples; missing examples are
not invented. The response adapter preserves the source's accepted answers and
publication scope and creates proposal operations instead of publishing exercises.
All content application requires operator approval. An uninterpretable exercise or an
apparent inventory gap for a single intended use stays in the operator inbox
with its mapping rationale;
neither triggers automatic repair or sense expansion. Operators can close these
findings after inspection. Learner feedback and compensation remain independent.

### Existing pure-cue assessment

Existing pure cues use a dedicated standalone `pure-cue-improvement.md` call,
not the generic improvement fallback. Its input supplies complete original
content and current members, projected encounters, and lexical resolutions of
effective rejected responses. Missing or ambiguous lexical identities do not
remove raw-response evidence, but cannot authorize new member IDs. The result
is extension, stimulus repair, or explanation-only. Extension preserves the
stimulus, axis, current members and accepted forms while replacing the complete
teaching note; repair changes only the stimulus. The accumulated teaching note
integrates all members, mostly in English with Chinese where helpful. Both
changes require manual application and leave individual word repertoires alone.
The call uses prompt/schema version 1 and projection `vocabulary-admission.v1`,
retains invocation provenance and source/lexical fences, and does not use the
admission stage-result cache.

### Promotion

A referral supplies advisory written forms, a shared purpose, and rationale;
local operations retain their original answer contract. Raw responses can suggest
an alternative even without a resolved lexical record. `pure-cue-promotion.ts`
resolves the forms to lexical identities, using the source to disambiguate its own
target. Missing or ambiguous candidates remain an operator-attention finding.
Resolved candidates lead to a same-job assessment of active, overlapping pure
cues in the source's publication scope and owner. It can reject, reuse, extend,
or create. Extension preserves the existing prompt, reveal axis, all answer
members and their accepted forms; every added member must suit that same task.
Creation and extension author complete, mostly English teaching notes, preserving
useful accumulated nuance on extension. Creation authors a new shared-purpose
cue from resolved candidates. Both become operations alongside any local edits in one manual proposal; rejection and reuse
remain recorded assessments. Private reactions inform judgment without becoming
shared authored text. This stage does not reconcile the participating words'
exercise repertoires or change scheduling and compensation.

### Versions and retained stage results

`single-improvement.md` uses prompt version 3 and schema
version 2; mapping retains prompt version 2 and schema version 1. Repertoire uses
the shared general-exercise prompt v4 and schema version 1. Its retained stage
identity includes that authoring contract, so older repertoire stage results do
not satisfy a new invocation. Existing saved proposals and second opinions remain
bound to their original versions; an upgrade does not regenerate them.
Promotion uses prompt version 3, schema version 2 and projection
`vocabulary-admission.v1`. Admission stages retain and reuse
results by exact contract/input within the same job, with publication fences for
source and sense state and, for promotion, resolved identities and inspected cues.

Sense establishment reuses existing inventories or authored bootstrap uses before
requesting a sense-only generation call. It does not regenerate teaching or
practice content as a side effect. Mapping and generation retain evaluated source
versions and invocation provenance; publication is fenced against changed sources
and maintenance controls. A mapped sense explains authorial intent, not what the
learner was necessarily told by the original cue.

See [worker routing and retry controls](../vocabulary-learning.md#background-work-and-operator-repair)
for model selection, provider gates and preparation retry budgets.

## Invocation policy

Accumulated spend does not gate backend content-improvement calls or change their
selected model, including when work carries a requesting learner's context.
Individual reflection jobs retain their selected arm across stages and retries.
Provider invocation records retain usage, reported or estimated cost, and unknown
costs for inspection. Operator authorization, validation, explicit failure retry,
worker concurrency and leases, and provider request/output limits apply independently
of spend. The retained manual correction API (`/api/operator/content-improvements`)
does not invoke a model.

## Dictionary fallback publication scope

Corpus dictionary fallbacks and the repertoires generated from them are shared
authored study content. New fallbacks use a stable shared identity per word, skill
and role. Existing learner-specific fallback identities remain usable to preserve
deactivation and retirement. Composition chooses one stock fallback for each
objective and excludes duplicate stock copies from the shared pool. Authored
variants remain ordinary candidates.

### Compatibility for migration 0058

Migration `0058_shared_dictionary_baselines` positively identifies stock
dictionary fallbacks by their service origin, original identity and unchanged
authored body, assessment and answers. It appends a scope-only shared content
revision while retaining the original identity and historical snapshots.
Unresolved service-generated repertoires whose entire proposal still matches
those source versions receive a new shared proposal revision and updated bases.
Operator-edited proposal revisions are retained for manual reassessment.
Prior approvals and opinions remain bound to the earlier revision; fresh review
is required. Assessed-source provenance retains the version actually examined.
Resolved proposals, edited fallbacks, private imports and unrelated proposals
are retained as recorded. Skipped or substantively stale proposals still require
manual reassessment.

An old encounter can resolve to the audited scope-only successor during review.
This permission requires the migration's revision attribution and unchanged
authored material; a subsequent authored edit retains the normal drift fence.
Encounter evidence, learner state, provider results and stage caches remain
immutable. A second opinion is advisory and does not regenerate a proposal.
The migration makes no provider calls and applies no proposed content.

## Updating the picture

The [rendering source](../diagrams/render-content-improvement-flow.py) keeps layout,
labels, and colors editable. Regenerate the checked-in PNG with Python and Pillow:

```sh
python3 docs/diagrams/render-content-improvement-flow.py
```

The renderer uses Arial on macOS or DejaVu Sans elsewhere; `--font` and
`--bold-font` accept alternate TrueType font paths. Inspect the rendered image
when changing labels or routing, and keep this explanation aligned with it.
