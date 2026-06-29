# Frontend Architecture Map

Navigation map for the React frontend. Product behavior is defined by the canonical specs, especially:

- `SPECS/learning-review-model.md`
- `SPECS/session-covering-criteria.md`
- `SPECS/study-action-model.md`

## Directory Tree

```text
src/
  App.tsx                         # app shell: chrome, page selection, backend status, overlays
  main.tsx                        # React entrypoint
  styles.css                      # shared app styles
  types.ts                        # shared frontend API/domain DTO types
  study-profile.ts                # mandarin vs french client profile

  components/
    AppChrome.tsx                 # nav (home, priority, intake), version, errors
    MeaningList.tsx               # shared meaning list rendering

  pages/
    HomePage.tsx                  # home: overview + active session grid
    HomeOverviewPanel.tsx         # backend/session availability overview
    PriorityPage.tsx              # unstudied priority queue + triage
    IntakePage.tsx                # contrast intake (candidates, cluster actions)

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

    priority/
      usePriorityPageController.ts # priority loading, search, batch updates
      priority-page-model.ts       # priority sorting helpers

    contrast/
      useIntakePageController.ts   # contrast intake page controller
      useClusterPageController.ts  # cluster list/prompt management (used from Intake)

  domain/
    study-actions.ts              # shared study-action types/adapters (also used by server)

  lib/
    session-state.ts              # frontend in-flight session state machine
    session-scheduler.ts          # active queue helpers

  services/
    api.ts                        # frontend API client
```

## Mental Model

`App.tsx` is intentionally thin. It owns only cross-page concerns:

- current page selection (`home` | `priority` | `intake`)
- global error message
- backend status refresh
- app chrome wiring
- personal-notes overlay mounting
- wiring page controllers (`useStudySession`, `usePriorityPageController`, `useIntakePageController`, `useClusterPageController`)

Page-specific state should not drift back into `App.tsx`. Use a page controller hook or keep state inside the page component when it is purely local UI.

## Page Controllers

`useStudySession` owns the in-flight study session on the home page (see Session Controller below).

`usePriorityPageController` owns the priority page: loading, search, jump-to-word, batch priority updates, triage dismiss.

`useIntakePageController` owns contrast intake: open candidates, resolve/merge/create cluster flows, suppress/report bad prompt from intake.

`useClusterPageController` owns contrast cluster CRUD used from the intake page (cluster list, members, prompts, feedback resolution). `App.tsx` calls `clusterPage.loadData()` when opening intake and after mutating actions.

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

The hook returns:

- `homePageProps` → `HomePage`
- `personalNotesEditor` → overlay in `App.tsx`

## Boundaries

- Backend/API contracts stay centralized in `src/services/api.ts`.
- Durable state changes go through backend API calls.
- Frontend owns only the active, in-flight session snapshot after a session starts.
- Core session transitions live in `src/lib/session-state.ts`; UI hooks orchestrate, they do not redefine rules.
- Shared display helpers belong in `components/` only when genuinely cross-feature.

## Cleanup Notes

Removed first-prototype static flashcard / browser-side AI practice UI. The app loads backend data and local session state instead.
