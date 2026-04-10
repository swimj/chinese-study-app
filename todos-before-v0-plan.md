# Todos Before V0 Plan

This plan translates the items in [`todos-before-v0.md`](/Users/jw/dev/chinese-study-app/todos-before-v0.md) into execution milestones, with dependencies called out explicitly.

## Clarified Behavior

### Drain mode: what counts as "open"

When the user clicks `End session` during an active session, the app should enter a drain mode instead of terminating immediately.

In drain mode:

- The currently displayed card counts as open once it has been shown to the user.
- Any review item that is in same-session reinforcement counts as open.
- Any learning word with partial in-session progress counts as open.
- Any unstudied word with partial in-session progress counts as open.
- Any item or word that has never been shown yet in the current session counts as unstarted work and should be dropped from the active queue.
- While draining, the app should continue presenting only the open work until all of it is covered and committed.

This matches the intended interpretation confirmed in discussion.

## Concerns Worth Respecting

### 1. Drain mode is not just a button tweak

The current frontend session state in [`src/App.tsx`](/Users/jw/dev/chinese-study-app/src/App.tsx) tracks queue position and some progress, but it does not explicitly model whether an item has been started. Drain mode becomes much safer if we first extract and clarify session-state rules.

### 2. Review-direction spacing is a scheduling-policy change

The current backend session builder in [`server/db.ts`](/Users/jw/dev/chinese-study-app/server/db.ts) returns due review items in due-date order, which allows forward and reverse siblings to appear back-to-back. Fixing that is reasonable for v0, but it should be treated as a deliberate session-composition rule with tests, not as a minor UI shuffle.

### 3. Pinyin alignment should be scoped carefully

Showing pinyin on its own line is straightforward. True per-character pinyin-above-hanzi alignment is not fully supported by the current data model because pinyin is stored as a single string, not tokenized/aligned syllable data. For v0, the plan should target:

- revealed answer shows pinyin on a separate smaller line
- definition appears on its own line below

If later we want ruby-style alignment, that should move to backlog unless the existing data proves unambiguous enough.

## Task Groups

### Group A: Session engine and product rules

- Drain mode
- Session phase transitions
- Session summary support
- Forward/reverse review-item ordering

### Group B: Active session UX

- Keyboard mappings
- Session timer
- Reveal layout update

### Group C: Home/dashboard layout

- Move `Start session` into its own top-left box
- Keep the main session panel focused on active/completed session states

## Dependencies

### Strong dependencies

1. Extract or clarify session-state transitions before adding drain mode.
2. Define drain mode before building the session summary screen.
3. Finalize session phases before wiring keyboard shortcuts.

### Weak dependencies

1. Forward/reverse ordering can be implemented independently, but should land before final validation of the overall study flow.
2. Timer and reveal layout can land independently once the active session UI is stable.
3. Start-session layout changes can happen at almost any point.

## Proposed Milestones

## Milestone 1: Session-state foundation

Goal: make in-session behavior explicit and testable before layering on more UX.

Scope:

- Extract active-session transition rules from [`src/App.tsx`](/Users/jw/dev/chinese-study-app/src/App.tsx) into a small pure TypeScript module.
- Model:
  - queue order
  - started vs unstarted work
  - review reinforcement state
  - learning coverage state
  - unstudied drill state
  - session phase
- Add focused tests for the extracted rules.

Why first:

- This reduces risk for drain mode and summary behavior.
- It keeps the React component from becoming harder to reason about.

## Milestone 2: Drain mode

Goal: allow the user to stop intake while finishing only already-open work.

Scope:

- Change `End session` behavior from immediate exit to `draining`.
- Filter the active queue down to only open work.
- Prevent any unstarted items from being shown once draining begins.
- Auto-finish the session when the last open unit is committed.

Tests:

- current item remains if already shown
- untouched future items are discarded
- partially progressed learning words drain correctly
- partially progressed unstudied words drain correctly
- review reinforcement items drain correctly

## Milestone 3: Session summary

Goal: show a useful completion state after the session ends.

Scope:

- Add a `completed` session phase.
- Capture summary stats such as:
  - elapsed time
  - total answers
  - items completed
  - words advanced by lifecycle if convenient
- Render a summary page after termination instead of bouncing straight back to overview.

Note:

- Summary should work for both naturally finished sessions and drain-ended sessions.

## Milestone 4: Review-direction spacing

Goal: reduce immediate forward/reverse sibling repetition in the common case.

Scope:

- Update session composition in [`server/db.ts`](/Users/jw/dev/chinese-study-app/server/db.ts).
- Prefer grouping due review items by direction rather than letting sibling directions cluster naturally by due time.
- Initial policy proposal:
  - reverse first
  - forward second
  - preserve sensible order within each direction bucket
- Update backend tests in [`tests/session-composition.test.ts`](/Users/jw/dev/chinese-study-app/tests/session-composition.test.ts).

Open implementation note:

- If needed, we can make this policy slightly smarter later, but the initial v0 version should stay simple and predictable.

## Milestone 5: Active session controls and polish

Goal: make the session usable without pointer-only interaction and improve answer presentation.

Scope:

- Add keyboard mappings:
  - `Space`: reveal answer, then submit `Good` for binary-recall cases when appropriate, then continue when that matches the current state
  - `1`/`2`/`3`/`4`: `Forgot` / `Hard` / `Good` / `Easy`
- Add a session timer counting up from `0:00`.
- Change revealed-answer layout so pinyin appears above the definition or hanzi answer line, instead of inside parentheses.

Implementation caution:

- Keyboard shortcuts should respect the current phase and should not fire while the user is typing into an input, if any are later introduced.

## Milestone 6: Layout cleanup

Goal: make the entry point and active-session layout feel v0-ready.

Scope:

- Move the `Start session` control into its own top-left box.
- Keep session overview stats visible but not in the way of the primary action.
- Ensure the `End session` / drain control remains clear during active study.

## Suggested Execution Order

1. Milestone 1: Session-state foundation
2. Milestone 2: Drain mode
3. Milestone 3: Session summary
4. Milestone 4: Review-direction spacing
5. Milestone 5: Active session controls and polish
6. Milestone 6: Layout cleanup

## Definition Of Done For V0 Todo Pass

- Ending a session drains only open work and never introduces untouched work.
- A completed session shows a summary state.
- Review-direction spacing no longer commonly presents reverse/forward siblings back-to-back.
- The active session is usable from the keyboard.
- The active session shows elapsed time.
- Revealed answers show pinyin and answer text on separate lines.
- The `Start session` CTA has a clearer, more prominent placement.
