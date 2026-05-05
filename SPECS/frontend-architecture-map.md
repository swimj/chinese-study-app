# Frontend Architecture Map

This document is a mental map for the current React frontend. Product behavior
is still defined by the product specs, especially:

- `SPECS/learning-review-model.md`
- `SPECS/session-covering-criteria.md`
- `SPECS/study-action-model.md`

Use this map when looking for where UI state, page loading, and session runtime
logic live.

## Directory Tree

```text
src/
  App.tsx                         # app shell: chrome, page selection, backend status, overlays
  main.tsx                        # React entrypoint
  styles.css                      # shared app styles
  types.ts                        # shared frontend API/domain DTO types

  components/
    AppChrome.tsx                 # nav, version, global error display
    MeaningList.tsx               # shared meaning list rendering

  pages/
    HomePage.tsx                  # home page shell: header + overview/session grid
    HomeOverviewPanel.tsx         # backend/session availability overview
    WordsPage.tsx                 # words inspection page
    PriorityPage.tsx              # unstudied priority management page

  features/
    session/
      useStudySession.ts          # session runtime controller
      StudySessionPanel.tsx       # active/completed session UI
      SessionSummaryPanel.tsx     # completed session summary UI
      PersonalNotesEditorOverlay.tsx
      session-commit.ts           # deferred durable commit adapter
      session-prefetch.ts         # session payload prefetch cache
      session-rating.ts           # keyboard/rating option helpers
      session-selectors.ts        # active prompt/answer/meaning derivation
      session-state-copy.ts       # undo snapshot cloning helper
      session-summary.ts          # session summary type + updates

    words/
      useWordsPageController.ts   # words page loading + pagination controller
      words-page-model.ts         # inspectable row derivation

    priority/
      usePriorityPageController.ts # priority loading/search/update controller
      priority-page-model.ts       # priority sorting helpers

  lib/
    session-state.ts              # frontend in-flight session state machine
    session-scheduler.ts          # active queue helpers

  services/
    api.ts                        # frontend API client
```

## Mental Model

`App.tsx` is intentionally thin. It owns only concerns that cross pages:

- current page selection
- global error message
- backend status refresh
- app chrome wiring
- top-level modal/overlay mounting

Page-specific state should not drift back into `App.tsx`. Put it behind a page
controller hook or inside the page component if it is purely local UI state.

## Page Controllers

`useWordsPageController` owns the words inspection page's loading, row
derivation, and pagination state.

`usePriorityPageController` owns the priority page's loading, search, jump, and
priority update state. It exposes an explicit controller return type so the
`App.tsx` boundary stays clear.

## Session Controller

`useStudySession` owns the in-flight study session runtime:

- session payload prefetch
- start/end/rate/undo/dismiss flows
- deferred durable session commits
- session summary updates
- production Hanzi input flow
- personal notes editor state
- active word meaning loading and visibility updates
- keyboard shortcuts and focus effects

The hook returns two main objects:

- `homePageProps`, passed through to `HomePage`
- `personalNotesEditor`, used by `App.tsx` to mount the overlay at the shell
  level

This hook is intentionally cohesive rather than finely split for now. If an area
grows independently, good future extraction points are production input,
personal notes editing, and keyboard/focus effects.

## Boundaries

- Backend/API contracts stay centralized in `src/services/api.ts`.
- Durable state changes go through backend API calls.
- Frontend owns only the active, in-flight session snapshot after a session
  starts.
- Core session transitions live in `src/lib/session-state.ts`; UI hooks should
  orchestrate those transitions, not redefine their rules.
- Shared display helpers belong in `components/` only when they are genuinely
  cross-feature.

## Cleanup Notes

The previous first-prototype frontend files for static sample flashcards and
browser-side AI practice were removed. The current frontend starts from backend
data and local session state instead of static sample data.
