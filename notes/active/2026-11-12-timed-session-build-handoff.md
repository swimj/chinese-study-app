# Timed session prototype — build handoff

status: active
type: handoff
created: 2026-11-12
retire-when: the first prototype PR is open, or the design is declined
related:
  - notes/active/2026-11-11-timed-session-iterator-prototype.md
  - notes/active/2026-11-10-daily-practice-orientation.md

Context for the agent building the first prototype, beyond the two design
notes. The design notes say what to build; this note says what the design
review learned about the code and what is still undecided.

## Starting point

The revised design merged in PR #521 (notes only). Build from `main`.
Expect one cohesive PR. Follow AGENTS.md: propose
the evaluation approach early, write composition and completion tests first,
and use the versioned migration procedure.

## Code map

| Concern | Where |
| --- | --- |
| Live next-item draw, bucket weights, rotation | `selectNextWord`, `server/vocabulary/study.ts` |
| Admission at Start, cap, pure-cue interleave | `planVocabularyStudy` and `startVocabularyStudy`, same file |
| Due candidates and urgency order | `composeVocabularyStudy` in `server/vocabulary/composition.ts`; `selectVocabularyReviewSkills` in `review-selection.ts`; `reviewUrgency` in `server/db/review-policy.ts` |
| Bucket weights and 1,000 cap | `src/domain/session-limits.ts` |
| `finishing` / `resume` / `finish_for_now` | Reducer in `src/domain/vocabulary-session.ts` |
| Local study day (04:00 boundary) | `localNewWordDay` in `composition.ts` |
| Wrap-up controls | `src/features/vocabulary-ui/VocabularySessionView.tsx` |
| Home preview count | `src/pages/VocabularyHomePage.tsx` |
| Active-time persistence | `server/db/vocabulary-sessions.ts`, `server/db/vocabulary-statistics.ts` |

## Things the notes do not say

- **Replay determinism.** The session projection is replayed from its action
  log. A budget-triggered move to `finishing` depends on client time, so it
  must be recorded as an action (for example `finish_for_now` with a budget
  source), not recomputed during replay. Freeze skip counts and the budget
  into session context at Start for the same reason.
- **Skip counts need the untruncated due set.** `composeVocabularyStudy` and
  `planVocabularyStudy` truncate to the cap. The closure-time increment needs
  the due held items that were cut, too.
- **The gate makes unstarted new words common.** Start enrolls every admitted
  unstudied word (`enrollVocabularyDietWord`) before any is served. That
  already happens when a learner finishes early; with the gate it becomes the
  normal case. Check what enrollment implies for words that are never started
  that day, and consider admitting fewer new words when pressing work exists.
- **Wrap-up and Home show counts.** "Complete everything due" and the Home
  item count expose the due ledger the design hides. Both need a new-mode
  treatment; the keep-going action can reuse `resume`.
- **Day total of active time.** Earlier sessions' active time is frozen at
  completion; the current session's comes from the client with each Next.

## Undecided — raise with Justin before implementing

- How the new mode is switched on: per learner, operator flag, or global
  default. Switchback is a rollback for us, not a learner toggle.
- Where the learner states the day's size the first time, and the default
  when they never have.
- Copy and placement of the one optional completion line. Keep it quiet and
  identical every day.

## Working with Justin

Justin is new to this direction and welcomes challenge. Raise open points one
at a time with a recommendation rather than as a long block. Prefer a rough
policy that records its own discomfort over tuning in advance.

## Settled with Justin, 2026-11-12

- **Switch.** Global default, through the `timed_sessions` service control
  (migration 0071, on). Turning it off is the rollback; open sessions keep the
  paradigm they started under.
- **Day size.** Set once in the session settings panel (about 10, 20 or 30
  minutes); 20 when never set. The session record notes `chosen` or `default`.
- **Wrap-up and keep going.** Wrap-up happens without a learner action when the
  budget is reached. Only then does the summary offer "Study a little more",
  which grants five more minutes of active time; the trainer still calls the
  next end. A fresh Start into a spent day runs at least five minutes too.
- **No manual finish** in timed sessions for now. A graceful early exit returns
  once the base is solid. A learner-directed mode would be a separate paradigm.
- **The line.** One text field under the summary actions, labelled "Anything
  you'd want different?", the same every day; focusing it pauses the return to
  Home.
- **Enrollment of unstarted new words.** Admitted words that never start remain
  hidden Unstudied records and stay eligible later, so admission was not reduced.
