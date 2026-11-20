# Default sense selection through Decisions, November 20, 2026

We tested switching the standalone selector to one Decisions predicate per supplied sense. Each predicate saw the entire, unchanged production inventory. The release candidate kept eight worked inventories and added two brief contrasts about reading the Chinese evidence. It selected only “rear-end collision” for 追尾 and only “dismiss an employee” for 解雇. These two words were known development cases.

## Comparison

We reran the v7 Chat Completions request from revision `5972e933` with high reasoning, strict JSON output and the current specialized-word policy. We also ran the v7 prompt through Decisions with just its closing output instructions adapted. The two Decisions arms used the same model, inventory, predicate question and inclusive 0.50 cutoff. The release rubric is the developer message; the user message contains the inventory as JSON. Each named predicate asks whether its ID belongs to the default useful subset. Keeping the question short lets every predicate use the same editorial criteria. The provider recommends observable criteria, shared input for independent questions and testing thresholds against application labels. [OpenAI Decisions guide](https://developers.openai.com/api/docs/guides/decisions)

We used inventories saved from completed production selector requests in the November 18 snapshot. The 15 development words included the two requested changes, single and multiple defaults, a genuinely empty recommendation, and the sole eligible surname in a mixed inventory. The next 20 words were outside the earlier 36-word spike and included analogous grammatical cases. They served as an initial holdout for an intermediate candidate. After seeing its results we used them for refinement. A final 16 production words were disjoint from both groups and the November 18 spike. We reserved them before the final revisions and scored them once the release prompt and threshold were fixed.

The evaluator wrote acceptable selections before each group's first request. These are agent editorial judgments informed by the user's stated preferences. For 故障, either the broad malfunction sense alone or both it and the software sense earned credit. Exact match requires the complete unordered ID set to equal an accepted selection. We selected words to exercise distinctions; these counts characterize the trial cases.

| Arm | Development, 15 words | Refinement, 20 words | Final holdout, 16 words |
| --- | ---: | ---: | ---: |
| Current v7 chat | 13 | 14 | 12 |
| Full v7 rubric adapted to Decisions | 11 | 13 | 14 |
| Release Decisions prompt | 12 | 16 | 14 |

The holdout contained 30 sense decisions. Both Decisions variants added two entries the evaluator skipped. They agreed with each other on all 16 words. The release prompt used 39,305 total input tokens, compared with 50,409 for the full Decisions prompt. Median observed round-trip time was 198 ms for the release prompt, 189 ms for full Decisions and 2,014 ms for chat on the same client. Each arm ran once per word with up to three requests in flight. All 48 holdout calls returned a complete valid result.

## Prompt and threshold choice

On the original 15 words, very short versions (77–370 whitespace-delimited words) matched 9–10 complete sets. Some handled the reported passive or risk distinction but admitted compound-only and peripheral senses. An 814-word prompt with six worked inventories reached 12. An intermediate 1,026-word candidate reached 13 and declined both reported extra senses, but it omitted the productive suffix 兮兮 and added specialist readings of 乳液 and 五官 on its first holdout. We revised the relevant examples, retaining the short predicate question. The final 1,078-word guidance is about 35% shorter by this measure than v7 chat's 1,646 words.

The release prompt retains the worked inventories for 垂, 有所, 不堪, 函, 蜘, 双误, 藤椒 and 泡沫. The rewritten introduction gives contrasting Mandarin examples for an action versus a possible consequence and an active versus a regular passive use. Neither motivating target appears in those examples. It expands 有所's explanation to address productive particles and suffixes. It keeps room for useful settings, including technical uses when they are the only eligible sense. The separate examples for 过时, 报备, 石沉大海 and 为所欲为 were omitted. The remaining examples and prose cover the fixed-expression, shared-meaning, whole-idiom and register judgments, with less space devoted to social tone. Chat-specific JSON instructions and backend workflow narration were dropped from the rubric.

On the initial 15 development cases the release prompt matched 12 complete sets at each of 0.40, 0.50 and 0.60. On the 20 refinement cases those thresholds gave 14, 16 and 16. The motivating pairs both scored 1.00 for the primary sense and 0.00 for the extra sense. We retained the spike's 0.50 cutoff. Higher thresholds improved some development counts, but these few handpicked cases give limited evidence for sacrificing lower-confidence positive selections.

## Editorial findings

- Full Decisions included both supplied senses for each of 追尾 and 解雇. Current chat omitted the following-too-closely reading for 追尾 and kept the passive reading for 解雇. The release prompt omitted both extra entries. All three kept both 故障 senses.
- On the refinement cases the release prompt recognized the distinction between 质疑 and facing others' doubts, and between 在乎 and the effect of its negation. It kept the productive suffix 兮兮 and a specialized or literary sole use for 贸易顺差, 奥斯曼帝国 and 矣. It selected just the everyday sense of 乳液 and 五官.
- The nudge has limits. The candidate still treated “force yourself” as a separate default for 强迫 and the date/time examples as a separate use of 七. It also accepted both entries for 本末倒置 and 督促. On the final holdout, its two extra selections were the learning/training context for 循序渐进 and the stylistic use of 浮世绘. Each illustrates how editorial choices about contexts can differ.
- Compared with the final-holdout labels, chat also accepted the lower-priority “worn smooth” reading of 麻花 and skipped the physical binding sense of 束缚. A larger independently adjudicated sample would be needed to estimate quality on unsampled production traffic.

## Replay evidence

The originating checkout retains the local-only bundle in `artifacts/default-sense-decisions-2026-11-20/`. Its `dev.json`, `test.json` (refinement) and `final.json` contain the exact inventories and accepted sets. Each variant directory retains requests, raw responses and timings. `results.json` groups outputs by word. Inside this directory, run `python3 score.py chat-final full-final worked-final` to rescore the holdout offline. The release variant is named `worked`. The retained `run.mjs` issues live requests for a given split and variant, skipping saved results. To run a fresh comparison, use a private copy of the input JSON, prompt files and runner in an empty directory with project API credentials in the environment.

The v7 chat rubric SHA-256 is `8678212c4a0c7c833247ddfdc11ed8e30175bf7254e6fa6795b56bbc804201e0`. The release rubric SHA-256 is `c921642d51cb210d5ba3d023b0d3b1f1557a675e65243a67d584029e67b09e8b`. [Archived chat rubric](../../../artifacts/invocation-prompts/8678212c4a0c7c833247ddfdc11ed8e30175bf7254e6fa6795b56bbc804201e0.txt) · [Release Decisions prompt](../../../server/vocabulary/reflection-prompts/default-useful-decisions.md)

## Post-commit blind check

After committing the selector at `b5e8da5e`, we drew 32 additional production words. The draw excluded all previous evaluation words and target strings appearing anywhere in the trial rubrics. Within each inventory-size group we sorted by SHA-256 of `b5e8da5e-postcommit-blind-1/` followed by the simplified headword. We took eight single-sense, sixteen two-sense and eight larger inventories (64 senses total). Selection did not use historical answers.

A separately started reviewer received only these inventories and a short editorial brief. It froze acceptable ID sets before any calls, allowing two answers for six words. All three arms then ran once on every inventory. The authored prompt and 0.50 cutoff stayed fixed throughout.

| Arm | Exact sets matching blind reviewer | Median latency |
| --- | ---: | ---: |
| Current v7 chat | 22/32 | 1,406 ms |
| Full v7 rubric on Decisions | 19/32 | 189 ms |
| Release Decisions | 19/32 | 204 ms |

Release Decisions and chat agreed on 25/32 words. Among the seven disagreements the reviewer preferred chat on four, release Decisions on one, and a different selection on two. On 动态 the release prompt included the motion sense along with developments and social-media updates, matching the reviewer's full set. On 注销 it added the accounting write-off sense, and on 夫人 it dropped the prominent person's wife sense. Chat matched the reviewer on both. The two Decisions prompts agreed on 27/32. The tied scores hide five differences in the actual selections.

This blind result reverses the small advantage over chat on the earlier 16-word set. The latency improvement replicated. Editorial superiority did not. This sample favors multisense words, and the reference is one independent model editor. The originating checkout retains the frozen inputs, labels, all 96 requests and responses, and the offline scorer under `artifacts/default-sense-decisions-postcommit/`. Input SHA-256 is `e22efcc25afdb70ed2db2b77f64148aac3b324030034faadefa22829e9446d72` and label SHA-256 is `4382585a6560004ee618b30dcaf69951a8699608c60469940fd61d46b66978d1`.

## Shipping threshold

After reviewing the blind set, Justin chose an inclusive 0.80 threshold for the first Decisions prompt, `vocabulary-default-useful-decisions` v1. The 1,078-word prompt is byte-identical to the release candidate above. Every predicate sees the complete inventory. Two overlapping entries can both qualify when they support useful exercises. Exact agreement with the reviewer's preferred subset measures one editorial preference.

Rescoring the same saved probabilities at 0.80 selected 56 of 64 senses across the 32 blind words, down from 62 at 0.50. Five words changed. The new cutoff omitted one entry each for 堕落, 动态, 其余 and 注销 and two for 革命. All 32 retained at least one selection. Complete-set agreement with the reviewer rose from 19 to 21. One tradeoff was the motion sense of 动态, which scored 0.63 and which the reviewer had included. Both motivating pairs, 追尾 and 解雇, still selected only their primary use. The cutoff was chosen after inspecting the blind results, so these figures describe its effect on those words.

## Generating an inventory before choosing defaults

A separate paired trial tested what each generator put in the inventory. The v8 baseline at revision `9d2c42c0` produced a label, notes and a `defaultUseful` flag for each sense. The v9 candidate produced a label and notes. Both received the same `{word: {hanzi, pinyin, meanings}}` input through Chat Completions with `gpt-6-luna`, high reasoning and 8,000 maximum output tokens. The new prompt retains all twelve worked inventories and their distinctions between genuine target uses, productive constructions and compound-only meanings. It removes the instructions and example annotations for ranking teaching priorities. We ignored baseline flags during review and made no Decisions calls in this comparison. [Inventory-only prompt](../../../server/vocabulary/reflection-prompts/sense-inventory.md)

We ran each arm once on 18 synthetic lexical inputs. Eight came from the existing inventory fixtures. Ten new inputs supplied narrow glosses to probe missing meanings, including “recite a text” for 背书 and “a service counter” for 窗口. Eight of the 18 words appear in the prompt's worked examples and ten do not. The reviewer wrote a minimum coverage or exclusion criterion for each word before its first call. Automatic approval review rejected a proposed production-derived trial because sending those records to the external API lacked explicit authorization. All completed calls used synthetic inputs. [Repository fixtures](../../../scripts/fixtures/sense-inventory-cases.json)

All 36 requests returned valid responses under their respective schemas. Both arms met the prewritten criteria on all 18 words. The combined generator returned 37 entries and the inventory-only generator returned 36. Both returned empty inventories for 蜘 and 葡. The review compared senses and their notes across each pair, allowing changed labels, ordering and grouping.

| Cases | Observed inventory behavior |
| --- | --- |
| 追尾 and 解雇 | Both generated a single collision or dismissal sense respectively. Neither added tailgating or a separate passive reading. |
| 不堪, 泡沫 and 藤椒 | Both kept the formal suitability reading of 不堪, the packaging and broader figurative senses of 泡沫, and the pepper plant alongside the seasoning. |
| 有所, 双误 and 抓手 | Both kept the productive construction, the specialized tennis use, and both the literal handle and figurative means of action. |
| 窗口, 背书 and 拐点 | Both generated the computing window alongside physical and service-counter uses, distinct financial and figurative endorsements alongside recitation, and a mathematical inflection point alongside a change in a trend. |

The candidate omitted two readings that appeared in the baseline beyond the prewritten minima. For 与, the baseline included classical “approve of” with 吾与点也; the candidate kept the conjunction, preposition and literary “give.” For 脱水, the baseline added a figurative data-cleansing use; the candidate kept bodily dehydration and dewatering materials. For 熔断, the baseline grouped several protective interruptions and mentioned finance, software and flights in its notes. The candidate separated financial and software interruption from the electrical sense and did not mention flights. This single run establishes coverage of the tested boundaries. It leaves the completeness and grouping of peripheral senses open.

The originating checkout retains all lexical inputs, prewritten criteria, exact requests, raw responses and paired descriptions in `artifacts/synthetic-inventory-only-2026-11-20/`. Run `python3 summarize.py` inside that directory to reconstruct the per-word comparison offline. The v8 prompt SHA-256 is `1ed63131e8f5ea247d8366342905553175ae369ba79b1b14f59451d94357bce5`; v9 is `037e2efae2a7f6bbceea42fa337d3edadbcfa15bf428604524793d2aebe1f568`. [Archived v8 prompt](../../../artifacts/invocation-prompts/1ed63131e8f5ea247d8366342905553175ae369ba79b1b14f59451d94357bce5.txt)
