# AGENTS.md

Guidance for AI coding agents working in this repository.

## 1) Project Snapshot

- App type: Mandarin study app with an invite-only hosted beta and local development workflow.
- Frontend: React + Vite + TypeScript in `src/`.
- Backend: Express + TypeScript in `server/`.
- Persistence: SQLite (`app.db`) via Node `DatabaseSync`, modules under `server/db/`.
- Direction: polish, maturity, and debt in the existing learner experience; preserve the hosted ownership and data-safety boundaries while improving it.
- Documentation taxonomy: [`docs/README.md`](docs/README.md), [`SPECS/README.md`](SPECS/README.md), and [`notes/README.md`](notes/README.md) (medium-lived working memory).
- Product behavior source of truth:
  - `SPECS/learning-review-model.md` — word lifecycle
  - `SPECS/session-covering-criteria.md` — in-session covering and commits
  - `SPECS/study-action-model.md` — scheduling, study actions, attempt events
  - `SPECS/session-reflection-generation.md` — post-session finalization,
    reflection evidence, generation, failure isolation, and retry
  - `SPECS/reflection-proposals-and-handles.md` — reflection proposals,
    authorization, application, provenance, and handle operations

## 2) First Files To Read

1. `README.md`
2. `docs/README.md`
3. `package.json`
4. `SPECS/learning-review-model.md`
5. `SPECS/session-covering-criteria.md`
6. `SPECS/study-action-model.md`
7. `STABILITY_FRONTIER.md` — safe architectural assumptions and unsettled decisions (see §12)
8. Task-spec notes linked from the relevant Linear item or supplied dispatch context, followed by only the working notes relevant to the task (working memory only; surface conflicts as described below — see [`notes/README.md`](notes/README.md))
9. Relevant tests under `tests/` (see [`docs/testing.md`](docs/testing.md))

The direct task instruction and subsequent clarifications supply execution scope.
Canonical specs describe intended behavior; code and tests show implemented
behavior. If they conflict with each other or with an explicit instruction,
surface the discrepancy. Apply a clear authorized change with matching docs and
tests; do not silently fix code to a stale spec or treat existing code as product
intent. Continue well-defined work and ask only when a consequential unresolved
product or architectural choice is needed. Old plans do not override the task.

### Task routing

| If you are changing… | Read first | Tests to touch |
| --- | --- | --- |
| Session composition / scheduling | `SPECS/study-action-model.md` (scheduling sections), `session-covering-criteria.md` | `session-composition.test.ts`, `session-bucket-scheduler.test.ts` |
| In-flight session UI / undo | `session-covering-criteria.md`, `SPECS/frontend-architecture-map.md` | `session-selectors.test.ts`, `session-bucket-state.test.ts` |
| Contrast clusters / content | `study-action-model.md` (contrast sections), `reflection-proposals-and-handles.md` (`create_contrast_cluster`) | `contrast-content.test.ts`, `reflection-application.test.ts` |
| Word priority / French aliases | `README.md` (French section), `src/study-profile.ts` | `user-priority.test.ts`, `priority-aliases.test.ts` |
| Persistence / SQL | [`docs/server-db.md`](docs/server-db.md) | matching `tests/*.test.ts` that import `server/db.ts` |
| HTTP API contract | [`docs/api.md`](docs/api.md), `server/index.ts` | domain tests above + manual smoke if needed |
| Reflection generation / evidence | `SPECS/session-reflection-generation.md`, `session-covering-criteria.md`, `docs/reflection-frontend-architecture.md` | `reflection-generation.test.ts`, `reflection-generation-isolation.test.ts`, `session-finalization.test.ts` |
| Reflection proposals / handles | `SPECS/reflection-proposals-and-handles.md`, `SPECS/session-reflection-generation.md` | `llm-provider-runner.test.ts` plus matching lifecycle/adapter tests |
| Hosted application-only release | [`docs/ops/hosted-beta-deployment.md`](docs/ops/hosted-beta-deployment.md), agent terminal-driver procedure | No schema/data migration; use authenticated Fly access on the first launch when the sandbox blocks `~/.fly`; retain and poll one terminal session through its terminal exit status; never start a second upgrade while the first has unknown state |

### Environment variables

| Variable | Side | Purpose |
| --- | --- | --- |
| `APP_MODE` | Backend | `dev` (seed sample data) or `study` (requires explicit data dir) |
| `APP_DATA_DIR` | Backend | Directory containing `app.db` |
| `APP_LEARNER_ID` | Backend | Stable learner id; required in study mode unless `--learner-id` is supplied |
| `APP_STUDY_PROFILE` | Backend | `mandarin` or `french` |
| `APP_METRICS_PORT` | Backend | Optional private Prometheus listener; hosted Fly config uses `9091` |
| `APP_OPERATOR_CLERK_USER_IDS` | Backend | Comma-separated Clerk user ids allowed to open the operator usage-pulse page/API. In `trusted_local` mode, include the learner id or the sentinel `trusted_local`. |
| `APP_SEED_DATA_PATH` | Backend | Required in dev mode; seed JSON path |
| `PORT` | Backend | API port (default `5174`) |
| `APP_REVISION` | Image build | Exact Git commit baked into a hosted image; required, never left `unknown` |
| `APP_SMOKE_CLERK_USER_ID` | Hosted | Clerk `user_…` id for `hosted:smoke`; also excluded from usage-pulse inactive-learner count; protected hosted configuration |
| `APP_SMOKE_CLERK_EMAIL` | Hosted | Optional resolver for that smoke user when the `user_…` id is not yet set |
| `VITE_API_BASE` | Frontend | API origin (default `http://localhost:5174`) |
| `VITE_STUDY_PROFILE` | Frontend | Client study profile (`mandarin` / `french`) |

