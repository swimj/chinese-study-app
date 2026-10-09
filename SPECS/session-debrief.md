# Session debrief

This contract helps contributors understand what the Mandarin session debrief
promises: which completed work informs it, how results survive failures, and how
learners return to their connections. Debrief is an informational result separate
from reflection, its evidence, proposal authorization, and application.

## Completion and input

After accepted deferred study commits succeed, the frontend supplies one exact
inventory row per covered exercise with the durable session-summary write. Each
row contains only the encountered word text and pinyin; slash-separated
alternatives stay together in their frozen accepted order, joined with ` / `.
The encounter uses the selected card character presentation. Contrast rows use
the actual prompt target rather than the scheduled anchor. Learning and new-word
exercises are included once their word unit is covered. Reinforcement attempts
add no extra row; separate covered actions can repeat the same word.
Undone or uncovered work contributes no row. An empty pinyin string truthfully
preserves an encounter without a pronunciation cue. Pure-cue accepted-answer
snapshots currently contain hanzi without pinyin, so their exact alternatives
use empty pinyin; this feature does not expand those snapshots. The backend does not
reinterpret or enrich this inventory from later lexical content.

Sessions admit at most 1000 units under the shared session cap; the supplied
inventory accepts at most that same 1000 rows. Completion preserves every
covered exercise rather than truncating the inventory to satisfy validation.

The completed summary and first debrief job are saved in one transaction.
Finalization failure permits the existing retry; successful completion is never
reopened by provider or debrief-result failure. Repeated finalization preserves
the first job snapshot. Legacy callers that omit the optional inventory save
only their summary. French does not enqueue this Mandarin provider flow.

The immutable input records the UTC completion timestamp, sequential `w1`, `w2`
references, exact inventory strings, and the learner's interests at completion.
Interests are an optional learner-owned settings text field, initially empty.
They establish curiosity, not expertise or biography. Changing interests affects
future snapshots; failed-job retries reuse the original input.

## Generation and results

Use the approved v7 prompt verbatim, `gpt-6.1-sol` with low reasoning, strict JSON
output, at most 4096 output tokens, and a 180-second transport timeout. The model
receives the whole inventory and shared interests, without mistakes, mastery
claims, prompts, personal notes, or later history. The result contains zero to
ten notes, each with `text`, exact supporting `refs`, and nullable `followUp`.
Validate shape and known references before storing or displaying notes. An empty
successful result is ready with zero notes. Inventories with fewer than 15
covered exercises become ready with zero notes without a provider call or
generation attempt. At 15 exercises, ordinary queued generation applies.

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
never regenerates ready results. Existing queued or failed jobs below the
15-exercise threshold settle to ready with zero notes during worker recovery,
queue enumeration, claim, or explicit failed-job retry, without a new attempt.
Already ready results and concluded attempts remain immutable; active calls
retain their ordinary lease and completion handling. Persist concluded attempt timestamps, duration,
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

The last rated card and its Undo opportunity remain visible until **See session
summary** (Enter) successfully finalizes the session. The Mandarin summary then
uses the same paper deck as study, with completion date and covered-exercise
count in place of study counters. It presents one exact provider paragraph per
card, with **Next connection**, **Back**, and **Done** on the last card. It adds
no note titles, subtitles, reference labels, follow-up questions, or chat UI.
Space returns to Home from any summary state, including loading, failed, and
empty results. Right arrow advances connections; left arrow goes back. Enter
has no summary navigation shortcut. Native controls,
typing, IME composition, repeated keys, modifiers, and the shortcut guide pause
these shortcuts. The finalized study keyboard handler yields to this surface.

Queued and running summaries show a waiting state and may be left immediately.
Home makes the latest completed session's connections available for focused
reading, with a compact preview that lets learners return to the ordinary Home
overview. Both use the existing note text rather than generating additional
content. Learners can navigate the notes with pointer and keyboard controls;
reading and navigation remain usable on narrow screens and with reduced motion.

A newly completed session introduces its connections in the focused view;
starting a session does not reset the learner's choice. The learner can minimize
or reopen connections, and that choice is remembered in the same browser for the
completed session. Minimizing while generation is pending holds through polling
and in-app navigation for that visit. On a later page reload, ready notes are
introduced again unless the learner has already explicitly reopened that batch,
even while pending. Once introduced, subsequent presentation choices persist
until another completed session. Empty results show the ordinary Home overview
without a connections section; pending and failed results remain accessible, with explicit recovery
from generation failures or read errors.

Home presents connections rather than reopening the post-session summary.
The immediate summary, including recovery highlights, remains available after
completion. A visible summary reads its own immutable session id; latest
retrieval cannot replace it.
Only queued/running records poll. Requests and timers are cancelled on unmount,
and old request completions cannot overwrite a retry or later surface. A lost
retry response reads the durable job before allowing another retry. Read errors
have a separate reload action; failed generation has deliberate **Try again**.
Ready with zero notes is a successful empty result.

The optional interests textarea participates in existing settings draft, Save,
and Cancel behavior, starts empty, and accepts at most 1000 characters. Enter
inside it inserts a newline. French retains its existing completed summary and
shows neither debrief entry nor interests. Content-improvement reflection remains
independent; the live debrief offers its status/retry in a collapsed disclosure.
