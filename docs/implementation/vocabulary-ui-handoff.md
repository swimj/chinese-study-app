# Vocabulary UI integration

This file coordinates the presentational vocabulary UI with its session controller.
The UI lives in `src/features/vocabulary-ui/`; the preview fixture is
`/tests/browser/vocabulary-ui.html`. These components have no API or persistence
ownership. The parent implementation coordinates their integration.

## UI review status

Justin is happy with the current lab and has closed UI iteration for now. He
asked for these decisions to be handed back to the orchestrator. Automatic
approval review rejected the direct message despite that explicit request; this
shared document retains the handoff. The accepted/not-quite answer presentation
received positive feedback. The lab’s simplified teaching content is acceptable
for preview; production should use the actual teaching beat player.

## Current UI decisions from Justin’s lab feedback

- Live cards show mode as a plain label. Mode switching belongs at a session
  boundary; the preview exposes per-word choices in the summary. Exact command
  timing remains the coordinator’s integration responsibility.
- Justin confirmed two distinct early exits: **Enough for today** explicitly
  covers by learner choice; **Leave for today** stops while keeping an uncovered
  word due. This must not fabricate a correct response.
- The lab uses **one correct production exercise per word** as its default
  covering criterion, then offers Next word. This is a provisional lab policy,
  not a rewrite of the runtime reducer. At inspection the runtime used two
  responses (including rejected ones); the coordinator should reconcile that
  separately with Justin’s requested experience.
- The compact earlier-word tray brings a word back for extra practice. Its earlier
  coverage remains intact. **I’m satisfied** ends that extra work. Uncovered work
  interrupted to revisit an earlier word remains available afterward.
- The exercise-feedback toggle keeps its position when expanded. Its body opens
  on a new full-width row; the toggle does not move to that row.

These updates add optional view props, preserving existing adapter compilation:
`history`, `wordWork`, `leaveForToday`, `onLeaveForToday`, per-outcome `mode`,
`modeLabel`, `modeChoices`, and `onWordModeChange(wordId, mode)`. The history
callback reuses `onPractiseWord(wordId)`. The old live `onModeChange` callback is
retained for adapter compatibility but is no longer invoked by the card.

## Presentation contract

`types.ts` defines `VocabularySessionViewProps`. The controller supplies the
current presentation, response state, allowed controls, mode choices, feedback
state, and completion report. The view emits callbacks; it does not infer
covering, scheduling, mode promotion, Undo eligibility, or answer correctness.
Prompt and answer slots accept React nodes, so existing introduction and
character-formatting components can supply their actual content.

`visibleWord` is explicitly presentation-safe identity: pass null while a
production target is concealed. It must not leak through heading text, mode
labels, accessibility labels, or metadata. Exercise identity is not a requirement
for word display; independent pure cues may have no single displayed word.

Finish immediately is displayed only during the finishing phase, and requires a
confirmation explaining that unfinished words remain due. The callback does not
imply success or discard recorded evidence. Completion timing is supplied by the
controller. Resuming pending completion uses its explicit cancellation callback.
Mode choices are supplied per summary outcome. All controls are gated by the supplied availability.

## Work ownership

This lane owns only new files in `src/features/vocabulary-ui/`, the standalone
`tests/browser/vocabulary-ui*` fixture, and this handoff. Production hooks,
reducers, API contracts, persistence, routing, and Git operations belong to the
parent implementation. Presentation design is being iterated with Justin.

## Preview and verification

Run Vite and open `/tests/browser/vocabulary-ui.html`. The preview has states for
Practice, rejected answer, Solidify warmup, teaching, finishing, pending summary,
saved summary with read-only feedback, exhaustion, and long content. Interactions
are explicitly simulated and make no backend requests. Teaching/warmup text here
is a layout fixture, not a replacement for the actual introduction player.

The component uses the existing color/type tokens and paper-card treatment.
Container queries adapt to narrow desktop panels even when the browser window
is wide. The fixture can enlarge the root text to 125% independently of panel
width. Live controls contain no dismissal or suppression; the summary can expose
word dismissal only when its outcome explicitly allows it.

TypeScript compilation passed. Rendered checks covered default practice,
420px-wide card at 125% text, mode disclosure, unfinished-word confirmation,
cancel-focus restoration, pending summary controls, and saved read-only feedback.
The narrow enlarged summary had no document horizontal overflow. Backend
integration, production viewport sizing, actual introduction content, automatic
keyboard commands, and real deadline/persistence behavior remain with the parent
implementation; these checks establish the standalone presentation only.

Direct cross-chat status delivery was rejected by automatic review, including
a retry after Justin approved it in this UI chat. This document is the retained
handoff for the coordinator.

The lab’s deterministic interaction tests cover wrong/blank rejection, a single
correct exercise followed by a different word, a finite path to summary, bringing
back a covered word and returning to interrupted work, and the two distinct early
exits. These tests exercise only the fixture. Run them with
`node --import tsx --test tests/browser/vocabulary-ui-model.test.ts`.

Latest rendered checks verified that the feedback toggle’s x/y position is
unchanged by expansion, a wrong typed answer appears as rejected with the submitted
text retained, one correct answer exposes Next word and adds coverage, selecting
a covered tray tile opens extra practice without removing coverage, and summary
mode choices update only that word’s displayed future mode. The 420px card at
125% text still has no horizontal document overflow. All five fixture-flow tests
and targeted TypeScript compilation passed. Production integration is pending
for the newly optional props above.

## Full session history and recency

The controller supplies **all** safe-to-display history entries, ordered most
recently used first. Revisiting a word refreshes its recency; there is no fixed
item cutoff. `WordHistoryTray` renders one horizontal row, native scrolling,
and arrow controls when it overflows. The controls indicate whether more recent
or older words are available. New entries keep the row at the recent end when
already there, and preserve the visible older-word anchor when browsing away
from it. Keyboard focus can also scroll tiles into view.

The standalone lab has a **Long session** scenario with 28 earlier words and a
**Simulate new activity** control. That control adds one recent tile to test
position preservation. Rendered checks confirmed scrolling to older words and
adding a new entry preserved the same visible tile within a pixel. The existing
production adapter’s history ordering needs to follow this full/recent-first
contract; the UI lane does not edit that adapter.
