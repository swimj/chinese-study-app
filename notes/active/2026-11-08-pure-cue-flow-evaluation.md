# Shared-practice nomination and pure-cue realization trial

This record explains the prompt design, comparison method, and bounded evidence
for the November 8 pure-cue flow rework. It is review evidence, not a general
content-quality benchmark or an authorization to repair hosted content.

## Design before wording

The baseline is deployed source `8b3f0aa1e2adce8173cfc3767ceb6b717c8cece3`.
Read-only inspection of that production image confirmed the offered choices:
Luna high (`openai:gpt-6-luna-high`), Sol high (`openai:gpt-6-sol-high`), and
GLM-5.3 Flash high (`zai:glm-5.3-flash-high`).

Single improvement's overall flow is retained: understand encounters, develop a
coherent local recommendation, include useful optional enrichment, and communicate
a concise operator summary. Its shared-practice subsection remains the sole
judgment of whether shared practice is useful and what the words share. The wire
candidate is smaller: members, candidate cue, and rationale, with no final axis
or teaching note. Local source decisions and word-specific additions keep their
contracts. A poor shared purpose is a single-improvement quality problem, not an
invitation for integration to become another pedagogical judge.

Integration's flow changes from preserving an already completed draft to
understanding the nominated purpose, inspecting destinations, and realizing that
purpose through reuse, extension, or creation. It owns final stimulus, axis,
and teaching. All incoming members and the nominated meaning are preserved;
there is no rejection outcome. Existing cue axes and stimuli remain fixed during
reuse/extension. Destination compatibility requires both the same expressive
purpose and natural fit of every retained/incoming member to the actual stimulus.
Retrieval remains bounded to eligible overlapping membership; this change adds no
embedding search, canonical axis entities, cue merges, or repertoire cleanup.

The linguistic lineage is the pre-cutover
`server/reflection/prompts/archive/pure-cue-promotion-v1.md` (especially “An instinct,
not a category”), `server/reflection/prompts/pure-cue-promotion.md`, and
`server/reflection/prompts/pure-cue-reflection.md`, all present before cutover
`682d48dc`. They distinguish graspable meaning from physical scene, shared
instinct from category membership, and semantic scope from member teaching.
The candidate integration preserves their production-pattern reasoning,
meaning/construction boundaries, natural-fit judgments, accumulated teaching,
uncertainty boundaries, and worked patterns while adapting their authority.
Whole-repertoire reconciliation and source-fairness decisions belong elsewhere.

Substantive removals from the current prompts are the requirement for single
improvement to author final shared teaching, and integration's requirement to
preserve new upstream prompt/note verbatim. Historical authored plans remain
interpretable. Integration's older worked patterns are adapted to its new output
rather than discarded. A read-only independent first-principles review found the
responsibility split coherent and broader single-exercise behavior intact; two
stale teaching-note instructions were corrected before any provider outcomes.

## Evaluation approach

Eight synthetic fixtures cover four chained nominations and four fixed integration
inputs. Motivating cases, established useful constructions, and related cases
outside the worked examples are mixed deliberately. This is not held-out research:
scissors and the questionable fashion/apparel grouping came from the motivating
investigation; interruption and population are established prompt examples.
Human review expectations are recorded separately and withheld from providers.

The chains exercise a simple referent (scissors), a useful construction
(interruption), same-blank/different-referent ambiguity (fashion/apparel), and a
real sense boundary (population density versus event scheduling). Fixed
integration cases isolate same-purpose/different-scene reuse, extension retaining
a third member, same-word/different-sense separation, and fixed-construction
compatibility. A disputed naturalness judgment is review evidence rather than a
hard-coded gold label.

Each offered model gets baseline and candidate trials on the same fixture set,
one draw per case/variant. Chained integration runs only when single improvement
produces a structurally valid shared candidate. Fixed integration inputs expose
realization/dedup differences without upstream nomination changes. Baseline
schemas and prompts are frozen independently; candidate schemas have parity
checks against the live production exports. Runtime-owned source/lexical fences
and persistence are verified separately with database-backed provider-stub tests.

The runner retains exact prompt/user/schema/settings, adapter-rendered request
bodies without headers, provider responses, usage, hashes, and partial structural
validation. Manifest reservation prevents accidental repeat spending; provider
failures are retained and not silently retried. Production model configurations
are used. No application database is opened and no learner encounter data is sent.

Review considers expressive purpose, necessary versus incidental boundaries,
naturalness, nomination authority, destination fit, retained membership, useful
teaching, and preservation of local work. Structural validity is reported
separately from linguistic judgment. No aggregate lexical-quality score or
phrase-count heuristic controls revisions. Provider results should reveal real
issues; the weakest model is not the specification. Any subsequent prompt change
must have a general explanation rather than chase an individual fixture outcome.

## Results and limits

The initial comparison completed 69 provider calls, with no transport failures or
hidden retries. Structural/application guards accepted 65 outputs. The per-model
counts below are contract checks, not linguistic quality scores:

| Variant | Model | Calls | Guard-valid | Failure |
| --- | --- | --- | --- | --- |
| Baseline | Luna high | 11 | 11 | None |
| Baseline | Sol high | 12 | 12 | None |
| Baseline | GLM Flash high | 11 | 10 | Fashion single output omitted an additional-exercise rationale |
| Candidate | Luna high | 12 | 12 | None |
| Candidate | Sol high | 11 | 10 | Fashion candidate printed the accepted answer 服装 inside its visible stimulus |
| Candidate | GLM Flash high | 12 | 10 | Fashion integration omitted rationale; reason integration added an unknown field |

