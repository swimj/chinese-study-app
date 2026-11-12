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
distinct uses of that exact learning target and can evolve independently of
exercises. Uses in grammatical constructions can qualify; meanings realized only
through larger compounds or fixed expressions belong to those larger expressions.
The inventory can include uncommon, literary and technical uses, while default
selection chooses which normally deserve teaching and practice.

An established inventory with no eligible senses makes the word ineligible for
new sessions. Learners can keep it in their stash; its history and progress are
preserved. It cannot enter teaching, recognition or production, appear as an
accepted answer on a shared exercise, or participate as a contrast choice. This
restriction does not rewrite an already retained session. Learner explanations
and customization for these words are outside the current interface.

Sense associations may be unresolved without establishing that a word has no
eligible uses; word-level study and content improvement remain available in that
case. Creating a new content version does not discard an established
identity-level association.

Exercises contain their own authored material, assessment, accepted answers,
word relationships, and serving role. Several exercises can explore the same
use. Teaching exercises belong exclusively to teaching and familiar priming;
the general practice pool excludes them. An introduction binds exact authored
teaching exercise versions so its repertoire remains coherent.

Generated direct production cues must omit accepted written answer forms.
Cloze validation permits those forms in visible context, including a repeat
of the word used in the blank. Authors should still choose blanks that offer
meaningful retrieval practice. Review and reassessment can correct weak cues.

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
different mode clears that preference. Direct choices apply to future sessions;
a newer external choice is preserved when an older session closes.

Scheduling supplies candidates to bounded session composition. A due date does
not promise exhaustive practice. Recognition has separate scheduling and does
not provide production coverage. Contrast selection has its own assessment and
schedule. Pure cues accept several words, have independent learner scheduling,
and do not award word progress to every accepted member.

