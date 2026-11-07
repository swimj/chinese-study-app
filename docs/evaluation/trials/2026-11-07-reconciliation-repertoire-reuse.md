# Reconciliation repertoire reuse evaluation

This record describes bounded checks of the teaching-use coverage policy. It is
not a production repair or provider-generation certificate.

## Coordinator brief and environment

The operator task was to account for all four synthetic teaching uses with three
canonical defaults selected, inspect the fully covered plan, leave one selected
sense without a mapped use and inspect that plan, then restore coverage, apply,
and reload. Expected consequences: complete coverage retains repertoire without
bootstrap; missing coverage requests whole-selection generation; applying complete
coverage waits only for teaching. Click/keyboard alternatives were permitted.

The real isolated reconciliation testbed ran at
`http://127.0.0.1:64866/operator/improvement?view=attention`, based on main
`729a915b` plus this change. Its disposable database persisted Save/Apply/Reload;
provider runtimes were absent and provider work disabled. Replacement generation
could not complete. No production state was changed. Runtime sources were frozen
during the evaluator pass; documentation/test-only work continued separately.

## UI observations

A fresh-context evaluator received the role, synthetic starting state, outcomes,
URL and browser-only restriction, without implementation conversation or source
excerpts. It reported no source/API reads. The coordinator received activity
summaries and findings; complete tool-trace independence was not audited.

- Complete coverage with the everyday-association use excluded saved as Resolved /
  Ready and showed `Repertoire: retain existing repertoire; no bootstrap`.
- Removing the hook use's mapping while leaving its canonical default selected
  showed `Repertoire: regenerate selected senses` after saving.
- Restoring coverage and applying showed `Teaching pending · Repertoire not_required`.
- Reload retained Applied / Applied / Pending and the same decisions and plan.
- Click-based Move/Match interaction worked without dragging.

No task-blocking finding was reported. The evaluator noted raw `not_required`
readiness text; it was changed to `not required` and verified by the coordinator
in the rendered applied state. The screenshot was captured inline by the
evaluator but not exported. Narrow/enlarged-text rendering and the optional
exercise-remapping disclosure were not independently rendered in this pass.
The synthetic fixture did not establish preservation of an existing generated
repertoire; controlled database tests cover that consequence.

## Deterministic evidence

Build passed. Full suite: 2,625 tests, 2,623 passed, zero failed, one existing skip
and one TODO. The reconciliation suite contains 23 passing tests, covering
retention with unchanged defaults, many-use-to-one-sense mappings, immutable
provenance, audited current sense-link updates, ambiguous/private blockers,
missing-coverage full generation, retry/publication fences, teaching completion,
restarted preparation and previously applied plan compatibility.

Independent backend review found and resolved a private-remapping boundary gap.
No schema migration or prompt change is included. Ordinary first-learning
preparation remains on its existing path. No hosted application or live model
call was performed.
