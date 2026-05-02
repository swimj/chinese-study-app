# Study DB Setup

This repo supports two backend modes:

- `dev`: uses repo-local sample/dev data
- `study`: uses a real SQLite database stored in an explicit data directory

For real study use, the safest database artifact is:

- [data/canonical-study-pristine.db](/Users/jw/dev/chinese-study-app/data/canonical-study-pristine.db)

That file was regenerated from the import pipeline after the Hack Chinese review patch and curated unmatched-word import, so it is the clean baseline to use going forward.

## Recommended Setup In A Proper Study Repo

1. Create a dedicated study data directory outside the repo.

   Example:

   ```bash
   mkdir -p "$HOME/chinese-study-data"
   ```

2. Copy the pristine DB into that directory as `app.db`.

   ```bash
   cp /Users/jw/dev/chinese-study-app/data/canonical-study-pristine.db "$HOME/chinese-study-data/app.db"
   ```

3. Start the backend in `study` mode and point it at that directory.

   ```bash
   npm run study:backend -- --data-dir="$HOME/chinese-study-data"
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
   cp /Users/jw/dev/chinese-study-app/data/canonical-study-pristine.db "$HOME/chinese-study-data/app.db"
   ```

4. Restart the backend in study mode.

## Notes

- `study` mode always expects the database file to be named `app.db` inside the chosen `--data-dir`.
- You do not need the large source artifacts in the proper study repo if you are copying in a finished DB.
- If you want a transparent export format too, this repo also has [data/canonical-study.sql](/Users/jw/dev/chinese-study-app/data/canonical-study.sql), but the simplest path is copying the SQLite file directly.
