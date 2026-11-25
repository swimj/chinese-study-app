# Journal runbook

How to keep one real journal growing across updates while agents work on
branches. The Mac mini can serve the live journal locally and to authorized
devices on its tailnet. Deploying to Fly will need its own guide.

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

## Open the live journal over Tailscale

On the Mac mini, configure private HTTPS forwarding once and bookmark the URL
Tailscale prints on your laptop.

```sh
tailscale serve --bg http://127.0.0.1:4317
```

`npm run start:live` automatically discovers the Mac mini's full MagicDNS name
at startup. The journal listens on loopback and accepts the discovered HTTPS
origin alongside loopback HTTP. The app has no separate login, so use your
tailnet access policy to limit the Serve endpoint to authorized devices or
users. Use private [Tailscale Serve](https://tailscale.com/docs/reference/tailscale-cli/serve)
for the journal.

If `tailscale` is outside your startup PATH, put an absolute
`JOURNAL_TAILSCALE_BIN` path in the spike's ignored `.env` file. On this Mac
with Homebrew, that can be `JOURNAL_TAILSCALE_BIN=/opt/homebrew/bin/tailscale`.
If discovery fails, startup reports loopback-only access. Check Tailscale and
restart the journal to discover its name again. Copy and fixture profiles use
loopback only.

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

## Inspect model activity

Open **Model activity** in the scrapbook menu, or visit `/operator/activity` on the running journal. Choose the last hour, 24 hours, or seven days. The summary counts actions and individual provider attempts by their start times in UTC. Actions include valid local operations and receipt replays. Saving a reading position updates the bookmark without adding an action to Model activity. After a restart, work queued before recording began can appear under **Previously queued**. Expand **Usage by app behavior** to compare action frequency, total calls, calls per action, and spend for actions started in the period. Use **Refresh** for new activity.

Select an action to see its complete trace, including calls that started after the selected period. **Server reply** marks the end of foreground handling. For streaming chat this is the end of the turn, after the text deltas. Background workers can start during the request or after the reply. Each tool step identifies its enclosing run and, when recorded, the model attempt that requested it. Follow the next attempt to see which tool results it used. Model calls and actions each list up to the newest 250 rows in the window. The summary includes the full window.

**Model calls** lists retries and tool-loop turns individually. Provider-reported OpenRouter charges appear as **reported**. For the journal’s standard OpenAI models, **estimated** uses the returned token counts and a dated list-price snapshot, including cached input and, for Sol and Luna, cache-write retention and the long-context rate. Reasoning tokens are included in output. Open the call’s accounting details for the basis of an estimate. An unpriced call contributes to frequency and the unknown count. A local lookup can show zero model spend and still lead to a later dictionary job. OpenAI estimates use the default global Standard tier. Cache writes use the default retention unless the response reports a 12-hour write. [Luna rates](https://developers.openai.com/api/docs/models/gpt-6-luna) · [Sol rates](https://developers.openai.com/api/docs/models/gpt-6.2-sol) · [Mini rates](https://developers.openai.com/api/docs/models/gpt-5.4-mini) · [Nano rates](https://developers.openai.com/api/docs/models/gpt-5.4-nano)

Recording begins when this version serves the journal. The activity tables live in its SQLite database and travel with its backups. They retain timings, operation names and IDs, relationships, outcomes and accounting. Prompts, replies, tool arguments and tool results stay out of the activity ledger. For earlier reader decisions, use the lookup export below.

## Lookup dogfood and decision ledger

Tap a Han character for a quick lookup. Escape, ×, or another tap on the underlined text closes it. Tapping a different word opens its lookup directly. Selecting a span opens Save, Ask and **Look up**. Only Look up requests a definition for that selection. Local matches use CC-CEDICT and the journal’s sense catalog. Its checked-in seed covers 8 headwords and 14 senses. A clean lexical entry can answer immediately. With `OPENROUTER_API_KEY`, the selector can choose a stored sense using the passage. With `OPENAI_API_KEY`, Sol can explain unresolved lookups. `JOURNAL_DEMO=1` disables both model paths. Point `LOOKUP_DICTIONARY` to an extracted CC-CEDICT v1 file to use a full dictionary. The default is the attributed excerpt bundled with the spike.

From the journal directory, a separate fixture server can load provider keys explicitly:

```sh
JOURNAL_PROFILE=fixture JOURNAL_PORT=4386 node --env-file=/path/to/keys.env server.ts
```

**Check in context** asks the stronger model to revisit a quick answer. On a tap, the model can move the underline to a better expression containing the tapped character. Save and Ask follow the visible underline. A deliberate selection keeps its exact span. **Mark as wrong** flags a contextual answer. The ledger records the request for a second look, any difference in span, pronunciation or gloss text, and explicit feedback separately. A change in wording alone can have the same meaning.

Each completed lookup is recorded before the server responds, including answers the learner may dismiss before they arrive. The record includes UTC times, source document and block IDs, the original gesture, the exact text sent for lookup, UTF-16 offsets, the returned range and answer, dictionary and catalog hashes, candidate labels and IDs, selected sense, and routing steps. Model steps include provider, model, prompt hash, elapsed time, outcome and available usage. A flag is a separate, timestamped record linked to the original decision. Repeated feedback preserves the first timestamp.

Export one JSON object per decision from the fixture with the command below. Set `JOURNAL_PROFILE=live` in the primary checkout or `JOURNAL_DB` for a custom journal. The export joins feedback onto its decision. A null feedback field means the learner gave no explicit judgment. Use `startedAt` or `completedAt` to order records. Second looks carry `previousDecisionId` and completed comparisons carry `revision`.

```sh
npm run --silent journal:lookups > .local/lookup-decisions.jsonl
```

### Inspect the growing dictionary

Open `/operator/dictionary` on the running journal to search entries or switch to its change ledger. For the default fixture, visit [Reader dictionary](http://127.0.0.1:4320/operator/dictionary).

For terminal access, run these commands from the journal directory. The first shows the available readings and senses for a spelling. Omit the spelling to list the whole catalog. The second shows lookup decisions in completion order, their catalog outcomes and reasons. Add `--json` for IDs and structured evidence. Both commands use the same journal selection as `journal:lookups`.

```sh
npm run --silent journal:dictionary -- 还
npm run --silent journal:dictionary -- --changes
npm run --silent journal:dictionary -- --changes --json 泡沫
```

After serving a lookup, the journal processes its decision in the background. A catalog match links the occurrence to its existing sense. For an unclassified answer the model can link it to an existing sense, add a reusable sense, or keep the explanation with that passage. This also applies to expressions outside CC-CEDICT. Raw dictionary glosses require this judgment before becoming catalog content. The ledger supplies outstanding work when the journal restarts, including earlier lookups without catalog receipts. With an OpenAI key, the background judge receives the passage, focus, answer, and candidate senses. Work that requires a model stays pending offline. Flagging a contextual answer withdraws its support for learned material. A contextual recheck supersedes the earlier occurrence’s support until the recheck is flagged. A sense with other contextual evidence stays available. Repeating an instant reminder adds a lookup link and supplies no independent evidence for its meaning. Dictionary growth is independent of the learner’s practice record and priority.

Keep both the private decision directory (for example, `.local/fixture.sqlite.lookups/`) and the learned catalog (`.local/fixture.sqlite.catalog.json`) when preserving a journal’s lookup history. Stop the journal before copying these files together. SQLite snapshots and copy-live cover the journal database alone.

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
