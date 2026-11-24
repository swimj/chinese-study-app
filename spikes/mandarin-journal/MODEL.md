# The journal's learning model

**Status: direction settled with Justin on Nov 23–24, 2026; first implementation in
PRs #623 and #624.** Thresholds and weights are policy and expected to change
through dogfooding. The principles below are product decisions: change them
only with Justin, and update this document when they change.

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
   learner does. *Rules out:* SRS-style maintenance of every target on a
   schedule, and validating that everything cycles back.
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
7. **One practice surface; form follows purpose.** An exercise has an origin
   and a grader. A new word is taught, then checked lightly; a weakness from the
   learner's own language gets open production; a review is typed recall, as on
   the hosted flashcards, which is harder than choosing. What matters is a good
   exercise in front of the learner, generated or reserved. Exercises start
   per-learner and disposable; quality improves mainly through generation, and
   a bad exercise never counts against the learner.
8. **The encounter starts teaching; it doesn't limit it.** Teaching may widen to
   a word's fundamental uses beyond where it was met ("vegetables"). Teaching
   keeps the hosted design: beats the learner steps through, depth chosen per
   word.
9. **New words have backpressure.** A daily limit and a cap on open work keep
   new words from crowding out practice, and a newly taught word settles before
   it graduates, as the hosted app's Solidify did.
10. **Old structure is scaffolding.** It stays only while new policies are
    missing; what earns its keep is promoted, the rest retires and is archived.

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
  needed it; communicative success and target use are recorded separately.
- **Teaching breadth** and the share of vegetables.
- **Target deduplication**: when the agent merges or splits, and how messy is
  acceptable. Saved passages are events but not yet targets.
- **Blessed exercises**: whether a reviewed shared set eventually beats
  generation on risk.
- **Saved items**: whether things the learner chose to keep should resurface
  now and then, distinct from scheduled maintenance.
- **A view of what the app knows**: whether imported or other targets ever
  appear on the board as a summarized piece.
