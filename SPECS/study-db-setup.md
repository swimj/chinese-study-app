# Study DB Setup

This guide covers local study-mode setup and restore with a supplied SQLite
baseline. See the [hosted operations guide](../docs/ops/hosted-beta-deployment.md)
for the hosted service and the [contributor setup](../docs/scripts.md#contributor-setup-and-local-checks)
for seeded development.

## Prerequisites

Provide a baseline database compatible with the checked-out app. The original
`canonical-study-pristine.db` was a local artifact from the Hack Chinese import.
If you need that exact baseline, obtain a copy from the artifact owner before
starting. The Git checkout does not supply it.

Set `study_baseline` to the absolute path of the copied baseline and
`study_learner_id` to the [stable trusted-local learner ID](../README.md#study-mode)
for this database. Run the npm commands from the repository root.

## Set up a local study database

1. Create a dedicated study data directory outside the repo.

   Example:

   ```bash
   mkdir -p "$HOME/chinese-study-data"
   ```

2. Copy the baseline into that directory as `app.db`. Use a fresh directory
   for this setup.

   ```bash
   cp "${study_baseline:?Set study_baseline to the baseline database path}" "$HOME/chinese-study-data/app.db"
   ```

3. Start the backend in `study` mode and point it at that directory.

   ```bash
   npm run study:backend -- --data-dir="$HOME/chinese-study-data" \
     --learner-id="${study_learner_id:?Set study_learner_id for this database}"
   ```

4. Start the frontend in a second terminal.

   ```bash
   npm run dev:frontend
   ```

5. Verify the backend is using the correct database.

   Open:

   - `http://localhost:5174/api/status`

   Confirm:

   - `mode` is `study`
   - `dataDir` points at your external study directory
   - `dbPath` ends with `/app.db`

## Fast Restore Procedure

If your study DB gets into a bad state during testing:

1. Stop the backend.
2. Back up the current live DB.

   ```bash
   cp "$HOME/chinese-study-data/app.db" "$HOME/chinese-study-data/app.db.backup-$(date +%Y%m%d-%H%M%S)"
   ```

3. Restore from the pristine baseline.

   ```bash
   cp "${study_baseline:?Set study_baseline to the baseline database path}" "$HOME/chinese-study-data/app.db"
   ```

4. Restart the backend in study mode.
