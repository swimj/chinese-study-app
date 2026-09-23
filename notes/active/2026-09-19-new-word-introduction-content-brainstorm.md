# New-word introduction and word bootstrap

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

Snapshot as of 2026-09-23. This is a working direction, not an implementation
contract. Canonical specs and the stability frontier still describe current
behavior. Read the snapshot. The appendix is leftover color, not a second plan.

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

First prototype:

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

The intro lesson itself is not designed yet. Situation-first openings and
other lesson beats are for that follow-on, not part of this snapshot.

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
