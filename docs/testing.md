# Testing map

Run full suite: `npm test` (Node test runner, `tests/**/*.test.ts`).

## By domain

| Test file | Domain | Imports |
| --- | --- | --- |
| `session-composition.test.ts` | Session payload / scheduling composition | Dynamic `server/db.ts` |
| `session-completion.test.ts` | Session completion commits | Dynamic `server/db.ts` |
| `session-bucket-scheduler.test.ts` | Bucket ordering helpers | `src/domain/study-actions.ts` |
| `session-bucket-state.test.ts` | In-session bucket state | `src/domain/study-actions.ts` |
| `session-selectors.test.ts` | Session UI selectors | `src/features/session/session-selectors.ts` |
| `study-actions.test.ts` | Study action adapters / event derivation | `src/domain/study-actions.ts` |
| `study-attempt-events.test.ts` | Attempt event persistence | Dynamic `server/db.ts` |
| `study-management.test.ts` | Suppress / bad-prompt / management actions | Dynamic `server/db.ts` |
| `study-scheduler-state.test.ts` | Scheduler invariants | Dynamic `server/db.ts` |
| `contrast-content.test.ts` | Contrast clusters and prompts | Dynamic `server/db.ts` |
| `contextual-selection-intake.test.ts` | Contrast intake flows | Dynamic `server/db.ts` |
| `user-priority.test.ts` | User priority patches | Dynamic `server/db.ts` |
| `priority-aliases.test.ts` | French alias lookup | Dynamic `server/db.ts` |
| `word-meanings.test.ts` | Word meanings CRUD | Dynamic `server/db.ts` |
| `dev-db-bootstrap.test.ts` | Dev DB bootstrap | Dynamic `server/db.ts` |
| `study-profile.test.ts` | Study profile helpers | `src/study-profile.ts` |
| `canonical-words.test.ts` | Canonical wordlist scripts | `scripts/lib/canonical-words.ts` |
| `cc-cedict.test.ts` | CC-CEDICT parsing | `scripts/lib/cc-cedict.ts` |
| `subtlex.test.ts` | SUBTLEX parsing | `scripts/lib/subtlex.ts` |

## When changing…

| Area | Run first |
| --- | --- |
| Session composition / SQL scheduling | `session-composition.test.ts` |
| Session end / word lifecycle commits | `session-completion.test.ts` |
| Contrast content or intake | `contrast-content.test.ts`, `contextual-selection-intake.test.ts` |
| Study management / suppression | `study-management.test.ts` |
| Priority / aliases | `user-priority.test.ts`, `priority-aliases.test.ts` |
| Frontend session state only | `session-selectors.test.ts`, `session-bucket-state.test.ts` |
| Schema or bootstrap | `dev-db-bootstrap.test.ts` + any db-touching tests above |

Tests that dynamic-import `server/db.ts` set `APP_MODE=study` and `APP_DATA_DIR` to a temp directory before import.
