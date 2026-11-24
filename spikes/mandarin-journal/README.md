# Mandarin Journal prototype

A local, single-learner app for trying a reading, a casual Mandarin conversation, and short practice with one continuous tutor. It has its own package, server, and SQLite journal. Readings, actions, and study records stay separate from the hosted study app.

## Run

Use Node 24.13 or newer. From this directory run:

```sh
npm ci
npm start
```

Open the address printed at startup (**http://127.0.0.1:4320** for the default fixture). With no API key the footer says **Demo tutor** and the server uses short scripted examples. The scripted tutor has examples for birdwatching, 只 and 只是, 透透气, and getting distracted at the library.

To use the real agent, supply `OPENAI_API_KEY` in the environment or in an ignored `.env`. `npm run start:live` and `npm run start:copy` read the repository root `.env` and then this directory's `.env`, with values here winning. Plain `npm start` reads only this directory's `.env`, so the default fixture stays on the offline tutor in every worktree. The tutor and conversation partner default to `gpt-6.2-sol`; set `JOURNAL_MODEL` to change it. The footer says **Live tutor** when provider mode is configured. A learner action can send its text, source passage or exercise, and relevant journal history to the model. `JOURNAL_DEMO=1` forces offline mode.

Which journal opens is separate from the tutor mode. `npm start` opens this checkout's fixture, a realistic demo week built on first start. `npm run start:live` opens the real journal, which lives outside every checkout and only opens from the primary checkout. `npm run start:copy` opens a copy of it made with `npm run journal:copy-live`. The [runbook](RUNBOOK.md) covers paths, ports, updates, backups and restore.

## Home

Home is a scrapbook of what the learner has brought into the journal, grouped by what it is about: each conversation topic and each reading is a cluster. Reflection takeaways show the learner's own words with the tutor's note, margin notes keep their highlighted passage, and saved words sit wherever they appeared; a word that appears in several places links to the others. Anything without a home collects under Loose ends. Nothing on the page is generated for it: every piece comes from the journal state.

On a wide screen the scrapbook is an open table: drag or scroll to move around, pinch or Ctrl/⌘-scroll to zoom, and zoom far out to see clusters folded to their names. **See everything** fits the whole table. On a phone the same clusters read top to bottom with pieces in a sideways row. A small card offers one next step from state alone (practice waiting, else the reading underway, else a conversation), and the bar at the bottom accepts whatever the learner wants to bring in.

After a word is saved or a note is made on a reading, the journal may find a credited Wikimedia Commons picture for it. A strong case is placed as a clipping beside its piece; a weaker one waits on the piece and shows a small **picture ↗** cue when you hover or focus it, with **Keep on board** and **Not for me**. **Pictures: off / quiet / normal** in the menu controls how much shows. [Media on the board](MEDIA.md) describes the judgment model and the composition policy.

## Try a learner journey

1. Open Chat and start a thread about birdwatching. Describe putting out seeds or waiting to see the birds. Reflect on the exchange, follow a quoted takeaway to the original message, and ask the tutor about it. Opening the same reflection again retrieves the saved review. More messages in this thread start a new stretch.
2. Ask the tutor for later practice with 只 and 只是. You can ask whether it is queued or look in the activity view in Saved. Open Practice and answer. Full feedback stays with your attempt. A tutor observation can link back to it later, and you can start a direct discussion from the feedback.
3. Open **河边的报刊亭** from Home and tap 刊 in the opening paragraph. The reader underlines 报刊亭 and shows its pronunciation and meaning there. Tap 刊 in the gloss to inspect the character. Use the floating **← Home** link to return to the story’s cluster. Open **散场以后** from its own title on the table and try 听着听着 for an example of repeated action. Tap any Han character in a built-in or imported passage for a lookup. A clean local match can return immediately. Ambiguous catalog entries use a fast sense selector, and unresolved lookups can ask the contextual model. Six authored examples also work offline. Use **Mark as wrong** on a poor answer. Keyboard users can Tab to a lookup and press Enter. Selecting text offers **Look up**, **Save**, and **Ask** for the exact quote, including across paragraphs. **Save** keeps the occurrence in the journal. Choose **Save with note** to attach a thought such as “practice the way these two clauses fit together.” The note and its passage are available to the tutor when generating later practice. Saved passages share one bookmark in each paragraph. Reopen it to read or add a note. **Ask** opens a margin conversation where you can ask the tutor or leave a note. The progress line beneath **Home** follows the text as you scroll. Reopening the story resumes at your paragraph.
4. Bring a public article onto the table with **Import reading** in the Home menu, or drop a URL into the Home bar. The importer checks the extracted text for verification, sign-in and error notices before saving it. For ambiguous pages in live mode, one text-only decision call receives a bounded excerpt. Set `JOURNAL_IMPORT_MODEL` to override its default, `gpt-5.4-mini`. When the judge flags the text or cannot decide, the reader previews the result for confirmation. If a source asks for verification, choose **Paste article text** to import a copy with its original URL. The offline demo uses the same preview without making a model call. You can mark it, resume it and discuss it like a built-in reading. When you choose **Discuss in Chinese**, you open the conversation and decide how it begins.
   To bring in a PDF, choose **Upload PDF** in the Home import panel. The browser extracts selectable text and saves it as a reading. The file itself stays in your browser. Image-only scans need OCR first. The prototype accepts files up to 20 MiB and 300 pages, with up to 120,000 characters across 2,000 extracted paragraphs.
5. Use **Send** at the bottom of Home to bring something to the Journal. Try 值得 on its own to prepare it for vocabulary practice, then try asking what 值得 means in a sentence. A standalone web address opens the reading importer with the address filled in. If the Journal needs to know what you want to do with a passage, or which sense of a word you meant, continue the exchange in **Tutor**.
6. In Practice, continue for another batch. With learner material available, Daily mix and Build vocabulary request contextual exercises, remembering recent prompts. A fresh journal has a small starter catalogue. Past mistakes replays choice cards whose latest attempt was a miss. Open production gets qualitative feedback.

The [reader runbook](RUNBOOK.md#lookup-dogfood-and-decision-ledger) covers model configuration and exporting dogfood decisions. The [lookup comparison](lookup-experiment/README.md) replays 24 taps and selections with a local dictionary, Gemini Flash Lite and Sol.

## Implementation

One tutor runs via the TypeScript Agents SDK in five situations: a direct exchange, word intake, reflection, exercise feedback and practice generation. These situations in `situations/` share the tutor's voice and evidence rules and each adds its own instructions, input, output schema and validator. Home handles standalone web links directly. For other submissions, a separate capture decision selects word preparation, a direct tutor exchange, or a clarification question. Its live classifier receives the submitted text and context. The offline fixture uses scripted decisions. A separate back-office situation, `mediaConsider`, never speaks to the learner: after a word is saved or a reading note is created, a background job asks it whether a Wikimedia Commons picture could join that piece ([Media on the board](MEDIA.md)). The offline demo uses canned pictures for 报刊亭 and 鸟食 and makes no network requests. The journal validates every live or offline result before applying it. The server supplies relevant activity, recent turns and recorded practice status. The tutor can retrieve earlier records and link a direct exchange to a reading passage, reflection or particular exercise attempt. A separate conversation partner has the topic and the history of its selected thread. Reflection freezes the new stretch and anchors its takeaways to exact learner quotations. On both reading and chat surfaces, margin threads store the selected range and its conversation. Existing reading notes and reflection takeaways reopen as threads. Saved provides an index back to the original context. Direct requests can save a word or note or queue a completed exercise. Exercise feedback can yield a short observation for the global stream.

The live server uses the project associated with its API key. To inspect activity in OpenAI Platform, open that project's Analytics, then Usage for requests and tokens or Spend for costs. Using a separate key for the prototype makes its calls distinguishable from the hosted app. The offline demo makes no model requests.

Local SQLite stores a single learner’s journal and idempotency receipts. Thread histories, reflections, annotations, queued cards, attempts, tutor observations and action history persist across restarts. Existing prototype journals acquire a first thread and keep their earlier messages and practice records. A request is serialized and its effects commit together. One snapshot per action suits this prototype.

The first personalized round can start with one exercise or previously queued cards. Continuing can generate up to three more at a time. Open responses receive feedback without a correctness grade. The journal has no mastery transitions or timed SRS scheduler.

### The record and priority

Beside the journal state, the same SQLite file keeps a record (`record.ts`): **events** for what the learner did, in their own words (chat lines, questions to the tutor, notes, saved passages, added words, exercise answers); **judgments** that interpret events; and **targets**, the words, expressions and constructions being trained. Events commit with the action that produced them. The first open with this version converts earlier activity into events without times.

A background job reads each new chat line, question, note and open answer once (`situations/notice.ts`, never shown to the learner). It records expressions used naturally or with a flaw, needs where the learner reached for something they lacked, and, for an exercise, whether each intended expression was used or avoided. It receives what the tutor already said about the text and stays consistent with it. Choice answers are judged by rule. Converted history is never sent to the model. Each judgment names its source, so judgments can be rerun; only the newest reading of an event counts.

`priority.ts` (version 0) ranks targets from the record. A need, flaw, miss or avoidance raises a target, fading by half every two weeks; two clean days after the latest weakness retire it. Saved words not yet practiced rank next. Words brought in from the hosted app contribute at most 0.3 (a fresh need scores 3), ordered by due date, miss rate and recency of the last miss. Unstudied words from the hosted stash wait to be taught like journal saves; unstudied bulk-repertoire words are not imported. Practice already done today waits. Daily mix asks for exercises on the top targets first, then falls back to recent journal material; each card records the expression it was asked to practice. `npm run journal:priority` prints the ranking with reasons.

```sh
npm run check
npm test
```
