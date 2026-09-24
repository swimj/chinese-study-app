# New-word introduction and word bootstrap

status: active
type: research
created: 2026-09-19
retire-when: remaining authoring and learning-transition questions are resolved and exploration history is no longer needed
related:
  - SPECS/session-covering-criteria.md
  - SPECS/learning-review-model.md
  - SPECS/study-action-model.md
  - SPECS/session-reflection-generation.md
  - SPECS/adaptive_vocabulary_training_product_notes.md
  - notes/active/2026-08-07-reflection-remediation-policy-working-notes.md
  - notes/active/2026-08-04-cue-first-class-brainstorm.md
  - notes/active/2026-09-18-pure-cue-elicitation-memo.md

Snapshot as of 2026-09-24. The accepted content-model direction has graduated to
[Word Bootstrap, Introduction, And Early Rehearsal](../../SPECS/word-bootstrap-and-introduction.md).
That spec supersedes provisional proposals here. This note retains worked
explorations and feedback; the draft prompt remains linked below. Current
learning/covering behavior is unchanged until its open decisions are settled.
The first executable representation checkpoint is described in
[the model/compatibility guide](../../docs/word-content-model.md): all six
introductions, explicit rehearsal contracts, exact-span clozes, and existing
review/supplement adapters can be exercised with `npm run inspect:word-content`.

---

## Snapshot

### 1. Immediate motivation: new-word introduction

The immediate goal is a better first meeting with a word. That matters most
for new users, whose sessions are currently only new words. Changing what else
a new user studies is a separate topic and out of scope.

Today the first encounter is a thin reference card (hanzi, pinyin, corpus
meanings, one example string) plus gloss-direction recall. The useful material
— a natural use, a real sentence — shows up later, if at all.

### 2. Improve word content earlier

Related, and the reason introduction should fall out of better content rather
than be a one-off card: a lot of that material is word-level. It does not need
a production mistake, and it should not wait until a word graduates to review.

Dogfood often memorizes the bare gloss through the learning days, then on the
first review presses **Ask reflection to review**. Memory was fine. The content
was not. Graduation is being used as the door to a repair that did not need a
learner event.

Reflection stays the right tool when something happened: a real miss, a
near-synonym, an alternate the card punished, a distinction that showed up in
use. Similar-word mistakes still belong there. Bare definitions decoupled from
usage do not.

If the earlier pass is good, review inherits it, and most of those
"please fix this gloss" asks should not happen.

### 3. Word bootstrap is the core backend task

**Word bootstrap** looks at a word as it stands — hanzi, pinyin, the corpus
meaning list, any existing examples — and writes the content a learner should
meet instead of a bare gloss. It runs because that pass has not happened yet,
not because a learner missed.

The prompt does not know about introduction, sessions, clozes, or a particular
learner. The first prototype exists so introduction has something real to read,
and so review can inherit the same content.

