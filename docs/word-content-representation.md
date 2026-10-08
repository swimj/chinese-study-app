# Word content data representation

Learners encounter a word through meanings, examples, an introduction, and recall
exercises. Those presentations can share source material while asking different
things of the learner. The application needs to retain both the source of what
was shown and the answer contract of the particular exercise.

This guide explains how that learner-facing content is represented: immutable
source documents and teaching packages, exercise stimuli and accepted answers,
and the frozen snapshots used for presentation. It also explains how structured
review content coexists with older cues. The [feature contract](../SPECS/word-bootstrap-and-introduction.md)
defines the intended content model. [Generation](word-content-generation.md)
explains how these objects are authored and published;
[serving](word-content-serving.md) explains their use in study sessions.

## Source documents and teaching packages

Shared types live in [src/domain/word-content/types.ts](../src/domain/word-content/types.ts).

**WordContentDocument** has an immutable document ID and a lexical snapshot
(`wordId`, `hanzi`, `traditional`, `pinyin`). It contains local use IDs and
example IDs. Uses have a label, optional-in-content notes (an empty array when
unneeded), and example references. Examples contain text, translation, and
nullable pronunciation. An example can belong to more than one use. There is
no collocations field, schedule, accepted-answer set, or publication state.

**TeachingPackage** pins `wordContentId`. It contains ordered beats and at least
one target rehearsal. The package contains both the introduction and its
practice exercises, even though they are generated independently. Every beat
has an ID and one or more parts:

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
// or: an authored phrase, with no source-example reference
{ kind: 'phrase_cloze', frame: string, text: string }
// or: blanks selected from an exact source example
{
  kind: 'example_cloze',
  example: { contentId: string, exampleId: string },
  blanks: Array<{ start: number, end: number, expectedText: string }>,
  frame: string | null
}
```

A `phrase_cloze` carries its own frame and phrase, for example English
“Give advance notice.” with Mandarin “来之前先____。”. The parser requires a
nonempty frame, exactly one `____` blank, and surrounding phrase text. Exercise
validation rejects visible accepted Chinese answer forms in its instruction,
frame, or phrase. Materialization joins frame and phrase on separate lines
without looking up a source example.

An `example_cloze` instead retains a source reference and chosen spans.
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
| `target_rehearsal` | One owner and exactly its answer |
| `targeted_review` | One owner and exactly its answer |
| `pure_review` | Semantic-axis note, no owner, explicit accepted members |

An instruction may be empty; content-specific wording stays with the exercise,
while generic task framing belongs to the presentation layer.

The model never derives an answer space from the stimulus. Hidden spans in a
source-example cloze must be explicitly accepted forms. A source sentence
can therefore remain whole in teaching while its rehearsal and review
interpretations differ. Direct text remains useful for definitions and
situations; it is not automatically deprecated by the structured alternative.

The current response contract has one typed response. In a multi-blank
source-example cloze that response fills every gap with the same word; all
source blanks must be forms of one accepted word. An exercise's instruction can
make that repeated use explicit. Authored phrase clozes have only one blank.

Package rehearsals must target the pinned word and use its exact answer forms;
their example clozes must reference the package's content document. Standalone
exercises can refer to other documents explicitly.

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
Teaching packages materialize with Mandarin matching. Standalone review
snapshots retain their matching profile through the compatibility adapter.

An exercise ID inside a package is scoped to that package. The enclosing
package snapshot retains the package ID, so consumers can identify which
exercise was shown even when another package uses the same local exercise ID.
Standalone review identity is retained separately in the compatibility wrapper.

## Existing cues and supplements coexist

[review-compat.ts](../src/domain/word-content/review-compat.ts) provides explicit,
pure adapters without changing existing DTOs or tables.

| Existing representation | Domain representation |
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
provenance migration. The [structured review integration](structured-review-content.md) now persists
canonical exercises and their exact source documents alongside durable cue IDs.
Live readers rematerialize these records through the adapter while retaining
legacy lifecycle/evidence compatibility.

## Validation and evidence

The strict [parsers](../src/domain/word-content/validation.ts) read unknown JSON,
reject unsupported properties and invalid structures, and return detached,
deeply frozen values. Materialization then checks relationships that require
source documents: referenced examples and notes exist, blank spans match their
source text, and package rehearsals use the pinned word and its exact answer
forms. Duplicate document IDs fail rather than choosing a source by insertion
order.

[Domain tests](../tests/word-content.test.ts) exercise roundtrips, references,
Unicode spans, source drift, snapshot detachment, and explicit answer contracts.
They also check phrase clozes without a source example, malformed blanks, missing
frames, and exposed answer forms.
[Compatibility tests](../tests/word-content-compat.test.ts) cover old/new review
matching and retained supplement identity. These checks establish representation
and matching behavior; they do not assess whether a generated explanation or cue
teaches the word well.

The [worked examples](../src/features/introduction-lab/samples.ts) represent six
words with multiple uses, literary parsing, independent translation beats,
private questions, and direct or source-backed rehearsal using the same types.
The [inspection procedure](scripts.md#inspect-word-content-fixtures) shows how to
examine their objects and frozen presentations locally.
