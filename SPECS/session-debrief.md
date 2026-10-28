# Session debrief

This contract helps contributors understand what the Mandarin session debrief
promises: which completed work informs it, how results survive failures, and how
learners return to their connections. Debrief is an informational result separate
from reflection, its evidence, proposal authorization, and application.

## Completion and input

The server closes a vocabulary session against its retained completion projection.
In that same transaction, it freezes one inventory row for every presented
encounter, including skipped, unanswered, and uncovered encounters. Repeated
encounters may repeat a word. Each row contains word text and pinyin resolved
at closure. Ordinary word encounters use their word identity; contextual choice
encounters use the authored correct target in the exact served assessment.
Independent pure cues contribute their complete accepted member set from the
exact content revision, joined with ` / `, without inventing a selected target.
The frozen inventory is never enriched from later lexical edits.

The retained completion preserves all encounters. The current implementation
limits Connections provider input to the first 1000 rows and records the omitted
count in an operational event. This is a provider-input limitation, not a
promise of exhaustive Connections coverage, and does not reject session closure.
An empty pinyin string truthfully preserves an encounter without a pronunciation cue.

The closed completion and first debrief job are saved in one transaction.
Finalization failure permits retry; successful completion is never reopened by
provider or debrief-result failure. Repeated finalization preserves the first
job snapshot. Historical legacy jobs remain available through the same queue
and read API. The retired summary submission endpoint returns 409 and creates
no job. French does not enqueue this Mandarin provider flow.

The immutable input records the UTC completion timestamp, sequential `w1`, `w2`
references, exact inventory strings, and the learner's interests at completion.
Interests are an optional learner-owned settings text field, initially empty.
They establish curiosity, not expertise or biography. Changing interests affects
future snapshots; failed-job retries reuse the original input and candidate selection.

## Recent connection cooldown

At session finalization, omit a word from generation when it has supported
connections in at least two distinct successful debriefs saved for this learner
within the preceding 72 hours. Several notes or repeated inventory rows in one
debrief count as one connected session. Words merely supplied to the model do
not count. The timestamp is when a successful result was saved, whether or not
the learner opened it; failed, pending, and empty results contribute nothing.
The window uses server time at finalization, excludes occurrences exactly 72
hours old, and does not use the client's session completion date.

This allows a second appearance to reinforce an association while reducing
persistent repetition. Each occurrence expires independently. Suppressed
appearances do not extend the cooldown. Match trimmed word text, independent of
pinyin; slash-separated alternatives each contribute to history when their row
is referenced. Omit an entire candidate row if any alternative is suppressed,
preserving the exact text and pinyin of retained rows. Character variants are
not unified by this policy.

The job retains its full original inventory and freezes excluded references
alongside it. Provider input contains only eligible rows, with their original
references. Duplicate finalization and failed-job retries preserve this choice,
even if history subsequently changes or expires. Already queued jobs retain
their earlier snapshots. Sessions finalized before an earlier result is saved
cannot count that result; this is a candidate-selection policy, not a strict
quota on eventual connections. It also cannot prevent the same cultural material
from returning through a different eligible word.

## Generation and results

Use the approved v7 prompt verbatim, `gpt-6.1-sol` with low reasoning, strict JSON
output, at most 4096 output tokens, and a 180-second transport timeout. The model
receives the eligible inventory rows and shared interests, without mistakes, mastery
claims, prompts, personal notes, or later history. The result contains zero to
ten notes, each with `text`, exact supporting `refs`, and nullable `followUp`.
Validate shape and known references before storing or displaying notes. An empty
successful result is ready with zero notes. Apply the 15-item generation minimum
to the eligible inventory after cooldown filtering. Fewer than 15 eligible rows
become ready with zero notes without a provider call or generation attempt;
15 or more queue generation. The displayed exercise count records the
original admitted inventory size.

Jobs are learner-private and durable. Provider work continues when the learner
leaves the summary, navigates away, refreshes, or closes the browser. A serial
backend worker processes the queue; one learner's running job may delay another.
It respects hosted maintenance, provider-work controls, and disabled accounts.
Queued jobs resume after backend restart. Running jobs have an attempt token and
lease longer than the provider timeout. An expired lease records an interrupted
attempt and a failed job with explicit retry: an unknown upstream outcome is
never automatically replayed. Token fencing prevents an old completion from
replacing a later attempt. Graceful shutdown drains active calls before closing
the database.

