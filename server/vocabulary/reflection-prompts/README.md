# Vocabulary reflection prompt decomposition

`reasoning.md` is a faithful, standalone extraction of the linguistic guidance in
`server/reflection/prompts/staged-diagnosis.md`. It retains the detailed reasoning
and worked examples verbatim wherever they are independent of output schema and
routing: ideal productive capability, definition-gloss coherence, valid alternates,
pre-answer cues versus post-reveal teaching, natural evocation, and lexical-unit
integrity. The examples retain their linguistic judgments even where their former
operation or handoff instructions must change.

The call-specific contracts live in `feedback.md` and `improvement.md`. Feedback
produces a read-only learner lesson and bounded unfair-encounter judgments;
improvement produces an internal diagnosis and manually reviewed wording edits
with unchanged answer membership. Teaching issues remain a manual inbox. The
shared reasoning does not supply the old registered-operation schema, two-stage
ambiguity routing, learner-approval routing, or legacy input/output field names.
Suppression, contrast creation, and bootstrap remain diagnostic considerations,
not operations available to these calls. The new experience permits wording
variants and breadth, so the old requirement that each cue add a distinct
dimension is deliberately not carried forward.

This is a copied prompt source, not a runtime include of the legacy prompt.
Changes to the old file do not silently change either vocabulary call. The focused
preservation test checks selected retained passages and excludes obsolete schema
directives; it does not establish linguistic effectiveness or replace review.

Both prompts are versioned `vocabulary-reflection-<kind>.v1`; the exact composed
text, schema, projected inputs, settings and provider outputs are retained by the
common invocation ledger. No sense establishment or shadow evaluator is
introduced. Changes to core linguistic reasoning still require hands-on
experimentation; this extraction and contract adaptation makes no claim of
learner effectiveness.
