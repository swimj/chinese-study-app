# Archived: Session progress and completion

Archived after the Mandarin vocabulary cutover. This is a historical design
record; current requirements are maintained in the [product contract](../vocabulary-learning.md)
and [architecture contract](../vocabulary-architecture.md).

This document preserves the earlier runtime's in-session covering, Undo and
deferred-commit contract. It explains the relationship between pending work
and durably accepted study in that model.

[Adaptive vocabulary study](../vocabulary-learning.md#live-session-and-completion)
owns current Mandarin completion behavior; the
[architecture contract](../vocabulary-architecture.md#completion-and-failure-boundaries)
owns durable acceptance constraints. The rules below describe the earlier
runtime and support interpretation of historical evidence.

<a id="session-covering-criteria"></a>

Related design sources are the [earlier lifecycle](learning-review-model.md),
[teaching design](../word-bootstrap-and-introduction.md), and
[pure-cue contract](../pure-cue-elicitation.md). These links retain the earlier
model's relationships; current vocabulary requirements have their own owners above.

## Scope

This spec is about in-session behavior and commit boundaries.

It does not yet define:

- aborted-session behavior
- long-term interval policy details beyond the commit payload needs

## Intra-session ordering

The **Study new words first** session setting defaults to off and is saved per
learner. When enabled, every admitted new word's introduction runs before review,
learning, or new-word recall. Completing an introduction leaves that word's recall
pending while the remaining introductions run. Once all introductions finish,
recall uses the ordinary weighted scheduler below. The setting is captured at
session start and preserved through Undo; it does not change admission or covering.

With the setting off, introductions follow the weighted
scheduler. The live session interleaves nonempty buckets with weighted random selection:

| Bucket | Weight |
| --- | ---: |
| review | 50 |
| learning | 30 |
| unstudied | 20 |

The backend admits at most 1000 units across all three buckets. Each word-level
learning or unstudied unit counts once; each review action, including a standalone
pure cue, counts once. Above the cap, admission allocates slots in the same
50/30/20 proportions, redistributing unused slots from smaller buckets among
the remaining buckets and rounding fractional slots by largest remainder.
Each bucket preserves its internal order. Excluded units retain their
durable study state and remain eligible for future sessions; they add no covered
inventory or commits. Pure-cue served snapshots are issued only for admitted
review items.

The scheduler RNG is seeded from the frontend session id so the
new / learning / review cadence varies across sessions. Tests may pass an
explicit seed to keep sequences deterministic.

The unstudied bucket is the backend-admitted snapshot from the experimental
dual-pool intake policy in `study-action-model.md`. Covering, undo, and
bucket weights do not distinguish diet from stash.

Within a selected bucket:

- review keeps the backend-composed order
- learning and unstudied draw a remaining uncovered word from the pool, then
  choose an open skill at random

## Core Principle

The frontend owns in-flight session state.

The backend owns durable study state.

A unit is committed back to the backend only once it satisfies that unit's covering criteria for the session.

Commit granularity depends on state:

- `unstudied` and `learning` commit at the word level
- `review` commits at the review-item level

## Attempt Outcomes

For the purposes of this spec:

- `Forgot` means the user failed recall
- `Hard`, `Good`, and `Easy` mean the user successfully recalled the prompt

## Unstudied Word Covering

An `unstudied` Mandarin word uses its pinned teaching beats for the initial
introduction. Finishing those beats opens the recall phase; it does not
complete the word unit or award study credit. Recognition uses the package's
curated source material, and production uses its constrained target rehearsals.
Both directions require three consecutive `Good` ratings. A non-`Good`
rating resets only the corresponding direction's streak.

Recall appearances use the ordinary weighted bucket scheduler, interleaving with
review, learning, and other new words when present. This is probabilistic
interleaving, not a guaranteed minimum gap; a lone remaining word can repeat.
Recognition starts with the first bootstrap use and cycles through uses in source
order after each recognition rating, including misses, wrapping as needed. Undo
restores the previous reveal and position. Completing recognition requires three
consecutive `Good` ratings even when some uses have not been shown.
Production selects the rehearsal at the current production streak modulo the
package's rehearsal count. A reset therefore returns to the first rehearsal;
coverage is per direction, not a requirement to complete every authored exercise.
The package and content remain frozen through the session and Undo. Generic
rehearsal framing is presentation owned by the frontend, separate from the
persisted base cue and answer contract. The default shows the cue without a
generic preamble; content-specific instructions, when present, remain visible.

Only completing both recall streaks covers the word through the
deferred commit and Undo path. Merely opening or completing it in My Words grants
no study credit; a saved navigation-completion marker does not automatically
complete a later session unit.

Mandarin admits a new word only when its teaching/source snapshot is ready at
session entry. Missing preparation reduces the new-word count; it never causes a
generation wait or content fetch inside the session. The prepared walkthrough
has no skip-to-legacy-cards control or Escape bypass. The learner can leave via
the normal session controls without advancing the teaching gate. Other profiles
use the two-phase first encounter below. First-study preparation/replenishment effects follow the durable commit,
not provisional covering or navigation, preserving deferred commit and Undo.

### Phase 1: Intro

The system first shows the word with all of its information.

This includes the full reference information for the word, such as:

- hanzi
- pinyin
- meaning
- example sentence(s)

The user decides when they are ready to proceed beyond this introduction.

### Phase 2: Recall

After the introduction, the user must successfully recall:

- forward direction 3 times in a row
- reverse direction 3 times in a row

within the same session.

When both directions still need recall work, the session scheduler should choose
randomly between the open directions on each appearance. Once only one
direction remains open, the scheduler should serve that direction.

Only after both directions satisfy that criterion is the `unstudied` word considered covered for the session.

## Learning Word Covering

A `learning` word is covered in a session when:

- each direction has received `Good` at least once in that session

There is no requirement for repeated consecutive success within the same session.

When both directions are still uncovered, the session scheduler should choose
randomly between the open directions on each appearance. Once only one
direction remains uncovered, the scheduler should serve that direction.

This is intentionally looser than `unstudied` and `review` reinforcement behavior.

## Learning Word Session Success

Coverage and success are distinct.

A `learning` word can be covered without being a successful learning-session result.

A `learning` word has a successful session outcome when:

- both directions receive `Good` on their first try in that session

If that does not happen, but the word is eventually covered, the session outcome is considered failure for learning-streak purposes.

## Review Item Covering

A `review` item is evaluated one direction at a time.

### Immediate pass

If the user's first outcome is:

- `Hard`
- `Good`
- `Easy`

then the review item is immediately covered for the session.

### Lapse and reinforcement

If the user's first outcome is `Forgot`, the item enters same-session reinforcement.

The user can successfully recall that same review item 3 times in a row, or choose **Skip reinforcement** to cover it for the session. This applies to word reviews and standalone pure cues. Skipping preserves every recorded attempt and failure, adds no recall attempt, and commits the ordinary lapse outcome (including its 6-hour scheduling reset). The completion API must explicitly carry `reinforcementSkipped: true`; without it, three consecutive successful recalls remain required after a lapse. The flag is invalid for clean or already-covered reviews. It neither requests nor assumes compensation. Undo restores reinforcement with its prior progress, following the ordinary rating Undo behavior (a submitted production answer returns to input).

The skip button is available on an active reinforcement card, before or after revealing its answer. **Shift+Space** invokes it outside editable fields; it is suppressed during IME composition. The frozen feedback card for an automatic miss must first be continued with Continue.

Any additional failures during this reinforcement count toward the item's session failure count.

## Contrast Selection Review Covering

A contrast-selection review item is evaluated as one contextual-choice action.

The user selects one choice from the presented contrast set.

### Correct choice

If the selected choice matches the prompt target:

- the answer is revealed
- the user rates the distinction as `Hard`, `Good`, or `Easy`
- the item is immediately covered for the session

`Forgot` is not a valid rating for a correct contrast selection.

### Incorrect choice

If the selected choice does not match the prompt target:

- the answer is revealed immediately
- the item is automatically rated `Forgot`
- the item is immediately covered for the session
- the backend receives the selected wrong choice and the correct prompt target

`Hard`, `Good`, and `Easy` are not valid ratings for an incorrect contrast selection.

Unlike a normal review lapse, contrast selection does not enter same-session
reinforcement in this version. Its failure is reflected in the contextual
selection scheduler state.

## Undo Semantics

Undo restores the most recent session-affecting transition whose study outcome
has not yet been durably accepted. Ordinary study Undo is frontend-only. During
the final completion window, the backend also owns a pending completion that
must be canceled before the frontend restores study state.

The frontend may hold at most one undoable transition.

An undoable transition begins when user action changes session progress:

- rating a recognition or production review card
- submitting a production answer that matches no word in the served accepted
  set, which is automatically rated `Forgot`
- choosing **No clue** on an unanswered typed-production item, which records no
  response and is automatically rated `Forgot`
- selecting an incorrect contrast choice, which is automatically rated `Forgot`
- rating a correct contrast choice as `Hard`, `Good`, or `Easy`
- completing a learning or unstudied word unit

The transition is applied to frontend session state immediately, but its backend
commit remains deferred while the undo window is open.

The undo window closes when:

- the user rates or auto-rates another item
- the user ends the session
- the user performs a destructive management action on the pending item
- the pending commit is successfully sent to the backend

When undo is performed, the frontend must restore atomically:

- bucket session state
- session summary
- answer reveal state
- production input and frozen production UI state
- selected contrast choice and frozen contrast UI state
- pending backend commit, cleared
- pending production mistake capture, cleared if it came from the undone transition

Ordinary study Undo must not call the backend. Final-window Undo first cancels
the backend pending completion atomically. Cancellation succeeds only before
its deadline; after closure, the frontend must not restore the old study state.

After undo, the user should see the card state from immediately before the
undone session-affecting transition.

For an incorrect contrast selection, undo from either the frozen correction card
or the next active card restores the original contrast prompt to an unanswered
state: no selected choice, no revealed answer, and no pending contrast commit.

## Content quality overlay

Optional thumbs-up/down feedback is one standing rating per learner and exact
content revision, reused across encounters. It saves independently of session
commits; Undo changes neither this rating nor the fact that content was shown.
Quality is descriptive only and has no effect on grading, coverage, scheduling,
publication, or reflection generation. Feedback failures must not block study.
See [content quality](../../docs/content-quality.md) for supported surfaces,
keyboard behavior, exposure semantics, and operator analytics.

<a id="completed-session-reflection-boundary"></a>

## Session completion

Completing the last word or standalone exercise immediately opens the completion
screen with the final answer and Undo opportunity. This applies to natural
completion and completed drain mode. There is no intermediate confirmation to
open a summary.

The frontend saves a pending completion containing the final deferred action,
summary, exact debrief inventory, and reflection supplement. Show **Saving…**
until the backend acknowledges this record, then display a 15-second countdown
from its fixed server deadline. The final action remains unaccepted during this
window. Undo cancels pending completion before the deadline and restores study;
completing again creates a fresh window. Repeated requests and reopening the
same pending completion preserve its original deadline.

At expiry the backend accepts the final action, records the completed summary,
and durably schedules Connections and qualifying reflection. The completion
screen returns to Home when closure succeeds. **Return to Home**
closes early. Navigation to another page within the app uses the same closure
operation and preserves the selected destination; an old timer must never pull
the learner back from that destination. **Keep summary open** cancels automatic
navigation while preserving backend closure at the deadline.

The deterministic report lists distinct words that completed their first-study
unit and entered Practice, and distinct words whose accepted work in this
session graduated them from Practice to Review. Introductions merely opened
are excluded. Practice units covered are not themselves graduation. Empty
groups are omitted; during Undo the report is provisional. The countdown adds
neither study duration nor time to the recorded study-completion timestamp.

Once acknowledged, pending completion survives refresh, backgrounding, tab close,
and navigation to another URL. Server recovery closes overdue records. A later
visit after closure opens Home. Browser unload is not required for closure.

Reload returns to Home and discards the active session, completion view, and
final Undo snapshot. The frontend does not serialize or restore session state
from browser storage. An already-staged backend completion retains its original
deadline and closes independently; no reload or unload message is needed. Starting
another session closes that pending completion before selecting the study
queue. Broader frontend reload semantics are outside this feature.

Before acknowledgement, show saving/retry rather than promising a server deadline.
The server resolves a cancellation-versus-expiry race atomically. Duplicate
closure does not duplicate accepted attempts, completion, or generation work.

Starting a new session first closes any previous pending completion, including
after reload or when another tab created it. Only then select the refreshed
study queue, so the final action from the previous session informs admission.
If previous closure fails, the learner can retry starting; no queue is selected
from unaccepted progress.

Leaving an active or draining session does not finish it. Failure to save
or close completion is retryable and does not fabricate accepted work or
start generation. Reflection and Connections are best-effort after closure;
their latency does not delay Home or reopen study. Connections is read from Home,
separately from this immediate deterministic report. See
[`session-debrief.md`](../session-debrief.md).

An undone transition contributes no reflection evidence. Reflection generation,
validation, or later review failure never changes covering, accepted attempts,
the completed-session record, or scheduler projection. The detailed evidence,
generation, failure, and retry contract is defined in
[`session-reflection-generation.md`](session-reflection-generation.md).

For the current storage and worker mechanisms, see
[session completion persistence](../../docs/server-db.md#session-completion-persistence).

## Commit Payload Intent

This spec does not lock down the wire format, but it does define the conceptual payload content that the backend will need once a unit is covered.

### Unstudied word commit

Conceptually:

- the word was completed as an `unstudied` session unit

The backend transitions it into `learning`.

### Learning word commit

Conceptually:

- the word was covered in the session
- the session outcome was either success or failure

The backend uses this to update:

- learning streak
- learning-to-review transition
- covered-today tracking

### Review item commit

Conceptually:

- the review item was covered in the session
- the backend knows how many failures occurred before coverage
- if there were no failures, the backend also knows whether the successful terminal rating was `Hard`, `Good`, or `Easy`

This allows the backend to distinguish:

- clean but hard success
- clean normal success
- clean easy success
- lapse followed by recovery

### Contrast selection commit

Conceptually:

- the contrast prompt was answered
- the backend knows the selected choice
- the backend knows the correct prompt target
- the backend knows whether the selected choice was correct
- correct selections include a terminal rating of `Hard`, `Good`, or `Easy`
- incorrect selections are committed as `Forgot`

## Deferred Questions

The following decisions are open:

- how repeated exposures are spaced relative to other items in the session
- whether reinforcement of a failed review item should ever surface the opposite direction too
- how an interrupted session should affect partial progress
