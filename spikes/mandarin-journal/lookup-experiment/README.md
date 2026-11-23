# What should a Mandarin lookup underline?

Open [the recorded comparison](replay/index.html) in a browser from this checkout. Choose a tap or selection, then replay the completed-answer wait or show both answers immediately. Model names can be revealed after reading. The replay runs offline. The reader itself still uses its six authored lookups.

## Select a sense for a fixed occurrence

The follow-up [sense comparison](replay/index.html?senses) keeps the underlined text identical across three cards. The instant reminder is an editorial, context-free label for the spelling. Gemini 3.5 Flash Lite selects from precomputed senses, and GPT-6.2 Sol writes a contextual gloss. Choose “Replay measured wait” to compare the recorded response times. A selector abstention has its own card. An eventual fallback to Sol would add a second call to the elapsed time.

The [sample catalog](sense-catalog.sample.json) has 8 headwords, 9 entries by pronunciation and 14 senses. Five headwords take their labels and usage notes from the app's [retained sense-authoring comparison](../../../scripts/fixtures/sense-inventory-review.json). The others are authored fixture entries. IDs are local to the sample. A spelling can find several entries across readings, and simplified and traditional spellings can resolve to the same entry. Each sense belongs to one entry and has its own ID, label and optional notes. Source population, editing and database storage are open decisions.

The journal can use the same server-side functions as the experiment. The dictionary returns the exact UTF-16 occurrence when segmentation agrees, even if the raw dictionary gloss is ambiguous. Pass its spelling to the catalog and supply the resulting candidates and the original occurrence to the selector. A deliberate selection can supply its own occurrence. The selector returns an original candidate or null. Empty inventories defer locally. Transport failures propagate separately. The journal reader still uses its authored lookup interaction. [Dictionary](../reader-dictionary.ts) · [Catalog](../reader-catalog.ts) · [Selector](../reader-sense.ts)

On 14 fixture passages the selector made 12 expected decisions, comprising nine correct selections and three correct abstentions. It got the literal and financial uses of 泡沫 and both uses of 不堪. When the financial sense was removed it abstained. It chose huán for both occurrences in 还没还 and treated 与 inside 授与 as the standalone grant sense. Sol distinguished those occurrences and explained the compound boundary. For 报刊亭 the instant reminder and selected label both read “newsstand.”

Median complete response was 0.713 s for selection and 1.998 s for a contextual gloss. OpenRouter reported $0.0017812 total for the 14 selection calls. These are single observations per arm and passage with a preloaded inventory. Two probes (垂危 and 有所改善) echo worked examples in the selector prompt. This set measures routing behavior, while the replay leaves the usefulness of each answer to the reader.

The selector adapts the exercise [sense-mapping prompt](../../../server/vocabulary/reflection-prompts/sense-mapping.md) from revision 9db9a896. It retains lexical ownership, contextual evidence, rare uses and missing senses. The source is now a passage occurrence instead of an exercise. Both missing and unresolved uses return null. The caller displays the stored label and pronunciation, so the model returns only a supplied reference or null.

From the journal directory, run each arm with the appropriate provider key and a new output filename, then export the replay.

```sh
node --env-file=/path/to/keys.env lookup-experiment/sense-run.ts selector .local/senses/selector.jsonl
node --env-file=/path/to/keys.env lookup-experiment/sense-run.ts context .local/senses/context.jsonl
node lookup-experiment/export-senses.ts .local/senses lookup-experiment/replay/senses.js
```

## November 23 experiment

The 24 [frozen cases](cases.ts) comprise 12 single-character taps and 12 deliberate selections. Eight excerpts come from the two demo stories. Sixteen additional probes test ordinary words, overlapping compounds, exact idioms, polyphonic characters, incorrect selections and longer constructions. Each model saw the same gesture, occurrence and surrounding text. The cases declared acceptable tap spans and a teaching intention before generation. The router and providers received neither scoring key.

| Method | Taps with an accepted span | Selections preserved | Median completed lookup | Slowest |
| --- | ---: | ---: | ---: | ---: |
| CC-CEDICT, already loaded | 2/12 | 4/12 | 0.017 ms | 0.302 ms |
| Gemini 3.5 Flash Lite via OpenRouter, minimal reasoning | 9/12 | 12/12 | 0.75 s | 1.09 s |
| GPT-6.2 Sol via OpenAI, medium reasoning | 12/12 | 12/12 | 2.41 s | 5.55 s |

The dictionary deferred on its other 18 cases. All six answers gave a relevant reading and gloss. One call per model per case, issued sequentially within each arm with the arms running concurrently. Both models completed all calls. The pilot call to each model on the newsstand is excluded. Timing covers network, generation and validation. Local timing covers both the decision and any lookup after loading the dictionary. These are deliberately challenging examples from one run, with no measured learner traffic, phone latency or cache-hit rates.

## How to route a gesture

