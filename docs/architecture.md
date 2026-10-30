# System architecture map

Use this map to locate runtime components, their responsibilities, and configuration when
investigating the application. It provides navigation; the
[product documentation routes](../SPECS/README.md) lead to intended behavior
and guarantees.

## Runtime layout

```text
Browser (Vite dev, :4173; Express-served build in production)
  └── src/          React UI, in-flight session state
        ├── services/api.ts  → HTTP
        └── account-scoped pending client incidents → localStorage
Express (server/index.ts, :5174)
  ├── server/db.ts (barrel) → server/db/*
  │     └── SQLite app.db (APP_DATA_DIR or data/)
  └── private diagnostic sidecars beside app.db
Private metrics listener (server/observability.ts, :9091 hosted only)
  └── Fly Prometheus → Fly managed Grafana operator view
```

## Ownership boundaries

| Concern | Owner |
| --- | --- |
| Durable words, scheduler, contrast content, study events | Backend `server/db/` |
| Session evidence and covering projection | Shared `domain/vocabulary-session.ts`, backend `vocabulary-sessions.ts`, frontend `useVocabularyStudy` |
| Session composition | Backend `server/vocabulary/composition.ts` and `study.ts` |
| API contract | `server/vocabulary/*-routes.ts`, registered in `server/index.ts`, plus `src/services/api.ts` |

For how authenticated identity reaches private SQLite reads and writes, see
[learner context, query scoping, and relationship checks](server-db.md#learner-and-content-scope).

## Frontend (`src/`)

| Area | Path | Notes |
| --- | --- | --- |
| App shell | `App.tsx`, `VocabularyApp.tsx`, `components/AppChrome.tsx` | Profile entry, routing, global errors, backend status |
| Home / study | `pages/VocabularyHomePage.tsx`, `features/vocabulary-study/*`, `features/vocabulary-ui/*` | Controller and presentation; shared Connections remains in `features/session` |
| Words / Stash | [`pages/PriorityPage.tsx`](../src/pages/PriorityPage.tsx), [`features/priority/`](../src/features/priority/) | Add, prioritize, and remove unstudied words; [Word collections](implementation/vocabulary-ui.md#word-collections) |
| Words / My words | [`pages/MyWordsPage.tsx`](../src/pages/MyWordsPage.tsx), [`features/words/useMyWordsController.ts`](../src/features/words/useMyWordsController.ts) | Browse learner collections and word details; [Word collections](implementation/vocabulary-ui.md#word-collections) |
| Feedback / internal review | `pages/VocabularyFeedbackPage.tsx`, `pages/VocabularyOperatorPage.tsx` | Read-only learner lessons; separately allowlisted operator application |
| Content diagnostics | `pages/ContentDiagnosticsPage.tsx`, `features/content/*` | Read-only primitive content browser |
| Shared domain types | `domain/vocabulary-*.ts`, `types.ts` | Content, session commands/projection and API contracts |
| Client transport diagnostics | `domain/client-incidents.ts`, `services/client-incident-diagnostics.ts` | Bounded commit-failure capture and pending upload |
| Study profile | `study-profile.ts` | Mandarin vs French client behavior |

For more frontend code navigation, see the
[frontend architecture map](../SPECS/frontend-architecture-map.md).

## Backend (`server/`)

| File | Role |
| --- | --- |
| `index.ts` | Express app, route handlers (thin) |
| `config.ts` | `APP_MODE`, learner id, data dir, study profile, port |
| `observability.ts`, `hosted-observability.ts` | Content-free HTTP/runtime/SQLite/backup metrics and private Prometheus listener |
| `request-timing.ts`, `db/statement-timing.ts` | Per-request phase accounting (SQLite, provider, auth, response), `Server-Timing` header, and slow-request log |
| `request-flight-recorder.ts` | In-memory recent request summaries and process samples, served to loopback callers on the metrics listener |
| `client-incident-diagnostics.ts`, `study-commit-diagnostics.ts` | Private bounded client-transport and server commit diagnostic sidecars |
| `db.ts` | Barrel: init DB on import, re-export `server/db/*` |
| `db/` | Split persistence and domain logic — see [server-db.md](./server-db.md) |
| `reset-dev-db.ts` | Dev data reset entrypoint |

## Configuration

| Variable | Where | Purpose |
| --- | --- | --- |
| `APP_HOST` | Backend | HTTP bind address (default `0.0.0.0`; new-learner preview uses `127.0.0.1`) |
| `APP_MODE` | Backend | `dev` (seed) or `study` (explicit data dir) |
| `APP_DATA_DIR` | Backend | SQLite directory |
| `APP_LEARNER_ID` | Backend | Stable trusted-local learner selected for this process |
| `APP_STUDY_PROFILE` | Backend | `mandarin` or `french` |
| `APP_SEED_DATA_PATH` | Backend | Required in dev mode; seed JSON path |
| `VITE_API_BASE` | Frontend | API base override; defaults to `http://localhost:5174` in Vite development and the serving origin in production builds |
| `APP_USE_LOCAL_PROVIDER_PROXY` | Backend | Exact `true` opts local OpenAI/OpenRouter calls into `127.0.0.1:7897`; hosted default is direct |
| `APP_METRICS_PORT` | Backend | Optional private Prometheus listener; hosted Fly config uses `9091` |
| `APP_ALLOWED_CLERK_USER_IDS` | Backend | Optional nonempty Clerk user-id allowlist; browser RC restricts access to the restored copy before learner bootstrap |
| `APP_DEPLOYMENT_TIER` | Backend | `release_candidate` enables guarded RC-only database maintenance; never set this on beta |
| `LITESTREAM_REPLICA_PATH` | Hosted | Browser RC uses a separate bucket and a fresh prefix per restored generation; headless rehearsal does not replicate |
| `APP_SLOW_REQUEST_MS` | Backend | Local-time threshold (excluding provider waits) for `request.slow` log events; default `500` |
| `VITE_STUDY_PROFILE` | Frontend | Client study profile |

## Data directories

- Dev default: `data/app.db` (gitignored)
- Study mode: user-provided `--data-dir` (recommended outside repo)
- French dev: `data/french-dev/`
- Artifacts: `artifacts/` (generated; see `artifacts/README.md`)

## Tests

Domain logic is heavily covered under `tests/`. See [testing.md](./testing.md).
