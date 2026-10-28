# Vocabulary learning implementation

This guide explains the Mandarin vocabulary runtime and its operational boundary.
The [feature contract](../SPECS/vocabulary-learning.md) owns learner-visible
promises; the [first delivery plan](../notes/active/2026-10-16-vocabulary-first-deliverable-plan.md)
records the product rationale and conversion scope.

**Reactions** are learner input about exercises: helpfulness ratings, dissatisfaction,
and comments. **Feedback** is the app's read-only teaching response to the learner.
Improvement assesses reactions as evidence, including concerns beyond its stated
quality principles. It can reject mistaken claims or requested remedies, and a
personal preference can justify another option without making the original bad.

Application helpers and model inputs use reaction terminology. Protocol v1 keeps
the historical `feedback` action/command and payload field, the `feedback` and
`effectiveFeedback` fields in frozen encounter evidence, and the `learner_feedback`
storage table. These compatibility spellings preserve log replay and retry
identity; they represent reactions. The separate `learner_feedback` job and
`/api/vocabulary/feedback` routes produce and expose app-generated feedback.

## One study write path

```mermaid
flowchart LR
  UI[Study controls] --> Commands[Validated commands]
  Commands --> Log[Session actions and exact encounters]
  Log --> Projection[Session projection]
  Projection --> UI
  Log --> Closure[Completion boundary and atomic effects]
  Closure --> State[Learner modes and schedules]
  Closure --> Feedback[Private lessons]
  Closure --> Repair[Internal repair cases]
  Closure --> Connections[Connections queue]
  Repair --> Operator[Preview and manual approval]
  Operator --> Content[Current shared or private content]
  Content --> Start[Start freezes payload]
  Start --> Commands
```

`server/vocabulary/study.ts` freezes ready material at Start and turns trusted commands
into ordered actions. `src/domain/vocabulary-session.ts` derives the live state
and final report. `server/db/vocabulary-sessions.ts` enforces ownership, retry
identity, snapshots, completion fencing, and atomic learning effects. HTTP clients
cannot submit their own grades, arbitrary encounter snapshots, or learner IDs.

`useVocabularyStudy` retains its controller at the app level across navigation.
A volatile ordered queue sends interactions incrementally while reveal content
is visible. Failed work keeps the same client ID for retry; Next and finalization
wait for outstanding saves. Pending/failed completion is recoverable, while active
session restoration is outside this release. Cancellation and resume form a
single frontend transition so an automatic staging effect cannot race them.

## Retained session payload and hot-path work

The immutable `vocabulary_sessions.context_json` includes the versioned payload:
lexical facts, all mode-dependent exercise pools for admitted words, teaching and
priming material, selected pure cues, and complete encounter templates with
answer and reveal facts. The player selects dynamically within those pools as
the learner answers, skips, changes modes, requests More or undoes an action.
Teaching recognition rotates examples within its retained source. Publication,
edits, retirement, deactivation and external skill or proxy changes affect
subsequent sessions; admission to a new session does not guarantee an exercise
will be shown. Account and private-content access checks remain live. The current
card's personal notes remain a separate indexed learner lookup.

A connection-scoped cache holds at most 64 session runtimes, keyed by learner
and session. SQLite remains authoritative. Every access probes session ownership,
status and the latest indexed action sequence/identity. A mismatch, eviction or
new connection hydrates the immutable context and log once. Including action
identity detects rolled-back writes replaced at the same sequence. Cached values
are frozen so callers cannot mutate durable authority through shared references.

Ordinary appends validate the served version/access and response, write the log
and related evidence transactionally, then advance the projection using only new
actions. The next exercise is selected from the payload. Responses omit the
unserved repertoire. Existing sessions without a payload cannot continue study;
their evidence and completion records remain readable. This requires no schema
migration; active sessions are not carried through this upgrade.

This focused implementation still copies and scans in-memory session evidence
and returns full action/encounter history. Undo and completion replay the log;
a cold cache also replays once. These costs grow with session length. It removes
live content discovery and repeated database history reads, without claiming
constant total work for an indefinitely long session.

A local synthetic benchmark (one word, repeated Next, in-memory SQLite, five
samples per checkpoint) measured the retained limits below. This excludes HTTP,
authentication, disk latency and hosted contention; it is not a production SLA.

