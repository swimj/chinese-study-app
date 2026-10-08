# Frontend Architecture Map

For contributors tracing the React frontend, this document maps component
ownership, controller wiring, and session interaction handling. Product behavior
is defined by the canonical specs, especially:

- `SPECS/learning-review-model.md`
- `SPECS/session-covering-criteria.md`
- `SPECS/study-action-model.md`
- `SPECS/reflection-proposals-and-handles.md`

## Directory Tree

```text
src/
  App.tsx                         # app shell: chrome, page selection, backend status, overlays
  main.tsx                        # React entrypoint
  styles.css                      # shared app styles
  types.ts                        # shared frontend API/domain DTO types
  study-profile.ts                # mandarin vs french client profile

  auth/
    ClerkAuthenticationBoundary.tsx  # Clerk session gate around App
    ClerkAuthGateViews.tsx           # loading chrome, signed-out sign-in, and invite password panel
    clerk-auth-gate.ts               # loading vs sign-in vs invite sign-up vs app phase resolver

  components/
    AppChrome.tsx                 # left-gutter primary nav, nested page rails, errors, signed-in service banner
    MeaningList.tsx               # shared meaning list rendering

  pages/
    AboutPage.tsx                 # learner help: getting started, usage, known issues, recent changes
    HomePage.tsx                  # home: overview + active session grid
    HomeOverviewPanel.tsx         # backend/session availability overview + Start session card (gear toggles SessionSettingsPanel)
    PriorityPage.tsx              # Words / Stash: unstudied priority chip bank
    MyWordsPage.tsx               # Words / My words: collection list and side detail pane
    ReflectionsPage.tsx           # help pager, second-opinion chip bank, artifact history/detail, and proposal-level review
    ContentDiagnosticsPage.tsx    # read-only primitive content browser

  features/
    attention/
      useAttentionBadges.ts       # nav unseen counts, durable failed-run marker, Help-card ack, What’s New cursor
    words/
      useMyWordsController.ts     # learner collection search, bounded loading, selection

    content-quality/
      ContentQualityControls.tsx  # independent standing thumbs and display notification
      keyboard.ts                # typing-safe bracket shortcuts

    session/
      useStudySession.ts          # session runtime controller
      StudySessionPanel.tsx       # active/completed session UI
      SessionDesk.tsx             # opaque stack, departure motion, peripheral progress
      session-desk-model.ts       # presentation outcomes from existing covering decisions
      SessionSummaryPanel.tsx     # French summary + independent reflection status
      SessionDebriefPanel.tsx     # shared live/reopened Mandarin connection cards
      useSessionDebrief.ts        # mounted debrief request ownership
      session-debrief-loader.ts  # status polling, request fencing, retry recovery
      session-debrief-keyboard.ts # native-safe connection navigation
      PersonalNotesEditorOverlay.tsx
      session-keyboard.ts         # state-to-action/shortcut descriptors + key resolution
      session-dialog-focus.ts     # session dialog focus trap, Escape, restoration
      session-finalization.ts     # Finish/Close, in-app leave finish, in-flight generation, and best-effort reflection states
      session-reflection-evidence.ts # typed production evidence accumulator + Undo snapshots
      session-commit.ts           # deferred durable commit adapter
      session-prefetch.ts         # session payload prefetch cache
      session-rating.ts           # keyboard/rating option helpers
      session-selectors.ts        # active prompt/answer/meaning derivation
      session-state-copy.ts       # undo snapshot cloning helper
      session-summary.ts          # session summary type + updates

    priority/
      usePriorityPageController.ts # priority loading, search, batch updates
      priority-page-model.ts       # triage frequency sort, stash recency, chip-bank partition/selection
      PriorityWordBank.tsx         # manage-view top/stash chip bank, hover details, drag between sections

    reflection/
      useReflectionPageController.ts # open/history/detail loading and review mutations
      reflection-page-model.ts       # item grouping, typed draft edits, support/validation facts
      ReflectionOperationEditor.tsx  # purpose-built editors for the four V1 operations

    content/
      useContentDiagnosticsController.ts # bounded primitive-kind search and loading

  domain/
    client-incidents.ts           # bounded client transport incident schema shared with server
    study-actions.ts              # shared study-action types/adapters (also used by server)
    reflection.ts                 # canonical reflection result/operation/lifecycle contract
    reflection-evidence.ts        # strict supplement and initial-bundle validation
    reflection-result-schema.ts   # strict provider JSON schema

  lib/
    session-state.ts              # frontend in-flight session state machine
    session-scheduler.ts          # active queue helpers

  services/
    api.ts                        # frontend API client
    client-incident-diagnostics.ts # account-scoped pending transport-incident queue
```

