# Chinese Study App

A Mandarin study app currently built for a local-browser-first PoC workflow, with a React/Vite frontend and a local backend.

## Architecture Direction

Current architecture is optimized for fast product iteration on one machine.

This is a phase, not a forever constraint:

- Near-to-medium term: local-browser-first development and validation.
- Longer term: keep code and boundaries friendly to a potential hosted web-service migration.

When making changes, prefer designs that avoid unnecessary coupling to single-machine assumptions.

## Current Status

The current milestone includes:

- local Express backend in [`server/`](/Users/jw/dev/chinese-study-app/server)
- SQLite persistence
- revised word/review schema aligned to the learning-review spec
- separate `dev` and `study` backend modes
- sample `Word` records and word-skill scheduler state in `dev` mode
- persisted word states: `unstudied`, `learning`, `review`
- direction-specific review intervals tracked in hours
- mixed study sessions containing due review actions, active learning words, and top-priority unstudied words
- active session snapshot owned by the frontend after session start
- frontend dashboard that loads words and due review actions from the backend API

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

### Study mode

- Command:

  ```bash
  npm run study:backend -- --data-dir="$HOME/path/to/chinese-study-data"
  ```

- Requires an explicit data directory
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
- Database setup: [`server/db.ts`](/Users/jw/dev/chinese-study-app/server/db.ts)
- Product model spec: [`SPECS/learning-review-model.md`](/Users/jw/dev/chinese-study-app/SPECS/learning-review-model.md)
- Default dev database: [`data/app.db`](/Users/jw/dev/chinese-study-app/data/app.db)

If a legacy [`data/app.json`](/Users/jw/dev/chinese-study-app/data/app.json) file exists from the earlier prototype, the backend will import that data into SQLite the first time it initializes an empty database.
