# Follow-up interface evaluation brief

Role: adult Mandarin learner building a study plan. Evaluate the actual Words
shell and frontend with simulated provider/backend; do not infer model quality
or persistence guarantees from the fixture.

URL: http://127.0.0.1:4219/tests/browser/vocabulary-intake.html
Starting situation: Words → Chat, 纠结 recently submitted; 760 × 900 at 125% text.
Reset: reload the page, enter Words, then Chat. Source: parent 793486560 plus the
uncommitted follow-up implementation retained in this review unit. Frontend files
are frozen during the pass. Evidence: /private/tmp/custom-senses-share.

1. Ask why a sense is included, then request only the second sense. Check the
   selection in the transcript and Outstanding where applicable.
2. Add 帮派, undo that add in chat, and inspect Stash for removal.
3. Propose 蒸馏 for AI, request only the AI sense, and verify it still awaits Add.
   An optional earlier checkbox selection can probe chat/control consistency.
4. Request mastery; verify an explanation without a study-state change.

Check keyboard use and readable wrapping in the narrow panel. Save two useful
screenshots and report outcomes, defects/confusion, and fixture limits. Do not
read implementation source or change source/Git state. Use the coordinator's
CDP helper for UI control; ask for infrastructure repair if needed.
