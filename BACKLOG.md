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

## Project Organization

- Consider separating import-time DB initialization from reusable data types/query logic so tests can share types more easily and control setup explicitly.
- If this backlog grows, consider splitting it into milestone-specific sections or moving to issues/projects. For now, a single markdown file is likely enough.
