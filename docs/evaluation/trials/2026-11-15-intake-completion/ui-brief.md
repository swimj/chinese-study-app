# Completion UI evaluation brief

A Mandarin learner adds words and discusses their senses in the Words chat.
Check whether waiting, a completed reply, and recovery are understandable and
whether normal keyboard interaction still works.

Preview: http://127.0.0.1:4221/tests/browser/vocabulary-intake.html?slowChat&largeText
Use 760px width initially and also a narrower view. The app shell, controls and
stream parser are real; vocabulary, provider responses and persistence are
simulated in memory. Reload resets the fixture. Provider quality and hosted
persistence cannot be evaluated here. Chrome CDP is at 127.0.0.1:9229; use a new
tab. Source files are frozen during the pass. Do not read implementation source.

Tasks:
- Add 纠结, watch the wait, then discuss why the senses are included and request
  only the second sense. Assess the final explanation/card relationship and
  keyboard access without duplicate card controls or residual progress.
- Use fixture failure controls to experience a failed message and recover it.
- Experience an interrupted reply and reconnect/retry it, checking that the
  result is not duplicated.
- Inspect an existing-word new-sense proposal using the same URL with
  &existingSense and the input 蒸馏 in AI. It should await explicit confirmation.
- Explore narrow layout, enlarged text, focus and readable progress/error text.

Report attempted tasks, concrete observations, failures/uncertainties and limits.
Save screenshots in the evidence directory supplied by the coordinator. First-pass
findings must be independent. Ask the coordinator to fix infrastructure if needed.
