# The journal's learning model

**Status: direction settled with Justin on Nov 23–24, 2026; first implementation
merged in PRs #623 (record and priority) and #624 (practice sessions, teaching,
typed recall).** After dogfooding a live session on Nov 24, Justin settled what
practice measures, the new-word lifecycle, and how intake relates to practice.
Those decisions are recorded below as direction; the
[README](README.md#the-record-and-priority) says which parts are built.
Thresholds and weights are policy and expected to change through dogfooding.
The principles below are product decisions: change them only with Justin, and
update this document when they change.

This document is for anyone changing how the journal decides what the learner
practices, how it records learner activity, how it teaches, or how the hosted
app's learners and data will move into it. It explains where the product is
going, the principles that rule ideas in or out, and what remains open. The
[README](README.md#the-record-and-priority) explains the current mechanisms;
[Media on the board](MEDIA.md) covers pictures.

## Where this is going

The scrapbook journal is a new app, not a port of the hosted study app. It will
move into the hosted server, keeping only a bare shell (sign-in, hosting,
validation) and replacing everything above it. Every learner moves over at
once to a fresh start with good onboarding; production never supports old and
new behavior side by side. This is a migration in the logical sense only: no
backward compatibility, and storage may mix relational, document and other
stores, each covered by per-learner access checks, backup and restore.

The hosted app was a prototype that restricted learning to words so its
behavior stayed predictable. The journal takes the next step: a hazy,
agent-managed set of things to train, organized around the learner's own
language rather than around fighting forgetting. The spike is where the model
is shaped while iteration is cheap; the hosted build is planned separately once
it holds.

The north star, not built yet, is a holistic tutor that forms a map of the
learner's abilities from everything they give it, including strengths that
show up in open answers, not only from exercises aimed at one target.

## Vocabulary

- **Pieces**: things with an identity that the learner brought in or made:
  readings, saved words, notes, takeaways, conversations. The scrapbook
  arranges pieces; the tutor may occasionally leave one.
- **Record**: the append-only history of what happened. *Events* hold the
  learner's own words and what they responded to; *judgments* are separate
  interpretations of events that name the model and prompt that made them and
  can be rerun. Mostly invisible; it surfaces as traces on pieces.
- **Internals**: what the system derives or has in progress: targets, the
  priority estimate, practice queues, background jobs, materialized views.
- **Targets**: what the learner trains: words with their uses (senses),
  expressions and constructions (patterns with slots, such as 本来想…结果…),
  all first-class.
- **Days**: a learning day is the learner's local calendar day. Every
  day-based rule (when a recall is due, a schedule's intervals, the check-up,
  clean days, the new-word allowance, practiced today) counts in the
  learner's time zone, so a recall due tomorrow does not arrive this evening
  because UTC has flipped. Times are stored as UTC instants and days are
  derived from them, so a change of zone or a DST shift moves day boundaries
  without rewriting history.

Targets are distinct from the reader's **dictionary** (`reader-catalog.ts`): a
shared lexical catalog of readings and senses that grows from lookups. The
dictionary says what a form can mean; a target says the learner is training it.

The line is between things and traces, not between learner content and
annotations: a margin note is a piece and also produces record entries.
"Journal" in the code means the whole store; prefer these terms in design.

## Principles

1. **The log is the source of truth.** Events are immutable; everything else is
   derived and rebuildable, including after targets are merged or split.
   Performance comes later from materialized views chosen once access patterns
   are known. *Rules out:* storing a target's state as primary data.
2. **Priority, not memory.** The app does not exist to fight forgetting; with
   an explosion of possible targets that framing becomes a burden. Forgetting is
   fine while the overall trend rises. Priority comes from everything the
   learner does. Priority can motivate memory practice over a bounded span, as
   an athlete's strength block serves the season: some memory improvement is
   essential, but it stays subordinate to priority. *Rules out:* SRS-style
   maintenance of every target on a schedule, lifetime maintenance, and
   validating that everything cycles back.
3. **Production is the product.** The strongest signal is the learner's
   produced language, especially where they reached for something they lacked.
   The experience is keyed off speaking and writing (writing is the early proxy
   for speech); there is no design for long-term quiet learners. The design work
   is making production low-stakes and easy to fall into.
4. **What the learner sees is decoupled from scheduling.** Open answers get
   feedback without a grade; judgments feed priority internally. Scheduling is
   an internal construct, never a product feature (the SRS mistake).
5. **One tutor voice; judgment follows it.** The tutor teaches in the moment;
   the background judgment is the slower path that updates state and steers
   practice, and never speaks. It reads only language the tutor has already
   responded to, and stays consistent with that response. Chat is judged
   through its reflection, after the reflection completes, and only for points
   the takeaways addressed, so practice follows what the learner was shown.
   *Rules out:* drilling a point the learner was never taught.
6. **Targets are hazy and agent-managed.** The agent creates and merges targets;
   near-duplicates and messy data are expected. Identity is the exact form for
   now.
7. **One practice surface; form follows what it measures.** An exercise has an
   origin and a grader, and each form measures something different. Real
   production is set off by an intention or by the words already said, like
   predicting the next word; nothing on the page offers the answer.
   - **Bounded exercises test targets.** Typed recall, judged by rule, is the
     default for any target: a new word, a word being reviewed or settling, and
     a weakness from the learner's own language. A weakness comes back first as
     recall: the slip 有意思的避开下乡 returns as a recall of 有意. Other
     deterministically judged forms, such as comprehension checks, are to be
     tried later.
   - **Choice is recognition, not recall.** Reading options pages the answer
     into mind. A choice is used only for a contrast the learner has
     demonstrably confused (their own slip, or a repeated miss), partly for
     product discovery, and never as the check after teaching. A correct choice
     is never evidence of strength: it is not a clean day and not growth. A
     wrong choice is still a miss.
   - **Open production is conversation, not a test.** Someone says something, a
     conversation is under way, or a moment invites a reaction, and the learner
     replies as themselves. The lead-in may draw on targeted material but never
     specifies a required word, frame or content. It is judged holistically on
     贴切 (aptness): it landed or it didn't, and the tutor decides the reaction.
     A good answer that drifted from the material, or did without its
     expression, is not flagged. Target use in an open answer is an optional
     signal that feeds priority and never graduation, since the card steered the
     learner toward it.

   What matters is a good exercise in front of the learner, generated or
   reserved. Exercises start per-learner and disposable; quality improves
   mainly through generation, and an exercise flagged as bad never counts for
   or against the learner. *Rules out:* open production as the test of whether
   a target has landed, and a choice as evidence of learning.
8. **The encounter starts teaching; it doesn't limit it.** Teaching keeps the
   hosted design: beats the learner steps through, depth chosen per word. It
   opens with a scene, not a definition, and is narrow to the learner's need by
   default. The tutor may judge that a word needs a second example of the same
   sense, another useful sense, or proper background ("vegetables"), but it
   does not cover every default sense. When the learner's own saved context
   carries a situation, that situation is the scene: the visible link between
   open-ended gathering and structured training. A saved example without a
   situation is not shown verbatim just because it exists. Exercises are
   generated from where the word is in its lifecycle.
9. **New words have backpressure and a bounded lifecycle.** A daily limit and a
   cap on open work keep new words from crowding out practice. A new word is
   checked lightly, but not immediately after teaching: it returns as typed
   recall later in the same session, after a few other cards. The session's
   time box is rough rather than a cap. The session tries to finish open work
   such as that recall unless the learner leaves, and does not start teaching
   near its end. A word whose recall was missed by leaving is first in line next
   session. The word then settles on a bounded recall schedule and graduates,
   as the hosted app's Solidify did. Graduation is an experiment: each newly
   taught word is randomly assigned one policy, recorded with its version, and
   all policies are also scored in shadow. Only bounded evidence counts: no
   choice, no open-production use.

   | Policy | Recalls after teaching | Graduates after |
   | --- | --- | --- |
   | A | 1 day, then at least 1 day | 2 clean |
   | B | 1 day, then 3 days | 2 clean |
   | C | 1, 3 and 7 days | 3 clean |

   A miss resets the schedule. Fourteen days after graduation, one typed recall
   checks every policy the same way. It is measurement, not maintenance, and a
   miss reopens the word like any miss. Due recalls are best effort: they
   compete by priority, ranked high, and a backlog never takes over a session.
   Each policy reports its check-up pass rate and the recalls spent to
   graduate. Lifecycle state is derived from the record (principle 1).
10. **Old structure is scaffolding.** It stays only while new policies are
    missing; what earns its keep is promoted, the rest retires and is archived.
11. **Intake explains; admission is a separate judgment.** A reply to something
    the learner brought in explains it first, in the context they supplied, and
    mentions practice only afterwards, and only if the item was admitted. An
    item asked about becomes a piece; a separate, rerunnable judgment in the
    record decides whether it also becomes a target to teach. An explicit save
    always admits, trusting the learner's intent for now ("the coach sometimes
    says no" is a later stage). Pieces that are not admitted stay quietly, with
    no interface for now. *Rules out:* machinery that assumes every item is
    admitted.

## What the hosted app contributes

The hosted app's production was single-word recall: typing one word into a
blank, 2–3 characters on average across about 44,000 answers. It is SRS
evidence, not produced language. Mistakes say more than correct recalls.

| From the hosted app | Becomes |
| --- | --- |
| Words, chosen senses and recall history (counts, last miss, latest wrong answers) | Targets with a weak priority input (at most a tenth of a fresh need) |
| Unstudied words in the stash | Words waiting to be taught, like journal saves |
| Dismissals and production suppression | Learner preferences |
| Sense policy: inventory of uses, default useful senses, how senses are introduced | Teaching policy |
| Teaching beats and production-cue guidance | Adapted prompts for teaching and typed recall |
| Detecting poor exercises; reversing unfair lapses | Judgments that discount evidence and inform generation |
| Pure cues accepting several words | Crediting whatever target the learner actually used |

Stash membership stops mattering once a word has been studied; its main use was
sourcing new words to teach. Unstudied bulk-repertoire words are not imported.
**Dropped:** post-session feedback lessons, modes as a learner-facing concept,
the curated exercise bank and introductions (reuse only if they fit), frozen
sessions and closure fencing, proxy coverage rules, and the operator repair and
publication pipeline.

## Open questions

- **Authority.** When the judgment disagrees with the tutor, which wins? For
  now it flags disagreement and follows the tutor.
- **Tutor interpretations as judgments.** Reflection takeaways and feedback
  observations could feed the judgment as evidence; how, and in what order.
- **Avoidance.** Whether working around a target matters beyond situations that
  needed it; communicative success and target use are recorded separately. An
  open answer that does without an expression is not a weakness.
- **Teaching breadth**: how often the tutor's judgment should reach beyond the
  learner's need.
- **Target deduplication**: when the agent merges or splits, and how messy is
  acceptable. Saved passages are events but not yet targets.
- **Pieces gaining weight.** Not admitted now is not never: the same thing asked
  about in four situations shows an emerging theme worth teaching properly.
  The current admission judgment need not realize this yet.
- **Dictionary and targets.** How a target's uses relate to dictionary senses,
  and whether one should seed the other.
- **Lookups as evidence.** Reader lookups live in their own ledger, not the
  record. A lookup during reading may signal a need; whether and how it should
  enter the record and priority is open.
- **Blessed exercises**: whether a reviewed shared set eventually beats
  generation on risk.
- **Saved items**: whether things the learner chose to keep should resurface
  now and then, distinct from scheduled maintenance.
- **A view of what the app knows**: whether imported or other targets ever
  appear on the board as a summarized piece.
