# Documentation principles

## Purpose

Documentation should help a reader recover the product's model, understand its
promises, explain how the implementation works, operate it safely, and reason
about the next change. Clear models and causal explanations make that knowledge
useful to both humans and agents. A reader with a systems/database background
should be able to follow the prose without reconstructing an implementation
session.

The standard below describes the documentation we want. The target hierarchy
defines where each kind of explanation belongs; existing documents should be
assessed and reorganized against it.

## Documentation map

This is a conceptual tree of documents and document groups. The branches group
related explanations and show how readers reach them. They describe navigation
and content organization; the evidence section below explains how to reason
about authority and disagreement.

```text
Repository orientation (README)
├── Contributor guidance (AGENTS.md)
│   ├── Documentation authoring and maintenance
│   ├── Implementation, testing, and review
│   └── Specialized agent procedures
└── Application knowledge (documentation index)
    ├── Product models and promises
    │   ├── Shared concepts and guarantees
    │   └── Feature and domain models and contracts
    ├── Implementation explanations
    │   ├── System architecture and data flow
    │   └── Subsystem mechanisms and code references
    ├── Operations guides
    └── Decision and historical records
```

Each node may be a document or a small collection with a clear entry point.
Shared concepts can be explained across several coherent documents; feature
contracts refer to those definitions and develop the details for their area.
The logical relationships determine the useful file boundaries and locations.

The two main entry points answer different questions. **AGENTS.md** helps an
agent find instructions for conducting its work, such as writing documentation
or validating a change. **The documentation index** helps any reader find
knowledge about the application, such as scheduling behavior or persistence.
A procedure can link to the application explanations needed to carry it out.

## What each document group provides

Here, an explanation's **owner** means the named document or section that
maintains it. Use the document's name when assigning that
responsibility.

| Document or group | Reader's question | Content it maintains | Useful links |
| --- | --- | --- | --- |
| Repository README | What is this product and repository, and where should I start? | Brief orientation to the product's current use and repository contents | Contributor guidance and application documentation |
| AGENTS.md and contributor guidance | How should I carry out this task? | Execution scope, conventions, safety, authoring, verification, and review procedures | More specific guidance and the application explanations needed for the task |
| Documentation index | Where is the explanation I need? | Routes to product, implementation, operational, and decision documents | Current documents and their known coverage gaps |
| Shared product-model documents | What are the common concepts and promises? | Vocabulary, entities, relationships, learner lifecycle, and cross-cutting intended guarantees | Feature contracts that refine the model |
| Feature and domain documents | What does this part of the product mean and promise? | Detailed concepts, behavior, lifecycles, and guarantees | Shared definitions, implementation explanations, tests, and relevant decisions |
| Architecture and subsystem documents | How does the implementation work today? | Components, data flow, state boundaries, mechanisms, limitations, and code references | The product guarantees being realized, known gaps, and operational procedures |
| Operations guides | How do I perform this operation safely? | Preconditions, commands, checks, recovery steps, and required evidence | Relevant mechanisms and safety guarantees; distinct routes for hosted operation and contributor setup |
| Decision and historical records | Why was this choice made, and what context still matters? | Reasons, alternatives, accepted decisions, and selected useful prior context | The current explanation affected by each decision |

The product-model and feature-contract documents state intended behavior.
Architecture and implementation documents explain its current realization,
including gaps. Closely related contract and realization sections may share a
file when their subjects and roles are explicit.

For this project, **Steward** maintains the current vision and priorities, as
described in [the project context](../AGENTS.md#11-project-context-and-task-scope).
Working plans and investigation notes support the task that uses them. Accepted
product decisions become part of the relevant model or contract, with useful
rationale retained in the explanation or a linked decision record.

## Intent, evidence, and disagreement

Different sources answer different questions:

- **Contracts:** what the product promises and which constraints should hold.
- **Code and observed execution:** how the implementation actually behaves.
- **Tests:** which behavior is checked, under which conditions.
- **Rationale and decisions:** why a choice was made and what authorized it.

Contracts express intent independently of the current implementation.
Implementation explanations make mechanisms, limitations, and discrepancies
visible. Tests supply bounded evidence for the behavior they exercise.

When sources disagree, identify the intended promise, actual behavior, relevant
evidence, and any unresolved decision. Correct a clearly stale description
within scope. An authorized behavior change should update the relevant
contract, implementation, and tests together. Ask for human judgment when a
consequential product or architectural choice remains unresolved, while
continuing independent, well-defined work.

Existing specifications can preserve accidental choices or superseded intent.
A canonical label alone does not establish that every sentence reflects a
deliberate decision. Recover intent from the model, rationale, history, and
explicit decisions. Do not silently rewrite a promise to fit the code, repair
code to a suspect spec, or turn uncertainty into a new guarantee.

## How explanations evolve

A document's purpose determines what it maintains. Each document should
identify the reader questions it answers and the explanations it owns. Other
explanations belong elsewhere, with references where answering those reader
questions depends on them.

To decide whether information or a reference belongs, ask: if the reader does
not know this information, what question can this document no longer answer
adequately?

A change should require updates to other documents only when it changes an
explanation they own. As understanding changes, maintain and reorganize the
documentation toward these responsibilities. Choose file boundaries that keep
related concepts understandable and responsibilities clear.

Proposals should state the change under consideration, its reasons, and open
decisions. Once a proposal is accepted, incorporate the decision into the
current model, contract, or implementation explanation and preserve the
rationale that will help future readers. Retain useful prior context as dated
history linked from the current explanation.

A working note can preserve exploration or support a handoff. Its durable
conclusions should graduate into the appropriate explanation. The task or PR
can retain execution detail, while the maintained documentation tells readers
what is true, what is promised, and why.

## Coverage and maintenance

Keep the target clear and improve the corpus alongside development, with effort
proportional to the change. Report which explanations were checked and which
meaningful gaps remain. Documentation completeness alone is not a blanket merge
gate; task-specific correctness, data-safety, and release requirements still
apply.

Record current adoption evidence in the
[index's dated gap inventory](README.md#known-adoption-gaps): the observed gap,
the affected documents, and what would close it. Update or remove each entry
when its evidence changes or its closure condition is met. Remove the temporary
inventory once its listed gaps are closed. Detailed work belongs with the
relevant document or existing issue/PR.

Future custodial work should complement ordinary development in two ways:

1. **Change-based review:** inspect merged code and docs together for descriptions
   that fell behind and contract edits that changed a promise to fit the code.
2. **Bounded exploration:** trace a question from a feature, concept, or document
   through the documentation structure, contracts, implementation, and tests.
   Choose seeds to balance coverage with risk and frequency of change.

Each pass should state its question, evidence, and limits. Propose small, clear
descriptive corrections and raise ambiguous promises for a human decision.
Keep enough context about known discrepancies to avoid repeated discovery and
alerts, then retire that context when it is resolved. Cadence, implementation,
permissions, and activation of this future work remain separate decisions.
