# Explicit intake completion and transient progress

This report records the change from streamed assistant prose followed by optional
card tools to a required completion containing both explanation and action. It
supports review of the existing stack; it does not establish hosted readiness.

## Contract and prompt adaptation

The baseline is `78aac9ab87592bcc6d34b788be82edc43bfcf287`, intake prompt version 8.
Version 9 preserves the lexical reasoning, intent rules and worked examples,
while mapping outputs to `complete_turn` with `explanation` and an `answer`,
`present_card` or `revise_card` action. The prose-before-tool instruction is
replaced by a packaged explanation. Backend progress is transient; provider prose
is diagnostic evidence only. Required tool choice prevents prose-only success,
but a structurally valid answer can still be the wrong semantic decision.

Domain effects, explanation, card association and completed status share a
synchronous transaction. A failed final write rolls them back. Recovery preserves
legacy transcripts and uses explicit terminal receipts for new turns. Known
failed attempts get fresh retry identities; uncertain disconnects retain their
identity and replay the committed result. Add and Add sense confirmations remain
explicit controls, and stale learner edits still fence conversational revisions.

## Live regression evidence

All five suites in the [55-case catalog](../vocabulary-intake.md) ran once on
`gpt-6-sol`, low reasoning, with synthetic local databases and no preparation
worker. The retained manifests record revision `f6ed72767827440fc921e2a0821c2eb101ba55e0`
and the exact prompt, schemas and provider requests/outputs. Later retry/UI test
changes do not alter this model contract. These are development regressions,
including cases exposed to prior prompt iteration, not an untouched holdout.

| Suite | Cases | Accepted after review | Calls | Median final reply | Ledger cost |
| --- | ---: | ---: | ---: | ---: | ---: |
| Original intake | 15 | 15 | 35 | 2.68 s | $0.103971 |
| Disjoint lexical and intent controls | 15 | 14 | 31 | 2.70 s | $0.074099 |
| Follow-ups | 14 | 13 | 18 | 1.48 s | $0.056642 |
| Existing-word senses | 9 | 9 | 15 | 2.16 s | $0.041971 |
| Enrolled advice | 2 | 2 | 4 | 3.44 s | $0.010959 |

All 55 turns produced nonempty explicit completions; no provider/schema error
or unauthorized mutation was observed. The two prior missing-card cases now
pass: original `02-missing-inventory` enrolls with a preparing card and retained
context, and `07-phrase-components` emits the idiom proposal awaiting Add.
Original case 11 retains its legacy false structural flag: an answer-only reply
is valid for that question, as documented in the catalog.

Independent read-only output review accepted 53/55. Two quality deviations remain:

- `h02-nondefault-context`: correct 发酵 selection and enrollment, but the final
  explanation is entirely Chinese despite the English default. This repeats the
  earlier language deviation.
- Follow-up `ambiguous`: no mutation, but the clarification assumes 海绵 instead
  of first asking which of 海绵 and 蒸馏 the learner means.

The total was 103 provider calls and $0.287643 in observed ledger cost. Median
final latency across 55 turns was 2.47 s, p95 4.26 s, and maximum 5.40 s. These
local, concurrently run, cache-influenced measurements exclude preparation and
are not a production latency guarantee. `progressMs` now measures the first
backend status, while `completionMs` measures the whole final reply. No metric
claims early generated prose. Historical archives remain unchanged.

[Exact provider evidence](2026-11-15-intake-completion/provider-evidence.tar.gz)
contains the main sweep and final repeat manifests, prompts, fixtures, invocation records and outcomes;
synthetic database files are excluded. [Aggregate metrics](2026-11-15-intake-completion/metrics.json)
retain suite-level counts, latency and costs. A credential scan passed.

## Final contract-wording check

Version 9.1 groups the three action kinds together and removes two residual
example instructions referring to no tool or a revision tool. Hypothetical
questions and unconfirmed existing-sense selections now explicitly use
`kind=answer`. No lexical policy changed. The final follow-up and existing-word
suites were rerun on this exact prompt (23 cases, 33 calls, $0.110667 additional
ledger cost); their manifests and raw outputs are included in the same archive.

Independent review accepted 22/23. Hypothetical and confirmation boundaries held,
and the ambiguous-word case now asked which of 海绵 or 蒸馏 was intended. A different
failure appeared in `clarification`: the model explained 接发球员 and said that
exact entry was unavailable, choosing answer-only instead of proposing the
available 接发球方. This is a semantic routing miss despite valid completion.
The prior 55-case findings are retained; the repeat does not erase them or rerun
the original/disjoint suites. There is no claim that the terminal contract alone
eliminates all missing-card decisions.

## Deterministic and rendered checks

The integrated full suite passed 2,919 tests, with five existing skips and one
TODO (2,925 total). Server typechecking and production build passed. Focused
coverage includes answer-only completion, raw-prose suppression, required tool
choice, batch validation, rollback after enrollment/revision writes, legacy
history/recovery, stale edits, learner isolation, HTTP replay and terminal-failure
retry. The stream parser rejects missing or duplicate completion and progress
after completion. After the final UI retry wiring and contract-wording cleanup,
all 65 affected tests, server typechecking and production build passed again.

The existing Chrome app-shell regression passed at 760px with 125% text: Add
sense, native Enter/Space, stale reload/reconfirmation, retained senses, no
inappropriate Undo, focus return and wrapping. An independent task evaluation
uses [this brief](2026-11-15-intake-completion/ui-brief.md); its observations are
recorded here. The evaluator used a fresh context with only the brief and evaluator
procedure, read no implementation/tests, and used CDP screenshots in a separate
tab. Source stayed frozen throughout the pass. Normal progress disappeared when
the completed reply arrived; Enter, Up to card actions and Escape back to composer
worked. Interrupted-result retry recovered one explanation/card without duplication.
The evaluator found that terminal-failure retry still reused the failed identity:
the backend flag was present but the frontend assignment was missing. This finding
was preserved in [the first-pass screenshot](2026-11-15-intake-completion/retry-failure-first-pass.png)
and corrected before the focused coordinator rerun.

A combined question-and-selection request exceeded the simulated fixture's simple
response matching and did not change selection. This is a fixture limit, not
live-model evidence. The coordinator supplied that implementation context after
the evaluator's initial observation; that portion is not an independent inference.
The evaluator's existing-sense/narrow-width pass was incomplete; the separate
retained browser regression covers the existing-sense flow at 760px/125% text.

The retained [browser check](2026-11-15-intake-completion/browser-check.mjs) then
passed progress replacement, answer-only response, same-card revision, fresh retry
after terminal failure, same-identity replay after lost acknowledgement, keyboard
focus and 760px enlarged-text layout. It was run against Chrome CDP 9229 and the
brief's slow-chat fixture on port 4221. Its first attempt used a word unsupported
by the fixture; switching to the existing 帮派 fixture corrected the test input.
The independent evaluator then reran only the failed-message scenario from a
fresh reload, observed one explanation/card with the error cleared, and retained
[a successful retry screenshot](2026-11-15-intake-completion/retry-fixed.png).
The final [recovery screenshot](2026-11-15-intake-completion/final-recovery.png)
shows the settled transcript. No production bug was inferred from the unsupported
fixture input.

Representative screenshots: [waiting](2026-11-15-intake-completion/progress.png),
[completed reply](2026-11-15-intake-completion/completion.png), and
[replayed completion](2026-11-15-intake-completion/replayed-completion.png).

No hosted deployment, live-provider browser end-to-end run, real Clerk browser
session, production migration or restore rehearsal was performed. Review PRs
are updated in place; nothing is merged or deployed.
