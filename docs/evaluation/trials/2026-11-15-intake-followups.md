# Conversational intake follow-ups — November 15, 2026

This report lets reviewers assess conversational card edits, recent context and
confirmation boundaries in the seventh custom-senses review unit. It extends the
[custom-senses evaluation](2026-11-15-custom-senses.md); it does not establish
hosted deployment or production latency.

## Implementation and evaluation scope

Clear requests can select senses on an existing card, undo an eligible add, or
revise an unaccepted same-word proposal. Explanations and unsupported requests
remain text-only. New proposals still require the Add control. The backend
reuses learner commands, checks server-captured versions, and commits the
revision and its durable turn attachment together. Recent context contains up
to six turns and four live cards; it excludes historical provider reasoning and
tool authority.

The prompt adapts intake prompt version 4 at `793486560c611f5a3add694972d950b9c273f0b0`
to version 5 / schema 2. Its lexical reasoning, editorial standards and worked
examples are retained. The additions explain current-card authority, supported
revisions, clarification, historical text and confirmation. The existing
Responses loop performs routing and action selection; no separate classifier,
provider transport or dependency was introduced. Reflection is unchanged.

Evaluation covers named and ordinal references, explanation versus instruction,
Undo, proposal-only edits, unsupported scheduling/mastery, ambiguous targets,
new-word continuation, lexical clarification, historical instructions, and
invalid invented meanings. All provider inputs and databases are synthetic.
The runner caps each variant at 40 provider calls. No preparation worker runs
in these trials, so their timing excludes downstream teaching and exercise work.

## Live-provider findings

| Variant | Cases | Calls | Median turn | Slowest turn | Total ledger cost |
| --- | ---: | ---: | ---: | ---: | ---: |
| Sol low, first pass | 14 | 17 | 1.69 s | 4.17 s | $0.05826 |
| Sol low, corrected context validation | 14 | 17 | 1.53 s | 3.64 s | $0.05704 |
| Luna low, same corrected contract | 14 | 17 | 1.95 s | 4.71 s | $0.00298 |

The first Sol pass found a real integration gap: a clarification correctly
identified 接发球方, but the backend accepted requested spelling only from the
latest message. Validation now accepts verbatim learner spelling/context from
the retained exchange, while automatic enrollment still requires the current
message to authorize it. A deterministic test covers both sides of that boundary.
The first trial's written expectation for “second sense” incorrectly assumed
fixture insertion order; the actual displayed second sense is the conflicted
use. Sol selected the displayed second sense correctly. The runner expectation
was corrected before the next comparisons.

The corrected Sol run met the coordinator's expectations on all 14 cases,
including learner-facing explanations and the selected lexical target. Twelve
follow-ups needed one call; adding a new word took two, and resolving the tennis
clarification took three. Mean ledger cost was $0.00407 per turn in this small
run, with cache effects included; this is not a cold-request price or a guarantee.

Luna made the requested state changes correctly in most cases, but one named
earlier-card edit mixed a card ID with senses from another word and was rejected.
The clarification described 接发球方 while presenting 接发球. Two private-proposal
revisions omitted learner-facing text. Sol therefore remains the configured
chat model. These bounded examples do not estimate population error rates.

Four original first-message controls also passed structural and coordinator
review: listed context, larger-expression redirect, new shared-sense proposal,
and unsupported context. They used 10 provider calls total; observed times were
2.42–7.00 seconds. Existing first-message behavior remains consequential because
the same prompt and tool list now handle follow-ups.

## Deterministic checks

- Full suite: 2,907 tests, 2,901 passed, five skipped, one TODO, zero failures.
- Server TypeScript check and production build passed. The build retains its
  existing large-chunk advisory.
- Focused checks cover same-card history and replay, explicit Add confirmation,
  learner isolation, unsupported action rejection, stale concurrent edits,
  rollback on invalid turn attachment, interrupted-turn recovery, bounded
  context, earlier learner wording, and alternative-output batch validation.
- The real Express/SSE test verifies authenticated follow-up, same card identity,
  replay without a provider call or repeated mutation, and another learner's
  empty history. The initial sandbox-only run could not bind a local port; the
  full authorized local run passed it.

A separate Luna/high review of the uncommitted delta found no actionable
regressions. It inspected code and is not an independent model-quality judgment.

## Rendered interface

A fresh Luna/medium evaluator exercised the actual Words shell and production
frontend with simulated transport at 760 × 900 and 125% text. The task brief
covered explanation, sense revision, outstanding-card consistency, Undo/stash
removal, AI proposal confirmation and unsupported mastery. Frontend source was
frozen for the pass. Provider quality and database persistence are established
by the separate trials/tests, not this fixture.

The evaluator confirmed explanation without mutation, second-sense selection,
Undo returning the card to Proposed, AI-only selection still awaiting Add, and
unsupported mastery without a card change. Enter submitted from the composer.
The evaluator used rendered DOM observations and screenshots, not implementation
source; root then visually inspected screenshots. The first pass raised two
points:

- Repeated full cards made the transcript long. The frontend now renders each
  live card at its latest attached turn, retaining earlier prose. A coordinator
  rerun confirmed three cards across eight exchanges, with all selections intact.
- The sidebar Stash item retained Chat mode. This is the existing Words entry,
  not the Stash search/Chat toggle. The coordinator used the actual toggle and
  confirmed that 纠结 remained and the undone 帮派 was absent. No navigation change
  was made.

The final rerun measured a 496px chat panel, no horizontal page overflow, readable
wrapped long AI sense text, and the expected selected checkboxes at 125% text.
The build and four focused intake UI tests passed again after the presentation
change. See the [final screenshot](2026-11-15-intake-followups/followup-final.png)
and [proposal selection](2026-11-15-intake-followups/vocabulary-chat-followup.png).
These checks did not use a live provider in the browser, real Clerk credentials,
or a hosted database. The independent pass did not establish the Stash removal;
that observation belongs to the coordinator rerun.

## Retained evidence

The [runner](2026-11-15-intake-followups/runner.mts) and
[fixture](2026-11-15-intake-followups/fixture.json) reproduce the follow-up cases.
The [comparison](2026-11-15-intake-followups/model-comparison.json) records text,
timing and errors. The [evidence archive](2026-11-15-intake-followups/provider-evidence.tar.gz)
retains manifests, exact prompt/request/response snapshots, outcomes, the first
failed variant, original-message controls, and check logs. It excludes databases
and credentials. Manifests identify the parent revision and uncommitted evaluated
diff; the context module was untracked then and is included separately for the
corrected variants. The initial variant predates its learner-text quote extension.
