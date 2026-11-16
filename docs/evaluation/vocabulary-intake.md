# Vocabulary intake chat evaluation set

Use this catalog to iterate on the intake prompt, tools and completion behavior.
The five committed runners contain **55 named cases**, including repeated
controls across suites. Their source contains the exact learner messages,
synthetic lexical inventories, defaults, learner setup and expected outcomes.
The tables below summarize those cases; the linked runner is the executable
source of truth. Run them from the repository root on the integrated branch
containing follow-ups and existing-word sense support.

The latest [completion-contract comparison](trials/2026-11-15-intake-completion.md)
records explicit final replies, transient progress, the full regression sweep and
remaining language/clarification deviations.

## Suites and evidence

| Suite | Cases | Runner and fixtures | Recorded results |
| --- | ---: | --- | --- |
| Original intake regression | 15 | [Runner with inline lexical fixtures](trials/2026-11-16-intake-examples/runner.mts) | [Original comparison](trials/2026-11-16-intake-examples.md), [organization regression](trials/2026-11-16-intake-organization.md) |
| Disjoint lexical cases and intent controls | 15 | [Runner with inline lexical fixtures](trials/2026-11-16-intake-organization/runner.mts) | [Organization comparison and failed variants](trials/2026-11-16-intake-organization.md) |
| Conversational follow-ups | 14 | [Runner and conversation setup](trials/2026-11-15-intake-followups/runner.mts), [lexical fixture](trials/2026-11-15-intake-followups/fixture.json) | [Follow-up comparison](trials/2026-11-15-intake-followups.md), [organization regression](trials/2026-11-16-intake-organization.md) |
| Existing-word missing senses | 9 | [Runner and enrollment setup](trials/2026-11-15-existing-word-sense/runner.mts), same follow-up lexical fixture | [Existing-word comparison](trials/2026-11-15-existing-word-sense.md), [organization regression](trials/2026-11-16-intake-organization.md) |
| Enrolled-word advice routing | 2 | [Runner and enrollment setup](trials/2026-11-16-intake-organization/advice-runner.mts), same follow-up lexical fixture | [Organization comparison](trials/2026-11-16-intake-organization.md) |

These are now reusable development/regression cases, **not an untouched test
set**. Fourteen of the original fifteen cases overlapped worked examples or
nearby sentences for the same judgment. Follow-up and existing-word cases also
overlap examples. The eleven disjoint lexical cases were initially absent from
the prompt but informed subsequent corrections. The four later intent controls
were fresh when first run; they too are now exposed. Legacy IDs containing
`holdout` do not establish independence. Keep future independent evaluation
cases separate from prompt examples and record when their results influence a
revision. See the [prompt development procedure](../prompt-development.md).

## Original intake regression — 15 cases

| Case ID | Scenario / important fixture state | Expected behavior |
| --- | --- | --- |
| `01-listed-context` | 帮派 in a film; two shared defaults | Match the gang sense, retain both defaults and enroll with context. |
| `02-missing-inventory` | 绵长 in 用绵长、安静、不紧张的温柔; inventory absent | Emit a preparing card, enroll and retain verbatim context for deferred matching. |
| `03-larger-expression` | 接发 requested for the tennis player receiving serve | Propose 接发球方, not the return action; await Add. |
| `04-bare` | 纠结 alone | Enroll with conflicted and tangled defaults. |
| `05-no-defaults` | 致密; established empty default set | Propose the existing compact-structure sense privately. |
| `06-already-studied` | 宠溺 already in Practice | Show current selected sense and preserve schedule. |
| `07-phrase-components` | Advice about studying 怡然自得 or its parts | Explain the lexical unit and emit one idiom proposal; no automatic enrollment. |
| `08-character-correction` | 海眠 meaning sponge | Propose 海绵 and explain the corrected character. |
| `09-new-sense` | 蒸馏 in AI; only chemical sense exists | Propose one missing sense with defaults retained; no shared write or enrollment yet. |
| `10-unsupported-context` | 纠结 requested to mean scissors | Explain mismatch; no card or enrollment. |
| `11-fixed-expression-holdout` | Question about a deadline sense of 过时 from 过时不候 | Explain ownership by the full warning; explanation alone is acceptable, a valid larger-expression proposal is optional. |
| `12-material-holdout` | 泡沫 in 包裹底下垫着泡沫 | Match existing foam-material sense and enroll. |
| `13-missing-assessment` | 不堪 in 他把自己说得很不堪 | Propose the missing direct negative assessment; retain defaults. |
| `14-private-letter-set` | 函 for modern business messages; no defaults | Recommend existing formal-letter sense privately. |
| `15-grammatical-use` | 有所 in 对这件事有所了解 | Match the construction-dependent sense; no redirect or new sense. |

