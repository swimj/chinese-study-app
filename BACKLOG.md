# Backlog

Noncritical improvements worth remembering as the project evolves.

## UX and Workflow

- Migrate more UI surfaces to prefer `meanings[]` over the legacy single-string `meaning`, while keeping compact surfaces readable.
- Per-meaning definition editing, add/remove meanings.
- Add per-meaning visibility controls so each gloss can be marked as “show on main session card” versus secondary/expandable detail.

## Review Flow

- Make the initial review-item ease factor user-configurable (currently backend-controlled).
- Add per-direction dismissal for review words so users can keep one direction active (for example Hanzi → English) while suppressing the opposite direction when production meanings are intentionally hidden.
- Revisit `startedItemIds` in session state. It currently mostly gates "must be shown before rating" plus dismiss/history cleanup; evaluate whether this can be simplified to a lighter per-active-item shown marker.
- Revisit Manage Study cleanup for reinforcement review actions. Managing a reinforcement removes the action/progress as intended, but session summary and answered-count cleanup are uneven between active unrated actions and frozen just-rated production actions.

## Data and Operations

- Decide when to remove the legacy JSON migration path from the backend once it is no longer useful.
- Add a safer first-class reset/seed path instead of relying on deleting `data/app.db` manually.
- Add status precondition checks for completion paths so `unstudied`, `learning`, and `review` commit functions reject invalid lifecycle transitions instead of trusting the frontend.
- Normalize API parameter placement conventions (path params vs JSON body) for single-word mutation actions.
- Current state is intentionally mixed for pragmatic implementation reasons (`targetWordId` is in the body for some study-management command endpoints, but in the URL for some resource-style endpoints).
- There is no known deeper domain semantics behind this split right now; consider a cleanup pass to reduce cognitive overhead and improve discoverability.

## Project Organization

- `server/db/` is split into connection, types, persistence, and domain re-export shims (see `docs/server-db.md`). Further split `persistence.ts` by domain if navigation becomes painful again.
- Consider separating import-time DB initialization from reusable data types/query logic so tests can share types more easily and control setup explicitly (`initDbConnection` already re-reads env per import).

## Unstudied Intake Modeling

- Revisit whether `unstudied` session rows should depend on persisted `review_items` rows at all.
- Current implementation uses the `WITH ranked_unstudied AS (...) ... LIMIT ?` pattern to select top words first, then expands to per-direction review items by joining `review_items`.
- This is correct for today because session runtime logic is keyed off `reviewItem` identity/direction across all statuses, including `unstudied`.
- A future decoupling path:
  - keep `review` and `learning` on persisted `review_items` as-is
  - model `unstudied` as synthetic in-session drill tasks keyed by `{wordId, direction}` (or equivalent task id)
  - compose unstudied intake from words only, then create directional tasks in frontend session state
  - persist only the final unstudied completion outcome (`completeUnstudiedWordSession`), not per-direction review-item updates
- If we pursue this, update session-state identity/progress maps first, then simplify the unstudied SQL branch in `server/db.ts`.
