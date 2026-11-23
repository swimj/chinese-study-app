# Mandarin Journal prototype

A local, single-learner app for trying a reading, a casual Mandarin conversation, and short practice with one continuous tutor. It has its own package, server, and SQLite journal. Readings, actions, and study records stay separate from the hosted study app.

## Run

Use Node 24.13 or newer. From this directory run:

```sh
npm ci
npm start
```

Open the address printed at startup (**http://127.0.0.1:4320** for the default fixture). With no API key the footer says **Demo tutor** and the server uses short scripted examples. The scripted tutor has examples for birdwatching, 只 and 只是, 透透气, and getting distracted at the library.

To use the real agent, supply `OPENAI_API_KEY` in the environment or in a local, ignored `.env`. The default model is `gpt-6-sol`; set `JOURNAL_MODEL` to change it. The footer says **Live tutor** when provider mode is configured. A learner action can send its text, source passage or exercise, and relevant journal history to the model. `JOURNAL_DEMO=1` forces offline mode.

Which journal opens is separate from the tutor mode. `npm start` opens this checkout's fixture, a realistic demo week built on first start. `npm run start:live` opens the real journal, which lives outside every checkout and only opens from the primary checkout. `npm run start:copy` opens a copy of it made with `npm run journal:copy-live`. The [runbook](RUNBOOK.md) covers paths, ports, updates, backups and restore.

## Home

Home is a scrapbook of what the learner has brought into the journal, grouped by what it is about: each conversation topic and each reading in progress is a cluster. Reflection takeaways show the learner's own words with the tutor's note, margin notes keep their highlighted passage, and saved words sit wherever they appeared; a word that appears in several places links to the others. Anything without a home collects under Loose ends. Nothing on the page is generated for it: every piece comes from the journal state.

On a wide screen the scrapbook is an open table: drag or scroll to move around, pinch or Ctrl/⌘-scroll to zoom, and zoom far out to see clusters folded to their names. **See everything** fits the whole table. On a phone the same clusters read top to bottom with pieces in a sideways row. A small card offers one next step from state alone (practice waiting, else the reading underway, else a conversation), and the bar at the bottom accepts whatever the learner wants to bring in.

## Try a learner journey

1. Open Chat and start a thread about birdwatching. Describe putting out seeds or waiting to see the birds. Reflect on the exchange, follow a quoted takeaway to the original message, and ask the tutor about it. Opening the same reflection again retrieves the saved review. More messages in this thread start a new stretch.
2. Ask the tutor for later practice with 只 and 只是. You can ask whether it is queued or look in the activity view in Saved. Open Practice and answer. Full feedback stays with your attempt. A tutor observation can link back to it later, and you can start a direct discussion from the feedback.
3. Try **河边的报刊亭** in Read. Select a few words or a longer passage and quote them into the margin composer. Leave a note for yourself or ask the tutor a question. The same gesture works on either speaker’s words in a conversation. Reopen the mark to read or continue its thread. The reader remembers your paragraph for each piece. **散场以后** also remains available.
4. Bring a public article into Read with **Import URL**. The importer checks the extracted text for verification, sign-in and error notices before saving it. For ambiguous pages in live mode, one text-only decision call receives a bounded excerpt. Set `JOURNAL_IMPORT_MODEL` to override its default, `gpt-5.4-mini`. When the judge flags the text or cannot decide, the reader previews the result for confirmation. If a source asks for verification, choose **Paste article text** to import a copy with its original URL. The offline demo uses the same preview without making a model call. You can mark it, resume it and discuss it like a built-in reading. When you choose **Discuss in Chinese**, you open the conversation and decide how it begins.
   To bring in a PDF, choose **Upload PDF** in Read. The browser extracts selectable text and saves it as a reading. The file itself stays in your browser. Image-only scans need OCR first. The prototype accepts files up to 20 MiB and 300 pages, with up to 120,000 characters across 2,000 extracted paragraphs.
5. Drop something into the bar at the bottom of Home. A word or short expression goes to the tutor as a word to learn; you can keep using the journal while it is prepared, and a clear expression goes straight into vocabulary practice. If your input could mean several things, the question waits above the bar until you clarify. A link opens the reading importer with the address filled in. A longer sentence goes to the tutor as a question.
6. In Practice, continue for another batch. With learner material available, Daily mix and Build vocabulary request contextual exercises, remembering recent prompts. A fresh journal has a small starter catalogue. Past mistakes replays choice cards whose latest attempt was a miss. Open production gets qualitative feedback.

## Implementation

One pedagogical agent runs via the TypeScript Agents SDK. The server supplies relevant activity, recent turns and recorded practice status. The tutor can retrieve earlier records and link a direct exchange to a reading passage, reflection or particular exercise attempt. A separate conversation partner has the topic and the history of its selected thread. Reflection freezes the new stretch and anchors its takeaways to exact learner quotations. On both reading and chat surfaces, margin threads store the selected range and its conversation. Existing reading notes and reflection takeaways reopen as threads. Saved provides an index back to the original context. Direct requests can save a word or note or queue a completed exercise. Exercise feedback can yield a short observation for the global stream.

The live server uses the project associated with its API key. To inspect activity in OpenAI Platform, open that project's Analytics, then Usage for requests and tokens or Spend for costs. Using a separate key for the prototype makes its calls distinguishable from the hosted app. The offline demo makes no model requests.

Local SQLite stores a single learner’s journal and idempotency receipts. Thread histories, reflections, annotations, queued cards, attempts, tutor observations and action history persist across restarts. Existing prototype journals acquire a first thread and keep their earlier messages and practice records. A request is serialized and its effects commit together. One snapshot per action suits this prototype.

The first personalized round can start with one exercise or previously queued cards. Continuing can generate up to three more at a time. Open responses receive feedback without a correctness grade. The journal has no mastery transitions or timed SRS scheduler.

```sh
npm run check
npm test
```