Provider failure, invalid or truncated output, and interruption are retryable
through a deliberate learner action. Retry applies only to failed jobs and
never regenerates ready results. Queued or failed jobs below the
15-eligible-row threshold settle to ready with zero notes during worker recovery,
queue enumeration, claim, or explicit failed-job retry, without a new attempt.
Ready results and concluded attempts are immutable; active calls use their
lease and completion handling. Persist concluded attempt timestamps, duration,
normalized token usage, response and finish identifiers when available, and the
versioned price basis and cost estimate. Cached writes replace their ordinary
input charge. Missing usage or a context outside the known short-context price
band yields an unknown estimate. Diagnostics and ordinary worker logs do not
include learner inventory, interests, provider credentials, or rejected prose.

## Retrieval and migration

The completed session can retrieve its own debrief. Home can retrieve the
latest completed debrief record for the current learner; this is a single-record
surface, not a history browser. A newer queued or failed job is returned instead
of silently falling back to an older ready job. No matching record returns null.
Every read, retry, and persistence transition preserves learner ownership.

Migration `0023_session_debrief` creates empty job and attempt storage. No old
summary receives a fabricated inventory or automatic provider call. Existing
databases require the ordinary stopped-writer offline migration before startup.

## Learner surface

Completing the last session unit immediately opens a compact completion screen
with a deterministic word report. After pending completion
is acknowledged, a fixed 15-second server deadline preserves final Undo. The
completion lifecycle, cancellation race, early closure, and navigation rules are
owned by [`session-progress-and-completion.md`](session-progress-and-completion.md#session-completion).
No separate confirmation is needed to enter this screen.

The report shows distinct new words studied (first-study units that entered
Practice) and distinct words graduated from Practice to Review by accepted work
in this session. It shows counts and word lists, omits empty groups, and is
provisional while Undo is available: staging previews the final action without
accepting it. Closure confirms the report from persisted transitions rather than
model-generated reporting or the number of Practice units covered.

The footer shows active study duration without an overall attempt or item count.
When the learner keeps the summary open, successful closure fades the countdown
and temporary notices over two seconds while retaining their layout space. Undo
becomes disabled and leaves the keyboard and accessibility navigation without
moving the report or footer. Reduced-motion preferences skip the fade.

Connections generation begins after backend closure and does not occupy the
immediate completion screen. Automatic return and **Return to Home** open
Home, where the latest session's Connections is accessible while queued, running,
or failed. The learner can open its ready notes in the reader.
Empty results omit the Connections section. Learners can explicitly open or
minimize a batch. New batches start expanded. Minimizing pending content holds
through readiness polling for that document visit; an unseen ready batch may
promote on a later visit. Once introduced, a batch's saved expanded/compact choice
persists across reload. The immediate completion summary may stay visible through **Keep summary open**; Home does
not provide a history or reopen action for that deterministic summary.

The focused Connections reader uses one exact provider paragraph per card, with
**Next connection**, **Back**, and **Done** on the last card. It adds no note
titles, subtitles, reference labels, follow-up questions, or chat UI. Right arrow
advances; left arrow goes back. Native controls, typing, IME composition,
repeated keys, modifiers, and the shortcut guide pause reader shortcuts.
Reading and navigation remain usable on narrow screens and with reduced motion.

Only queued/running records poll. Requests and timers are canceled on unmount,
and old completions cannot overwrite a retry or later surface. A lost retry
response reads the durable job before allowing another retry. Read errors have
a separate reload action; failed generation has deliberate **Try again**.
Ready with zero notes is a successful empty result. Content-improvement
reflection is independent of Connections.

The optional interests textarea participates in settings draft, Save,
and Cancel behavior, starts empty, and accepts at most 1000 characters. Enter
inside it inserts a newline. French uses the same completion deadline and deterministic report, and shows
neither Mandarin Connections nor interests.
