# Session lifecycle code-verification (M0)

status: active
type: research
created: 2026-07-10
retire-by: 2026-07-24
related:
  - notes/archive/2026-07-21-handle-registry-v0-task-spec.md (invocation compatibility input)
  - PLANS/agentic-roadmap-glm-5.2.md (M0 code-verification)
  - notes/active/2026-07-06-session-reflection-workflow.md
  - SPECS/study-action-model.md
  - SPECS/session-covering-criteria.md

## Purpose

Size the due-queue → time-budgeted planner lift, and confirm the reflection hook-in point, by verifying three code areas against the agentic roadmap (reflection-first, planner-later).

Exploration threads:

- [Composition & admission](0d9a815d-61f9-41f5-b874-9d0c287ba8fe) — `server/db/` session composition + word-skill admission/action-selection
- [Attempt-event path](56488d56-cf2f-4979-aae0-638ea8ecf77d) — durable attempt events / projection
- [Session-end & API](650ea838-bcfc-40fe-a393-6eca0ddec614) — `useStudySession` commit flow + `api.ts` contract

## Cross-cutting verdict

| Question | Answer |
| --- | --- |
| Reflection hook-in | **Confirmed for M0 happy paths:** a completed/drained-session gate after the final deferred commit flush and before teardown. Natural host: extend `SessionSummaryPanel` / completed UI. Reflection is best-effort convenience, not a correctness boundary. |
| Reflection readiness | **Partial.** Event write/project infrastructure exists for review + contrast; evidence completeness and read/bundle APIs do not. |
| Due-queue → planner lift | **M–L** from composition layer. Scheduler substrate (admission, skill state, projection, recency guard) is reusable; full due-queue dump, no review load budget, fused action-selection, and monolith concentration drive the lift. |
| Roadmap sequencing | Reflection-first is the right order: planner work is larger and orthogonal; reflection can attach at session-end without rewriting composition. |

---

## 1) Session composition + admission (`server/db/`)

### How it works today

- Entry: `GET /api/session-payload` → `getSessionPayload` → `getSessionItemBucketsWithWords` (`server/db/persistence.ts` ~588–594, ~5930–6038). Thin barrels: `session-composition.ts`, `scheduler.ts`.
- Pre-composition gate: `ensureAcceptedReviewAttemptEventsProjectedBeforeSessionComposition` (~597–614) throws if any `study_attempt_events.projected_at IS NULL`.
- Three buckets: **review** (fully expanded `SessionStudyItem[]` via `getReviewSessionStudyItems`), **learning** (uncovered learning words), **unstudied** (priority pool capped by `DAILY_NEW_WORD_LIMIT=10`).
- Word admission: `word_study_admission_state` + 6h recency guard written at projection (`REVIEW_PHASE_RECENCY_GUARD_HOURS`).
- Per-word skill selection fused into `getReviewSessionStudyItems` (~6090–6128): relevance → content availability → urgency ≥ 1 → `compareReviewSessionItemCandidates` (~6417–6437). One action per admitted word.
- No review load budget; only unstudied has a daily cap. Spec §6–7 load budget / spillover / drain not implemented at this layer.
- Frontend `createBucketSessionScheduler` (`src/lib/session-scheduler.ts`) interleaves the static payload; preserves backend review order.

### Foundational (keep)

- Two-level scheduler: `WordStudyAdmissionState` + `WordSkillState` (+ `word_skill_relevance`)
- Attempt-event → projection → scheduler update (`recordAcceptedReviewAttemptBatch`, `scheduleWordSkillStateFromReviewAttempt`)
- Pre-composition projection gate
- Recency guard via `earliestNextStudyAt`
- `SessionStudyItem` / `SessionStudyItemBuckets` / `SessionPayload` wire contract
- `validateStudySchedulerStateInvariants`
- Per-word single-skill selection heuristic (`compareReviewSessionItemCandidates`)

### Must evolve / coupling risk

- Full due-queue dump in `getSessionItemBucketsWithWords` — no budget trimming
- Skill/action selection fused into composition loop (not a reusable planner API)
- Contrast prompt/distractor random binding at snapshot time
- Static session-start payload; no mid-session replanning
- `deprioritized` relevance unused in admission
- Monolithic `persistence.ts`; planner needs module boundaries
- Spec load-budget / performance-adjustment / drain-mode absent for review

