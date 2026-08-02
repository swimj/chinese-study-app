# Server database module map

Persistence lives under [`server/db/`](../server/db/). The stable import path for callers and tests remains [`server/db.ts`](../server/db.ts) (barrel).

## Modules

| Module | Responsibility |
| --- | --- |
| [`connection.ts`](../server/db/connection.ts) | Config resolution per `initDbConnection()`, SQLite singleton (`getDb` / `setDb`) |
| [`types.ts`](../server/db/types.ts) | Row/DTO types, scheduling constants, public type re-exports |
| [`persistence.ts`](../server/db/persistence.ts) | Existing query/domain functions (words, priority, sessions, contrast, scheduler, analytics, durable learning-policy metadata) and `initializeDatabase` |
| [`reflections.ts`](../server/db/reflections.ts) | Reflection schema validation, immutable artifact materialization, queue/detail read models, proposal review, immutable invocation authorization, application/recovery, and supported adapters |
| [`domain-commands.ts`](../server/db/domain-commands.ts) | Shared transaction-aware domain commands used by reflection and legacy/manual paths; currently definition-production suppression |
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

## Reflection persistence

Reflection uses four SQLite tables initialized and validated from
[`reflections.ts`](../server/db/reflections.ts):

| Table | Responsibility |
| --- | --- |
| `reflection_artifacts` | Generate-once evidence/result provenance, unique by source session and reflection-flow version |
| `reflection_generation_runs` | Append-only provider-attempt log, including the exact validated bundle used for retry, failed/truncated attempts, normalized usage, and a persisted price snapshot |
| `reflection_proposal_reviews` | One mutable review status for each immutable `(artifact, item, proposal index)` locator |
| `reflection_operation_invocations` | Immutable authorized operation plus its mutable application status, effects, and non-effect reason |

Artifacts preserve the exact bounded bundle, validated result, generation time,
provider/model/prompt metadata, and schema versions. A restrictive foreign key
keeps the source study session available. Triggers prevent artifact updates,
proposal-identity rewrites, and invocation-authorization rewrites.

Generation runs remain separate from artifacts: an artifact still means a
validated successful result, while the run log records each concluded provider
attempt. A run stores the eligible/included evidence counts, nullable normalized
token categories, response/finish metadata when available, and a complete
versioned pricing basis plus estimate when that provider/model is known. This
makes a historic displayed estimate stable if later pricing tables change. New
runs also retain the exact validated evidence bundle used for the provider call;
failed runs can therefore be retried after the originating session UI closes.
Legacy rows without a saved bundle remain readable but are not retryable.

Materialization and proposal-row seeding are one transaction. The
`(source_session_id, reflection_flow_version)` unique key implements durable
generation idempotency. Acceptance atomically records exact/revised review
disposition, immutable operation authorization, and the initial `pending` or
`unsupported` application. Application is idempotent by invocation id: after
application is terminal, later calls return its recorded status without
duplicating effects.

The supported adapters are:

- definition-production suppression, through
  `suppressDefinitionProductionWithoutTransaction`, preserving legacy
  source-event provenance and reporting preexisting suppression as
  `already_satisfied`; and
- atomic creation of a contrast cluster, members, annotations, and prompts,
  with complete effect references and deterministic exact-postcondition
  detection.

Cue repair and production-alternate operations remain valid authorizations but
persist as `unsupported` without domain writes.

Pending application is recoverable through
`listPendingReflectionInvocationIds()` and
`recoverPendingReflectionInvocations()`. The proposal-review route applies a
supported pending invocation immediately. Direct backend startup calls
`recoverPendingReflectionApplicationsAtStartup()` before listening, so a
process interruption between authorization and application can be resumed.

## Reflection generation modules

Generation is deliberately outside the DB module:

| Module | Responsibility |
| --- | --- |
| [`server/reflection/evidence.ts`](../server/reflection/evidence.ts) | Strict supplement validation; completed-session and accepted-attempt verification; read-only word/content enrichment; canonical bundle construction |
| [`server/reflection/generation.ts`](../server/reflection/generation.ts) | Prelookup idempotency, in-process session/flow request coalescing, bounded evidence counts, provider orchestration, exact-bundle retry, run logging, and valid-result materialization |
| [`server/reflection/luna-provider.ts`](../server/reflection/luna-provider.ts) | Lazy credential loading, pinned Luna model configuration, production prompt loading, structured-output and domain validation, sanitized typed failures with available response metadata |
| [`server/reflection/run-pricing.ts`](../server/reflection/run-pricing.ts) | Versioned hard-coded cost snapshot and estimate math for the initial Luna reflection flow |
| [`server/reflection/prompts/reflection-v2.md`](../server/reflection/prompts/reflection-v2.md) | Promoted initial reflection prompt |
| [`server/llm/`](../server/llm/) | Provider-neutral HTTP, OpenAI-compatible request, token/finish-reason, and JSON-schema validation primitives |

Provider or evidence failure occurs before artifact materialization and never
alters durable study attempts, completion summaries, or scheduling state.

## Init order

[`server/db.ts`](../server/db.ts) runs:

1. `initDbConnection()` — reads current `APP_*` env and opens `app.db`
2. `initializeDatabase()` — schema (including reflection tables/indexes),
   migrations, validation, and dev seed

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
