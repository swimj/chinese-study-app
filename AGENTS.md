# AGENTS.md

Guidance for AI coding agents working in this repository.

## 1) Project Snapshot

- App type: Chinese study app in local-browser-first PoC phase.
- Frontend: React + Vite + TypeScript in `src/`.
- Backend: Express + TypeScript in `server/`.
- Persistence: SQLite (`app.db`) via Node `DatabaseSync`, modules under `server/db/`.
- Direction: treat current local setup as an implementation phase, not a permanent architecture. Prefer decisions that keep a future web-service migration feasible.
- Documentation taxonomy: [`docs/README.md`](docs/README.md), [`SPECS/README.md`](SPECS/README.md), and [`notes/README.md`](notes/README.md) (medium-lived working memory).
- Product behavior source of truth:
  - `SPECS/learning-review-model.md` — word lifecycle
  - `SPECS/session-covering-criteria.md` — in-session covering and commits
  - `SPECS/study-action-model.md` — scheduling, study actions, attempt events

## 2) First Files To Read

1. `README.md`
2. `docs/README.md`
3. `package.json`
4. `SPECS/learning-review-model.md`
5. `SPECS/session-covering-criteria.md`
6. `SPECS/study-action-model.md`
7. `STABILITY_FRONTIER.md` — how to interpret and maintain the current build-wave boundary (see §12)
8. `TASKS.md` — versioned stability-frontier snapshot and work catalog; read at session start for current direction and dispatch candidates, while treating branch copies as potentially stale (see §11)
9. Task-spec notes linked from relevant catalog items, followed by only the working notes relevant to the task (working memory only; defer to SPECS on conflict — see [`notes/README.md`](notes/README.md))
10. Relevant tests under `tests/` (see [`docs/testing.md`](docs/testing.md))

When code and spec conflict, treat the spec as intended behavior and update code + tests together.

### Task routing

| If you are changing… | Read first | Tests to touch |
| --- | --- | --- |
| Session composition / scheduling | `SPECS/study-action-model.md` (scheduling sections), `session-covering-criteria.md` | `session-composition.test.ts`, `session-bucket-scheduler.test.ts` |
| In-flight session UI / undo | `session-covering-criteria.md`, `SPECS/frontend-architecture-map.md` | `session-selectors.test.ts`, `session-bucket-state.test.ts` |
| Contrast intake / clusters | `study-action-model.md` (contrast sections), [`docs/api.md`](docs/api.md) | `contextual-selection-intake.test.ts`, `contrast-content.test.ts` |
| Word priority / French aliases | `README.md` (French section), `src/study-profile.ts` | `user-priority.test.ts`, `priority-aliases.test.ts` |
| Persistence / SQL | [`docs/server-db.md`](docs/server-db.md) | matching `tests/*.test.ts` that import `server/db.ts` |
| HTTP API contract | [`docs/api.md`](docs/api.md), `server/index.ts` | domain tests above + manual smoke if needed |

### Environment variables

| Variable | Side | Purpose |
| --- | --- | --- |
| `APP_MODE` | Backend | `dev` (seed sample data) or `study` (requires explicit data dir) |
| `APP_DATA_DIR` | Backend | Directory containing `app.db` |
| `APP_STUDY_PROFILE` | Backend | `mandarin` or `french` |
| `APP_SEED_DATA_PATH` | Backend | Required in dev mode; seed JSON path |
| `PORT` | Backend | API port (default `5174`) |
| `VITE_API_BASE` | Frontend | API origin (default `http://localhost:5174`) |
| `VITE_STUDY_PROFILE` | Frontend | Client study profile (`mandarin` / `french`) |

CLI flags mirror env where applicable (`--mode`, `--data-dir`, `--study-profile`, `--seed-data`).

## 3) Working Agreements

- Keep changes minimal and scoped to the user request.
- Prefer targeted fixes over broad refactors.
- Do not introduce new dependencies unless necessary.
- Preserve strict TypeScript quality; avoid `any` unless clearly justified.
- Prefer strict invariants in state/domain transition functions:
  - if a caller contract is expected to always hold, fail loudly (`throw`) when violated
  - avoid silent defensive fallbacks that mask programmer errors
  - reserve tolerant no-op behavior for explicitly user-driven or externally uncertain inputs