For Practice and Maintain, the [pure-cue proxy policy](pure-cue-elicitation.md#production-coverage)
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
training in Practice and Maintain across dictionary baselines and authored cues.
It expresses a judgment about the value of practising that skill for the word:
even a good cue may not make the training useful. Recognition and contrast remain
independently eligible.
Changing mode, requesting refresh, or improving content does not clear suppression.
A suppressed word cannot qualify a pure cue for scheduling, but remains an accepted
answer when another eligible member qualifies that cue. The initial vocabulary
UI and reflection proposal contracts do not create or reverse suppression;
existing suppression records remain effective under these semantics.

An explicit empty shared default sense selection also makes individual-word
production ineligible in Practice and Maintain for all learners, including
dictionary fallback and authored exercises. Unknown defaults retain legacy
eligibility. Recognition, contrast, and pure cues have their own eligibility.

New teaching and Solidify practise both recognition and production, regardless of
review skill enablement or suppression. Review settings are preserved for later
Practice/Maintain sessions. Previously retained sessions keep their recorded
recall requirements.

## Live session and completion

The daily new-word limit resets at 4:00 a.m. in the browser's local time zone.
Completed teaching counts against that local study day; an introduction shown
without completing its recall requirements does not. Other scheduling and usage
reporting retain their own UTC-day policies.

Teaching preparation runs ahead of admission and retains failed work for retry
and operator recovery. Preparation refresh preserves historical artifacts, established sense
identities and learner progress. Ordinary learner-triggered general-practice
preparation becomes eligible when teaching completion commits at session closure.
Operator-authorized repertoire preparation can proceed independently of teaching.
Newly ready material can enter a subsequent session, including on the same day.
Existing active shared
authored repertoire satisfies automatic general-practice demand across learners;
another learner's teaching does not authorize duplicate repertoire generation.
Teaching readiness remains independent of repertoire readiness.

New-word admission consumes a background-maintained reserve. Stash and diet
planning choose reserve membership; readiness is a best-effort hint rather than a
content-version guarantee. Moving a word to top admits it immediately, including
when automatic daily intake is zero. The reserve holds at most 40 words; newest
top choices displace fallback members, then the oldest top choices. Existing
content, jobs and failure evidence survive eviction.

Preview and Start greedily take usable ready top members, then other ready
reserve members, within remaining daily quota and session capacity. Fewer or zero
new words is acceptable. Neither path plans, repairs, queues or wakes preparation.
Current usable teaching is resolved at composition, preferring the latest
published update while preserving coherent exercise bindings, and then frozen.
A stale hint is skipped and recorded for operator investigation; other ready work
remains available. Ordinary review and Solidify do not depend on reserve capacity.

Start freezes a session payload: admitted words and starting states, eligible
content versions, teaching repertoires, answer criteria, and reveal/source facts.
The player chooses dynamically within that payload as the learner answers,
skips, asks for More, or undoes an action. Teaching completion can move an
Unstudied word to Solidify within the session; other automatic promotion applies
at closure. Composition does not
prescribe a fixed sequence. Publication, edits, retirement, content deactivation,
and external skill/proxy changes affect subsequent sessions. Account and private
content access checks remain live.

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

Clean, unassisted Practice/Maintain recall earns spacing credit for retention
beyond the previous scheduled interval. The next interval multiplies the previous
interval plus half of the additional elapsed time by the existing ease factor.
Credit belongs only to the exercised word skill. Early reviews and missing study
history receive ordinary interval growth; mistakes retain the lapse policy.
Solidify and independent pure-cue scheduling retain their own policies.

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
result before the learner continues. After a correct written production answer
is shown, the learner can mark that attempt wrong. The submitted characters
still match an accepted written form. The attempt counts as a production failure
for streaks, reinforcement, coverage, and scheduling. The entire encounter,
including its reactions and comments, is excluded from
post-session lesson and content-review triggers and model inputs, even when
another encounter for the same word or exercise merits review. It remains in
history and scheduling evidence and cannot be judged an unfair written
rejection. A typed answer outside the accepted forms remains a
written failure and keeps the existing feedback path. Continuing without the
mark records an ordinary success. Undo before saving restores the typed answer.
Undo after saving withdraws the latest committed transition.

The answer reveal shows the exercise's mapped sense when one is available,
with lexical meaning as the fallback. It retains pronunciation, authored usage
notes and explanations. Cloze reveals stay tied to the answered prompt: show its
mapped sense or lexical meaning, and a translation only when linked to the
completed cloze. A correct pure-cue response fills the blank with the learner's
accepted input, preserving their choice among accepted members. A pronunciation
rejection of a matching written form keeps that same input in the blank. Cloze reveals
do not introduce a different example sentence. Other eligible reveals retain source examples. A Word reference
disclosure exposes the full retained teaching source. A written production failure shows
the learner's submitted answer alongside the expected answer. A matching written
form that the learner marked wrong shows the accepted answer and that pronunciation
failure, without presenting the characters as a written miss. Personal notes
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
Mode changes are available in a successfully closed session summary and the
Words panel, affecting future sessions. Active sessions and pending or failed
completion summaries keep their established modes and deterministic transitions.
Resetting a word to Unstudied defers fresh teaching to a subsequent session; an
explicit forward mode choice does not fabricate teaching completion.

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

While wrap-up work is active, the learner can explicitly return to ordinary
all-due session behavior. This preserves answers, coverage and the current work,
and restores selection of unstarted work from the session's existing composition.
It changes the session's finishing choice, not any word's learning mode. Once
wrap-up reaches the summary, the completion cancellation rules below apply;
durably closed sessions cannot be reopened.

The summary has a 15-second cancellation window. Returning to study cancels that
completion and resumes with the same observations. Undo cancels completion and
reverses the latest supported learner interaction, including its automatic
companion actions, while retaining historical observations.
Closing applies learner effects once and makes the completed session available
for post-session processing. A failed close remains retryable without duplicate effects.
Successful closure enables summary mode choices as new learner-state commands.
They preserve the completed session evidence and effects. Pending or failed
closure leaves those choices disabled, independently of the elapsed countdown.

The summary distinguishes newly studied words, words leaving Solidify, other
covered words, and words left for another session. Each word retains its
pronunciation, meaning, learning-mode choice, and any exceptional outcome. Elapsed
study time excludes time spent away from the active session. Successful closure
returns the learner to Home unless they choose “Keep summary open”. Keeping the
summary open does not extend the Undo deadline.
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

Exercise-improvement selection follows the same effective-evidence rule for
general production. An undone response does not open an improvement case and is
omitted from its stored encounters; a later effective rejection, comment,
negative reaction, or skip for that exercise still can. Presentation-undone
encounters are excluded. Teaching issues enter a manual inbox paired
with the introduction and repertoire; automated exercise improvement does not
repair them. Connections can reuse encountered vocabulary through
its existing independent background workflow.

The separate learner-feedback judgment can reverse a written lapse once per
session and affected production schedule. Every effective rejection for that
word's production skill or independent pure cue must be judged unfair. A genuine
miss or pronunciation lapse in the same group keeps the lapse in effect.
Coverage must have produced a scheduling effect in the originating session.

The correction restores the pre-lapse interval, ease, and scheduling clock.
A previously strong pure cue also regains its strong status and progress.
Production pauses for 24 hours from the judgment. A regular word then follows
its ordinary eligibility and review ranking. A pure cue gets a required
recheck that takes priority over routine review, including strong-cue sampling.
An independent reset constraint can extend the pause. The next completed
assessment uses the restored interval and ordinary recall rules. Another unfair lapse starts a fresh
break. The correction can replace scheduling changes from intervening study while
preserving its attempt history, the learner's explicit mode, and active
requested refresh. It grants no success credit. When the pre-lapse schedule is
unavailable, the existing schedule stays in place.

Reading the lesson and applying a content repair are separate from the scheduling
decision. Provider failure does not invalidate session completion.

### Content repair boundaries

An operator can reconcile divergent teaching and canonical sense views without
forcing a linguistic judgment to wait for implementation support. Saving a resolved
decision does not itself change live content. The application preview accounts for
affected teaching and practice, identifies missing operations, and permits apply
only when all required consequences are supported. Required replacement content
may leave the affected word waiting while unrelated ready study remains available.
Already-composed sessions keep their captured material and completion semantics.
The [sense/content reconciliation contract](sense-content-reconciliation.md)
defines this workflow and its bounded first implementation.

A reported dictionary fallback with no authored general production practice in
its publication scope and owner automatically seeds a first repertoire proposal
from useful defaults, including defaults established during sense bootstrap.
That proposal applies without operator approval unless the source, inventory,
source mapping or word defaults changed after generation; a changed proposal
waits for ordinary operator review.
An explicitly empty selection makes no authoring request.
When authored practice already exists, including shared pure cues accepting the
word, saved useful defaults support an operator review of gaps in that practice.
The operator can request additional exercises for a selection initialized from
the defaults. This selection applies to one generation request. The resulting
proposal adds practice without retiring the fallback or other exercises.
An empty result leaves the case available for review. Authored exercises receive
local assessment of their intended use.
Prepared and reflection-proposed exercises use concise direct evocations and
contextual clozes chosen for the target's own lexical contribution, with optional
post-answer teaching. Reflection proposes content; application otherwise requires
operator approval. Ordinary preparation publishes through its bounded preparation policy.

For an authored single-word production exercise with an admitted intended sense,
one assessment owns a coherent exercise-local plan. It decides the original
cue's disposition, drafts useful shared practice when warranted, and proposes
target or response-word practice. A refinement develops a distinctive construction
or meaning within the originating circumstance, with that distinction available
through the cue itself. Enrichment adds optional practice surfaced during the
assessment or requested by the learner. Source revision preserves its identity,
answer contract, and learner controls. Retirement may coexist with optional
additional target practice. Target additions, including enrichment, inherit the
source exercise's mapped sense. Response-word additions create exercises only for
unambiguous lexical identities established from actual responses; they do not
reconcile the response word's repertoire or invent a sense association.

The exercise-local assessment decides whether shared practice is worthwhile and
what its members share. It nominates the intended answers, a candidate cue, and
a rationale identifying the shared expressive purpose. Integration realizes that
judgment through reuse, extension, or creation without a second pedagogical veto.
It owns the final shared stimulus, semantic axis, and teaching note; creation may
refine the candidate's presentation while preserving its intended meaning and all
proposed members. The axis describes a graspable expressive instinct rather than
the incidental details of an example scene.

Existing-cue lookup respects publication scope and owner. Reuse requires all
proposed candidates already to be members of a compatible cue. Different example
scenes can practice the same shared purpose, but every incoming and retained
member must naturally answer the actual destination stimulus. Extension preserves
its stimulus, axis, existing members and accepted forms while integrating its
accumulated teaching note. Notes are mostly English, with Chinese where useful.

A submitted form can become an answer in shared or individual practice only when
its dictionary identity is established. Before single-exercise assessment, a
form with multiple exact dictionary matches pauses for an operator to select an
entry. A form with no match remains encounter evidence without becoming an
authored answer. The identity choice belongs to that assessment and does not
itself propose or apply content. Earlier proposals remain available while an
assessment waits for a choice. The exercise-local assessment retains its
independent judgment about whether a source repair or shared practice is useful.
The operator can edit and select individual parts deliberately; optional local
clarifiers are not enforced prerequisites for shared practice. Enrichment meets
the same answer-fairness standard as repairs. The operator receives a
concise summary of the diagnosis and recommendation, with brief rationales for
individual additions. Private learner comments inform review without being
copied into shared authored content.
Content assessment does not change learner compensation or scheduling.

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

Operator routes (`/operator/<view>`) mount a separate workspace without learner
navigation, dashboard reads, attention polling, or session recovery. Returning
to study loads `/` as a new page; the operator shell does not preserve an in-memory
study session across that boundary. Operator API authorization remains required.

The operator's default surface is a cross-learner improvement-case inbox for
reviewing assessments and approving changes. Cases retain their creation order
through reassessment; judgments with and without proposals share the same review
identity. Normal cards are available from bounded queue batches, with full
evidence and authored editing data loaded on demand. Each entry leads with the served content
retained from the learner's encounters: the cue and accepted answers, in
encounter order. An encounter without a retained snapshot is labeled
unavailable. Diagnosis, current versus proposed learning content, and recipient
scope follow, and are visible before approval. When the entry has no retained
served snapshot, it states that the original served content is unavailable and
does not present current or proposed content as the original. Evidence and
manual editing are available on drill-in. Awaiting review includes teaching cases
without an assessment and completed judgments that need an operator decision.
Needs attention retains failed application, preparation and evidence-processing
work, unknown word defaults requiring intervention, and failed assessment jobs.
A failed reassessment appears in Needs attention while its earlier proposal or
judgment remains visible but locked in review. Moving between these surfaces preserves access to unresolved work;
queue reads neither resolve records nor authorize retries. Second opinions are retained,
advisory reviews bound to an exact proposal version; they do not replace edits
or authorize application. Operators can also request a fresh improvement
assessment of the current exercise version using a chosen model. If that version
differs from the original assessment's source version, the operator sees both
versions and must explicitly choose to proceed on the current version. Each
reassessment performs fresh sense mapping where applicable and fresh assessment,
including when the source version is unchanged. Each reassessment is a new
numbered holistic job inside the same review case. Reassessment freezes the saved proposal and case review state while queued, running,
waiting for response identity, or failed. Successful publication replaces the
current assessment; failure or timeout retains the lock until retry succeeds or
the operator abandons reassessment. Abandonment restores review of the previous
assessment and preserves the failed work as historical evidence. Earlier assessments and proposals remain historical evidence.
An assessment paused for response identity is not a completed teaching judgment:
it keeps any previous proposal locked and retains operator direction for its
continuation.
Only one case job may be queued or running; advisory second opinions do not
replace the authoritative assessment. Neither assessment result applies content
automatically. The original encounter group, responses, and reactions remain
historical evidence, distinct from the current source and proposed content.
An assessment automatically retries a model-output validation failure at most
three times. Its successful stages and exact review inputs remain retained.
After exhaustion, an operator can retry from Needs attention. Provider failures,
unknown outcomes, source conflicts, and lost publication authority do not use
this validation retry budget.

Operators can inspect supporting evidence and edit proposals before approval.
Dismissal and case closure accept an optional operator note, including teaching
and unresolved sense or promotion assessments. Known assessment findings and
source blockers remain system context; they do not become operator-authored notes.
Closure does not repair or reactivate content, establish a sense mapping, or
change reassessment eligibility.
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
