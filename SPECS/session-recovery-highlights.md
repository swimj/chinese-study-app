# Session recovery highlights

Deterministic, optional acknowledgment that repeatedly troublesome word recall
has become more reliable. Independent of generated reflection, with no scheduler
changes or mastery claim. V1 covers word review recognition and production only.

## Evidence and policy (`word_recovery.v1`)

- Start with the learner's current-session word/skill pairs. Any raw accepted
  lapse in that pair's session batch disqualifies it, compensated or not. Do not
  load earlier attempt history or corrections for a disqualified pair.
- A surviving candidate must have a successful first accepted attempt. Recognition
  success is a correct outcome rated Hard, Good, or Easy. Production additionally
  requires a frozen strict target-only answer space and an `accepted_anchor`
  result resolved to that target. Incorrect/Forgot is a miss. Incomplete or
  incompatible evidence is a barrier, not a success.
- For historical session/word/skill encounters, use the earliest accepted attempt
  by session event sequence; it must be action attempt 1. Reinforcement never
  supplies historical success or trouble evidence.
- Inspect one candidate at a time, backward through its own encounters, within
  the summary's 30-UTC-day history window. Compensated historical encounters are
  neutral: skip them without counting a success, counting a miss, or breaking a
  streak. Unknown/incompatible encounters remain barriers to successful recall.
- Require exactly three consecutive successful encounter days ending at the
  current candidate. Fewer than three before a miss/barrier fails; a fourth
  successful day fails because the milestone belongs to an earlier session.
- Count success at most once per UTC day. The first successful encounter earns
  the day. Another session on the same day cannot earn it again. A prior initial
  miss or unknown result that day prevents later success from earning that day.
  Neutral-only days are skipped like days with no study.
- Once the three successes are established, continue backward from the most
  recent missed day to find three distinct missed days. Stop without a highlight
  if an earlier run of three successful days is reached first: it closes the
  earlier trouble episode, even if its original misses fell out of the window.
  Preserve within-day ordering for this check: a morning third success followed
  by an afternoon miss must not reopen the already-closed older episode.
- Trouble is the union of at least 3 misses in the preceding 5 counted encounter
  days and at least 3 missed days within 30 days. With the strict 30-day overall
  window, three distinct missed days suffice; retain which rule(s) the selected
  evidence supports. References identify the nearest three supporting missed
  days, not necessarily the first moment an episode met its trouble threshold.
- A new highlight after recovery requires fresh trouble. No recovery flag,
  milestone row, or counter is saved: each candidate query derives its result
  from accepted attempts. Trouble and improvement outside the window are ignored.
- Recognition and production are separate; cues may differ across production
  encounters. Do not imply equal exercise difficulty or general word mastery.
- Contrast selection, pure cues, new-word introduction and learning attempts,
  confused-pair diagnosis, long-gap recall, and rating-effort trends are excluded.

## Reflection corrections

Original attempts remain immutable. Active applied cue judgments, applied unfair
pair reconciliation/promotion, and actual scheduler restorations make their
historical source attempt neutral. A valid applied unfair judgment still matters
if its historical restoration snapshot was unavailable. Pending, failed,
withdrawn, and unsupported operations do not change eligibility. A cue-evidence
judgment's retraction is distinct from a scheduler restoration. The current
session's raw-lapse rejection happens before these corrections are considered.

Use current applied corrections on each request. Later corrections can change
whether a previously considered candidate qualifies on subsequent reads. No
claim is made to retract content already seen or measure display exposure.

## Summary and read model

Only fetch after the final pending commit and durable summary write succeed.
Do not wait for or depend on reflection generation. Empty results and retrieval
failures add no learner-facing placeholder and never invalidate completion.
Display a shared **Coming back more reliably** heading and a wrapping list of
words, with Meaning / Word recall labels and the learner's character preference.
Mandarin shows this independently above generated connections in the finalized
debrief, including sessions reopened from Home; other profiles retain the summary
placement. All words qualifying in that session may appear; no forced conversational copy.

First read current-session results. If no candidates survive, return immediately.
Fetch history only for the surviving word/skill pairs in one bounded SQL query,
then inspect each candidate independently. History runs from midnight UTC 29 days
before completion through the requested summary's completion timestamp, including
accepted actions from earlier unfinished overall sessions. Sort by timestamp then
stable attempt ID; first-attempt selection uses within-session sequence. UTC days
avoid interpreting client timezone changes as additional study days.

The learner-scoped response includes a stable derived ID, rule version, word,
skill, which trouble rule(s) matched, three supporting trouble attempts, latest
miss, and three success references (attempt/action/session IDs and timestamps).
Raw outcomes, ratings and served production snapshots remain available through
those durable references. No new table, analytics UI, exposure telemetry, model
call, or history backfill is introduced. Migration `0024_recovery_attempt_window`
adds a partial `(learner_id, occurred_at)` index for projected attempts so the
history read seeks directly into the bounded range. Existing databases require
the ordinary offline schema-migration procedure before running this release.
