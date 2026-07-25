# Server database module map

Persistence lives under [`server/db/`](../server/db/). The stable import path for callers and tests remains [`server/db.ts`](../server/db.ts) (barrel).

## Modules

| Module | Responsibility |
| --- | --- |
| [`connection.ts`](../server/db/connection.ts) | Config resolution per `initDbConnection()`, SQLite singleton (`getDb` / `setDb`) |
| [`types.ts`](../server/db/types.ts) | Row/DTO types, scheduling constants, public type re-exports |
| [`persistence.ts`](../server/db/persistence.ts) | All query/domain functions (words, priority, sessions, contrast, scheduler, analytics, durable learning-policy metadata) and `initializeDatabase` |
| [`schema.ts`](../server/db/schema.ts) | Re-exports `applyProductionContrastExerciseSeed` and `initializeDatabase` for init ordering |
| [`index.ts`](../server/db/index.ts) | Internal re-export barrel |

Domain-oriented re-export shims (navigation only; implementation stays in `persistence.ts`):

| Shim | Key exports |
| --- | --- |
| [`words.ts`](../server/db/words.ts) | `getWords`, `searchWords`, meanings, lifecycle completions |
| [`priority.ts`](../server/db/priority.ts) | Unstudied priority queues, `addUnstudiedUserPriorityByHanzi` |
| [`session-composition.ts`](../server/db/session-composition.ts) | `getSessionPayload`, projection guard |
| [`contrast.ts`](../server/db/contrast.ts) | Clusters, prompts, intake |
| [`study-sessions.ts`](../server/db/study-sessions.ts) | Session records, attempt batches |
| [`study-management.ts`](../server/db/study-management.ts) | Suppress / bad-prompt / management actions |
| [`scheduler.ts`](../server/db/scheduler.ts) | Skill/admission state, invariants |
| [`analytics.ts`](../server/db/analytics.ts) | Failure rates, review summaries, active-session-time metrics |

## Init order

[`server/db.ts`](../server/db.ts) runs:

1. `initDbConnection()` — reads current `APP_*` env and opens `app.db`
2. `initializeDatabase()` — schema, migrations, dev seed

Tests that dynamic-import `server/db.ts?test=…` rely on this running once per import URL.

The `app_metadata` key `daily_new_word_limit` stores the learner's configured
non-negative integer limit. A missing key reads as the current default of `10`,
which preserves existing databases without rewriting them. This setting is
independent of `daily_new_word_intake.new_study_count`, the per-UTC-day counter
incremented only when an unstudied word is completed.

## Primary tests by area

See [testing.md](./testing.md). DB-touching suites import `server/db.ts` with a temp `APP_DATA_DIR`.

## Regenerating from monolith (maintainers)

If you need to rebuild `persistence.ts` from a known-good single file:

```bash
node scripts/rebuild-persistence.mjs
```

Uses the current monolithic `server/db.ts` on disk, or pass another export:

```bash
git show HEAD:server/db.ts > /tmp/db-monolith.ts
node scripts/rebuild-persistence.mjs --source=/tmp/db-monolith.ts
```
