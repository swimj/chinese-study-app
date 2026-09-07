# SWI-43 UI experience interview

status: active
type: research
created: 2026-09-01
retire-when: interview notes are captured and later synthesized into SWI-43 / the 2026-08-23 brief (or the item is dispositioned)
related:
  - notes/active/2026-08-23-swi-43-beta-interaction-brief.md
  - SPECS/frontend-architecture-map.md
  - STABILITY_FRONTIER.md
  - https://linear.app/swimj/issue/SWI-43/audit-the-desktop-core-loop-and-define-the-first-beta-ux-slice
  - https://linear.app/swimj/issue/SWI-54/make-active-session-actions-and-keyboard-behavior-coherent

## Why this note exists

Time has passed since the 2026-08-23 beta-interaction brief. That brief was an
audit-and-dispatch packet. This note is a capture vessel for a user-driven
interview: the product owner speaking as a learner using the app, not as an
architect. The aim is to extract candidate items and principles from lived UX.

Do not merge this with the old brief yet. A 2026-09-07 synthesis of *this*
interview is below; the vision is still being baked.

The 2026-08-23 brief recorded an initial filter and a first slice; this
interview is lived UX. Principles are orientation, not a manifesto.

## Existing memory so far

Do not treat this section as the interview. Compact pointers only.

