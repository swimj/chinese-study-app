# Sense reconciliation operator evaluation

This record describes the user tasks exercised for the sense/content reconciliation
feature, the evidence obtained, and the limits of that evidence. It is not a hosted
repair or deployment certificate.

## Task and environment

The prospective evaluation covered comparing four synthetic 挂钩 teaching uses with
three canonical senses, saving an unsupported linguistic decision, applying a
supported map/reject/default-selection decision, and understanding replacement
readiness. Adjacent checks covered unsaved navigation, keyboard use, narrow layout,
and recovery through a subsequent resolution.

The `reconciliation` testbed uses the actual operator shell, HTTP routes and an
isolated SQLite database. Provider generation is disabled. Save, reload and apply
are real operations on synthetic records; replacement readiness must remain pending.
No production records or services were changed.

The first independent pass used frozen source based on main `575c7c3c` plus the
feature changes (snapshot SHA-256
`d73a2b277fcc0200bb6196380ef91c7b9c6f8ac63317b11a66d6ec690f5bf62c`).
The evaluator received the task brief and environment instructions without the
implementation discussion. It used browser interaction only and reported no source,
filesystem, API or network-response reads. Source work continued against a separate
checkout while the frozen fixture remained unchanged.

## Observations and response

- Notes, expanded examples and default checkboxes supported comparison of the
  teaching uses and canonical inventory.
- An unsupported fourth-sense decision survived reload with its mappings, reasons,
  rationale and requested change. Apply remained disabled; live replacement had
  not started.
- A supported three-sense resolution applied and displayed separate teaching and
  repertoire pending states. Applied decisions were read-only.
- Unsaved sidebar navigation prompted for discard; dismissing preserved the edit.
  At 520 by 800 pixels, navigation collapsed and text remained readable. Keyboard
  Tab reached Save draft with visible focus.
- The initial preview used past-tense retirement wording before apply. It now says
  “Will retire” before application and “Retired” afterward.
- Required reasons were discoverable only after saving. Fields now name the
  requirement for application while still permitting incomplete drafts.
- Opaque affected-content identities were insufficient for inspection. The final
  disclosure adds readable content summaries alongside stable identities.
- A new draft during pending replacement originally lacked teaching evidence.
  Subsequent cycles now retain the last reviewed teaching evidence when no current
  replacement pointer exists, while capturing current inventory/dependencies.
  Progress and retry remain associated with the previous applied authority.

The missing-operation wording deliberately names a handler: this workflow serves
an operator who also closes implementation gaps. Word-level blocker labels display
the word rather than the fixture identifier.

## Verification limits

The evaluator could not establish enlarged-text behavior: its zoom shortcut caused
no visible change. One app Reload interaction timed out, so that particular discard
path is not certified; separate sidebar discard protection was observed. No actual
provider quality, production latency, or hosted learner behavior was evaluated.

Deterministic tests exercise real workers with controlled providers, publication
fences, rollback, replay, stale versions, retry across later drafts, and retained
session behavior. The full suite passed 2,579 tests with one skipped test and one
existing TODO. The application build passed. A populated hosted-copy migration
rehearsal remains release work under the migration runbook.

The independent evaluator's follow-up was blocked by browser availability before
it touched the final fixture. The implementation coordinator performed the targeted
browser regression check instead: required reasons and future-tense consequences
were visible; affected items included readable summaries; save/apply succeeded;
a later draft retained all four teaching uses and prior judgments while replacement
remained pending; saving and applying that later resolution also succeeded. This
follow-up is implementation-informed verification, not another independent pass.

## Operator-selected grouping follow-up

The operator requested that teaching uses align with their chosen canonical sense.
The comparison now groups uses by explicit operator assignments, including multiple
uses per sense, with separate unassigned and excluded groups. No automatic semantic
matching is performed. A fresh UI-only evaluator verified assigning two uses to one
sense, remapping, exclusion/restoration, reason preservation, focus staying on the
moved selector, Tab advancing to its reason, and saved grouping surviving reload.
The build passed for this UI-only follow-up.
At 600 by 850 pixels the groups stacked, and wrapped descriptions, controls,
expanded Chinese/English examples and reasons remained readable. No defects were
observed in the grouping pass; application and provider behavior were outside it.

## Compact drag matching and optional reasons

The next operator iteration replaces expanded use forms with compact cards and
move handles. Drag targets accept matching, exclusion and return to unassigned;
click/keyboard destination buttons and a Details selector provide alternatives.
Notes, descriptions and examples are disclosed on demand. Both per-use reasons
and the overall rationale are optional, including at the application boundary.

