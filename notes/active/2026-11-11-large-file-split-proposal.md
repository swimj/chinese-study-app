# Large source file split proposal

status: in-progress
type: coordination
created: 2026-11-11
retire-when: Justin accepts, revises, or rejects the plan and the accepted PRs land
related:
  - BACKLOG.md#project-organization
  - docs/server-db.md
  - docs/development-principles.md#preserve-behavior-across-implementation-changes
  - docs/testing.md#coverage-retained-across-the-vocabulary-cutover
  - SPECS/vocabulary-architecture.md#compatibility-and-operation

This note proposes module boundaries for the five largest source files and an
order of pure-move PRs.

## Outcome of review (2026-11-19)

Justin approved PRs 1a–1c and set the direction for legacy code: **delete as
much of the retired Mandarin model as possible rather than split it**; agents can
recover it from git history, and the product will not return to that approach.
Sections 2c/2d, 3, 4 and 5 below are therefore superseded by a future scoped
retirement plan. 1c groups fenced legacy routes into `legacy-study-routes.ts`
and `legacy-reflection-routes.ts` so that retirement can remove them whole.

As implemented, 1a–1c differ from the plan below in two ways:
- Shared helpers live in `server/routes/request-helpers.ts`, not
  `request-parsing.ts`, because the shared set also includes error classifiers.
- Instead of a committed route-stack snapshot test (which would make every
  future route addition edit a shared fixture), each PR records scratch
  evidence: the multiset of (method, path, transpiled handler source) is
  identical before and after, and no reordered pair of routes can match the
  same request or crosses an `app.use` layer. Line numbers
refer to `main` at `2b54455e`.

## The finding that changes the order

Four of the five files mostly belong to the **retired Mandarin model**. In the
Mandarin profile, `App.tsx` renders `VocabularyApp`, not `LegacyApp`.
`createVocabularyCutoverFence` returns 409 for legacy session composition, study
writes, and reflection writes. Current work happens in the `vocabulary-*`
modules:

| File | Lines | Commits, last 30 d | Commits, last 90 d | Live in Mandarin today |
| --- | ---: | ---: | ---: | --- |
| `server/db/persistence.ts` | 6,205 | 5 | 60 | Only startup schema and seeding, my-words, settings, and two stash helpers. Composition, scheduler, contrast, and study events are legacy. |
| `server/db/reflections.ts` | 4,661 | 4 | 33 | Schema validation at startup, historical reads, and recovery scripts. Writes are fenced. |
| `src/domain/reflection.ts` | 3,515 | 1 | 23 | Shared types and validators used by legacy reflection, attention badges, and `api.ts`. |
| `server/index.ts` | 2,678 | **10** | 69 | **Yes.** It is the composition root that every feature touches. |
| `src/pages/ReflectionsPage.tsx` | 2,498 | 4 | 56 | No. It is rendered only by `LegacyApp` (the French profile). |

For comparison, the busiest files in the last 30 days are
`server/db/vocabulary-reflection.ts` (32 commits) and
`VocabularyOperatorPage.tsx` (31).

**Implication.** `server/index.ts` is the clear collision hotspot. For the
others, splitting mainly makes reading cheaper when an agent has to
cross-reference legacy behavior. That benefit is real but smaller. Whether to
freeze the legacy code, split it, or retire it depends on a product question
(see the first decision below).

## Conventions every PR follows

- **Pure moves.** Function bodies are copied byte for byte. The only edits
  allowed are imports and exports, plus making a moved private helper
  importable. No renames, reformatting, or "while I'm here" fixes.
- **Stable entry points.** `server/db.ts` and `server/db/index.ts` use
  `export *`, so new `server/db/*` modules get added to `index.ts`. Each old
  file stays at its path as either a shrinking owner or a pure re-export shim.
  Callers and tests do not change in the same PR.
