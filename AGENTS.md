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
  - `SPECS/reflection-proposals-and-handles.md` — reflection proposals,
    authorization, application, provenance, and handle operations

## 2) First Files To Read

1. `README.md`
2. `docs/README.md`
3. `package.json`
4. `SPECS/learning-review-model.md`
5. `SPECS/session-covering-criteria.md`
6. `SPECS/study-action-model.md`
7. `STABILITY_FRONTIER.md` — how to interpret and maintain the current build-wave boundary (see §12)
8. Task-spec notes linked from the relevant Linear item or supplied dispatch context, followed by only the working notes relevant to the task (working memory only; defer to SPECS on conflict — see [`notes/README.md`](notes/README.md))
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
| Reflection proposals / handles | `SPECS/reflection-proposals-and-handles.md`, current reflection milestone plan | `llm-provider-runner.test.ts` plus new lifecycle/adapter tests |

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

## 11) Working With Linear And Current Project State

Effective 2026-08-02, Linear is the source of truth for current idea intake,
classification, portfolio priority, readiness, themes, debt, parked work,
declared Focus/Async work, and portfolio disposition. The successful steward
operating model is recorded in
[`PLANS/project-steward-linear-trial.md`](PLANS/project-steward-linear-trial.md).
The former repository task catalog has been retired; use Git history only when
historical context is needed. Do not create a replacement repository backlog.

- **Authority split**: Linear records the current portfolio and which cataloged tasks the human has declared in flight. A task remains in flight through execution, review, and revision. The initiating Codex prompt, task-spec note when one exists, and subsequent task thread own its detailed execution contract and context. GitHub pull requests and Git history own review, CI, integration, and merge truth. Durable product behavior, architecture, vision, and frontier decisions remain in Git.
- **WIP policy**: Focus maximum 1; async tasks in flight maximum 2; work awaiting review maximum 2; Linear `Todo` maximum 5. The human selects or dispatches work and supplies disposition facts; agents must not dispatch additional work autonomously. A steward with authorized Linear access may record an explicitly supplied Focus/Async or disposition transition but must not infer unreported execution state.
- **Direct prompts and one-offs**: a direct human prompt is sufficient authorization for the requested in-scope work. Brief one-offs do not need a Linear item merely to legitimize them and may remain unknown to the steward.
- **Capture without Linear access**: if work surfaces a worthwhile new idea and the agent lacks authorized Linear access, report it in the handoff for the human or steward to capture. Do not create a parallel repository backlog.
- **Capture is not dispatch**: creating or updating a Linear item does not focus or dispatch it. The human controls selection, readiness, Focus/Async transitions, and final disposition.
- **Dispatch-ready packet**: work promoted to `Todo` for independent dispatch should state its outcome, deliverable, scope, required inputs, done criteria, non-goals, dependencies/overlap, execution constraints, and when to stop for input. Keep this in Linear when short; otherwise link one task-spec note that consolidates the executable context.
- **Potential staleness**: before focus or dispatch, the human revalidates that the outcome is still wanted, inputs are stable enough, no in-flight task owns the same decision boundary, semantic and merge overlap are acceptable, and review capacity exists.
- **Task identity and context**: the first prompt plus subsequent task thread define an agent task's semantic identity and execution contract. A Linear identifier improves traceability but is not required for a brief one-off. Once dispatched, the worker follows that prompt and the specs/docs at its base revision; later Linear edits do not silently steer it.
- **Worktree ownership**: each independently dispatched async task runs in its own worktree. Do not place multiple independently dispatched tasks in one worktree. Worktrees prevent simultaneous filesystem interference; they do not prevent logical conflicts, overlapping diffs, stale assumptions, or integration cost.
- **Working notes vs task specs**: ordinary working notes stay lightweight and do not need a catalog backlink. When their content becomes critical to a cataloged task, consolidate the necessary context into a task-spec note and link it from Linear. Do not copy volatile execution or review state into note metadata.
- **Review disposition**: review results are accepted/merged, returned for revision, discarded, or converted into a new decision/task. Finished agent execution is not completed project work until the human supplies or confirms its disposition.
- **PR handoff**: reviewable async work should normally return through a GitHub PR. Its title and description should make the originating task recognizable and record the outcome, material deviations, verification, open decisions, dependencies/overlap, and follow-up work. A no-diff conclusion may return through the Codex task instead.
- **Commits and task identity**: stage deliberately so unrelated changes are not swept in. Every commit should be relatable to a Linear item, linked task spec, or directly requested one-off; items and commits need not be one-to-one.

## 12) Working With The Stability Frontier

Read [`STABILITY_FRONTIER.md`](STABILITY_FRONTIER.md) before treating the
current frontier as an implementation contract.

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
