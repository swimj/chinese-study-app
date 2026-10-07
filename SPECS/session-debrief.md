# Session debrief

Status: current Mandarin debrief contract. Debrief is a separate informational
result from reflection, its evidence, proposal authorization, and application.

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
Space, Enter, and right arrow advance; left arrow goes back. Native controls,
typing, IME composition, repeated keys, modifiers, and the shortcut guide pause
these shortcuts. The finalized study keyboard handler yields to this surface.

Queued and running summaries show a waiting state and may be left immediately.
Home gives the latest completed session's connections the main reading area,
under **Recent Connections**, using a turning ring of exact note text. Left/right
arrow keys turn the ring while expanded; editing, composition, modifier keys, and
other interactive widgets retain their native keys. Neighboring cards turn the
ring on click and offer hover feedback, without visible arrows. There is no
separate pagination bar, visible position counter,
or session date/exercise metadata in this Home surface. Position remains available
to assistive technology. Moving forward from the final note to the first briefly
traces a green dot around the main card, leaving a green border behind it. Once
the outline is complete, it pulses once and returns to the base border. Reduced
motion uses a still border cue without tracing or pulsing.
Neighbor previews and the compact preview are literal excerpts, not generated
titles or new relationships. The left navigation stays in place. Start session,
and settings remain available above the expanded connections. Study metrics are
hidden while expanded and return when minimized. Small screens replace side-card
previews with small arrow controls, leaving the main note at full reading width;
long notes grow the page rather than shrinking the text.

Minimize restores the ordinary Home overview with the first connection's preview
and total count. Clicking that preview returns to the ring; there is no separate
Expand button. Pending and failed compact previews also open the focused view.
A newly completed session defaults
to expanded; merely starting a session does not reset a choice. Browser-local
preferences are keyed by the completed session id and contain only presentation
booleans. Once ready notes are presented in the expanded view, the learner's
subsequent toggle persists across page reloads for that session.

Queued/running results can occupy the expanded area with a quiet orbital waiting
animation (static under reduced motion). Minimizing while waiting holds through
polling, settings, and in-app navigation for the rest of that document visit.
If those notes have not been proactively opened, a later document reload expands
them once ready. Explicitly expanding acknowledges
that batch, including while it is pending, and cancels this deferred introduction.
Ready-empty results keep the ordinary Home overview. Failed results retain an
explicit retry, and read errors retain a separate reload action.

Home does not reopen the old summary view. The immediate post-session summary,
including recovery highlights, remains in the existing card component. A visible live
summary reads its own immutable session id; latest retrieval cannot replace it.
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
