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

**Revision (2026-09-22):** §§3–4 describe an earlier teach-then-test sequence
that still opens on the word. §10 supersedes that sequence. The ingredients
(sense, situation, example, construction, neighbor) still matter; the entry
order, the learning-state role, and the content model do not.

**First slice (2026-09-23):** §10.3's staged enrichment is longer-term framing.
§11 is the deliverable to land first: one generated bundle, shown on day 1,
exercised as a cloze once the word is in learning. Not an adaptive teacher.
§13 names that generator pass **word bootstrap**. It shares primitives with
reflection and keeps a distinct top-level schema. §14 is the first prototype:
uses, examples, and collocations, motivated by word introduction. Confusion
candidates stay in the general word-content vision and out of that prototype.
Teaching content is a later workflow that reads bootstrap state. A per-learner
introduction pass is farther still.

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

1. **Minimum viable intro:** superseded in spirit by §10. The first beat is an
   unresolved situation plus its resolution. Which further slices ship on day
   one versus during learning is the remaining question (§10.4).
2. **Multi-sense words:** always one sense at introduction, with later senses
   as explicit expansions — confirm.
3. **Near-neighbor at intro:** default off, or default on when a known
   neighbor shares the English gloss?
4. **Re-show vs one-shot:** after the first session, is introduction content
   still available on demand (word detail / optional peek), or only at first
   encounter?
5. **Learning-state words:** in scope, not a peek. §10 treats learning as the
   staging window for further manifestations of the same base content. The
   open part is which slices wait until then.
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

§10 revises the *order* and the *scope*: open on a situation, resolve into the
word, and stage further enrichment across learning. Treat §9 as the problem
claim and §10 as the current experience direction.

---

## 10. Revision: one content, many manifestations; situation first

Captured 2026-09-22 from continued brainstorm. Still gathering; not a locked
experience spec. The ambition is intentional: design new and learning together
so the acquisition arc stays coherent, rather than shipping a richer intro card
that leaves learning as thinner gloss recall.

### 10.1 Content model claim

Think of this as a remodeling of content, not a new card type bolted onto
unstudied.

There is a **base content** for a word's introduction (and later, for further
enrichment of that word): situation, example, definition, explanation of the
context, and whatever further notes earn a place. That base is authored once.

The learner never sees "the base." They see a **manifestation**: a particular
slice, order, and job for that same material. The same situation can cold-open
a first encounter, reappear as the thing a learning-day card asks you to
recall, and later sit behind a compact review cue as a usage note. The same
example can be the unresolved Chinese sentence on day one and a post-reveal
illustration after the word is known.

Why this framing matters:

- Intro gloss, production cue, and review supplement stop being three drifting
  writeups of the same idea.
- Reflection stays a way to **add or repair** base content (especially from
  discovered confusions). It stops being the only door through which usage
  content is allowed to exist.
- New and learning are different manifestations and different moments in an
  arc, not different content systems.

Review elicitation can stay lean. The richness lives in the base and in which
manifestation the moment calls for.

### 10.2 Situation-first cold open

Do not start the word as a word.

Start it as a **situation**, dropped in unresolved. Two obvious manifestations
of that opening, drawn from the same base:

| Cold open | What the learner meets first | What it asks of them |
| --- | --- | --- |
| **English scenario** | A communicative situation in English, with no hanzi title and no gloss | Imagine the need. Predict what kind of word would fill it. |
| **Chinese example** | A full example sentence in Chinese, not a labeled headword | Meet language in use. Notice the unknown piece inside a real sentence. |

Slightly disruptive on purpose. The unresolved drop is meant to wake prediction
and attention before the label arrives. A dictionary card lets the learner
passively store a string. A cold situation gives them a question.

Then **resolve** the situation:

- name the word (hanzi, pinyin)
- give the definition and/or an explanation of *why this context uses this word*
- the explanation is about the situation just seen, not an encyclopedic entry

Only after that resolution does **further initial enrichment** show up, and
only as appropriate: construction/collocation groove, a second angle on the
same sense, a cheap near-neighbor note. Not a dump of every available note.

```text
Cold open (ungraded, unresolved)
  English scenario  and/or  Chinese example sentence
        |
        v
Resolve (ungraded)
  the word, in this context
  definition and/or explanation of why this situation uses it
        |
        v
Further enrichment (staged; see §10.3)
  only what helps this sense land
        |
        v
Recall manifestations
  recognition / production against a compact cue
  the situation remains available as the meaning of the cue
```

