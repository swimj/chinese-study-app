# Session composition: cheap streams and a bounded admission

status: winding-down
type: work-bundle
created: 2026-11-17
retire-when: Start and close have been re-measured in production after deployment
related:
  - notes/active/2026-11-16-performance-picture.md
  - SPECS/vocabulary-learning.md
  - docs/vocabulary-learning.md
  - docs/evaluation/trials/2026-11-07-session-composition.md

Plan for the first round of session composition work. Merged to main on
2026-11-17 as #556, #557, #558, #559 and #564; not yet deployed or measured in
production. The owning spec and implementation docs describe the shipped
behaviour; this note is the plan as agreed, kept for context.

Where the shipped stack departs from the plan below:

- Ranking: review words and due fragile cues share one urgency order, and
  pressing means overdue by at least a full interval (urgency of 2 or more).
  Skip-day counting is retired (#559), so closure reads no schedules.
- Compensation holds are also enforced when an item is served, and only strong
  cue rechecks keep a slot ahead of the review bound (#564).
- The pressing tier's remaining 30% draw is uniform over all rested items,
  pressing included.
- Not done: a rendered check of a timed session ending on an exhausted pool, and
  production re-measurement. Remaining work is in the performance picture note.

## Goal

Session start and close do work proportional to what a session serves, not to
everything due or everything the learner has. Learning policy stays as it is
except for two deliberate changes: each stream is capped on its own terms, and
the 50/30/20 bucket weighting is removed.

## Decisions taken

- No second structure. The ordered list is an index on due time over the
  existing schedule rows, so there is nothing to keep in sync.
- Ranking stays as today. The whole due set is read as narrow rows and ranked in
  memory by the current urgency rule; only the admitted items are gated and have
  content bound. Changing the ranking metric is a later, separate question.
- Composition is a few streams, each a cheap ordered read with its own policy,
  combined by a mix step at read time: new words, learning, review, fragile
  cues, strong cues, rechecks.
- Each stream has its own cap, and there is no cross-stream allocation:
  - new words: the daily new-word limit, as now;
  - learning: the entire due solidify set;
  - review and fragile cues together: 5 items per minute of the session's time
    allowance, taken from the top of the ranking;
  - strong cues: the daily roll over the strong set, with slots scaled to the
    admitted review count as now;
  - rechecks: all that are due, ahead of the rest, as now.
- The admitted streams are unified in memory. Pressing items are served through
  the pressing tier; everything else is drawn in random order, subject to the
  existing rest spacing. The 50/30/20 weighting is removed from both admission
  and in-session selection.
- No in-session top-up. A session that exhausts its
  pool before the time is up ends; "Study a little more" starts a fresh session
  as now.
- Content and every eligibility gate are read fresh at session start for the
  admitted items. A candidate that fails a gate is passed over and the next in
  rank takes its place.

## Admission details

- "Item" in the review bound means an admitted target (a word or a pure cue),
  not an encounter. A 20-minute day admits at most 100 review and fragile-cue
  items; a 5-minute extension at most 25.
- The caps apply to timed sessions. Untimed sessions keep their admission rule
  and only get the cheaper reads.
- Review and fragile cues share the bound the way they share the review order
  today: pressing items first, then urgency-ranked review with fragile cues
  interleaved, then the cut.
- Passed-over counting keeps its current scope: due review words not started
  gain a skip day; pure cues are counted only if admitted.

## Pressing and back pressure

- The pressing tier holds learning (solidify) words, plus review words and cues
  passed over on three separate days as now. This is the intended definition
  going forward, whatever the current code implies.
- New words are not pressing. They are drawn at random with the other
  non-pressing items, so a learner with a large due review pool reaches few new
  words and a caught-up learner reaches more. That back pressure is intended.
- The review bound admits only items that are due: up to 5 per minute, never
  padded with items that are not yet due.
- To check during change 3: a new word admitted at start but never reached must
  not consume the daily limit or be left in a half-started state.

## Delivery: a stack of four

Each change carries its own tests and doc updates. The first two change no
behaviour and are verified by equivalence; the third is the policy change.

1. **Due columns and indexes (schema release).**
   - Real, indexable due time for production schedules, recognition and
     contextual-selection states, and pure-cue schedules: the latest of next
     due, last studied plus interval, and any post-compensation recheck. (Superseded:
     generated columns cannot back a covering index; see below.) Prefer
     generated columns so no write path changes; verify SQLite accepts the date
     arithmetic there, otherwise write the column at the existing write sites
     through one shared function.
   - Interval, enabled flag, post-compensation check and strong-cue state move
     out of `scheduler_state_json` into real columns (keys removed from JSON),
     so each queue's first read is one sequential covering-index range; later
     probes from JavaScript resolve true state, so over-reading is fine. Due
     times are trigger-maintained columns: SQLite never treats an index as
     covering on a table with generated columns.
   - An index leading with learner and mode on `learner_words`, so studied words
     are found without scanning unstudied ones. Never-studied schedules must not
     sort as due.
   - Backfill in the migration; fail loudly on a row whose derived value cannot
     be computed.
2. **Stream reads, same results.**
   - Review selection reads due rows through the indexes, applies the word-level
     cooldown on the result, and ranks in memory exactly as today.
   - Pure-cue planning reads narrow rows, selects, and only then runs
     reconciliation checks and loads content for the selected cues.
   - Equivalence tests: old and new selection return identical ordered results
     on fixtures covering each skill, cooldown, recheck, suppression, refresh,
     never-studied objectives, and strong and fragile cues.
3. **Lazy gating, per-stream caps, and selection without bucket weights.**
   - Walk each stream's ranked candidates, gate each, stop when that stream's
     cap is filled.
   - Remove the 50/30/20 allocation from admission and the weighted bucket draw
     from timed selection; non-pressing items are drawn at random among rested
     items.
   - Retain content only for admitted items; the session payload shrinks with it.
   - Update `SPECS/vocabulary-learning.md` and `docs/vocabulary-learning.md` for
     the per-stream caps, the removed weighting, and the end-on-exhaustion
     behaviour.
4. **Close path.**
   - Passed-over counting uses the cheap due read instead of re-running full
     review selection with gates.
   - Check what else in the 15,000-statement close scales with the pool and
     report; fix what the smaller payload does not already remove.

## Evaluation

- Work counts: statements and content hydrations for Start and close on a
  production-shaped fixture (about 8,000 studied words, 300 due, 380 cues),
  asserted in tests as the earlier composition work did.
- Policy check for change 3: on the same fixture, the admitted set equals the
  top of today's ranking, per stream, up to that stream's cap; and over many
  seeded sessions, each admitted stream's share of picks matches the intended
  selection rule.
- Rendered check: a timed session that exhausts its pool before the allowance
  ends cleanly, at narrow width and enlarged text; "Study a little more" starts
  a fresh bounded session.
- Production: flight-recorder timings for Start and close before the stack and
  after each deployed step. Start has not been sampled directly yet; take that
  baseline first.

## Sequencing with other work

- The learner-word cleanup migration (#553) is independent and can ship first or
  alongside change 1 in the same schema release window.
- Database-level settings (memory, cache, `synchronous`, `ANALYZE`) remain
  deferred and are independent of this stack.

## Not in this round

In-session top-up or chunked admission; a prepared session reserve; caching gate
verdicts; a new ranking metric; thematic selection; the background scheduler.
Each is recorded in the performance picture note.
