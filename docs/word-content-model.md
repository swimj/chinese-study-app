# Word content model: executable checkpoint

This implements the representation and materialization portion of
[Word Bootstrap, Introduction, And Early Rehearsal](../SPECS/word-bootstrap-and-introduction.md).
It is a model checkpoint, not a released learning flow. It does not migrate
SQLite, call a provider, publish shared content, or alter session scheduling.

Run the six worked examples and old/new review coexistence:

```sh
npm run inspect:word-content
npm run inspect:word-content -- --json
```

The CLI has no database or network access. It uses synthetic fixtures derived
from the teaching explorations, not an export of learner data. The JSON report
includes source identities and frozen presentations; it is diagnostic output,
not a new persistence envelope.

## The two authored documents

Shared types live in [src/domain/word-content/types.ts](../src/domain/word-content/types.ts).
Strict parsers in [validation.ts](../src/domain/word-content/validation.ts) read
unknown JSON, reject unknown properties and invalid structures, and return
detached, deeply frozen values. Materialization validates cross-document refs.

**WordContentDocument** has an immutable document ID and a lexical snapshot
(`wordId`, `hanzi`, `traditional`, `pinyin`). It contains local use IDs and
example IDs. Uses have a label, optional-in-content notes (an empty array when
unneeded), and example references. Examples contain text, translation, and
nullable pronunciation. An example can belong to more than one use. There is
no collocations field, schedule, accepted-answer set, or publication state.

**TeachingPackage** pins `wordContentId`. It contains ordered beats and at least
one target rehearsal. Every beat has an ID and one or more parts:

- authored text;
- a referenced example's sentence, translation, or pronunciation;
- a referenced use note.

The whole beat advances together. Multiple parts allow a sentence and pinyin,
or a small question with context, to share a beat. Reflection questions are
ordinary authored text; they do not create an assessment or wait for a reply.
Use-note indices are stable within the immutable source document. Package
example refs are local to that document; no “latest” lookup exists.

These documents can be serialized independently. Materializing a package
requires its exact source document. The catalog may contain multiple documents
for the same word, but duplicate document IDs are rejected instead of choosing
one by insertion order.

## Stimulus and exercise are separate

A stimulus is one of:

```ts
{ kind: 'direct_text', text: string }
// or
{
  kind: 'example_cloze',
  example: { contentId: string, exampleId: string },
  blanks: Array<{ start: number, end: number, expectedText: string }>,
  frame: string | null
}
```

Offsets are half-open **Unicode code-point** offsets. Blanks are ordered,
non-overlapping, nonempty, and checked against the referenced text. Recording
`expectedText` makes drift or an incorrectly selected occurrence an error.
Repeated target occurrences and supplementary-plane characters do not require
substring guessing. Materialization replaces exactly those spans with `____`.
A non-null frame precedes the cloze on its own line.

The associated exercise records an ID, `hanzi_entry` response mode, instruction,
accepted word IDs/forms, and one explicit contract:

| Contract | Ownership and answers |
| --- | --- |
| `target_rehearsal` | One owner and exactly its answer; nonempty instruction |
| `targeted_review` | One owner and exactly its answer |
| `pure_review` | Semantic-axis note, no owner, explicit accepted members |

The model never derives an answer space from the example. Hidden text in a
structured exercise must be an explicitly accepted form. A source sentence
can therefore remain whole in teaching while its rehearsal and review
interpretations differ. Direct text remains useful for definitions and
situations; it is not automatically deprecated by the structured alternative.

V1 has one typed response. In a multi-blank exercise that response fills every
gap with the same word; all source blanks must be forms of one accepted word.
Exercises requiring different answers in different gaps need a future response
contract. Authors should make the repeat-in-every-gap instruction explicit.

Package rehearsals must target the pinned word and use its exact answer forms;
their example clozes must reference the package's content document. Standalone
exercises can refer to other documents explicitly. New contrast-choice
authoring is not implemented in this checkpoint; it will need choices and a
selection contract rather than abusing the typed-answer contract.

## Materialization and matching

