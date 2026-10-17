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

Shared content carries no authority to expose a learner's private history.
Privately imported content remains private. An exact encounter retains the
material, answer space, criteria, and mapping context actually served.

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

Scheduling supplies candidates to bounded session composition. A due date does
not promise exhaustive practice. Recognition has separate scheduling and does
not provide production coverage. Contrast selection has its own assessment and
schedule. Pure cues accept several words, have independent learner scheduling,
and do not award word progress to every accepted member.

Dismissal removes a word from study while retaining its history. Stash membership,
dismissal, and study mode are distinct. Re-adding a word or choosing a mode is an
explicit way to resume it. Existing production suppression and content
deactivation remain effective.

## Live session and completion

The learner can answer, skip an exercise, try another way, stop on a word, ask for
more, and give feedback. Controls depend on context; teaching retains its
all-or-nothing completion requirement. One correct general production response
ordinarily covers a word for the session. “Enough for today” also grants coverage
by learner choice; “Leave for today” stops work without granting coverage. Coverage
records doing enough for the day, not mastery. A wrong answer remains evidence
even when a later exercise succeeds.

Earlier-word controls allow extra practice while retaining coverage already
earned. “I’m satisfied” ends that extra practice and returns to the interrupted
word. Mode changes live in the session summary and Words panel. Resetting a word
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
responses and feedback for uncovered words. Incomplete teaching does not graduate;
unfinished practice does not receive covering credit.

The summary has a 15-second cancellation window. Returning to study cancels that
completion and resumes with the same observations. Undo cancels completion and
reverses the latest supported learner interaction, including its automatic
companion actions, by appending an undo record. Historical observations remain.
Closing applies learner effects and writes the completion, receipts, and queued
post-session work atomically. Repeated close requests apply no duplicate effects.
Changing mode in a pending summary cancels that revision and stages a new boundary.
Closed-session mode changes are new commands, not historical undo.

## Feedback, content repair, and authority

Post-session processing includes mistakes, explicit notes, dissatisfaction, and
skips, including those without a response. A withdrawn reaction remains in the
audit log but does not act as current negative feedback. Learner preference is
evidence, not an oracle of linguistic validity.

Learner lessons and internal content improvement run independently. Lessons are
read-only and can summarize a word across several encounters. An independent
pure cue has its own feedback subject. Teaching issues enter a manual inbox paired
with the introduction and repertoire; the general improvement model does not
repair them automatically. Connections can reuse encountered vocabulary through
its existing independent background workflow.

A designated teacher judgment may make a bounded automatic scheduling correction.
Reading the lesson and approving a content proposal are unrelated to that
correction. It applies once to current state and preserves explicit mode and
refresh choices. Provider failure does not invalidate session completion.

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