A fresh UI-only evaluator verified native pointer dragging, click-based remapping,
exclusion and unassignment, Space/Return keyboard operation, and readable details.
It completed all four mappings and saved/applied without entering any notes:
Resolved/Ready became Applied/Pending, retiring the four fixture content items.
Starting another resolution retained editable mappings and pending replacements.
The build, 12 domain tests (including no-reason apply), and three HTTP tests passed.

## Needs attention integration

Reconciliation now lives in Content improvement > Needs attention. The separate
rail entry is removed; its old URL opens Needs attention. The synthetic fixture
contains two source-mapping failures sharing one resolution and an unrelated
same-word provider failure. Grouping preserves every original record; expandable
individual cases expose the shared source and both preparation records.

A fresh browser-only evaluator, without source/API inspection, verified grouping,
inspection of both records, and separate navigation to the unrelated failure. It
mapped all four uses, saved without reasons, left and returned with mappings intact,
and applied. Refresh retained the grouped item with both replacements pending.
Unsaved matching disabled queue navigation, type filtering and Refresh; switching
review tabs prompted, and cancel preserved edits. Layout and independent scrolling
worked at 1280 and 760 pixels. The old route opened Needs attention without a
separate reconciliation sidebar entry. No defects were observed in that scope.
Browser-level reload/beforeunload, enlarged text and keyboard-only operation were
not rechecked in this pass.

The build passed. The full suite passed 2,585 tests, with one skip and one existing
TODO. A subsequent focused queue regression also passed (18 attention tests total):
a new scope mismatch after completed reconciliation re-enters attention with an
explicit instruction to start another resolution. Completed covered failures leave
the active queue while retaining their records; unrelated failures remain separate.

## Correction: group by replaced source

Justin identified that the fixture's supposedly unrelated generation failure used
the same teaching source. The preceding evaluation accepted the wrong grouping
expectation. Preparation failures now share the reconciliation when their source
is covered by its replacement, regardless of error label. Failures outside that
source remain separate; completed replacements remove covered failures from active
attention while preserving their original records.

All 19 focused attention and testbed tests passed. The implementing agent verified
the corrected browser fixture shows one attention item and an expanded Individual
cases (3) disclosure containing both mapping failures and the generation failure
with their shared source. This correction was not rerun by the independent evaluator.

## Compact matching and drag edge scrolling

Removed inherited operator card spacing and put Details alongside labels. At
1142×774 with saved matches, and 1280×720 with unassigned uses, the three targets
and four teaching cards fit together after scrolling the heading out of view.
Native dragging to a visible target succeeded in the isolated fixture. Drag start
no longer inserts destination buttons that shift the layout; click/keyboard move
selection still exposes those buttons. The existing user's saved choices remained
intact. Narrow/enlarged-text layouts were not rechecked in this pass.

The browser regression at `/tests/browser/drag-edge-scroll.html` runs the production
hook against a real scroll pane with synthetic drag events. It passed center
no-scroll, held upper/lower edge scrolling, and stop-on-drop/cancellation checks.
The automation's immediate native drag did not establish held-edge behavior; that
claim is supported by the synthetic event regression. Build passed.

## Canonical repertoire independent of replacement teaching

Post-reconciliation authoring now captures canonical definitions, retained examples,
and sense versions at application. The real practice worker consumes this snapshot
without a teaching source. Ordinary first-learning preparation retains its existing
source requirement and publication path. Completion still requires both replacements.

Controlled-provider tests exercise repertoire finishing before teaching, exact
selected-sense evidence and bindings, retry without a teaching pointer, no duplicate
bootstrap when teaching subsequently arrives, and rejection after authority drift.
Independent backend review caught a completion-order defect: teaching finishing
second also needed to settle the repair inside its publication transaction. The
fix and practice-first completion checks passed reviewer revalidation.

The populated migration fixture checks preservation of queued/running/ready/failed
ordinary jobs, leases, attempts and retry metadata, batch rollback, reopen/replay,
fresh-schema parity and SQLite integrity. Provider responses are simulated; no
hosted migration or real provider generation is established by these checks.

The attention fixture's canonical-job detail was rendered at 480px with enlarged
text: it shows the reconciliation identity instead of a blank teaching source.

Final verification: build passed; full suite passed 2,616 tests, with one existing
skip and one existing TODO. Older HTTP/session fixtures were updated to apply the
real reconciliation migration after the first broad run exposed missing schema.