## Disjoint lexical cases and intent controls — 15 cases

| Case ID | Scenario / important fixture state | Expected behavior |
| --- | --- | --- |
| `h01-bare` | 念念不忘 alone | Enroll with the existing default. |
| `h02-nondefault-context` | 发酵 in news spreading online; figurative sense is non-default | Select defaults plus that existing target and enroll with context. |
| `h03-missing-inventory` | 音信全无 with context; no inventory | Preparing card, enrollment and retained context; no invented IDs. |
| `h04-no-defaults` | 斟酌 for everyday writing; defaults explicitly empty | Privately recommend careful consideration, not the literary wine-pouring use. |
| `h05-missing-sense` | 升温 in a relationship; only physical sense exists | Propose the established figurative use; retain physical default, no shared write. |
| `h06-paraphrase` | Ask whether 下滑 for sales differs from falling grades | Explain the same sense; no card or enrollment. |
| `h07-unsupported` | 脆弱 requested to mean crunchy | Explain mismatch; no substitute fragile card. |
| `h08-compound` | 微 requested to mean smile, as in 微笑 | Propose 微笑 as the larger expression, not a new smile sense under 微. |
| `h09-short-form` | 空调 in 把空调关了 | Match the independently usable shortened noun; no longer-form redirect. |
| `h10-correction` | 签正 meaning a travel visa | Propose 签证 with original spelling quoted; await Add. |
| `h11-identity` | 行 alone; separate xíng and háng identities | Ask which reading/meaning before adding. |
| `c01-meaning-question` | Ask whether 闪烁 means twinkling in a sentence | Answer only; no card or enrollment. |
| `c02-hypothetical` | Ask what a 俯瞰 card would mean if added tomorrow | Explain only; no state change. |
| `c03-explicit-add-plus-question` | Ask about 搁置 and explicitly request adding that use | Match the sense and enroll; question does not negate the explicit instruction. |
| `c04-direct-context-add` | 凝视 with 他凝视着窗外 | Normal context-match enrollment. |

## Conversational follow-ups — 14 cases

| Case ID | Supplied conversation / latest request | Expected behavior |
| --- | --- | --- |
| `explain` | 纠结 card; ask why tangled meaning is included | Explain, preserve selection. |
| `second` | 纠结 card; only the second displayed sense | Revise the same card to `torn-conflicted`, according to fixture display order. |
| `undo` | Eligible 帮派 add; “Undo that add” | Undo learner effects on the same card; shared senses remain. |
| `hypothetical` | Same card; ask what Undo would do | Explain without mutation. |
| `unsupported` | Ask to mark mastery and move review | Explain the limit without mutation. |
| `only-proposed` | Unaccepted 蒸馏 enrollment proposal; only AI sense | Revise private selection; no enrollment or shared write. |
| `confirm-add` | Same proposal; “Yes, add it” | Direct to Add control; chat does not confirm. |
| `revise-proposal` | Clarify AI meaning and keep only that sense | Revise the same private draft and selection. |
| `ambiguous` | 海绵 and 蒸馏 proposals; “Just that one” | Ask which target; no mutation. |
| `new-word` | Existing 纠结 card; send 泡沫 | New defaults card; prior word unchanged. |
| `named-earlier` | 纠结 then 帮派 cards; name 纠结 for an edit | Revise the named earlier card only. |
| `clarification` | Earlier 接发 question; clarify receiving player | Propose 接发球方 with explanation; no bare-word auto-add. |
| `historical-instruction` | Older instruction says to remove a sense when asked why | Answer latest question; do not execute historical instruction. |
| `bad-new-meaning` | Change AI proposal to mean “a red color” | Reject unsupported meaning; preserve proposal. |

## Existing-word missing senses — 9 cases