- Keep backend timestamps and date keys in UTC (`toISOString`, `YYYY-MM-DD` UTC date key) unless explicitly changing product policy.
- Avoid hard-coding assumptions that only work in single-machine/local-only deployments if a cleaner abstraction can preserve future hosted-service options.
- When the desired goal is vague, only write code roughly up to what is relatively well-defined, limit speculative policy decisions. Even if the prompt explicitly ask to go in one-shot, stop and alert me of the the points of ambiguity instead of proceeding.

## 4) Runbook Commands

- Install deps: `npm install`
- Start frontend: `npm run dev:frontend` (Vite on `4173`)
- Start backend (dev mode): `npm run dev:backend` (API on `5174`)
- Start backend (study mode): `npm run study:backend -- --data-dir=/absolute/path`
- Reset dev DB: `npm run reset:dev-data`
- Run tests: `npm test`
- Build frontend: `npm run build`

## 5) Data Safety Rules

This repo contains real DB artifacts and backups under `data/`.

- It is acceptable to modify/reset dev data under `data/` when needed for the requested task (including schema/script work and local verification), as long as changes are intentional and explained.
- Do not casually delete backup/source artifacts (`data/*.backup*`, `data/sources/*`) unless the task explicitly calls for cleanup/migration.
- Treat `tmp/` and generated/export artifacts as potentially useful unless explicitly disposable.
- Never commit secrets. Keep API keys in `.env` (see `.env.example`).
- When changing schema or persistence behavior, update [`server/db/persistence.ts`](server/db/persistence.ts) (or `server/db/connection.ts` for init paths) and add/update tests in `tests/` in the same change.

## 6) Backend/API Conventions

- API routes are defined in `server/index.ts` (index: [`docs/api.md`](docs/api.md)).
- DB + domain logic live in `server/db/` (barrel: `server/db.ts`); prefer keeping HTTP handlers thin.
- For endpoint behavior changes:
  - maintain input validation
  - maintain meaningful status codes (`400`, `404`, `500`)
  - update API client calls in `src/services/api.ts` if contract changes

## 7) Frontend Conventions

- Keep API interactions centralized in `src/services/api.ts`.
- Keep session runtime behavior coherent with spec (frontend owns in-flight session state; backend owns durable state).
- Avoid introducing global state libraries unless required.
- UI map: `SPECS/frontend-architecture-map.md`.

## 8) Testing Expectations

- Add or update tests for behavior changes when practical.
- Prefer focused node tests under `tests/*.test.ts`.
- For scheduling/session logic changes, update composition/completion tests first.
- Before finishing substantial code changes, run the minimum relevant verification command(s) for the area changed.

## 9) Done Checklist

1. Code compiles and relevant tests pass.
2. Behavior is aligned with spec docs.
3. No accidental data-file modifications.
4. Docs updated when behavior or commands changed.

## 10) If Unsure

- Ask for clarification before making irreversible data changes.
- Favor explicitness over hidden magic in learning/review logic.
- Leave concise comments only where logic is non-obvious.

## 11) Working With `TASKS.md`

`TASKS.md` is the versioned work catalog at repo root. It records project intent
as of the commit containing it; it is not a live scheduler, running-task
registry, review queue, or communication channel for active agents. Every
worktree sees a branch-local snapshot that may be stale relative to other work.

