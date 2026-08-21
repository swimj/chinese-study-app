# Chinese Study App

A Mandarin study app currently built for a local-browser-first PoC workflow, with a React/Vite frontend and a local backend.

## Architecture Direction

The implemented architecture is optimized for fast product iteration on one
machine, but the accepted current build wave is an invite-only hosted Mandarin
beta. Local dogfood remains the trusted product-validation environment while a
hosted implementation steel thread introduces account identity, explicit
learner ownership, shared content, migration, release, recovery, and bounded
support access.

See [`STABILITY_FRONTIER.md`](./STABILITY_FRONTIER.md) for the accepted outcome,
non-goals, and advancement test, and
[`docs/private-beta-service-boundary.md`](./docs/private-beta-service-boundary.md)
for the accepted hosted architecture contract. The first beta deliberately uses
one shared embedded SQLite database; Postgres remains an evidence-triggered
later migration rather than a prerequisite for hosting.

When making changes, prefer designs that avoid unnecessary coupling to single-machine assumptions.

## Current Status

The current implementation includes:

- local Express backend in [`server/`](/Users/jw/dev/chinese-study-app/server)
- SQLite persistence
- revised word/review schema aligned to the learning-review spec
- separate `dev` and `study` backend modes
- sample `Word` records and word-skill scheduler state in `dev` mode
- persisted word states: `unstudied`, `learning`, `review`
- direction-specific review intervals tracked in hours
- mixed study sessions containing due review actions, active learning words, and unstudied words admitted by the current new-word intake policy
- active session snapshot owned by the frontend after session start
- frontend dashboard that loads words and due review actions from the backend API
- durable post-session reflection with proposal review, explicit authorization,
  supported application, failure isolation, and retry diagnostics
- immutable production tasks and cues with snapshotted answer spaces,
  learner-authorized cue repair, and exact attempt provenance

## Release Versioning

- Use `package.json` `version` as the single source of truth for releases.
- Bump that value when you cut a release (for example, `1.0.0`).
- The frontend shows the same version in the app chrome, so the running UI always reflects the repo version.

## Getting Started

1. Install packages:

   ```bash
   npm install
   ```

2. Start the backend:

   ```bash
   npm run dev:backend
   ```

   This runs the backend in `dev` mode and uses the repo-local database at [`data/app.db`](/Users/jw/dev/chinese-study-app/data/app.db).

3. In a second terminal, start the frontend:

   ```bash
   npm run dev:frontend
   ```

4. Open the app in your browser at `http://localhost:4173`.

The frontend calls the backend at `http://localhost:5174` by default. You can override that with `VITE_API_BASE`.

## Modes and Data

### Dev mode

- Command:

  ```bash
  npm run dev:backend
  ```

- Uses the repo-local database at [`data/app.db`](/Users/jw/dev/chinese-study-app/data/app.db)
- Seeds sample data on first run
- Safe to reset during development

To reset the default dev database:

```bash
npm run reset:dev-data
```

If your current dev database was created before the latest schema rewrite, reset it once before starting the backend again.

### French profile try-out mode

The French try-out path uses a different dev data directory and seed file. The backend is started with the narrow French study profile so add-priority lookup can consult French aliases, while the frontend selects the French study profile at boot.

Start the backend:

```bash
npm run dev:french:backend
```

Start the frontend:

```bash
npm run dev:french:frontend
```

The backend still stores the same `words` shape. In the French seed data, `hanzi` is the French target term, `pinyin` is pronunciation or a compact grammar note, and `meaning` / `meanings` are English glosses.

Typed production answers use the French profile's forgiving default normalization rules.

### Study mode

- Command:

  ```bash
  npm run study:backend -- --data-dir="$HOME/path/to/chinese-study-data"
  ```

- Requires an explicit data directory
- For French alias lookup, pass `--study-profile=french` or set `APP_STUDY_PROFILE=french`
- Study mode requires a stable local learner via `--learner-id=<id>` or `APP_LEARNER_ID=<id>`
- Uses `app.db` inside that directory
- Does not seed sample data on first run
- Intended for real study history that you care about preserving

We recommend keeping study data outside the cloned repo, even though this version does not enforce that.

## Recommended Workflow

- Keep one clone of the repo for development and another for your stable study use.
- Use `dev` mode in the development clone.
- Use `study` mode in the stable clone, pointing at an explicit external data directory.
- Treat upgrades into the study clone like releases: update code, restart the app, and keep the same study data directory.

## Data Layout

- Backend entrypoint: [`server/index.ts`](/Users/jw/dev/chinese-study-app/server/index.ts)
- Backend config: [`server/config.ts`](/Users/jw/dev/chinese-study-app/server/config.ts)
- Database barrel: [`server/db.ts`](/Users/jw/dev/chinese-study-app/server/db.ts) (modules in [`server/db/`](server/db/), map in [`docs/server-db.md`](docs/server-db.md))
- Agent/docs index: [`docs/README.md`](docs/README.md)
- Product model spec: [`SPECS/learning-review-model.md`](/Users/jw/dev/chinese-study-app/SPECS/learning-review-model.md)
- Default dev database: [`data/app.db`](/Users/jw/dev/chinese-study-app/data/app.db)
- Checked-in dev seed files: [`server/seeds/mandarin-dev.json`](/Users/jw/dev/chinese-study-app/server/seeds/mandarin-dev.json), [`server/seeds/french-dev.json`](/Users/jw/dev/chinese-study-app/server/seeds/french-dev.json)

Dev mode requires an explicit seed file via `--seed-data` or `APP_SEED_DATA_PATH`. Use `npm run dev:backend`, `npm run dev:french:backend`, or `npm run reset:dev-data` instead of invoking the server manually without a seed path.