### Planner plug-in seams (without rewriting covering/commit)

1. Swap “all eligible” for “budget-selected subset” inside `getSessionItemBucketsWithWords` while keeping bucket shape.
2. Extract `getEligibleReviewCandidates(now)` from `getReviewSessionStudyItems`; planner selects; filters/heuristics stay reusable.
3. Leave projection/commit path unchanged — reflection attaches post-session.
4. Scheduler query surface already exported via `server/db/scheduler.ts`.

### Lift estimate: **M–L**

Extract composition module, add eligible-pool + budget selector, optionally defer contrast binding to serve-time. Becomes **L** if mid-session recomposition + performance-based budget + full `persistence.ts` refactor are in scope together.

---

## 2) Attempt-event projection path

### How it works today

- Domain: `StudyAttemptEvent` (`src/domain/study-actions.ts` ~125–140) — sequencing, action kind, outcome/rating, `contentRef`, `metadata`; **no** `promptAsShown`; `response` often null for recognition/production.
- Schema: `study_attempt_events` (`persistence.ts` ~3083–3099) with `projected_at`; `study_sessions` has unused `processing_state` lifecycle.
- Frontend builders: `buildBucketReviewAttemptEvent` (`session-state.ts` ~581–607) sets `response: null`; `buildContrastSelectionAttemptEvent` (~610–646) stores `selectedWordId` + choice metadata.
- Production raw response lives in `frozenProductionCard` (`useStudySession.ts` ~611–629) — ephemeral until optional contrast-candidate management action.
- Write path: deferred commit → `applySessionCommit` → POST batch → insert + project + mark projected in one transaction.
- Commit-intent cross-validation: `deriveReviewCommitFieldsFromAttemptEvents` + backend asserts.
- Read: `getStudyAttemptEventsForSession` exists in DB layer; **no HTTP GET**.
- Learning/unstudied bypass attempt events entirely (legacy complete endpoints).
- `StudyReflectionEvent` is spec-only (`SPECS/study-action-model.md` ~534–543).
- Parallel `study_events` for management actions; contrast intake links to management event ids, not attempt event ids.

### Foundational (keep)

- `StudyAttemptEvent` shape + sequencing invariants
- Durable `study_attempt_events` store with stable client ids
- Synchronous insert+project+mark transaction
- Commit-intent derivation/validation
- `projected_at` composition guard
- Contrast metadata on events (`promptTargetWordId`, `choiceWordIds`)
- `study_events` for management / intake

### Must evolve / gaps for reflection evidence

- Persist production `response` (and optionally recognition free-text) on commit
- Materialize or denormalize **prompt-as-shown** / `cuesAsShown` (today only recomputable from meaning flags)
- `StudyReflectionEvent` (or equivalent) separate from attempts
- Learning/unstudied attempt logging
- Wire `study_sessions.processing_state` if session-end batch processing is desired
- Full contrast prompt text + choice snapshots in durable store
- Link mistake intake to **attempt event id**
- Item-level session-evidence bundle + session-scoped learner notes
- Read API / bundle assembler

### Reflection hook-in readiness: **partial**

Blocked on evidence completeness and read/assembly surface, not on event infrastructure. Natural assembly: server function querying attempt events + management events + word/meaning (+ contrast content) after final commit flush — or client accumulator before teardown (see §3).

**M0 lifecycle boundary:** support natural completion and ordinary happy-path drain with an in-memory evidence accumulator. Do not add interruption recovery, navigation-away persistence, or a durable replay guarantee solely for reflection. A dropped reflection is acceptable for now: study commits and scheduling remain correct, and an interrupted mistake is likely to recur through normal SRS. Revisit this only if interruptions become routine or reflection acquires correctness-critical behavior.

---

## 3) Session-end / commit flow + API contract

### How it works today