- **Helpers needed by several seams.** Small primitives (date keys,
  `isPlainRecord`, assertion helpers) move to one named internal module per
  file, for example `server/db/persistence-primitives.ts`. Row mappers and
  domain helpers move with their owning domain, so the primitives module does
  not become a grab-bag of utilities.
- **Evidence for each PR.** `npm run build` (tsc and vite), the full
  `npm test`, and a mechanical diff check: a script that confirms every moved
  declaration's text appears unchanged in its new home. Each PR description
  lists the moved symbols and their destinations.

## 1. `server/index.ts`: route registration (recommended first)

**Responsibilities today.** `createApp` (lines 246–2133) holds middleware
setup, about 100 inline handlers, the SPA fallback, and the error handler.
Lines 2134–2550 hold about 30 request-parsing and error-classifying helpers.
The rest is `startServer` and `installGracefulShutdown`.

**Fan-in.** 1 script and 15 tests import it, all through `createApp` and
`startServer`. Six tests import it as `server/index.ts?<query>=<timestamp>` to
get a fresh module instance.

**Existing convention to match.** `registerVocabularyStudyRoutes(app, wake)`,
`registerVocabularyReflectionRoutes(app, {wake})`,
`registerContentImprovementRoutes(app)`, and
`registerSenseContentReconciliationRoutes(app, {wake})`. Each is a
`register<Area>Routes(app: Express, options)` function that lives beside its
subsystem, keeps request parsing local, and calls `server/db` functions. Routers
(`createWordIntroductionRouter`) are used only for mounted sub-apps that are
built from a service object.

**Proposed modules.** These files go in `server/routes/`, because the
legacy-model routes have no live subsystem folder. Each exports
`register<Area>Routes(app, deps)`:

| Module | Routes (current lines) |
| --- | --- |
| `diagnostics-routes.ts` | client incidents, content diagnostics (341–389) |
| `my-words-routes.ts` | `/api/my-words`, word search/meanings, priority, add-by-hanzi, diet nudge, word notes/priority/meaning PATCH (390–416, 553–587, 614–715, 2002–2104) |
| `content-quality-routes.ts` | learner content-quality writes plus operator quality/sharing reads (417–433, 439–500) |
| `operator-routes.ts` | model invocations, word-preparation failures and retry, service banner (488–552) |
| `learner-settings-routes.ts` | `/api/status`, learning policy, learner settings, debrief interests (716–782, 806–867) |
| `session-debrief-routes.ts` | session debriefs (783–805) |
| `legacy-study-routes.ts` | session payload, accepted-attempt batches, pure-cue assessments, manage action, cue reports, suppression, review summaries, word completions/dismiss, recovery highlights (588–613, 868–1171, 1788–1810, 1841–2001) |
| `session-completion-routes.ts` | session completion (1811–1840) |
| `legacy-reflection-routes.ts` | reflections, artifacts, runs, retries, second opinions, proposal review, invocations, quality, help inbox (1172–1638, 1742–1787) |
| `attention-routes.ts` | attention badges, inbox-seen, failed-runs-seen (1639–1667, 1725–1741) |
| `whats-new-routes.ts` | What's New, its attention, and seen cursors (1668–1724) |

`createApp` keeps the middleware chain, the existing `register*` calls in
their current order, the SPA fallback, `/api` 404, and the error handler.
Request helpers move with the only module that uses them. Helpers used by more
than one module go to `server/routes/request-parsing.ts` (`readStudyDayKey*`,
`readPositiveIntegerFromQuery`, `isPlainObject`, `normalizeStudyDayKey`,
`handleHostedProviderWorkError`).

**Risks.**
- **Registration order is behavior in Express.** Handler groups are
  interleaved today; for example, priority routes sit between session-payload
  routes and status. Moving them changes relative order. Checks so far found
  no overlapping patterns across groups: `/api/session-debriefs/latest` comes
  before `/:sessionId`, and both stay in one module.
  `app.use('/api/words', wordIntroRouter)` must stay ahead of every
  `/api/words/*` route. **Mitigation:** PR 1 first adds a characterization test
  that snapshots `app._router.stack` (method, path, and handler arity, in
  order) from `createApp()` (Express 4). Later PRs may reorder only across
  groups whose paths cannot overlap, and each change to the snapshot is
  reviewed explicitly.
