# Archived: Home exercise failure and compensation rates

Archived after the Mandarin vocabulary cutover. This is a historical design
record; current requirements are maintained in the [product contract](../vocabulary-learning.md)
and [architecture contract](../vocabulary-architecture.md).

This document preserves the earlier runtime's design and terminology for
interpreting retained records. The description below is scoped to that runtime.
[Adaptive vocabulary study](../vocabulary-learning.md) owns current Mandarin
behavior; [Vocabulary study UI](../../docs/implementation/vocabulary-ui.md) describes
the current frontend.

Home's **Exercise failure rate** panel summarizes failures in completed review
exercises and later corrections for unfair exercises. This document explains
what contributes to those counts and how to interpret the **Adjusted failure**
and **Compensation** rates, including corrections applied after the original
study session.

## What counts as a failed exercise?

For these metrics, an exercise is one word-review action (recognition,
production, or contrast selection) or one standalone pure-cue assessment. A pure
cue is a production prompt with an accepted set of words rather than a single
target word; answering it is one exercise, whichever accepted word is used.
Recognition and production of the same word are separate exercises, so the
completed count is not a count of distinct words.

A recorded failure means the learner chose **Forgot** or the app assigned that
outcome, for example after a rejected production response or an incorrect
contrast selection. Repeated attempts during reinforcement belong to that same
exercise: they add neither another completed exercise nor another failure. An
exercise with any recorded failure counts as failed even when reinforcement
later succeeds.

An exercise contributes only after its session's results are durably accepted.
Learning and new-word practice are excluded. The [session progress and completion
contract](session-progress-and-completion.md) defines when each study unit is
covered and when the session's results become durably accepted.

## What does compensation mean?

A recorded failure can change when an exercise next appears for practice. Yet
the failure can reflect an unfair exercise rather than a learner's inability to
answer it: an ambiguous cue may admit a reasonable answer that the exercise
rejects. When the learner accepts a proposed repair from reflection, a
qualifying failure can receive compensation: a correction to its scheduling
penalty. The [false-lapse compensation
contract](../pure-cue-elicitation.md#false-lapse-compensation)
defines which word-production and pure-cue failures qualify and the scheduling
recovery rules.

The original assessment is preserved. Compensation does not turn the recorded
failure into a success or remove the exercise from the completed count. Home
therefore keeps the failure count and the compensation count separately, so the
learner can see both what happened during study and which corrections were
applied.

Only an actual applied compensation contributes to the compensation count.
A pending proposal or an unavailable restoration contributes nothing. Each
restoration counts once; retrying an already applied correction adds no second
compensation. These counts belong to the learner whose schedule was corrected.

## How the periods and rates relate

Home shows periods covering one, three, or seven UTC calendar days, including
today. Completed exercises and their failures use the UTC date when the session's
study work finished; the final Undo window does not shift that recorded date.
Compensation uses the UTC date it is applied, which can be later than the failure
it remedies.

Within each period, **Adjusted failure** is the recorded failure count minus
the compensation count, floored at zero, divided by the completed exercise
count. **Compensation** is the compensation count divided by that same completed
exercise count. Each rate uses the totals for the whole period; it is not an
average of daily percentages.

These are windowed activity measures. The compensation count is not restricted
to failures among the exercises completed in that period, so adjusted failure
is not an exact corrected failure proportion for those exercises.

For example, suppose a learner completes ten exercises today, two with failures,
and applies three compensations for failures from last week. Today's adjusted
failure is 0% and compensation is 30%. The two failures recorded today have not
been erased or individually corrected. If twenty such compensations were
applied, compensation would be 200%; the rate has no upper cap because its
numerator and denominator can describe different groups of exercises.

When a period has no completed exercises, neither rate has a value, even if
compensations were applied. Home exposes the recorded failure, compensation,
and completed exercise counts in **Rate details**, including compensation-only
periods. These counts distinguish a zero adjusted rate from having recorded no
failures and show the basis of each displayed rate.

The [study-session API reference](../../docs/api.md#study-sessions-and-attempts)
describes the current persistence, response fields, and historical data-coverage
limits.
