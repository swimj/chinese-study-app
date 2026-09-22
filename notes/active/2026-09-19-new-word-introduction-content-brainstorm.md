# New-word introduction: content-first brainstorm

status: active
type: research
created: 2026-09-19
retire-when: graduated into a spec/plan, or declined as a direction
related:
  - SPECS/session-covering-criteria.md
  - SPECS/learning-review-model.md
  - SPECS/study-action-model.md
  - SPECS/session-reflection-generation.md
  - SPECS/adaptive_vocabulary_training_product_notes.md
  - notes/active/2026-08-07-reflection-remediation-policy-working-notes.md
  - notes/active/2026-08-04-cue-first-class-brainstorm.md
  - notes/active/2026-09-18-pure-cue-elicitation-memo.md

This is a content-experience brainstorm, not an implementation contract.
Canonical specs and the stability frontier still describe current behavior.
Technical design (generation timing, persistence, session actions, reflection
wiring) is deliberately deferred until the teaching experience is agreed.

---

## 1. Problem (restated)

The app currently inverts pedagogical support:

1. **First encounter** is a thin reference dump (hanzi, pinyin, meanings, one
   example string) plus form↔meaning recall drills.
2. **Later review** is when the useful material arrives — usage frames, natural
   examples, circumstance cues, contrast — but only after a **review-status
   production** failure triggers reflection.

That late enrichment is the right timing for **similar-word production
mistakes**: you often cannot know which distinction matters until the learner
confuses two items.

It is the wrong timing for **bare definitions decoupled from real usage**.
Those are not learner-evidence problems. They are missing teaching content that
happens to live behind a review-production evidence gate.

New words are when learners stand to benefit most from richer explanation.
Much of the core content the product already knows how to author (sense,
situation, example, construction) is word-centric, not mistake-centric — it
just has nowhere to live at introduction.

---

## 2. Working split: teach vs test

Keep two jobs separate. Do not solve them with one tool.

| Job | Question | Timing | Failure mode if confused |
| --- | --- | --- | --- |
| **Introduction / teaching** | What would a teacher say *before* asking you to produce this word? | First encounter (and reusable later as reference) | Learner encodes a dictionary string with no use-feel |
| **Elicitation / testing** | What compact prompt fairly asks for this word later? | After the word has a foothold; refining over time | Encyclopedic English on the production cue; trains cue-solving |

Compact glosses as *cues* remain a good idea. Encyclopedic English on the
production prompt remains the wrong instinct. Teaching content can be rich;
the later test cue should stay lean.

A third job stays separate still:

| Job | Question | Timing |
| --- | --- | --- |
| **Confusion remediation** | Given this miss, what distinction or cue repair helps? | After learner evidence (reflection, similar-word path) |

Do **not** use confusion remediation as the only path to get usage material
onto a word. Do **not** use introduction teaching as a substitute for
learner-triggered contrast when two known words collide.

---

## 3. What a teacher does when introducing a word

Imagine a good tutor introducing one intermediate Mandarin word in a few
minutes. They do not start with "memorize this gloss, then produce it 3×3."
They roughly do this:

### Beat A — Orient the form

Show the word as an object in the world:

- hanzi (and traditional if relevant to this learner)
- pinyin / pronunciation cue
- a **short** sense label so the learner is not lost

This is scaffolding, not the lesson. The sense label is an anchor, not a
dictionary entry.

### Beat B — Situate the sense

Give **one high-value natural sense**, not encyclopedic coverage.

Teacher move: "In ordinary speech, this is the word you reach for when…"

Ingredients:

- a **circumstance / communicative purpose** the learner can imagine
- optionally a register or domain hint (casual, formal, written news, …)
- explicit non-goals for this beat: every sense, etymology, full HSK gloss dump

Policy already favored elsewhere: begin with one natural sense; later build a
small repertoire of ordinary collocations and circumstances
(`notes/active/2026-08-07-reflection-remediation-policy-working-notes.md`).

### Beat C — Show it living in language

Give at least one **complete, natural example** in the target language, with
translation, that exemplifies that sense.

