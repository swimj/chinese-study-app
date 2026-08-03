# Learning And Review Model

Status: current contract for word lifecycle and established session behavior.
Its direction-oriented scheduling language also documents existing behavior and
is under renovation; it may not express the desired longer-term architecture in
full. `study-action-model.md` owns the implemented word/skill/action scheduling
architecture while this document continues to own lifecycle semantics.

This document captures the established product model for word lifecycle and
session behavior. It remains authoritative for those semantics even where the
current codebase reflects older mechanics. Direction-oriented scheduling detail
is transitional context and defers to `study-action-model.md` when the two use
different architectural vocabulary.

## Scope

This spec assumes:

- single local user
- UTC calendar day is the definition of "today" for this prototype
- session abort behavior is deferred for later design

For clarity:

- persisted timestamps use UTC ISO-8601 strings
- persisted date-only coverage keys use `YYYY-MM-DD` derived from UTC

## Core Principle

The persisted state should stay simple and describe durable properties of a word outside the scope of any one live session.

Session behavior may be richer than persisted state. A word can be treated differently inside a session based on its persisted state and current progress within that session.

## Persisted Word States

A word has one of three persisted states:

- `unstudied`
- `learning`
- `review`

### `unstudied`

- The word has not yet entered active study.
- It is eligible to appear in a session only through the new-word intake policy.
- It should not appear in the normal review queue.

### `learning`

- The word is in an active acquisition phase.
- It should be included in a session whenever it has not yet been covered successfully today.
- It is not governed by review due dates for session inclusion.

### `review`

- The word has graduated from active acquisition into spaced repetition review.
- It is included in sessions according to direction-specific due dates.

## Direction-Level Data

Each word has two review directions:

- forward
- reverse

Each direction keeps its own persisted spaced-repetition data, including at least:

- interval
- next due time
- ease or other multiplier inputs

Direction-level scheduling data remains important even though the user-facing lifecycle state belongs to the word.

There is no direction-level lifecycle state in this model.

## Session Inclusion Rules

At any point in time, the system can compute an ideal session.

The ideal session contains:

- all due review directions for words in `review`
- all words in `learning` that have not yet been successfully covered today
- unstudied words allowed by the current new-word intake policy

The user may complete as much or as little of the session as they want.

## New-Word Intake

New-word intake is policy-driven.

For the current stage, the policy may still use a daily learning cap and priority threshold. That is a policy choice, not a fundamental property of the model.

Important rule:

- `unstudied -> learning` should happen when the word actually enters completed study behavior, not merely because the user opened the dashboard

The exact mechanics of how an unstudied word is presented during first encounter may evolve later.

## Learning-State Session Behavior

`learning` words are session obligations, not due-date obligations.

A `learning` word is considered covered for a given day/session only after:

- both directions have received a `Good` recall outcome from the user at least once during that session

If a `learning` word has already been covered successfully today, it should not be included again in additional sessions on that same day.

This is intended to support users who split study into multiple smaller sessions during the day without being spammed by the same learning words repeatedly.

## Attempt Outcome vs Session Outcome

`Good` is a property of a single appearance of a review direction within a session.

A learning word may require multiple appearances of one or both directions before it is covered.

This means the model distinguishes between:

- attempt outcome
- coverage
- session success

### Attempt Outcome

Each appearance of a review direction can receive an outcome such as `Forgot`, `Hard`, `Good`, or `Easy`.

For the current learning model, the important outcome is `Good`.

### Coverage

A `learning` word is covered in a session when:

- both directions have received `Good` at least once during that session

Coverage is about whether the word has been fully worked through for that session, even if one or both directions required retries.

## Learning-State Session Outcome

Each `learning` word also has a higher-level session outcome for that day/session.

### Success

A `learning` word has a successful session outcome when:

- both directions receive `Good` on their first try in that session

### Failure

A `learning` word has a failed session outcome when:

- the user does not achieve first-try `Good` in both directions within that session

For now, aborted-session behavior is explicitly deferred.

## Learning To Review Graduation

Each word in `learning` tracks the number of consecutive successful sessions.

Graduation rule:

- after 3 consecutive successful sessions, the word transitions from `learning` to `review`

This success count is tracked at the word level, not the direction level.

## Review-State Behavior

In `review`:

- each direction has its own review interval
- each direction evolves independently through spaced repetition scheduling
- inclusion in a session is based on due dates

There is no balancing or freezing behavior between directions in this version of the model.

There is also no demotion from `review` back to `learning` for now.

If a user forgets a word in `review`, that is reflected by shorter future review intervals, not by changing the persisted word state.

## Non-Goals For This Version

The following are intentionally out of scope for this spec version:

- `teaching` as a persisted state
- `strong` as a persisted state
- demotion rules
- balancing/freezing between direction intervals
- multi-user or timezone-aware policy logic
- local-timezone day boundaries
- detailed abort-session rollback behavior

## Persisted Data Implications

This model implies that `Word` needs persisted fields beyond just `status`.

At minimum, future implementation likely needs word-level fields for:

- consecutive successful learning sessions
- whether the word has already been successfully covered today
- the date of the last successful learning-session coverage

These may live directly on the `words` table or in a separate learning-progress table. That storage choice is an implementation decision, not part of this product spec.