- **Fresh-instance imports.** Tests re-import `index.ts?…` for a fresh
  instance, but its imports (`./db.ts`, new route modules) remain process
  singletons. Route modules must therefore hold **no module-level mutable
  state**; everything stays in the `createApp` closure or arrives through
  `deps`. Route modules import from `../db.ts` exactly as `index.ts` does today,
  so import-time database initialization is reached through the same specifier
  and occurs at the same point.
- Body-size middleware (lines 287–291) stays in `createApp`, ahead of all
  registrations.

**PRs.** Three PRs, each moving related groups:
- **1a:** route-inventory test, `request-parsing.ts`, and the live groups
  (diagnostics, operator, settings, debrief, What's New, attention, completion).
- **1b:** my-words and content-quality.
- **1c:** legacy study and legacy reflection.

Expected result: `index.ts` shrinks to about 450 lines.

## 2. `server/db/persistence.ts`

**Responsibilities.** It holds `initializeDatabase` and the baseline schema,
fresh-only validation, dev and sample seed builders, words and my-words,
priority, the legacy session composition and preparation reserve, contrast
CRUD, the study event log with projection (`*WithoutTransaction`), production
attempt evidence, scheduler state and invariants, learner settings and policy,
analytics, and the legacy word lifecycle completions.

**Fan-in.**
- The `server/db.ts` barrel (71 test imports and most of `server/`) through
  `db/index.ts` `export *`.
- Direct imports: 11 shims or modules in `server/db/`, including
  `session-completion.ts` and `vocabulary-stash.ts` (the only current
  vocabulary code that uses it, for two priority functions).
- 9 tests import `persistence.ts` directly (for example `createBaselineSchema`
  and `recordReviewSessionSummary`).

**Seams.** Measured by the cross-references a seam needs from outside itself:

| Seam (new owner) | ~Lines | Needs from rest of file | Notes |
| --- | ---: | --- | --- |
| `schema.ts` (replaces shim) + `dev-seed.ts` | 1,480 | `backfillContrastClusterMemberEligibility` and 5 primitives | Nothing else in the file calls into it. **Cleanest first cut.** |
| `learner-settings.ts` (policy, presentation, introduction order, daily-limit counters) | 230 | `assertStudyDayKey` | Composition, priority, and lifecycle use its internal getters, which become exports. |
| `contrast.ts` (replaces shim) | 535 | `getWords`, `getWordById`, skill relevance rows, 2 asserts | Must move before or with seeding, or seeding imports the backfill from it. |
| `session-composition.ts` (replaces shim) + reserve | 870 | word getters/mappers, settings getters, `freezeProductionExerciseSnapshot` | Nothing else depends on it. |
| `study-events.ts` + `production-attempt-evidence.ts` (study-sessions shim) | 790 + mappers/asserts ~400 | scheduler skill-state write helpers | This is the transactional core. Move its asserts and mappers with it. |
| `scheduler.ts` (replaces shim) | ~400 | word getters | Holds `scheduleWordSkillStateFromReviewAttempt`, the invariants, and the admission/skill-state helpers. |
| `words.ts`, `priority.ts`, `word-lifecycle.ts` | 900 | scheduler helpers, settings counters | Word mappers live here. |
| `analytics.ts` (replaces shim) | 250 | — | |

**Risks.**
- **Import cycles.** `persistence.ts` imports `reflections.ts`
  (`createReflectionSchema`). Nothing that `persistence.ts` imports imports it
  back today; this was checked for direct edges across its 28 local imports.
  New sibling modules can import each other, but `schema.ts` must not be
  imported by any domain module. Keep it a leaf that only `db.ts` reaches.
- **Import-time initialization (BACKLOG).** `server/db.ts` runs
  `initDbConnection(); installLearnerContextSqlFunction(); initializeDatabase();`
  at import. This split does not change that. Moving `initializeDatabase` into
  `schema.ts` is the prerequisite for the BACKLOG follow-up (an explicit
  `openDatabase()` that tests call), which is **out of scope here**. That
  follow-up is a behavior and test-harness change, not a move.
- **Module-level state.** `productionAnswerLookupCache` is a connection-keyed
  `WeakMap`. It must have exactly one home, the production-attempt-evidence
  module, so it is not duplicated.
- **Tests importing internals.** The 9 direct importers keep working because
  `persistence.ts` re-exports moved symbols until a later cleanup PR points
  them at the new owners. `createBaselineSchema` is test-visible.
- **Docs.** The "Domain-oriented re-export shims (navigation only;
  implementation stays in `persistence.ts`)" table in `docs/server-db.md`
  becomes the real module table. Each PR updates the rows it changes.

