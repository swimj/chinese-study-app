# Scripts catalog

Entry points under `scripts/`. Run with `node --import tsx scripts/<name>.ts` unless `package.json` defines an npm script.

## Safe in dev (repo-local data)

| Script / npm command | Purpose |
| --- | --- |
| `npm run reset:dev-data` | Reset dev SQLite |
| `npm run check:study-scheduler-state -- --mode=study --data-dir=/absolute/path --learner-id=<id>` | Report one learner's scheduler invariant issues |
| `npm run report:word -- --data-dir=/absolute/path --learner-id=<id>` | Interactive read-only report for one learner's exact hanzi matches |
| `scripts/build-canonical-wordlist.ts` | Build canonical wordlist artifact |

## Mutates or targets study / user data (use explicit `--data-dir`)

| Script / npm command | Purpose |
| --- | --- |
| `npm run study:backend` | Start study-mode API |
| `npm run backfill:dogfood-shared-trial -- --data-dir=/absolute/path --learner-id=<id>` | Report the active private generated content that will receive the one-time `shared_trial` launch backfill. Add `--apply=true` only during the hosted dogfood cutover. |

## Libraries (`scripts/lib/`)

Shared Mandarin corpus parsing/build helpers — covered by
`tests/canonical-words.test.ts`, `tests/cc-cedict.test.ts`, and
`tests/subtlex.test.ts`.

Default artifact directory: `ARTIFACTS_DIR` or `./artifacts` (see [artifacts/README.md](../artifacts/README.md)).
