# Scripts catalog

This catalog helps contributors and operators find script commands and the
procedures needed to run them safely. Scripts live under `scripts/`; run with
`node --import tsx scripts/<name>.ts` unless `package.json` defines an npm script.

## Contributor setup and local checks

These commands run a contributor environment, separate from hosted learner use.
Use the checked-out [package.json](../package.json) for command definitions.

In a fresh worktree, run `./scripts/codex-setup.sh` when dependencies are missing;
it installs the lockfile dependencies with `npm ci`. Each worktree needs its own
setup. `node_modules/` and generated `.codex/environments/environment.toml` are
ignored local files; do not add them to `.worktreeinclude`.

| Command | Purpose |
| --- | --- |
| `npm run dev:backend` | Start the seeded development API on port 5174 |
| `npm run dev:frontend` | Start Vite on port 4173 |
| `node --import tsx --test tests/<name>.test.ts` | Run a focused Node test file; use the [testing map](testing.md) to choose coverage |
| `npm test` | Run the full Node test suite |
| `npm run build` | Run TypeScript compilation and the Vite build |

The development backend uses repo-local `data/app.db` by default. Check the
effective data directory before starting or resetting it: existing files under
`data/` may be valued artifacts. Configuration references are in the
[architecture map](architecture.md#configuration) and [.env.example](../.env.example).
The [hosted runbook](ops/hosted-beta-deployment.md) owns deployment configuration
and release procedures.

## Inspect word content fixtures

To inspect how source content becomes a teaching package and review presentation,
run the synthetic examples after contributor setup:

```sh
npm run inspect:word-content
npm run inspect:word-content -- --json
```

The first command prints a readable report; `--json` prints the structured
report. Both cover six word introductions and legacy/structured review
coexistence, including source identities and frozen presentations. The CLI
accesses no database or network and uses no learner data. Its output is a
diagnostic report, not a persistence envelope. See
[word content representation](word-content-representation.md) for the objects
and compatibility boundary being inspected.

## Repeatable UI annotation fixtures

Use `npm run prepare:ui-fixtures -- --data-dir=data/ui-fixtures/<new-run-name>`
to create a fresh Mandarin annotation database. The directory must not already
exist, even if empty. This keeps earlier annotation sessions and other local
databases intact. Each preparation starts from the standard Mandarin seed and
adds these prepared scenarios:

| Words / content | Initial state |
| --- | --- |
| 藤椒, 泡沫 | Top stash, unstudied, bootstrap content and teaching ready; introduction not yet completed |
| 不堪, 石沉大海, 为所欲为 | Teaching completed; learning with 0, 1, and 2 successful practice days, available today |
| 报备 | Teaching and authored review content ready; review admission open and both skills due |
| Home | Five Connections notes in a completed sample session, plus two published sample update posts |

The three-day practice period is the learning phase. Successful practice
completions increase the learning streak; reaching three graduates a word to review. Fixture coverage dates
and review due times are relative to preparation time in UTC, so a newly created
fixture remains useful in later months. Existing standard review and contrast
examples remain available. The normal session composer chooses the study order
and review action; due recognition and production do not imply two separate
cards for the same word in one session.

The command prints the backend startup command for the new directory. Start
that backend and `npm run dev:frontend` in separate terminals, using the normal
local ports. To resume an annotation run, start its existing database again;
to restore the initial scenarios, prepare a new directory. The standard
`dev:backend` seed and existing development databases are unchanged.

Preparation uses authored content and domain persistence functions without
starting provider workers. These are synthetic state snapshots, not replayed
learner histories: teaching-completion events are recorded at preparation time,
while prior learning progress and due dates describe the intended scenario.
The sample session supplies overview and Connections data, not a full attempt
or reflection history. Posts are labeled as local sample content.

`annotation-seed.json` records the dated seed and `fixture-manifest.json` records
the creation time, learner, and scenario identities alongside `app.db`. The
recommended `data/ui-fixtures/` location is ignored by Git. To extend coverage,
update `server/seeds/ui-annotation-data.ts` (dated word states) and
`server/seeds/ui-annotations.ts` (prepared content), then run
`tests/ui-annotation-fixtures.test.ts`. That test checks actual session serving,
scheduler invariants, repeat creation, and refusal to overwrite existing data.

## Safe in dev (repo-local data)

| Script / npm command | Purpose |
| --- | --- |
| `npm run reset:dev-data` | Reset dev SQLite |
| `npm run check:study-scheduler-state -- --mode=study --data-dir=/absolute/path --learner-id=<id>` | Report one learner's scheduler invariant issues |
| `npm run report:word -- --data-dir=/absolute/path --learner-id=<id>` | Interactive read-only report for one learner's exact hanzi matches |
| `scripts/build-canonical-wordlist.ts` | Build canonical wordlist artifact |
| `npm run build:deck-manifest` | Rebuild the checked-in Mandarin HSK deck manifest from externally acquired or locally retained canonical corpus, HSK, and SUBTLEX inputs. See the [provenance and regeneration notes](../README.md#deck-manifest-provenance-and-regeneration). |

## Mutates or targets study / user data (use explicit `--data-dir`)

| Script / npm command | Purpose |
| --- | --- |
| `npm run db:migrate -- --database=/absolute/path/app.db --confirm-app-stopped=true` | Apply versioned schema migrations while the app is stopped; `--status=true` instead is read-only. See [migration runbook](ops/schema-migrations.md). |
| `npm run study:backend` | Start study-mode API |
| `npm run backfill:dogfood-shared-trial -- --data-dir=/absolute/path --learner-id=<id>` | Report the active private generated content that will receive the one-time `shared_trial` launch backfill. Add `--apply=true` only during the hosted dogfood cutover. |

## Hosted beta operations

Most of these require an explicit absolute `--data-dir` and force study/Clerk
runtime configuration. `hosted:upgrade` is the exception: it runs on an
operator checkout against Fly, not against a local data directory. Human and
automated terminal-driver procedures are in the
[release and maintenance runbook](./ops/hosted-beta-deployment.md).

| npm command | Purpose |
| --- | --- |
| `npm run bootstrap:hosted:mandarin -- --data-dir=/data` | Import the checksummed shared-only Mandarin bootstrap artifact |
| `npm run hosted:control -- --data-dir=/data --control=<maintenance\|provider-work> --enabled=<true\|false> --actor-id=<id>` | Change an attributable service control |
| `npm run hosted:whats-new -- --data-dir=/data --actor-id=<id> --input=/absolute/post.json` | Save a draft or published blog post while the app runs. `--list=true` instead lists posts including drafts. See [What’s New](whats-new.md#operator-command). |
| `npm run hosted:banner -- --data-dir=/data --actor-id=<id> --message=<text>` | Post the current signed-in service banner (default 24-hour expiry). `--clear=true` instead of `--message` removes it and no-ops when none exists. |
| `npm run hosted:learner-control -- --data-dir=/data --learner-id=<id> --disabled=<true\|false> --actor-id=<id>` | Disable or re-enable one learner and record the operator action |
| `npm run hosted:prepare-dogfood -- --source-data-dir=<local> --output-data-dir=<new-dir> ...` | Create a coherent, validated, Clerk-bound dogfood cutover copy without mutating the source database |
| `npm run hosted:promote-dogfood -- --data-dir=/data --incoming-db=<staged-db> --manifest=<staged-manifest> ...` | Validate a staged dogfood copy and atomically replace the disposable hosted database only while the normal process is stopped |
| `npm run hosted:sentinel -- --data-dir=/data --sentinel-id=<id> --actor-id=<id>` | Add an immutable restore-proof marker |
| `npm run hosted:invite -- --email-env=<NAME>` | Create one Clerk invitation whose email link returns to `CLERK_AUTHORIZED_PARTY`. Read the address from that env var; do not pass the email on the command line. Run from an operator checkout, not `fly ssh`. |
| `npm run hosted:inspect -- --data-dir=/data --litestream-socket=/data/litestream.sock` | Print bounded database, backup-freshness, and baked release-identity diagnostics |
| `npm run hosted:inspect-client-incidents -- --data-dir=/data --limit=20` | Read uploaded client transport incidents; optionally select one with `--diagnostic-id=<id>` |
| `npm run hosted:inspect-study-commits -- --data-dir=/data --limit=20` | Read recent private study-commit failure records; optionally select one with `--diagnostic-id=<id>` |
| `npm run hosted:smoke -- --data-dir=/data` | Mint a short-lived Clerk session for the designated smoke user and perform a read-only authenticated GET |
| `npm run hosted:upgrade -- --app=<app> --actor-id=<id> --confirm-source-revision=<sha> --confirm-eligible-release=true` | Drive one app-only hosted upgrade from quiesce through smoke and reopen |
| `npm run hosted:verify-restore -- --data-dir=<isolated-dir> --sentinel-id=<id> --minimum-learners=2` | Validate an isolated restored database |

## Libraries (`scripts/lib/`)

Shared Mandarin corpus parsing/build helpers — covered by
`tests/canonical-words.test.ts`, `tests/cc-cedict.test.ts`, and
`tests/subtlex.test.ts`.

Default artifact directory: `ARTIFACTS_DIR` or `./artifacts` (see [artifacts/README.md](../artifacts/README.md)).