All three candidate models realized coherent interruption and population practice.
Their integration axes generally stopped binding interruption to a particular
phone bell or unrelatedness to the exact sentence frame. Population density stayed
separate from temporal concentration. All models/variants reused the existing
prohibition cue across different scenes, extended other/additional practice while
retaining its third member, and separated unrelatedness from reassurance. Those
destination decisions were already correct at baseline: this is preservation
evidence, not demonstrated deduplication improvement.

Two substantive concerns survived. Every first-pass candidate scissors axis
retained request/classifier scope: Luna “Asking for scissors using the 一把
construction”; Sol “Naming a pair of scissors when asking for one”; GLM “Naming
the cutting tool scissors in a request, compatible with the measure word 把…”.
This is a cross-model conceptual issue, not an instruction to accommodate the
weakest arm. Separately, all three candidate single outputs nominated the
fashion/apparel grouping from interest-slot or topical fit; baseline Luna and GLM
had declined it. The candidate did not reliably articulate a shared expressive
instinct beyond that fit. No reliable improvement or regression rate follows from
one draw, but the outputs do not establish that questionable nomination is solved.
Under the agreed authority this concern belongs upstream, not to an integration
veto. Luna's 时尚感 source refinement also merits lexical-unit review; GLM's
adjectival enrichment may leave the selected noun sense. The concern is broader
than whether the shared exercise is better than its flawed source.

Independent output reviews inspected all 24 single outputs and the integration
outputs separately. They found no lost retained-member guidance or integration
veto, but flagged GLM's fashion teaching as overclaiming near-synonymy and its
reason note as overstating construction restrictions. These are editorial
judgments with uncertainty, not hard-coded fixture gold answers.

## One reasoned integration follow-up

The shared scissors failure revealed a missing level distinction: the retrieved
word's semantic contribution versus the containing sentence's speech act and
grammatical realization. A general paragraph was added to integration's axis
reasoning. It asks the model to identify that contribution and retain construction
scope only when it defines the shared use. No particular example answer or ban
was added, and the single prompt and fixtures were not changed after outcomes.

The follow-up replays the exact previously saved candidate integration user
messages against all three models, under a separate variant. Single improvement
is not rerolled; cases without a prior integration request remain skipped. Original
outputs/failures are retained. This isolates the integration clarification and
cannot resolve nomination concerns. The replay completed 23 integration calls: Luna 8/8 guard-valid, Sol 7/7
(the original upstream fashion failure was skipped), and GLM 7/8 (scissors
omitted rationale). There were no transport failures or hidden retries.

Luna's scissors axis became “Naming the hand tool used for cutting”; Sol's
became “Naming scissors, the handheld cutting tool.” GLM foregrounded the
referent but appended request/measure-word context: “Naming the scissors as an
object … including in requests using the measure word 把.” That output was
structurally invalid. The clearer lexical-contribution principle is retained
because it expresses the intended model generally, with bounded support from
the replay; it is not a reliability guarantee. Luna also weakened the visible
scissors frame to “The hand tool used for cutting,” which can admit other tools;
this is not an unqualified improvement in stimulus quality. GLM retained incorrect
服装 pinyin in its fashion note and described temporal-density practice as separately
available, potentially presuming optional enrichment is applied. These remain
review findings rather than triggers for fixture-specific prompt patches.
Destination choices and meaningful population/unrelatedness boundaries were
preserved in these samples. An independent check verified all 23 replay user
messages are byte-for-byte identical to their original candidate messages.

No further prompt changes were made after replay. Fashion/apparel remains a
questionable upstream nomination; integration correctly preserves that decision
rather than secretly vetoing it. GLM's schema/teaching weaknesses remain visible.
This is an experimental draft for review, not a claim that either nomination or
axis quality is solved.

A [compact output record](2026-11-08-pure-cue-flow-results.json) retains model,
variant, prompt/fixture hashes, nomination summaries, axes, and validation errors.
Exact full requests/responses/wire bodies and reviews remain in the local
`tmp/pure-cue-flow-eval-2026-11-08` archive. It contains synthetic data only.

## Verification limits

The experiment cannot establish production learner outcomes, general reliability,
or the quality of every non-pure repair/enrichment decision. There is no UI redesign in this
change; rendered UI evaluation would not establish the prompt behavior in question.
Historical post-cutover content audit and manual repair proposals remain separate;
this trial does not apply or authorize them.

## Implementation verification

The full regression suite passed 2,672 tests with zero failures, five skips and
one TODO; build passed. The first sandboxed full-suite attempt was stopped after
listener-based tests were denied local sockets; the successful run had socket
access. Replay and exact-reference guard additions subsequently passed their
focused harness checks. Trial schemas match active runtime schemas, and checking
all retained original outputs after the reference-validator fix changed no result.
The database-backed tests cover current two-stage output, unchanged local plans,
privacy/answer leakage, preserved extension/reuse content, historical authored-plan
continuation, and versioned stage evidence. No schema migration or hosted content
repair was performed.
