# Mandarin Journal prototype

A local, single-learner app for trying a reading, a casual Mandarin conversation, and short practice with one continuous tutor. It has its own package, server, and SQLite journal. Readings, actions, and study records stay separate from the hosted study app.

## Run

Use Node 24.13 or newer. From this directory run:

```sh
npm ci
npm start
```

Open **http://127.0.0.1:4317**. With no API key the footer says **Demo tutor** and the server uses short scripted examples. The concert reading, 透透气, and talking about getting distracted at the library give the demo useful context.

To use the real agent, supply `OPENAI_API_KEY` in the environment or in a local, ignored `.env`. The default model is `gpt-6-sol`; set `JOURNAL_MODEL` to change it. The footer says **Live tutor** when provider mode is configured. A learner action can send its text, source passage or exercise, and relevant journal history to the model. `JOURNAL_DEMO=1` forces offline mode. `JOURNAL_PORT` sets the loopback port, and `JOURNAL_DB` selects a different database path. The default databases are `.local/live.sqlite` and `.local/demo.sqlite`.

## Try a learner journey

1. Open **散场以后**, tap **透透气**, then ask the tutor to stash it. Open **Saved** to find the word and return to the passage.
2. Open the speech bubble and chat in Chinese. Try describing what happens to your attention when you work at home. **Reflect with tutor** brings that conversation to the continuous tutor thread.
3. Open **Practice**. Daily mix can bring back a thought from the journal in a fresh situation. Build vocabulary favors first encounters. Past mistakes uses your own missed choice exercises and can be empty on first use. Choice answers are checked locally. Open production receives qualitative feedback.
4. Refresh or restart the server. Saved items, messages, served exercises, submitted answers and the current session persist.

## Implementation

One pedagogical agent runs via the official TypeScript Agents SDK. It receives the current situation and bounded recent turns; a read-only tool can look up earlier journal records. A separate casual-conversation role has access to its own history and source passage. The server validates tutor actions and commits the conversation, journal effect, and request receipt together. Practice saves a generated exercise privately as served. Generated feedback can introduce a word, explain a particular use, or suggest a later exercise. A capped starter catalogue keeps a fresh journal usable.

This is a single-user loopback prototype. Its three practice modes illustrate the product and do not implement the main app’s SRS scheduling. The server serializes actions, including model calls, and writes a journal snapshot per action. Local SQLite is sufficient for this trial; concurrent hosted access and long-term storage optimization are outside this prototype.

```sh
npm run check
npm test
```