Early prototype sketch (superseded by the accepted spec's content boundaries;
exact fields remain TBD):

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
  }>;
};
```

One use is the normal case. Two or three when the word honestly has more than
one high-value sense. That is a bounded grouping inside this document so
teaching can be use-aware. It is not a sense model. Uses are not scheduled,
not graded, and not part of word-skill state. The word keeps one recognition
clock and one production clock. A full sense model is out of scope and must
not block this.

Bootstrap and reflection may write some of the same kinds of objects later.
Their top-level response schemas stay distinct. Reflection answers an event.
Bootstrap answers the word. Bootstrap does not emit a reflection result with
an empty attempt.

The broader word-content vision also includes senses (not tracked today) and
confusion candidates. Confusion candidates are not in this prototype. A
neighbor is usually earned by a learner event.

On a successful recognition reveal, a bootstrapped word shows the use labels
and one example with its translation. The corpus meaning list is agent input,
and the reveal only when a word has not been bootstrapped. It is not the
steady-state card. Unbootstrapped words keep today's reveal until they are
bootstrapped. The meaning list stays in storage.

### 4. Intro lesson is a follow-on task

**Generate new-word teaching content** is a separate task. It takes a bootstrap
as input and writes the introduction. Initially there is no user customization:
one result per bootstrap, shared across users.

The workflow can gain parameters later (level, known words, a per-learner
introduction). That stays out of the first version, and it must not leak into
the bootstrap prompt. Each task keeps its own prompt.

The explorations below cover 报备, 藤椒, 泡沫, 不堪, 石沉大海, and 为所欲为.
Their teaching stance and pacing are distilled into the standalone
[draft introduction prompt](2026-09-24-word-introduction-prompt-draft.md).
Input/output structure and the implementation contract remain open.

### 5. One content core, several materializations

The learner does not study the bootstrap document. A scenario materializes it.

The same example sentence can be shown whole or with the target blanked. That
blank is deterministic. It does not need another agent. Other framings (how a
situation is spoken in an intro lesson) belong to the teaching task, which
reads the bootstrap rather than authoring a second copy of the sentences.

### Also settled

- Do not match sentence vocabulary against the learner's known lexicon. Trust
  the generator to scale complexity to the target word. A later "too hard /
  too easy" nudge, stored as a coarse level hint for a later generation, is
  optional and not part of the first prototype.
- Do not merge this with the pure-cue elicitation memo. That memo is about
  judging a cue that cannot pick one word. This note is about word content and
  how introduction reads it.
- Staged enrichment across learning days, an agent choosing pedagogical beats,
  and per-user introduction parameters are later framing. They are not the
  current work.
- Session covering (what replaces today's 3×3 gloss drills, and what "covered"
  means in learning) is not designed yet. Materializing a sentence as a cloze
  is the content claim. The scheduling claim is still open.

---

## Introduction exploration: 报备 (2026-09-24)

We compared possible teaching needs for 藤椒 (concrete ingredient), 报备
(situational usage), 泡沫 (multiple uses), and 不堪 / 堪比 (construction-focused
words). We then role-played 报备. The user liked the scenario-led sequence
below. This is one successful reference example, not a universal template.

### What the exploration established

- Stay within the app's card interaction model. Current evaluated input is
  Hanzi matched deterministically against accepted responses. LLM chat and
  sentence-construction evaluation are outside this first version.
- Begin with a scenario, then the Chinese sentence containing the word, then
  explain what the word means or does there. A translation can have its own
  beat after the Chinese, giving the learner a moment to read first.
- Breathing room is valuable. The initial long explanation repeated itself
  at the sentence level; compressing it into a dense reference card made it
  worse. Each beat should contribute something distinct, with enough context
  to let the learner absorb the word.
- Space advances one beat at a time. Do not show the entire sequence at
  once. This quick, learner-controlled rhythm helps the user focus.
- The newest beat should receive visual focus while earlier material remains
  available. Compacting earlier lines into a readable history is an appealing
  presentation idea to try, not a settled layout. Keep the example accessible
  during its explanation and avoid distracting movement.
- Private reflection questions can invite the learner to connect or compare
  situations. No submitted answer or evaluation is required. Advancing does
  not prove that the learner answered or mastered the word. The app can guide
  a useful path without tracking every mental step.
- Immediate cloze practice felt overly rote as the next step. Give a new
  word time to mean something before recall practice. The simple challenge
  level of the earlier exercise was otherwise appropriate; this does not yet
  decide when practice begins or change session covering rules.
- This interaction leaves a natural opening for richer agent interaction
  later, without requiring it now.

### Reference sequence

Each numbered item is a separate Space-advanced beat. Wording is a working
example, not final product copy; exact pronunciation placement remains open.

First situation:

1. A friend is driving over to visit. Before they arrive, your apartment
   compound needs their license plate number on file.
2. **你得先向物业报备朋友的车牌号。**
   *Nǐ děi xiān xiàng wùyè bàobèi péngyou de chēpáihào.*
3. Before your friend visits, you need to notify property management of their
   license plate number. (A separate translation beat is an option; the first
   role-play showed pinyin and moved straight to the explanation.)
4. Here, **报备** means letting the responsible people know so they have the
   information on record. You're giving property management the details ahead
   of the visit.
5. Where else might you need to do something like this—at work, at school, or
   when arranging a trip?

After the learner reflects and continues, a second situation broadens the use:

1. Later, you're organizing a group trip. The person coordinating it sends
   this reminder:
2. **如果临时更改行程，请提前向负责人报备。**
3. If your itinerary changes at short notice, notify the person in charge
   beforehand.
4. This time, you're reporting a change of plans. **报备** still carries the
   idea of keeping the responsible person informed, with the details on record.
5. Think back to the visiting friend and their license plate. What do these
   two situations have in common?

### Still open

- The examples below now span several teaching needs. 堪比 has not been tried;
  testing the draft prompt on fresh words remains useful.
- How should reusable usage explanation versus sequence-specific teaching prose
  be represented? The accepted spec includes useful word-level notes and omits
  a standalone collocations field; the exact payload is still open.
- Which words benefit from two situations or reflection questions, and when
  do those become repetitive or burdensome?
- Exact layout, backward navigation, pronunciation/translation presentation,
  transition into practice, and session covering remain undesigned.

### Important coverage gap: relationship 报备

After the examples, the user explained that their most frequent encounter with
报备 is in contemporary relationship discourse: reporting one's whereabouts to
a partner, particularly excessive reporting or demands for it. The initial
property-management and trip-coordinator scenes missed that personally salient
use. Relationship 报备 can also be framed positively as voluntary reassurance;
excessiveness is contextual, not inherent in the word.

Usage sources checked during discussion:
- [中国青年网: 如何看待恋爱中的控制欲？](https://txs.youth.cn/zt/tymb/qgkt/hlkt/202301/t20230103_14233770.htm)
- [联合新闻网: 該跟另一半報備自己行程嗎？](https://woman.udn.com/woman/story/123166/7565345)

Critical open question: how should bootstrap select salient contemporary uses
and registers, beyond supplying accurate examples of a narrower formal use?
The learner's encounter context is useful evidence here; no personalization
requirement or revised schema has been agreed. The original introduction's
positive reception establishes presentation value, not complete usage coverage.

### Proposed use-selection principle: everyday salience

The user proposed explicitly asking whether a word has colloquial uses. When
such a use is not obscure, its prominence in everyday conversation elevates
it for inclusion. People may first encounter a word through its main colloquial
use and only later discover a formal or original use. Relationship 报备 is the
motivating example.

Working implication: choose content and teaching order by likely encounter and
usefulness, not automatically by dictionary order or formal/original meaning.
Ask what the word usually means when people use it in ordinary conversation,
and whether teaching only the formal use would leave those encounters confusing.
This is a consideration, not a requirement to invent a colloquial use for every
word, include obscure slang, or always teach colloquial usage first. A different
register or social setting can deserve an example without becoming a separate
sense or scheduled object. No prevalence ranking has been established for
报备 by the examples checked above.

The user explicitly scoped relative-frequency measurement out of this first
pass. Start with best-effort model/editorial judgment about familiar, useful
uses ("vibes"), then learn from examples and actual use. Do not turn this
selection guidance into a corpus-analysis or frequency-ranking prerequisite.

## Introduction exploration: 藤椒 (2026-09-24)

The user advanced through this introduction one beat at a time and said
"that was good" after completing it. This is a second positively received
example, this time for a concrete ingredient.

### Played sequence

1. You're looking through a restaurant menu. One chicken dish sounds
   unfamiliar—the server describes it as fragrant, with a tingling, numbing
   sensation.
2. **这道藤椒鸡吃起来很香，舌头还会有点麻。**
   *Zhè dào téngjiāo jī chī qǐlái hěn xiāng, shétou hái huì yǒudiǎn má.*
3. This green Sichuan pepper chicken is fragrant, and it leaves your tongue
   feeling a little numb.
4. **藤椒 · téngjiāo** is a type of Sichuan pepper used to flavor food. Its
   small green berries give dishes a fresh aroma and that tingling, numbing
   sensation. On the menu, **藤椒鸡** is chicken flavored with it.
5. You might also see **藤椒油** on a bottle in the kitchen. Before moving on,
   take a moment to imagine what that would add to a dish.
6. **藤椒油** is oil flavored with 藤椒—a way to add its aroma and numbing
   tingle to a dish. Next time you spot **藤椒** on a menu, you'll have an idea
   of the flavor to expect.

Each beat required Space, including the private inference question followed
by its explanation. No evaluated input was requested.

### Takeaways and limits

- A menu situation grounded the concrete referent; a related expression,
  藤椒油, provided a small inference opportunity without a second full scene.
- The user's positive response supports keeping this lighter sequence as
  another reference alongside 报备. It does not establish a required beat count
  or a mandatory inference question for every word.
- The assistant noticed repeated descriptions of aroma/numbing and suggested
  shortening the last reveal to "藤椒油 is oil flavored with 藤椒." This is an
  editorial suggestion, not a separately tested or user-requested correction;
  the user approved the experience overall.
- Working-note practice for this exploration: proactively record valuable
  conclusions/checkpoints and critical open questions, rather than every
  wandering thought. The user explicitly requested this practice.

## Introduction exploration: 泡沫 (2026-09-24)

The user completed the following Space-advanced sequence and said "that was
great!" This provides a positively received multi-use example alongside 报备
and 藤椒.

### Played sequence

1. You're washing your hands. As you rub them together, the soap turns into a
   mass of tiny bubbles.
2. **洗手液一搓就起泡沫了。**
   *Xǐshǒuyè yì cuō jiù qǐ pàomò le.*
3. As soon as you rub the hand soap between your hands, it starts to foam.
4. **泡沫 · pàomò** means foam or lather—the mass of bubbles you get from soap,
   or on top of a freshly poured beer. In this sentence, **起泡沫** means
   "to foam up."
5. Later, you're reading about housing prices. They've been rising rapidly,
   and people keep buying because they expect to sell for even more. An
   economist warns:
6. **房价涨得太快，可能已经出现了泡沫。**
   *Fángjià zhǎng de tài kuài, kěnéng yǐjīng chūxiàn le pàomò.*
7. Housing prices have risen so quickly that a bubble may already have formed.
8. Here, **泡沫** means an economic "bubble": prices have become inflated beyond
   what the underlying assets reasonably support. Think of the foam in your
   hands—full of air, and easy to collapse. That image helps connect the two
   uses.
9. Someone says **泡沫破了**—"the bubble burst." What would you picture in the
   kitchen? What would you picture in a report about housing prices?
10. In the kitchen, you'd picture bubbles popping and the foam disappearing.
    In the housing report, you'd picture inflated prices falling sharply.
    The setting tells you which **泡沫** the speaker means.

The learner then advanced once more to finish. Reflection remained private;
the next beat supplied the interpretation without grading an answer.

### Takeaways and limits

- Two scenes can introduce distinct uses as a connected progression: establish
  the literal referent, introduce the figurative use, then connect their imagery.
- The final prompt invited a mental switch between contexts using one phrase.
  It gave the learner something to do without submitted input or live grading.
- This longer sequence was well received. Keep pacing and meaningful progression
  as design criteria rather than assuming the fewest beats is best.
- These are exploratory observations from this example, not evidence of
  retention or a fixed template for every multi-use word. The introduction
  covered foam/lather and the economic metaphor; packaging was not included.

## Introduction exploration: 不堪 (2026-09-24)

The user found a little grammar teaching helpful rather than overly academic
for this kind of word, and specifically liked seeing both forms presented.

### Played progression

Each beat was advanced separately, following the same scenario, Chinese with
pinyin, translation, and explanation rhythm as earlier examples.

- A day spent moving apartments led to **忙了一整天，我已经疲惫不堪了。**
  (After a whole day of hard work, I'm utterly exhausted.) The explanation
  showed 不堪 following a description: 疲惫 -> 疲惫不堪, intensifying exhaustion.
- Upstairs renovation noise led to **楼上的噪音让人不堪忍受。**
  (The noise from upstairs is unbearable.) The explanation showed 不堪 before
  忍受, then compared the two patterns in plain language.
- An inference question used an improvised chair example, **不堪一坐**. On
  the next beat, the assistant explained the intended collapse warning, then
  interrupted the lesson to flag the expression as improvised and substitute
  **不堪一击**. This chair phrase is part of the exploration history, not a
  recommended teaching example.
- The final beat described a badly defeated team as **不堪一击**, connecting
  inability to withstand an attack with 不堪忍受's inability to endure noise.

### User feedback and implications

- Light, example-linked grammar is useful for a construction-focused word.
  Both the following-description and preceding-complement forms were valuable;
  do not simplify away that distinction merely to avoid sounding academic.
- The mid-lesson self-correction felt odd. The user appreciated it during
  discovery but would not show that editorial interruption in a real lesson.
  Revise authored content before presentation rather than carrying this
  brainstorming correction into learner-facing copy.
- The user accepts that teaching examples can be imperfect, as with human
  teachers, and expects usage understanding to settle through experience
  (沉淀). This supports a practical quality bar rather than perfection as a
  prerequisite; it is not a decision to knowingly retain misleading examples.

## Set-phrase explorations: 石沉大海 and 为所欲为 (2026-09-24)

The user raised set phrases because recognizing them in conversation flow
matters for the initial target learner level. These examples continued the
Space-paced introduction format with private, unevaluated questions.

### 石沉大海: transparent imagery

- Scenario: a proposal sent last week has received no reply or update.
- Sentence: **方案发过去以后就石沉大海了，一点回音都没有。**
  (After I sent the proposal over, it disappeared without a trace—not a word
  back.) Chinese/pinyin, translation, and explanation were separate beats.
- Explanation: a stone sinks into the sea and nothing comes back; messages,
  requests, or applications receive no response. 一点回音都没有 reinforces it.
- Transfer question: **投了十几份简历，全都石沉大海了。** Even if you miss the
  exact number, what happened to the applications?
- Reveal: they heard nothing back; silence does not necessarily mean rejection.

The user found this easier than expected because the physical image is readily
evoked by the phrase, rather than requiring much literary-language parsing.
They requested 为所欲为 to test a less transparent construction next.

### 为所欲为: selective literary parsing

Played beats:

1. Someone at work keeps changing plans without consulting anyone and says
   "I'm in charge" when challenged. Another colleague has had enough.
2. **他以为自己是老板，就可以为所欲为。**
   *Tā yǐwéi zìjǐ shì lǎobǎn, jiù kěyǐ wéi suǒ yù wéi.*
3. He thinks being the boss means he can do whatever he likes.
4. **为所欲为** means doing whatever you please, without regard for rules or
   other people. Here it criticizes treating authority as permission to act
   however one wants.
5. The compact literary wording can be parsed: **欲** means "want";
   **所欲为** means "what one wants to do"; the first **为** means "do."
   Together: "do whatever one wants to do."
6. Someone complains about a rule-breaking player: **有钱就能为所欲为吗？**
   *Yǒu qián jiù néng wéi suǒ yù wéi ma?* Does having money mean you can do
   whatever you like? What answer does the speaker expect?
7. No, of course not: a protest rather than a genuine question. Listen for
   the criticism that someone acts as though the usual limits do not apply.

### Accepted teaching distinction

The user explicitly endorsed the parsing beat as what they were hoping for.
Decomposing ordinary words is likely overkill, but a little "how to parse this"
for literary set phrases helps immensely with grasping meaning and later
"constructive" recall—reconstructing the expression from its meaningful parts.
Use decomposition selectively when it explains otherwise opaque structure;
do not make character-by-character analysis a mandatory introduction slot.
This complements concrete imagery for transparent phrases and light grammar
for construction-focused words. It does not introduce a new evaluated recall
task or change covering policy.

## Data-model discussion checkpoint

With the introduction prompt drafted, the user moved discussion to the content
model. Teaching-to-learning behavior remains open. The model should support
the worked introductions while allowing later learning design to evolve.

User-raised requirements and tensions:

- Sentences appear in teaching, supplements, and exercises. Natural teaching
  examples need not uniquely elicit their target when blanked. Do not force
  exercise suitability onto every teaching sentence.
- Introduction includes ordered framing, explanations, pauses, and learner
  invitations. Its coherence should survive the dynamic review-content pool
  produced by reflection.
- Reusing teaching sentences for early practice is desirable. Explicitly
  practicing the newly taught target could intentionally tolerate overtraining
  and exclude pure-cue promotion. This exercise intent is now accepted in the
  new spec; its effects on learning coverage and graduation remain open.
- Teaching/learning content might improve on a slower cycle than review cues.
  How to unify reusable material while separating these lifecycles is central
  to defining word bootstrap.

The following proposals were subsequently accepted as a combined feature
direction and refined in the linked canonical spec:

- Separate lexical word identity, reusable content, authored lesson assembly,
  exercise contracts, and learner progress. Treat teaching/supplement/exercise
  as uses of material rather than mutually exclusive sentence types.
- A full sentence is not itself a pure cue. A presented stimulus plus its
  instruction and answer contract defines an exercise. The same source can
  support display, explicit target rehearsal, or separately authored review
  elicitation without sharing assessment or lifecycle identity.
- Pin a lesson's exact content and any associated rehearsal recipes as a
  coherent package. Review eligibility may evolve independently. References
  should identify exact immutable material rather than "the latest example."
- Current cues and supplements already have immutable content and frozen
  served evidence; dynamic review comes from lifecycle/selection changes.
  Existing supplements are attached to exact definition cues/fallbacks, and
  pure cues own independent scheduling. These are compatibility constraints,
  not reasons to reinterpret existing rows as general word examples.
- Bootstrap could produce a coherent edition of word-level uses, examples,
  and concise usage/pattern notes. Teaching consumes it; exercise definitions
  add their own answer contracts. Exact types, tables, revision mechanics,
  serving/publication authority, and learning progress remain undecided.

Acceptance refinements:

- Introduction and associated rehearsal stay coupled as a coherent package.
  Rehearsal may be deliberately constrained, like an athletic drill targeting
  a weakness rather than permitting an established substitute habit.
- Pinned teaching and dynamic review may drift. Periodic custodial review can
  realign them deliberately; the goal is convergence toward quality, not churn.
- User experience takes priority over deduplication or efficient derivation in
  the first implementation.
- Drop standalone collocations without an immediate consumer. Useful phrases
  can be taught when appropriate without carrying an inventory.
- Learning transition, publication mechanics, and correction handling remain
  explicit implementation-boundary decisions in the spec.

## Appendix

Unstructured leftovers that are still useful. Not a plan.

Reflection already looks at a word and judges the content before it interprets
an attempt. An explicit ask on a correct card is that judgment with no miss.
Bootstrap is the same kind of look, given its own occasion and its own schema,
run before study. The success bar worth keeping: after the word graduates, you
do not press the ask button.

A use, at the density we want, looks like: label "measures; steps taken to
deal with something"; sentence 政府采取了新的措施来减少污染。 / The government
took new measures to reduce pollution; collocations 采取, 出台. Not a
dictionary dump, and not a lesson script.

Audio, collocation drills, contrast exercises, and a persisted `teaching`
lifecycle state are not part of this. `learning-review-model.md` already lists
`teaching` as a non-goal status. Introduction here is a lesson generated from
bootstrap content, not a new word state.
