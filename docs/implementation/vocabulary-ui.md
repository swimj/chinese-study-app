# Vocabulary study UI

This guide describes the current vocabulary presentation and input behavior for
contributors tracing or changing the frontend. The [product contract](../../SPECS/vocabulary-learning.md)
owns learning promises; the [architecture contract](../../SPECS/vocabulary-architecture.md)
owns state and authority constraints. Layout, animation and key bindings here
are descriptions of the current interface.

## Controller and presentation boundary

`useVocabularyStudy` owns the request queue, effective session state and completion
transitions. `VocabularyStudy` adapts that state to `VocabularySessionViewProps`;
`src/features/vocabulary-ui/` renders cards, controls and the summary. Views emit
callbacks rather than infer coverage, scheduling, mode promotion or correctness.
The [frontend map](../../SPECS/frontend-architecture-map.md) traces the wiring.

The adapter supplies `visibleWord` only when safe to display. A concealed
production target is absent from headings, history, accessibility labels and
metadata. Independent pure cues need not have a single displayed word. All
controls use controller-supplied availability, including completion cancellation
and per-word summary mode choices.

## Teaching and answer reveal

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
Authored usage notes and explanations remain visible. Accepted pure-cue responses
fill the blank with the learner's accepted input, including immediate reveal and
replay of the acknowledged response.

### Personal notes

Personal notes use a separate current-learner lookup in the study response.
`VocabularyPersonalNotes` displays existing notes after reveal. Personal-note
creation and editing entry points are paused across learner study surfaces,
including the legacy notes button and keyboard shortcut, while the relationship
to words, exercises, and senses is being decided. Storage and the save endpoint
remain available; learner reactions remain editable. Notes are not frozen into
exercise content. Before reveal, the study surface conceals answer details and notes.

### Progress indicators

`session-presentation.tsx` derives progress chips from the effective projection:
teaching has a three-success streak for each direction; review and pure cues
have a three-success reinforcement streak after a mistake. The UI omits
single-success chip rows. The retained final card
and Undo use the same projection, so the chips reflect accepted evidence rather
than an extra local success counter.

### Introduction and warmup

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
sentence or replaying the introduction.

## Navigation and layout

The reading region and summary scroll within the available viewport; response
controls sit outside the reading region. Small panels can scroll the outer
surface when controls and readable content cannot fit together.

Continuation controls sit first in the card footer, including warmup reveals,
teaching steps, Next exercise, and Next word. More practice remains beside the
completed-word continuation. Desktop sessions reserve the covered-word rail before
the first word is covered, keeping card width stable. Recognition reserves space
for pronunciation before reveal without exposing the hidden reading in the DOM.

### Remaining work and covered words

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

## Keyboard and focus

The shortcut guide in the study UI lists the available keys. Shortcuts follow
controller availability; typing, IME composition, native button activation and
modal dialogs retain their own keyboard behavior. Space invokes the emphasized
reveal or continuation action. Recognition ratings save before advancing; save
retry preserves the departure until acknowledgement. Contrast supports numbered
selection followed by Enter confirmation.

Answer inputs take focus when they become enabled, including after motion or
Undo. Opening reactions leaves the comment field unfocused; Escape toggles focus
without closing the reaction panel. The Covered drawer restores focus to its
toggle on Escape. These interactions are exercised by the integrated browser
fixtures linked from the testing map.

## Completion presentation

`VocabularyCompletionPanel` follows the completion report layout: save status
and immediate actions precede counted word groups and elapsed study time. Groups
distinguish completed introductions, forward mode changes, other covered words,
and unfinished work. Lists longer than six words expand through native
disclosures; each word retains its meaning, pronunciation, learning-mode control,
and eligible practice or dismissal actions. App-generated feedback is read-only
when supplied to the panel; learner reactions are separate session evidence.

The controller supplies the backend completion deadline. Keeping the summary
open changes navigation, not the cancellation window or durable completion.
See the [session implementation](../vocabulary-learning.md#session-actions-and-completion)
for cancellation, restaging and retries.

## Words and feedback

### Word collections

My words uses the vocabulary collection adapter in `server/db/vocabulary-words.ts`.
Recently studied contains enrolled words outside Unstudied; it is not a
collection limited to a recent time window. Personally added uses current stash
membership. Current deck includes the union of explicit HSK decks with positive
weights and is unavailable for a mix containing Beyond HSK. Browsing an unenrolled
deck word does not enroll it; Add to study is explicit. Dismissed words are excluded.

Current vocabulary modes determine filtering and available word controls.
Last-study dates combine retained historical dates, schedule records and effective
responses from closed vocabulary sessions. Independent pure-cue responses do not
assign study dates to their accepted member words. Recent lapses uses rejected
effective responses in the last three UTC days, including bounded retained legacy
evidence; undone responses do not reappear as lapses. Search, pagination, private
notes and mode/refresh/removal commands use the current collection view.

### Feedback inbox

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

## Verification surfaces

The standalone `/tests/browser/vocabulary-ui.html` fixture provides simulated
states for layout and local interactions, including narrow panels, enlarged text
and long content. Its teaching text and completion rules are fixture inputs,
not an alternative learning policy. It makes no backend requests.

The [testing map](../testing.md) distinguishes this fixture from tests using the
real controller and disposable API-backed study. Standalone rendering does not
establish persistence, actual deadlines or integrated keyboard behavior. Retain
rendered evidence for the specific UI change being reviewed rather than treating
past fixture results as certification of the current interface.

### Operator sense coverage and reassessment

`ScopeCoverageEditor` lazily fetches explicit review/default selection and mapped
exercise counts. It keeps scope-edit buffers separate from proposal text and
operation toggles; unknown is distinct from explicit empty. Saves use scope CAS
versions. A successful word PUT remains successful even if refreshing the review
fails, with a separate recovery action for that read. While coverage edits or saves
are active, navigation and proposal/case resolution are blocked. Plain scope reads
allow navigation; unmounting cancels publication of their responses.

The review cache retains unrelated entries while invalidating the affected case
or word. Every invalidation advances an epoch; delayed prefetch/poll/load responses
can only populate that same epoch. Read-only `coverageChanged` snapshots expose
actual source, mapping and canonical catalog drift for service and operator
proposals, including explicit assessment evidence bases. Review/default edits do
not retarget captured generation scope or block content approval. See the
[content-improvement implementation](vocabulary-content-improvement.md#single-word-assessment)
for generation and evidence fences.
The editor invalidates metadata and preview caches after a policy save while
retaining proposal drafts, inclusion toggles and valid content approval. The current
review snapshot is fetched again without installing over those edit buffers. Scope
responses replace labels only for their word, preserving other proposal targets. Reassessment refreshes current source
metadata, confirms a version change, then updates only reassessment status; it
never installs a replacement proposal over unsaved text or selection toggles.

The failure response also projects failed default selectors whose shared word
selection is unknown. The word-level attention section reads those findings
independently of review cases or proposals. Its shared-only editor uses the same
scope writer without requiring a case; opening and closing it preserves the
proposal's edit buffers. A committed word selection removes the live finding and
invalidates metadata for that word. No additional acknowledgement state is stored.
