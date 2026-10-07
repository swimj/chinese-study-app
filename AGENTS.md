# AGENTS.md

Guidance for AI coding agents working in this repository.

## 1) Project Snapshot

- App type: Mandarin study app used through an invite-only hosted beta; contributor development and tests are separate from learner use.
- Frontend: React + Vite + TypeScript in `src/`.
- Backend: Express + TypeScript in `server/`.
- Persistence: SQLite (`app.db`) via Node `DatabaseSync`, modules under `server/db/`.
- Direction: polish, maturity, and debt in the existing learner experience; preserve the hosted ownership and data-safety boundaries while improving it.
- Documentation target: [`docs/documentation-principles.md`](docs/documentation-principles.md) defines the hierarchy independently of today's folders.
- Documentation routes and known adoption gaps: [`docs/README.md`](docs/README.md). Existing files are sources to reconcile, not certified examples of the target.

## 2) Orientation And Task Routing

Use `README.md` for product/repository orientation and `docs/README.md` to locate
the relevant product, implementation, or operations owner and known gaps. Read
`STABILITY_FRONTIER.md` for preserved architectural assumptions and unsettled
decisions when they affect the task (see §12). Then use the task routes below
and `SPECS/README.md` to find existing sources; neither index is an additional
mandatory reading sequence or a claim that its targets meet the standard.

Read the owning contracts and implementation descriptions for the area being
changed, the relevant tests (see [`docs/testing.md`](docs/testing.md)), and
`package.json` before running commands. Consult supplied task-spec notes and
only the working notes relevant to the task; they provide context rather than
authority (see [`notes/README.md`](notes/README.md)).

The direct task instruction and subsequent clarifications supply execution scope.
Product contracts state intended behavior; code determines actual behavior
and tests show what is checked. If these sources conflict with each other or
with an explicit instruction, surface the discrepancy. Apply a clear authorized
change with matching docs and tests; do not silently fix code to a stale spec or
treat existing code as product intent. Continue well-defined work and ask only
when a consequential unresolved product or architectural choice is needed.
Old plans do not override the task.

For documentation work, use [`docs/documentation-principles.md`](docs/documentation-principles.md).
Keep promises, current implementation, and rationale distinguishable; explain
the model in human-readable prose. Establish the right owner under the target
hierarchy instead of preserving accidental structure; improve an existing
explanation in place when it is the right owner.
Existing specs may also contain accidental or stale choices, so recover intent
deliberately rather than treating either code or every spec sentence as settled.

### Task routing

| If you are changing… | Read first | Tests to touch |
| --- | --- | --- |
| Session composition / scheduling | `SPECS/study-action-model.md` (scheduling sections), `session-covering-criteria.md` | `session-composition.test.ts`, `session-bucket-scheduler.test.ts` |
| In-flight session UI / undo | `session-covering-criteria.md`, `SPECS/frontend-architecture-map.md` | `session-selectors.test.ts`, `session-bucket-state.test.ts` |
| Contrast clusters / content | `study-action-model.md` (contrast sections), `reflection-proposals-and-handles.md` (`create_contrast_cluster`) | `contrast-content.test.ts`, `reflection-application.test.ts` |
| Word priority / French aliases | `README.md` (French section), `src/study-profile.ts` | `user-priority.test.ts`, `priority-aliases.test.ts` |
| Persistence / SQL | [`docs/server-db.md`](docs/server-db.md) | matching `tests/*.test.ts` that import `server/db.ts` |
| HTTP API behavior | Relevant feature contract, [`docs/api.md`](docs/api.md), `server/index.ts` | domain tests above + manual smoke if needed |
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

### GitHub review publication

- Justin authorizes agents to push task branches and create or update review
  pull requests in this project's configured GitHub repository as part of the
  implementation workflow above. Verify `origin` points to
  `https://github.com/swimj/chinese-study-app.git` before publishing. This
  standing authorization does not include merging, deploying, force-pushing,
  or publishing to a different repository.
- In a Codex worktree, the shared Git metadata and GitHub network access may
  require sandbox escalation. A failed sandboxed `git push` or `gh auth status`
  does not by itself establish that the host's GitHub login is broken. Diagnose
  the execution context, request the appropriate supported permission, and
  continue publication when allowed. Respect an explicit approval denial;
  report its reason rather than retrying through an indirect route.

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

### UI quality

- Treat visual clarity as part of correctness. Preserve a clear hierarchy between
  the main action or metric, secondary information, and optional explanations.
- Keep routine screens concise. Put calculation notes, raw counts, and technical
  caveats in an accessible disclosure when they are not needed for the next
  decision; keep necessary choices and consequences visible.
- Avoid repeating long labels and prose inside compact cards. Use shared labels
  or a comparison table when several periods show the same metrics. Do not fix
  crowding by shrinking text until it is hard to read or clipping information.
- Check the rendered result in its actual container, including narrow desktop
  panels and enlarged text. Use realistic long labels, large values, empty states,
  and expanded details; check wrapping, overlap, alignment, and keyboard access.
  A passing build alone does not verify a visual change. Report any missing
  visual verification in the handoff.

## 8) Testing Expectations

- Add or update tests for behavior changes when practical.
- Prefer focused node tests under `tests/*.test.ts`.
- For scheduling/session logic changes, update composition/completion tests first.
- Before finishing substantial code changes, run the minimum relevant verification command(s) for the area changed.

## 9) Done Checklist

1. Code compiles and relevant tests pass, where applicable to the change.
2. Relevant intended behavior, implementation, and tests have been reviewed
   for agreement; consequential unresolved discrepancies are surfaced.
3. No accidental data-file modifications.
4. Make a proportional, best-effort update to owning docs when behavior,
   mechanisms, or commands change; report meaningful remaining gaps.

The [documentation principles](docs/documentation-principles.md) define the
target even where the corpus does not conform. Adoption is incremental without
a blanket documentation merge gate. A touched file is not thereby certified;
report the scope checked and meaningful gaps left. Task-specific correctness
and safety requirements still apply.

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
assumptions, invariants, and unsettled decisions. Use product and feature
contracts for detailed intended behavior, implementation explanations for
current mechanisms, and runbooks for operations. The frontier's current mixed
role is an [adoption gap](docs/README.md#known-adoption-gaps), not the target
hierarchy. Plans and working notes supply dated context, not
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
