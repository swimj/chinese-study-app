# Development principles

These principles help contributors reason about implementation choices and the
quality of a change: recover intended behavior, preserve useful existing work,
and establish evidence that the application fulfills its promises. They apply
across features and delivery methods.

[AGENTS.md](../AGENTS.md) defines task scope, execution rules, and repository
conventions. The [PR delivery and Graphite workflow](stacked-feature-development-and-review.md)
explains how to organize, publish, and revise review units. The
[testing map](testing.md) routes to concrete verification tools and coverage;
[documentation principles](documentation-principles.md) guide the explanations
maintained alongside the code.

## Establish intent before choosing machinery

Start with the requested outcome and the owning product contract. Trace how the
application currently realizes that behavior and inspect the relevant tests.
Contracts state promises, code and observed execution establish actual behavior,
and tests provide bounded evidence. Use the
[intent and evidence guidance](documentation-principles.md#intent-evidence-and-disagreement)
to reconcile discrepancies; an implementation detail or passing assertion does
not by itself settle product intent.

Choose boundaries around coherent responsibilities and semantics. Use existing
architecture where it fits, and explain material new abstractions or machinery
through the problem they solve. When a consequential product or architectural
choice remains unresolved, bring the evidence and recommendation to Justin before
implementing that choice.

## Preserve behavior across implementation changes

Existing implementations and regression tests contain accumulated knowledge about
edge cases and interactions. When replacing a backend, controller, API, or UI,
use that knowledge to preserve the behavior the task leaves unchanged.

Before designing the replacement, trace the affected user action through its
components, policy, controller, and backend. Read the relevant tests, including
browser fixtures, for the scenarios and expectations they protect. Distinguish
authorized semantic changes from changes to transport, storage, or orchestration.
Reconcile disputed expectations with the owning contract and task rather than
treating either existing code or tests as unquestionable intent.

Keep unchanged behavior in its existing owner where the boundary fits. Adapt new
machinery behind an established interface, or extract the shared policy or
component when doing so preserves a coherent responsibility. For example, a new
save endpoint can use the existing action control and keyboard rules while its
adapter handles the new request and acknowledgement protocol. Different lifecycle
or learning semantics can require separate controllers; share only the behavior
whose meaning is actually the same. Explain material duplication in terms of
those differences, rather than the mere presence of a new backend.

Carry applicable regression scenarios and assertions into the replacement's
coverage. Adapt fixtures and invocation to the new boundary; preserve expected
outcomes unless the task authorizes changing them. Where separate implementations
share a contract, consider running the same behavioral cases against each adapter.
Retire obsolete API-specific checks when appropriate, accounting for the behavior
they protected. A test that only reaches a superseded implementation is evidence
about that implementation, not its replacement.

In the review description, identify the
behavior retained, the existing cases reused or adapted, and the checks that
exercise the replacement's wiring. Explain intentionally changed or retired
expectations and material gaps with concrete test or code references. A short
paragraph is sufficient for a narrow change.

## Make verification evidence match the claim

Choose checks that exercise the behavior and risks affected by the change.
Evidence from a shared policy, an adapter, and a running interaction answers
different questions. Establish that the current application connects the tested
parts correctly, using the testing map's
[active-path coverage guidance](testing.md#verify-coverage-through-the-current-application-path).
Aggregate passing test counts cannot establish that connection.

Keep verification proportional to the change and explicit about its limits.
A build establishes compilation, while interaction and visual claims need
rendered verification. Distinguish implementation, test results, publication,
deployment, and observed learner behavior in review and handoff evidence. Name
material gaps so a reviewer can assess what has and has not been established.
