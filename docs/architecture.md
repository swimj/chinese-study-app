# System architecture map

Navigation-only overview. Product rules live in `SPECS/` canonical docs.

## Runtime layout

```text
Browser (Vite dev, :4173; Express-served build in production)
  └── src/          React UI, in-flight session state
        └── services/api.ts  → HTTP
Express (server/index.ts, :5174)
  └── server/db.ts (barrel) → server/db/*
        └── SQLite app.db (APP_DATA_DIR or data/)
```

## Ownership boundaries

| Concern | Owner |
| --- | --- |
| Durable words, scheduler, contrast content, study events | Backend `server/db/` |
| Active session snapshot, covering, undo, rating UI | Frontend `src/lib/session-state.ts` + `useStudySession` |
| Session composition (what is due today) | Backend `getSessionPayload` |
| API contract | `server/index.ts` routes + `src/services/api.ts` |

## Frontend (`src/`)

| Area | Path | Notes |
| --- | --- | --- |
| App shell | `App.tsx`, `components/AppChrome.tsx` | Page routing, global errors, backend status |
| Home / study | `pages/HomePage.tsx`, `features/session/*` | Session runtime |
| Priority | `pages/PriorityPage.tsx`, `features/priority/*` | Unstudied queue management |
| Reflections | `pages/ReflectionsPage.tsx`, `features/reflection/*` | Artifact history and proposal review |
| Content diagnostics | `pages/ContentDiagnosticsPage.tsx`, `features/content/*` | Read-only primitive content browser |
| Shared domain types | `domain/study-actions.ts`, `types.ts` | Used by FE and imported by server |
| Study profile | `study-profile.ts` | Mandarin vs French client behavior |

Detail: [SPECS/frontend-architecture-map.md](../SPECS/frontend-architecture-map.md).

## Backend (`server/`)

| File | Role |
| --- | --- |
| `index.ts` | Express app, route handlers (thin) |
| `config.ts` | `APP_MODE`, learner id, data dir, study profile, port |
| `db.ts` | Barrel: init DB on import, re-export `server/db/*` |
| `db/` | Split persistence and domain logic — see [server-db.md](./server-db.md) |
| `reset-dev-db.ts` | Dev data reset entrypoint |

## Configuration

| Variable | Where | Purpose |
| --- | --- | --- |
| `APP_MODE` | Backend | `dev` (seed) or `study` (explicit data dir) |
| `APP_DATA_DIR` | Backend | SQLite directory |
| `APP_LEARNER_ID` | Backend | Stable trusted-local learner selected for this process |
| `APP_STUDY_PROFILE` | Backend | `mandarin` or `french` |
| `APP_SEED_DATA_PATH` | Backend | Required in dev mode; seed JSON path |
| `VITE_API_BASE` | Frontend | API origin (default `http://localhost:5174`) |
| `APP_USE_LOCAL_PROVIDER_PROXY` | Backend | Exact `true` opts local OpenAI/OpenRouter calls into `127.0.0.1:7897`; hosted default is direct |
| `VITE_STUDY_PROFILE` | Frontend | Client study profile |

## Data directories

- Dev default: `data/app.db` (gitignored)
- Study mode: user-provided `--data-dir` (recommended outside repo)
- French dev: `data/french-dev/`
- Artifacts: `artifacts/` (generated; see `artifacts/README.md`)

## Tests

Domain logic is heavily covered under `tests/`. See [testing.md](./testing.md).