The earlier beats in §3 are still the raw ingredients. The sequence change is
the point: form and definition are the **answer** to the situation, not the
title of the card.

### 10.3 Stage enrichment across learning (longer-term framing)

This subsection is the ambition that keeps the arc coherent. It is **not** the
first deliverable. See §11. The first slice should not grow a curriculum of
enrichment beats.

New and learning should eventually be redesigned together.

Today, learning skips introduction and repeats thinner recall. Under this
direction, learning is where the **rest of the base content is allowed to
arrive**, and where manifestations shift from "show" toward "use."

Possible shape (illustrative, not a schedule):

| Moment | Manifestation | Job |
| --- | --- | --- |
| First unstudied encounter | Cold situation → resolve into the word | Get a live question, then the answer |
| Same session, after resolve | Compact recognition / production | Bind form to the situation just explained |
| Later learning sessions | A further slice: construction, second example, neighbor note, or a re-shown situation used as the prompt | Enrich without repeating the whole lesson |
| Learning recall | Production or recognition whose prompt is a manifestation of known base content | Test against something the learner has actually been shown |
| Review | Lean elicitation cue | Protect the trace; reflection repairs or extends the base when evidence says so |

Not every enrichment beat belongs on the first card. Some of it can wait until
a learning session, when the form is no longer brand new and a collocation or
neighbor note has something to attach to. Staging is a teaching choice: attention
on day one stays on one situation and its resolution.

Learning therefore changes job, not only density. It is the acquisition window
for manifestations of the same content, not a second copy of unstudied drills
with the intro removed.

### 10.4 Settled enough to stop blocking, and what stays open

**Do not design learner-vocabulary matching.** Sentence readability against the
learner's known lexicon is out of scope. Recognition of surrounding words is
not the problem to solve here, and it is a large product of its own. Trust the
generator to scale sentence complexity to the target word. If a later nudge is
needed, the cheap version is a learner "too hard / too easy" signal that
becomes a coarse level hint on the next generation — not a known-vocab filter.

Still open, and not required to name the first slice:

- Which cold open leads (English scenario, Chinese sentence, or both in one
  encounter).
- Whether "situation" stays a presentation of word-owned content. Do not
  collapse this into the pure-cue elicitation memo: that memo is about
  judgment when one cue cannot pick a single word. This note is about how
  introduction content is entered and revealed.

### 10.5 Coherence over a thin first slice

The intended product is the whole arc: situation-first entry, resolution,
staged enrichment through learning, lean review cues drawn from the same base,
reflection as repair and extension.

A first implementation can still be smaller. It should be a slice of this arc,
not a different product (for example, a longer dictionary intro that still
opens on the headword and still leaves learning untouched). Prefer a clear
vision of the manifestations over a sequence of locally coherent cards that
never share a content model.

§11 names that slice. It lands the content model and a generator, and one
bridge from shown content to an exercise. It does not land the staged teacher.

---

## 11. First deliverable: bundle, show, then cloze

Captured 2026-09-23. The goal of this slice is modest and specific: make the
initial word experience less bad, especially for new users, whose sessions are
currently only new words. Changing what else a new user studies is a separate
topic and out of scope.

This slice should feel like enriched content plus one exercise that reuses it.
It should not feel like a dynamic adaptive teacher.

### 11.1 What gets generated once

For each word about to be introduced, a generation agent writes one bundle:

- an English situation
- a resolution: short definition, plus an explanation of why this situation
  uses this word
- **N Chinese example sentences** that contain the target word and can be shown
  intact or with that word blanked

No second authoring pass for the exercise. The cloze is a manifestation of a
sentence already in the bundle.

No known-vocabulary filter. Complexity tracks the target word. A later
"too hard / too easy" nudge may feed a coarse level hint back to this agent;
it is not part of landing the bundle.

### 11.2 Two manifestations

| When | What the learner gets | Graded? |
| --- | --- | --- |
| **Day 1 / first encounter** | Cold open on a **full** sentence (situation + resolution around it). Replaces the dictionary intro card. | No. Continue when ready. |
| **Learning days** | Same policy shape as today: the word is a session obligation until covered. Covering is **not** "Good in both directions." Covering is a small fixed set drawn from the bundle: **recognition**, plus **one cloze sampled from the N sentences**. | Yes. |

Day 1 shows the sentence whole. A later learning day blanks the target in one
of those sentences. That pair is the entire content↔exercise bridge for this
slice.

