# Initial reflection Graphite stack task spec

status: active
type: work-bundle
created: 2026-07-29
retire-when: SWI-16 is integrated and the Graphite trial has been evaluated
related:

- SWI-16
- [`PLANS/initial-reflection-steel-thread.md`](../../PLANS/initial-reflection-steel-thread.md)
- [`SPECS/reflection-proposals-and-handles.md`](../../SPECS/reflection-proposals-and-handles.md)

## Purpose and authority

This note is the execution contract for delivering SWI-16 as a local Graphite
stack. It governs delivery structure and review mechanics only.

Product behavior and architecture remain governed by the accepted milestone
plan and canonical reflection specification linked above. Their scope,
non-goals, invariants, done criteria, verification requirements, and stop
conditions remain authoritative. If this note conflicts with either document,
follow the authoritative document and report the conflict.

All branches and any eventual pull requests produced by this work belong to the
one SWI-16 portfolio issue. The number of branches does not create additional
Linear issues or imply additional product outcomes.

## Outcome

Implement Slices 1–5 of the initial reflection steel thread as a dynamically
structured Graphite stack. The complete stack must explain the implementation
in coherent, independently reviewable logical units while preserving the
milestone's end-to-end outcome.

The implementation plan gives the intended behavior, architecture, constraints,
and approximate sequence. Its slices do not prescribe a one-to-one mapping to
Graphite branches.

## Human setup and required preflight

The human will install and initialize Graphite before dispatch. The worker must
not install or upgrade Graphite, authenticate it, initialize or reinitialize
the repository, reset Graphite state, or perform destructive recovery without
explicit authorization.

Before deciding the stack structure or editing files:

1. Read `AGENTS.md`, the milestone plan, the canonical specification, and this
   note.
2. Confirm the installed `gt` version and consult that installed version's CLI
   help for every topology-changing command whose behavior is not already
   certain.
3. Verify the configured trunk, a clean working tree, and the repository's
   current Graphite topology.
4. Inspect how any Codex-created starting branch relates to trunk and to
   Graphite's tracked branches.
5. Inspect the relevant implementation and test seams before proposing the
   initial stack shape.

Keep the entire stack in one isolated Codex task worktree. Do not spread one
stack across multiple worktrees. When the pre-created task branch is not
already in the needed topology, use a Graphite-aware approach such as
`gt track` or `gt create --onto` only when appropriate for the installed
version and confirmed by its CLI help. Do not improvise with Git operations
that leave Graphite's stack metadata inconsistent.

## Human-guided orientation checkpoint

Begin with orientation, not an opaque one-shot implementation. Before
substantial implementation, report:

- the verified Graphite version, trunk, worktree state, and starting topology;
- the relevant code and test seams for Slices 1–5;
- the proposed first review unit and the likely stack direction, without
  pretending the final branch count is already known;
- material dependencies, ambiguity, overlap, or review risks; and
- any product or workflow stop condition already implicated.

Wait for the human to confirm the orientation before proceeding through the
implementation. After confirmation, the stack may evolve without requiring
approval for every ordinary branch boundary, subject to the stop conditions
below.

## Stack design

The stack contains `N` branches, where `N` emerges from the implementation.
Optimize primarily for reviewer comprehension, not for a fixed branch count,
uniform diff size, or mechanical correspondence to plan slices.

A branch boundary is useful when:

- a coherent abstraction, representation, or behavior is complete;
- the next work moves to a distinct conceptual concern;
- the current unit can be meaningfully tested or reasoned about on its own;
- a small change has enough semantic weight to merit isolated review;
- later work depends on the current unit but is not needed to explain it; or
- the current diff is becoming cognitively expensive to review.

Do not create a branch merely because a plan bullet is complete, a line-count
threshold was reached, or work moved to another file. Avoid both giant
mixed-concern branches and trivial branches with no meaningful review value. A
larger branch is acceptable when it still reduces to one simple, cohesive idea.

Order branches so that each is a clear delta against its direct parent.
Foundational and broadly reusable changes should normally sit downstack,
followed by behavior, integration, and presentation where that dependency
order fits the implementation. A reviewer should be able to state each
branch's purpose in one or two sentences. The final stack should explain the
implementation rather than preserve the chronology of discovery.

