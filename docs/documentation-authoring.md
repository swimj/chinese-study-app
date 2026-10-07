# Authoring and maintaining documentation

Use this procedure when creating or revising repository documentation. The
[documentation principles](documentation-principles.md) define the desired
structure and quality; this guide explains how an agent should produce it.

## Establish the question and destination

Identify the reader's question and the understanding the document should give
them. When maintaining existing documentation, consider how the proposed change
affects its answer. An update is warranted when that answer becomes inaccurate
or inadequate, or when the change creates a useful new question for the
documentation to answer. An implementation change may leave the maintained
explanations sufficient as they stand.

Where reader questions are still implicit, infer them from the document's
purpose, content, and place in the documentation tree. Make them explicit as
part of relevant cleanup. Treat these questions as a developing account of
reader needs; missing questions can reveal gaps in the documentation.

Choose the document or section responsible for the explanation and name that
destination in the proposed change. Related documents need revision where
their own answers are affected.

For example, a feature contract explains intended behavior; an implementation
guide explains the mechanisms that realize it; a runbook gives a procedure and
its safety conditions. Several related sections can share a file when each
section's purpose is clear.

## Interpret feedback through the intended model

Treat feedback as evidence about the understanding or outcome the user wants.
A complaint often identifies a symptom. Work out the underlying distinction or
relationship, then revise the explanation so the desired model is explicit.

For example, feedback that an old README overemphasizes local study should lead
to a clear account of current hosted learner use and separate contributor
setup. Feedback that planning documents feel stale should lead to a clear
account of how current decisions, task plans, and useful history relate.

Write the desired state directly: what each document explains, what the
system promises, how a procedure works, or what a reader should do. Use negative
boundaries only when they rule out a consequential, plausible misunderstanding.
For instance, "Do not rewrite a product promise solely to match the current
code" protects the distinction between intent and implementation.

When feedback leaves a consequential choice open, state the proposed model and
ask the user before encoding it as settled guidance. Once the model is agreed,
apply it consistently to related text within the task's scope.

## Make subjects and relationships concrete

Use named documents, sections, people, or components as sentence subjects.
"The feature contract defines the retry guarantee" assigns a clear job.
"The retry implementation guide explains the current state machine" makes a
different job equally clear.

Define important entities and relationships before listing files or exceptions.
Explain causes, tradeoffs, and useful examples. When presenting a hierarchy,
show the tree and say what its nodes and edges mean. Keep sibling categories
consistent so the reader can predict where another explanation would belong.

## Preserve intent while improving the account

Read the relevant contract, implementation, tests, and rationale far enough to
support the change. Distinguish an observed fact, a promised guarantee, a
proposal, and an inference. Follow the principles' reconciliation guidance when
they differ.

Improve the current explanatory document or section when it is the right
destination. Reorganize material when the target structure calls for a clearer
boundary. Retain useful decision rationale and label historical context so
readers can follow the current account.

## Review the resulting explanation

Read the revised text as a reader who has the relevant technical background but
has not followed the task conversation. Check that:

- it answers the intended question and explains the desired model directly,
  with each detail and reference contributing to that understanding;
- its subjects, terms, and destinations are concrete;
- any negative boundary protects a specific, meaningful distinction;
- promises, current behavior, evidence, and proposals are distinguishable;
- the hierarchy and links lead to the appropriate explanations; and
- the handoff states what changed, what was checked, and any material gaps.

For substantive conceptual feedback, review the outline and model before
polishing individual sentences. The finished text should stand on its own as
an explanation of the agreed model.
