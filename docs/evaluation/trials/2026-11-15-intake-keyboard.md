# Intake keyboard verification — November 15, 2026

This check records the requested keyboard path between chat composition and
card suggestions. The keyboard-only interaction additions are one review unit
above follow-ups commit `99e023a1f3d40a949ca974e61e0010e013867332`.

The existing Enter/Shift+Enter, native tab order, button activation and modal
Escape behavior were preserved. The composer now gains focus on entering Chat
and sending with its button. Up from an empty composer focuses the latest card's
first available action (or the card if none is available). Arrow keys cycle its
available actions, Home/End select the first/last, and Escape returns to typing.
Ctrl/Command+Enter also sends. Specific sense shortcuts were not added; native
checkbox keyboard behavior remains available. An optional collapsed disclosure
lists the shortcuts.

The coordinator ran the [browser check](2026-11-15-intake-keyboard/browser-check.mjs)
against the actual application shell and frontend with simulated transport in
`tests/browser/vocabulary-intake.html`. Chrome ran at 760 × 900 with 125% text,
a 496px content panel. The script uses Chrome input events for navigation,
multiline input, sending, activation and dialog Escape; navigation setup and
selecting test text use DOM operations. IME safety is checked with injected
`isComposing` and legacy keyCode 229 events, not an OS input-method candidate
window. This distinction limits the IME claim.

Passed scenarios:

- Enter and Command+Enter send, Shift+Enter inserts a newline, and focus remains
  in the composer after sending, including activation through the Send button.
- Up reaches the latest card; arrows/Home/End reach suggestion buttons;
  Space selects the AI preset. Unavailable defaults are skipped in both
  directions. A nonempty draft keeps its normal text-navigation behavior.
- Add and Undo work from the keyboard and retain focus in the card when the
  activated control disappears. Escape returns to the composer. A streaming
  revision that moves the focused card also returns focus to the composer.
- Chat/Stash switching restores composer focus; Outstanding traps native tab
  focus, closes with Escape, and restores the opener.
- Tab reaches keyboard help, Enter expands it, and Shift+Tab returns to the
  composer. The expanded text wraps without horizontal page overflow.
- Composition Enter and legacy-229 events preserve the draft without submitting.

The coordinator visually inspected the [expanded help screenshot](2026-11-15-intake-keyboard/keyboard-help.png).
The production build and all four existing intake UI tests passed. Retained
[build](2026-11-15-intake-keyboard/build.log),
[UI test](2026-11-15-intake-keyboard/ui-tests.log), and
[browser](2026-11-15-intake-keyboard/browser.log) logs record those checks. No
backend or prompt changes were made. This focused pass does not establish
screen-reader behavior, mobile keyboard behavior, all browser engines, or a
hosted/live-provider end-to-end path. No separate evaluator was dispatched for
this bounded frontend change.
