# Developing and adapting prompts

Use this guide when creating, adapting, or reviewing a model prompt. Its purpose
is to preserve demonstrated teaching and judgment quality while changing the
software contract, and to make deliberate behavioral experiments reviewable.

## Start from the closest working prompt

A proven prompt is a behavioral asset. Before drafting, find and read the
closest working prompt in full, along with its caller, input/output schema,
relevant contract, and evidence of its results. Look through its lineage when
the current file does not explain a consequential choice. Name the baseline
file and revision in the task or review so the comparison is reproducible.

Identify what makes that prompt work: its communicative strategy, linguistic
philosophy, reasoning sequence, examples, teaching style, and treatment of
uncertainty. Carry those elements into the adaptation. Their value may depend
on how they work together, rather than on isolated rules.

Distinguish the model's reasoning needs from the reader's attention budget.
Learner feedback can require careful linguistic assessment while presenting
only a concise, useful lesson. State that editorial goal, separate internal
judgment fields from learner-facing prose, and illustrate what earns space in
the lesson. A request for brief output is not a reason to abbreviate the prompt's
reasoning guidance.

For example, the [legacy pure-cue promotion prompt](../server/reflection/prompts/pure-cue-promotion.md)
explains transferable language sense and natural production patterns before
its detailed judgments and examples. The
[vocabulary promotion prompt](../server/vocabulary/reflection-prompts/pure-cue-promotion.md)
has a different call contract and narrower responsibility. Compare their
linguistic guidance separately from their input fields and allowed actions;
the legacy word-reconciliation actions do not belong in the vocabulary call.

## Adapt the contract explicitly

Map the old inputs, outputs, responsibilities, and examples to the new call.
Change field names, identifiers, available evidence, and allowed actions where
the caller requires it. Preserve the reasoning and examples that teach the
model how to judge language, including examples whose old output actions need
translation into the new contract.

A narrower responsibility does not justify compressing the linguistic guidance.
Shorter text is not an independent quality goal. Avoid replacing a working
explanation with a terse checklist or a newly invented rubric merely because
the new call looks simpler. Remove material when it is irrelevant, contradicted
by the authorized behavior, or demonstrably harmful. Identify each removed
section and its reason in the review; distinguish contract changes from
behavioral changes so reviewers can assess both.

When a proposed edit changes what counts as useful practice, natural language,
or good teaching, treat it as a behavioral experiment. Explain the uncertainty,
evidence, and proposed comparison to Justin before implementing an unresolved
learning-policy choice. Routine adaptations within the agreed behavior can
proceed without a separate approval ritual.

## Compare behavior with retained evidence

Use fixture-backed comparisons with the same inputs and frozen baseline calls.
Preserve exact rendered messages, input records, schemas, prompt revision or
hash, model and settings, raw outputs, and review judgments. Where contracts
differ, retain both exact calls and explain the input mapping. Include the
motivating failures, unseen related cases, and already-good controls; a few
examples establish bounded evidence rather than a reliability estimate.

Distinguish structural validity from linguistic quality. Tests can establish
schema and caller behavior; a test asserting that prompt phrases are present
does not establish good judgments or teaching. Inspect generated results and
retain operator review, including disagreement and uncertainty. A failed
generation is evidence to investigate, not a retrospective gold answer.

Report which contract changes were verified, what behavioral comparisons were
run, what the operator judged, and what remains untested. Separate prompt
implementation from observed provider behavior and deployed learner outcomes.
