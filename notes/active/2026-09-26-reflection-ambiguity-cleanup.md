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

Direction from the 2026-09-24 reflection-prompt review, refined and accepted for
implementation in the 2026-09-26 task discussion. The canonical contracts now
live in the related specs above; this note retains the motivating examples and
scope decisions.

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

Stage one is a best-effort filter between an ordinary lapse and suspected
entanglement. It stops declaring that a shared instinct exists. Stage two may
revise that initial assessment after inspecting the pair's content.

A true lapse is a fair task whose actual displayed stimulus gives enough
information to reject the response, as with 实用 under “to be applicable.”
Do not judge against a more specific task the learner never saw. Stage one
finishes ordinary items itself: explanation, and contrast when the mix-up is
stable and teachable. Contrast remains a separate content space; coordinated
management of production cues is the reason to hand off to stage two.

An entanglement is a second known word that looked like an answer to the cue
as shown, including a gloss broad enough to cover both. Stage one hands off
the pair and the cue.

Stage two owns the cleanup, because it is the stage that sees both words'
cues and any shared cues already in play. It has three endings:

- A real slot: publish or extend the pure cue, and adjust each word's own
  cues.
- No slot: keep the per-word drafts and retire misleading cues, with no pure
  cue. The motivating 遭到 / 遭受 cleanup belongs here. This means no useful
  shared exercise has been established for this cleanup, not a claim that the
  words cannot overlap in any possible context.
- Nothing to change: an explanation only. This remains the outcome when even
  the word plans are not worth making.

The “no slot” ending is a successful cleanup, not a disagreement with the
handoff.

Compensation is a separate judgment about the original exercise, not a
consequence of whether a shared slot is published. A broad or misleading cue
may have caused an unfair lapse even when the best repair is separate
word-owned cues. Conversely, finding a shared slot elsewhere does not prove
that the response answered the original stimulus fairly.

Preserve PR 256's unfair-cue repair principle: an accepted repair that installs
a fairer cue and judges the served exercise misleading or overloaded can
restore the originating lapse. Improving a fair exercise does not. Explanation
or retirement alone does not acquire an independent compensation effect.
Ordinary repairs without a second known word retain this path. Pair cleanup
must use the same source-action snapshot and restore-once mechanism, affecting
only the originating target's schedule and leaving attempt history unchanged.

## Coverage after cleanup

The expected no-slot outcome is useful word-specific cues, not words that
cannot be practiced individually. Failure to author a cue is not itself
evidence that production should be suppressed.

One existing behavior matters at the edge: retiring all targeted cues without
shared coverage can re-expose the dictionary-derived fallback, potentially
reintroducing the original ambiguity. Consider this when judging the resulting
repertoire, but do not add a new suppression policy or require proof of unique
targetability. The normal no-slot path authors natural word-specific cues;
remaining difficult cases can receive later manual remediation.

## Axis and reveal teaching

A later 怪 / 古怪 proposal declined to extend an existing 古怪 / 怪异 pure cue
because its axis note specifically contrasted the original pair. Its explanation
did not establish whether 怪 failed the actual stimulus or merely failed to fit
the wording of an immutable note.

The supplied axis note was a general strangeness description followed by a
comparison of 古怪 and 怪异; the stimulus was “describing someone or something
as unusually strange or odd.” The rejection did not establish a linguistic
mismatch. Member commentary must not become an exhaustive membership rule.

Add one compact `teachingNote` field for reveal-time guidance, edited
holistically. Keep `axisNote` focused on the shared expressive purpose. When
extending membership, preserve stimulus and axis, judge the new member against
the stimulus, and revise teaching text for the resulting membership. Existing
teaching text serves as accumulated context, alongside member identities and
the incoming pair; no full lexical fetch for every member is required.

Retain exact served teaching snapshots and reject an extension if unseen
membership or teaching edits have changed its premise. This bounded teaching
update accompanies extension; it is not a general pure-cue editor. Extension
explanations should distinguish linguistic mismatch from an operation limit.

Existing mixed axis notes will receive separate operator/database cleanup once
the new field exists. Do not semantically migrate them or add legacy cleanup
instructions to the steady-state generation prompt.

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

Repairing or retiring already-published low-quality pure cues is also deferred.
Cleanup can create or extend a pure cue and update its teaching note, but cannot
revise its stimulus or axis note or retire it. Accidental low-quality publication is a
real recovery need to revisit, not something this cleanup already solves.
