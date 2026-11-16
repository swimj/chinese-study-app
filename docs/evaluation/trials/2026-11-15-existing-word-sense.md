# Adding a missing sense to an enrolled word — November 15, 2026

This report records the confirmation path for a learner who already studies a
word and requests a well-attested meaning absent from its shared inventory.
It extends the custom-senses stack above keyboard commit
`7873215783659be23a0283776afd1f9b188b36aa`. It does not establish deployment.

## Behavior and evaluation brief

The representative goal is to add AI model distillation to 蒸馏 while retaining
the learner's chemistry meaning, progress and schedule. A private proposal
appears in Chat and Outstanding. Its Add sense control creates a shared
non-default meaning and one learner take-up atomically. Existing overrides,
context and scheduling survive. The resulting card supports ordinary sense
selection; it does not offer enrollment Undo. Unstudied words wait for teaching
for their new set; taught words are not retaught.

The evaluation combines real database and HTTP tests, bounded live-provider
trials, a repeatable browser recovery/keyboard check, and a fresh UI evaluator.
Consequential expectations are no canonical write before confirmation, no
implicit replacement of the current set, safe stale/replayed commands, usable
outside-chat access and clear confirmation at enlarged text in a narrow panel.

## Prompt and live-provider evidence

Intake prompt version 6 / schema 2 adapts version 5 at the parent commit above.
It replaces the enrolled-word new-sense limitation with additive proposals,
clarification and explicit Add sense confirmation. The lexical reasoning,
editorial standards and worked examples remain intact. The same Responses
tool loop performs routing; no separate classifier or provider integration was
introduced. The prior model comparison still informs the Sol/low selection.

The [runner](2026-11-15-existing-word-sense/runner.mts) uses synthetic inputs and
an isolated database, with a 40-call cap. Nine scenarios used 15 calls to
`gpt-6-sol` with low reasoning, costing $0.04993 in the invocation ledger.
Observed turns took 0.94–4.48 seconds. These timings exclude downstream lesson
and exercise preparation; the trial does not estimate production latency or
population error rates.

All nine outcomes met coordinator review expectations:

| Scenario | Observed result |
| --- | --- |
| Missing meaning on an enrolled word | Additive sense proposal, existing sense retained |
| Missing meaning requested as a follow-up | Lookup and new proposal for the correct word |
| Clarify proposed meaning | Same private card revised |
| “Yes, add that sense” | Directed to Add sense; no confirmation through chat |
| “Only the AI sense” before confirmation | Explained confirmation followed by selection adjustment |
| Unsupported red-color meaning | Rejected without a proposal |
| Deadline meaning attributed to 过时 | Explained ownership by 过时不候; no invented fragment sense |
| New-word enrollment control | Ordinary proposal and Add boundary preserved |
| Meaning already in canonical inventory | Recognized existing selected meaning; no duplicate proposal |

The [provider archive](2026-11-15-existing-word-sense/provider-evidence.tar.gz)
retains the source revision and diff, prompt/hash, exact invocation inputs and
outputs, settings, costs, and before/after card outcomes. The database is excluded.
The archive passed an exact credential scan. The [provider log](2026-11-15-existing-word-sense/provider.log)
provides readable case summaries. Confirmation persistence is covered by the
deterministic tests; these live trials stop at the model's proposal boundary.

## Deterministic checks and review

- Final full suite: 2,917 tests, 2,911 passed, five skipped, one TODO, zero failures.
- Server TypeScript check and production build passed. The build retains its
  existing large-chunk advisory.
- Tests verify no pre-confirmation effects, additive preservation of explicit
  take-ups and exclusions, progress/schedule/context preservation, another
  learner's isolation, replay, stale selection reload, dismissed-word rejection,
  transaction rollback, duplicate detection, private clarification, unstudied
  preparation, waiting for an earlier deferred context match, and repairing an
  established empty inventory after the old senses were retired.
- The real Express/SSE test exercises proposal creation, outstanding attention,
  ownership, request validation, Add sense and receipt replay with a fake provider.

A separate Sol/medium code review identified missing duplicate/prerequisite
feedback, pending-match invalidation and a misleading context label. The
implementation now projects those blockers, waits for the earlier match, and
shows Sense added without assigning the new sense as the old context target.
Follow-up review found that the card blocked a valid addition to an established
empty inventory although the command allowed it. The projection was corrected
and a regression test added before the final full run.
The review is code inspection, not independent linguistic-quality evidence.
Shared-sense quality still relies on prompt judgment plus structural validation;
the private-context copy check is a heuristic, not a general sanitization proof.
Unaccepted proposals have no dismissal control. A proposal blocked by a duplicate
created elsewhere can remain in Outstanding after the learner selects that
existing sense on another card; proposal dismissal remains a lifecycle gap.

Retained logs: [full tests](2026-11-15-existing-word-sense/full-tests.log),
[server types](2026-11-15-existing-word-sense/typecheck.log), and
[production build](2026-11-15-existing-word-sense/build.log).

## Rendered interface

The coordinator's [browser check](2026-11-15-existing-word-sense/browser-check.mjs)
ran the production frontend in the application shell with simulated transport,
at 760 × 900 CSS pixels and 125% text. It passed additive proposal display,
keyboard activation, stale reload and renewed confirmation, both senses checked,
absence of enrollment Undo, Escape returning to the composer, and no horizontal
page overflow. See the [browser log](2026-11-15-existing-word-sense/browser.log).

A fresh Luna/medium evaluator used the rendered interface without reading its
implementation, with frontend source frozen. It verified proposal clarity,
Outstanding access before confirmation, both senses selected afterward, and
deselecting the old meaning. The coordinator inspected the
[Outstanding screenshot](2026-11-15-existing-word-sense/outstanding.png) and
[confirmed screenshot](2026-11-15-existing-word-sense/confirmed.png).
The evaluator's ad hoc key driver failed to activate the native button; inspection
found missing Enter text and an incorrect Space key code in that driver. The
retained browser check uses complete Chrome key events and passed Enter and
Space activation. When an action disappears, focus stays on the card, or returns
to the composer if streaming moves the card into retained history; Escape
returns to the composer in either case.

Rendered checks use a fixture, so they do not establish hosted authentication,
live-provider UI integration, screen-reader behavior, mobile keyboards or other
browser engines. Database preservation and provider behavior have separate
evidence above.
