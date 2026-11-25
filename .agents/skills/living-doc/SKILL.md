---
name: living-doc
description: Run a document that evolves over a discussion as a living doc, with Settled, Observed and Open items, a batch of feedback awaiting a holistic rewrite, and a decision log. Use when Justin says "living doc", "make this a living doc", "batch this for the rewrite", or "do the rewrite", or invokes /living-doc.
---

# Living doc

A living doc stays coherent while a discussion changes it. The pattern
combines decision records (ADRs) with capture-then-consolidate: decisions are
logged, and new thinking is collected and folded into the body in one pass, so
the document never becomes a "frankendoc" of many small edits.

## Structure

- **Status line** near the top: this is a working document, and what the
  markers mean.
- **Purpose and audience**: who uses it and which documents own neighboring
  topics. Link to those documents rather than restating them.
- **Body items**, each marked:
  - **Settled**: decided with Justin.
  - **Observed**: what currently exists, with a date.
  - **Open**: a question.
- **Principles apart from tradeoffs.** Keep lasting principles separate from
  temporary tradeoffs (for example, a "Prototype-stage tradeoffs" section), so
  a description of the current state is not recorded as a rule.
- **Feedback awaiting the rewrite**: the batch, described below.
- **Decision log**: a table of date, decision, and source. It only grows.

## Working in the document

- **Small factual corrections** go straight into the text.
- **Anything bigger** (new thinking, feedback, a reframing) is appended to
  "Feedback awaiting the rewrite" as a dated entry. Do not edit it piecemeal
  into the body.
- **Nothing becomes Settled without Justin's agreement.** Record the decision
  in the log when he agrees.
- **Observed items carry a date.** Refresh them when the system changes.

## The holistic rewrite

Justin or the agent may call it when the batch is big enough. The rewrite:

1. Folds every batch entry into the body in one coherent pass, resolving
   conflicts between old and new text.
2. Empties the batch.
3. Keeps the decision log, adding entries for decisions the pass settles.
4. Reports what changed in substance and what remains Open.

## Starting or converting

- **Start**: create the skeleton with the status line, purpose and audience,
  the marked sections, an empty batch, and an empty log.
- **Convert an existing document**: add the missing status line, batch, and
  log without rewriting the body. Mark existing items only where the evidence
  is clear, and leave the rest for the first rewrite.

## Where it lives

A living doc that guides repo work belongs in the repo, next to the code it
shapes. Link it from where agents look: the relevant README and the
[AGENTS.md](../../../AGENTS.md) routing. If the repo is public, never quote
personal data from the discussion; describe the decision instead.

Follow the [documentation principles](../../../docs/documentation-principles.md)
for tone.
