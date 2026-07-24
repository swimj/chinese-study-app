# HTTP API index

Routes are defined in [server/index.ts](../server/index.ts). Frontend client: [src/services/api.ts](../src/services/api.ts).

Base URL: `http://localhost:5174` (override with `VITE_API_BASE`).

## Status

| Method | Path | Handler domain |
| --- | --- | --- |
| GET | `/api/status` | Config / health |

`GET /api/status?studyDayKey=YYYY-MM-DD` also returns `sessionActiveTimeMetrics`: today's completed active-session duration, plus 3-day and 7-day calendar-day averages in milliseconds. Averages include zero-activity days.

## Words and meanings

| Method | Path | Handler domain |
| --- | --- | --- |
| GET | `/api/words/search` | `words` |
| GET | `/api/words/:id/meanings` | `words` |
| PATCH | `/api/words/:id/personal-notes` | `words` |
| PATCH | `/api/words/:id/user-priority` | `priority` |
| POST | `/api/words/:id/complete-learning-session` | `words` |
| POST | `/api/words/:id/complete-unstudied-session` | `words` |
| POST | `/api/words/:id/dismiss` | `words` |
| PATCH | `/api/words/:wordId/meanings/:meaningId` | `words` |

## Priority / unstudied intake

| Method | Path | Handler domain |
| --- | --- | --- |
| GET | `/api/priority/unstudied` | `priority` |
| GET | `/api/priority/unstudied/top` | `priority` |
| POST | `/api/priority/unstudied/add-by-hanzi` | `priority` |

## Session composition

| Method | Path | Handler domain |
| --- | --- | --- |
| GET | `/api/session-payload` | `session-composition` |

## Study sessions and attempts

| Method | Path | Handler domain |
| --- | --- | --- |
| POST | `/api/study-sessions/:sessionId/accepted-review-attempt-batch` | `study-sessions` |
| POST | `/api/study-sessions/:sessionId/accepted-contrast-selection-attempt` | `study-sessions` |
| POST | `/api/study-sessions/:sessionId/manage-study-action` | `study-management` |
| POST | `/api/review-session-summaries` | `analytics` |

`POST /api/review-session-summaries` accepts a non-negative integer `activeDurationMs` alongside the existing completion counts. The `sessionId` upsert replaces all summary fields, including the duration.

## Study management (outside session)

| Method | Path | Handler domain |
| --- | --- | --- |
| POST | `/api/study-management/production/suppress` | `study-management` |
| POST | `/api/study-management/production/bad-prompt` | `study-management` |

## Contrast clusters and prompts

| Method | Path | Handler domain |
| --- | --- | --- |
| GET | `/api/contrast-clusters` | `contrast` |
| POST | `/api/contrast-clusters` | `contrast` |
| PATCH | `/api/contrast-clusters/:clusterId` | `contrast` |
| POST | `/api/contrast-clusters/:clusterId/members` | `contrast` |
| PATCH | `/api/contrast-clusters/:clusterId/members/:wordId` | `contrast` |
| DELETE | `/api/contrast-clusters/:clusterId/members/:wordId` | `contrast` |
| POST | `/api/contrast-clusters/:clusterId/prompts` | `contrast` |
| PATCH | `/api/contrast-prompts/:promptId` | `contrast` |
| POST | `/api/contrast-prompts/:promptId/resolve-bad-feedback` | `contrast` |
| DELETE | `/api/contrast-prompts/:promptId` | `contrast` |

## Contrast intake

| Method | Path | Handler domain |
| --- | --- | --- |
| GET | `/api/contrast-intake/groups` | `contrast` |
| GET | `/api/contrast-intake/words` | `contrast` |
| POST | `/api/contrast-intake/words/:targetWordId/resolve` | `contrast` |
| POST | `/api/contrast-intake/words/:targetWordId/merge-suggested-clusters` | `contrast` |
| POST | `/api/contrast-intake/groups/accept` | `contrast` |
| POST | `/api/contrast-intake/groups/dismiss` | `contrast` |
| POST | `/api/contrast-intake/groups/create-cluster` | `contrast` |
| POST | `/api/contrast-intake/groups/add-to-cluster` | `contrast` |
| POST | `/api/contrast-intake/groups/add-prompt` | `contrast` |

Domain column matches [server-db.md](./server-db.md) modules.
