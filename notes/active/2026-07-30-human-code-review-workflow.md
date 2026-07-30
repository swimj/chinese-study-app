# Human code review workflow guidance

status: active
type: research
created: 2026-07-30
retire-by: 2026-08-27
related:
  - AGENTS.md
  - PLANS/project-steward-linear-trial.md
  - notes/README.md

## Purpose

Persisted guidance for how coding agents should behave when prompted to address review feedback on a graphite stack (accessed via github PRs).
Initially only applicable for the reflection steel thread.
Will evaluate the experience later and possibly turn this into a fuller-fledged document.

## Guidance

The current Graphite stack has been reviewed. A new batch of human review
feedback has been submitted through the Graphite web UI.

Your task is not merely to satisfy individual comments. Your task is to preserve
and improve the explanatory quality of the stack while addressing the feedback.

The repository, worktree, and Graphite stack already exist. Continue working in
the existing worktree. Do not create a new worktree or move the implementation
to a different one.

The reviewed stack boundary includes every branch in the integration line that
the human intends to merge, including later local-verification, debugging, or
workflow branches when they remain part of that line. At the start of a review
round, record the bottom and top branches of that boundary from `gt log`. Do not
silently exclude a branch merely because it was added after the original feature
stack.

----------------------------------------------------------------------
INITIAL CONTEXT
----------------------------------------------------------------------

Before making any changes:

1. Verify that the worktree is clean and that no other human, agent, or process
   is concurrently writing to it. This workflow assumes one writer at a time.

2. Inspect the current Graphite stack (`gt log`) and record the reviewed bottom
   and top branches.

3. Read all unresolved review comments and review summaries across the entire
   reviewed boundary, not only the current or top PR.

4. Group related comments into logical feedback items. Multiple comments may
   describe the same underlying issue.

5. Classify each feedback item as:

   - a correction that requires a code or documentation change
   - a direct question that can be answered without changing the stack
   - a design question that would benefit from a larger discussion

6. For each correction, determine which branch or branches logically own the
   affected abstractions, behaviors, or design decisions. One logical feedback
   item may require coordinated changes across several layers.

A review comment does not require a code change merely because it exists. Answer
a direct question with a concise reply in the pull-request thread when that is
sufficient. Do not manufacture a diff to demonstrate that the comment was
addressed.

If a question exposes a possible larger rethink and confidence would benefit
from back-and-forth, move the substantive discussion to the relevant Codex app
chat. Present the question, evidence, tradeoffs, and plausible options there,
and pause the affected implementation decision until the discussion reaches a
clear outcome. Do not conduct an extended design negotiation through pull-request
comments.

A comment's location is review context, not ownership.

The fact that a comment appears on PR 5 does NOT necessarily mean the fix belongs
in PR 5.

Instead, determine the lowest coherent branch that should own the correction.

Examples:

- foundational type or abstraction
    → branch that introduced that abstraction

- persistence concern
    → persistence layer

- behavioral algorithm
    → behavior layer

- API integration
    → integration layer

- UI concern
    → UI layer

Do not force fixes into earlier branches if doing so mixes unrelated concerns.

Likewise, do not accumulate every fix at the stack tip simply because it is
convenient.

----------------------------------------------------------------------
STACK QUALITY
----------------------------------------------------------------------

The stack itself is an important artifact.

While implementing feedback, continually ask:

"Would this stack still be the clearest explanation of how this feature is built?"

If review feedback reveals that a branch boundary is poor, you may:

- split a branch
- combine adjacent branches
- move work downward
- move work upward
- insert a new branch
- reorder branches

provided the resulting dependency structure is cleaner.

This trial deliberately accepts that restructuring an already-published stack
may rewrite branch and pull-request history or disturb the association of inline
review comments. Record the before-and-after branch mapping and surface any
review context that may have been displaced. Do not hide this cost merely to
make the resulting stack look tidy.

Optimize for conceptual clarity and reviewer comprehension.

Do not optimize for minimizing the number of branches.

Do not optimize for equal branch size.

A branch should correspond to one coherent idea.

----------------------------------------------------------------------
IMPLEMENTATION
----------------------------------------------------------------------

For every logical feedback item that requires a change:

1. Check out the branch that should own each change.

2. Implement the correction.

3. Update that branch using Graphite-aware commands.

4. Restack descendants.

5. Resolve genuine conflicts carefully.

6. Run the relevant tests for the modified branch.

After all requested code-bearing feedback has been addressed:

- run the complete validation suite at the stack tip
- inspect every modified branch relative to its parent
- ensure the stack still reads naturally from bottom to top

If any branch now feels conceptually overloaded or unnecessarily fragmented,
improve the stack before submission.

----------------------------------------------------------------------
SUBMISSION
----------------------------------------------------------------------

Submit the full updated review boundary using Graphite. Existing pull requests
should be updated and new branches in the boundary should receive pull requests;
do not use `--update-only` when new branches must be included. From the top of
the intended stack, `gt submit --stack --confirm` provides an explicit preview
and confirmation before pushing. Add `--draft` when newly created pull requests
should remain drafts.

Do not merge anything.

Do not mark remote review threads resolved unless the human explicitly requests
it. Report which threads correspond to each implemented feedback item so the
human can verify and resolve them.

----------------------------------------------------------------------
FINAL REPORT
----------------------------------------------------------------------

Provide:

1. A summary of every logical feedback item and whether it resulted in a stack
   change, a pull-request reply, or a discussion in Codex chat.

2. Which branch or branches each code-bearing item was implemented in.

3. Why those branches were chosen.

4. Any branch restructuring performed.

5. Direct questions answered in pull-request replies and any review comments
   intentionally left unresolved.

6. Tests and validation run.

7. Design questions moved to Codex chat, their current disposition, and any
   remaining tradeoffs that deserve human attention.

## Open questions

gut sense from the human

## Graduate when

when human has a better sense of merits/drawbacks of this review process
retire if undesired
refine and promote if promising
