# Timed session iterator — prototype design

status: active
type: research
created: 2026-11-11
revised: 2026-11-12
retire-when: superseded by an implementation spec, or declined
related:
  - notes/active/2026-11-10-daily-practice-orientation.md

Prototype design for a bounded daily practice. It is not shipped behavior, and
it does not set a delivery commitment. The orientation note describes the
broader direction. This note specifies a first selector that can be built and
lived with.

The policy here is deliberately rough. Its job is to put budget pressure on
what goes into a day, and to record enough that the places where it feels
wrong become visible. That discomfort is the forcing function for the next
revision. The session record is therefore part of the prototype, not a side
feature.

To the learner this is a new session paradigm, not an option inside the old
one. The app is in free beta, and existing session settings carry no promise
into it.

## A trainer's sense of how much

The learner says roughly how much they can do in a day: about 10, 20, or 30
minutes. They say it once, early, and then forget it. The system reads it the
way a trainer reads "I've got about half an hour": a fuzzy target, not a
contract. A day can end a little early or a little late to land on a natural
break, and the learner can always keep going.

The learner does not see a remaining-time meter, a pace, or the size of the
unserved due set. Home does not present the due ledger as the size of the
session. Changing the amount is a rare, deliberate trip to settings.

## The day and its entries

The budget belongs to the local study day, using the same 04:00 boundary as
the daily new-word ceiling. Sessions are entries into that day. Active time
adds up across the day's sessions, so a session interrupted at seven minutes
and resumed later simply continues the day.

Start never refuses because the day's budget is spent, and it never says the
day is done. Past the budget, a session serves more of the same walk. In this
first version, selection rules are identical before and after the budget: the
gate and the daily new-word ceiling apply the same way. What extra time should
be made of is an open question below.

## What the current runtime already provides

Most of the iterator exists today. Start freezes an admitted pool of due work
and ready teaching, up to the shared 1,000-item cap, in the session payload.
Order is not frozen: `selectNextWord` in `server/vocabulary/study.ts` draws
each next item live, using the 50/30/20 review / learning / unstudied weights
and the rotation rule. The session's `finishing` phase stops admitting new
work while open work completes, and `resume` returns to active study.

The prototype adds four things to that machinery:

1. A day budget that moves the session into `finishing` on its own.
2. A gate that keeps the unstudied bucket shut while pressing work is due.
3. A per-day skip count on held items.
4. A session record that shows what this policy served against the old one.

## What the iterator keeps

In-progress work is whatever the current runtime already treats as unfinished:
an open retry, an unfinished teaching skill, an unfinished Solidify direction.
The budget does not drop it.

Cross-session scheduling facts stay the current ones: interval, ease, due date,
Solidify progress, teaching streaks, pure-cue schedules. They change only when
an item is actually reviewed, by the current formulas. The skip count is stored
beside them and only this policy reads it.

## Classes

Candidates are whatever the current due rules already admit. The iterator
classifies them. It does not change those rules.

| Class | Qualifies when | Pressing |
| --- | --- | --- |
| Runway | Teaching already in progress, or a Solidify word not yet covered today | Yes |
| Held | A due Practice, Maintain, or pure-cue item | Once started and still owed work (for example after a miss), or once passed over on 3 separate days |
| New | A not-yet-started word, inside the existing daily new-word ceiling | No |

There is no separate repair class. A failed review already drops to the short
interval, and review order ranks by urgency, so a lapsed item returns near the
front of the review portion the next day without a special rule. Pure-cue
rechecks keep their current place at the front of the review order. Under the
view that recall serves language growth, a lapse is information, not an
emergency. It should come back soon, and it has no automatic claim over a new
word.

The skip threshold of 3 is a starting constant, not a tuned result. It counts
days on which the item was passed over, not time since it fell due, so an
absence from study does not turn the whole backlog pressing on return. Rejoining
stays the same gesture.

## Next item

Each request for a next item follows this order.

1. If the day's budget has been reached, move to `finishing`: in-progress work
   still completes, and nothing new begins. That overshoot is the fuzz in the
   budget. The learner's keep-going choice resumes ordinary selection.
2. Only rested items are candidates. Each appearance gives an item a fresh
   minimum rest of 2 to 5 cards, chosen at random, so returns do not fall into
   a pattern and memory has a little time to fade. There is no maximum gap.
3. Seven picks in ten try the pressing tier first: a rested pressing item,
   chosen at random. When none is rested, or on the other three picks, draw one
   bucket with the existing weights from the rested non-pressing items, and
   take one candidate from it. If no non-pressing item is rested, take a rested
   pressing item; if nothing is rested at all, take whatever has waited
   longest, so a short drain never stalls.

