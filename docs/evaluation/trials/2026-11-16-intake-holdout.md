# Intake prompt 9.3: reorganized follow-ups, explicit lookup states and a fresh holdout

This report records prompt versions 9.2 and 9.3 of the vocabulary intake chat,
the lookup and loop changes made with them, and a new 17-case holdout set. It
supports review of the stack; it does not establish hosted readiness.

## What changed from 9.1

| Change | Where |
| --- | --- |
| Follow-up guidance rebuilt as one table of card state against allowed action, replacing three layered sections | Prompt |
| A looked-up entry that covers the learner's meaning is proposed; "unavailable" is only for when none does, after at most two searches | Prompt |
| The English rule moved next to the explanation it governs, and into the `explanation` field description | Prompt, schema |
| Asking how to say something is a request for a word and gets a proposal | Prompt (9.3) |
| A context quote must be one span of a single learner message | Prompt (9.3) |
| Lookup results state `defaultsState` and `learner.enrolled` outright | `server/vocabulary/intake-chat.ts` |
| A correctable rejection of tool arguments is returned to the model, at most twice per turn, instead of failing the turn | `server/chat/tool-loop.ts` |

No lexical policy changed. Field order in `complete_turn` was left alone.

## Holdout set

[`fixture.json`](2026-11-16-intake-holdout/fixture.json) holds 17 single-turn
cases on words that appear in no prompt example and no earlier suite. It was
written after version 9.2 was frozen. It runs through the disjoint-case runner:

```sh
node --env-file=/path/to/project.env --import tsx docs/evaluation/trials/2026-11-16-intake-organization/runner.mts --execute --variant=<name> --cases=full --max-calls=60 --fixture=docs/evaluation/trials/2026-11-16-intake-holdout/fixture.json
```

The runner supports only fresh learners, so the holdout has no follow-up or
enrolled-word cases.

Two cases are no longer untouched. `n08-unsupported` and
`n17-english-description` failed on 9.2 and led to the 9.3 wording, so later
passes on them are regression evidence. The other fifteen have not influenced
the prompt.

## Results

All runs used `gpt-6-sol` at low reasoning on synthetic local databases with no
preparation worker. Structural checks come from the runners; I read every
holdout reply and every failing case, but no independent reviewer did.

| Suite | 9.2 | 9.3 |
| --- | --- | --- |
| Holdout, 17 cases × 3 runs | 48 of 51 | 51 of 51 |
| Disjoint lexical and intent controls, 15 | 15 | 15 |
| Original intake, 15 | 14, plus the known false flag on case 11 | 13, plus the same flag; see below |
| Follow-ups, 14 | 13 (1 run) | 14, 14 and 14 (3 runs) |
| Existing-word senses, 9 | 9 | 9 |
| Enrolled advice, 2 | 2 | 2 |

Failures on 9.2 and what they led to:

- Follow-up `clarification`: the model now proposed 接发球方, which is the
  routing the covering-entry rule was written for, but it joined two learner
  messages into one context quote. Validation rejected the card and the turn
  failed. This led to the loop change and the single-span rule.
- Holdout `n08-unsupported`, one run of three: six iterations searching for an
  entry meaning "handwritten letter", ending at the iteration limit. The search
  bound followed.
- Holdout `n17-english-description`, two runs of three: a correct answer with
  no card. The prompt had not said whether "how do I say X" asks for a word.

Remaining on 9.3:

- Original `07-phrase-components` answered without the idiom proposal in the
  sweep, then produced the proposal in four of four reruns. It is an
  intermittent miss of roughly one in five, not fixed by this change.
- Original case 11 keeps its documented false structural flag.

Every holdout reply was in English, including the all-Chinese message in
`n16-chinese-message`; the earlier 发酵 case in the disjoint suite also replied
in English in both sweeps.

On 9.3 the holdout median reply was 2.7 s with a maximum of 5.0 s. The 9.3
sweep made 181 provider calls for the three chat-runner suites it measures,
at $0.47 ledger cost; the follow-up, existing-word and advice runs added $0.23.

## Evidence and limits

- Provider requests and outputs are in local run directories and were not
  committed with this report.
- The original, disjoint, existing-word and advice suites ran once per version.
  The earlier report shows cases flipping between single runs, so a single pass
  is weak evidence for any one case.
- Deterministic coverage: the intake, intake API and chat-loop tests pass,
  including a new test that a rejected completion can be corrected and that a
  persistently invalid one still fails.
- No hosted deployment, live-provider browser run or UI evaluation was done for
  this change; it does not alter the interface.