**Tap.** Start at the touched character. Segment its contiguous Han run using longest dictionary matches from each end. Use a local answer when both passes agree on the containing span and its entries yield exactly one pronunciation and one usable gloss field. Ignore classifier metadata and defer on references or bound forms. This is a reproducible threshold, with no calibrated probability attached. A gloss field can contain several paraphrases. It correctly offered 报刊亭 and 螺丝刀 instantly, and deferred on 鸭 because the entry has more than one gloss.

When that test defers, send the occurrence in its sentence to the stronger model. Ask for a span the reader could recognize or reuse in this passage. In 深蓝，乍一看像黑的, Justin preferred the reusable 乍一看 over just 乍 after seeing the two possibilities. Both passed the predeclared boundary rubric. Treat this as a teaching preference for future comparisons. A standalone 还 can still be exactly the right size. While waiting, the proposed reader would acknowledge the tap immediately, keep the text still and let the reader move on. A late reply would only appear if that lookup were still open.

**Manual selection.** Keep the selected text and its occurrence. An exact dictionary entry passing the boundary and reading tests can answer a short word such as 车票 or the entire saying 聪明反被聪明误. For a deliberate lookup that defers, ask the model for meaning in context. Show internal groupings when they explain how the sentence works. A selection across 研究 | 生命 calls for explaining the two surrounding words. The learner's highlight and saved quote stay intact. Pressing Save with or without a note records the quote immediately.

## Where answer quality diverged

- On taps, Flash Lite returned 报刊 inside 报刊亭 and 螺丝 inside 螺丝刀. A local-first route would avoid both errors here. With 听着听着 it chose 听, losing the continued action. Sol recovered the construction, although its two identical 听着 chunks added little.
- Flash Lite pronounced 还 as hái on both “return the umbrella” probes, even when it translated the verb correctly. Both models successfully distinguished 生命 from 研究生 for taps on 生. On a selection of 究生 inside 研究生命, Flash Lite supplied the unrelated graduate-student reading. Sol explained exactly where the selection crossed the boundary.
- In 青绿色的铁皮被雨冲得发白, Flash Lite gave fǎ bái and grouped 得 with the preceding verb. Sol gave fābái and explained the result with 得发白. For 把会议推迟到周五, Flash Lite supplied a translation, while Sol also explained what 把 and 到 contribute.
- On the longer listening selection, Sol conveyed the transition clearly. Its second group 也跟着唱了起来 leaves an opportunity to teach 跟着 and 唱了起来 separately. Chunks that reconstruct a quote perfectly can still be pedagogically weak.

The first reader trial should compare instant local answers plus Sol on unresolved deliberate lookups against how long readers are willing to wait. The faster arm established a real latency advantage. Its errors on exactly the ambiguous cases that reach the fallback make it a poor default there on this evidence. The replay retains all answers, including straightforward cases where Flash Lite worked well.

## Reproduce

From the journal spike directory, install dependencies as described in the [journal runbook](../RUNBOOK.md). Set LOOKUP_DICTIONARY to an extracted CC-CEDICT v1 text file. The snapshot used 125,413 entries, published November 14, 2026, SHA-256 `3532048c5c434b1be952b327082d71e1957099db8e6d6e531722643f75fd308b`. The recorded dictionary excerpts retain the source license. Tone marks were converted from numbered pinyin. [CC-CEDICT, published by MDBG](https://www.mdbg.net/chinese/dictionary?page=cc-cedict) · [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/)

```sh
npm run lookup:eval -- local .local/comparison/local.jsonl
node --env-file=/path/to/keys.env lookup-experiment/run.ts fast .local/comparison/fast.jsonl
node --env-file=/path/to/keys.env lookup-experiment/run.ts strong .local/comparison/strong.jsonl
node lookup-experiment/export-replay.ts .local/comparison lookup-experiment/replay/results.js
```

The fast arm uses OPENROUTER_API_KEY and the strong arm uses OPENAI_API_KEY. LOOKUP_FAST_MODEL and LOOKUP_STRONG_MODEL override the defaults. An explicit LOOKUP_FAST_PROVIDER=openai selects the direct OpenAI adapter for a different experiment. Each invocation requires a fresh output filename. Append one case ID to pilot an arm. Raw JSONL includes exact requests, provider responses, errors and elapsed time. Only the shareable fixture answers and timings are exported to the replay.

The lookup prompt adapts the journal's contextual teaching in situations/core.ts, situations/ask.ts and situations/word-intake.ts as of 78c91f1a. It retains judgment about compound boundaries, contextual senses and pragmatic meaning. This one-shot call omits journal history, practice actions and follow-up dialogue. OpenRouter's latency-sorted provider preference is distinct from the client’s completed-response measurement. [Model details](https://openrouter.ai/google/gemini-3.5-flash-lite) · [Provider routing](https://openrouter.ai/docs/features/provider-routing)