**SWI-43 brief** (`notes/active/2026-08-23-swi-43-beta-interaction-brief.md`,
PR [#166](https://github.com/swimj/chinese-study-app/pull/166), 2026-08-23/27):
desktop beta should keep the current broad page model and improve interaction
grammar rather than replace IA or the learning model. Initial emotional-core
filter: a serious, calm learning workshop. First recommended slice was
active-session action + keyboard coherence. Later slices named there (home
orientation, drain/completion/reflection status, Priority keyboard, learner vs
operator surfaces) were not the first slice.

**Already landed — keyboard / session-action grammar (SWI-54), not open:**

- PR [#167](https://github.com/swimj/chinese-study-app/pull/167) /
  `1364c7b` (2026-08-27): shared `session-keyboard.ts` contract; advertised `U`
  (silent `Z`); production Enter; contrast `1`/`2` then Enter; shortcut on the
  primary control; dialog focus trap; `Still missed` / `Recalled it` labels;
  typed vs No-clue on correction.
- Follow-ups: `f9ffe24` (Enter submit + hide hints until hover/focus),
  `8b81532` (`?` opens the guide on every active card),
  PR [#170](https://github.com/swimj/chinese-study-app/pull/170) overlay key
  capture, `2df35aa` literal `?` in session inputs.

Linear was not queried this session (MCP needed auth). Issue URLs above are
from the old brief; live status unknown here.

---

## Synthesis 2026-09-07 — current SWI-43 interview orientation

Still baking. Not a manifesto. Not merged with the 2026-08-23 brief.
SWI-43 stays an umbrella. They want concrete work so dogfood intuition
can get tangible feedback. A structured work plan is optional and should
not be stressed.

### Orientation (still baking)

The app should feel like a serious, obvious study loop for someone who
just wants to learn a language — not a workshop for operating a
scheduler. What stays on screen has to earn its keep for that person.
Extra capability is welcome when it matches a jump the learner already
wanted (agility), not when it exposes operator control. How-to-use-the-app
copy should disappear; pedagogical content at reveal (this sense, why
this word fits) is a different category and is currently under-invested.
Reveal should funnel attention — bigger, harder to skip — not sprinkle a
tiny supplement beside a space-to-next habit. Theme is a standard
light/dark/system choice. Keyboard shortcuts already showed that
accelerating the core without tutorializing it is the good pattern.
SWI-43 stays an umbrella; pick off small slices for dogfood signal
rather than finishing the vision first.

### Agreed principle (their acceptance, 2026-09-07)

Operator chrome (knobs, how-to-operate copy, leftover surfaces) vs
learner agility (keep up with associative jumps). First session should
feel like a serious but obvious study loop; extra surface earns its way
by serving a jump the learner already wanted. Keyboard shortcuts = good
pattern. 1-vs-2 note and leftover gloss list = bad pattern. The split
resonated; do not push deeper; do not freeze a growth manifesto.

### Already landed (not an open issue)

Session keyboard / action grammar (SWI-54).

### Parked ideals

- Explanatory / app-chrome: contrast (and similar) should be a quiz —
  task prompt + choosable answers — not a how-to-select 1 vs 2 note.
  Pedagogical copy is a different category.
- Theme: light / dark / follow system. "Too dark" addressed-enough by
  that pattern.

### Candidate pick-off issues (not dispatched)

Not a work plan. Light suggestion only: they asked for tangible
study-loop feedback, so (2), (3), or (4) will teach more than (1); (1)
is still a valid easy win.

1. **Theme: light / dark / follow system.** Outcome: pick permanent
   light, permanent dark, or follow system. Why dogfood: easiest visual
   slice; weaker signal on the study-loop emotional core.
2. **Contrast (and similar) chrome.** Outcome: quiz-shaped task line +
   choosable answers; remove how-to-select 1 vs 2 copy. Why dogfood:
   direct application of the chrome principle; fast. Not entangled with
   content.
3. **Production content-supplement attention.** Outcome: make the example
   hard to miss — bigger first; pause/color optional later. Why dogfood:
   high per-card signal. Presentation, not content.
4. **Cloze reveal.** Outcome: replace fallback gloss list with brief
   sense-on-correct and why-this-fits-on-wrong. Why dogfood: high
   signal. May be entangled with missing pedagogical content (near-term
   copy/stub vs full agential feedback later). Full answer-reveal rethink
   is not a pick-off.

Optional tiny 5th: sweep remaining app-behavior tutorial copy after (2).
Do not turn "audit every displayed thing" or "learner agility trajectory"
into a first issue.

---

## Interview capture

Speaker: learner/user, not architect. Fill during the conversation. Do not
invent.

### Dump 2026-09-01 — first pass (quick hitters)

Enough for now; interviewer will push on one thing at a time.

### Dump 2026-09-01 — answer reveal walkthrough

No screenshot: they are migrating the dogfood app to Fly hosting.

1. **Content supplement on production.** They added a content supplement so a
   good-quality definition-based cue can be further reinforced with a real
   example. In practice they often skip it on accident. The example is really
   small. The flow does not funnel their focus to consider the supplement. The
   content itself is good; the presentation is not.
2. **Cloze answer reveal still shows the fallback gloss-based list.** Feels
   discordant and often not helpful. Cue repair helped ~80% of the way (the
   exercise part is now stripped down) but answer reveal was not invested in.
   They frame this as a known gap.

### Dump 2026-09-01 — what would have made them look at the supplement

On skipping the production content-supplement example by accident — what
would have made them look instead of advancing:

- Bigger
- Maybe a pause that doesn't let them auto-click space
- At least bigger
- Maybe color indicators would help "cue" their brain to pause

Not a design. Attention-funnel seeds in their language: size, space-advance,
color cue.

### Dump 2026-09-04 — cloze answer reveal (interview resumed)

Correct response: some very brief acknowledgment; could simply state the
particular sense active in this scenario.

Wrong: currently no in-line agential feedback (they are mulling that). Near
term: simply stating why the target answer is the intended fit seems
strictly better than the gloss list that was deemed in need of repair.

### Dump 2026-09-04 — what "explanatory text" means

Clarifying the first-pass complaint that pretty much all the explanatory
text feels bad:

- Explanatory text means copy about the *app behavior itself* (example:
  "click this button to start session")
- It does NOT mean pedagogical content (so the one-line "this sense" on
  cloze reveal is a different category)

Also answers the last check: the brief sense-line is not the bad
explanatory text.

### Dump 2026-09-04 — worst app-chrome sentence

The text added around selecting 1 vs 2 in contrast selection exercises.

Comparison: when Cursor gives a multiple-choice question in plan mode, it
does not pop up a big explanatory note on how to interact with the quiz —
they just figured it out.

### Dump 2026-09-04 — would 1 vs 2 be obvious without the note?

Could not answer: they built it, so not informative for designing for other
users.

Suggestion: compare similar interfaces in other major apps. Their feel:
explanatory text is not common; question is how those apps get by.

(Request/feeling only — not a competitive analysis.)

### Dump 2026-09-04 — park explanatory-text / contrast 1-vs-2

Don't push further on this thread. We know the ideal behavior; write it
down; a later task can worry about how to converge the app to that
behavior. Parked / settled-enough.

### Ideal behavior — app-chrome / contrast selection (parked)

Principle: Bad "explanatory text" is app-behavior chrome (how to operate
the UI), not pedagogical content. Interaction should be self-evident like
a quiz: a task line ("which of these?") plus options that look like
answers, with numbers on the choices — not a how-to-operate note.

Item: Contrast (and similar) selection is a task prompt plus choosable
answers, without the how-to-select 1 vs 2 copy. Named offender is that
copy. Converge later; do not keep interviewing this.

### Dump 2026-09-07 — interview resumed

Theme / palette: settling, similar to the parked chrome thread. The theme
should just have light/dark that lets the user pick permanent light,
permanent dark, or follow system — as is standard in many apps today.
Park the "too dark" complaint as addressed-enough by this pattern. Do not
design tokens here.

Simple-core vs power-user: they want thoughts flowing, not a precise
nail-down. This is as much bigger-picture product/growth strategy as core
product design. They invited a take. Interviewer's take is not captured
here as their words.

Operator-power vs learner-agility split resonated (2026-09-07). Do not
push deeper. They want concrete work so dogfood intuition can get
tangible feedback. See synthesis above.

### Ideal behavior — theme / palette (parked)

Principle: The theme should just have light/dark that lets the user pick
permanent light, permanent dark, or follow system — as is standard in
many apps today.

Item: Offer that standard light / dark / follow-system choice. The "too
dark" complaint is addressed-enough by this pattern. Converge later; do
not keep interviewing this.

### Open for discussion — simple core vs power-user

User invited a take (2026-09-07). Thoughts flowing, not a precise
nail-down. As much bigger-picture product/growth strategy as core product
design. The operator-chrome vs learner-agility split resonated; do not
push deeper. They want concrete pick-off work for dogfood signal.

(Interviewer take goes in conversation, not here as if it were theirs.
Agreed principle is in the 2026-09-07 synthesis, in their acceptance
language.)

### What feels good

- First pass: nothing named.
- Answer-reveal pass: the production content-supplement *content* is good.
  Cue repair made the cloze *exercise* stripped down (~80% of the way).

### What feels bad / confusing

- Pretty much all the explanatory text feels bad — meaning copy about the
  *app behavior itself* (e.g. "click this button to start session"), not
  pedagogical content. The brief cloze "this sense" line is a different
  category and is not that complaint. Worst sentence named: the text added
  around selecting 1 vs 2 in contrast selection. Cursor plan-mode multiple
  choice does not pop up a big how-to-interact note; they just figured it
  out.
- The color scheme actually feels too dark. Parked 2026-09-07: addressed-enough
  by standard light / dark / follow-system; see ideal behavior above.
- Production content-supplement presentation: example really small; flow does
  not funnel focus; easy to skip on accident.
- After a cloze, answer reveal still presenting the fallback gloss-based list
  feels discordant and often not helpful.

### Complaints / friction

- The "answer reveal" experience / logic / flow entirely needs to be thought
  through. Mix of UI, content, and architecture problems.
- Pretty much every displayed thing needs to be evaluated as: is this valuable
  to a user that just wants to study a language.
- A lot of "power user" adjacent behavior right now. Partly from
  customizability and user control, but the balance is wrong.
- Content supplement: good reinforcement idea, presentation does not match.
  They skip it because nothing makes them look; they say bigger (at least),
  maybe a pause that blocks auto space-advance, maybe color to cue a pause.
- Cloze answer reveal: known gap — cue repair invested in the exercise, not
  the reveal. Correct: brief acknowledgment, maybe just the sense active in
  this scenario. Wrong: no in-line agential feedback yet (mulling); near
  term, stating why the target is the intended fit seems strictly better
  than the gloss list.

### Candidate principles

Seeds only — do not treat as extracted principles yet.

- Wanted shape (their words): a very simple core, then flexibility to become
  extensible following a pure learner's intuition. The human brain makes many
  associative jumps while learning; the app should match that speed and
  agility whenever possible. Cannot get there all at once; asymptotic
  trajectory.
- Content-supplement attention funnel (their words, not a solution): bigger;
  maybe a pause that doesn't let them auto-click space; maybe color
  indicators to "cue" the brain to pause.
- App-chrome vs pedagogy, and quiz-like contrast interaction: see
  **Ideal behavior — app-chrome / contrast selection (parked)** above.
  Settled-enough; do not keep interviewing this.
- Theme / palette: see **Ideal behavior — theme / palette (parked)** above.
  Settled-enough; do not keep interviewing this.
- Operator chrome vs learner agility: resonated 2026-09-07; see synthesis.
  Do not push deeper; do not freeze a growth manifesto.

### Candidate items under the SWI-43 umbrella

Pick-off candidates (not dispatched) are in the 2026-09-07 synthesis.
Named problem areas in their language so far:

- answer-reveal experience / logic / flow
- content-supplement presentation (production): size / space-advance /
  color cue as attention funnel — capture only, not a spec
- cloze answer reveal still showing the fallback gloss-based list
  (known gap after cue repair). Lived preference, not a spec: brief
  sense-in-this-scenario on correct; on wrong, stating why the target
  fits beats the gloss list (in-line agential feedback still being mulled)
- Contrast (and similar) selection without how-to-operate chrome — parked;
  see ideal behavior above. Later task to converge.
- Theme: standard light / dark / follow-system — parked; see ideal
  behavior above. Later task to converge.

