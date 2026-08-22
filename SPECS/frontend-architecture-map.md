# Frontend Architecture Map

Navigation map for the React frontend. Product behavior is defined by the canonical specs, especially:

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

  components/
    AppChrome.tsx                 # nav (home, priority, reflections, content), version, errors
    MeaningList.tsx               # shared meaning list rendering

  pages/
    HomePage.tsx                  # home: overview + active session grid
    HomeOverviewPanel.tsx         # backend/session availability overview + Start session card (gear toggles SessionSettingsPanel)
    PriorityPage.tsx              # unstudied priority chip bank + triage
    ReflectionsPage.tsx           # help pager, artifact history/detail, and proposal-level review
    ContentDiagnosticsPage.tsx    # read-only primitive content browser

  features/
    session/
      useStudySession.ts          # session runtime controller
      StudySessionPanel.tsx       # active/completed session UI
      SessionSummaryPanel.tsx     # completed session summary UI
      PersonalNotesEditorOverlay.tsx
      session-finalization.ts     # explicit Finish/Close and best-effort reflection states
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
    study-actions.ts              # shared study-action types/adapters (also used by server)
    reflection.ts                 # canonical reflection result/operation/lifecycle contract
    reflection-evidence.ts        # strict supplement and initial-bundle validation
    reflection-result-schema.ts   # strict provider JSON schema
    intake-triage.ts              # intake advisor provider request/response and app annotation contract

  lib/
    session-state.ts              # frontend in-flight session state machine
    session-scheduler.ts          # active queue helpers

  services/
    api.ts                        # frontend API client
```

## Mental Model

`App.tsx` is intentionally thin. It owns only cross-page concerns:

- current page selection (`home` | `priority` | `reflections` | `content`)
- global error message
- backend status refresh
- app chrome wiring
- personal-notes overlay mounting
- wiring page controllers (`useStudySession`, `usePriorityPageController`,
  `useReflectionPageController`, `useContentDiagnosticsController`)

Page-specific state should not drift back into `App.tsx`. Use a page controller hook or keep state inside the page component when it is purely local UI.

## Page Controllers

`useStudySession` owns the in-flight study session on the home page (see Session Controller below).

`usePriorityPageController` owns the priority page: loading, search,
added-word highlighting, batch priority updates, unbumped triage loading, manual advisor
generation, and assessment accept/dismiss actions.

`useReflectionPageController` owns the reflection page. See the
[reflection frontend architecture map](../docs/reflection-frontend-architecture.md)
for its loading, compact dogfood run-log, review, and application-status boundaries.

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
- completed-session finalization and non-blocking reflection generation
- ephemeral reflection-evidence capture and retry supplement retention
- production Hanzi input flow
- personal notes editor state
- active word meaning loading and visibility updates
- keyboard shortcuts and focus effects

The hook returns:

- `homePageProps` → `HomePage`
- `personalNotesEditor` → overlay in `App.tsx`

The completed-session finalization, evidence accumulator, and reflection review
workspace are mapped separately in the
[reflection frontend architecture map](../docs/reflection-frontend-architecture.md).

## Boundaries

- Backend/API contracts stay centralized in `src/services/api.ts`.
- Durable state changes go through backend API calls.
- Frontend owns only the active, in-flight session snapshot after a session starts.
- Core session transitions live in `src/lib/session-state.ts`; UI hooks orchestrate, they do not redefine rules.
- Shared display helpers belong in `components/` only when genuinely cross-feature.

## Cleanup Notes

Removed first-prototype static flashcard / browser-side AI practice UI. The app loads backend data and local session state instead.
