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
  reflections, a queued practice request, three words, reading progress with
  margin notes, and practice in progress. `npm run journal:fixture` rebuilds it
  after it has been changed or after the journal shape changes.
- **Against real data:** `npm run journal:copy-live` makes a consistent copy
  of the live journal and leaves the original untouched; it is safe while the
  live server runs. Then run `npm run start:copy`. Everything written there
  stays in the copy. To refresh the copy, pass `--force`.
- Set `JOURNAL_PORT` when several checkouts run at once. `JOURNAL_DB=<path>`
  opens an arbitrary file for one-off investigations.
- Treat copies as personal data. Don't commit them or paste them into issues,
  and delete them when the branch is done (`rm .local/live-copy.sqlite`).

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
