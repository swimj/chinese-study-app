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

## Project Organization

- If this backlog grows, consider splitting it into milestone-specific sections or moving to issues/projects. For now, a single markdown file is likely enough.
