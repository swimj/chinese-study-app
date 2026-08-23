# SWI-43 desktop beta interaction brief

status: active
type: work-bundle
created: 2026-08-23
retire-when: SWI-43 is dispositioned and its first implementation slice is accepted or declined
related:
  - STABILITY_FRONTIER.md
  - SPECS/frontend-architecture-map.md
  - SPECS/session-covering-criteria.md
  - SPECS/study-action-model.md
  - SPECS/session-reflection-generation.md
  - SPECS/reflection-proposals-and-handles.md
  - https://linear.app/swimj/issue/SWI-43/audit-the-desktop-core-loop-and-define-the-first-beta-ux-slice
  - https://linear.app/swimj/issue/SWI-54/make-active-session-actions-and-keyboard-behavior-coherent

## Outcome

The current broad page model remains adequate for the invite-only desktop beta.
The first intentional UI work should improve the common interaction grammar
rather than replace the information architecture or learning model.

The recommended first implementation slice is:

> Make active-session actions self-explanatory and keyboard-coherent while
> preserving the speed already available to an habituated dogfood learner.

This brief records the audit evidence, accepted product stance, beta principles,
prioritized opportunities, and dispatch-ready contract for that slice.

## Method and evidence boundary

The audit combined:

- the accepted stability frontier and canonical study/reflection contracts;
- a browser walkthrough against a disposable Mandarin dev database;
- a separate disposable reflection-review fixture;
- static inspection of the current frontend component, controller, CSS, focus,
  and keyboard boundaries; and
- direct dogfood context from the product owner.

The walkthrough covered returning-home orientation, session start, contrast
selection, typed production, incorrect-answer feedback, Undo, drain-mode
completion, finalization, reflection failure, proposal Help, reflection history,
and the primary navigation surfaces. It did not modify the primary dogfood
database.

The product owner confirmed that the current shortcuts accumulated ad hoc and
became efficient through habituation, but that requiring the same habituation
from beta learners is not acceptable.

## Accepted emotional core

> A serious, calm learning workshop that protects concentration, treats
> mistakes as useful evidence, and leaves the learner in control of what
> changes.

This is an initial decision filter, not an exhaustive brand or product-vision
statement. Additional layers may emerge through later concrete design choices.

## Current-state conclusion

### What is already strong

- Entering a study session removes global navigation and protects attention.
- Prompts receive strong visual priority and the principal action remains
  available in a fixed action rail.
- Failure produces explanation and further practice rather than punishment.
- Undo preserves a narrow, truthful escape hatch before durable commit.
- Drain mode lets the learner stop admitting work while still finishing the
  obligations already opened.
- Finalization preserves the last Undo boundary before durable completion.
- Reflection is optional, asynchronous, explicitly authorized, and isolated
  from study correctness.
- Reflection Help presents one decision at a time with stable review actions.

These are product strengths worth clarifying, not replacing.

### Recurring structural friction

1. **Learner and operator surfaces share one hierarchy.** The home page gives
   backend mode, database path, prefetch state, and implementation language
   substantial visual authority. Content diagnostics and reflection run/quality
   observability share primary navigation weight with learner work.
2. **The active-session action grammar is implicit.** Available keys and the
   meaning of the next action change by session state, but the state-specific
   contract is not visible where the learner acts.
3. **The shortcut guide and handler can drift.** The current guide advertises
   `u` for Undo while the controller listens for `z`. Contrast selection already
   supports `1`/`2` preview plus Enter confirmation, but the guide does not
   explain it.
4. **Some decisions are under-labeled.** Post-answer binary rating controls can
   appear as bare `No` and `Yes`; the correction surface may omit the learner's
   typed response even though it is important evidence.
5. **Focus continuity is incomplete.** The shortcuts dialog does not establish
   or contain focus, notes focus is not reliably restored, and page/summary
   transitions often leave focus on `body` or the replaced navigation control.
6. **Careful lifecycle boundaries are easy to miss.** Drain mode, final Undo,
   finalization, and reflection failure are semantically sound, but their status
   can be outside the current reading position or expressed in implementation-
   oriented terms.
7. **Priority management contains pointer-only behavior.** Clickable table rows
   and long-press bulk entry lack equivalent keyboard interaction and semantic
   selection state.

These are recurring interaction and trust problems. Typography refinement,
minor spacing, hover motion, and decorative cohesion remain secondary unless
they obstruct the same flows.

## Beta interaction principles

1. **Study is the product; diagnostics are supporting tools.**
2. **Expose one unmistakable next meaningful action in every state.**
3. **Preserve expert speed without requiring prior habituation.**
4. **Describe state in terms of the learner's work, not implementation machinery.**
5. **Treat mistakes as visible, emotionally neutral evidence.**
6. **Make promised reversibility and irreversible authorization boundaries clear.**
7. **Keep reflection calm, correctable, and subordinate to learner authority.**
8. **Preserve useful expert density while disclosing operational detail on demand.**

## Prioritized opportunities

| Opportunity | Learner impact | Frequency | Risk | Recommended sequence |
| --- | --- | --- | --- | --- |
| Active-session action and keyboard coherence | high | every study action | low-medium | first |
| Returning-home orientation and diagnostic demotion | high | every return/session start | low | second |
| Drain, completion, and reflection-status clarity | high | every completed session | medium | third |
| Priority keyboard/selection accessibility | medium | occasional management | low-medium | fourth |
| Broader learner/operator separation in reflection and content | medium | occasional | medium | later bounded slice |
| General visual-system polish | low until tied to a flow | variable | low | incremental only |

