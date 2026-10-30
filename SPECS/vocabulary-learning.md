# Adaptive vocabulary study

This product contract defines the Mandarin learning model, learner-visible
behavior, and content-review authority. Its requirements describe intended
behavior independently of the current implementation. The
[architecture contract](vocabulary-architecture.md) defines state and consistency
constraints; the [implementation guide](../docs/vocabulary-learning.md) explains
their realization. Broader exploration is retained in the
[model whiteboard](../notes/active/2026-10-15-vocabulary-model-whiteboard.md).

## Words, uses, and exercises

A word has a stable identity and a hanzi/pinyin representation. Senses describe
uses of that word and can evolve independently of exercises. A learner ordinarily
studies a word's common uses. Sense associations may be unresolved; word-level
study and content improvement remain available. Creating a new content version
does not discard an established identity-level association.

Exercises contain their own authored material, assessment, accepted answers,
word relationships, and serving role. Several exercises can explore the same
use. Teaching exercises belong exclusively to teaching and familiar priming;
the general practice pool excludes them. An introduction binds exact authored
teaching exercise versions so its repertoire remains coherent.

Authored study content is shared in the current product, including corpus-based
dictionary fallbacks, bootstrap teaching, and generated practice repertoires.
Learner-private authored content remains a conceptual and storage capability;
the current product defines no private-content authoring feature. Legacy records
with private labels remain readable for compatibility and require an explicit,
source-bounded correction before their publication scope changes.

Learner encounters, reactions, personal notes and progress remain private. Shared
content carries no authority to expose that history. An exact encounter retains
the material, answer space, criteria, and mapping context actually served.

## Learner mode and selection

Production mode belongs to the learner–word relationship:

| Mode | Experience |
| --- | --- |
| Unstudied | Introduction and basic recognition/production exercises; teaching completes together in one session. |
| Solidify | Familiar priming followed by varied general exercises; ordinary covering is daily. |
| Practice | General exercises without compulsory priming, with spacing between sessions. |
| Maintain | Less frequent practice, preferring trusted approachable material. A temporary refresh changes scheduling without changing mode. |

Learners can change mode directly. A mode change preserves history and does not
reset the scheduler. Automatic promotion is a policy recommendation applied at
closure; the learner's explicit choice takes precedence. Initial automatic
promotion supports Solidify → Practice; entering Maintain is learner-driven.

Solidify recommends Practice after three consecutive clean covered Solidify
sessions: successful general recognition and production recall with no effective rejection.
Initial teaching does not count. Covered Solidify work waits until the next UTC
day for normal admission, while unfinished work remains eligible; extra practice
within a session does not add another qualifying session.

Explicitly choosing Solidify means staying there until the learner chooses to
move on. That choice persists across sessions and prevents further automatic
graduation, including when Solidify was already the current mode. Choosing a
different mode clears that preference. Pending session choices remain undoable
and become durable at finalization; a newer external choice is preserved.

Scheduling supplies candidates to bounded session composition. A due date does
not promise exhaustive practice. Recognition has separate scheduling and does
not provide production coverage. Contrast selection has its own assessment and
schedule. Pure cues accept several words, have independent learner scheduling,
and do not award word progress to every accepted member.

For Practice and Maintain, the [pure-cue proxy policy](pure-cue-elicitation.md)
also governs production admission. A word is **proxied** when active shared pure
content accepts it and no active shared general word-specific production cue
remains. Its production objective cannot enter through dictionary fallback,
including a previously materialized baseline or an enriched fallback supplement.
A usable private word-specific cue can still serve; recognition and contrast
remain independently eligible. Adding active shared targeted content removes
proxy coverage. Teaching and Solidify requirements are unchanged.

Proxy coverage derives from the shared repertoire, independently of pure-cue
adoption, due dates, sampling and learner deactivation. It neither changes word
schedules nor writes learner suppression. A pure cue not selected today does not
restore a proxied word's fallback. Preview and session admission apply the same
rule before allocating capacity.

Dismissal removes a word from study while retaining its history. Stash membership,
dismissal, and study mode are distinct. Re-adding a word or choosing a mode is an
explicit way to resume it. Existing content deactivation remains effective.

Production suppression is learner-specific and stops individual-word production
training across dictionary baselines and authored cues. It expresses a judgment
about the value of practising that skill for the word: even a good cue may not
make the training useful. Recognition and contrast remain independently eligible.
Changing mode, requesting refresh, or improving content does not clear suppression.
A suppressed word cannot qualify a pure cue for scheduling, but remains an accepted
answer when another eligible member qualifies that cue. The initial vocabulary
UI and reflection proposal contracts do not create or reverse suppression;
existing suppression records remain effective under these semantics.

