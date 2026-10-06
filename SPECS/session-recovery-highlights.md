# Session recovery highlights

Deterministic, optional acknowledgment that repeatedly troublesome word recall
has become more reliable. Independent of generated reflection, with no scheduler
changes or mastery claim. V1 covers word review recognition and production only.

## Evidence and policy (`word_recovery.v1`)

- Use projected, accepted attempt history for the current learner. For each
  session/word/skill, take its earliest accepted attempt by session event sequence;
  it must be action attempt 1. Later reinforcement never supplies evidence.
- Recognition success is a correct outcome rated Hard, Good, or Easy. Production
  additionally requires a frozen strict target-only answer space and an
  `accepted_anchor` result resolved to that target. Incorrect/Forgot is a miss.
  Incomplete or incompatible evidence is a barrier, not a success.
- Count at most one encounter per UTC day. Any initial miss on that day takes
  precedence; otherwise excluded evidence takes precedence; otherwise use the
  first successful encounter. Replay is forward in time: later misses break an
  unfinished streak, but never un-consume a milestone already earned earlier
  that day. Such a miss starts fresh trouble evidence. Splitting sessions cannot
  accelerate recovery; success after a same-day miss does not count.
- Establish trouble on a missed day if **either** at least 3 of the last 5 daily
  encounters were misses, **or** there were at least 3 missed days in the inclusive
  30-day window ending that day (today plus the previous 29 UTC days).
- Trouble and improvement must both fit within the summary’s 30-UTC-day history window. Three
  consecutive successful encounter days earn a recovery milestone. Days without
  encounters are neutral. Misses and excluded evidence break the success streak.
- A milestone ends that trouble episode whether or not it was displayed. Only
  fresh encounters after it may establish a new trouble episode. Every run of
  three successful days clears preceding trouble evidence, even when the window
  clipped the misses that originally established that episode. Repeated later
  successes do not earn repeated highlights.
- Recognition and production are separate; cues may differ across production
  encounters. Do not imply equal exercise difficulty or general word mastery.
- Contrast selection, pure cues, new-word introduction and learning attempts,
  confused-pair diagnosis, long-gap recall, and rating-effort trends are excluded.

## Reflection corrections

Original attempts remain immutable. Active applied cue judgments, applied unfair
pair reconciliation/promotion, and actual scheduler restorations exclude their
source attempt from recall-trouble evidence. A valid applied unfair judgment
still matters if its historical restoration snapshot was unavailable. Pending,
failed, withdrawn, and unsupported operations do not change eligibility. A
cue-evidence judgment's retraction is distinct from a scheduler restoration.
Corrected encounters are barriers; they never manufacture successful recall.

Recompute against current applied corrections on each request. Later corrections
can remove a previously qualifying highlight on subsequent reads. No claim is
made to retract content already seen or to measure historical display exposure.

## Summary and read model

Only fetch after the final pending commit and durable summary write succeed.
Do not wait for or depend on reflection generation. Empty results and retrieval
failures add no learner-facing placeholder and never invalidate completion.
Display a shared **Coming back more reliably** heading and a wrapping list of
words, with Meaning / Word recall labels and the learner's character preference.
All words qualifying in that session may appear; no forced conversational copy.

The query uses evidence from midnight UTC 29 days before completion through
the requested summary’s completion timestamp,
including accepted actions from earlier unfinished overall sessions. It emits
only milestones whose third successful day first qualifies in that session.
The replay order is timestamp then stable attempt ID, with first-attempt
selection based on within-session sequence. UTC days avoid interpreting
client timezone changes as additional study days.

The learner-scoped response includes a stable derived ID, rule version, word,
skill, which trouble rule(s) matched, supporting trouble attempts, latest miss,
and the three success references (attempt/action/session IDs and timestamps).
Raw outcomes, ratings and served production snapshots remain available through
those durable references. No new table, analytics UI, exposure telemetry, model
call, or history backfill is introduced. Migration `0024_recovery_attempt_window`
adds a partial `(learner_id, occurred_at)` index for projected attempts so the
SQL read seeks directly into the bounded range. Existing databases require the
ordinary offline schema-migration procedure before running this release.
