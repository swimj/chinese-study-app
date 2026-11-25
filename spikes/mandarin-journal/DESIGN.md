# The journal's interface

**Status: a living document.** Last rewritten on Nov 24, 2026, from a design
conversation with Justin. Items are **Settled** (agreed with Justin),
**Observed** (what the build does, dated) or **Open**. Small factual fixes go
straight into the text. Bigger thinking is added, dated, under
[Feedback awaiting the rewrite](#feedback-awaiting-the-rewrite) and folded in
at the next rewrite. Decisions are added to the [log](#decision-log).

This document is for anyone shaping what the learner sees and touches: Home,
the rooms, the tutor, and the phone. [The learning model](MODEL.md) covers
what is practiced and why, and [Media on the board](MEDIA.md) covers
pictures. This document links to them rather than restating them.

## The vision: a town you come back to (settled)

### What opening the app should feel like

Three feelings, in order of how often they come up:

1. **"I want to do a little Chinese, but I don't know what."** The intent is
   vague, close to the urge to doom-scroll. Home should offer a few options
   that are different enough from one another that one of them fits the
   learner's mood and setting.
2. **"What am I in the middle of learning?"** The interesting progress is the
   recent points that are still solidifying, not a record of what went well.
3. **"Oh, that's me."** The page shows the human who put themselves into it.
   Even the current prototype's chaotic wall of notes has some of this. That
   was MySpace's charm: in the chaos you could sense the person, which today's
   dominant platforms rarely allow.

### Home in three layers

The model is a town in a Pokémon game. Every town has a mart, a Pokémon
Center and a gym, so a player always knows how to get around it. Each town
also has its own color and flair. The core places are reliable and still
crafted; the flair changes.

1. **Landmarks.** These are portals to the core actions: conversation,
   reading and practice. They sit at the same visual scale as the content,
   always in the same place, and are crafted rather than vanilla. Each
   carries **today's offer**, not a generic label: "Pick up 芳华", not
   "Conversation". The building stays the same; what's inside changes. The
   set stays small, a few landmarks and perhaps one special, so the landing
   doesn't turn into a menu. Later, landmarks can come and go by day, or the
   learner can choose them.
2. *(Deferred.)* **What's alive.** This is a handful of post-its (not twenty) for recent
   points that are still solidifying, perhaps cycling through. Think of a
   leveled-up lock-screen word app: ambient and low-intent, decoration with a
   hint of study. Each post-it **leads with its tie to the past**, the
   moment or scene it came from, like a photo memory resurfacing, with the
   language point underneath.
3. **The collection.** These are the learner's saved pieces, to browse like a
   box of trinkets that bring back memories. It is an active collection:
   what surfaces has a growth arc. Trinkets come first. Once browsing works,
   they can gain more depth, such as a study session built around a theme.

### Rooms

The learner steps from Home into a room. Rooms can be shaped very differently,
but they are built from the same materials: the same paper, the same tutor,
the same way back, and no form chrome.

- **Read**, **Conversation** and **Practice** are rooms.
- **A collection is a room too.** An article's notes can be a room beside
  the article itself. When something fills most of the view, Home can switch
  into that room's richer view without the surrounding noise. This is an
  illustration of the semantic-zoom pattern, not a spec.
- **Projects** are a new room type. The learner names something they want to
  do: cook a few Chinese dishes, pitch their software app, or talk about
  climbing movement at the gym. The tutor uses what it knows about them to lay
  out a journey toward it and teaches the relevant Chinese along the way. A
  project gives its landmark an offer every day. Projects make the
  [journey loop](#principles) concrete. A project is a theme the learner
  declares, so it is legitimate from day one.
- **Practice keeps its focus.** It is the one place where Typeform-style
  focus, one thing at a time, is the reference.

### From browsing to study

Post-its and trinkets are ambient. **Serious study happens in a session.**
The bridge between them is **gathering**: while browsing, the learner pockets
a few pieces into a small pile on screen. The pile seeds today's session or
jumps the queue, like Spotify's "Up next". Gathering is an explicit learner
signal, and [priority comes from everything the learner does](MODEL.md#principles).
It is a gesture, not a second queue to manage.

### Who shapes the page

The ideal is that **we craft the frame and the learner makes the surface.**
Learners arrange their own desk of content, practices and toys, inside a frame
that stays coherent, moving the product toward a platform. While the dynamics
are still being discovered, we control both the frame and the surface,
partly so support stays tractable. The platform direction informs decisions
but isn't a current goal.

### Phone

Phone and desktop may differ in layout and use patterns, but the feel,
philosophy and rules are shared. The phone is likely a **street of
shopfronts**: the landmarks, with the scrapbook as one more shop, and no
bulletins on the landing page. The phone is also a test of the town: if Home
only makes sense with everything visible at once, it leans on screen size
rather than structure.

## Principles

These are ordered by how often they decide something.

1. **Home shows the growth edge, framed by memory. It is not a ribbon
   board.** [Production is the product](MODEL.md#principles), but that
   describes what the learner *does*, not what Home *displays*. Showing a
   sentence the learner said well feels bland or condescending. Corrections
   and points still in progress belong on Home, but each one leads with the
   moment it came from, not with the error.
2. **The memory is what makes it ours.** A post-it is better than a
   lock-screen widget only if its tie to the past is real. A word saved with
   no context has no moment to lead with. So the surface policy prefers
   pieces with rich context, and capture can invite a line of context without
   nagging. Bare pieces can be anchored to the learner's interests or given
   a synthetic scene, but **synthetic context must say so.** "A scene for
   you" is fine; an invented "that night you…" is not. This is the same
   truthfulness rule as for [pictures](MEDIA.md).
3. **Ambient isn't study.** Seeing a post-it counts as no evidence and never
   becomes a schedule ([MODEL principles 2 and 4](MODEL.md#principles)).
   Study happens in sessions.
4. **Themes emerge or are declared; they are never forced.** A single rich
   item, such as a long article, is its own theme. Grouping by meaning starts
   only once enough material has built up across separate sources. Until
   then, one cluster per item is honest and fine. A project is a theme
   declared by the learner.
5. **Points are a means.** The aim is intuition. A point's life ends in
   *absorbed*, not *mastered*. Its growth arc is what Home shows; it is never
   celebrated as recall.
6. **Three loops.** Each loop has a home in the town:
   - *companion*: seconds of help or capture, through the capture bar and the
     tutor;
   - *gym*: daily, broad, interleaved practice, through the practice
     landmark;
   - *journey*: projects, rabbit holes and the collection.
7. **Voices.** A learner surface speaks in a companion voice (the tutor, warm
   and in the moment) or an instrument voice (orientation, such as how much is
   left). The workshop voice (machinery, queues, pipelines) belongs only in
   operator views such as Model activity.
   - **One tutor.** It is a companion with a long-running shared context, shown
     as a side sheet. Asking about a piece uses a picker mode, not controls on
     every piece. When the tutor leaves its own pieces on the board is a
     deferred policy.
   - **The conversation partner is a separate character, inside the bubble
     with the learner.** It is mostly unaware that it is part of a learning
     system.
8. **Words are promises; hide the mechanics.** A label must be true about what
   happens. Always show how much is left and how to leave. Design the bad day:
   decide what a screen feels like after a miss, after a week away, and when
   the tutor is wrong.
9. **Controls appear on selection.** Hover is only a desktop accelerator, so a
   tap can stand in for it.

**References.** The mood is a scrapbook that feels alive and is made with
craft. Inspirations:
- software.inc, for being intriguing even when it's confusing;
- MySpace, for the person showing through the page;
- Typeform, for the practice session only.

The anti-model is the AWS console, where machinery is exposed as UI.

**How we work.** Design is product philosophy: it decides what to build next.
Language can run ahead of what the app can do, but affordances must match it.
Sketches of the north star are tagged as exists, cheap, or far.

## Where the build is (observed Nov 24, 2026)

Observed on the fixture and on a copy of Justin's dogfooded journal.

**Works:**
- **Home reads as a scrapbook.** Paper cards, the tutor's quiet 师 mark,
  credited picture clippings, Loose ends, one capture bar, and a today card
  with one next step. The today card is the seed of a landmark offer.
- **Read is the best room.** It is full-bleed paper with a small way back and
  a tucked-away tutor.
- **The practice card** opens with a scene in large type and shows how much is
  left. Its end screen offers *Keep going* or *Back home*.
- **Conversation produces real language.** The learner's turns are long, in
  Chinese, and about things they care about.

**Gaps against the vision:**
- **There is no town yet.** Home is the collection layer only: no
  landmarks besides the today card, and no "what's alive" layer.
- **Pieces lead with the error or the gloss, not the moment.** Conversation
  clusters are made of corrected fragments. The learner's own context for a
  saved word sits in small italics under a dictionary gloss.
- **Nothing shows its growth arc.** The [record](MODEL.md#vocabulary) knows
  whether a word is taught, settling, used or missed, but no piece shows it.
- **Busy items become towers.** A reading's margin notes stack in one column,
  about 16 in the dogfooded journal; many came from an earlier, simpler
  reader. The layout has no rule for what surfaces once there are many.
- **Two houses.** Practice and Conversation still use the old page chrome:
  a masthead, a large H1, and `<select>` controls ("Session: Daily mix",
  "Topic"). They haven't had design attention yet. "Daily mix" names a
  mode, though modes are [dropped](MODEL.md#what-the-hosted-app-contributes)
  as a learner-facing concept.
- **The tutor sheet reads like a receipt.** It is one transcript across every
  surface, with teaching and system lines mixed. "I'll also bring X into
  practice" is the workshop voice; the evidence should be the word turning up
  in practice.
- **The phone layout is broken.** Clusters run off the edge, the today card
  is cut off, and the capture bar covers content.

## Open questions

These are ordered roughly by how much depends on them. **Focus now (Nov 24):**
questions 1, 4 and 5, the desktop's urban plan with its landmarks and
projects. The others are deferred until the interactive base is solid.

1. **The desktop composition.** Is desktop Home a town square with the
   collection laid out around the landmarks, or is the scrapbook one more
   shopfront, as on the phone?
2. **What's alive.** How are post-its chosen, and how many? Do they cycle,
   and how fast? What does tapping one do: open its memory, open its room,
   or start a quick rep?
3. *(Deferred.)* **How a piece shows its growth arc.** What does a trace look like (taught,
   settling, used unprompted) without turning into a progress bar?
4. **Landmark offers.** Which offer does each landmark carry, and who chooses
   it? When does a special appear?
5. **Projects.** What do a project's landing and its first three days look
   like? How does the tutor plan the journey, and how does it feed practice?
6. *(Deferred.)* **Gathering.** What is the gesture? How does the pile look, and how does a
   session use it?
7. **Context.** How does capture invite context without nagging? When does a
   bare piece get an interest anchor or a labeled synthetic scene?
8. *(Deferred.)* **A busy item on Home.** For a conversation or a reading with many
   notes, what surfaces and what folds into its room?
9. *(Deferred.)* **Partner and tutor on one screen.** How does Conversation show that the
   partner is a separate character inside the bubble?
10. *(Deferred.)* **The tutor sheet.** Should it be one continuous transcript, or the
    current room's thread with the rest one step away? Where do system
    confirmations go, if anywhere?
11. *(Deferred.)* **The tutor's language.** When does it write in Chinese, when in English,
    and should the learner set it?

## Prototype-stage tradeoffs

These describe the prototype now, not lasting rules.

- **Old content is fixed going forward, not backfilled.** Interactive content
  goes stale naturally, and learners keep going forward. When keeping
  historical data up to date would block an otherwise clear solution,
  accepting stale data is usually the right trade.
- **We control both the frame and the surface** while the product's dynamics
  are still being found ([Who shapes the page](#who-shapes-the-page)).

## Feedback awaiting the rewrite

- *(Nov 24)* **Justin narrows the focus.**
  - **Build the interactive base first.** Focus on the desktop's urban plan
    and its landmarks, the most stable parts of the app. Elevate projects to
    a landmark. In this early stage, **nothing goes on Home that doesn't lead
    somewhere**, except perhaps one small decorative touch. A dangling
    feature without an interactive story around it is clutter. Incremental
    building risks a local optimum, but the vision is solid enough that
    foundational work pays off.
  - **Deferred:** what's alive, the growth arc, gathering, the busy item,
    partner and tutor on screen, the tutor sheet, and the tutor's language.
    These are valuable in a mature app; built too early, they dangle. The
    deferred refinements can limp along as they are.
  - **Busy items (an idea to keep).** Never show a busy item's contents on
    the landing page by default. Instead, its styling shows that a lot is
    attached, which invites interaction. Interacting gives a peek, a partial
    expansion. Clicking blows it out fully into the item's room.
  - **Projects may become what chat is.** A conversation by itself is not
    exciting (there are endless chatbots); what it's about is. Many
    conversations are projects without a deliverable: shared understanding
    built by talking. Idle chat stays as a fallback, perhaps as a degenerate
    project. It doesn't need perfect modeling, since people use this as a
    means to study. Projects mostly failed in general chat apps because
    people's threads are random. Here, every thread shares one goal,
    getting better at the language, so projects may feel natural, much as
    coding tools put the project in front of the chat.
  - The phone follows: a small set of components that deliver interactive
    value.
- *(Nov 24)* **Claude's response.**
  - *"Nothing on Home that doesn't lead somewhere" is the V1 rule.* It is
    "affordances must match capability" applied to the landing page.
  - *Who runs a project?* The partner is in the bubble and unaware of the
    learning system; a project is a learning journey the tutor plans. One
    resolution: the tutor owns the project's arc (plan, debrief, practice),
    and the partner plays its scenes (an investor hearing the pitch, a
    friend at the climbing gym). Open chat is a project with no arc, just
    the partner.
  - *Projects failed elsewhere partly because of creation cost:* a blank
    "new project" asks the learner to organize up front. Here a project can
    also be proposed from behavior. After a second conversation about
    climbing, the tutor offers to make it a project. That mirrors themes:
    projects are declared or emerge.
  - *Open for the urban plan:* on desktop V1, does today's scrapbook table
    stay behind the landmarks, or recede into a shopfront? It is the one
    current surface whose pieces don't all lead somewhere.
- *(Nov 25)* **Justin on projects and the urban plan.**
  - **The tutor owns the arc and the partner plays the scenes,** tentatively.
    Many of Justin's project ideas were direct tutoring, so the tutor would
    have a foot in both worlds. The risk is tone: one voice as both teacher
    and immersive guide. It may need building to find out.
  - **A daily episode?** Entering a project could open a short episode the
    tutor has framed. That might be content or slides to interact with (an
    interactive presentation) with room for open chat, always ending with
    space for free production. This adds structure, which is the app's
    standing tension: when do we want structure, and when not?
  - **Projects can emerge.** A **root chat** bootstraps them: a
    get-to-know-you conversation ("you learn here by being yourself; tell me
    what you're into, why Chinese, what you'd talk about"). It stays free
    and long-running. Suggested projects come out of it, periodically or
    right away. This also answers onboarding: one clear opening that leads
    to individual paths.
  - **The scrapbook shrinks into a shopfront** on desktop V1. Later, as the
    town matures, smarter features can surface scrapbook highlights on the
    main canvas.
- *(Nov 25)* **Claude's response.**
  - *The character split can be the structure split.* Structure lives in the
    tutor's voice (framing, beats, debrief); openness lives in the partner's
    (scenes, the root chat). The learner can tell which mode they're in by who
    is speaking. The tone risk then becomes a rule: the tutor never plays a
    scene, and the partner never teaches.
  - *An episode is structure offered, not required.* It has a shape (frame →
    scene → free production), but the learner can skip the frame or stay in
    the scene. Free production is always the last beat.
  - *Prototype cheaply.* The episode's frame can reuse the existing
    lesson-card beats. Risk: daily episodes turn into a course, with an
    obligation and a content-quality burden. Start with episodes the learner
    opens, not a daily schedule.
  - *The root chat fits the partner.* It is a curious friend getting to know
    the learner, which is naturally inside the bubble. Project suggestions
    come from the tutor, outside it.
  - *Count the landmarks.* Practice, Read, the root chat, projects and the
    Scrapbook shopfront make five, plus the capture bar. That is more than
    "a few and one special". Should projects sit inside the root chat's
    landmark at first?


## Decision log

| Date | Decision | Where it came from |
| --- | --- | --- |
| 2026-11-22 | Scrapbook direction, three loops, points as means | Design consultation (Steward inbox, Nov 22) |
| 2026-11-23 | Controls appear on selection; tutor as a side sheet; picker mode | Consultation follow-up |
| 2026-11-23 | Media: per-case ceilings under a demote-only composition policy | [MEDIA.md](MEDIA.md) |
| 2026-11-23 | Desktop proves the model first; phone soon; shared philosophy | Consultation follow-up |
| 2026-11-24 | The conversation partner is a separate character inside the bubble, mostly unaware of the learning system | Justin, review of this document |
| 2026-11-24 | Home is a town: landmarks with today's offer, a few post-its of what's alive, a browsable collection | Justin, design conversation |
| 2026-11-24 | No ribbon board: Home shows the growth edge, each piece leading with its memory | Justin, design conversation |
| 2026-11-24 | Themes emerge or are declared (projects), never forced | Justin, design conversation |
| 2026-11-24 | Post-its are ambient and count as no evidence; study happens in sessions; gathering bridges the two | Justin, design conversation |
| 2026-11-24 | Projects are a new room type | Justin, design conversation |
| 2026-11-24 | Aim for "we craft the frame, the learner makes the surface", later; we control both for now | Justin, design conversation |
| 2026-11-24 | Typeform is a reference for the practice session only | Justin, design conversation |
| 2026-11-24 | Focus: the desktop urban plan, landmarks and projects. Defer what's alive, the growth arc, gathering, the busy item and the tutor refinements | Justin, design conversation |
| 2026-11-24 | V1 Home holds nothing that doesn't lead somewhere, except perhaps one decorative touch | Justin, design conversation |
| 2026-11-25 | Projects can emerge; a long-running get-to-know-you root chat bootstraps them and is the onboarding | Justin, design conversation |
| 2026-11-25 | Desktop V1: the scrapbook shrinks into a shopfront; highlights on the main canvas come later | Justin, design conversation |
| 2026-11-25 | Tentative: the tutor owns a project's arc and the partner plays its scenes | Justin, design conversation |