Learning does not gain a sequence of new enrichment beats. If the bundle has
nothing new to reveal, learning is still just that cover set.

### 11.3 What this replaces in the current new-word session

The painful bulk of a new-user session is the thin intro plus gloss-direction
drills (3×3 on first encounter, then both directions on learning days). This
slice treats that as the thing to retire for these words:

- first encounter becomes show-the-bundle, not show-a-gloss-and-drill-it
- learning cover becomes recognition + one sentence cloze, not forward and
  reverse gloss production

One choice still inside the slice, not a new track: whether day 1 is purely
the ungraded show, or the show plus a single recognition check before the word
counts as introduced. The cloze stays on a learning day either way. Do not
keep 3×3 gloss production as the price of meeting the word.

### 11.4 Explicitly not in this deliverable

- staged enrichment across learning (§10.3)
- an agent that chooses which pedagogical beat to run
- matching sentence vocabulary to the learner's known words
- the too-hard / too-easy level hint (cheap follow-up, not a prerequisite)
- changing new-user session mix to include other exercise types
- review-phase reflection, cue repair, or pure-cue promotion

### 11.5 Done when

A newly introduced word has a stored bundle. Its first encounter shows a full
sentence and a resolution instead of a bare gloss card. A later learning
appearance can ask for that word as a cloze inside one of the generated
sentences, and covering can succeed on recognition plus that cloze without
both gloss directions. The generator is not adapting the lesson mid-session.

---

## 12. Same judgment as reflection, without a mistake

Captured 2026-09-23, still bouncing. Not a revision of §11's slice; a claim about
what the generator is doing.

### Why the meaning list feels wrong

The corpus meaning list is the fallback production card: visible glosses, typed
hanzi. It is also what a new word is rote-memorized against for the learning
days. A common dogfood path is: remember that card through graduation, then on
the first review press **Ask reflection to review**, because the memory is fine
and the content is not. Graduation is being used as the door to a content
repair that did not need a mistake.

So the meaning list's value as the *thing you study* is in question. Its
remaining value is as *material the agent reads*: a sense inventory, not a
card. Reflection already treats the meaning-derived gloss as fallback content,
not as the durable claim about how the word should be elicited.

### What the generator shares with reflection

Reflection's first move is to look at the word and the served content and
judge what would be worth improving, before it interprets the attempt. An
explicit ask says: do that even when the answer was correct.

Initial generation is that same look, run once, when the word has not had this
pass yet. There is no production response to interpret. There is no confusion
pair unless the word itself makes one obvious. The judgment is: given this
word as it stands, what content should exist so a learner is not memorizing a
bare gloss.

If that pass is good, most post-graduation "please improve this card"
reflections should not happen. What reflection keeps is the part that needs a
learner event: a real miss, a near-synonym, an alternate that the card punished,
a distinction that only showed up in use.

### One content, then framing

The generated material and the material reflection would attach are the same
kind of thing: a situation, sentences that use the word, a short explanation,
maybe a tighter cue. Day-1 "show the sentence," learning-day cloze, and a later
review prompt are frames of that material.

Some frames are deterministic. Blanking the target inside a sentence does not
need a second author. Some frames may still want a pass of wording (how the
situation is spoken to the learner, how the resolution is phrased). That
legwork can be agent or template; it is not a second content model.

Still open from this bounce:

- whether a successful first pass should leave the meaning list off the study
  surface entirely, or keep it as a quiet anchor under the sentence
- what "good enough that I would not press the button" is, as the bar for the
  generator

§13 names the pass and splits schemas from shared primitives. Review should
inherit those primitives. Bootstrap does not emit a reflection result.

---

## 13. Name: word bootstrap

Captured 2026-09-23.

**Word bootstrap** is the agent task that looks at a word as it stands — corpus
meanings, existing examples, anything already attached — and produces the
content a learner should meet instead of a bare gloss. It runs because the
word has not had this pass yet, not because a learner missed.

Far later, there may be a separate per-learner **word introduction** pass,
shaped for that user just before a session introduces the word. That is not
this task. Bootstrap is word-level and reusable. Introduction-for-this-user
can wait.

### Distinct jobs, shared primitives

Bootstrap and reflection may emit some of the same objects. Their top-level
response schemas stay distinct, because the jobs differ.