Teacher move: say or display a sentence the learner could actually hear, then
briefly point at the slot the new word fills.

Ingredients that already exist as a content shape in the product (today as
post-reveal supplement on review production):

- English usage frame (the "when you want to say…" slot)
- full example sentence
- example translation

At introduction, the same *kind* of material should be **shown up front**, not
held back until after a later production miss.

Optional but high value when cheap:

- one **collocation / construction frame** (what it naturally pairs with)
- not a collocation *drill* yet — just showing the groove

### Beat D — Optional near-neighbor (only when already knowable)

Sometimes a teacher says: "Not the same as X — X is for …; this is for …"

Rules of thumb for introduction (stricter than reflection contrast):

- Prefer **no** contrast if the neighbor is not already known enough to be
  useful, or if the distinction is not the main point of first exposure.
- Prefer a **one-sentence** neighbor note over a full contrast exercise.
- Do not wait for a production mistake to mention an *obvious, already
  knowable* near-neighbor when that neighbor is the usual way learners
  mis-file the word from the gloss alone (e.g. two verbs that share an
  English gloss the dictionary already conflates).

Learner-triggered contrast clusters remain the right tool for *discovered*
interference. Introduction contrast is only for *predictable, cheap*
orientation.

### Beat E — Then ask for recall

Only after the above: ask the learner to recognize and produce.

Teacher move: "Okay — without looking, what does this mean? Now, given that
situation, what word would you say?"

The early drills can stay close to today's recognition / production shapes.
The change is what the learner has *seen* before those drills start, and
whether the production prompt is allowed to stay compact because the teaching
already carried the usage load.

---

## 4. Proposed first-encounter content experience (product sketch)

Replace "dictionary card → 3×3 drills" with a short **teach-then-test** arc.

```text
Phase 1 — Introduction (shown, not graded)
  form + short sense anchor
  one natural circumstance / usage frame
  one full example + translation
  optional: one construction/collocation hint
  optional: one-sentence near-neighbor note
  learner proceeds when ready

Phase 2 — First recall (graded, similar to today)
  recognition: form → meaning (self-rate)
  production: compact cue → typed form
  covering criteria can stay close to current unstudied rules for now
```

### What is shown vs what is tested

| Material | Intro (show) | Early production cue (test) | Later review |
| --- | --- | --- | --- |
| Short sense / gloss | yes (anchor) | often yes (compact) | may evolve via cue repair |
| Circumstance / frame | yes | usually no (or minimal) | may become a circumstance cue |
| Full example + translation | yes | no | may reappear as post-reveal supplement |
| Collocation hint | optional show | no drill yet | later skill if/when unlocked |
| Near-neighbor note | optional show | no | contrast if learner evidence warrants |
| Encyclopedic sense list | no | no | no (repertoire grows slowly) |

### What stays out of first encounter (for this brainstorm)

- Audio as a hard requirement (nice later; not the content thesis)
- Exhaustive senses / full dictionary dump
- Collocation or contrast as a *graded* exercise on day one
- Making the production prompt carry all teaching in longer English
- Treating introduction as a persisted `teaching` word state (still a
  non-goal in `learning-review-model.md`; this is an encounter *phase*, not a
  lifecycle status)

### Relationship to the maturation ladder

Vision (`adaptive_vocabulary_training_product_notes.md` §13–15) says: new word
≈ ordinary SRS; richer *drills* as the word matures.

Revised reading for this brainstorm:

- **Testing** can still mature: recognition → production → MCP → collocation →
  contrast.
- **Teaching** should not wait for that ladder. First exposure deserves
  situation + example even when the graded exercise is still basic recall.

Richer drills later remain valuable. They are not a substitute for a real
introduction.

---

## 5. Concrete teacher scripts (calibration sketches)

These are illustrative, not corpus content. They show the intended density.

### Example A — 措施 (measure / step)

- **Anchor:** "measures; steps taken (to deal with something)"
- **Circumstance:** when talking about actions a government, company, or
  person takes to handle a problem
