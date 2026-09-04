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

## Hosted beta operations

Most of these require an explicit absolute `--data-dir` and force study/Clerk
runtime configuration. `hosted:upgrade` is the exception: it runs on an
operator checkout against Fly, not against a local data directory. See the
[deployment runbook](./ops/hosted-beta-deployment.md).

| npm command | Purpose |
| --- | --- |
| `npm run bootstrap:hosted:mandarin -- --data-dir=/data` | Import the checksummed shared-only Mandarin bootstrap artifact |
| `npm run hosted:control -- --data-dir=/data --control=<maintenance\|provider-work> --enabled=<true\|false> --actor-id=<id>` | Change an attributable service control |
| `npm run hosted:learner-control -- --data-dir=/data --learner-id=<id> --disabled=<true\|false> --actor-id=<id>` | Disable or re-enable one learner and record the operator action |
| `npm run hosted:prepare-dogfood -- --source-data-dir=<local> --output-data-dir=<new-dir> ...` | Create a coherent, validated, Clerk-bound dogfood cutover copy without mutating the source database |
| `npm run hosted:promote-dogfood -- --data-dir=/data --incoming-db=<staged-db> --manifest=<staged-manifest> ...` | Validate a staged dogfood copy and atomically replace the disposable hosted database only while the normal process is stopped |
| `npm run hosted:sentinel -- --data-dir=/data --sentinel-id=<id> --actor-id=<id>` | Add an immutable restore-proof marker |
| `npm run hosted:inspect -- --data-dir=/data --litestream-socket=/data/litestream.sock` | Print bounded database, backup-freshness, and baked release-identity diagnostics |
| `npm run hosted:smoke -- --data-dir=/data` | Mint a short-lived Clerk session for the designated smoke user and perform a read-only authenticated GET |
| `npm run hosted:upgrade -- --app=<app> --actor-id=<id> --confirm-source-revision=<sha> --confirm-eligible-release=true` | Drive one app-only hosted upgrade from quiesce through smoke and reopen |
| `npm run hosted:verify-restore -- --data-dir=<isolated-dir> --sentinel-id=<id> --minimum-learners=2` | Validate an isolated restored database |

## Libraries (`scripts/lib/`)

Shared Mandarin corpus parsing/build helpers — covered by
`tests/canonical-words.test.ts`, `tests/cc-cedict.test.ts`, and
`tests/subtlex.test.ts`.

Default artifact directory: `ARTIFACTS_DIR` or `./artifacts` (see [artifacts/README.md](../artifacts/README.md)).
