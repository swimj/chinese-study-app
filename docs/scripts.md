# Scripts catalog

Entry points under `scripts/`. Run with `node --import tsx scripts/<name>.ts` unless `package.json` defines an npm script.

## Safe in dev (repo-local data)

| Script / npm command | Purpose |
| --- | --- |
| `npm run reset:dev-data` | Reset dev SQLite |
| `npm run check:study-scheduler-state -- --mode=study --data-dir=/absolute/path --learner-id=<id>` | Report one learner's scheduler invariant issues |
| `npm run report:word -- --data-dir=/absolute/path --learner-id=<id>` | Interactive read-only report for one learner's exact hanzi matches |
| `npm run remediate:legacy-prompts -- --data-dir=/absolute/path --learner-id=<id>` | Dry-run report for migrated legacy definition-fallback exclusions |
| `scripts/build-canonical-wordlist.ts` | Build canonical wordlist artifact |

## Mutates or targets study / user data (use explicit `--data-dir`)

| Script / npm command | Purpose |
| --- | --- |
| `npm run study:backend` | Start study-mode API |
| `npm run upgrade:legacy-learner -- --data-dir=/absolute/path --learner-id=<id>` | Report a legacy database upgrade; add `--apply=true` only after reviewing the report |
| `npm run check:legacy-learner-upgrade -- --legacy-db=/absolute/path/to/backup --upgraded-db=/absolute/path/to/app.db --learner-id=<id>` | Compare the critical migrated state with its legacy backup |
| `npm run remediate:legacy-prompts -- --data-dir=/absolute/path --learner-id=<id> --apply=true` | Generate normal reflection artifacts from unprocessed migrated definition-fallback exclusions; requires provider credentials |

The legacy upgrade creates a timestamped backup before apply, preserves study
due dates, assigns private rows to the named learner, validates row counts and
foreign keys, and compares scheduler, priority, learner word state, and
suppression values before replacing `app.db`. It defaults to report-only. The
same comparison can be rerun later against the timestamped backup.

Legacy prompt remediation keeps every exclusion active. It processes at most
25 definition exclusions per provider call, skips migrated contrast exclusions,
and does not repeat words already materialized by an earlier successful apply.
Make a recoverable `app.db` backup and inspect the default dry-run JSON before
using `--apply=true`.

## Libraries (`scripts/lib/`)

Shared Mandarin corpus parsing/build helpers — covered by
`tests/canonical-words.test.ts`, `tests/cc-cedict.test.ts`, and
`tests/subtlex.test.ts`.

Default artifact directory: `ARTIFACTS_DIR` or `./artifacts` (see [artifacts/README.md](../artifacts/README.md)).
