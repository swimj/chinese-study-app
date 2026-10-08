# Generating and publishing word content

Before a learner meets a new Mandarin word, the application prepares meanings
and examples, an introduction that explains the word, and exercises for recalling
it. The resulting material is shared across learners. Preparation happens in the
background so the learner can study already-prepared content.

This guide explains how that material is generated, validated, retained through
failures, and published as a complete package. The
[feature contract](../SPECS/word-bootstrap-and-introduction.md) defines the intended
content and preparation guarantees. [Word content data representation](word-content-representation.md)
explains the objects this workflow produces. [Serving word content](word-content-serving.md)
explains how learner activity requests preparation and how sessions use the
available result.

## One source, two authored components, one package

The workflow separates source material from the experiences built around it:

- A **word content document** is a shared, immutable lexical snapshot with
  selected uses, notes, and examples. Bootstrap generates it from the stored
  word's written forms, pronunciation, and corpus meanings.
- A **teaching package** pins that exact document and contains both the ordered
  introduction and its practice exercises, called **target rehearsals** in the
  data model.
- A **component** is one independently generated part of that package: teaching
  beats or practice rehearsals. A teaching beat groups content revealed together
  as the learner advances through the introduction.

```text
stored lexical word -> bootstrap -> immutable word content
                                    | full document -> teaching beats --+
                                    +-> word + uses/notes -> rehearsals -+-> teaching package
```

