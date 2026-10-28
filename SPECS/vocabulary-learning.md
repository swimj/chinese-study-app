# Adaptive vocabulary study

This contract defines the Mandarin learner experience, evidence, and authority.
The [implementation guide](../docs/vocabulary-learning.md) describes persistence,
workers, APIs, and release boundaries. The exploratory
[model whiteboard](../notes/active/2026-10-15-vocabulary-model-whiteboard.md)
retains the broader product direction; this contract covers the implemented first delivery.

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

New-word preparation maintains a stable reserve of twice the configured daily
new-word limit, capped at 40 candidates. The reserve follows stash, priority and
diet policy and prepares lexical bootstrap, introductions and their teaching
exercises ahead of admission. Failed preparation retains its candidate slot;
repeated visits do not expand speculative work. Completed or dismissed words
leave the reserve, allowing replenishment even when today's intake is exhausted.
A deliberate preparation compatibility boundary applies to new teaching. When an
Unstudied candidate enters the reserve, incompatible bootstrap and teaching
material refresh lazily. Prompt or model revisions alone do not invalidate it.
Historical artifacts, sense identities and learner progress remain intact.
Already learned words keep their banked material and grow through improvement;
shared additions prepared for another learner may appear in their future sessions.
General practice is queued only when teaching completion commits at session
closure. Ready material can enter a fresh session the same day; it never joins
an already running session.

Start freezes a session payload: admitted words and starting states, eligible
content versions, teaching repertoires, answer criteria, and reveal/source facts.
The player chooses dynamically within that payload as the learner answers,
skips, changes modes, asks for More, or undoes an action. Composition does not
prescribe a fixed sequence. Publication, edits, retirement, content deactivation,
and external skill/proxy changes affect subsequent sessions. Account and private
content access checks remain live. A reset to Unstudied still defers teaching.

The backend may operate the live player. Ordinary actions use retained session
material and indexed session/access reads, without rediscovering content or
scanning active sessions. Events are persisted incrementally; server-side state
is derived from the retained payload and log. Exact encounter retention records
what the dynamic player actually showed within that frozen composition.

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

Introductions preserve the progressive teaching walkthrough, back-navigation,
and recap. Teaching sentences highlight the taught word with its pronunciation;
other reliably aligned readings appear on hover or keyboard focus, without a
separate sentence-pinyin line. They do not offer exercise-level Skip; a learner can stop work on the
whole unstudied word from the footer without claiming teaching completion.

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
accepted input, preserving their choice among accepted members. They do not introduce a different example sentence. Other
eligible reveals retain source examples. A Word reference
disclosure exposes the full retained teaching source. Rejected production shows
the learner's submitted answer alongside the expected answer. Personal notes
are visible after reveal and reflect the learner's current notes rather than
the frozen exercise. Creating and editing personal notes is paused while their
relationship to words, exercises, and senses is being decided. Learner reactions
remain editable. Concealed answers and personal notes are absent
before reveal.

Progress indicators show multi-success requirements: separate recognition and
production streaks during teaching, and reinforcement streaks after a practice
mistake. Single-success requirements do not display a lone numbered chip.
Undo updates these indicators from effective evidence. Coverage by “Enough for
today” does not fill recall-success indicators.

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

Interactions are sent incrementally with stable retry identities. The backend
acknowledges an ordered log and stores exact encounter evidence. Finalization
flushes outstanding work and freezes an acknowledged boundary. A failed save
remains retryable; it is not presented as completed progress. This delivery does
not restore an interrupted active session or maintain a durable browser outbox.

“Finish for now” stops admission and wraps up open work. It reveals “Finish
immediately,” which explains that unfinished words remain due. Both paths retain
responses and reactions for uncovered words. Incomplete teaching does not graduate;
unfinished practice does not receive covering credit.

The summary has a 15-second cancellation window. Returning to study cancels that
completion and resumes with the same observations. Undo cancels completion and
reverses the latest supported learner interaction, including its automatic
companion actions, by appending an undo record. Historical observations remain.
Closing applies learner effects and writes the completion, receipts, and queued
post-session work atomically. Repeated close requests apply no duplicate effects.
Changing mode in a pending summary cancels that revision and stages a new boundary.
Closed-session mode changes are new commands, not historical undo.

The summary presents immediate actions before its counted word groups: new
words studied (“Today’s new words”), words leaving Solidify (“Words solidified”), other covered words, and
words left for another session. Each word retains its pronunciation, meaning,
learning-mode choice, and any exceptional outcome; routine completion text is
not repeated under each word. Longer groups use expandable lists. Elapsed
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
pure cue has its own feedback subject. A lesson prioritizes a concise, useful
language takeaway. Discussion of the exercise or its fairness is optional and
serves that teaching purpose; internal judgments need not be narrated to the
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

A dictionary cue spanning distinct uses can be replaced by a general-practice
repertoire. Reflection and ordinary preparation share the general-exercise
authoring contract: concise direct evocations and contextual clozes chosen for
the target's own lexical contribution, with optional post-answer teaching.
Reflection retains its selected model and supplies the established sense
inventory. Its response adapter creates a proposal that replaces the source cue
and adds the remaining exercises; application requires operator approval.
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

The operator's default surface is a cross-learner proposal inbox for scanning
suggestions and approving changes. Current versus proposed learning content and
recipient scope are visible before approval; evidence and manual editing are
available on drill-in. Operational failures and unresolved cases are separate
from ready suggestions. Second opinions are retained, advisory reviews bound to
an exact proposal version; they do not replace edits or authorize application.

Review cards prioritize the item, judgment and proposed content. One Details
disclosure contains supporting evidence, processing metadata and optional notes.
Dismissal and closing a completed no-change review accept an optional reason;
teaching and unresolved sense or promotion assessments require a resolution.
Archive defaults to all proposals and no-change reviews resolved in the last
12 hours. Search covers all retained resolutions, including older entries.
Queue navigation preserves the selected item while moving among operator views.
Arrow keys move between items outside text fields and native controls.
Background list refresh preserves the selection, draft and exact reviewed version.

Shared content changes require operator review. Preview validates the exact
proposal version, source bases, effect scope, and resulting content. Approval
binds that version; application rechecks it and records an idempotent receipt.
The operator chooses whether to update an identity or replace and retire it.
Learner schedules, deactivations, and teaching bindings refer to identities;
replacement does not silently transfer those relationships. Related teaching
repairs can be applied together with an explicitly rebound repertoire.

Service-owned model calls retain source-learner attribution separately from
ownership. Provider input and output are untrusted and validated. Prompt versions,
exact retained requests/results, model settings, and content links support later
analysis without turning provenance into live dependency propagation.

Reflection model routing applies independently of the content-improvement
stages. Individual jobs use equal-probability selection among the three offered
arms (Luna, GLM, Sol), independent of accumulated spend. The size-weighted
batched policy remains separate. A job retains its selected model across stages
and retries.
Preparation failures use bounded automatic retries before requiring operator
attention; an operator can begin another bounded cycle with prior attempts
retained. Neither retries nor model routing bypass publication checks or authorize
content application.

Learners can dismiss feedback lessons without deleting them or changing learning
state. Dismissed lessons remain accessible and restorable, and do not contribute
to unread attention. Only the owning learner can change this disposition.
