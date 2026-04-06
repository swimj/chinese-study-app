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

Only after both directions satisfy that criterion is the `unstudied` word considered covered for the session.

## Learning Word Covering

A `learning` word is covered in a session when:

- each direction has received `Good` at least once in that session

There is no requirement for repeated consecutive success within the same session.

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

## Deferred Questions

The following remain intentionally open:

- how repeated exposures are spaced relative to other items in the session
- whether reinforcement of a failed review item should ever surface the opposite direction too
- how an interrupted session should affect partial progress