Solidify practises only enabled skills. Completing those skills covers the word
for the day, but automatic graduation requires both recognition and production.
A word with neither skill enabled is omitted from ordinary Solidify admission.

## Live session and completion

The daily new-word limit resets at 4:00 a.m. in the browser's local time zone.
Completed teaching counts against that local study day; an introduction shown
without completing its recall requirements does not. Other scheduling and usage
reporting retain their own UTC-day policies.

Teaching preparation runs ahead of admission and retains failed work for retry
and operator recovery. Preparation refresh preserves historical artifacts, established sense
identities and learner progress. General practice becomes eligible for preparation
when teaching completion commits at session closure. Newly ready material can
enter a subsequent session, including on the same day.

Start freezes a session payload: admitted words and starting states, eligible
content versions, teaching repertoires, answer criteria, and reveal/source facts.
The player chooses dynamically within that payload as the learner answers,
skips, changes modes, asks for More, or undoes an action. Composition does not
prescribe a fixed sequence. Publication, edits, retirement, content deactivation,
and external skill/proxy changes affect subsequent sessions. Account and private
content access checks remain live. A reset to Unstudied still defers teaching.

### Exercise actions and coverage

The learner can answer, skip an exercise, try another way, stop on a word, ask for
more, and react to exercises. Controls depend on context. Ordinary completion
follows the mode's requirements:

| Mode | Within-session requirement |
| --- | --- |
| Unstudied | Introduction followed by three consecutive successes in each of recognition and production. A mistake resets only that skill's streak. Teaching completes together. |
| Solidify | Warmup followed by successful recognition and production. |
| Practice / Maintain | One selected due skill per word. A first correct response completes it; after a mistake, three consecutive successes complete reinforcement. |

“Enough for today” grants coverage by learner choice for learned words, without
inventing successful recall or satisfying clean-session graduation. Coverage
records doing enough for the day, not mastery. A wrong answer remains evidence
even when a later exercise succeeds. Pure cues complete independently using the
same first-success or post-mistake reinforcement rule as Practice.

Composition uses a shared 1,000-item limit and a 50/30/20 mix of Practice/Maintain,
Solidify, and Unstudied work, redistributing unused capacity. Practice/Maintain
select the most urgent eligible skill for each word; completing that work applies
a six-hour shared recency guard. Independent pure cues share the review portion
of the mix and interleave with ordinary word exercises.

### Teaching and answer reveal

Introductions preserve the progressive teaching walkthrough, back-navigation,
and recap. Teaching sentences highlight the taught word with its pronunciation;
other reliably aligned readings are accessible without obscuring the taught word.
Introductions do not offer exercise-level Skip; a learner can stop work on the
whole unstudied word without claiming teaching completion.

Exercises interleave across words, including teaching exercises. An introduction
or Solidify warmup does not require the next exercise to target that same word.
A Solidify warmup shows one familiar Chinese example, followed by an explicit
sequence of cumulative reveals: target contrast and pronunciation, sentence
translation, then sense. Each Space press or Reveal activation advances one beat;
a missing translation is skipped. Continue follows the final reveal. It does not
replay the introduction, assess correctness, or award recall credit.
Recognition ratings advance immediately after saving; production reveals its
result before the learner continues.

The answer reveal shows the exercise's mapped sense when one is available,
with lexical meaning as the fallback. It retains pronunciation, authored usage
notes and explanations. Cloze reveals stay tied to the answered prompt: show its
mapped sense or lexical meaning, and a translation only when linked to the
completed cloze. A correct pure-cue response fills the blank with the learner's
accepted input, preserving their choice among accepted members. Cloze reveals
do not introduce a different example sentence. Other eligible reveals retain source examples. A Word reference
disclosure exposes the full retained teaching source. Rejected production shows
the learner's submitted answer alongside the expected answer. Personal notes
are visible after reveal and reflect the learner's current notes rather than
the frozen exercise. Creating and editing personal notes is paused while their
relationship to words, exercises, and senses is being decided. Learner reactions
remain editable. Concealed answers and personal notes are absent
before reveal.

Progress indicators show multi-success requirements: separate recognition and
production streaks during teaching, and reinforcement streaks after a practice
mistake. Undo updates these indicators from effective evidence. Coverage by “Enough for
today” does not fill recall-success indicators.

### Continuing and revisiting work