In-progress work is pressing, so a miss comes back through the tier rather than
through a fixed gap. With few pressing items, ordinary work fills the rests
between their appearances. With many, choosing among them spaces each one out.
The non-pressing share keeps some ordinary work in every stretch of the day,
including on days with a large Solidify pile.

Review and learning stay open while time remains. Unstudied, the new-word
bucket, is shut while any pressing candidate is due, including a fresh miss. It
opens when no pressing candidate is left. New words then begin one at a time
under the same weights. A future minimum share of new words could make new
words occasionally pressing; this version has none.

Inside the review bucket, the current rotation and urgency order stand.

The system owns where new words go. The learner's introduction-order and
spacing settings do not apply in this mode, and the settings panel hides them.
How best to introduce new words to someone who has never thought about it is
part of what this prototype is for.

A day with pressing work still due at the end of the budget never reaches a new
word. A day that clears pressing work early spends the remainder on ordinary
held items and new words, interleaved by the weights.

Runway pressure regulates intake. A large Solidify pile keeps new words shut,
and with no new words arriving the pile can only shrink as words graduate. New
words return once it fits in a day. If the pile far exceeds a day's budget,
graduation slows and new words stay shut for a while. The session record shows
when the gate held; a cap on how much Solidify counts as pressing waits for
evidence that it is needed.

## The clock

The client already measures active study time across visibility and focus
changes. It sends that measure with each Next request. The server adds the
day's earlier sessions and decides whether the budget has been reached. A long
pause with the tab still focused still counts; that is acceptable for this
version. Trusting the client is appropriate because the budget is the learner's
own soft target, not a grade or a schedule input.

There is no duration estimate on this path.

## Within a session and across sessions

Within a session, responsiveness is the in-progress rule and the budget. A miss
keeps that item in the session under the current retry rule: the failed
exercise stays available for a later retry, and completion after a rejection
needs three consecutive successes. A miss does not pull a different item in.

Across sessions, responsiveness is the existing interval update plus the class
rules. A lapse returns soon through urgency. A success lengthens the interval
by the current formula, including when the gap was longer than the old due
date. Being passed over repeatedly makes a held item pressing, so neglect raises
its claim without rewriting its due date.

## After a session

Started items update exactly as they do now. Items that were not started are not
reviews. Their interval, ease, and due date stay put.

At closure, each held item that was due and not started has its skip count
incremented, at most once per local study day. This includes due items left out
of the frozen pool by the 1,000-item cap; otherwise the cap could hide items
from the count indefinitely. Serving an item clears its count. Runway items left
unstarted stay eligible by their own rules and do not use the count.

Store a session record: the day's budget, the session's active time, the day's
accumulated active time, how many new words were started, whether the gate kept
the new-word bucket shut, and the ids of pressing items that went unstarted. Per
started item, store its class, its classic due date at serve time, whether its
last outcome before this session was a lapse, and the outcome. That is enough to
see when this policy served an item compared with the old rule, whether recall
held across that gap, and how lapsed items fared without a repair class.

## Saying something

Completion always offers one quiet, optional line: anything about today you
would want different. It appears the same way every day. It is not tied to
unstarted work, it never blocks leaving, and it never changes a schedule. It is
the tap on the glass from the orientation, placed where a learner who already
has a thought can leave it with no friction.

The line is stored on the session for later reading beside the record. It is
not an input to the iterator.

## Switchback

Switchback is our rollback, not a learner toggle. Selecting by the classic due
rules again, and ignoring skip counts, restores the old session. Intervals
reflect the reviews that actually happened. Skipped items reappear as overdue.
Their due dates were never moved to hide that.

## Open questions

- **What extra time is made of.** Past the budget, should new words that the
  gate held back during the budgeted time become available? This version
  applies the same rules throughout. A lean toward held review after the budget
  would absorb an energetic day as lighter future days rather than more intake.
- **Whether a word should matter less.** One lapse cannot distinguish an
  instinct that needs reseeding from a word that is not live in the learner's
  Chinese. Budget pressure should make this question concrete. Lapses are
  recorded per served item so the pattern can be read later.
- **An independent signal of value.** The longer direction is a second view of
  the learner's practical working vocabulary: which words came up in situations
  the app can see. With it, the app could judge that a miss is not urgent to
  strengthen because nothing in view would have called on that word. That is
  the bigger-picture judgment a good teacher supplies.
- **Fresh versus flat.** This prototype does not decide which known word would
  make a repeated review feel fresh. A shorter day made mostly of words the
  learner already has can feel flatter than a day padded with new words. The
  session record is there so this can be checked against what was served.
  Estimates of how much fits in twenty minutes can be derived from the same
  record later. They are not inputs here.
