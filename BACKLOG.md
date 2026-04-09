# Backlog

Noncritical improvements worth remembering as the project evolves.

## UX and Workflow

- Rename or remove the `Resume review` button until there is a true pause/resume flow.
- Add an `npm` script for resetting sample data, such as `reset:data`, so repeated manual testing is easier.
- Consider a one-command local dev workflow for starting frontend and backend together once day-to-day iteration gets more frequent.

## Review Flow

- Revisit the simple Unit 2 scheduling policy once the basic workflow is stable.
- Move example sentences to the revealed answer only, regardless of review direction. The prompt side should stay pure recall: show only `hanzi` for forward cards and only English for reverse cards.
- Show clearer post-answer feedback, such as the next due date after a rating is submitted.
- Consider a session summary screen after all due cards are completed.

## Data and Operations

- Decide when to remove the legacy JSON migration path from the backend once it is no longer useful.
- Add a safer first-class reset/seed path instead of relying on deleting `data/app.db` manually.
- Add status precondition checks for completion paths so `unstudied`, `learning`, and `review` commit functions reject invalid lifecycle transitions instead of trusting the frontend.

## Testing

- Add backend tests for session composition and durable state transitions, with UTC date/timestamp consistency checks across the persistence model.
- Introduce a small backend clock seam so time-dependent tests can simulate day-boundary behavior naturally instead of mutating persisted dates directly.

## Session Logic Refactor And Tests

- Extract the live in-session transition logic out of [`src/App.tsx`](/Users/jw/dev/chinese-study-app/src/App.tsx) into a small pure TypeScript session-state module so the product rules can be tested without React rendering concerns.
- Keep the frontend component as wiring and presentation: render the active session, call the session-state transition function, and perform backend commits only when the extracted logic reports that a unit is covered.
- Preserve the current architectural intent from the specs: the frontend owns in-flight session state, while the backend owns durable committed state.

### Motivation

- The remaining behavioral risk is mostly in intra-session state transitions, not in durable persistence rules.
- Those rules are currently embedded in component handlers, which makes them harder to understand and harder to test without UI-heavy tooling.
- Extracting them into a pure module should let us keep using lightweight unit tests instead of jumping straight to DOM/component tests.
- A small number of later UI integration tests may still be useful, but they should validate wiring rather than carry the full rule burden.

### Proposed Shape

- Introduce a session-state module that takes the current in-session state plus a user action and returns the next session state.
- Model queue membership/order, per-review-item reinforcement state, per-learning-word coverage/first-try state, and per-unstudied-word intro/consecutive-success state explicitly.
- Have the transition result include any commit intent, such as:
  - none
  - commit review item session
  - commit learning word session
  - commit unstudied word session
- Consider a small action vocabulary such as:
  - begin unstudied drill
  - rate current item
  - reveal answer if needed for stateful flow

### Target Test Cases

- Review item: first rating `Hard`, `Good`, or `Easy` covers immediately and emits the correct review-item commit payload.
- Review item: first rating `Forgot` enters reinforcement, tracks failure count, and only commits after three consecutive successful recalls.
- Review item: additional failures during reinforcement reset the reinforcement streak and continue increasing failure count.
- Learning word: both directions receiving `Good` on their first try yields coverage with `success = true`.
- Learning word: eventual coverage after any non-first-try path yields coverage with `success = false`.
- Learning word: only the relevant direction is marked covered when a single direction receives `Good`.
- Unstudied word: intro screen must be completed before recall-drill behavior begins.
- Unstudied word: each direction requires three consecutive `Good` ratings within the session before the word is covered.
- Unstudied word: a failed attempt resets only that direction's consecutive-success counter.
- Queue behavior: covered units leave the active session queue; incomplete units rotate or remain according to the current frontend behavior.
- Queue behavior: when one direction of an unstudied word is fully covered, that direction is removed while the other direction remains.
- Session snapshot behavior: once the active session starts, in-flight queue changes are owned by frontend state rather than recomputed from backend session composition.

## Project Organization

- Consider separating import-time DB initialization from reusable data types/query logic so tests can share types more easily and control setup explicitly.
- If this backlog grows, consider splitting it into milestone-specific sections or moving to issues/projects. For now, a single markdown file is likely enough.
