# Scripts catalog

Entry points under `scripts/`. Run with `node --import tsx scripts/<name>.ts` unless `package.json` defines an npm script.

## Safe in dev (repo-local data)

| Script / npm command | Purpose |
| --- | --- |
| `npm run reset:dev-data` | Reset dev SQLite |
| `scripts/list-contrast-content.ts` | List contrast clusters/prompts |
| `scripts/check-study-scheduler-state.ts` | Report scheduler invariant issues |
| `npm run report:word -- --data-dir=/absolute/path` | Interactive read-only report for exact hanzi matches |
| `scripts/check-study-management-state.ts` | Report study-management state |
| `scripts/report-eventual-contrast-selection.ts` | Report eventual contrast-selection coverage |
| `scripts/report-canonical-overlap.ts` | Canonical wordlist overlap report |
| `scripts/compute-priority-bump-unit.ts` | Derive priority bump unit constant |
| `scripts/build-canonical-wordlist.ts` | Build canonical wordlist artifact |
| `npm run build:study-import` | Build study import artifact |

## Mutates or targets study / user data (use explicit `--data-dir`)

| Script / npm command | Purpose |
| --- | --- |
| `npm run study:backend` | Start study-mode API |
| `scripts/setup-local-user-data.ts` | Initialize local user data dir |
| `scripts/import-local-user-data-from-instance.ts` | Import user data from instance |
| `scripts/backfill-word-meanings.ts` | Backfill meanings table |
| `scripts/backfill-contextual-selection-scheduler-state.ts` | Backfill contextual-selection scheduler |
| `scripts/retire-review-items.ts` | Migration: retire legacy review items |
| `npm run friend:mandarin:setup-db` | Build friend Mandarin DB |
| `npm run friend:mandarin:bundle` | Bundle friend distribution |

## Corpus / migration tooling

| Script | Purpose |
| --- | --- |
| `scripts/build-french-corpus.ts` | Build French reading corpus |
| `scripts/load-french-corpus-db.ts` | Load French corpus into DB |
| `scripts/export-hack-chinese-migration.ts` | Export legacy Hack Chinese data |
| `scripts/build-friend-mandarin-db.ts` | Friend Mandarin DB builder |

## Libraries (`scripts/lib/`)

Shared parsing/build helpers — covered by `tests/canonical-words.test.ts`, `tests/cc-cedict.test.ts`, `tests/subtlex.test.ts`.

Default artifact directory: `ARTIFACTS_DIR` or `./artifacts` (see [artifacts/README.md](../artifacts/README.md)).