| Encounters / actions | Median Next | Median JSON serialization | Response size |
| --- | --- | --- | --- |
| 15 / 29 | 0.41 ms | 0.15 ms | 30 KB |
| 105 / 209 | 0.85 ms | 1.10 ms | 197 KB |
| 505 / 1009 | 1.42 ms | 5.21 ms | 940 KB |

Run `RUN_SESSION_BENCHMARK=1 node --import tsx --test --test-name-pattern='measure retained-session' tests/vocabulary-study.test.ts`
to repeat the experiment. Regression tests also inspect SQL to ensure warm
progression does not reload context/history or query live content pools, rather
than relying on timing thresholds that vary by machine.

See the [state ownership](diagrams/vocabulary-session-state.svg),
[transition work](diagrams/vocabulary-session-transitions.svg), and
[content improvement](diagrams/vocabulary-session-improvement.svg) diagrams.

## Content and learner persistence

`vocabulary-content.ts` owns complete current content and immutable full history,
including initial and current versions. Update preserves identity; replacement
creates a new identity and retires the predecessor atomically. Expected versions
reject stale changes. Session composition captures authored versions and current
identity-level sense mappings. Later serving uses that retained material.

`content_words` describes targets and contextual relationships. Accepted-answer
membership is separate; an answer word must also have a content relationship.
General selectors exclude teaching. Maintain prefers current curated versions;
a shared dictionary baseline is an explicit fallback when curated material is
unavailable, not a claim of curation. Its learner-independent identity is reused
across learners. Migrated legacy identities retain their original controls;
composition excludes duplicate stock fallback copies. Eligible authored word-specific
production excludes previously stored dictionary baselines from the composed
repertoire. Sense mapping and curation changes emit
transactional retained events.

