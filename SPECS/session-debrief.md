# Session debrief

Status: current Mandarin debrief contract. Debrief is a separate informational
result from reflection, its evidence, proposal authorization, and application.

## Completion and input

After accepted deferred study commits succeed, the frontend supplies one exact
inventory row per covered exercise with the durable session-summary write. Each
row contains only the encountered word text and pinyin; slash-separated
alternatives stay together. Learning and new-word exercises are included.
Undone or uncovered work contributes no row. An empty pinyin string truthfully
preserves an encounter without a pronunciation cue. Pure-cue accepted-answer
snapshots currently contain hanzi without pinyin, so their exact alternatives
use empty pinyin; this feature does not expand those snapshots. The backend does not
reinterpret or enrich this inventory from later lexical content.

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

Use the approved v6 prompt verbatim, `gpt-6.1-sol` with low reasoning, strict JSON
output, at most 4096 output tokens, and a 180-second transport timeout. The model
receives the whole inventory and shared interests, without mistakes, mastery
claims, prompts, personal notes, or later history. The result contains zero to
three notes, each with `text`, exact supporting `refs`, and nullable `followUp`.
Validate shape and known references before storing or displaying notes. An empty
successful result is ready with zero notes. An empty inventory becomes ready
with zero notes without a provider call.

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
never regenerates ready results. Persist concluded attempt timestamps, duration,
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