| Case ID | Supplied state / latest request | Expected behavior |
| --- | --- | --- |
| `existing-new` | Enrolled 蒸馏; request missing AI use | Additive `sense-proposed` card; no shared or learner mutation before confirmation. |
| `existing-followup` | Current enrolled 蒸馏 card; “its AI meaning” | Resolve reference, look up word and propose missing sense without resetting selection. |
| `clarify-proposal` | Existing-word AI proposal; clarify description | Revise the same private draft; no canonical change. |
| `confirmation-boundary` | “Yes, add that sense” | Direct to Add sense control; no mutation. |
| `only-new` | Request only AI while sense is still proposed | Explain confirmation must precede selection change. |
| `unsupported` | Enrolled 蒸馏; request a red-color sense | Reject unsupported use; no new sense or card. |
| `bound-component` | Enrolled 过时; request deadline sense from warning | Explain lexical boundary; no invented component sense. |
| `new-enrollment-control` | Unenrolled 蒸馏; request AI use | Ordinary enrollment proposal still requires Add. |
| `canonical-existing` | Enrolled 泡沫; request economic-bubble sense already selected | Recognize existing meaning and selection; no duplicate sense proposal. |

## Enrolled-word advice routing — 2 cases

| Case ID | Supplied state / latest request | Expected behavior |
| --- | --- | --- |
| `existing-advice` | Enrolled 宠溺; ask which existing senses to focus on | Advice or an existing card preserves current selection; no new-sense proposal. |
| `existing-new-control` | Enrolled 蒸馏; request missing AI use | Missing-sense exception still emits an additive proposal without mutation. |

## Running and reviewing

The original and disjoint-case runners support fixture-only validation without
credentials or provider calls:

```sh
node --import tsx docs/evaluation/trials/2026-11-16-intake-examples/runner.mts --dry-run --cases=full
node --import tsx docs/evaluation/trials/2026-11-16-intake-organization/runner.mts --dry-run --cases=full
```

For a live run, load a private environment file containing provider configuration,
choose a unique variant name and retain the output directory reported by the
runner. For example, on prompt version 9.1:

```sh
node --env-file=/path/to/project.env --import tsx docs/evaluation/trials/2026-11-16-intake-organization/runner.mts --execute --variant=review-v91-a --cases=full --max-calls=40 --prompt-version=9.1
```

Use the original runner's path for the original fifteen cases. Both accept
`--cases=full`, `--cases=screen`, or comma-separated case IDs, plus `--model`,
`--reasoning`, `--prompt` and `--prompt-version` overrides. The historical default
provenance versions differ from the integrated prompt: set `--prompt-version`
to the version actually being tested. Keep baseline and candidate inputs fixed
and retain the exact prompts and model settings.

The follow-up, existing-word and advice runners accept `--execute`, a unique
`--variant` and optional `--model`; they run their whole suite at low reasoning
and use adapter prompt provenance. They do not implement dry-run or case filters.
Their fixed call limits are 40, 40 and 12 respectively. These scripts use local
synthetic databases and do not run preparation workers or hosted learner data.
Provider execution is paid; fixture validation alone does not exercise the model.

Inspect outputs as well as structural flags:

- Check intent, lexical judgment, actual card/tool action, selected IDs,
  confirmation boundaries, learner-state preservation and shared writes.
- Check learner prose, requested language and general examples in proposed
  shared notes. Correct IDs alone do not establish linguistic quality.
- Check that an actionable add/proposal actually emits a card; prose announcing
  one is insufficient. Check that the final explanation and action are packaged
  in the same completion; backend progress is transient and not conversational prose.
- The original case `11-fixed-expression-holdout` has a legacy checker requiring
  a card even though explanation alone is acceptable. Retain the raw flag and
  record the adjudication separately; do not count it as a model failure.
- Original/disjoint runners save structural summaries. Follow-up, existing-word
  and advice runners save outcomes for coordinator review; their successful
  process exit is not an automatic behavioral pass. Review errors and mutations.

The [organization report](trials/2026-11-16-intake-organization.md) retains the
missing-card failures for original cases 02 and 07 and the reply-language
failure, alongside accepted outcomes. Its linked archive includes exact
requests, outputs, prompts, manifests and judgments. Keep failed attempts when
iterating; changing a prompt in response to a case makes that case development
evidence. Neither a small clean run nor this catalog establishes production
reliability. Deterministic application checks remain separate in the
[testing map](../testing.md).