**PRs.**
- **2a:** schema and dev seed, plus `persistence-primitives.ts`. Reduces the
  file by about 1,480 lines and touches only live startup code.
- **2b:** learner settings and contrast.
- **2c, 2d:** composition, then events, scheduler, and lifecycle, if decision 1
  favors splitting the legacy code.

## 3. `server/db/reflections.ts`

**Fan-in.** `db/index.ts` (and therefore the barrel), `persistence.ts`
(schema), `reflection/generation.ts`, `session-completion/worker.ts`,
`scripts/lib/recover-reflection-completion.ts`, and 4 tests.

**Seams.** Move the contents to `server/db/reflections/` and keep
`reflections.ts` as a re-export barrel:
- `types.ts`: exported types, row types, and column lists (150–626)
- `schema.ts`: create, index, and validate, plus the `assert*Index`/`ForeignKey`
  helpers (627–1041, 4371–4468). About 510 lines; it needs only the column
  lists.
- `artifacts.ts`: materialize, detail, list, and artifact mapping/validation
  (1042–1399, 3174–3305)
- `generation-runs.ts`: runs, continuations, promotion preparation, and retry
  sources (1400–2193, 3073–3173)
- `proposal-review.ts`: defer, dismiss, reopen, supersede, accept, replace,
  manual authorization, and the second-opinion bundle (2194–2707, 2993–3072,
  3306–3364)
- `invocations.ts`: invocation reads/transitions/recovery and application-state
  rows (2708–2857, 3365–3597, 4138–4370)
- `application-adapters.ts`: `apply*WithoutTransaction` for suppression,
  contrast, pure elicitation, pure-cue response and stimulus repair, and unfair
  repair compensation (3598–4137, 4565–4661)
- `cue-repair-recovery.ts`: operator recovery (2858–2992)

**Risks.** The application block is used by much of the rest of the file (13
helpers flow outward). Move it together with `invocations.ts`, or the two will
import each other. `reflections.ts` ↔ `persistence.ts` must stay one-way:
reflection schema is imported by persistence schema. **PRs:** 3a covers types
and schema. 3b covers the rest, if decision 1 favors it.

## 4. `src/domain/reflection.ts`

Pure TypeScript with no database access, shared by client and server. It is
the lowest-risk file, but lives in the coldest area (1 commit in 30 days).

**Fan-in.** 16 non-test modules (`api.ts`, `useAttentionBadges`, the
reflection feature folder, `reflection-evidence.ts`, `pure-cue-reflection.ts`,
and several `server/db` and `server/reflection` modules) plus 17 tests.

**Seams.** Under `src/domain/reflection/`, with `reflection.ts` kept as an
`export *` barrel so 33 importers do not change:
- `bundles.ts` (evidence/bundle versions, 1–285)
- `operations.ts` (operation and wire types, 286–600)
- `results.ts` (proposals and results, 600–775)
- `lifecycle.ts` (`EffectRef`, dispositions, invocation states, 775–870, and
  the transition tables at 3095–3170)
