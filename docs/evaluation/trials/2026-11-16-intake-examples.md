# Chat examples aligned with tool responsibilities — November 16, 2026

This comparison records the correction to the intake prompt's examples in PR
#541. The baseline is prompt version 4 at
`793486560c611f5a3add694972d950b9c273f0b0`; the revised base prompt is version 4.1.
The tool schema and backend behavior are unchanged.

## Adaptation

The old examples asked for complete inventories and `defaultUseful` decisions,
although the chat selects returned IDs and the backend renders canonical senses.
The revised examples separate learner requests, supplied lookup evidence,
linguistic judgment, tool actions and brief assistant prose. Only a proposed
missing meaning authors new label/notes, pending learner confirmation. Unknown
inventories go to preparation even when the model can explain the word.

All eleven detailed linguistic examples remain, as do the nine short exchange
scenarios. The lexical reasoning is retained: word versus compound ownership,
grammatical constructions, independently usable shortened nouns, peripheral
meanings, contextual tone, idiom meaning and usefulness versus inventory
membership. Their complete-inventory outputs and default flags are replaced
with the chat actions that use those judgments. Private recommendations are
explicitly conditioned on established empty defaults, not unknown defaults.
The lexical-judgment introduction is adapted to matching and missing-sense
assessment rather than enumerating an inventory.

One inconsistent example is corrected: a request for the receiving player or
side in tennis now proposes 接发球方, matching its explanation, rather than
proposing 接发球 (the return). This is a target-selection correction, not a new
sense policy. Existing-source descriptions and IDs remain authoritative.

A separate Luna/medium read-only review found no actionable contract conflicts
or lost linguistic distinctions in the detailed examples. Its observation that
the shorter examples still lacked explicit evidence/actions was addressed by
rewriting those in the same form before the candidate live run.

## Before/after comparison

The [runner](2026-11-16-intake-examples/runner.mts) adapts the existing intake
runner. Both variants use the same 15 synthetic cases and current base-branch
backend, replacing only the system prompt and its provenance version. The
comparison uses Sol with low reasoning, capped at 50 calls per variant. No
preparation worker or real learner database is involved.

| Variant | Cases | Calls | Median turn | Ledger spend |
| --- | ---: | ---: | ---: | ---: |
| Original examples | 15 | 34 | 2.96 s | $0.07798 |
| Chat-shaped examples | 15 | 34 | 2.71 s | $0.08779 |

These are small observed samples, not latency, cost or reliability estimates.
Fourteen of these fifteen cases directly overlap a worked prompt scenario or
use a closely related sentence for the same word and judgment. The remaining
case asks whether 纠结 means scissors. These runs establish regression behavior
on coached scenarios, not independent generalization. Cases 11 and 12 retain
legacy “holdout” IDs, but are not held out from this prompt. The later follow-up
and existing-word runs also overlap its examples. See the subsequent
[disjoint-case comparison](2026-11-16-intake-organization.md).
The first twelve inputs retain the earlier intake scenarios. Three additional
inputs test a negative-assessment use of 不堪 in a different sentence, a
modern-business recommendation for 函, and 有所了解 rather than 有所改善.

The coordinator inspected all learner replies, card selections and proposed
sense descriptions. The revised prompt met expectations in all 15 cases:
default add, context match, pending inventory, existing enrollment, private
recommendations, correction, larger-expression targeting, missing meanings,
unsupported use and a construction-dependent existing sense. It did not
produce complete inventories or shared-default decisions.

The baseline proposed the return action despite explaining the requested
receiving side; the revised prompt proposed the receiving side correctly.
The legacy structural checker also flagged the baseline's text-only answer to
“Is that a separate sense of 过时?” because it expected a full-expression card.
Coordinator review accepts that explanation-only answer: the user asked a
question, and a larger-expression proposal is optional. The revised run offered
a valid proposal. This checker difference is not counted as a baseline model
failure. The raw flags are retained rather than rewritten.

All 15 focused intake domain/HTTP tests passed on the owning branch. These tests
use fake provider traces and establish application behavior, not model judgment.
No UI rendering or tool schema changed, so this correction did not require new
visual verification. The restacked tip uses prompt version 7 (the intermediate follow-up layer uses
5.1). Its follow-up examples now distinguish an unaccepted enrollment proposal,
where “only the AI sense” revises private selection, from an existing-word sense
proposal, where Add sense must precede selection changes.

At integration revision `682c647`, the existing follow-up runner met coordinator
expectations on all 14 cases (16 calls, $0.04844), and the existing-word runner
met expectations on all nine cases (15 calls, $0.05447). Cases include questions
versus instructions, named and ordinal references, private revisions, explicit
confirmation, unsupported requests, ambiguity and tennis clarification. Exact
outputs and original runner fixtures are retained; this is a regression pass,
not another model comparison. The baseline follow-up and existing-word reports
retain earlier results for those same fixtures.

The full tip suite passed: 2,917 tests, 2,911 passed, five skipped, one TODO,
zero failures. Server TypeScript and production build also passed, with the
existing bundle-size advisory. The archive includes the check logs. There were
no UI, schema, tool-handler or state-transition changes in this correction.

## Evidence

The [archive](2026-11-16-intake-examples/provider-evidence.tar.gz) retains both
rendered prompts/hashes, exact provider requests and outputs, fixture inputs,
source revision/diff, persisted outcomes, structural checks, timings and usage.
The tip runs also retain their exact prompts, invocation records and outcomes.
Synthetic databases are excluded. An exact credential scan passed before
publication. The historical custom-senses evaluation is left intact as evidence
of the original prompt; this report describes the revised examples.
