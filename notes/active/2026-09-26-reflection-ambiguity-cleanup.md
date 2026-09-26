# Reflection ambiguity cleanup

status: active
type: research
created: 2026-09-26
retire-when: this direction is accepted into the reflection specs, or declined
related:
  - SPECS/pure-cue-elicitation.md
  - SPECS/session-reflection-generation.md
  - SPECS/reflection-proposals-and-handles.md
  - server/reflection/prompts/staged-diagnosis.md
  - server/reflection/prompts/pure-cue-promotion.md

Provisional direction from the 2026-09-24 reflection-prompt review. Not an
implementation contract. Current specs still describe stage two as pure-cue
promotion.

## What the current cut forces

Stage one sees one served cue and one response. It either finishes the item
or hands off a declared shared instinct. Stage two then has two outcomes:
`promote`, which must name a pure-cue destination and nests both word plans
inside that operation, or `disagreement`, which drops the content plan.
The promotion prompt tells that stage to carry the instinct forward and
choose a shared exercise.

A real 遭到 / 遭受 review showed the seam. Promotion wrote useful distinctive
cues for each word, and also a pure cue. The pure cue is the part that should
not exist. Those word plans cannot be kept without it.

## A slot, not a shared gloss

A shared axis is a slot a speaker can aim at, where more than one word is a
natural way to succeed: a referent, a communicative act, or a situation.
A region of meaning that two English glosses both cover is not a slot.

Local interchangeability is enough. The words do not have to substitute in
every other sentence. A swap that a listener could merely repair does not
count. Differences outside the slot are boundaries. Differences that show up
inside the sentences where you would actually reach for the word mean there
is no slot.

提醒 / 提示 under `系统会____用户的密码即将过期` is a slot. Either word can
do that act, and their other uses remain boundaries.

遭到 / 遭受 under “to suffer or be subjected to an unfortunate event” is not
a slot. The gloss is the only place they both fit. In the collocations that
matter, one word is natural and the other is odd. Keeping them apart is the
lesson. A pure cue would grade the odd word as success.

A concrete shared referent still qualifies. Two words that both name one
object can share a pithy gloss, because the gloss is the thing you might
mean.

Stage one currently asks whether both words fit the presented cue. When that
cue is a broad English gloss, both words fit it by construction, and the
handoff can park the real difference in `boundaries`. The served gloss must
not be allowed to define the slot.

## Responsibility split

Stage one should separate a true lapse from an entanglement, and stop
declaring that a shared instinct exists.

A true lapse is a fair task and a response that would still be wrong under a
specific version of it, as with 实用 under “to be applicable.” Stage one
finishes that itself: explanation, and contrast when the mix-up is stable
and teachable.

An entanglement is a second known word that looked like an answer to the cue
as shown, including a gloss broad enough to cover both. Stage one hands off
the pair and the cue.

Stage two owns the cleanup, because it is the stage that sees both words'
cues and any shared cues already in play. It has three endings:

- A real slot: publish or extend the pure cue, and adjust each word's own
  cues. This is today's promotion. The original lapse was false, so
  compensation still applies.
- No slot: keep the per-word drafts and retire misleading cues, with no pure
  cue. 遭到 / 遭受 lands here. The original miss can stand, because the words
  were not substitutes, so this ending does not compensate.
- Nothing to change: an explanation only. This remains the outcome when even
  the word plans are not worth making.

The “no slot” ending is a successful cleanup, not a disagreement with the
handoff.

## If a slot exists, what the one stimulus should be

A pure cue is still one stimulus. A gloss and a cloze as two routes belong
on word-owned cues, which can hold several drafts. They are not a pair the
shared destination can be.

When stage two does publish a slot, the stimulus should usually be something
answered in Chinese: a natural cloze, with a short English frame when the
blank would otherwise be too open. That frame-plus-cloze is one cue. Use a
bare gloss when the overlap really is a simple referent and a sentence would
only decorate it. The axis note can carry the English scope. It should not
rescue a gloss that flattens the instinct into a category.

Word-owned repairs can still pair a gloss and a cloze when each adds a real
retrieval route. That preference stays with the stage that can emit several
cues. It is not a quota, and it is not a reason to avoid clozes.

## Parked

Giving one shared axis several stimuli, and renaming “pure cue” so “cue”
means the stimulus, is a separate data-model change. It is not required to
separate slot publication from per-word cleanup.
