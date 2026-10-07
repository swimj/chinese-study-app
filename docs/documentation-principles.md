# Documentation principles

Documentation should let a reader recover the system's model, understand its
promises, find the implementation, operate it safely, and see why important
decisions were made. It should make the next change easier to reason about.

This is the target standard for the repository's documentation, including the
hierarchy below. Define what readers need first; existing folders, document
labels, and accumulated content do not determine that target. Differences
between the target and the corpus are documentation gaps to uncover and repair,
just as differences between product contracts and code are implementation gaps.

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
- Keep reading order separate from authority. Human orientation and agent
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

## Target hierarchy and ownership

The hierarchy runs from orientation to system-wide understanding to focused
owners and their supporting references. It is independent of today's directory
tree. Each current explanation should have a clear place in it.

### 1. Thin entry points

- **Root README:** what the product is, how it is used now, what this repository
  contains, and where to go next. It does not own a second system model, an
  operations manual, or a catalogue of every supported command.
- **AGENTS.md:** how contributors execute work here: task scope, safety,
  conventions, verification, and delivery. It routes to product and technical
  owners rather than restating their rules or requiring the whole corpus.
- **Documentation index:** routes from a reader's question to the owning
  explanation. It distinguishes the target owners from existing sources that
  have not yet been reconciled with that target.

### 2. Product-wide model and guarantees

Own the product's vocabulary, important entities and relationships, end-to-end
learner lifecycle, and cross-cutting intended guarantees. A reader should be
able to explain what the product means and which promises survive a change of
implementation. This is the normative product model; current process topology,
module boundaries, and database organization belong in the technical account.

### 3. Feature and domain owners

Each bounded area owns its detailed model, lifecycle, and behavioral contract,
refining the product-wide model without duplicating or silently overriding it.
It explains what the area promises, why, and where its current realization and
known gaps are documented. Related contract and realization sections may share
a file only when their normative and descriptive boundaries are unmistakable.
A file that mixes unrelated ownership concerns needs restructuring, even when
its existing title or location calls it canonical.

### 4. Technical and operational explanations

- **Actual system architecture:** components, data flow, state and ownership
  boundaries, and the mechanisms that realize product guarantees today. Explain
  limitations and contract gaps explicitly. A directory map supports this
  explanation but cannot replace it.
- **Focused implementation references:** explain a subsystem, database, API,
  or other mechanism at the depth needed to change it. Link to the relevant
  promised behavior; current code paths do not define that promise.
- **Operations:** maintained procedures for running, releasing, diagnosing,
  and recovering the service, including required safety conditions and evidence.
  Contributor setup and tests are a separate route from learner use and hosted
  operations. Retired local-use workflows do not remain default instructions.

These owners can serve several features; links should make the relationship
clear without creating parallel full accounts of the same mechanism.

### 5. Rationale, working context, and history

Keep durable decisions and their reasons with the affected owner or in linked
decision records. Update the current explanation when a decision changes;
readers should not reconstruct current truth from a decision log.

Working plans and notes belong to the task that needs them. There is no required
permanent in-repository planning layer. Graduate durable conclusions into
current owners, and retain selected historical or exploratory material only
when it remains useful, labeled and outside the default reading route.

Product strategy and exploratory vision belong with one maintained planning
owner; link to that owner where context is needed. This repository needs the
accepted product model and relevant rationale, not competing vision or roadmap
copies. Existing locations and any unsettled disposition belong in the index.

This hierarchy specifies reader outcomes and ownership, not a fixed file count
or a requirement to preserve `SPECS/`, `PLANS/`, or any other existing folder.
The [index](README.md) records current routes and concrete nonconformance.

## Reconcile disagreements deliberately

The task and its clarifications supply execution scope. When code, tests, and
documentation disagree, identify the claimed promise, observed behavior, and
evidence before deciding what to change. Fix a clearly stale description within
scope. Apply an explicitly authorized behavior change to the owning contract,
implementation, and relevant tests together. Raise a consequential unresolved
product or architectural choice for human judgment; continue independent,
well-defined work.

Existing specifications can also preserve accidental implementation choices or
superseded intent. A canonical label is not proof that every sentence reflects
a deliberate decision. Recover intent from the model, rationale, history, and
explicit decisions. Do not blindly make code win, silently repair code to a
suspect spec, or convert uncertainty into a new guarantee. Reorganizing the
documentation does not itself change or retire existing product guarantees.

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

Keep the target clear while making progress proportionate to the work. New and
reworked explanations should aim at the target, not reproduce an old pattern
merely because it exists. Incremental adoption may leave known gaps; it does
not weaken the standard or bless untouched portions of a partly edited file.

Current adoption status belongs in the [index's dated gap inventory](README.md#known-adoption-gaps),
not in timeless claims that the whole repository is "in transition." Record
observed gaps and what would close them. Update or remove each entry when the
owning explanation is reconciled; once those gaps are closed, remove the
temporary inventory rather than preserving a standing transition disclaimer.
This is scoped evidence, not a second backlog or an exhaustive audit.

Make a best effort alongside normal development and report meaningful remaining
gaps. There is no blanket hard merge gate for documentation completeness or
perfection; task-specific correctness, data-safety, and release requirements
still apply. Tolerated drift is a condition to improve, not a target to retain.

## Future custodial work

Two complementary kinds of maintenance would help the corpus converge:

1. **Change-based review:** review merged code and documentation together for
   descriptions that fell behind, explanations that became misleading, and
   contract edits that quietly weakened or changed a promise to fit the code.
2. **Bounded exploration:** start from a feature, concept, or document and trace
   a limited slice through explanations, contracts, code, and tests. Look for
   gaps against the documentation hierarchy as well as older contract/code
   inconsistencies beyond the latest diff. Seed selection can mix coverage
   with areas of higher risk or frequent change.

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
