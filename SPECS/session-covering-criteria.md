# Session Covering Criteria

This document defines what it means for a study unit to be considered covered within a live session.

It complements [`SPECS/learning-review-model.md`](/Users/jw/dev/chinese-study-app/SPECS/learning-review-model.md).

## Scope

This spec is about in-session behavior and commit boundaries.

It does not yet define:

- exact intra-session scheduling order between items
- aborted-session behavior
- long-term interval policy details beyond the commit payload needs

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

An `unstudied` word has a two-phase first encounter.

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

The user must then successfully recall that same review item 3 times in a row before it is considered covered for the session.

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

Undo is a frontend-only escape hatch for the most recent session-affecting
transition that has not yet been durably committed to the backend.

The frontend may hold at most one undoable transition.

An undoable transition begins when user action changes session progress:

- rating a recognition or production review card
- submitting a production answer that matches no word in the served accepted
  set, which is automatically rated `Forgot`
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

Undo must not call the backend.

After undo, the user should see the card state from immediately before the
undone session-affecting transition.

For an incorrect contrast selection, undo from either the frozen correction card
or the next active card restores the original contrast prompt to an unanswered
state: no selected choice, no revealed answer, and no pending contrast commit.

## Completed-Session Reflection Boundary

Reaching the session summary does not by itself close the final Undo window. The
learner explicitly finishes the session before post-session reflection becomes
eligible.

Finishing must first flush the final accepted deferred commit and record the
durable completed-session summary. Only after those steps succeed may the app
freeze qualifying reflection evidence and start best-effort generation. If
finalization fails, reflection does not start and must not fabricate a completed
session.

An undone transition contributes no reflection evidence. Reflection generation,
validation, or later review failure never changes covering, accepted attempts,
the completed-session record, or scheduler projection. The detailed evidence,
generation, failure, and retry contract is defined in
[`session-reflection-generation.md`](./session-reflection-generation.md).

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

The following remain intentionally open:

- how repeated exposures are spaced relative to other items in the session
- whether reinforcement of a failed review item should ever surface the opposite direction too
- how an interrupted session should affect partial progress
