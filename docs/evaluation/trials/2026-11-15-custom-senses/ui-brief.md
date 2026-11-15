# Custom senses: learner task evaluation

## Purpose and starting situation

You are an adult Mandarin learner building a study plan from words you meet. Some words already have lessons; others need preparation. You can select meanings to study without changing another learner's choices.

## Preview

- URL: coordinator will supply the frozen preview URL.
- Fixture: actual Words navigation and add-word components, with deterministic synthetic transport; a separate real-backend pass verifies storage and command effects.
- Model replies and preparation completion are simulated in the UI fixture. Do not infer linguistic reliability or hosted readiness from them.
- Reset: reload the fixture. The coordinator will identify the source revision and screenshot destination before evaluation.

## Tasks and consequential expectations

1. Add 纠结 as a bare word. Establish whether it was added, what you will study, and whether its lesson is ready. Reverse the addition and verify that the study plan reflects that choice.
2. Add 帮派 from a movie discussion about young people loosely associated with a criminal organization. Study only the relevant meaning, then return to the defaults. Verify that the displayed choices and saved state agree.
3. Request 接发 for the person receiving a serve in tennis. Decide whether to accept the proposed full expression. It should remain a proposal until you accept it.
4. Add 蒸馏 for AI model distillation. Inspect the proposed meaning before accepting it. Reverse the addition: the learner's study-plan effect should disappear while the shared meaning may remain.
5. Add 绵长 with a sentence while its inventory is unavailable. Leave the chat, allow preparation to finish with an uncertain match, and find and resolve the outstanding item. Return to the conversation and verify that the same item reflects the resolution.
6. Revisit 宠溺, which is already being studied. Include its additional meaning. Existing study progress and schedule should remain intact, and no new lesson should be required.
7. Recover from a stale card and a failed save. Check whether the UI preserves your intended choice and makes the resulting saved state clear. An old Undo must not erase later study or edits.

Explore a one-sense word and a 16-sense word with long labels and notes. Repeat key tasks in a narrow desktop panel, with enlarged text, and using the keyboard. Check preparation updates without a new chat message and continuity after leaving and reopening the view.

## Evidence and return

Report attempted tasks, observed results, concrete reproduction steps, impact, uncertainty, and fixture limits. Capture screenshots of material issues and representative compact/expanded states. Keep first-pass conclusions independent of source code or implementation explanations; ask the coordinator to repair preview infrastructure rather than debugging it yourself.
