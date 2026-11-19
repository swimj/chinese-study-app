# Legacy Mandarin model retirement plan

status: in-progress
type: coordination
created: 2026-11-19
retire-when: the retirement PRs land or Justin rejects the plan
related:
  - notes/active/2026-11-11-large-file-split-proposal.md
  - SPECS/vocabulary-architecture.md#compatibility-and-operation
  - STABILITY_FRONTIER.md (reflection compatibility)
  - docs/testing.md#coverage-retained-across-the-vocabulary-cutover

Justin's direction (2026-11-19): delete as much of the retired Mandarin study
and reflection model as possible. Agents can recover it from git history, and
the product will not return to that approach. This note sizes the retirement,
lists the decisions it needs, and orders the PRs. No code has moved.

Measurements were taken on the route-split stack (#587–#589, based on `main` at
`4623f5ef`).

## How the measurements were made

1. **File reachability.** I built a TypeScript import graph from every entry
   point: `server/index.ts`, `src/main.tsx`, all `scripts/*.ts`,
   `server/reset-dev-db.ts`, and the repertoire-quality worker. I then cut
   `src/LegacyApp.tsx`, `server/routes/legacy-study-routes.ts`, and
   `server/routes/legacy-reflection-routes.ts`.
2. **Declaration liveness.** I traced checker-resolved references between
   top-level declarations, starting from live roots. Startup-only legacy runtime
   was also cut: the session-completion worker, the reflection generation
   service, and startup reflection recovery. The analysis reaches
   dynamically imported modules. For scripts that load `db.ts` through a
   variable URL and call it as `db.fn()`, any matching exported name counts as
   referenced. That makes the result a **conservative lower bound** on dead
   code.

Both scripts are in the shared session notes folder. They are not committed.

## Size of the dead code

**About 31,500 lines of declarations become dead** across 119 files. That
counts only declarations, not imports or comments.

| Area | Dead lines | Files (fully dead) |
| --- | ---: | --- |
| Frontend UI and libs (`LegacyApp`, `ReflectionsPage`, `features/session`, `features/reflection`, `HomePage`, `lib/session-state`, `lib/session-scheduler`, …) | 15,200 | 52 (37) |
| `server/db` (`reflections.ts` 2,800/4,350; `persistence.ts` 2,160/5,800; `production-cues`, `shared-content`, `pure-cues`, `reflection-quality`, `session-completion`, `recovery-highlights`, …) | 8,700 | 23 |
| Legacy server runtime (`server/reflection/*`, `session-completion/worker`, legacy route modules, `study-commit-diagnostics`) | 4,000 | 14 (9) |
| `src/domain` and `src/services/api.ts` (`reflection.ts` 980/3,300, `reflection-evidence`, `study-actions`, about 830 lines of `api.ts`) | 3,300 | 20 |

**Legacy scripts and fixtures keep a further roughly 5,000 lines alive.**
These dependency chains were confirmed with the tool:
- `scripts/recover-reflection-completion.ts` keeps `materializeReflectionArtifact`
  and all of the result validators in `src/domain/reflection.ts` alive
  (about 4,800 lines).
- `scripts/check-study-scheduler-state.ts` keeps
  `validateStudySchedulerStateInvariants` alive.
- `scripts/prepare-ui-fixtures.ts`, through `server/seeds/ui-annotations.ts`,
  seeds the legacy home. That keeps `getSessionPayload`, `getWords`, and
  `recordReviewSessionSummary` alive.

**Live endpoints and UI still read legacy tables:**
- `/api/status`, which `VocabularyApp` loads, computes:
  - `wordStatusCounts`, which no live client reads;
  - `reviewFailureRateDays` and `sessionActiveTimeMetrics`, which
    `HomeOverviewPanel` reads;
  - legacy `studyNewWordsFirst` and introduction settings.
- The attention badges in `VocabularyApp` and `AppChrome` show
  `reflectionUnseenCount` and `reflectionGenerating`, which come from legacy
  reflection tables.
- Several endpoints in the non-legacy route modules have no live frontend
  caller: `/api/my-words`, `/api/diet/nudge`, the learner content-quality
  encounter and rating writes, the operator content-quality read,
  `/api/learner-settings/study-new-words-first`, and `/api/whats-new-seen*`.

**Tests.** 73 test files reference three or more dead symbols, and 89 more
reference one or two. Some of these are live vocabulary tests that build
fixtures through legacy write paths: `vocabulary-preparation`,
`vocabulary-sense-readiness`, and `sense-inventory-reconciliation-apply`.

## Decisions for Justin

**Outcome (2026-11-19):** Justin accepted the recommendations for decisions 1–5.
Decision 6 is deferred until R5. Findings from R1–R4 may change what that
decision has to cover.

1. **The French profile.** It is the only remaining user of `LegacyApp`, and it
   exists as a local "try-out mode" (README, `dev:french:*`, `french-dev.json`,
   three `SPECS/french-*` plans).
   - **Recommendation:** retire it along with the legacy model. `StudyProfile`
     then collapses to Mandarin.
   - The alternative is to port French to the vocabulary model, which is a
     separate product project.
