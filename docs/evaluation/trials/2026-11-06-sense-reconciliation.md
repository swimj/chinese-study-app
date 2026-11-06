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
