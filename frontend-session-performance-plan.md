# Frontend Session Performance Plan

This document captures the manual performance pass we discussed for the active study flow.

The goal is to improve session responsiveness by tightening data-model semantics and removing unnecessary frontend work from the per-rating hot path.

This is intentionally scoped to the areas already identified:

- session queue behavior in [`src/lib/session-state.ts`](/Users/jw/dev/chinese-study-app/src/lib/session-state.ts)
- live dashboard / inspection state maintenance in [`src/App.tsx`](/Users/jw/dev/chinese-study-app/src/App.tsx)

It does not attempt a broad profiling pass or search for unrelated bottlenecks.

## Clarified Product Intent

### Active session performance is the priority

During an active session, the user should be focused on studying.

The frontend should optimize for:

- fast rating-to-next-card transitions
- simple session-state updates
- avoiding unnecessary full-collection rewrites on commit

### The Words page does not need live accuracy during study

While a session is active, the Words page may show stale data.

That is acceptable.

Fresh review/word inspection data is only required when the user intentionally navigates to the Words page or after the session is closed and the dashboard is refreshed.

Prefetching is acceptable only if it does not slow down the active rating path.

### Session preview data is not authoritative during an active session

Once a session starts, the active session snapshot becomes authoritative.

Pre-session preview data does not need to stay in sync during the session.

## Queue Model

The session queue should be treated as a real ordered queue, not as an unordered collection that is searched and filtered defensively.

### Queue invariants

1. The queue is ordered.
2. The head of the queue is the current displayed item.
3. Rating always consumes the head exactly once.
4. Queue mutation in the common path should be positional, not search-based.
5. Review-item ids are unique within the queue.
6. Learning and unstudied follow-up behavior relies on the existing unique review-item entry model.

### Intended operations

The queue abstraction should support the operations the session logic actually needs:

- inspect current item
- dequeue current item
- rotate current item to the back

The current helper functions `rotateCurrentItem` and `appendCurrentItem` express the same queue change and should be consolidated into a single rotate operation once the queue abstraction is updated.

### Behavior by session outcome

#### Review items

- `Hard` / `Good` / `Easy` on a clean review item:
  - dequeue current item
  - no further queue maintenance
- `Forgot` on a review item:
  - rotate current item to the back
- successful completion of same-session reinforcement:
  - dequeue current item

#### Learning words

- `Good` before both directions are covered:
  - dequeue current item
- `Forgot` before coverage:
  - rotate current item to the back
- once both directions are covered:
  - the current item should be removable by review-item id / head position rather than scanning by `wordId`

#### Unstudied words

- before a direction reaches its required streak:
  - `Good` that does not finish the direction yet can rotate current item as needed by the existing logic
  - `Forgot` rotates current item to the back
- once a direction is covered but the word is not yet complete:
  - remove the current review item by id
- once both directions are complete:
  - the current item should be removable by review-item id / head position rather than scanning by `wordId`

## Current Hot-Path Work To Remove

### 1. Search-based queue removal in session state

The current session logic contains removals such as:

- `state.queue.filter((queuedItem) => queuedItem.id !== item.id)`
- `state.queue.filter((queuedItem) => queuedItem.wordId !== word.id)`

These are too loose semantically for the queue model above.

The common success case should not search the queue for matching items. It should consume the current queue head through queue operations.

### 2. Live `reviewItems` maintenance during study

`reviewItems` currently updates on committed review-item completion in [`src/App.tsx`](/Users/jw/dev/chinese-study-app/src/App.tsx).

That maintenance is not needed for active-session study behavior.

Because live Words-page accuracy during a session is not a requirement, these updates should be removed from the rating hot path.

Fresh review-item data can instead be loaded:

- when leaving the session
- or immediately before entering the Words page

### 3. Live `sessionPreviewItems` maintenance during study

`sessionPreviewItems` is pre-session data.

Once a session is active, it is no longer authoritative for the current study flow.

Updating it on each committed review item adds unnecessary work to the active-session path and should be removed.

### 4. Live `words` rewrites during study

The active session currently depends on `wordsById`, derived from the mutable `words` array.

The important property for session logic is stable lookup by `wordId`, not live status synchronization during the session.

The current `setWords(current => current.map(...))` updates on learning / unstudied commits are likely unnecessary for the active session itself and should be reconsidered.

## Proposed State Ownership

### Active session state

The active session should own the data needed to study without depending on live global dashboard synchronization.

That likely means:

- `sessionState` owns queue order and in-session progress
- a frozen `sessionWordsById`-style snapshot owns the word lookup data needed for rendering and session branching

### Background inspection state

Global inspection state can be refreshed at natural boundaries rather than maintained eagerly during every rating:

- `reviewItems` for the Words page
- `sessionPreviewItems` for pre-session home UI
- global `words` for dashboard / inspection views

## Implementation Plan

### Step 1: Introduce a queue abstraction for session state

- replace direct array-slicing / filtering semantics with queue operations
- keep behavior the same
- consolidate `appendCurrentItem` into `rotateCurrentItem`
- ensure review-item removal is based on queue position / item id invariants rather than unordered search behavior

### Step 2: Tighten session-state transitions around queue invariants

- update review completion paths to use dequeue semantics
- update learning completion paths to remove the current item without scanning by `wordId`
- update unstudied completion paths to remove the current item without scanning by `wordId`
- preserve current covering / reinforcement behavior

### Step 3: Decouple active study from live inspection updates

- remove per-commit `setReviewItems(...)` updates from the active rating path
- remove per-commit `setSessionPreviewItems(...)` updates from the active rating path
- reconsider or remove per-commit `setWords(...)` updates if the active session can rely on a frozen lookup snapshot instead

### Step 4: Refresh inspection data at explicit boundaries

- reload fresh inspection data when the session ends
- load fresh review-item data immediately before entering the Words page if needed
- keep stale-during-session behavior acceptable by design

## Non-Goals For This Pass

- broad profiling instrumentation
- backend query optimization
- changing session product behavior
- redesigning the Words page
- searching for unrelated performance issues

## Success Criteria

- Rating a card does not trigger unnecessary full-array maintenance for inspection-only state.
- The active study flow depends on queue semantics, not collection filtering semantics.
- Queue operations reflect the actual session model: dequeue current or rotate current.
- Words-page freshness is restored only at intentional refresh boundaries, not through live churn during study.