2. **What happens to historical records.** The contract says "Historical
   records remain readable within their ownership boundaries."
   - **Recommendation:** keep every legacy table, every row, and the baseline
     schema and migrations unchanged, but drop the in-app read paths.
     Historical data stays readable in the database and in backups.
   - This is a change to a product promise, so the owning contract needs an
     update. Reflection compatibility is also listed on the stability frontier.
3. **Schema.** **Recommendation:** no migration in this program.
   - `createBaselineSchema`, `createReflectionSchema`, and the `validate*`
     startup checks stay, so the schema fingerprint is unchanged.
   - Every PR therefore stays eligible for the app-only upgrade route.
   - Dropping legacy tables is an irreversible data change and would be a
     separate, later decision.
4. **Legacy-only operator scripts.** Delete:
   - `recover-reflection-completion`
   - `check-study-scheduler-state`
   - `inspect-study-commit-diagnostics`
   - `recover-correct-cue-repairs` (its runbook section in
     `hosted-beta-deployment.md` goes too)
   - the legacy-home portion of `prepare-ui-fixtures`

   Check each against the hosted runbook before deleting it.
5. **Stale-client fence.** After the routes are removed, the Mandarin cutover
   fence could stay, keeping the 409 "reload" answer for stale clients, or go,
   so that stale clients get 404s. **Recommendation:** keep the fence for one
   release, then delete it together with the last legacy path checks.
6. **Live UI that shows legacy data.** **Recommendation:** remove the legacy
   reflection badge signals and the legacy `/api/status` fields, and either
   remove the `HomeOverviewPanel` metrics that come from legacy tables or
   replace them with vocabulary equivalents. This changes the UI, so it needs
   your call on what Home should show.

## PR sequence

Each PR deletes code only. No schema or data change is planned.

| PR | Removes | Depends on |
| --- | --- | --- |
| **R1. Frontend legacy app and French profile** | `LegacyApp` and the 37 frontend files only it reaches; the `App.tsx` branch; the French profile config, seeds, scripts, and README section; legacy-only UI tests. About 13,000 lines. | D1 |
| **R2. Legacy server routes and runtime** | `legacy-study-routes.ts`, `legacy-reflection-routes.ts`, `server/reflection/*` generation, `session-completion/worker`, startup recovery, the study-commit diagnostic sink, and the matching `CreateAppOptions` fields; legacy HTTP tests. About 4,000 lines. | D1, D5 |
| **R3. Legacy scripts and fixtures** | The scripts from D4; legacy seeding in `ui-annotations.ts`; runbook and `docs/scripts.md` entries. | D4 |
| **R4. Dead persistence and domain code** | Rerun the liveness tool after R1–R3. Shrink `reflections.ts` to schema and validation, and remove the dead parts of `persistence.ts` (composition, study events and projection, scheduler writes, completions), `src/domain/reflection.ts`, `reflection-evidence`, and `api.ts`. Move live vocabulary-test fixtures off legacy write paths. About 10,000 lines. Likely 2–3 PRs, one per module family. | R1–R3 |
| **R5. Shared endpoints and contracts** | The legacy fields from `/api/status`, the legacy attention signals, and the endpoints with no live caller (D6). Also update `SPECS/vocabulary-architecture.md`, `docs/api.md`, `docs/server-db.md`, the `docs/testing.md` cutover-coverage table, and `STABILITY_FRONTIER.md`, and archive the `SPECS/french-*` plans. | D2, D6 |

R1 and R2 touch disjoint files and could proceed in parallel. R4 runs last
because scripts and fixtures keep its targets alive. R5 can follow R2.

## Verification for each PR

- `npm run typecheck:server`, `npm run build` (which runs `tsc` over `src`),
  and the full `npm test`.
- After each PR, rerun the liveness analysis. Code that was live before should
  still be live; a reduction shows up only where the PR intended it.
- **Coverage that must be kept.** Keep every shared-boundary case listed in the
  `docs/testing.md` cutover table, such as `review-policy`, the proxy
  admission tests, and pure-cue stimulus repair. When a mixed test is
  removed, port its shared cases to the vocabulary side.
- **Rendered checks.** R1, R5, and D6 change what the Mandarin app renders:
  Home, the attention badges, and navigation. Check them in the browser,
  including narrow panels.
- **Hosted service.** Confirm there is no schema fingerprint change and that
  the app-only upgrade still applies. For R3, confirm that the runbooks no
  longer reference deleted scripts.

## Risks

- **Fixtures.** Some live vocabulary tests seed data through legacy functions.
  Rewriting those fixtures has to preserve what the tests assert.
- **Dev seeding.** `initializeDatabase` seeds dev databases through the legacy
  seed builders in `persistence.ts`. Check that vocabulary dev and test data
  does not depend on them before R4 removes them.
- **Calls the type checker can't see.** Scripts call `db.fn()` on a
  dynamically imported module, so `tsc` cannot catch a removed function
  there. The liveness tool's name fallback covers this; grep for
  `await import(` callers as a second check.
- **Size of the change.** Roughly 35,000 lines will be deleted. Keep each PR to
  pure deletion plus the minimal rewiring needed. Do not refactor live code
  along the way.