## Mental Model

`main.tsx` wraps `App` in `ClerkAuthenticationBoundary`. Clerk startup is a
loading state, not a signed-out state: the sign-in heading stays hidden until
Clerk reports no session. An invitation ticket in the URL mounts SignUp on the
app origin so invited users set a password there and continue into a signed-in
Home, rather than completing signup on Clerk Account Portal.

`App.tsx` is intentionally thin. It owns only cross-page concerns:

- current page selection (`home` | `priority` | `reflections` | `content` | `about`)
- global error message
- backend status refresh
- signed-in service banner from that status (hidden during an active session)
- app chrome wiring
- personal-notes overlay mounting
- wiring page controllers (`useStudySession`, `usePriorityPageController`,
  `useReflectionPageController`, `useContentDiagnosticsController`,
  `useAttentionBadges`)

Page-specific state should not drift back into `App.tsx`. Use a page controller hook or keep state inside the page component when it is purely local UI.

## Primary navigation

`AppChrome` is a persistent left gutter, not a top tab bar. The four primary
views stay **Home**, **New Words**, **Reflections**, and **Content Bin**. The product
name sits at the top of that gutter and wraps to fill the rail width; there is
no tagline or version in primary nav, and Home does not repeat the name as a
page heading. An active study session still hides this gutter so the session
panel can use the full width.

New Words and Reflections already have left-gutter view controls. Those controls
are nested children of the matching primary item (portal into the chrome
nested slot; they still own their local view state). Home and Content have no
nested children.

- New Words children: **Manage**, **Triage**
- Reflections children: **Proposals**, **Second opinion**, **By session**, **Run meta**,
  **Quality**
- Reflections primary-tab overlay (only while that view is open): **Refresh**
  (cycle icon; same hover dimming/pulse pattern as Home session-settings gear)

The primary landmark remains `aria-label="Primary"`. Nested rails keep their
existing `New Words views` / `Reflection views` labels and keyboard behavior.

### First-visit guidance

Home remains the initial page. The welcome path highlights one next action:

1. About exposes Getting Started with a pulsing halo and “Start here” label.
   Opening another About view does not acknowledge the guide.
2. Opening Getting Started moves the cue to Words with “Add to your stash”.
   Following this cue opens Stash even if My words was previously selected.
3. Once Stash opens successfully, the settings gear is highlighted when the
   learner returns to Home. Opening settings completes the path.

Reduced-motion preferences replace the pulse with a static highlight.
Acknowledgements are stored in localStorage per Clerk account (per origin in
trusted-local mode). Reloads return to Home with the next unfinished cue, or
ordinary navigation after all three steps. These markers do not sync across
browsers or devices. Clearing or blocking storage can make cues reappear;
existing accounts without a marker also see each step once.

`App.tsx` owns the progression and persistence. `AppChrome.tsx` renders the
navigation cues; `HomePage.tsx` reports settings opening, and
`HomeOverviewPanel.tsx` renders the gear cue. The authentication boundary supplies
the account scope, and `main.tsx` remounts the app when that scope changes.

## Page Controllers

`useStudySession` owns the in-flight study session on the home page (see Session Controller below).

`usePriorityPageController` owns the priority page: loading, add-by-target search,
multi-match selection when a query resolves to several unstudied rows, added-word
highlighting, and batch priority updates.

`useReflectionPageController` owns the reflection page. See the
[reflection frontend architecture map](../docs/reflection-frontend-architecture.md)
for its loading, Refresh (full workspace reread including cached details),
compact dogfood run-log, review, and application-status boundaries.

`useContentDiagnosticsController` owns the read-only content diagnostic page:
primitive-kind selection and explicit query submission. Opening the page and
switching primitive kinds remain idle; only a non-empty user query triggers
bounded server-side selection and result loading.

## Session Controller

`useStudySession` owns the in-flight study session runtime:

- session payload prefetch
- start/end/rate/undo/dismiss flows
- deferred durable session commits
- session summary updates
- completed-session finalization and non-blocking reflection generation,
  including in-app leave from the completed summary as the same finish path