CLI flags mirror env where applicable (`--mode`, `--data-dir`, `--study-profile`, `--seed-data`).

## 3) Working Agreements

- Keep changes minimal and scoped to the user request.
- Prefer targeted fixes over broad refactors.
- For sufficiently large tasks with independently bounded subtasks,
  use subagents by default—especially for read-heavy exploration, test or CI triage, and review.
  Keep concurrent code edits isolated; avoid edits in the same worktree unless coordination is explicit.
- Do not introduce new dependencies unless necessary.
- Preserve strict TypeScript quality; avoid `any` unless clearly justified.
- Prefer strict invariants in state/domain transition functions:
  - if a caller contract is expected to always hold, fail loudly (`throw`) when violated
  - avoid silent defensive fallbacks that mask programmer errors
  - reserve tolerant no-op behavior for explicitly user-driven or externally uncertain inputs
- Keep backend timestamps and date keys in UTC (`toISOString`, `YYYY-MM-DD` UTC date key) unless explicitly changing product policy.
- Avoid hard-coding assumptions that only work in single-machine/local-only deployments if a cleaner abstraction can preserve future hosted-service options.
- When the desired goal is vague, only write code roughly up to what is relatively well-defined, limit speculative policy decisions. Even if the prompt explicitly ask to go in one-shot, stop and alert me of the the points of ambiguity instead of proceeding.
- Implementation work defaults to the proportional delivery and review model in
  [`docs/stacked-feature-development-and-review.md`](docs/stacked-feature-development-and-review.md):
  state whether it is one cohesive pull request or likely needs a stack, then
  publish the verified implementation for review unless the task says
  otherwise. A normal single GitHub pull request remains sufficient and should
  keep the repository's ordinary validation scope. Use the installed `gt` CLI
  only when multiple Graphite-managed branches improve review comprehension.
  Standalone research, planning, and documentation-only tasks may return in
  Codex without a pull request unless review publication is requested; docs
  changed alongside implementation remain part of that implementation's PR.

## 4) Runbook Commands

### Child-worktree bootstrap

- A child agent may start in a fresh worktree without dependencies or generated files. Before testing or building, verify the needed environment is present; do not assume another agent's environment is available.
- When dependencies or generated files are missing, run `./scripts/codex-setup.sh` from the repository root.
- `node_modules/` and the generated `.codex/environments/environment.toml` are ignored local files. Neither belongs in `.worktreeinclude`; the setup configuration invokes the tracked script to recreate dependencies per worktree.

- Install deps: `npm install`
- Start frontend: `npm run dev:frontend` (Vite on `4173`)
- Start backend (dev mode): `npm run dev:backend` (API on `5174`)
- Start backend (study mode): `npm run study:backend -- --data-dir=/absolute/path --learner-id=<stable-id>`
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

## 11) Project Context And Task Scope

- Justin's task prompt and subsequent conversation own the execution contract.
  A direct one-off needs no Linear item to authorize it. Linked task specs add
  context; later issue edits do not silently steer an ongoing task.
- Linear is useful for issue intake and retrieval, but bookkeeping is incomplete.
  Do not infer the full set of current work, priority, or disposition from it.
  GitHub/Git provide review and integration evidence; task threads provide
  execution context. Distinguish implemented, merged, deployed, and observed.
- The persistent steward lives at `/Users/jw/dev/chinese-study-steward`:
  `vision.md` holds the north star, `outlook.md` weekly priorities, and
  `chewing.md` unresolved thinking, not commitments. Its `AGENTS.md` defines
  that role, not this one. Consult for alignment when available; do not require
  that workspace to implement a well-scoped application task or copy it here.
- The old steward/Linear trial is historical. Its WIP counts, lane transitions,
  and dispatch rituals are not implementation-agent prerequisites. Justin
  selects work; do not autonomously dispatch additional portfolio tasks or
  invent replacement bookkeeping rules. Flag material overlap or capacity
  concerns in the handoff rather than assuming a complete ledger.
- Keep independently dispatched tasks in separate worktrees and stage changes
  deliberately. Preserve unrelated work. Implementation normally returns via
  the review workflow in §3; standalone documentation/research may return in chat.
- Report worthwhile out-of-scope ideas for later capture; do not create a
  replacement repository backlog or update external records without authorization.

## 12) Using The Stability Frontier

Read [STABILITY_FRONTIER.md](STABILITY_FRONTIER.md) for safe architectural
assumptions, invariants, and unsettled decisions. Use canonical specs and feature
contracts for detailed intended behavior, architecture maps to locate code, and
runbooks for operations. Plans and working notes supply dated context, not
automatic execution authority; an `active` label alone does not establish
current priority or unfinished implementation.

The frontier is neither a weekly task list nor a release-readiness certificate.
A direct task can change earlier direction explicitly; stale prose must not
silently veto it. Surface consequential contradictions as described in §2,
preserve unaffected constraints, and avoid speculative policy choices.

Correct stale descriptions and reflect already-authorized decisions in owning
docs. Propose material changes to assumptions or invariants when evidence calls
for them; do not independently declare a disputed boundary settled or a proof
gate satisfied because code exists. Each checkout's frontier is a snapshot, not
a cross-worktree status channel.