- **Start:** client-only `sessionId` + prefetch `GET /api/session-payload`; no server start call.
- **During:** ratings update in-memory state immediately; durable write deferred in `pendingSessionCommit`; flush on next rating, end, or destructive management action. Management actions commit immediately.
- **Natural end:** queue empty → `phase: 'completed'` → `SessionSummaryPanel`.
- **Manual end:** `handleEndSession` — first call drains (`active` → `draining`); second call flushes pending → `recordReviewSessionSummary` (aggregate counts only) → wipe all session React state → `onSessionEnded`.
- Session endpoints are **write-only** (`docs/api.md`); no trace fetch.
- Composition frozen at start; no mid-session payload refresh.

### Best reflection hook-in (ranked)

1. **Completed-phase gate before teardown (recommended)**  
   For natural completion and happy-path drain, after the final pending-commit/undo closure and while in-memory session evidence is still available: assemble bundle from in-memory + optional API enrichment → reflection UI → then summary/teardown. Host: extend completed-phase UI / `SessionSummaryPanel`. This is deliberately best-effort; interruption recovery is out of M0 scope.
2. Split `handleEndSession` after flush, before summary POST (same seam, more button-coupled).
3. DB reconstruction via new GET APIs after teardown — only after schema fixes; loses frozen-card / session-note data unless persisted.
4. `onSessionEnded` in `App.tsx` — too late; state already null.

### Foundational (keep)

- `active` → `draining` → `completed` → teardown phase model
- Deferred commit + single-step undo
- Incremental per-covered-action durability
- `session-state.ts` transition functions + `session-commit.ts` adapter
- `SessionSummary` + completed UI shell
- `session-prefetch` + centralized `api.ts`
- Controller-hook pattern (`useStudySession`)

### Must evolve / hook-in implications

- Slot reflection between completed UI and teardown; do not deepen the god-hook without extracting phase/teardown
- Client **SessionEvidenceAccumulator** (or persist response/cues at commit) for prompt-as-shown + raw response
- GET session-trace / reflection-artifact APIs
- Explicit session-start / `ended_at` if envelope timestamps matter
- Mid-session recomposition API for later planner milestone
- Navigation-away persistence/recovery while reflecting is deferred; M0 may drop the reflection without affecting study correctness

### API gaps (reflection / planner)

| Area | Today | Gap |
| --- | --- | --- |
| Start session | Client-only `sessionId` | No `POST /study-sessions` with `startedAt` |
| Session trace | POST attempts only | No `GET …/events` or bundle |
| Production evidence | `response: null` | Persist response + prompt-as-shown |
| Session end | Aggregate summary counts | Reflection artifact store |
| Planner | Single-shot `session-payload` | Budget/plan params; optional refresh |

Existing write APIs usable for reflection **proposals**: `recordStudyManagementAction`, contrast intake/cluster, suppress production, bad-prompt report.

---

## Unified implications for M0 next steps

1. **Reflection hook-in is confirmed** at completed-phase / pre-teardown. No composition rewrite required for M2 reflection wiring.
2. **Session-evidence bundle spike** should treat as first-class gaps:
   - production `response` + prompt-as-shown (client accumulator and/or event schema)
   - no read/bundle API
   - learning/unstudied lack attempt traces
   - management vs attempt event linkage for contrast intake
3. **Planner lift is later and larger (M–L):** keep admission/skill/projection; replace full-queue dump with eligible-pool + budget selection; extract composition out of `persistence.ts`.
4. **Do not wait on planner** for reflection; do not wait on full durable evidence schema if M0 developer-facing prototype can assemble from in-memory completed-phase state + existing DB joins — but durable fields remain the right long-term path for hosted/replay.

---

## Open questions (carry into bundle / handle spikes)

1. Time-budget ownership: backend truncation vs frontend scheduler vs hybrid spillover/drain (spec §7)?
2. Mid-session replanning required for first planner milestone, or session-start snapshot enough?
3. Persist production evidence on `StudyAttemptEvent` at commit, or client accumulator only for M0?
4. **Decided for M0:** reflect on natural completion and ordinary happy-path drain only; interruption/navigation-away recovery is deferred.
5. `study_sessions.processing_state`: keep per-action sync projection, or session-end batch before reflection?
6. Bundle scope: attempts only, or also `study_events` + `contrast_candidate_intake`?
7. Accepted reflection handles: extend `projectStudyManagementAction` vs new validated apply path?
8. Navigation away during reflection: auto-surface on return to Home, or block until done?
9. `deprioritized` relevance: planner signal or dead schema for now?