- ephemeral reflection-evidence capture and retry supplement retention
- production Hanzi input flow
- personal notes editor state
- active word meaning loading and visibility updates
- keyboard shortcuts and focus effects, using `session-keyboard.ts` as the
  shared state-to-action/shortcut descriptions for the panel and controller
  (see [Session keyboard interactions](#session-keyboard-interactions))
- accepted production with a served cue supplement: an `await-supplement`
  Continue beat before rating; cards without a supplement still rate immediately

The study desk is presentation-only. The controller computes the existing domain
transition when the learner leaves the card. The desk captures an outgoing clone,
then displays the successor beneath it; controls stay locked until departure ends.
The successor's content fades in over an opaque paper surface. Covered
units leave right, ongoing units leave left, and misses settle into Practice again.
Contrast misses leave without a reinforcement promise because their existing
covering rule has no same-session retry. Automatic production failures retain the
frozen reveal until Continue; visible pile metadata changes on that Continue,
not on initial reveal. UI pile membership is included in the Undo snapshot and
never changes scheduling. Reduced-motion preferences skip departures.

The card frame stays fixed while its content scrolls. Controls sit below the
prompt/input; full production glosses remain in a Word reference disclosure.
`ClozePrompt.tsx` normalizes explicit blank markers for production/rehearsal
display: runs of ASCII/full-width underscores (including spaced runs), and
empty or underscore-only `()`, `（）`, `[]`, `［］`, or `【】` pairs become `____`.
Reveal fills each recognized blank with the target answer, including frozen
failure cards. Underscores embedded in non-Hanzi words or numbers, ordinary
punctuation, nonempty brackets, and unknown symbols are preserved. With no
recognized marker, the prompt stays unfilled and the separate answer remains
available. Normalization is display-only; served snapshots and response
matching remain unchanged. Native disclosure keys are exempt from study shortcuts.

The hook returns:

- `homePageProps` → `HomePage`
- `finishCompletedSessionIfLeaving` → `App.tsx` primary-nav leave
- `personalNotesEditor` → overlay in `App.tsx`

The completed-session finalization, evidence accumulator, and reflection review
workspace are mapped separately in the
[reflection frontend architecture map](../docs/reflection-frontend-architecture.md).

### Session keyboard interactions

The in-app shortcut guide provides the current card's key bindings and their
availability. Button hints expose the same actions on hover and keyboard focus.
Use that guide for a key lookup; this section explains how contributors keep
keyboard behavior aligned with the displayed controls.

[`session-keyboard.ts`](../src/features/session/session-keyboard.ts) resolves
keys against the current interaction state and supplies descriptions for the
guide. [`useStudySession`](../src/features/session/useStudySession.ts) dispatches
commands to the same handlers used by the buttons in
[`StudySessionPanel`](../src/features/session/StudySessionPanel.tsx). Availability
must follow the displayed card: a correction card can refer to a frozen attempt
while the session already has a different active item. For example, the
reflection-request shortcut (`R`) targets that frozen attempt until the learner
continues, then targets the active eligible production review card.

Focus is part of command resolution. Ordinary letter shortcuts leave editable
fields alone. Production input explicitly accepts submission with Enter and
**No clue** with Shift+Enter when the response is empty. The latter ignores IME
composition and cannot fall through to native form submission when a typed
response makes No clue unavailable. The controller also suspends study commands
while a transition is busy or the notes editor or shortcut guide is open.
Native disclosure activation remains with the disclosure. The finalized
Mandarin summary yields to the debrief's keyboard handler.

Some surfaces own their own handlers. [Content feedback](../docs/content-quality.md)
explains which cue or supplement owns the bracket shortcuts; the
[debrief contract](session-debrief.md) describes connection navigation. Those
feature-specific explanations remain with their features. Learning and
reflection contracts describe the effects of invoking actions, independently
of their current key bindings.

When changing a binding, check its resolver, button hint, guide entry, and focus
behavior together. `tests/session-keyboard.test.ts` covers command resolution;
a browser check is also needed for event propagation, native form submission,
and hint visibility. A passing resolver test alone does not establish that the
focused input dispatches the command correctly.

## Boundaries

- Backend/API contracts stay centralized in `src/services/api.ts`.
- Accepted review/contrast commit transport failures use the bounded shared
  client-incident schema. Pending records are account-scoped in local storage
  and uploaded best-effort after authenticated startup or reconnection; they do
  not retry the commit itself.
- Durable state changes go through backend API calls.
- Frontend owns only the active, in-flight session snapshot after a session starts.
- Core session transitions live in `src/lib/session-state.ts`; UI hooks orchestrate, they do not redefine rules.
- Shared display helpers belong in `components/` only when genuinely cross-feature.

## Cleanup Notes

Removed first-prototype static flashcard / browser-side AI practice UI. The app loads backend data and local session state instead.
