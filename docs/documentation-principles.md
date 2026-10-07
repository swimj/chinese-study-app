# Documentation principles

Documentation should let a reader recover the system's model, understand its
promises, find the implementation, operate it safely, and see why important
decisions were made. It should make the next change easier to reason about.

These principles set a target for new and touched documentation. They do not
certify that the existing corpus is accurate or require a repository-wide
cleanup before development continues.

## Write for understanding

Organize entry points, links, and ownership so an agent can find the relevant
context without loading everything. Write the explanations for a human reader:
a reader with a systems/database background should be able to reconstruct the
model without decoding agent shorthand or replaying implementation sessions.

- Explain the important entities, relationships, state transitions, and
  boundaries before listing files or exceptions.
- Explain causes and tradeoffs: why a boundary exists, what it protects, and
  what would break if an assumption changed. Preserve useful examples.
- Use precise terms and normal prose. A directory inventory, checklist, or
  execution log is useful supporting material, but rarely explains a system.
- Keep reading order separate from authority. Human getting-started and agent
  task-routing entry points can differ while pointing to the same owning
  explanations. Avoid parallel instructions that accumulate required reading.

## Distinguish promises from descriptions

Different sources answer different questions:

- **Contracts** state intended guarantees and constraints: what should remain
  true, including behavior the implementation may not yet satisfy.
- **Implementation descriptions** explain how the system works today, its
  mechanisms and limitations, and where to find the relevant code.
- **Code** determines actual behavior. **Tests** show which behavior is checked
  under their conditions; passing tests do not establish every guarantee.
- **Rationale and history** explain decisions, rejected alternatives, and the
  context in which a choice was made. Plans and exploratory notes retain their
  provisional or dated status.

Contracts must express intent independently of the current implementation.
Changing a promise merely to match the code removes the very discrepancy the
contract should help reveal. Descriptive documentation is equally valuable:
it can explain today's behavior and identify a gap without redefining the
promise. Operations guides should distinguish required safety conditions from
the current commands and mechanisms used to satisfy them.

These are roles for content, not a required file taxonomy. One document can
contain a model, a contract, implementation detail, and rationale when the
sections make their roles clear. Split it only when that improves ownership or
reading. The [documentation index](README.md) describes the existing layout;
a filename or directory alone does not settle a passage's authority.

## Reconcile disagreements deliberately

The task and its clarifications supply execution scope. When code, tests, and
documentation disagree, identify the claimed promise, observed behavior, and
evidence before deciding what to change. Fix a clearly stale description within
scope. Apply an explicitly authorized behavior change to the owning contract,
implementation, and relevant tests together. Raise a consequential unresolved
product or architectural choice for human judgment; continue independent,
well-defined work.

Existing specifications can also preserve accidental implementation choices or
superseded intent. Their canonical designation identifies where intended
behavior belongs; it is not proof that every sentence reflects a deliberate
decision. Recover that intent incrementally from the model, rationale, history,
and explicit decisions. Do not blindly make code win, silently repair code to a
suspect spec, or convert uncertainty into a new guarantee.

## Maintain the owning explanation

Before adding a durable document, identify the distinct question it answers and
the explanation it will own. Extend an existing owner when the new material
belongs there.

Prefer updating the current explanation in place when the model or behavior
changes. Useful summaries should link to the owner rather than maintain a
second full account. Give a reader enough context at each entry point to choose
the next document without copying its rules.

Preserve important reasons and history in clearly labeled sections or linked,
dated records. Keep execution detail in the PR or task that produced it unless
it carries durable understanding. Working notes can support discovery, but
their useful conclusions should graduate into the owning explanation. Avoid a
trail of cleanup reports that readers must assemble to discover current truth.

## Improve alongside development

The aim is to stop adding avoidable confusion and converge incrementally.
Make a best effort to keep documentation coherent when changing an area, with
effort proportional to the change. Favor a useful local improvement over a
wholesale rewrite or a new documentation framework.

Imperfect compliance and known drift are expected during the transition.
Report meaningful unresolved gaps without claiming a broader audit. These
principles introduce no blanket hard merge gate for documentation completeness
or perfection; existing task-specific correctness, data-safety, and release
requirements still apply.

## Future custodial work

Two complementary kinds of maintenance would help the corpus converge:

1. **Change-based review:** review merged code and documentation together for
   descriptions that fell behind, explanations that became misleading, and
   contract edits that quietly weakened or changed a promise to fit the code.
2. **Bounded exploration:** start from a feature, concept, or document and trace
   a limited slice through explanations, contracts, code, and tests. Look for
   older inconsistencies beyond the latest diff. Seed selection can mix
   coverage with areas of higher risk or frequent change.

Each pass should have a bounded question and report the evidence and what it
did not establish. Small, clear descriptive corrections can be proposed as
focused patches; ambiguous promises or consequential behavior changes need a
human decision. Agreement between code and tests alone cannot justify a spec
change.

Keep enough context about known discrepancies and deferred decisions to avoid
repeated rediscovery or repeated alerts. Prefer the owning document or an
existing linked issue/PR; avoid a second permanent task system. Retire that
context when the discrepancy is resolved or no longer relevant.

This describes the intended custodial approach only. Cadence, implementation,
permissions, and automation activation remain separate decisions. Apply the
principles to a bounded product area next to learn what is useful in practice.