Teaching and practice use the same source document, without receiving each
other's output. Teaching can show a natural source sentence and explain its
use; practice can choose a compact English cue or author a short Mandarin phrase
cloze for retrieval. A good example therefore need not double as a good recall
prompt. Separate authoring still produces one package, as defined by the
[package contract](../SPECS/word-bootstrap-and-introduction.md#4-introduction-and-practice-form-one-package).

## Authoring and validation

The [provider](../server/word-content/provider.ts) sends the complete bootstrap
document to teaching. For practice, it removes the structured `examples` array
and each use's `exampleIds`, retaining the document identity, word, use labels,
and notes. The practice wire accepts `direct_text` and `phrase_cloze`; the domain
representation also supports source-backed `example_cloze` in existing packages
and imports.

The [teaching prompt](../server/word-content/prompts/teaching.md) asks for depth
suited to the word. A familiar concrete meaning can have a direct explanation
and brief example; a construction or literary expression may need more context.
The [practice prompt](../server/word-content/prompts/practice.md) asks for a small
set of clear retrieval associations. These are editorial instructions to the
provider. Deterministic validation checks structure and source references,
not the pedagogical quality of the output or whether every practised meaning
was developed in the teaching beats.

[Normalization](../server/word-content/authoring.ts) validates teaching references
against the exact content. For practice, it supplies the `target_rehearsal`
contract, `hanzi_entry` response mode, and the pinned word's accepted forms.
The model authors the stimulus; the application defines which word is accepted.
Generated rehearsals store an empty instruction and are rejected when their
visible stimulus exposes an accepted Chinese form. Package parsing and
materialization recheck the assembly before publication.

## Retaining work without exposing a partial lesson

The durable work journal has a `bootstrap` stage followed by a `teaching` stage.
Inside the teaching stage, [shared preparation](../server/word-content/shared-preparation.ts)
runs the two component calls concurrently under the same expiring claim. Each
normalized success is saved separately. Its provenance records the model and
available provider invocation ID, so the final package can identify the calls
that produced its two parts.

A retained component is addressed by the exact content ID, component kind, and
**generation key**. The provider computes that key from the prompt, output
schema, model, reasoning effort, output limit, and input-projection version.
A changed practice prompt therefore prevents reuse of a retained practice
component in an unfinished package while leaving a matching teaching component
reusable.

Shared preparation waits for both calls to settle before releasing a failed
attempt. If practice fails after teaching succeeds, teaching stays in storage
and no package becomes ready. A later attempt, including one in a new worker
process, reuses those beats if their content and generation key still match,
and calls only practice again. Both components share the teaching stage's
attempt budget.

The [worker](../server/word-content/preparation-worker.ts) polls every five
seconds by default, with two concurrent work stages. A teaching stage can make
two component calls within one worker slot. Each stage uses a five-minute shared
generation lease; its work journal records attempts rather than granting a
second publication claim. Restart recovery recognizes already-published success
or consumes the interrupted attempt. Three failed attempts exhaust the shared
word/stage budget, with increasing retry delays. Successful earlier stages and
saved components survive.

Provider-wide failures back off the worker. If both components fail, a
provider-wide failure takes precedence over a companion validation failure so
that backoff still applies. Maintenance/provider controls pause work without
spending attempts, and shutdown drains active work. The
[diagnostics guide](ops/error-diagnostics.md#shared-word-preparation-failures) explains how
operators inspect exhausted work and authorize a retry.

## Publication and availability

The [persistence boundary](../server/db/word-introductions.ts) fences component
reads and writes by the live teaching lease and active source identity. Once
both components are available, a single transaction inserts the validated
package, its shared publication, both component-provenance links, and the
readiness pointer. A stale lease owner cannot publish, and consumers cannot
select a half-assembled package.

The records have distinct responsibilities:

| Record | Responsibility |
| --- | --- |
| `word_content_documents` | Immutable source document and its lexical identity |
| `word_teaching_packages` | Immutable introduction and rehearsals, with an exact source reference |
| `word_introduction_preparation` | Per-word readiness and active generation lease |
| `word_introduction_components` | Normalized teaching/practice payloads and invocation provenance, keyed by source, kind, and generation key |
| `word_teaching_package_components` | Links from a published package to its retained components |

Application-authorized validated content and packages enter the shared registry
as `shared_trial`, with an attributable publication event. The authored content
contains no learner identity. The worker records a requesting learner separately
for attribution; it generates from stored lexical material and creates no
private package pin or study credit.

Generation keys govern reuse while a package is being prepared. An already-ready
package is reused after a prompt change without regenerating its components.
Existing packages remain readable without component-provenance rows.

Quarantine or retirement removes a document or package from future eligibility.
Withdrawing a source also makes its dependent package unavailable for serving.
Prepared-but-withdrawn content remains stored; ordinary demand does not replace
or regenerate it. [Serving](word-content-serving.md#selection-and-withdrawal)
explains what that means for a learner's private pin and fallback.

## Relationship to local authoring and review

The [local lab](word-introduction-lab.md) uses the same provider and representation,
but saves local draft envelopes rather than shared publications. It calls
teaching and then practice, saving only their complete assembly. It does not
retain successful components across a failed package-generation attempt.

Ordinary review has a separate authoring stage using the bootstrap source.
The first durable study commit requests it asynchronously; preparation or
opening an introduction does not. Review failure preserves usable teaching and
ordinary fallback. [Structured review content](structured-review-content.md)
explains those exercises, publication, and their reflection lifecycle.

## Evidence and limits

- [Provider tests](../tests/word-content-lab-provider.test.ts) check distinct input
  projections and output schemas with injected transport responses.
- [Authoring tests](../tests/word-content-authoring.test.ts) exercise independent
  normalization, invalid references, answer leakage, and package assembly.
- [Worker tests](../tests/word-preparation-worker.test.ts) exercise either
  component failing, reuse by a fresh worker, and provider-wide failure precedence.
- [Persistence tests](../tests/word-introduction-persistence.test.ts) exercise
  lease/source fencing, immutable component identity, and the two component links
  required by the split-generation publication path.

These tests establish structural and state-transition behavior under fixtures.
They do not measure generated teaching or cue quality. The
[schema-migration guide](ops/schema-migrations.md#introduction-component-retention-0029)
contains the upgrade requirements for component retention and provenance.