Prefer one commit per Graphite branch unless there is a concrete reason for
more. Keep tests in the branch where they best explain and validate the
behavior. Keep intermediate branches buildable and testable where practical,
but do not add fake abstractions, temporary production behavior, or excessive
scaffolding merely to make every branch independently shippable.

## Incremental workflow

For each coherent review unit:

1. Implement the unit without sweeping in unrelated user changes.
2. Inspect its diff against the direct parent and check that it expresses one
   digestible purpose.
3. Run the relevant focused checks.
4. Stage only the intended files.
5. Use the installed Graphite CLI's supported `gt create` workflow to create a
   branch with a concise semantic name and commit title.
6. Continue the next unit on top of it.

Revise the structure as understanding improves. Split an oversized or
mixed-concern branch, combine artificially separated units, insert a discovered
prerequisite at the correct point, or reorder branches when dependencies become
clearer. Use Graphite-aware operations confirmed by installed CLI help and
preserve a valid stack.

When correcting completed work, check out the earliest branch to which the
correction logically belongs, apply the correction there, use `gt modify`, and
restack its dependents. Resolve genuine conflicts carefully and rerun all
checks affected upstack. Do not accumulate every correction at the stack tip
merely because it is convenient.

Use direct `gt` CLI commands for all Graphite operations. No Graphite MCP
integration is required.

## Local-only boundary

Construct and verify the complete stack locally. Do not:

- push any branch;
- run `gt submit` or any equivalent publication command;
- create pull requests;
- merge the stack;
- squash the completed stack into one branch; or
- alter remote repository state.

The human will inspect the local stack and perform the initial submission.

## Verification and final handoff

The milestone plan owns behavioral verification. In addition to its focused
coverage, full `npm test`, `npm run build`, documentation consistency, and
manual study-mode requirements, finish the Graphite trial by:

1. running `gt log short` and `gt log long`;
2. inspecting every branch as a delta against its direct parent;
3. revising any branch that is unnecessarily large, trivial, or mixes distinct
   concerns;
4. running the relevant full validation suite at the stack tip; and
5. leaving the working tree clean.

The final report must include:

1. branch names and commit titles from trunk to tip;
2. the purpose of each branch;
3. why each branch boundary was chosen;
4. which boundaries were judgment calls;
5. all focused and full checks run, with results;
6. unresolved gaps, deviations, or stop-condition decisions; and
7. the exact command the human can use to publish the stack after review,
   verified against the installed CLI help but not executed.

## Stop conditions

All stop conditions in the milestone plan remain in force. Stop and request
input rather than inventing policy when any of them is reached.

Also stop before implementation or topology mutation when:

- Graphite is missing, uninitialized, or configured inconsistently with the
  expected repository and trunk;
- the worktree contains changes whose ownership or intended disposition is
  unclear;
- the starting branch cannot be placed safely in a verified stack topology;
- the installed CLI does not support or clearly explain a needed
  topology-changing operation;
- continuing would require discarding user work, resetting Graphite or Git
  state, force-updating branches, or another destructive recovery action; or
- product ambiguity would require broadening a milestone non-goal or resolving
  a canonical design question speculatively.

## Suggested initiating Codex prompt

> Work on SWI-16 in the isolated Codex worktree already provided. First read
> `AGENTS.md`, `PLANS/initial-reflection-steel-thread.md`,
> `SPECS/reflection-proposals-and-handles.md`, and
> `notes/active/2026-07-29-initial-reflection-graphite-stack-task-spec.md`.
> Treat the plan and specification as product and architecture authority, and
> the task-spec note as the local Graphite delivery contract. Begin only with
> the note's human-guided orientation checkpoint: verify Graphite and worktree
> topology, inspect the relevant code and tests, propose the first review unit
> and likely stack direction, and report blockers or material ambiguity. Do
> not proceed into substantial implementation until I confirm the orientation.
> After confirmation, implement Slices 1–5 as a dynamically structured,
> local-only Graphite stack and satisfy the note's validation and handoff
> requirements. Do not push, submit, create pull requests, merge, or squash the
> stack.