[materialize.ts](../src/domain/word-content/materialize.ts) resolves references
into detached, frozen presentation snapshots. The package snapshot retains its
package/content IDs and ordered source-labeled parts. Each rehearsal retains
its intent, instruction, answer forms, source stimulus, rendered text, and
matching profile. Example source references remain available even after
rendering to text.

`resolveContentExerciseResponse` delegates to the existing profile-aware answer
matcher and returns only acceptance and matched word identity. It awards no
coverage, review interval, graduation credit, or reflection eligibility.
The package path is Mandarin; the review adapter retains the existing matcher
profile for compatibility. There is no new multilingual feature promise.

An exercise ID inside a package is scoped to that package; future durable
events must retain the enclosing package ID as well. The package materializer
does this at the enclosing snapshot level. Standalone review identity is
retained separately in the compatibility wrapper. This checkpoint does not
introduce a study-event ingestion route.

## Existing cues and supplements coexist

[review-compat.ts](../src/domain/word-content/review-compat.ts) provides explicit,
pure adapters without changing existing DTOs or tables.

| Existing representation | Checkpoint representation |
| --- | --- |
| Cue text (any current cue type) | Opaque `direct_text`; no parsing or rewriting |
| Task/cue identity and cue type | Separate exact review metadata |
| Accepted answer snapshot | Copied frozen answer forms under `targeted_review` |
| Existing post-reveal supplement | Copied supplement snapshot with original ID/fields |
| New example-backed supplement | Exact example reference plus its own ID and English frame |

Legacy snapshots roundtrip to the current `ProductionExerciseSnapshot` shape
without changing text, answers, cue/fallback identity, or supplement fields.
Cloze-looking legacy text remains opaque, including mixed-language framing or
multiple blanks. The adapter enforces current strict target-only ownership;
it is not a migration path for obsolete multi-answer word-owned cues.

New targeted review can also materialize into that existing shape. It requires
explicit task and durable cue identity. Structured clozes use `minimal_context`;
post-reveal supplements retain their existing definition-gloss-only boundary.
The compatibility export rejects rehearsal and pure-review contracts. It also
rejects a separate nonempty instruction, because the old DTO has nowhere to
preserve it. Review framing belongs in the stimulus until that boundary evolves.

The wrapper retains new source references, but the old DTO does not. Export is
therefore a presentation/matching compatibility seam, not proof of a completed
provenance migration. Actual review publication/serving integration will need
to persist those references (or retain this wrapper) before relying on them for
custodial analysis. Existing live serving does not call these adapters yet.

## What the fixtures establish

[tests/fixtures/word-content.ts](../tests/fixtures/word-content.ts) represents all
six explored words: 报备, 藤椒, 泡沫, 不堪, 石沉大海, 为所欲为. The model handles
multiple uses, literary parsing, independent translation beats, contextual
notes, private questions, and direct-text or source-backed rehearsal without
adding special per-word schemas.

Focused tests cover JSON roundtrips, reference validation, repeated occurrences,
Unicode spans, source drift, snapshot detachment, explicit answer contracts,
old/new review matching, and supplement provenance. A replacement content
document can coexist with the old one without changing a pinned package.

## Convergence path and remaining limits

1. Persist these documents as immutable records with unique IDs and source
   relationships. Freezing JavaScript objects prevents mutation in this slice;
   storage-level immutability, attribution, and publication eligibility are
   still to be implemented. Do not mistake a parsed document for published
   content or reuse its ID for a changed body.
2. Author structured new content directly. Reflection can initially continue
   emitting current cue/supplement shapes. No old cloze-to-sentence conversion
   is necessary to use the new model.
3. When reflection emits structured examples/clozes, retain source references
   alongside the existing cue identity and lifecycle. An optional conservative
   legacy conversion may recover simple examples; ambiguous stimuli remain
   text. Pure cues cannot be filled with one hidden “correct” target to recover
   a canonical sentence.
4. Move new supplements to example references when useful, preserving exact
   cue attachment and their own framing. Retain old snapshots for history.
5. Use deliberate custodial revision to align teaching and review discoveries.
   The current model does not build a replacement graph or automatically swap
   packages. Global sentence deduplication can wait until reuse justifies it.

Persistence/publication, provider authoring, UI, package selection, and study
progress policies are the next integration layers. They need not change the
core separation demonstrated here. No production database access was needed.