- **Sections**: Focus is a human-maintained orientation snapshot; Async Ready is a fully specified, priority-ordered dispatch shelf; Inbox is raw capture. Recently Completed keeps short handoffs; Debt holds workarounds with trigger conditions; Parked holds tangential/deferred items.
- **External execution state**: the human currently tracks running, blocked, and finished execution through the unarchived Codex tasks/threads visible in the app sidebar and tracks review, CI, dependencies, integration, and disposition through GitHub pull requests. This is human-maintained coordination context, not a shared object agents should assume they can read or update. Do not mirror those volatile states into `TASKS.md`.
- **WIP policy**: Focus maximum 1; async tasks in flight maximum 2; work awaiting review maximum 2; Async Ready maximum 5. The human judges live occupancy from the Codex sidebar, GitHub, and current awareness rather than catalog sections. Agents do not need to discover or enforce global occupancy; they must not dispatch additional work without explicit instruction. When review is full, review before dispatching more work.
- **Item format**: `- [ ] description #tag #tag (optional context)`. Tags are inert text but greppable — e.g., `#m0`, `#spike`, `#design`, `#debt`.
- **Direct prompts are sufficient**: `TASKS.md` is not an intake or authorization gate. When the human directly requests in-scope work, do it without first creating or promoting a catalog entry unless explicitly asked. The catalog's one-shot exclusion is a human workflow heuristic, not a prerequisite for agent action.
- **Append-only capture**: any task may append new items to Inbox or Parked. Agents must not edit, move, close, deduplicate, prioritize, or reorder existing entries without explicit instruction. Order in those capture buckets is not meaningful; reconcile concurrent additions as a semantic union during normal PR/branch integration.
- **Capture is not dispatch**: recording an idea must not interrupt Focus or start more work.
- **Human control**: selecting Focus, promoting into Async Ready, dispatching, reordering Async Ready, and reconciling or closing catalog entries are the human's call, or done on explicit ask. Do not start parallel catalog items autonomously.
- **Dispatch-ready packet**: an Async Ready item must state its outcome, deliverable, scope, required inputs, done criteria, non-goals, dependencies/overlap, execution constraints, and when to stop for input. Keep this inline when short; otherwise link to a task-spec note that consolidates the executable context.
- **Potential staleness**: Async Ready items are candidates, not promises. At dispatch, the human revalidates that the outcome is still wanted, its inputs are stable enough, no active task owns the same decision boundary, likely semantic/merge overlap is acceptable, and review capacity exists. Apply the same judgment when shifting Focus.
- **Task identity and context**: the first prompt plus subsequent task thread define an agent task's semantic identity and execution contract. A repository task ID is optional, not required. Once dispatched, the worker follows that prompt and the specs/docs at its base revision; later `TASKS.md` edits do not steer it.
- **Worktree ownership**: each independently dispatched async task runs in its own worktree. Do not place multiple independently dispatched tasks in one worktree. Worktrees prevent simultaneous filesystem interference; they do not prevent logical conflicts, overlapping diffs, stale assumptions, or integration cost.
- **Working notes vs task specs**: ordinary working notes stay lightweight and do not need a `TASKS.md` backlink. When their content becomes critical to a cataloged task, consolidate the necessary context and references into a task-spec note, then link to it from `TASKS.md`. Do not copy volatile execution or review state into note metadata.
- **Review disposition**: review results are accepted/merged, returned for revision, discarded, or converted into a new decision/task. Finished agent execution is not completed project work until disposition occurs.
- **PR handoff**: reviewable async work should normally return through a GitHub PR. Its title and description should make the originating task recognizable without requiring a repository ID and record the outcome, material deviations, verification, open decisions, dependencies/overlap, and follow-up work. A no-diff conclusion may return through the Codex task instead.
- **Commit cadence**: commit append-only Inbox/Parked capture with the task output or PR that discovered it. Commit human-directed catalog management either alongside the change it describes or as a management commit at a session boundary. When committing code, stage deliberately so unrelated catalog edits do not get swept in accidentally.
- **Catalog items vs commits**: not strict 1-1. One item may span several commits; one commit may close multiple items; management commits aren't 1-1 with any work item; some items (research, "drop it" conclusions) produce no code commit. The invariant: every commit is relatable to at least one cataloged or one-shot task, and every completed catalog item corresponds to at least one commit or an explicit no-code-change outcome.

## 12) Working With The Stability Frontier

Read [`STABILITY_FRONTIER.md`](STABILITY_FRONTIER.md) before treating the
frontier snapshot in `TASKS.md` as an implementation contract.

- The frontier summarizes the current near-term product outcome, settled build
  assumptions, invariants, blocking decisions, non-goals, and advancement test.
- Canonical specs remain authoritative for product behavior. If the frontier
  conflicts with a spec or verified implementation constraint, flag it as stale
  and request human resolution.
- A frontier marked draft is not accepted implementation authority.
- Work within settled blocks and preserve frontier invariants. Do not resolve a
  named blocking decision speculatively merely to complete a task.
- Proactively call out a **frontier movement candidate** when evidence shows
  that a block is stable enough to promote, an assumption is invalid, a
  non-goal needs reconsideration, or the advancement test appears satisfied.
- Do not independently change the frontier's product outcome, invariants,
  settled-vs-blocking classifications, major non-goals, or advancement test.
  Propose the change and seek human confirmation. After explicit approval,
  update the frontier and its owning durable docs together.
