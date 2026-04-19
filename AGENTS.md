# AGENTS.md

Guidance for AI coding agents working in this repository.

## 1) Project Snapshot

- App type: Chinese study app in local-browser-first PoC phase.
- Frontend: React + Vite + TypeScript in `src/`.
- Backend: Express + TypeScript in `server/`.
- Persistence: SQLite (`app.db`) via Node `DatabaseSync`.
- Direction: treat current local setup as an implementation phase, not a permanent architecture. Prefer decisions that keep a future web-service migration feasible.
- Product behavior source of truth:
  - `SPECS/learning-review-model.md`
  - `SPECS/session-covering-criteria.md`

## 2) First Files To Read

1. `README.md`
2. `package.json`
3. `SPECS/learning-review-model.md`
4. `SPECS/session-covering-criteria.md`
5. Relevant tests under `tests/` for the area being changed

When code and spec conflict, treat the spec as intended behavior and update code + tests together.

## 3) Working Agreements

- Keep changes minimal and scoped to the user request.
- Prefer targeted fixes over broad refactors.
- Do not introduce new dependencies unless necessary.
- Preserve strict TypeScript quality; avoid `any` unless clearly justified.
- Keep backend timestamps and date keys in UTC (`toISOString`, `YYYY-MM-DD` UTC date key) unless explicitly changing product policy.
- Avoid hard-coding assumptions that only work in single-machine/local-only deployments if a cleaner abstraction can preserve future hosted-service options.

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
- When changing schema or persistence behavior in `server/db.ts`, update/add tests in `tests/` in the same change.

## 6) Backend/API Conventions

- API routes are defined in `server/index.ts`.
- DB + domain logic live in `server/db.ts`; prefer keeping HTTP handlers thin.
- For endpoint behavior changes:
  - maintain input validation
  - maintain meaningful status codes (`400`, `404`, `500`)
  - update API client calls in `src/services/api.ts` if contract changes

## 7) Frontend Conventions

- Keep API interactions centralized in `src/services/api.ts`.
- Keep session runtime behavior coherent with spec (frontend owns in-flight session state; backend owns durable state).
- Avoid introducing global state libraries unless required.

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