Before answer reveal, “Try another way” puts the word back into the session queue and excludes the
current exercise identity for the rest of that session, including later versions
and explicit revisits. Undo reverses the exclusion. This control is unavailable
for teaching and recognition. Correct answers do not offer Skip. Continuing after
a wrong answer rotates onward without excluding the failed exercise, which may
return later. Ordinary exercise skipping does not impose that
exclusion. If no eligible exercise remains, the word stays unfinished without
new coverage and the session continues with other work.

The “Covered in this session” rail contains only words with session coverage;
a correct response that leaves a word's requirements unfinished does not add it.
Selecting a covered word shuffles it back into the normal session queue for extra
practice, retaining earned coverage and the current exercise and typed response.
Already queued words cannot be added again. Undo reverses the queue request.
“I’m satisfied” ends that extra practice and returns to the session queue.
Finish for now includes explicitly queued extra practice among the work to finish;
Finish immediately can leave that extra practice unfinished while retaining coverage.
Mode changes live in the session summary and Words panel. Resetting a word
to Unstudied defers fresh teaching to a subsequent session; an explicit forward
mode choice does not fabricate teaching completion.

Model calls never block the live flow. Background generation is best effort;
ready material and explicit continuation choices carry the session when it is
unavailable. Local answer checking uses the served answer space. A teacher
judgment can later assess whether the check was fair.

### Saving and completion

Study progress is acknowledged before it is presented as durably saved. Failed
saves remain retryable. Active sessions survive navigation within the mounted
application; recovery of an active session after reload is unsupported. Pending
completion remains recoverable independently of the active study screen.

“Finish for now” stops admission and wraps up open work. It reveals “Finish
immediately,” which explains that unfinished words remain due. Both paths retain
responses and reactions for uncovered words. Incomplete teaching does not graduate;
unfinished practice does not receive covering credit.

The summary has a 15-second cancellation window. Returning to study cancels that
completion and resumes with the same observations. Undo cancels completion and
reverses the latest supported learner interaction, including its automatic
companion actions, while retaining historical observations.
Closing applies learner effects once and makes the completed session available
for post-session processing. A failed close remains retryable without duplicate effects.
Changing mode in a pending summary cancels that revision and stages a new boundary.
Closed-session mode changes are new commands, not historical undo.

The summary distinguishes newly studied words, words leaving Solidify, other
covered words, and words left for another session. Each word retains its
pronunciation, meaning, learning-mode choice, and any exceptional outcome. Elapsed
study time excludes time spent away from the active session. Successful closure
returns the learner to Home unless they choose “Keep summary open” or perform a
summary edit. Keeping the summary open does not extend the Undo deadline.
Saving failures keep the summary available with an explicit retry.

## Reactions, feedback, content repair, and authority

A **reaction** is learner input about an exercise, including helpfulness ratings
and comments. **Feedback** is the app's teaching response to the learner. Exercise
assessment considers reactions alongside its own quality principles; those
principles are not exhaustive. A learner's experience can reveal an unanticipated
problem while their explanation or proposed remedy remains open to challenge.
Personal fit may warrant another option without condemning the original exercise.

Post-session processing includes mistakes, explicit notes, dissatisfaction, and
skips, including those without a response. A withdrawn reaction remains in the
audit log but does not act as current negative reaction. Learner preference is
evidence, not an oracle of linguistic validity.

Learner lessons and internal content improvement run independently. Only general
production encounters are eligible for provider jobs. Recognition and contrast
remain fully recorded in session evidence but produce no provider calls and are
excluded from word-level feedback aggregation. Lessons are read-only and can
summarize a word across eligible encounters. An independent
pure cue has its own feedback subject. Lesson selection uses effective
evidence. Undo keeps the original response in the session log and withdraws it
from that selection: an undone response does not create a lesson and is omitted
from the lesson. A later effective rejection or comment for the same word or
pure cue still creates a lesson from the evidence that remains effective. A
lesson prioritizes a concise, useful language takeaway. Discussion of the
exercise or its fairness is optional and serves that teaching purpose; internal
judgments need not be narrated to the
learner. The lesson must still agree with those judgments and avoid implying an
answer was wrong under constraints the learner could not see.

Teaching issues enter a manual inbox paired
with the introduction and repertoire; automated exercise improvement does not
repair them. Connections can reuse encountered vocabulary through
its existing independent background workflow.

A designated teacher judgment may make a bounded automatic scheduling correction.
Reading the lesson and approving a content proposal are unrelated to that
correction. It applies once to current state and preserves explicit mode and
refresh choices. Provider failure does not invalidate session completion.

