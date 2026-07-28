# Persist active session time and show today-relative averages

status: archived
type: work-bundle
created: 2026-07-22
retire-when: active session-time metrics are implemented or deliberately declined
related:
  - SPECS/study-action-model.md
  - SPECS/frontend-architecture-map.md
  - docs/api.md
  - docs/server-db.md

## Outcome

Make session-time reporting reflect study-specific effort more closely. While a
study session is running, count elapsed time only while the app document is
visible; pause it when the browser tab/window becomes hidden and resume it when
visible again. Persist the resulting active duration when the session ends.

Show exactly three cumulative session-time metrics on the home page:

- **Today** — total active session time completed on the current study day.
- **3-day average** — total active session time across today and the preceding
  two study days, divided by three calendar days.
- **7-day average** — total active session time across today and the preceding
  six study days, divided by seven calendar days.

Use the existing UTC `YYYY-MM-DD` study-day convention and attribute a completed
session's full active duration to its completion day, as the current review
summary does. The metric is intentionally a compact today-relative summary,
not a daily-history list or chart.

## Scope

- Add active-duration tracking to the in-flight session controller and summary.
  Use the standard Page Visibility API (`document.visibilityState` /
  `visibilitychange`) when it is available: visible intervals count, hidden
  intervals do not.
- Ensure the in-session elapsed display and final session summary use this same
  active duration rather than wall-clock `startedAt`/`completedAt` subtraction.
- Provide a safe fallback for environments without the visibility API: continue
  the traditional wall-clock elapsed timer rather than blocking sessions.
- Extend the existing completed-session summary persistence/API path with a
  validated non-negative active duration, keeping its `sessionId` upsert
  semantics.
- Store the duration alongside `review_session_summaries` via the repository's
  normal schema initialization/migration path. Existing historical rows have
  no trustworthy active duration and may initialize to zero; do not attempt to
  infer active time retroactively from wall-clock timestamps.
- Add a focused analytics query/DTO that returns only the three today-relative
  values needed by the status endpoint. Include zero-activity calendar days in
  the 3-day and 7-day divisors; do not average only days with sessions.
- Expose the values through `/api/status`, the frontend API type, and a compact
  home-page section. Keep it separate from the review-failure-rate display.
- Document the changed status/persistence contract in the relevant API and DB
  docs.

## Read first

- `SPECS/study-action-model.md` (time-budget and session context)
- `SPECS/frontend-architecture-map.md` (session-controller ownership)
- `src/features/session/useStudySession.ts`
- `src/features/session/session-summary.ts`
- `src/features/session/SessionSummaryPanel.tsx`
- `src/pages/HomeOverviewPanel.tsx`
- `src/services/api.ts`
- `server/index.ts`
- `server/db/persistence.ts` (`review_session_summaries` and analytics)
- `server/db/types.ts`, `src/types.ts`, `docs/api.md`, and `docs/server-db.md`
- `tests/session-completion.test.ts`

## Done when

- During a session, the elapsed-time indicator does not increase while the
  document is hidden and resumes from the accumulated value when it becomes
  visible again.
- If the Visibility API cannot be used, elapsed time remains a working
  wall-clock timer.
- Ending a session records its non-negative active duration idempotently with
  the existing completed-session summary.
- `/api/status` returns exactly the three session-time summary values for the
  current UTC study day: today total, rolling 3-day daily average, and rolling
  7-day daily average.
- The home page displays those three values, without a multi-day session-time
  history/list/chart.
- Analytics tests prove correct totals and calendar-day averages across sparse
  data (including a zero-activity day), and persistence/API validation tests
  cover duration handling. Add focused frontend tests for the visibility timer
  where the existing test setup makes that practical.
- Existing review-failure-rate behavior remains unchanged.
- Relevant focused tests and `npm run build` pass.

## Non-goals

- Do not build a general time-budget planner, idle-detection system, or manual
  pause button.
- Do not attempt to track time for abandoned sessions after a page reload or
  browser/process termination.
- Do not split one completed session across calendar days.
- Do not change learning/scheduling policy based on these metrics.
- Do not add a chart, historical drill-down, or separate settings surface.

## Dependencies and overlap

This is independent of the current reflection/handle-registry design work, but
it overlaps the home overview and session controller. Revalidate against any
active change in either area before dispatching.

## Execution constraints

Implement in an isolated worktree from current `HEAD`. Preserve UTC date-key
handling and keep the database migration additive and backward-compatible.
Use the existing session-summary endpoint rather than introducing a separate
durable timing workflow. Do not modify unrelated data artifacts.

## Stop / ask

Stop for input if the existing session-summary endpoint cannot safely receive a
client-measured duration without a product/security decision beyond this local
single-user PoC, or if a verified caller needs durations split across midnight.
Otherwise, browser visibility is sufficient for the requested approximation;
do not expand into detecting every form of user distraction.
