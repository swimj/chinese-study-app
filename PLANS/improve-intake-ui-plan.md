# Smaller-Step Intake And Cluster Editing

## Summary
Rework intake around word-first triage and reusable cluster editing. Intake rows become target words with candidate mentions/notes folded into the detail view. Users can mark intake as `resolved` at any time, create one-word clusters, add/remove members, edit member nuance, add/delete prompts, suppress production, and mark definition-based production prompts as bad from the same intake/cluster context.

## Key Changes
- Rename intake terminal action/state language:
  - UI says `Resolved`, not `Dismiss`
  - keep or migrate stored status from `dismissed` to `resolved`; if retaining DB value temporarily, hide that behind API/type naming
  - word-level `dismissWordFromStudy` remains separate and is not used by this flow
- Add a word-first intake API:
  - open intake rows grouped by `targetWordId`
  - include target word, candidate mentions, notes, sources, clusters containing the target, production feedback state, and cluster completeness flags
  - resolving a word intake item marks all open intake rows for that target word as resolved
- Add non-session study management actions for intake/cluster contexts:
  - `suppress production for this word`: set `word_skill_relevance(wordId, "production") = "suppressed"`
  - `bad production prompt`: add `study_content_feedback` for `generated_prompt/definition_based_production`
  - use the same durable effects as session management, but allow `sessionId`, `sessionActionId`, and `sourceEventId` to be null when invoked outside a live session
- Add cluster authoring APIs:
  - create cluster with title/note and optional initial members, allowing a single initial member
  - update cluster title/note
  - add, update, remove cluster members, including nuance note and display order
  - keep prompt APIs requiring non-empty prompt text and target membership
- Replace separate intake/cluster edit logic with one reusable cluster editor:
  - intake page selects a word, shows candidate context and relevant clusters, then embeds the same editor
  - clusters page uses the same editor without intake context
  - no drag and drop in the first cut

## UI Behavior
- Intake queue is a searchable word list.
- Selecting a word shows:
  - meanings, notes, and production feedback state
  - candidate mentions from intake rows
  - clusters already containing the word
  - session-like management actions: `Suppress production`, `Bad production prompt`
  - cluster actions: create one-word cluster, add candidates/members, edit nuance, add prompts
  - `Mark resolved`, always enabled
- Cluster cards show when a member has production suppressed or bad production prompt feedback, so decisions made from intake remain visible later.

## Test Plan
- Backend tests:
  - word-first intake grouping aggregates multiple candidate rows under one target word
  - resolving a word intake item resolves all open rows for that target
  - legacy pair/group behavior is removed or covered by compatibility tests if retained
  - one-member clusters can be created and returned
  - member add/update/remove preserves prompt membership invariants and cascades prompts when a target member is removed
  - non-session production suppression writes `word_skill_relevance`
  - non-session bad production prompt writes `study_content_feedback`
  - scheduler still excludes partial clusters with no usable prompts and excludes suppressed/bad production where existing policy says it should
- Frontend/build verification:
  - update API types, controllers, and page components
  - run `npm test`
  - run `npm run build`
  - visually check intake and cluster pages locally

## Assumptions
- `Resolved` is intake-only language and does not imply the word is removed from study.
- Production suppression and bad production prompt should be available outside sessions with the same durable meaning as the existing session buttons.
- Partial/more-love cluster status remains computed from members, prompts, and open intake; no new cluster status table.
- Nuance notes are useful but not required for completeness in the first cut.

## Clarified Decisions (2026-06-01)
- Intake terminal status distinction:
  - `accepted` vs `dismissed` is not currently load-bearing for active intake behavior.
  - Start writing `resolved` for this flow.
  - Keep backward compatibility for historical `accepted` / `dismissed` rows.
  - Treat any non-`open` intake status as terminal/resolved in API/domain shaping during migration.
- Word-level resolve semantics:
  - Resolving an intake word intentionally resolves all open intake rows for that `targetWordId`.
  - Resolve is no longer auto-triggered by other actions.
  - Intake detail should surface candidate-level "not yet addressed" indicators when a candidate has not:
    - had production suppressed, and
    - had bad production prompt feedback, and
    - appeared in a cluster that contains the target intake word.
  - If unresolved candidates remain, show a warning before resolve, but allow the user to proceed.
- Non-session management actions:
  - Outside a live session, do not create `study_events` rows in this slice.
  - Write durable effects directly (`word_skill_relevance`, `study_content_feedback`) with nullable source metadata (for example `source_event_id = null`).
