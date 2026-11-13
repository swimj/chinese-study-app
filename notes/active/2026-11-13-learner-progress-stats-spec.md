# Learner progress stats — build spec

status: active
type: handoff
created: 2026-11-13
retire-when: both PRs are open, or the design is declined
related:
  - notes/active/2026-11-10-daily-practice-orientation.md
  - docs/vocabulary-learning.md

Build spec for a first set of learner-facing progress indicators in the
Mandarin vocabulary runtime. It follows the Home week-dots change (PR #525).
The audience is a learner around month six asking "is this working?", not a
new learner who needs a hook.

## Goal and stance

- Replace Home's leftover observability stats with something framed for the
  learner.
- Add a small set of experimental indicators cheap enough to build from data
  we already store, so we can learn whether they are directionally useful.
- No proficiency score, no streak, no grade. Every number must only go up or
  improve by doing the practice itself.
- Units are **items**, not words. An item is a word skill or a shared (pure)
  cue. Only "active vocabulary" and "first productions" are word-based.
- No scheduling change. This work reads records; it never writes learner state.

## Decisions (settled with Justin, 2026-11-13)

1. Everything shows on Home. There is no separate Progress page; Justin will
   decide what to subtract after seeing it all in place.
2. Home's current "Today" (Sessions / Responses) block and "Active study time"
   block are removed. Study time appears as the week's cumulative total beside
   the week dots.
3. Compute on request or precompute: the builder decides, from measurement.
   See [Performance](#performance). Home load time is already a problem, so
   this work must not slow the Start card.
4. Only vocabulary-runtime history counts. Legacy review summaries are ignored.
5. Monday-start weeks and the timed session's local study day (04:00 boundary),
   matching the week dots.

## Delivery

Two PRs, built from `main`, in order. Follow AGENTS.md.

1. **Computation and endpoint.** Pure computation, loader, route, performance
   measurement, tests, docs.
2. **UI.** Home week time, bars and indicators, client call, tests, rendered
   check.

## Source data (verified in code on 2026-11-13)

| Need | Where |
| --- | --- |
| Per-session evidence | `vocabulary_session_completions.report_json` (`VocabularySessionProjection`, `src/domain/vocabulary-session.ts`). Use rows with `status='closed'`, ordered by `staged_at`. |
| Encounter facts | `report.encounters[]`: `encounterId`, `wordId` (null for a pure cue), `mode`, `presentedAt`, `presentationUndone`, `skipped`, `snapshot.{contentId, kind, role, schedulingScope, body.revealWords}`, `effectiveResponses[].payload.{outcome, response, helpUsed, selfAssessment}` and `.occurredAt`. |
| Word state per session | `report.words[wordId]`: `initialMode`, `mode`, `teachingCompleted`. |
| Active time | `input_json.activeDurationMs` on the completion (may be null). |
| Local study day | `localNewWordDay(instant, timeZone)` in `server/vocabulary/composition.ts`. |
| Judgments | `reflection_cases` (`kind='learner_feedback'`, one per completion and subject) → `vocabulary_reflection_jobs.status`; when `succeeded`, `result_json` holds `$.input.unfairEncounterIds`. `reflection_case_evidence` lists each case's encounter ids. |
| Pronunciation rejection | `isLearnerPronunciationRejection` in `src/domain/vocabulary-session.ts`. |
| Existing pattern to copy | `server/db/vocabulary-statistics.ts`, `server/vocabulary/statistics-routes.ts`, `tests/vocabulary-statistics.test.ts`. |

Not verified, builder must check: the exact field holding the last-practised
timestamp inside `learner_state_effects.before_json` (used by the optional gap
fallback), and the `lexical_words` columns (used by the optional step in
"Active vocabulary").

## Definitions

**Countable encounter.** `snapshot.role === 'general'`, not
`presentationUndone`, not `skipped`, at least one effective response.
Teaching and priming never count.

**Item key.**
- Pure cue (`snapshot.schedulingScope === 'pure_cue'`): `cue:<contentId>`.
- Otherwise `word:<wordId>:<skill>`, where skill is `recognition`,
  `production`, or `contextual_selection` for `snapshot.kind` of
  `recognition`, `production`, `contrast`.

**Held item.** A pure cue, or a word encounter whose `mode` is `practice` or
`maintain`.

**Attempt.** One per item per session: the item's earliest countable
encounter in that session, judged by its first effective response.

**Attempt result.**
- `success`: first response accepted and `helpUsed` is not true.
- `failure`: first response rejected, or accepted with help.
- A rejected **production** attempt (word or pure cue) is then adjusted by its
  feedback judgment:
  - job `succeeded`, encounter listed as unfair → `void`.
  - job `succeeded`, not listed → stays `failure`.
  - no case, or job not `succeeded` → `pending`.
  - A pronunciation rejection is always `failure`.
- Recognition and contrast are never judged; they keep the live result.

**Rate.** `success / (success + failure)`. `void` and `pending` are excluded
from both sides and reported as counts. A rate is `null` when
`success + failure < 10`.

**Gap.** Time from the item's previous attempt (any earlier session) to this
attempt. Unknown when there is no previous attempt.
Optional fallback, only if the field is confirmed: use the last-practised
timestamp in the closure receipt's `before_json` for that subject.

## Indicators

All windows end at `now` and use attempt time.

### 1. Daily activity (Home bars and week time)
For each of the last 14 local study days: distinct word items attempted,
distinct pure cues attempted, and active milliseconds. Day comes from the
completion's `staged_at`. The week's cumulative time is the sum of active
milliseconds over the current Monday-to-Sunday week.

### 2. Active vocabulary
Distinct words the learner has produced. A word counts when a countable
`production` encounter has an accepted effective response without help.
- Word encounter: the word is `encounter.wordId`.
- Pure cue: the word is the `snapshot.body.revealWords` entry whose `hanzi` or
  `traditional` equals the normalized response. Skip if zero or several match.
- Optional, separable last step: a production rejection judged unfair counts
  its response word when exactly one `lexical_words` row matches the response.

Report the total and how many were added in the last 30 days.

### 3. First productions
The date each word first entered active vocabulary.
- Baseline: productions within 14 days of the learner's first closed
  completion join the total but are not listed as first productions.
- Report the 12 most recent after baseline: `wordId`, `hanzi`, `pinyin`, date.

### 4. Recognition rate
Rate over held `recognition` attempts in the last 30 days.

### 5. Stickiness
Rate over held attempts whose gap is at least 21 days, last 90 days. Split
counts by `word` and `cue`; one combined rate.

### 6. Transfer
Rate over held attempts, last 90 days, that are the learner's first ever
encounter of that `contentId`, where either:
- the item is a pure cue, or
- the item already has a previous attempt on a different `contentId`.

### 7. Efficiency
For each word with `teachingCompleted` in some completion: the number of
sessions in which it appeared with `initialMode` of `unstudied` or `solidify`,
up to its first session with `initialMode` of `practice` or `maintain`.
Group by the month (local study day) teaching completed. Report per month:
median, settled count, still-settling count. A month's median is `null` under
5 settled words.

## PR 1 — computation and endpoint

- `src/domain/vocabulary-progress.ts`: response types.
- `server/db/vocabulary-progress.ts`:
  - `computeVocabularyProgress(input, now, timeZone?)`: pure. Input is the
    ordered completions (staged time, parsed report, active ms), the unfair
    encounter id set, and the pending encounter id set. One chronological pass.
  - `getVocabularyProgress(now, timeZone?)`: loads for `requireLearnerId()` and
    calls the pure function.
- `GET /api/vocabulary/progress?timeZone=…` in a routes file registered beside
  statistics. Reuse `parseVocabularyTimeZone`; invalid zone returns 400.
- Fail loudly on a malformed report; do not skip silently.
- Leave `GET /api/vocabulary/statistics` unchanged.
- Keep `computeVocabularyProgress` pure either way, so a precomputed store
  only changes what feeds it.

Response shape:

```ts
type Rate = { rate: number | null; success: number; failure: number; void: number; pending: number };
type VocabularyProgress = {
  today: string;
  days: { dayKey: string; wordItems: number; cueItems: number; activeDurationMs: number }[]; // 14, oldest first
  activeVocabulary: { total: number; addedLast30Days: number };
  firstProductions: { wordId: string; hanzi: string; pinyin: string; dayKey: string }[];
  recognition: Rate;
  stickiness: Rate & { wordAttempts: number; cueAttempts: number };
  transfer: Rate;
  efficiency: { month: string; medianSessions: number | null; settled: number; settling: number }[];
};
```

Tests (`tests/vocabulary-progress.test.ts`), each on small hand-built reports:
- teaching, priming, undone and skipped encounters never count.
- one attempt per item per session, taken from the first response.
- help-used acceptance is a failure and adds no active vocabulary.
- rejected production: unfair → void, judged fair → failure, unjudged →
  pending; pronunciation rejection stays failure.
- recognition ignores judgments.
- rate is null under 10 judged attempts.
- gap threshold at exactly 21 days; unknown gap excluded.
- transfer needs a prior attempt on other content, except pure cues.
- pure-cue response resolves to one reveal word; ambiguous match is skipped.
- baseline hides early first productions but keeps them in the total.
- efficiency median, settled and settling counts, and the under-5 null.
- day bucketing across the 04:00 boundary; other learners excluded.

Docs: add the endpoint to `docs/api.md`; add a short section to
`docs/vocabulary-learning.md` near the Home statistics text.

## Performance

Reports carry full served snapshots, so parsing a learner's whole history on
each request may be heavy. The builder chooses the approach from evidence:

1. Measure first: time `getVocabularyProgress` against the largest available
   learner history (rows read, bytes parsed, wall time). Put the numbers in the
   PR.
2. If the reads look heavyweight, precompute. A reasonable shape is a
   per-completion summary written at closure (the attempts and productions this
   spec needs, without snapshots), plus a backfill for existing completions.
   This is authorized. It needs a versioned migration
   ([migration guide](../../docs/ops/schema-migrations.md#writing-the-next-migration)),
   so the release cannot use the app-only upgrade route; say so in the PR.
3. If computing on request is kept, add observability for its cost: record the
   endpoint's duration and the number of completions read, using the existing
   request timing in `server/request-timing.ts` or the nearest equivalent, so
   the impact is visible in the hosted service.
4. Either way, the endpoint must not be on the path that makes Start usable.

## PR 2 — UI

- `fetchVocabularyProgress` in `src/services/api.ts`, sending the browser time
  zone as the preview call does.
- All of it lives on Home (`src/pages/VocabularyHomePage.tsx`,
  `VocabularyHomeOverview`). No new page or navigation entry.
- **Loading.** Fetch progress separately from the preview and statistics
  calls, after first render. The Start card and week dots never wait on it.
  While it loads, the progress sections are absent. A failure shows one quiet
  retry line, as the recent-session error does.
- **Top of Home.**
  - Keep the Start card and week dots as they are.
  - Beside or directly under the dots, show the current week's cumulative
    active time (for example "1h 40m this week"). Omit it when the week has no
    measured time. No daily target, no remaining amount.
  - Remove the "Today" block and the "Active study time" block.
- **Activity.** A 7-day stacked bar chart for the last 7 local days: words
  below, shared cues above, with a two-entry legend. Empty week: draw the axis
  and day labels with no bars and no message.
- **Indicators**, below the bars, in this order:
  - Active vocabulary: the total, with "+N in the last 30 days".
  - First productions: the recent list (hanzi, pinyin, date).
  - Recognition, Stickiness, Transfer: one row each in a shared table with
    columns Rate and Attempts. Show "Not enough yet" for a null rate.
  - Efficiency: a small table by month.
  - One `<details>` per indicator holding its definition and the void and
    pending counts. No other explanatory copy.
- Everything below the dots is hidden in the compact layout (Connections
  expanded), like the dots themselves.
- Place the new sections so Connections and What's New stay reachable without
  a long scroll; the existing Home grid has two columns to use.
- Label units as "items" or "exercises", never "words", except active
  vocabulary and first productions.
- Charts are plain SVG or CSS; add no charting dependency. Use existing CSS
  tokens in `src/styles.css`.
- Bars need a text alternative: a `role="img"` label summarizing the week, as
  the week dots do.

Tests: extend `tests/vocabulary-home-overview.test.ts` for the removed blocks,
the week time, the bars, the indicators with null rates, an empty history, the
absent state while progress is loading, and the compact layout.

Rendered check (required by AGENTS.md): narrow panel, enlarged text, empty
history, a long first-productions list, expanded disclosures, and keyboard
access to the disclosures. Use the vocabulary walkthrough fixture in
`docs/vocabulary-learning.md#contributor-verification`. Report it if no
browser is available; do not claim visual correctness from a build.

## Known limits to state in the PRs

- The vocabulary runtime's history starts around October 2026, so stickiness
  and efficiency will mostly read "Not enough yet" at first. That is expected.
- Words known before the runtime started show up as early productions; the
  baseline rule only softens this.
- Excluding pending judgments can flatter a rate if many jobs are unjudged.
  The pending count is shown so this is visible.
- Recognition is self-assessed.
- Policy changes can break long-run comparisons. Do not add trend lines yet.

## Out of scope

- Any scheduling or attribution change, including credit for produced words.
- Handling for words outside the study set.
- Unlock and probe (reachable sentences), stretch challenges.
- Streaks, goals, comparisons between learners, notifications.
- An operator-view version of these indicators.