| | Word bootstrap | Reflection |
| --- | --- | --- |
| Occasion | Word has not been bootstrapped | A study event, including an explicit ask on a correct card |
| Looks at | The word as it stands | The word, the served exercise, and what the learner did |
| Succeeds when | Review can inherit the content; the "please fix this gloss" ask is rare | The event becomes useful learning, and content changes only where that event warrants them |

Shared objects are primitives, not a shared response envelope. The general
word-content vision includes, whether or not the system tracks them yet:

- example sentences
- senses (not tracked today; potentially valuable)
- collocations
- confusion candidates

The first bootstrap prototype (§14) is motivated by word introduction, so it
only writes uses, examples, and collocations. Confusion candidates stay in
this vision. A neighbor is usually earned by a learner event, which is
reflection's job, and the introduction path does not need them yet.

Reflection keeps its own result schema: diagnosis of an event, learner-facing
explanation, proposals. Bootstrap gets its own schema (§14). It does not know
about introduction. A separate teaching-content workflow reads bootstrap state
and frames the first encounter.

Review inherits the primitives when bootstrap did a good job. It does not
re-run bootstrap's schema, and bootstrap does not pretend to be a reflection
with an empty attempt. Framing on top of a primitive can stay small:
deterministic where it is a transform (blank the target in a sentence), and a
separate workflow where the learner needs the situation spoken.

---

## 14. Minimal word bootstrap

Captured 2026-09-23. This is the first prototype. The reason to build it is
word introduction: teaching content should have real uses and sentences to
read. The bootstrap prompt itself stays unaware of introduction. Confusion
candidates remain in the general word-content vision (§13) and are not part
of this prototype.

### 14.1 Job

Look at the word as it stands (hanzi, pinyin, corpus meaning list, any existing
examples). Write the steady-state content review and recognition should inherit.
Do not mention sessions, introduction, clozes, or a particular learner.

The corpus meaning list is **input**. It is a fallback reveal only when a word
has no bootstrap yet. It is not the steady-state thing to show after a
successful recognition. Once bootstrap has run, recognition reveals bootstrap
content. "Possibly never" is the steady state: the meaning list stays in the
corpus for the agent to read, and drops off the card.

### 14.2 Senses, bounded

A full sense model, with its own review state, is out of scope. Do not block
bootstrap on it.

A word can still have more than one useful sense. Handle that with a **use**:
a bounded group inside the bootstrap document, for display and for later
teaching. Uses are not scheduled, not graded, and not part of word-skill state.
The word keeps one recognition clock and one production clock. SRS can leave
the learner to sort the uses out over time. Explicit teaching can still be
use-aware, because it can see the list.

Cap it. One use is the normal case. Two or three when the word genuinely has
more than one high-value use. Not an encyclopedia.

### 14.3 Minimal schema

```ts
type WordBootstrap = {
  wordId: string;
  uses: Array<{
    id: string;
    label: string; // one short natural sense, learner-facing
    examples: Array<{
      id: string;
      sentence: string;
      translation: string;
    }>;
    collocations: string[]; // may be empty; short phrases, not drills
  }>;
};
```

Per use: a label and at least one example. A second example is useful so a
later cloze is not always the sentence they just read, and it is still the
same primitive. Collocations may be empty.

That is the whole first prototype. No confusion candidates, no situation
paragraph, no resolution script, no cloze, no cue-repair operation, no
diagnosis tags.

### 14.4 What recognition shows

On a successful recognition reveal, for a bootstrapped word:

- the use labels
- one example sentence and its translation, from those uses

Not the corpus meaning list. Not a personal essay. If several uses exist, show
their labels together; the word is still one card. Rotating which example
appears can wait.

Unbootstrapped words keep today's reveal (meaning list, `examples[0]`). That
path is the migration fallback, not a second design.

### 14.5 Teaching content is the next workflow

Bootstrap stays unaware of introduction. A separate default task, **generate
new-word teaching content**, takes a bootstrap as input and writes the
first-encounter framing: which sentence or situation opens, and the resolution
that explains it.

Default output is deduped across users for a given bootstrap. The workflow is
parametrizable later (level, known words, whatever a user-specific introduction
needs) without changing the bootstrap prompt. Each agent task keeps a focused
prompt.

Cloze blanking of a bootstrap example can stay deterministic session code. It
does not need either prompt.

### 14.6 Still out of this minimum

- sense rows that scheduling or review intervals read
- confusion candidates (still part of the general word-content vision, not
  this prototype)
- per-user teaching parameters
- the too-hard / too-easy level hint
- retiring the meaning list from storage; it remains agent input and the
  unbootstrapped fallback
