# Chinese Study App

A Mandarin study app currently built for a local-browser-first PoC workflow, with a React/Vite frontend and a local backend.

## Architecture Direction

The implementation still supports fast local iteration, but the primary
dogfood history now runs in the invite-only hosted Mandarin service. The
accepted beta boundary includes explicit learner ownership, shared content,
Clerk identity, Fly/Litestream operation, and deterministic dogfood cutover.
The current build wave is making releases, recovery, and bounded support
repeatable before widening beyond operator-controlled use.

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
- stable learner identities with learner-scoped state/history, shared lexical
  content, and explicitly scoped learner/shared generated content
- a production entrypoint that serves the frontend and API from one origin,
  with Fly/Litestream packaging and a fresh shared-only Mandarin bootstrap

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
Production builds use their serving origin by default, so a separate frontend
server and `VITE_API_BASE` are not required for the hosted beta.

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
  npm run study:backend -- \
    --data-dir="$HOME/path/to/chinese-study-data" \
    --learner-id=dogfood-local
  ```

- Requires an explicit data directory
- For French alias lookup, pass `--study-profile=french` or set `APP_STUDY_PROFILE=french`
- Study mode requires a stable local learner via `--learner-id=<id>` or `APP_LEARNER_ID=<id>`
- Uses `app.db` inside that directory
- Does not seed sample data on first run
- Intended for real study history that you care about preserving

On a brand-new empty study database, the configured learner is bootstrapped
with a `trusted_local` identity mapping; no Clerk registration is involved.
Databases from before the SWI-47 learner-ownership boundary are no longer
supported by current builds; the sole dogfood database has completed that
one-time migration.

We recommend keeping study data outside the cloned repo, even though this version does not enforce that.

### Hosted beta

The bounded hosted deployment uses Clerk auth, one Fly Machine and encrypted
volume, and Litestream replication to versioned S3. Its disposable bring-up
starts from a small checksummed shared Mandarin artifact; the one primary
dogfood database later replaces that fixture through the dedicated cutover. See
the [hosted beta deployment and recovery runbook](docs/ops/hosted-beta-deployment.md)
and the [hosted observability runbook](docs/ops/hosted-observability.md).

Provider traffic is direct by default. Set `APP_USE_LOCAL_PROVIDER_PROXY=true`
only for local dogfood that needs the proxy at `127.0.0.1:7897`; the switch
affects the existing OpenAI and OpenRouter transports and preserves every model
provider in the hosted pool.

## Recommended Workflow

- Keep one clone of the repo for development and another for your stable study use.
- Use `dev` mode in the development clone.
- Use `study` mode in the stable clone, pointing at an explicit external data directory.
- Treat upgrades into the study clone like releases: update code, restart the app, and keep the same study data directory.

### Clerk development fixture

The normal local dogfood commands remain Clerk-free. To exercise the
authenticated hosted path without touching dogfood data, create an ignored
environment file such as `.env.clerk-local` containing:

```bash
CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...
CLERK_AUTHORIZED_PARTY=http://localhost:4175
VITE_CLERK_PUBLISHABLE_KEY=pk_test_...
```

Create a Clerk **development** instance in invite-only mode, add
`http://localhost:4175` as an allowed origin, then run the fixture on separate
ports and with its own disposable database:

```bash
set -a
source .env.clerk-local
set +a
npm run dev:clerk:backend

# In another terminal with the same environment loaded:
npm run dev:clerk:frontend
```

For the two-user fixture, make both Clerk accounts active before signing in:

- To exercise the intended invite-only flow, invite two addresses with real
  inboxes (for example, Mozilla Relay addresses), open each invitation's
  **Accept invitation** link, and finish sign-up.
- To make fixture accounts quickly, use Clerk Dashboard → **Users** →
  **Create user** twice and assign credentials you know.

An address containing `+clerk_test` is useful only for Clerk's normal
email-code verification flow (use code `424242`); it does not provide an inbox
for accepting an invitation. Each active user's first authenticated request
creates a stable local learner mapping. They share only the fixture's lexical
corpus; all study, notes, sessions, and reflection records remain separate.
The fixture database is `data/clerk-dev/app.db`; it is not a source or
destination for the later dogfood migration.

## Data Layout

- Backend entrypoint: [`server/index.ts`](/Users/jw/dev/chinese-study-app/server/index.ts)
- Backend config: [`server/config.ts`](/Users/jw/dev/chinese-study-app/server/config.ts)
- Database barrel: [`server/db.ts`](/Users/jw/dev/chinese-study-app/server/db.ts) (modules in [`server/db/`](server/db/), map in [`docs/server-db.md`](docs/server-db.md))
- Agent/docs index: [`docs/README.md`](docs/README.md)
- Product model spec: [`SPECS/learning-review-model.md`](/Users/jw/dev/chinese-study-app/SPECS/learning-review-model.md)
- Default dev database: [`data/app.db`](/Users/jw/dev/chinese-study-app/data/app.db)
- Checked-in dev seed files: [`server/seeds/mandarin-dev.json`](/Users/jw/dev/chinese-study-app/server/seeds/mandarin-dev.json), [`server/seeds/french-dev.json`](/Users/jw/dev/chinese-study-app/server/seeds/french-dev.json)

Dev mode requires an explicit seed file via `--seed-data` or `APP_SEED_DATA_PATH`. Use `npm run dev:backend`, `npm run dev:french:backend`, or `npm run reset:dev-data` instead of invoking the server manually without a seed path.
