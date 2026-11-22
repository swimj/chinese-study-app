# Mandarin Journal prototype

A local, single-learner app for trying a reading, a casual Mandarin conversation, and short practice with one continuous tutor. It has its own package, server, and SQLite journal. Readings, actions, and study records stay separate from the hosted study app.

## Run

Use Node 24.13 or newer. From this directory run:

```sh
npm ci
npm start
```

Open **http://127.0.0.1:4317**. With no API key the footer says **Demo tutor** and the server uses short scripted examples. The scripted tutor has examples for birdwatching, 只 and 只是, 透透气, and getting distracted at the library.

To use the real agent, supply `OPENAI_API_KEY` in the environment or in a local, ignored `.env`. The default model is `gpt-6-sol`; set `JOURNAL_MODEL` to change it. The footer says **Live tutor** when provider mode is configured. A learner action can send its text, source passage or exercise, and relevant journal history to the model. `JOURNAL_DEMO=1` forces offline mode. `JOURNAL_PORT` sets the loopback port, and `JOURNAL_DB` selects a different database path. The default databases are `.local/live.sqlite` and `.local/demo.sqlite`.

## Try a learner journey

1. Open Chat and start a thread about birdwatching. Describe putting out seeds or waiting to see the birds. Reflect on the exchange, follow a quoted takeaway to the original message, and ask the tutor about it. Opening the same reflection again retrieves the saved review. More messages in this thread start a new stretch.
2. Ask the tutor for later practice with 只 and 只是. You can ask whether it is queued or look in the activity view in Saved. Open Practice and answer. Full feedback stays with your attempt. A tutor observation can link back to it later, and you can start a direct discussion from the feedback.
3. Try **河边的报刊亭** in Read. Select a few words or a longer passage and quote them into the margin composer. Leave a note for yourself or ask the tutor a question. The same gesture works on either speaker’s words in a conversation. Reopen the mark to read or continue its thread. The reader remembers your paragraph for each piece. **散场以后** also remains available.
4. In Practice, continue for another batch. With learner material available, Daily mix and Build vocabulary request contextual exercises, remembering recent prompts. A fresh journal has a small starter catalogue. Past mistakes replays choice cards whose latest attempt was a miss. Open production gets qualitative feedback.

## Implementation

One pedagogical agent runs via the TypeScript Agents SDK. The server supplies relevant activity, recent turns and recorded practice status. The tutor can retrieve earlier records and link a direct exchange to a reading passage, reflection or particular exercise attempt. A separate conversation partner has the topic and the history of its selected thread. Reflection freezes the new stretch and anchors its takeaways to exact learner quotations. On both reading and chat surfaces, margin threads store the selected range and its conversation. Existing reading notes and reflection takeaways reopen as threads. Saved provides an index back to the original context. Direct requests can save a word or note or queue a completed exercise. Exercise feedback can yield a short observation for the global stream.

Local SQLite stores a single learner’s journal and idempotency receipts. Thread histories, reflections, annotations, queued cards, attempts, tutor observations and action history persist across restarts. Existing prototype journals acquire a first thread and keep their earlier messages and practice records. A request is serialized and its effects commit together. One snapshot per action suits this prototype.

The first personalized round can start with one exercise or previously queued cards. Continuing can generate up to three more at a time. Open responses receive feedback without a correctness grade. The journal has no mastery transitions or timed SRS scheduler.

```sh
npm run check
npm test
```
