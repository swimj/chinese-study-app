# Timed session iterator — prototype design

status: active
type: research
created: 2026-11-11
retire-when: superseded by an implementation spec, or declined
related:
  - notes/active/2026-11-10-daily-practice-orientation.md

Prototype design for a bounded daily session. It is not shipped behavior, and it
does not set a delivery commitment. The orientation note describes the broader
direction. This note specifies a first selector that can be built and lived
with.

The session stays an iterator. Nothing is packed in advance. Each served item
uses the current exercise and the current interval update. The new behavior is
when a not-yet-started item is allowed to begin, and which facts that decision
reads.

## Learner entry

The learner picks about 10, 20, or 30 minutes. That choice is the budget. The
session does not display a remaining-time meter, a pace, or the size of the
unserved due set.

Home does not present the full due ledger as the size of the session. The
choice of duration is the entry.

## What the iterator keeps

In-progress work is whatever the current scheduler already treats as unfinished:
an open retry, an unfinished teaching skill, an unfinished Solidify direction.
The clock does not drop it.

Cross-session scheduling facts stay the current ones: interval, ease, due date,
Solidify progress, teaching streaks, pure-cue schedules. They change only when
an item is actually reviewed, by the current formulas. A separate skip count,
stored beside those fields, records that a due item was eligible and not
started. Serving the item clears the count. Switching back to the classic due
rules ignores the skip count.

## Classes

Candidates are whatever the current due rules would already allow. The iterator
classifies them. It does not change those rules.

| Class | Qualifies when | Pressing |
| --- | --- | --- |
| Runway | Teaching already in progress, or Solidify not yet cleared | Yes |
| Repair | Last outcome was a lapse and the item is still on the short interval, including pure cues | Yes |
| Held | A successful Practice, Maintain, or pure cue that is due | Only after repeated skips |
| New | A not-yet-started word, inside the existing daily new-word ceiling | No |

A held item becomes pressing when its skip count reaches 3. That threshold is a
starting constant, not a tuned result. Ordinary held items that are merely due
are not pressing.

## Next item

Each request for a next item follows this order.

1. If an in-progress item is still owed a retry or the rest of its current
   exercise, return that.
2. If the budget has already elapsed, stop. Do not begin anything with no
   progress. In-progress work still finishes, and that overshoot is the fuzz in
   the budget.
3. Otherwise draw one bucket with the existing review / learning / unstudied
   weights, from the buckets that are open, and take one candidate from it.

Review and learning stay open while the clock is running. Unstudied, the new-word
bucket, is shut while any pressing candidate is due. It opens when a draw finds
no pressing candidate and time remains. New words then begin one at a time under
the same clock.

Inside the review bucket, a pressing candidate is taken ahead of an ordinary
held item. Past that, the current urgency order stands. One candidate per open
bucket is enough for the weight draw. Those candidates are not a plan. The next
draw sees the stats as they are then.

There is no duration estimate on this path. The wall clock decides when to stop
starting new work.

A heavy day, with pressing work still due at the end, never reaches a new word.
A day that exhausts pressing work early spends the remainder on ordinary held
items and new words, interleaved by the same weights. The large ordinary-due
tail does not by itself keep the new-word bucket shut. Items in that tail are
still reached over time, because a held item that is skipped often enough
becomes pressing.

## Within a session and across sessions

Within a session, responsiveness is the in-progress rule and the clock. A miss
keeps that item in the session under the current retry rule. It does not pull a
different item in, and it does not extend the set of not-yet-started work.

Across sessions, responsiveness is the existing interval update plus the class
rules. A lapse comes back as repair and is pressing. A success lengthens the
interval by the current formula, including when the gap was longer than the old
due date. Repeatedly missing the clock makes a held item pressing, so neglect
raises its claim without rewriting its due date.

## Post-session

Started items update exactly as they do now. Items that were not started are not
reviews. Their interval, ease, and due date stay put.

At the end, query the items that were due and not started, and increment the
skip count for the held and repair items among them. Runway items left unstarted
stay eligible by their own rules and do not use this count.

Store a session record: the chosen budget, actual elapsed time, how many fresh
items were started, how many of those failed, and the ids of pressing items that
went unstarted. Per started item, store its class, its classic due date at
serve time, and the outcome. That is enough to see the gap between when the old
rule would have shown an item and when this one did, and whether the recall held
across that gap.

When any due candidate went unstarted, completion may offer two optional
responses. Neither blocks leaving, and neither changes a schedule.

- **I'm good.** Records that there was no further want.
- **One line.** What they would have wanted to keep doing. No word list, no
  exercise types, no interval, no rating.

The line is stored on the session for later reading beside the unstarted ids.
It is not an input to the iterator. On a day when every due candidate was
started, the prompt stays absent.

## Switchback and known limits

Selecting by the classic due rules again, and ignoring skip counts, restores the
old session. Intervals reflect the reviews that actually happened. Skipped items
reappear as overdue. Their due dates were never moved to hide that.

This prototype does not decide which known word would make a repeated review
feel fresh. A shorter day made mostly of words the learner already has can feel
flatter than a day padded with new words. That observation belongs to the next
design, and the session record is there so it can be checked against what was
actually served. Estimates of how much fits in twenty minutes can be derived
from the same record later. They are not inputs here.