`src/domain/production-proxy.ts` owns the shared proxy decision and the usable
targeted-cue exception. Both the legacy composer and vocabulary runtime invoke
that policy. Their adapters read different authoritative storage:
`server/db/pure-cues.ts` reads legacy publications, while
`server/vocabulary/production-coverage.ts` reads accepted-answer membership and
the current vocabulary targeted repertoire.
`review-selection.ts` applies it before objective ranking and session capacity;
`study.ts` also filters definition fallback when composing Practice or Maintain pools,
including baselines already stored as private content. A usable owned targeted
exercise remains eligible. Explicit prompt edits and replacements record authored
prompt provenance while retaining the dictionary source as ancestry; editing only
an explanation leaves fallback classification intact. This also applies to
single-improvement proposals that create an additional cue from a fallback.
The predicate reads current vocabulary content rather
than the retained legacy publication tables, so subsequent repairs affect it.
Pure-cue due dates and learner deactivation do not change shared proxy coverage.
The [selection contract](../SPECS/vocabulary-learning.md#learner-mode-and-selection)
defines its boundaries with suppression, recognition and Solidify.

`vocabulary-learners.ts` owns word modes, stash membership, dismissal, and separate
scheduler records. Mode changes preserve schedules. Recognition and contextual
selection retain their independent skill scheduling. Pure cues retain independent
learner schedules. Learner reactions do not implicitly deactivate an exercise.

My words reuses the existing collection browser and controller with vocabulary
mode and data adapters. Recently studied, personal words, current deck, search,
stage filters, recent lapses, pagination, private notes and study dates remain
available. Unenrolled deck words can be inspected without creating learner state;
Add to study is explicit. Mode, refresh and removal use vocabulary commands.
Current modes and dismissal take precedence over retained legacy state.

Session composition reads existing learner-owned production skill enablement and
relevance records. At composition, production relevance `suppressed` excludes
individual-word production, including authored exercises, despite the legacy command name
`suppress_definition_production`. This is the intended skill-level meaning in
the vocabulary runtime. Mode changes, refresh and content repair leave that flag
intact. Pure-cue adoption and selection require at least one unsuppressed eligible
member; other suppressed members remain accepted answers. Recognition and contrast
use their own eligibility. The initial vocabulary UI and operator proposals do
not expose suppression or its reversal.

Solidify freezes its enabled recognition/production directions in `solidifySkills`
when the session starts. Daily coverage requires that subset, and ordinary warmup
still uses the introduction. A single enabled direction can cover the day but
cannot qualify for automatic graduation; both disabled excludes the word from
admission. A later skill-setting change affects subsequent sessions, not the
active session's frozen directions or coverage requirements; see the
[retained payload](#retained-session-payload-and-hot-path-work).

Initial policies are deliberately simple: ordinary Solidify covering is daily,
Practice uses spacing and shortens after a lapse, Maintain receives temporary
refresh after a lapse. Three consecutive clean covered Solidify sessions recommend
Practice; initial teaching does not count. Clean means successful general recognition
and production recall, coverage, and no effective rejection. The recommendation is shown in the
summary and applied at finalization unless the learner chooses otherwise. Covered
Solidify work becomes eligible on the next UTC day; extra practice within the same
session does not add another qualifying session. Uncovered work remains eligible.

An explicit Solidify choice, including choosing the current mode, persists
`learner_words.automatic_promotion_paused`. That word stays in Solidify until the
learner manually changes mode. Choosing another mode clears the pause. Session
choices take effect at finalization and follow ordinary Undo/cancellation; direct
word-panel choices apply immediately. The pause is frozen into session context,
and a newer external choice takes precedence when an older session closes.
Automatic Maintain is disabled. Refresh gives a bounded three-day priority window.
These are versioned policy choices, not claims of measured mastery.

Session requirements preserve the established learning flow under the new modes:

| Existing flow | Vocabulary mode | Ordinary completion |
| --- | --- | --- |
| New | Unstudied / teaching | Introduction and three consecutive successes per skill, recognition and production. A rejection resets only that skill's streak. |
| Practice | Solidify | Warmup, then successful recognition and production. |
| Review | Practice (also used by Maintain) | One selected due skill per word; first success completes it, or three consecutive successes after a rejection. |

Explicit Enough also covers learned words without granting successful recall.
Teaching, recognition, production and Solidify
warmups rotate across words: the selector aims for two intervening presentations
before returning to a word, shortening the gap when fewer candidates remain.
New-word admission still respects the introduction composition settings; finishing
only selects already admitted work. The effective presentation log determines
rotation. The frozen context records each review word's `selectedSkill` and a
`reviewOrder` containing word and independent pure-cue entries. Pure cues interleave
with word exercises and use the same first-success / three-after-rejection rule;
their coverage never becomes word credit.

Composition retains the shared 1,000-item cap and 50/30/20 review/learning/new
bucket weights, mapped to Practice/Maintain, Solidify, and Unstudied. Unused bucket
capacity is redistributed. Review selects the most urgent eligible skill for each
word and updates only the exercised skill at closure. Completed review assessment
also applies the shared six-hour word recency guard, preventing another due skill
from immediately bringing that word back. Production lapses shorten its interval
to six hours; Maintain retains its temporary-refresh policy.

Home previews the same final admission plan as Start, counting each selected word
objective and independent pure cue once, rather than counting repeated exercises
or dictionary entries. The ready count remains visible in the compact Connections
view. Initial loading and settings changes refresh the preview; background
preparation polling retains the last usable count. Zero ready items offer Check
again. Preview and Start reconcile the stable teaching reserve through the
shared, idempotent preparation queue. Planning then reads readiness and existing cue schedules without creating sessions,
enrolling words, establishing senses, or adopting/updating cue schedules. Start
reuses the preview's sampling seed while creating its own fresh session identity;
intervening readiness, schedule, or settings changes can still change admission.

Home's active-time section shows Today and 3-/7-day averages from consecutive UTC
daily totals, including zero-activity days. Unmeasured sessions are disclosed and
never filled with estimated durations.

Before the answer is revealed, Try another way logs an `exercise_exclude` alongside the skipped encounter and
next presentation. Its content identity is excluded for the session, across
versions and manual revisits; Undo reverses the transition. Teaching and recognition
do not offer this control. Correct results offer continuation rather than Skip.
After a wrong answer, ordinary continuation rotates onward and leaves the failed
exercise available for a later retry; it does not exclude the exercise. Ordinary
Skip retains the possibility of a later retry.
When a learned word has no eligible remaining exercise, it is left unfinished
without new coverage; recognition is not repeated as a substitute for production.
Recognition self-ratings advance after saving, including successful save retries.
Production retains the answer reveal before continuation.

`vocabulary/reveal-snapshot.ts` freezes the exercise's answer words, mapped
sense descriptions, selected source reveal, and available full word reference
with each encounter. `VocabularyAnswer` renders those retained facts after the
answer is revealed: mapped sense labels take precedence over lexical meaning,
source-backed examples and usage explanations retain their authored structure,
and Word reference expands the full teaching source. Older encounters without
these fields use available lexical facts and their material's known reveal
fields. Rejected production also displays the submitted response; contrast
answers identify the selected and expected choices.

Cloze answer rendering uses the same blank parser as the prompt. This also
recognizes direct-text teaching clozes imported with a definition exercise type.
Those prompts do not acquire rotating bootstrap examples, and the renderer
omits them from older retained snapshots. Mapped senses and lexical fallback
remain available; a supplement translation is shown only when its example
sentence exactly matches a completed cloze line (after character conversion).
Authored usage notes and explanations remain visible.

Personal notes use a separate current-learner lookup in the study response.
`VocabularyPersonalNotes` displays existing notes after reveal. Personal-note
creation and editing entry points are paused across learner study surfaces,
including the legacy notes button and keyboard shortcut, while the relationship
to words, exercises, and senses is being decided. Storage and the save endpoint
remain available; learner reactions remain editable. Notes are not frozen into
exercise content. Before reveal, the study surface conceals answer details and notes.

`session-presentation.tsx` derives progress chips from the effective projection:
teaching has a three-success streak for each direction; review and pure cues
have a three-success reinforcement streak after a mistake. The UI omits
single-success chip rows. The retained final card
and Undo use the same projection, so the chips reflect accepted evidence rather
than an extra local success counter.

Introductions reuse the progressive teaching player: formatted teaching steps,
back-navigation, and a recap of the pinned source's uses and examples. Typed
teaching sentences and recap examples use the warmup's character ruby: target
readings stay visible, while other reliably aligned readings appear on hover or
keyboard focus. Uncertain alignment shows only target readings, and teaching
omits the separate sentence-pinyin row. Introduction
steps have no exercise-level Skip; stopping the whole unstudied word remains a
footer control. Teaching exercises still interleave with other words. Selection
balances use within each skill’s teaching pool; small pools may repeat identical
prompts to reach the required successes. Solidify warmup instead
uses a single familiar example with cumulative reveals: target contrast and
pronunciation, then sentence translation, then sense, then Continue. Space, Enter,
and the Reveal button each advance one beat; a missing translation skips its beat.
The first reveal emphasizes exact target occurrences and places the word pronunciation above them
with native character-level ruby text. The authored sentence pinyin is aligned
only when syllable boundaries and character counts match unambiguously. Target
readings stay visible after Reveal; other characters show readings on hover or
keyboard focus. Uncertain alignment retains the Pinyin disclosure. The sentence
translation comes first, then the word-prefixed example-linked sense (with lexical
meaning as fallback). An absent target keeps standalone word pronunciation. The warmup
records no assessment or recall success. The session chooses words and skills, not a
per-sense coverage plan.

`VocabularyWarmup` selects an example from the retained teaching source, or an
explicit authored example beat. Source-less material without an example falls
back to a word reminder with the same pronunciation and sense beats, rather than inventing a
sentence or replaying the introduction. The session reading region and summary
scroll within the available viewport; response controls remain
outside the reading region. Small panels may scroll the outer surface when the
controls and readable content cannot fit together.

Continuation controls sit first in the card footer, including warmup reveals,
teaching steps, Next exercise, and Next word. More practice remains beside the
completed-word continuation. Desktop sessions reserve the covered-word rail before
the first word is covered, keeping card width stable. Recognition reserves space
for pronunciation before reveal without exposing the hidden reading in the DOM.

The session bottom line counts remaining words and pure cues, rather than the
number of exercises or reinforcement repetitions. Open extra practice counts as
remaining work; deferred, skipped, and completed items do not. During wrap-up,
unstarted items are excluded. There is one remaining-work count, with no separate
mistake pile. Sidebar returns, Try another way, and mistake departures share a
slow tuck-behind motion (about 1.3 seconds). Sidebar returns animate a copy while
preserving the current card and input. Mistakes retain their immediate rattle;
their departure tucks back into the same stack. Reduced motion skips the movement.

Covered words sit in a scrollable “Covered in this session” rail. Narrow panels
expose it through a Covered drawer with the same count; Escape closes the drawer
and restores focus to its toggle. The recent-first list retains its scroll
position when new activity is added, and unrevealed production targets remain
concealed. Partial recall success does not add an uncovered word to the rail.
Available tiles show just the word; the accessible name retains the queue action.

Selecting a covered word sends `requeue`, which records the existing `word_more`
transition without serving another exercise. The current encounter and input
remain in place; ordinary selection later interleaves the reopened work. Queued
words have disabled queue actions. The same command identity retries once;
a second queue request for already open work returns a conflict. Undo reverses
the reopening while retaining coverage evidence. Extra practice remains open
until the learner ends it with “I’m satisfied” or leaves it. Finish for now waits
for that explicitly queued work, including requests made while finishing;
Finish immediately can end the session before extra practice is finished.

Keyboard controls follow the available action. Space reveals/continues; Enter
submits production; Shift+Enter records No clue. Escape toggles focus into or
out of the open reaction note; when that panel is closed, it toggles answer focus.
Recognition reveals pronunciation as ruby above each character when the authored
pinyin aligns safely, leaving the answer
panel for meaning and examples without an Answer heading or duplicate pronunciation.
Recognition uses 1 for Forgot and 2 or Space for Correct, with a brief visible
confirmation before advancing. Ratings save before card departure: an ongoing
correct answer moves left, a covered word moves right. A save retry retains that
departure after acknowledgement. Contrast choices use 1–9, then 0 for the tenth option, with Enter to
confirm the selected choice.
U (also Z) undoes, A tries another way, S skips an exercise, D covers for today,
M requests more practice, and F finishes for now. R opens reactions; [ and ] vote
Not helpful and Helpful. ? opens the shortcut guide. Teaching retains Space for
the next step, left arrow for the previous step, and Enter from the final recap.
Buttons show keycaps on hover or keyboard focus. Dark emphasis marks the action
mapped to Space; other actions use plain buttons. Answer inputs take focus once
when they appear and become enabled, including after card motion or Undo. Opening
reactions leaves the comment field unfocused; Escape blurs it without closing the
reaction panel. Typing, IME composition, native
button activation, and modal dialogs retain their own keyboard behavior.

Extra practice retains prior coverage and rejoins the ordinary queue when finished. Summary
mode edits cancel and restage pending completion; closed-session edits are new
learner commands. Unstudied defers fresh teaching to the next session.

`VocabularyCompletionPanel` follows the completion report layout: save status
and immediate actions precede counted word groups and elapsed study time. Groups
distinguish completed introductions, forward mode changes, other covered words,
and unfinished work. Lists longer than six words expand through native
disclosures; each word retains its meaning, pronunciation, learning-mode control,
and eligible practice or dismissal actions. App-generated feedback is read-only
when supplied to the panel; learner reactions are separate session evidence.

The controller closes the pending revision at its 15-second deadline and
returns to Home after successful closure. “Keep summary open” and summary edits
retain the report while finalization proceeds. Cancellation and Undo operate
only within the pending window; keeping the report open does not extend it.
Save failures preserve the report and expose retry. The controller records
active study duration across visibility and focus changes, freezing that value
at the acknowledged completion boundary.

## Background work and operator repair

`processing-worker.ts` closes due completions and ingests evidence even when
provider work is disabled. Learner-feedback and exercise-improvement jobs have
separate claims and outcomes. Teaching issues stay manual. Failed calls and
expired unknown outcomes require explicit retry, except for preparation dependencies
within their bounded automatic retry cycle; lease tokens fence late results.
Maintenance and disabled-learner checks protect dispatch and publication.

Individual reflection jobs select Luna, GLM, or Sol with equal probability,
regardless of how many encounters their evidence contains. The separate batched
policy retains GLM/Luna at 70/30 for up to ten items and Sol/GLM/Luna at 60/20/20
for larger bundles; vocabulary jobs do not currently batch unrelated cases. Selection is
retained across stages and retries. Accumulated spend does not restrict routing,
explicit model choices, or retries for learner feedback, improvements, or AI
second opinions. Practice and sense authoring keep their independently configured model.

`preparation-reserve.ts` maintains up to twice the configured daily new-word
limit (maximum 40), independent of the remaining intake today. It shares the
stash/diet admission planner, prefers existing members, and uses a stable reserve
seed. Preparation failure retains its slot; source, priority, quota and learner
lifecycle changes can change membership. The existing reserve tables and settings
triggers remain authoritative. Vocabulary add, enrollment, stash, dismissal, mode
and closure writes request reconciliation; the periodic word-preparation runtime
reconciles pending learners. Preview and Start also reconcile before composition.
Only bootstrap and teaching jobs are queued for reserve candidates.

Migration `0057_preparation_compatibility` records an explicit preparation epoch
on the shared preparation pointer; existing rows start at zero, with no eager
queueing. The current boundary is epoch 1. Reserve reconciliation clears old
source/package pointers and requeues bounded bootstrap/teaching work while
retaining artifact and attempt history. Active provider work defers refresh;
paused failures retain their operator retry boundary. Repeated reconciliation
does not reset the current cycle's failure budget. Imported teaching admission
requires the current source/package at a compatible epoch. Native vocabulary
introductions already use the current content contract.

Runtime publication preserves established or partial sense inventories and their
identities. Refreshed source uses have unresolved mappings until explicitly
mapped; no text-based identity merge is inferred. Cold words can establish their
initial inventory. Historical reviewed words are not scanned or regenerated;
existing material remains usable and shared improvements can enter later sessions.
This change requires the stopped-writer migration route, not an app-only upgrade.

Successful session closure queues general practice for completed teaching in the
same transaction as learning effects. Undo before closure and failed closure
create no practice demand. Queueing does not require configured credentials;
provider dispatch retains its configuration and hosted-control gates. The
vocabulary preparation worker consumes the durable practice queue without
scanning active session JSON. Live Next, command and read routes never wake
workers. Preview, Start, refresh and closure can schedule a wake after returning
the response. Publication supplies future session composition.
The shared teaching pipeline generates the introduction first, then exercises
conditioned on that delivered material. A failed companion call preserves the
successful introduction. No session waits for either workflow.

A wholly unprepared word therefore uses four authoring calls: lexical bootstrap,
introduction, teaching exercises, and the independent general-practice pool.
The first three establish a ready teaching repertoire; general practice is
prepared after committed teaching completion. These are shared artifacts, not
per-learner or per-session calls. The starting general v4 and teaching-exercise v2
briefs come from the retained [editorial trials](implementation/vocabulary-prompt-handoff.md).
Existing artifacts are reused; retry creates additional attributable attempts.

Learners read lessons in a Feedback inbox using the proposal inbox’s single-card
layout, subject/date header and previous/next pager. Lessons appear recent first;
only the displayed lesson is marked read. Queued, generating and failed feedback
occupy cards in the same queue, with retry on failed cards. Pending items refresh
automatically and retain selection when the lesson arrives. There is no secondary
rail or proposal editing, approval or application UI. Dismiss removes a lesson
from the active inbox without deleting it; Dismissed retains those lessons with
a restore action. Dismissal is learner-owned and does not affect scheduling or
content repair. Left/Right navigate cards and D dismisses the displayed active
lesson; typing, composition and modified keys retain their normal behavior.

Operators open `#operator-usage` and select **Content improvement**. The operator
panel is unlisted in learner navigation and protected by the existing allowlist.
For now, hosted operator access is restricted to the dogfood account. The
cross-learner inbox starts with proposals awaiting review. Previous and next controls
navigate one proposal at a time; applying or dismissing a proposal advances to
the next available item. Opening a proposal validates its saved version and shows current and proposed content, accepted
answers, and shared or learner-only scope. Changed answer criteria and retained
teaching are expanded in the comparison. Evidence, processing details, relationship
effects, and manual editing are available on drill-in; Archive and issues needing
attention have separate views.

“Approve and apply” records approval for the displayed version and applies it
with an idempotent receipt. Preview runs the real writers under rollback;
approval and application revalidate current bases. A failed application can be
retried without losing the approval or application key in the current view.
Manual edits create a new version and invalidate the previous preview and review.
Teaching repairs can update an exercise and explicitly bind its resulting version
in the same ordered proposal. Failed jobs and dispatches have explicit retry controls.

Case-backed exercise-improvement proposals can request a second opinion on the
exact saved proposal version, with an optional question. This is a fresh invocation
of the configured review model, retaining the proposal snapshot, source versions,
and learner evidence. Its support/revise/reject opinion is advisory: it neither
rewrites the proposal nor applies content. Earlier opinions remain labeled with
their proposal version after edits. Failed reviews require explicit retry; teaching
cases and standalone manual proposals do not yet support this review path.
Completed exercise judgments that propose no change also appear in Awaiting
review, including retained historical judgments. The operator can inspect the
served exercise and rationale, draft a correction from current content, request
an advisory second opinion with a question, or close the review with an optional reason.
The second opinion reviews the no-change judgment; it does not create or apply a
proposal. Closed reviews remain in Archive, with their retained jobs and results in the case evidence.

Single-word local improvement drafts wording changes and additional variants of
the supplied exercise while preserving its accepted-answer membership. Operators can
edit the full authored draft, including its answer relationships, before preview.
Automatic proposals for new contrast clusters or learner suppression are not
supplied by this adapter. Single-word admission can additionally propose pure-cue
creation or membership extension through the separate shared-practice assessment
below.

Single-word production improvement first establishes the word's sense inventory
and separately assesses the authored cue before attempting a sense association.
A defensible single sense admits a sense-specific local assessment with
independently optional local operations and a shared-practice referral. A gloss
laundry list spanning distinct senses automatically generates a fresh repertoire proposal: one replacement retires the laundry list
and additional exercises extend the pool, without retiring other cues. The
repertoire draws on the word's active inventory; the discarded list has no sense
association or requirement to preserve its old glosses. All content
application still requires operator approval. An uninterpretable exercise or an
apparent inventory gap for a single intended use stays in the operator inbox
with its mapping rationale;
neither triggers automatic repair or sense expansion. Operators can close these
findings after inspection. Learner feedback and compensation remain independent.
Existing pure cues use a dedicated standalone `pure-cue-improvement.md` call,
not the generic improvement fallback. Its input supplies complete original
content and current members, projected encounters, and lexical resolutions of
effective rejected responses. Missing or ambiguous lexical identities do not
remove raw-response evidence, but cannot authorize new member IDs. The result
is extension, stimulus repair, or explanation-only. Extension preserves the
stimulus, axis, current members and accepted forms while replacing the complete
teaching note; repair changes only the stimulus. The accumulated teaching note
integrates all members, mostly in English with Chinese where helpful. Both
changes require manual application and leave individual word repertoires alone.
The call uses prompt/schema version 1 and projection `vocabulary-admission.v1`,
retains invocation provenance and source/lexical fences, and does not use the
admission stage-result cache.

A referral supplies advisory written forms, a shared purpose, and rationale;
local operations retain their original answer contract. Raw responses can suggest
an alternative even without a resolved lexical record. `pure-cue-promotion.ts`
resolves the forms to lexical identities, using the source to disambiguate its own
target. Missing or ambiguous candidates remain an operator-attention finding.
Resolved candidates lead to a same-job assessment of active, overlapping pure
cues in the source's publication scope and owner. It can reject, reuse, extend,
or create. Extension preserves the existing prompt, reveal axis, all answer
members and their accepted forms; every added member must suit that same task.
Creation and extension author complete, mostly English teaching notes, preserving
useful accumulated nuance on extension. Creation authors a new shared-purpose
cue from resolved candidates. Both become operations alongside any local edits in one manual proposal; rejection and reuse
remain recorded assessments. Private reactions inform judgment without becoming
shared authored text. This stage does not reconcile the participating words'
exercise repertoires or change scheduling and compensation.

The standalone r5 `single-improvement.md` uses prompt version 3 and schema
version 2; mapping and repertoire retain prompt version 2 and schema version 1.
Promotion uses its own prompt/schema version 2 and projection
`vocabulary-admission.v1`. Admission stages retain and reuse
results by exact contract/input within the same job, with publication fences for
source and sense state and, for promotion, resolved identities and inspected cues.

Sense establishment reuses existing inventories or authored bootstrap uses before
requesting a sense-only generation call. It does not regenerate teaching or
practice content as a side effect. Mapping and generation retain evaluated source
versions and invocation provenance; publication is fenced against changed sources
and maintenance controls. A mapped sense explains authorial intent, not what the
learner was necessarily told by the original cue.
Failed practice preparation also appears here with its retained invocation and
attempt count after its automatic retry cycle is exhausted. Practice and sense
preparation make up to three attempts per cycle, retrying after 30 and 60 seconds.
Operator retry starts a new cycle while retaining earlier attempt provenance.
A provider-wide outage pauses new practice-worker dispatch for 60 seconds using
the shared preparation error classification. Per-job retry deadlines and budgets
remain intact; invalid generated content stays an item-local failure. Calls already
in flight may still publish if their ordinary control and lease checks pass.
Retries do not bypass provider-work or maintenance controls.

Automatic scheduling compensation is independent of content application. The
initial policy compensates general production and independent pure-cue scheduling,
delaying current eligibility by at most 24 hours when every effective rejection
within that scope was judged unfair. Word-scoped compensation also requires that
the word was covered in the original finalized session. Uncovered words retain
their scheduling eligibility, learner feedback, and content improvement work,
even if a later session covers the word. Recognition and contrast receive no
provider lessons, content-improvement calls, or automatic compensation. Their
full evidence remains in the session log, and their encounters are excluded
from mixed-word feedback aggregation. Mixed genuine/unfair production
mistakes retain the conservative schedule; unrelated skills do not veto production
compensation. Explicit mode and active learner-requested refresh choices are not
reversed; receipts prevent duplicate adjustment.

## Events and model provenance

`emitBackendEvent` accepts an event name and JSON data with optional identity,
actor, session, and causal context. Domain-change evidence is written inside the
same transaction as its effect. Retained rich records join through content,
encounter, invocation, case, proposal, and application identities.

The common provider transport retains exact request/response evidence, prompt
and schema metadata, settings, workflow attribution, timing, usage, and cost.
Service calls have explicit service ownership and optional source learner context.
Content/sense links point to the exact versions consumed or produced. Human edits
and imports retain their own origins. Missing legacy provenance stays unknown;
credentials and transport headers are not retained.

## Conversion and local verification

Migrations 0039–0048 introduce content/provenance, learner state, session evidence,
legacy import, internal reflection, authoring links, integrity guards, dismissal,
and Connections sources. Migrations 0049–0055 add sense readiness, improvement
admission, pure-cue promotion, promotion controls, second opinions, provider
retry/routing state, and feedback dismissal. Released migrations 0037/0038
remain unchanged ahead of this unreleased sequence. The migration runner refuses to copy learner state while
legacy completion or authorized reflection effects remain pending. Settle them
under the previous runtime; the failed migration rolls back. Preserve other old
records as history. Mandarin legacy session/proposal, introduction open/complete,
and content-editor write routes return a cutover conflict. Legacy session-payload
reads are also retired because they composed and reserved work. Historical editor
reads remain available; legacy application workers do not resume those writes.

The conversion makes no model calls. Existing learning → Solidify, review →
Practice; stash, scheduling values, scoped content, teaching history, and explicit
deactivations are retained. Unsupported empty answer spaces remain in their
original tables with an exclusion record. Sense associations can be enriched
incrementally. Import identity and source mappings make repeats safe without
overwriting subsequent authored improvements.

Use the [offline migration procedure](ops/schema-migrations.md). This release
cannot use app-only hosted upgrade. No hosted migration or deployment is implied
by passing tests or creating a review PR.

For a disposable, provider-disabled local fixture:

```sh
node --import tsx scripts/prepare-vocabulary-fixtures.ts --data-dir=/absolute/new/directory
```

The directory must not exist. It contains its own database, seed, and manifest.
The full fixture admits 12 words through normal session composition:

| Mode | Words | Starting scenario |
| --- | --- | --- |
| Teach | 藤椒、泡沫 | Prepared teaching, not yet completed |
| Solidify | 不堪 | 0 clean sessions |
| Solidify | 石沉大海 | 1 clean session |
| Solidify | 为所欲为 | 2 clean sessions; clean coverage recommends Practice |
| Solidify | 花卉 | 3 clean sessions; a previous-day explicit Solidify choice prevents automatic promotion |
| Practice | 报备、鼓舞、百分点、部署、馋、阐述 | Due today, with authored general exercises |

The five added Practice words and 花卉 each have three general exercises for
trying another way. Incidental seed words are scheduled outside this walkthrough.
The fixture records 花卉's synthetic prior session through actual finalization:
it first qualified for Practice, then the learner chose Solidify. The manifest
retains that session/completion and the expected progression for each Solidify word.
Provider work stays disabled; closure and persistence still run normally. A fresh
directory restores the starting scenarios without overwriting an earlier run.
For interactive UI review, default to a fresh fixture when bringing it back for
a new review round; reopening the previous run can leave only a few due items.
Preserve an in-progress run only when requested. Verify the Home preview shows
all 12 study items before handing the fixture back.

Start the backend with that directory, the printed learner, and seed; point Vite's
`VITE_API_BASE` at that API. The presentation fixture is
`/tests/browser/vocabulary-ui.html`, the operator fixture is
`/tests/browser/vocabulary-operator.html`, and the real-hook cancellation regression
fixture is `/tests/browser/vocabulary-controller.html` (also `?mode=undo`).
The prompt experiment harness retains offline inputs, outputs, variants, and
review notes; see [its handoff](implementation/vocabulary-prompt-handoff.md).
