# Intake prompt organization and disjoint-case comparison

This review checks whether reorganizing the chat prompt preserves lexical
judgment and makes its tool contract clearer. It also corrects the interpretation
of earlier evaluation evidence: 14 of the 15 cases in the
[examples comparison](2026-11-16-intake-examples.md) overlapped a worked scenario
or a nearby sentence for the same word. Those runs are useful regression checks,
not an independent generalization test. The later follow-up and existing-word
runs also overlap the prompt examples.

## Change and retained reasoning

The baseline is PR #541 at `aae31d15cc9666f29e2abf998dff3f123da98f5f`, prompt
4.1, schema 1. The revision is prompt 4.2, schema 1.1. Card arguments and domain
handlers are unchanged; schema provenance changes because three read tools are
removed. Exact lookup and both searches already return senses, defaults and
learner state. Repeating exact lookup can refresh evidence. Readiness stays in
the backend-rendered card rather than a separate model status tool.

The prompt follows role/voice, lookup procedure, lexical judgment, card decisions
and fields, learner-facing prose, then one example section. `requestedLexeme`
has one definition, including ordinary bare/contextual requests and the original
component/spelling for redirects. The action table separates the situations
covered by `proposal` without changing that enum. Search fallback is explicit.
The final “Complete the exchange” patch section is integrated into its owners.

Removed material:

- The nine short worked exchanges, which directly tracked evaluation scenarios.
- The overlapping 藤椒 private-recommendation example; 函 retains the distinction
  between valid peripheral senses and a useful personal starting set.
- Repeated field boilerplate, duplicated lexical-ownership guidance and parent
  prompt residue about complete inventories and `defaultUseful` outputs.
- `list_senses`, `learner_word_state` and `study_status` from the tool list.

Ten detailed linguistic examples remain. Exact-target ownership, construction
versus compound, independent shortened forms, register, incomplete glosses,
peripheral meanings, context versus distinct senses, idiom tone and usefulness
versus validity remain. A shortened form's linguistic validity is separated
from whether the application's lexicon can supply a card identity. A Luna/medium
read-only reviewer checked the prompt against the adapter without reading the
new evaluation fixtures and found no actionable loss or contract mismatch.

## Evaluation design and observed failure

A separate Sol/medium reviewer proposed eleven lexical targets absent from the
prompt: 念念不忘, 发酵, 音信全无, 斟酌, 升温, 下滑, 脆弱, 微/微笑, 空调,
签正/签证 and ambiguous 行. The coordinator finalized the candidate organization
before incorporating the fixtures. The [runner](2026-11-16-intake-organization/runner.mts)
uses synthetic isolated databases, frozen fixture inputs and Sol/low. No worker
or real learner database runs. Each variant is bounded to forty provider calls.

The baseline and initial candidate both failed the same intent case: asked
whether sales 下滑 differs from falling grades, they correctly explained the
same sense but also automatically enrolled the word. The prompt's word-plus-
context shortcut was overriding a language question. Both failed traces remain
in the evidence. The correction makes intent precedence explicit: a question,
hypothetical or quoted instruction does not authorize enrollment; a clear
accompanying add instruction does. The shortcut applies otherwise.

The next run exposed another ambiguity: nonempty includedSenseIds was read as
enrollment even when the learner was not enrolled. The prompt now names the
backend's enrollment predicate (inStash, or a non-null mode other than unstudied)
and explains that includedSenseIds can be derived from defaults. The final
review also clarified that advice about an enrolled word preserves its current
set; the new-sense proposal path remains an explicit exception.

After observing those failures, the eleven-case set is development/regression
evidence for the correction, not an untouched holdout. Prompt examples do not
include its words or answers. Prose-before-card ordering is observed separately;
it remains a prompted behavior, not a schema-enforced guarantee. Splitting the
proposal enum or introducing an explanation field is outside this change.

## Verification and evidence

| Run | Cases | Calls | Coordinator judgment | Ledger spend |
| --- | ---: | ---: | --- | ---: |
| Baseline 4.1 | 11 | 24 | 10 accepted; question auto-enrolled | $0.04888 |
| Initial organization | 11 | 26 | 10 accepted; same intent failure | $0.05646 |
| Intent correction | 11 | 24 | 9 accepted; enrollment misread twice | $0.05251 |
| Enrollment clarification + four fresh controls | 15 | 34 | 15 accepted | $0.06788 |
| Integrated follow-ups/Add sense prompt | 15 | 32 | All state/action checks passed; one reply ignored English-default voice | $0.06531 |
| Earlier fifteen-scenario regression | 15 | 33 | 13 accepted; two missing card calls | $0.07345 |
| Follow-up regression | 14 | 18 | 14 accepted | $0.06163 |
| Existing-word regression | 9 | 15 | 9 accepted | $0.03589 |
| Final enrolled-advice routing | 2 | 4 | 2 accepted | $0.02339 |

The four fresh controls use 闪烁, 俯瞰, 搁置 and 凝视: a meaning question, a
hypothetical, a clear add request alongside a question, and a direct contextual
add. They were designed after the intent failure but before execution and do
not appear in the prompt. These are small synthetic samples, not reliability
estimates. The base enrollment wording was then aligned with the full backend
predicate for words outside Stash. The integrated run exercises that wording.

The integrated run used revision `4a225f3`. A final read-only review identified
advice/proposal precedence on enrolled words; this was clarified downstack and
checked with the two-case [advice runner](2026-11-16-intake-organization/advice-runner.mts).
That final change and a corrected section cross-reference were not followed by
another full provider sweep; the exact earlier rendered prompt remains in each
run's evidence. The final full application suite ran at `738ed08`.

### Remaining behavioral gaps

The earlier regression suite revealed two real completion failures: 绵长 with
missing inventory ended after explanation, without its inventory_pending card;
怡然自得 advice announced a study proposal but never called present_card. Both
are failures even though the prose is linguistically reasonable. They were not
rerun until green or hidden by changing expected outcomes. The 过时 question
also failed the legacy structural checker, but its explanation-only response is
acceptable under the question policy, as already recorded in the previous
comparison. Thus 12/15 raw structural passes correspond to 13/15 coordinator
acceptances, not 15/15.

One integrated 发酵 reply used Chinese although English was requested by default;
its target, selection and enrollment were correct. Text preceded every emitted
card in the disjoint/development runs, but the missing-card failures show that
observing ordering does not establish reliable completion. An explanation field
could bind a card's prose to its action when a card is emitted; it alone would
not force the model to emit that card. A structured terminal decision or explicit
completion validation deserves separate design work. This PR does not add one.

### Application checks

The full suite passed: 2,918 tests, 2,912 passed, five skipped, one TODO, no
failures. Server TypeScript and production build passed (existing bundle-size
advisory). Focused base intake tests passed, including a new check that the
provider receives senses, defaults and actual learner state from one lookup.
The initial sandboxed full run failed across listener-dependent tests; the final
run used host listener access on a stable tip. No UI behavior changed, so no new
rendered verification was performed.

The [archive](2026-11-16-intake-organization/provider-evidence.tar.gz) retains
exact prompts, hashes, provider requests/outputs, fixtures, persisted outcomes,
timings and judgments, including failed variants. It excludes synthetic
databases and credentials. These results support the organizational cleanup and
expose remaining reliability gaps; they do not establish production readiness.
