# Journal runbook

How to keep one real journal growing across updates while agents work on
branches. This covers local use only. Deploying to Fly will need its own guide.

## Where journals live

| Journal | Path | Who opens it | Command |
| --- | --- | --- | --- |
| **Live**: Justin's real journal | `~/Library/Application Support/Mandarin Journal/live.sqlite` | Only the primary checkout, which tracks `main` | `npm run start:live` (port 4317) |
| **Live backups** | `…/Mandarin Journal/backups/live-<time>.sqlite` | Written automatically every time the live journal opens. The newest 30 are kept. | `npm run journal:backup` |
| **Fixture**: a realistic demo week | `<checkout>/.local/fixture.sqlite` | Every checkout by default, including agent worktrees | `npm start` (port 4320) |
| **Copy**: a snapshot of the live journal | `<checkout>/.local/live-copy.sqlite` | A branch checkout that needs real data | `npm run journal:copy-live`, then `npm run start:copy` (port 4319) |

The live journal lives outside every checkout, so merging a PR, removing a
worktree or rebooting can't delete it. `.local/` inside a checkout is
disposable. `npm run journal:where` prints every path for the current checkout.
On Linux the journal home is `$XDG_DATA_HOME/mandarin-journal`.
`JOURNAL_HOME` overrides it.

## Run the real journal from main

```sh
cd ~/dev/chinese-study-app
git switch main && git pull
cd spikes/mandarin-journal
npm ci
npm run start:live
```

`start:live` and `start:copy` read `OPENAI_API_KEY` from the repository root
`.env`, then from `spikes/mandarin-journal/.env` if present (ignored by Git;
it wins). Plain `npm start` reads only the latter, so fixture servers in agent
worktrees, which receive a copy of the root `.env`, stay on the offline tutor. Without a key the live journal opens with the offline demo
tutor. The startup line names the journal, the tutor mode, the path and the
snapshot it just took.

**After a merge:** stop the server, pull, run `npm ci`, and start it again.
The snapshot taken at startup is the restore point from just before the new
code opened the journal. Older journal shapes are upgraded when they are
opened.

The live journal refuses to open from a worktree. `JOURNAL_ALLOW_LIVE=1`
overrides that refusal. Use it only on purpose, and never from an agent.

## Agents and branches

- **Default:** `npm start` in the branch's checkout. On first start it builds
  the fixture by replaying a short week through the offline tutor, so the
  fixture always matches the branch's code. That week is two conversations with
  reflections, a queued practice request, four words, reading progress with
  margin notes, practice in progress, and two offline pictures (报刊亭 placed,
  鸟食 latent). `npm run journal:fixture` rebuilds it
  after it has been changed or after the journal shape changes.
- **Against real data:** `npm run journal:copy-live` makes a consistent copy
  of the live journal and leaves the original untouched; it is safe while the
  live server runs. Then run `npm run start:copy`. Everything written there
  stays in the copy. To refresh the copy, pass `--force`.
- `npm run journal:media-report` lists what the picture job decided and what
  the board shows, with reasons. It reads the fixture by default;
  `-- --copy` or `-- --live` reads the copy or the live journal without
  opening it for work, and `-- --json` prints the data. Its output quotes the
  journal, so treat a report on real data like a copy.
- Set `JOURNAL_PORT` when several checkouts run at once. `JOURNAL_DB=<path>`
  opens an arbitrary file for one-off investigations.
- Treat copies as personal data. Don't commit them or paste them into issues,
  and delete them when the branch is done (`rm .local/live-copy.sqlite`).

## Lookup dogfood and decision ledger

Tap a Han character for a quick lookup. Escape, ×, or another tap on the underlined text closes it. Tapping a different word opens its lookup directly. Selecting a span opens Save, Ask and **Look up**. Only Look up requests a definition for that selection. Local matches use CC-CEDICT and the sample sense catalog (8 headwords, 14 senses). A clean lexical entry can answer immediately. With `OPENROUTER_API_KEY`, the selector can choose a stored sense using the passage. With `OPENAI_API_KEY`, Sol can explain unresolved lookups. `JOURNAL_DEMO=1` disables both model paths. Point `LOOKUP_DICTIONARY` to an extracted CC-CEDICT v1 file to use a full dictionary. The default is the attributed excerpt bundled with the spike.

From the journal directory, a separate fixture server can load provider keys explicitly:

```sh
JOURNAL_PROFILE=fixture JOURNAL_PORT=4386 node --env-file=/path/to/keys.env server.ts
```

**Mark as wrong** flags the individual answer. You can then Ask, select a more useful span, or keep reading. Asking, saving, narrowing, dismissing and returning to the story imply no judgment about correctness.

Each completed lookup is recorded before the server responds, including answers the learner may dismiss before they arrive. The record includes UTC times, source document and block IDs, the original gesture, the exact text sent for lookup, UTF-16 offsets, the returned range and answer, dictionary and catalog hashes, candidate labels and IDs, selected sense, and routing steps. Model steps include provider, model, prompt hash, elapsed time, outcome and available usage. A flag is a separate, timestamped record linked to the original decision. Repeated feedback preserves the first timestamp.

Export one JSON object per decision from the fixture with the command below. Set `JOURNAL_PROFILE=live` in the primary checkout or `JOURNAL_DB` for a custom journal. The export joins feedback onto its decision. A null feedback field means the learner gave no explicit judgment. Use `startedAt` or `completedAt` to order records.

```sh
npm run --silent journal:lookups > .local/lookup-decisions.jsonl
```

The plain JSON files live in a directory alongside the journal, e.g. `.local/fixture.sqlite.lookups/`. Preserve that directory when backing up or moving the evidence. SQLite snapshots and copy-live cover the journal database alone.

## Bring in hosted history

The hosted app's vocabulary can seed the journal's targets: each word's form,
gloss, schedule, production-recall counts and latest wrong answers. Hosted
answers are mostly single-word recall, so they count as a weak input to
priority. Raw attempts stay in the hosted database.

1. Export one learner from the hosted machine. The script opens the database
   read-only and prints JSON; `EXPORT_LEARNER` defaults to the dogfood learner.

   ```sh
   B=$(base64 < hosted-export.cjs | tr -d '\n')
   fly ssh console --app <app-name> --command \
     "sh -c 'echo $B | base64 -d > /tmp/hx.cjs && node /tmp/hx.cjs 2>/dev/null; rm /tmp/hx.cjs'" \
     | grep '^{' > .local/hosted-export.json
   ```

2. Import into a copy first: `npm run journal:import-hosted -- .local/hosted-export.json --copy`,
   then `npm run journal:priority -- --copy` to see the ranking. Importing again
   refreshes the summaries and keeps everything else.
3. From the primary checkout, `--live` imports into the live journal. Take
   `npm run journal:backup` first.

The export and copies are personal data: keep them in `.local/` and delete them
when done. `npm run journal:priority` reads the fixture, `--copy` or `--live`
without opening the journal for work.

## Restore the live journal

1. Stop the live server.
2. Keep the current file just in case:
   `cp live.sqlite live-before-restore.sqlite` in the journal home.
3. Copy the chosen backup over it:
   `cp backups/live-<time>.sqlite live.sqlite`.
4. Run `npm run start:live` and check what you see.

## Not covered yet

- Backups stay on this Mac. Copy the journal home to another disk or cloud
  folder if losing the machine matters.
- Fly deployment, hosted backups and more than one learner.
- `demo.sqlite` in the journal home came from the earlier setup. No profile
  uses it any more.
