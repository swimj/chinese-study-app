# Home exercise failure and compensation rates

Home reports recall failures alongside later scheduler compensations, which can
correct an exercise from an earlier period. Use this contract to understand
which exercises contribute to the rates, how their UTC windows work, and why
compensation does not erase recorded failures. The
[session progress and completion contract](session-progress-and-completion.md)
defines when study work is covered and durably accepted.

## Counted exercises and time windows

The homepage pools completed word-review actions (recognition, production, and
contrast selection) and standalone pure-cue assessments from finalized sessions.
Each exercise counts once in the denominator. A word-review action with a lapse
or a pure-cue assessment with any failure counts once in the numerator, even if
reinforcement later succeeds. Learning and new-word practice are excluded.

The 1-, 3-, and 7-day windows include today and use UTC session-completion dates.
Sum failures and completions across each window before dividing; show no rate
when there are no completions. Save combined exercise totals at session
finalization; do not reconstruct them from attempt history on reads. Summary
retries replace saved totals. Existing summaries remain as recorded, without a
pure-cue backfill.

## Compensation and presentation

The homepage headlines adjusted failure and compensation rates. For each window,
let N be completed exercises, F recorded failures, and C actual scheduler
compensations applied in that window across word production and pure cues.
Adjusted failure is `max(0, F - C) / N`; compensation rate is `C / N`. Clamp only
after summing the window. If N is zero, both rates are absent but counts remain
available in the rate details. Compensation rate may exceed 100% when older proposals are applied.

Increment a learner-private daily counter in the same transaction that first
marks a scheduler snapshot restored, using its UTC application date regardless
of the original failure date. The counter starts empty at rollout; historical
restorations are not backfilled. Newly applied restorations of older failures
still count. Rollout-spanning windows intentionally mix old and new coverage. Pending proposals, unavailable
restorations, and already-restored retries add nothing. Include compensation-only
days. Preserve recorded failure counts and attempt history; compensation neither
removes an exercise from the denominator nor grants success credit. Show the
recorded failure, compensation, and exercise counts in a collapsed-by-default
“Rate details” disclosure, with a short explanation that compensations can correct
an earlier period. Keep the two rates visible with shared period and metric labels;
do not repeat calculation prose inside each period.

## Implementation and evidence

The [study-session API reference](../docs/api.md#study-sessions-and-attempts)
explains the saved summary fields, daily counters, and migration boundary.
[Rate calculation](../src/lib/review-failure-rates.ts) derives Home's windows
from those counts. The [exercise-total tests](../tests/exercise-failure-rates.test.ts)
check saved totals, retry replacement, compensation-only days, and learner
isolation; the [rate-window tests](../tests/review-failure-rates.test.ts) check
aggregation before clamping, absent rates, and compensation above 100%.
