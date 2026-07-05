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
7. `TASKS.md` — current work queue; read at session start to orient on in-progress and next-up work (see §11)
8. Active notes in `notes/active/` linked from In Progress items (working memory only; defer to SPECS on conflict — see [`notes/README.md`](notes/README.md))
9. Relevant tests under `tests/` (see [`docs/testing.md`](docs/testing.md))

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

`TASKS.md` is the universal work queue at repo root. Read it at session start to orient on what's in progress and what's next up.

- **Sections**: Inbox (raw capture, unsorted) → Ready (triaged, priority-ordered, top is next) → In Progress. Debt holds workarounds with trigger conditions; Parked holds tangential/deferred items.
- **Item format**: `- [ ] description #tag #tag (optional context)`. Tags are inert text but greppable — e.g., `#m0`, `#spike`, `#design`, `#debt`.
- **One-shot exclusion**: if a task is small enough to one-shot an agent, it doesn't belong in the queue — just do it.
- **Agent's role**: append to Inbox or Debt proactively when something surfaces mid-task. Triage (moving items between sections), reordering Ready, and marking items done are the human's call, or done on explicit ask. Do not auto-commit queue changes.
- **Commit cadence**: edit `TASKS.md` freely during work. Commit it either alongside the code commit that a queue change describes (e.g., completing a slice), or as a management commit at a session boundary for planning-only changes. When committing code, stage deliberately so queue edits don't accidentally sweep in unless intentionally bundled.
- **Queue items vs commits**: not strict 1-1. One item may span several commits; one commit may close multiple items; management commits aren't 1-1 with any work item; some items (research, "drop it" conclusions) produce no code commit. The invariant: every commit is relatable to at least one queue item, and every completed item corresponds to at least one commit or an explicit no-code-change outcome.
- **Parallel work**: In Progress supports multiple items. Each entry carries a status — `active`, `blocked: <reason>`, or `waiting: <thing>`. The human decides what's parallelizable; the agent maintains status lines but doesn't spin up parallel items on its own.
