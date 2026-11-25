# The journal's interface: direction and open questions

**Status: a working document.** It began with a design review on Nov 24, 2026,
of the fixture and of Justin's dogfooded journal. Sections are marked
**Settled** (decided with Justin), **Observed** (what the current build does,
with a date), or **Open**. Add decisions to the [log](#decision-log) as they
are made, and move a question to Settled only with Justin.

This document is for anyone shaping what the learner sees and touches: Home,
the rooms, the tutor sheet, and the phone. [The learning model](MODEL.md)
covers what is practiced and why, and [Media on the board](MEDIA.md) covers
pictures. Where an interface choice depends on a learning principle, this
document links to it rather than restating it.

## Foundations (settled)

These came from the design consultation of Nov 19–23, 2026.

- **Mood: a scrapbook that feels alive, made with craft.** Justin's anchors
  are Typeform-style focused flows and software.inc. The anti-model is the
  AWS console, where machinery is exposed as UI.
- **Design is product philosophy.** It decides what to build next, not just
  how things look. There are three layers:
  - *language* can run ahead of what the app can do;
  - *affordances* must match what the app can do;
  - *north-star sketches* are tagged exists, cheap, or far.
- **Three voices.** A learner surface speaks in one of three voices:
  - *companion*: the tutor, warm and in the moment;
  - *instrument*: orientation, such as how much is left;
  - *workshop*: machinery, queues and pipelines.

  Learner surfaces use the first two. The workshop belongs to operator
  views, such as Model activity.
- **Words are promises.** A label must be true about what happens.
- **Hide the mechanics; always show how much is left and how to leave.**
- **Design the bad day.** Decide what a screen feels like after a miss, after
  a week away, and when the tutor gets something wrong.
- **Three loops, one scrapbook.** Each loop leaves traces in the same
  scrapbook:
  - *companion*: seconds of help or capture;
  - *gym*: daily, broad, interleaved practice;
  - *journey*: themes, feeds, rabbit holes.

  Themes have no "done"; they warm, simmer and rest.
- **Points are a means.** The aim is intuition. A point's life ends in
  *absorbed*, not *mastered*. Celebrate what the learner actually expressed,
  never recall (seed → plant).
- **Home layering.** The scrapbook is the base layer, a full-bleed open
  table. Controls form a tucked-away control plane that appears when the
  learner selects something. Hover is only a desktop accelerator, so a tap can
  stand in for it later.
- **One tutor.** It is a companion with a long-running shared context, shown
  as a side sheet, not a floating window. Asking about a piece uses a picker
  mode, not controls on every piece. When the tutor leaves its own pieces on
  the board is a deferred policy.
- **The conversation partner is a separate character, inside the bubble with
  the learner.** It is mostly unaware that it is part of a learning system.
  The tutor is a different character, with its own place. Making the
  division clearer on screen is design work still to do.
- **Phone and desktop.** They may differ in layout and use patterns, but the
  feel, philosophy and rules are shared.

## Mental models for this phase

- **Table and rooms.** Home is the table. Read, Practice and Conversation are
  rooms you step into from it. Rooms can be shaped differently, but they are
  built from the same materials:
  - the same paper;
  - the same tutor sheet;
  - the same way back to the table;
  - no form chrome.
- **Pieces and traces.** The board mirrors the record. *Pieces* are what the
  learner brought or made; *traces* are what happened to them afterwards:
  they were taught, used, missed, used again unprompted. Today the board shows
  pieces only.
- **Whose language fills the screen.** Glance at any surface and ask whether
  most of it is the learner's language or the app's.
  [Production is the product](MODEL.md#principles), so the learner's own
  sentences should be the hero, with glosses as footnotes.

## Observed (Nov 24, 2026)

### What works

- **Home reads as a scrapbook.** It has paper cards on a dotted table, the
  tutor's 师 mark as a quiet inline voice, a credited photo clipping that
  reads as evidence rather than decoration, a soft "Loose ends" pile, and one
  capture bar. The today card ("Keep reading →") offers one next step.
- **Read is the best room.** It is full-bleed paper, with a small "← Home", a
  progress line and a tucked-away Tutor tab.
- **The practice card** opens with a scene in large type, and its
  "0 of 10 min" shows how much is left. **Session complete** ends cleanly with
  *Keep going · 5 min* or *Back home*.
- **Conversation produces real language.** In the dogfooded journal, the
  learner's turns are long, all in Chinese, and about things they care about,
  such as a film's history. This is the product working.

### What pulls against the foundations

1. **The board shows corrections, not expression.** A conversation cluster is
   built from reflection takeaways. Each one quotes a short fragment the
   learner got slightly wrong, with the tutor's fix. The long, fluent turns
   never reach the board. A conversation the learner was proud of becomes a
   wall of corrections. This works against production as the product and
   against celebrating expression.
2. **Glosses outweigh the learner's own context.** On saved-word cards, the
   learner's story about where they met the word (a friend's post, a news
   link) sits in small italics under a dictionary gloss. That story is the
   scrapbook; the gloss is the footnote.
3. **Clusters are sorted by source, not meaning.** The labels read
   CONVERSATION / READING, and one cluster is titled just "Conversation".
   Related material is split by where it came from. The README says Home is
   "grouped by what it is about", which overstates it: the grouping is one
   cluster per conversation topic or reading.
4. **Nothing on the board has a life.** The record now knows when a word is
   taught, settling, used or missed, but no piece shows it. A word saved a
   minute ago looks the same as one the learner later used unprompted.
5. **A reading grows into a tower.** Margin notes stack into one tall column
   per reading, about 16 in the dogfooded journal. With raw English questions
   and "1 reply" counts, a busy reading looks like a tracker rather than a
   scrapbook. Many of those notes were written with an earlier, much simpler
   reader, such as notes that only say "save" or that ask to practice a
   structure; the reader has since been built out to cover those needs (quick
   save, **Save with note**). The layout question remains: what a cluster
   shows once it holds many pieces.
6. **Two houses.** Home and Read are the new house; they were unified on
   purpose. Practice and Conversation
   are still the old one:
   - a "Mandarin journal" masthead and "← Journal";
   - a large H1;
   - `<select>` controls ("Session: Daily mix", "Topic").

   "Daily mix" offers a mode, though
   [modes are dropped](MODEL.md#what-the-hosted-app-contributes) as a
   learner-facing concept. Practice and Conversation haven't had design
   attention yet; this is neglect, not a decision.
7. **The tutor sheet reads like a receipt.** It is one long transcript across
   every surface, and it mixes teaching with system lines. Older lines such
   as "Ready for vocabulary practice: X" predate #634, which now explains a
   word first. The current line "I'll also bring X into practice" is still
   the workshop voice. The evidence that a word
   is in practice should be the word turning up in practice.
8. **The tutor's language switches by surface.** It writes in Chinese on
   conversation takeaways and in English on loose ends and in the sheet. That
   may be right, but it is not yet a rule.
9. **The phone is no longer deferrable.** Clusters run off the right edge,
   the today card is cut off, and the capture bar covers content. Capture and
   daily practice are the phone's job, and those are the loops now being
   built.

## Open questions

These are ordered roughly by how much else depends on them.

1. **Day 60.** What should opening Home feel like after two months? A
   collection ("look how much I've gathered"), a change ("look how I've
   grown"), or a pulse ("here's what's alive this week")? Each leads to a
   different layout and a different answer to the tower problem.
2. **Does the board know things?** Should a piece carry traces of its life,
   such as a mark when a saved word is later used unprompted, with a link to
   that sentence? Or should the board stay a keepsake, with growth shown
   elsewhere? If traces, what do they look like without becoming progress
   bars?
3. **What represents a conversation on the board?** Candidates:
   - the learner's best line;
   - a short excerpt;
   - the takeaways;
   - corrections hidden until the piece is selected.

   The same question applies to a busy reading: a few notes on top and the
   rest folded?
4. **When does grouping by meaning start?** Source clusters are honest and
   cheap. Themes need a judgment, likely agent-made and rerunnable like other
   judgments. What is the smallest step: a shared label across two clusters,
   a link line, or a theme lens the learner turns on?
5. **Making the partner and the tutor read as two characters.** The
   partner is settled as a separate character inside the bubble. How does
   the screen show that? Today the partner's turns and a Tutor button share
   one screen.
6. **The tutor sheet's shape.** Is it one continuous transcript across
   surfaces, or does it show the thread relevant to the current room, with
   the rest one step away? Where do system confirmations go, if anywhere?
7. **Where the learner lands.** Phone in the morning: the table or today's
   practice? Desktop in the evening?
8. **The tutor's language.** When does the tutor write in Chinese, when in
   English, and should the learner set it?
9. **Margin notes that are requests.** When a note asks for practice or a
   feature, should the note itself become actionable, such as "practice this
   pattern"? Constructions are already
   [first-class targets](MODEL.md#vocabulary).

## Prototype-stage tradeoffs

These describe the prototype as it is now, not lasting rules. They may get
stricter once the journal is deployed.

- **Old content is fixed going forward, not backfilled.** Older journal
  content isn't rewritten to match a new fix. Much interactive content goes
  stale by nature: learners keep going forward rather than trawling old
  chats. So when keeping historical data up to date would block an otherwise
  clear solution, accepting the stale data is usually the right trade.

## Feedback awaiting the rewrite

This section collects feedback and new thinking until there is enough for
one holistic rewrite of the document, instead of many small edits. Either
Justin or Claude can decide it is time. Add entries here; small factual fixes
can still go straight into the text.

- *(Nov 24)* First quick pass from Justin. The factual corrections were
  applied inline: legacy reader notes, neglect of Practice and Conversation,
  the partner settled as a separate character, and a prototype-stage tradeoff
  on stale content (not a lasting rule).
- *(Nov 24)* **Justin on what Home is for (reframes Observed 1–3 and Open
  1–4).**
  - **No blue-ribbon board.** Showing what the learner said well feels bland
    or condescending; Justin's attention goes to what he can do better.
    Production is what the learner *does*, not what Home *displays*.
    Observed 1 should be reframed: the problem isn't that the board shows
    corrections; it's that it leads with the error rather than the moment.
  - **Themes emerge; they're never forced.** A single rich item, such as a
    long article, is its own theme. Grouping starts only once there's enough
    content across separate sources. Managing things per item is reasonable
    until then.
  - **Day 60, in three layers:**
    1. *Landmarks.* Reliable portals to the core actions (conversation,
       reading, practice) at the same visual scale as the content. They are
       crafted, not vanilla, and always in the same place, like the
       Poké Mart, Pokémon Center and gym that every town in a Pokémon game
       has, each town with its own flair. They answer the vague
       "I want to do a little Chinese" mood with options varied enough that
       one fits the moment, as an alternative to doom-scrolling.
    2. *What's alive.* A handful of post-it reminders, not twenty, of recent
       points still solidifying, perhaps cycling. This is a leveled-up
       lock-screen word app: ambient, low-intent. It differs because each
       post-it leads with its tie to the past, the memory or scene (an
       "Instagram memory" moment), with the language point underneath.
    3. *The collection.* Browsing saved pieces should feel like going
       through trinkets that bring back memories. It's an active collection:
       what surfaces has a growth arc. A set of collected items, such as an
       article's notes, can be a room, just as a reading is a room.
  - **Surface policy plus semantic zoom.** Home doesn't show every note. As
    one example: when a theme fills most of the view, switch into a richer
    view of that theme without the surrounding noise. This is an
    illustration of the interaction pattern, not a spec.
- *(Nov 24)* **Claude's response to the above, for the rewrite.**
  - *Agreed:* production is the product, but not the display. The board's job
    is the growth edge, framed by memory. This replaces "the learner's
    language as hero" in Mental models.
  - *Risk:* a post-it is only better than a lock-screen widget if its memory
    is real. A word saved bare, with no context, degrades into a flashcard.
    So the surface policy should prefer pieces with rich context, and capture
    may need to invite a line of context without nagging.
  - *Risk:* cycling post-its must not become SRS under another name
    ([MODEL principles 2 and 4](MODEL.md#principles)). Seeing a post-it is
    ambient, not practice, and it counts as no evidence.
  - *Landmarks need today's offer, not a generic label.* The building is
    constant; what's inside varies (the reading underway, a conversation to
    pick up, ten minutes of practice). Keep the set small: a few landmarks
    and maybe one special, so the landing doesn't become a menu.
  - *Open:* what does tapping a post-it do: open its memory, open its room,
    or start a quick rep? How many post-its, and how fast do they cycle?
    What does the town look like on a phone, perhaps as a street?

## Decision log

| Date | Decision | Where it came from |
| --- | --- | --- |
| 2026-11-22 | Scrapbook direction, three loops, points as means | Design consultation (Steward inbox, Nov 22) |
| 2026-11-23 | Home layering: open table, controls on selection, tutor as side sheet, picker mode | Consultation follow-up |
| 2026-11-23 | Media: per-case ceilings under a demote-only composition policy | [MEDIA.md](MEDIA.md) |
| 2026-11-23 | Desktop proves the model first; phone soon; shared philosophy | Consultation follow-up |
| 2026-11-24 | The conversation partner is a separate character inside the bubble, mostly unaware of the learning system | Justin, review of this document |