- Bad production prompt lifecycle:
  - This slice supports reporting bad definition-based production prompts.
  - Resolution/unmark for bad production prompt is explicitly out of scope for now.
- Queue ordering and filters:
  - Intake queue sort is `open row count DESC`, then latest intake recency DESC.
  - Cluster completeness/filter defaults:
    - compute from members, prompts, and open intake (no new status table),
    - support incomplete/more-love, open-intake overlap, and unresolved bad-prompt filters.
- One-word clusters:
  - One-word cluster creation is allowed.
  - Completeness rules should treat it as not schedulable until it has usable multi-word contrast content.
- Migration strategy:
  - Single PR migration is acceptable for this local deployment model.

## Key Code References
- [server/db.ts](/Users/jw/dev/chinese-study-app/server/db.ts:1488): current pair-shaped intake grouping and coverage summary.
- [server/db.ts](/Users/jw/dev/chinese-study-app/server/db.ts:1564): intake cluster creation currently requires candidate + prompt.
- [server/db.ts](/Users/jw/dev/chinese-study-app/server/db.ts:1667): current `accept` / `dismiss` intake terminal status flow.
- [server/db.ts](/Users/jw/dev/chinese-study-app/server/db.ts:1898): session study-management projection for suppress skill and bad prompt.
- [server/db.ts](/Users/jw/dev/chinese-study-app/server/db.ts:6117): scheduler relevance gates for suppressed skills and bad production prompts.
- [server/db.ts](/Users/jw/dev/chinese-study-app/server/db.ts:6184): contrast scheduler content eligibility; partial clusters remain inert without usable prompts.
- [server/index.ts](/Users/jw/dev/chinese-study-app/server/index.ts:90): current contrast intake HTTP routes.
- [server/index.ts](/Users/jw/dev/chinese-study-app/server/index.ts:198): current contrast cluster and prompt routes.
- [src/services/api.ts](/Users/jw/dev/chinese-study-app/src/services/api.ts:60): frontend contrast content and intake API types.
- [src/pages/IntakePage.tsx](/Users/jw/dev/chinese-study-app/src/pages/IntakePage.tsx:19): current intake UI, still group/pair-first and prompt-required.
- [src/pages/ClusterManagementPage.tsx](/Users/jw/dev/chinese-study-app/src/pages/ClusterManagementPage.tsx:21): current cluster UI, mostly prompt editing only.
- [tests/contextual-selection-intake.test.ts](/Users/jw/dev/chinese-study-app/tests/contextual-selection-intake.test.ts:63): existing intake grouping/content tests to replace or extend.
- [tests/study-management.test.ts](/Users/jw/dev/chinese-study-app/tests/study-management.test.ts:120): existing suppression and bad-prompt projection tests to reuse for non-session actions.

## Implementation Slices
1. Backend intake terminology and word-first model
   - Introduce word-first intake payloads grouped by `targetWordId`.
   - Rename API/domain language from dismiss/accepted to resolved where user-facing.
   - Resolve all open intake rows for a target word in one action.
   - Keep compatibility only if needed during frontend migration.

2. Backend cluster editing primitives
   - Add create/update cluster endpoints independent of intake.
   - Allow creating a cluster with one initial member.
   - Add member add/update/remove endpoints for nuance and ordering.
   - Preserve prompt invariants: prompts still require non-empty text and target membership.

3. Backend non-session study management
   - Add focused routes for production suppression and bad production prompt outside a live session.
   - Reuse the same projection effects as session management.
   - Store nullable session/source metadata rather than inventing a separate feedback model.

4. Frontend API and controllers
   - Replace pair/group intake types with word-first intake types.
   - Add API helpers for cluster editing, member editing, production suppression, bad production prompt, and resolving intake.
   - Update controllers so mutations refresh the relevant intake/cluster state consistently.

5. Shared cluster editor UI
   - Extract common cluster member/prompt editing from `IntakePage` and `ClusterManagementPage`.
   - Use it from intake with selected-word/candidate context and from clusters without intake context.
   - Support search-based member add/remove, nuance edit, prompt add/edit/delete, and one-word cluster creation.

6. Intake and cluster page UX
   - Make intake a searchable word queue.
   - Show candidate mentions, notes, production feedback state, and relevant clusters for the selected word.
   - Add `Suppress production`, `Bad production prompt`, and always-enabled `Mark resolved`.
   - Add cluster filters for incomplete content, more-love/open-intake overlap, and unresolved bad prompts.

7. Verification
   - Update/add focused backend tests first.
   - Run `npm test`.
   - Run `npm run build`.
   - Visually verify intake and cluster flows in the local browser.
