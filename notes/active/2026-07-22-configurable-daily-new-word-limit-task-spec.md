# Make the daily new-word limit configurable

status: active
type: work-bundle
created: 2026-07-22
retire-when: configurable daily new-word limits are implemented or deliberately declined
related:
  - SPECS/study-action-model.md
  - SPECS/frontend-architecture-map.md
  - docs/api.md
  - docs/server-db.md

## Outcome

Give the learner a small home-page control for the daily limit on newly
introduced words, backed by durable application state and the existing session
composition policy.

The configured limit and the number of new words completed today are separate:
the current UTC-day count is never reset or rewritten when the setting changes.
For any newly composed session, normal new-word admission is
`max(0, configuredLimit - todayCompletedNewWordCount)`.

Examples:

- At a limit of 10, after 10 new words are completed today, increasing the
  limit to 20 allows the next freshly composed session to introduce 10 more.
- After 10 new words are completed today, decreasing the limit to 5 introduces
  no further normal new words today. Tomorrow's count starts at zero, so the
  configured limit of 5 applies in full.

An already-started session remains its existing frontend-owned snapshot;
changing the setting affects the next session, not its current queue.

## Scope

- Replace the fixed daily-new-word-limit constant at the policy boundary with a
  persisted, validated configured value. Keep the existing default as the
  initial value for existing and new databases.
- Store the setting independently from `daily_new_word_intake`, whose
  `new_study_count` remains the per-day completed-new-word counter.
- Add a thin backend/domain API to read and update the setting, with strict
  validation for a non-negative integer. Zero is valid and means no normal new
  words are admitted.
- Return the effective configured limit in the existing status/policy payload,
  and refresh/invalidate any prefetched pre-start session payload after a
  successful change so the next session reflects the new value.
- Add a compact, accessible home-page numeric control and save action. Show the
  effective limit and provide clear saving/error handling using existing UI
  patterns; do not build a general settings subsystem.
- Update normal unstudied admission to use the configured limit minus today's
  stored completed count. Preserve all existing semantics for required-for-next-
  session words, priority ordering, dismissed words, and study-day keys.
- Document the persistence/API contract in the relevant docs.

## Read first

- `SPECS/study-action-model.md`
- `SPECS/frontend-architecture-map.md`
- `server/db/persistence.ts` (`getLearningPolicy`,
  `getRemainingDailyNewWordSlots`, `daily_new_word_intake`, and schema init)
- `server/db/types.ts`
- `server/index.ts` (status and policy routes)
- `src/services/api.ts`
- `src/features/session/session-prefetch.ts`
- `src/features/session/useStudySession.ts`
- `src/pages/HomeOverviewPanel.tsx` and `src/App.tsx`
- `tests/session-composition.test.ts`, `tests/user-priority.test.ts`,
  `docs/api.md`, and `docs/server-db.md`

## Done when

- A learner can view and save a non-negative integer daily new-word limit from
  the home page.
- The setting persists across backend restart and is independent of the
  per-day `new_study_count`.
- Existing databases retain the current default until the learner changes it.
- Session composition admits only the remaining normal slots for the current
  UTC study day, and a newly raised limit immediately expands the next session
  by the correct remaining amount.
- A lowered limit below today's already-completed count admits no further
  normal new words that day and applies normally from the following day.
- Changing the limit does not mutate an in-flight session queue, today’s count,
  or required-for-next-session overflow behavior.
- Focused persistence/session-composition tests cover default, persistence,
  raised-limit, lowered-limit, next-day, zero-limit, and required-word cases.
  Add a focused API/UI test where existing test seams make it practical.
- Relevant tests and `npm run build` pass.

## Non-goals

- Do not alter historical intake counts, scheduled reviews, learning-word
  coverage, or priority ranking.
- Do not change the daily new-word policy into an adaptive or performance-based
  system.
- Do not add profiles, per-week schedules, automatic recommendations, or a
  general preferences/settings architecture.
- Do not modify an already-started session's payload.

## Dependencies and overlap

This overlaps home-page work and the session-prefetch path. Revalidate against
the queued home-page time-metrics and answer-matching cleanup tasks before
dispatching, and integrate deliberately if they have landed first.

## Execution constraints

Implement in an isolated worktree from current `HEAD`. Use the normal database
initialization/migration route for the new durable setting, keep backend
timestamps/date keys in UTC, and keep HTTP handlers thin. Do not change data
artifacts outside intentional schema verification.

## Stop / ask

Stop for direction if a useful upper bound or permission model for the setting
is required beyond a local, single-user non-negative integer. Otherwise do not
invent a general settings policy; the bounded control and behavior above are
the requested outcome.