## First implementation slice

### Outcome

Make the active study session learnable without sacrificing the efficient
keyboard path used by an experienced learner. The visible action, keyboard
behavior, focus target, and help text must describe one coherent state-specific
contract.

### Target interaction grammar

| Session state | Primary visible action | Keyboard behavior |
| --- | --- | --- |
| Unrevealed recognition | Reveal answer | Space |
| Typed production input | Submit response | Enter |
| Unanswered contrast selection | Select a numbered option, then confirm | `1`/`2` preview, Enter confirm |
| Revealed answer awaiting rating | Forgot / Hard / Good / Easy as allowed | `1`-`4`; Space invokes the visibly identified default |
| Auto-rated correction awaiting advance | Continue | Space |
| Undo available | Undo the last undoable session transition | `U`; retain `Z` as an unadvertised compatibility alias unless implementation evidence argues otherwise |
| Session dialog open | Close and return to the invoking control | Escape |

Every essential action remains available through an ordinary visible control.
Shortcuts accelerate the flow; they do not become a separate hidden product.

### Scope

- Put the relevant shortcut beside or within the current primary action area.
- Make the shortcut overlay accurate and state-aware enough to explain contrast
  selection, production submission, rating, advance, Undo, notes, and dialog
  dismissal without requiring source knowledge.
- Derive rendered shortcut descriptions and controller behavior from one
  shared typed definition or otherwise make drift structurally difficult.
- Keep the existing `1`/`2` contrast preview plus Enter-confirm behavior, and
  expose selected state visually and accessibly.
- Confirm typed-production Enter submission through automated coverage and
  retain automatic focus on the production input.
- Replace bare binary decision labels with wording that states what the learner
  is deciding while preserving the existing rating values and semantics.
- Show a submitted typed response on the correction card when one exists;
  preserve the explicit distinction between typed mistake and No clue.
- Correct the Undo mismatch. Advertise `U`; accept legacy `Z` as a compatibility
  alias unless a focused implementation check finds a conflict.
- Give the shortcuts and personal-notes dialogs an intentional initial focus,
  contained Tab order, Escape dismissal, and focus restoration to their
  invokers.
- Provide a consistent `:focus-visible` treatment for controls touched by this
  slice.

### Likely component-boundary cleanup

- Extract the state-to-action/shortcut description from
  `src/features/session/useStudySession.ts` into a small session-scoped typed
  module.
- Keep the controller responsible for executing session actions and the panel
  responsible for rendering the same action descriptors.
- Keep rating, covering, Undo snapshots, deferred commits, and finalization in
  their existing domain/controller boundaries.
- Do not create a general command framework, global state library, or generalized
  design system.

### Acceptance criteria

- A learner can complete representative recognition, production, contrast,
  correction, rating, and Undo flows using only the keyboard.
- The same flows remain fully operable by pointer.
- The current primary action and its shortcut are visible without opening the
  full shortcut guide.
- Every shortcut displayed by the product performs the described action in the
  state where it is displayed; unavailable shortcuts are not presented as
  active.
- Contrast choice selection has a programmatically exposed selected state and
  Enter confirms the selected choice.
- Typed production submits with Enter and correction feedback distinguishes the
  submitted response from the accepted answer.
- Binary post-answer decisions state their meaning without changing the stored
  rating or covering result.
- Undo restores the same pre-transition state and evidence defined by the
  current canonical contract.
- Opening and closing session dialogs preserves a contained focus path and
  restores focus to the invoking control.
- No learning, scheduling, covering, drain, completion, reflection, or proposal-
  authorization semantics change.

### Validation plan

- Add focused pure tests for the state-to-action/shortcut mapping.
- Add or extend session UI/controller tests for contrast selection, production
  submission, rating, advance, Undo aliases, and state-specific availability.
- Preserve the existing invariant tests in `tests/session-selectors.test.ts`,
  `tests/session-bucket-state.test.ts`, and `tests/session-finalization.test.ts`.
- Perform a browser keyboard-only walkthrough across recognition, production,
  contrast selection, an incorrect response, Undo, notes, and shortcuts.
- Run the focused tests plus `npm run build`.

### Non-goals

- No information-architecture replacement or general restyling.
- No scheduler, rating, reinforcement, drain, completion, reflection, or
  authorization-policy change.
- No mobile-specific interaction design.
- No generalized command palette, shortcut customization, or design system.
- No home-page, Priority-page, reflection-history, or content-diagnostics
  redesign beyond a change strictly required by the active-session contract.

### Dependencies and overlap

The slice is frontend-heavy and should remain compatible with the current
hosted-beta service-boundary implementation. Revalidate overlap with any active
change touching `useStudySession.ts`, `StudySessionPanel.tsx`, session CSS, or
the app shell before dispatch. It does not depend on SWI-28 tooling research.

### Stop for human input

Stop if implementation evidence shows that making the grammar coherent requires
changing rating meanings, contrast confirmation semantics, Undo scope, covering,
drain behavior, finalization, or reflection eligibility. Those are product
contracts rather than UI cleanup.

## Later bounded slices

1. Reorient Home around the returning learner's next study decision; demote raw
   backend/database/prefetch diagnostics without removing needed dogfood access.
2. Clarify stop-intake/drain, completed-but-undoable, finalization, and reflection
   status so the learner can see what completed and what remains optional.
3. Make Priority selection and bulk entry keyboard-operable and discoverable.
4. Separate learner reflection work from run metadata, quality analysis, and
   primitive content diagnostics without a big-bang navigation rewrite.
