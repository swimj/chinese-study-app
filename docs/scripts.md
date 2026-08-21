# Scripts catalog

Entry points under `scripts/`. Run with `node --import tsx scripts/<name>.ts` unless `package.json` defines an npm script.

## Safe in dev (repo-local data)

| Script / npm command | Purpose |
| --- | --- |
| `npm run reset:dev-data` | Reset dev SQLite |
| `scripts/check-study-scheduler-state.ts` | Report scheduler invariant issues |
| `npm run report:word -- --data-dir=/absolute/path` | Interactive read-only report for exact hanzi matches |
| `scripts/build-canonical-wordlist.ts` | Build canonical wordlist artifact |

## Mutates or targets study / user data (use explicit `--data-dir`)

| Script / npm command | Purpose |
| --- | --- |
| `npm run study:backend` | Start study-mode API |
| `scripts/setup-local-user-data.ts` | Initialize local user data dir |

## Libraries (`scripts/lib/`)

Shared Mandarin corpus parsing/build helpers — covered by
`tests/canonical-words.test.ts`, `tests/cc-cedict.test.ts`, and
`tests/subtlex.test.ts`.

Default artifact directory: `ARTIFACTS_DIR` or `./artifacts` (see [artifacts/README.md](../artifacts/README.md)).