- `quality-and-requests.ts` (quality tags and request DTOs, 869–973)
- `operation-registry.ts` and `operation-validation.ts` (974–1760)
- `result-validation.ts` (1767–2546, 3171–3414)
- `evidence-context.ts` (2547–2777)
- `normalization.ts` (2778–3094)

**Risks.**
- An existing cycle with `pure-cue-reflection.ts`: that file's import of
  `./reflection` is **type-only**, so it is safe, and should stay type-only.
- `src/` uses extensionless imports. The client vite build and the server
  `tsx` both need to resolve the new subfolder (`build` covers vite).
- Moving versioned validators must keep the declaration order that `const`
  registries depend on (`REFLECTION_OPERATION_REGISTRY` refers to validators).

## 5. `src/pages/ReflectionsPage.tsx`

**Fan-in.** `LegacyApp.tsx` and `tests/reflections-page-run-log.test.ts`, which
imports `ReflectionsPage` and two other named exports.

**Seams.** Move the contents into the existing `src/features/reflection/`
folder, and keep the page as the shell plus re-exports:
- `HelpQueueView.tsx` (Help queue, explanation and proposal cards, review
  toolbar; 406–837, 2348–2421)
- `DeferredSecondOpinionQueue.tsx` (217–405)
- `SessionWorkspace.tsx` (838–1123)
- `RunDiagnostics.tsx` (token usage, run diagnostic/status, retry control;
  1124–1434)
- `ProposalCard.tsx` and its outcome components (1514–1756, 2118–2253)
- `QualityTagging.tsx` (1757–2117)
- `EvidenceView.tsx` (2254–2347)
- `reflection-display.ts` (formatters and labels)

**Risk.** This is visual code that only the French profile renders, and
AGENTS.md requires rendered verification for UI changes. A pure move should
produce identical output, but it still needs a browser check of the legacy
Feedback page. That cost is the main reason to defer this file.

## Recommended order

1. **PR 1a:** `server/index.ts` route inventory test, `request-parsing.ts`, and
   the live route groups. This is the highest value, because the file is the
   collision hotspot. It is also the lowest risk: the route-stack snapshot
   locks behavior, and the test suite already exercises the routes over HTTP.
2. **PR 1b, 1c:** the remaining `index.ts` groups.
3. **PR 2a:** `persistence.ts` schema and dev seed. This is a near-leaf seam
   that moves about 1,480 lines and enables the BACKLOG work on
   initialization.
4. **PR 2b:** learner settings and contrast.
5. **Pending decision 1:** 2c/2d, 3a/3b, `src/domain/reflection.ts`, and
   `ReflectionsPage.tsx`.

These are independent stacks touching different files, so 1x and 2x could run
in parallel worktrees. Within a file, the PRs are sequential (a single writer).
Ordinary GitHub PRs suffice; each is self-contained and lands on `main`.

## Decisions for Justin

1. **Legacy code: split, freeze, or retire?** Most of `persistence.ts`, all
   of the legacy reflection stack, and `ReflectionsPage` serve only the French
   `LegacyApp` and historical reads.
   - If the French profile is still a product, splitting is worthwhile.
   - If it is not, a scoped retirement would shrink these files more, and
     with less churn. Per the stability frontier, that retirement needs its
     own decision. Historical reads and migrations still need the schema and
     read paths.
   - A middle option is to split only the live seams (1a–1c, 2a, 2b, 3a) and
     leave the rest frozen.

   **Recommendation:** the middle option, unless the French profile is active.
2. **Location of route modules.** `server/routes/` (proposed) or next to each
   subsystem (`server/session-debrief/routes.ts`, and so on). Next to the
   subsystem matches the vocabulary pattern, but most legacy routes have no
   subsystem folder.
3. **Shim lifetime.** Keep `persistence.ts`, `reflections.ts`, and
   `reflection.ts` as permanent barrels, or point callers and tests at the
   owners in a final cleanup PR and delete the shims. **Recommendation:** keep
   them, since `db.ts` already establishes the barrel pattern.