- **Frame:** "take measures / adopt steps to …"
- **Example:** 政府采取了新的措施来减少污染。 / The government took new
  measures to reduce pollution.
- **Collocation hint:** often with 采取 / 出台
- **Near-neighbor (optional):** not the same as 方法 ("method/way" in general);
  措施 is more "steps taken in response"
- **Later production cue:** can stay compact — e.g. "measures; steps (taken)" —
  because the intro already carried the use-feel

### Example B — 撒谎 (to lie)

- **Anchor:** "to lie; to tell an untruth"
- **Circumstance:** accusing or admitting that someone said something false
- **Example:** 他明明在撒谎。 / He's clearly lying.
- **Near-neighbor:** if 说谎 is already known, one sentence that they are near-
  interchangeable for many everyday cues — do *not* invent a fake sharp
  distinction on day one; leave promotion/pure-cue work for later evidence
- Teaching here is use + example; similar-word *scheduling* is a different
  problem (`2026-09-18-pure-cue-elicitation-memo.md`)

### Example C — Thin gloss problem without a similar-word miss

Word enters with meaning "to take; to adopt" and one dictionary-ish example.
Learner can pass 3×3 recognition/production while still not knowing when a
native would actually say it.

Introduction should have supplied: circumstance ("adopt a policy / take a
measure"), frame (采取 + abstract noun), and a living sentence — without
waiting for the learner to fail a review production card months later.

---

## 6. Why reflection-as-wired cannot be the introduction path

Current reflection evidence is gated to **review-status production** failures
(plus optional learner-requested review on those cards). Learning/unstudied
actions are explicitly out of the initial evidence contract
(`SPECS/session-reflection-generation.md`).

That gate is appropriate for:

- over-broad cues revealed by a specific miss
- contrast clusters earned by interference evidence
- false-lapse / alternate-answer reconsideration

It is not appropriate as the primary author of:

- the first natural sense
- the first usage frame
- the first living example

Those should exist as **word-centric teaching content** available at first
encounter, whether or not anyone has failed a production card.

Existing content shapes that already rhyme with introduction needs (and can
inform a later design without committing one now):

- production cue types: `definition_gloss`, `minimal_context`, `circumstance`
- post-reveal supplement: `englishFrame` + `exampleSentence` +
  `exampleTranslation`

Introduction likely wants the *pedagogical payload* of supplements (and maybe
circumstance text) **before** testing, not only after a correct reveal on a
review card.

---

## 7. Open content questions (still experience-shaped)

Not technical blockers — product taste to settle before build talk:

1. **Minimum viable intro:** is circumstance + one example enough, or is a
   construction/collocation hint part of the default template?
2. **Multi-sense words:** always one sense at introduction, with later senses
   as explicit expansions — confirm.
3. **Near-neighbor at intro:** default off, or default on when a known
   neighbor shares the English gloss?
4. **Re-show vs one-shot:** after the first session, is introduction content
   still available on demand (word detail / optional peek), or only at first
   encounter?
5. **Learning-state words:** today's learning path skips intro entirely —
   should returning learning words still get a short "remind me of the use"
   peek, or only unstudied first encounter?
6. **Diet vs stash provenance:** does teacher density differ for curated diet
   words vs learner-stashed words, or is the content template the same?

---

## 8. Explicitly deferred (technical)

Do **not** decide in this note:

- when/how introduction content is generated or authored
- whether it reuses cue/supplement tables vs a new word-owned teaching artifact
- session action kinds, covering changes, or scheduler admission
- whether introduction generation shares the reflection provider pipeline
- frontier movement relative to "no broad learning-model wave"
- persistence, authorization, or proposal review for intro drafts

Next step after this content sketch is agreed: step back and design how to
build it. Until then, treat this document as the teaching-experience target.

---

## 9. Summary claim

**Testing** can stay simple early. **Teaching** should not.

A teacher introducing a new word gives: short sense, situating circumstance,
living example, optional construction hint, optional cheap neighbor note —
then asks for recall. The app's first encounter should feel like that, rather
than like a dictionary row that only grows a soul after review-production
reflection.