### Content repair boundaries

A dictionary cue spanning distinct uses can be replaced by a general-practice
repertoire. Prepared and reflection-proposed exercises use concise direct
evocations and contextual clozes chosen for the target's own lexical contribution,
with optional post-answer teaching. A reflection repertoire proposal replaces the
source cue and adds the remaining exercises; application requires operator approval.
Ordinary preparation publishes validated exercises through its preparation policy.

For a single-word production exercise with an admitted intended sense, local
improvement and a shared-practice referral are independently optional. Local
edits preserve that exercise's answer contract. Referral written forms are
advisory; membership requires unambiguous lexical identities and a useful shared
expressive purpose in the visible construction. Missing or ambiguous identities
require operator attention. The subsequent assessment may reject the opportunity,
reuse a suitable pure cue, extend an existing one, or propose a new cue. Existing
cue lookup respects the source's publication scope and owner. Extension preserves
the cue's stimulus, reveal axis, all existing members and their accepted forms,
while updating its full accumulated teaching note. Creation also supplies a
complete note. Notes are mostly English, using Chinese where helpful to
illustrate the language point without manufacturing sharp pairwise distinctions.
Creation and extension join local edits in a manually reviewed proposal; neither
referral nor assessment publishes content. Private learner comments inform review
without being copied into shared authored content. Shared-practice assessment
does not reconcile individual word repertoires or change learner compensation
or scheduling.

An existing pure cue receives a separate content assessment of its established
shared task. It may extend membership using unambiguous lexical IDs from actual
effective rejected responses, repair its stimulus, or propose no change. Missing
or ambiguous identities remain useful linguistic evidence without authorizing an
invented member ID. Extension preserves the stimulus, axis and existing answers
and integrates all members into a full updated teaching note. Repair preserves
the axis, members and note. Comments and no-answer encounters can justify repair
without a new comparison word. These proposals remain separate from learner
feedback and require manual application; they do not reconcile individual word
exercise collections.

### Operator review

The operator's default surface is a cross-learner proposal inbox for scanning
suggestions and approving changes. Each entry leads with the served content
retained from the learner's encounters: the cue and accepted answers, in
encounter order. An encounter without a retained snapshot is labeled
unavailable. Diagnosis, current versus proposed learning content, and recipient
scope follow, and are visible before approval. When the entry has no retained
served snapshot, it states that the original served content is unavailable and
does not present current or proposed content as the original. Evidence and
manual editing are available on drill-in. Operational failures and unresolved
cases are separate from ready suggestions. Second opinions are retained,
advisory reviews bound to an exact proposal version; they do not replace edits
or authorize application. Operators can also request a fresh improvement
assessment of the current exercise version using a chosen model. If that version
differs from the original assessment's source version, the operator sees both
versions and must explicitly choose to proceed on the current version. Each
reassessment performs fresh sense mapping where applicable and fresh assessment,
including when the source version is unchanged. It produces a separate review
item and does not resolve or apply the original proposal or judgment. The
original encounter remains historical context; reassessment evaluates the authored
exercise independently of the original learner response or reaction.

Operators can inspect supporting evidence and edit proposals before approval.
Dismissal and closing a completed no-change review accept an optional reason;
teaching and unresolved sense or promotion assessments require a resolution.
Resolved proposals and reviews remain searchable. Navigation and background
refresh preserve the selection, unsaved draft, and exact reviewed version.
The [operator guide](../docs/operator-panel.md#content-improvement-workflow)
describes the current queue and archive interface.

Content-repair proposals require operator review. The review display shows the
saved proposal and relevant source content. Approve and apply authorizes the exact
saved version. The interface advances after the backend persists that request;
acknowledgement means queued, not applied. Background work validates the proposal
version, source bases, effect scope, and resulting content, records the matching
operator approval, and applies it with an idempotent receipt. Validation or
application failures appear in Needs attention. A changed draft or stale source
cannot receive application under the earlier authorization.
The operator chooses whether to update an identity or replace and retire it.
Learner schedules, deactivations, and teaching bindings refer to identities;
replacement does not silently transfer those relationships. Related teaching
repairs can be applied together with an explicitly rebound repertoire.

Model processing preserves private evidence and attributable results under the
[architecture contract](vocabulary-architecture.md#generation-review-and-application-authority).
Failed preparation and review work expose recovery without bypassing content approval.

Learners can dismiss feedback lessons without deleting them or changing learning
state. Dismissed lessons remain accessible and restorable, and do not contribute
to unread attention. Only the owning learner can change this disposition.
