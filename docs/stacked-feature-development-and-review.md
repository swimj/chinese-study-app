# Feature Development And Review

This document defines the default delivery and review model for implementation
work. Use it alongside the initiating prompt or a task spec; it is not itself a
task spec, a source of product behavior, or authorization to dispatch work.

Every implementation should be organized for review and normally finish as a
pull request. A cohesive change uses one branch and one pull request. When
several dependent review units would make the implementation easier to review,
the same model scales into a Graphite stack. The branch count is an agent
judgment, not a requirement for either one branch or several.

Standalone research, planning, and documentation-only work is not presumed to
need a pull request. It may return through its Codex task unless the prompt asks
for review publication. Documentation that accompanies an implementation
belongs in that implementation's pull request.

## Compose this model with the task contract

The initiating prompt or task spec must provide the task-specific contract:

- the product outcome and done criteria;
- authoritative specs, plans, frontier sections, and required inputs;
- required implementation coverage and explicit non-goals;
- decisions or orientation gates that require human confirmation;
- focused, full-suite, manual, migration, and data-safety verification;
- task-specific stop conditions; and
- any reason to depart from the normal review-delivery default, including a
  draft pull request, an existing review boundary, or no pull request.

This document owns the delivery and review mechanics: orientation, review-unit
design, stack evolution where needed, feedback placement, validation,
publication mechanics, and handoff. Graphite-specific setup and commands apply
only to a multi-branch stack.

Use the repository's normal authority order when sources disagree. Canonical
product specs and accepted architecture contracts own behavior. The stability
frontier owns the current build-wave boundary. The task prompt and task spec
own the detailed execution contract. This model supplies workflow defaults;
an explicit task-specific workflow rule may override a default. Stop and report
any conflict that cannot be resolved through that order.

One implementation or feature stack still represents one dispatched task or
portfolio outcome. Creating several branches does not create new Linear items
or authorize parts of the feature to be dispatched independently.

## Orientation and review-unit choice

Before substantial implementation, inspect the relevant code and focused tests,
then state the delivery judgment: either a single cohesive pull request or the
likely direction of a multi-branch stack. Do not fix a final stack size before
the work warrants it. The human may override that judgment in the task prompt.

For a complex task, pause after read-only orientation when the task names an
orientation gate or when material ambiguity, conflicting authority, or overlap
needs human direction. Otherwise, proceed and revise the chosen review boundary
as understanding improves.

Use a stack when dependent review units make the implementation easier to
understand. A branch boundary is useful when it separates a coherent foundation,
behavior, integration concern, or other independently meaningful delta. Keep a
cohesive change in one pull request; do not manufacture branches merely because
this is the default delivery model.

## Direct Graphite CLI policy for stacks

For a multi-branch stack, agents should use the installed `gt` CLI directly for
Graphite operations. This is the preferred interface for the smoothest eventual
human workflow; no Graphite MCP layer should be introduced or required.

For a single-branch pull request, a normal GitHub branch and pull-request
workflow is sufficient. GitHub pull requests sync to Graphite and are reviewed
there; the agent need not create Graphite metadata or otherwise make Graphite
topology a concern.

When attaching a deliberately detached task-worktree snapshot to the first
branch of a stack, Codex worktrees are commonly created at a detached HEAD.
Use `git switch -c codex/<task-slug>` once, at the unchanged checked-out commit,
then immediately track that branch with `gt branch track --parent
<verified-parent>`. This is setup for Graphite, not a replacement for its stack
operations. Do not use direct Git commits, rebases, branch moves, or topology
edits after this bootstrap.

Before using a topology-changing or publishing command whose behavior is not
certain, inspect the installed version's `gt help` output. Ordinary read-only
Git inspection remains appropriate, as does deliberate staging, but do not use
Git mutations that bypass Graphite and leave stack metadata inconsistent.

Do not install or upgrade Graphite, authenticate it, initialize or reinitialize
the repository, reset Graphite state, force-update branches, or perform
destructive Git/Graphite recovery without explicit authorization.

## Worktree and stack preflight

Keep the full stack in one isolated task worktree with one writer at a time.
Do not spread one stack across worktrees or create a second worktree during a
review round.

### Attach a detached task worktree

A detached HEAD in a newly supplied Codex worktree is expected; it is not a
Graphite initialization failure or a stop condition. Before doing substantive
work, establish the first review branch as follows:

1. Inspect `git status --short --branch`, `git rev-parse HEAD`, and
   `git branch --show-current`. Do not attach a worktree that already has
   unowned changes.
2. Identify the intended parent from the checked-out commit and current
   Graphite topology. Usually this is the configured trunk; it may instead be
   the verified Graphite branch named by the task contract. Confirm the
   relationship before continuing.
3. If `git branch --show-current` is empty, create the unique task branch at
   that exact snapshot: `git switch -c codex/<task-slug>`. Do not use `-B`,
   reuse an existing branch name, or move the branch after creating it.
4. Track that branch: `gt branch track --parent <verified-parent>`. If it
   cannot be placed under the verified parent without guessing, stop and
   report the topology rather than selecting a parent interactively.
5. Treat this tracked branch as the first review unit. Its first commit is
   created with `gt modify`; subsequent review units are created above it with
   `gt create`.

If the worktree already starts on a named pre-created task branch, do not
create another branch. Instead, verify its parent relationship and Graphite
tracking status as part of the normal preflight.

Before stack topology mutation:

1. Record the installed `gt` version, configured trunk, current branch,
   worktree status, and current Graphite topology.
2. Verify how any pre-created task branch relates to trunk and tracked
   Graphite branches.
3. Confirm that the proposed first review unit can be safely attached to its
   verified parent.

## Design a stack as an explanation

The stack contains `N` branches, where `N` emerges from the implementation.
Optimize for reviewer comprehension, dependency order, and semantic cohesion,
not a fixed count, equal diff sizes, or a mechanical mapping from plan sections
to branches.

A branch boundary is useful when:

- a coherent representation, domain primitive, or behavior is complete;
- the next work moves to a distinct conceptual concern;
- the current delta can be meaningfully tested or reasoned about on its own;
- a small change carries enough semantic weight to deserve isolated review;
- later work depends on the current unit but is not needed to explain it; or
- the diff is becoming cognitively expensive.

Avoid giant mixed-concern branches and trivial branches with no explanatory
value. A larger branch is fine when it still expresses one cohesive idea.

Order foundational and reusable concepts downstack, followed by behavior,
integration, and presentation where that dependency order fits. Every branch
must read clearly as a delta against its direct parent. The final stack should
explain the implementation, not preserve the chronology of discovery.

Prefer one commit per branch unless multiple commits materially improve the
review. Put tests in the branch where they best explain the behavior. Keep
intermediate branches buildable and testable where practical, but do not add
fake abstractions, temporary production behavior, or excessive scaffolding
solely to make every intermediate branch independently shippable.

## Incremental implementation

For each coherent review unit:

1. Implement only that unit and preserve unrelated worktree changes.
2. Inspect its diff against the direct parent for one digestible purpose.
3. Run focused checks that validate the unit.
4. Stage only intended files.
5. For the first review unit after the detached-worktree bootstrap, use
   `gt modify` with a concise semantic commit title; it creates the first
   commit on that tracked branch. For every later unit, use the installed
   CLI's supported `gt create` workflow with a concise, semantic branch name
   and commit title.
6. Continue the next unit on top.

Revise the stack as understanding improves. Split a mixed unit, combine an
artificial separation, insert a newly discovered prerequisite, or reorder by
dependency when that makes the explanation clearer.

When correcting completed work, check out the earliest branch that logically
owns the correction, apply it there, update it with `gt modify`, and restack
descendants using commands supported by the installed CLI. Resolve real
conflicts carefully and rerun every check affected upstack. Do not collect all
corrections at the stack tip for convenience.

## Validate before publication or handoff

The companion task spec and repository guidance own the exact verification
matrix. For a single pull request, run the normal focused and broader checks
that apply to its change, inspect its one diff, and leave the worktree clean.
That is one ordinary testing pass, not stack validation multiplied by one.

For a stack, in addition:

1. Run focused checks on the branches that introduce the relevant behavior.
2. Run the repository's required full validation at the stack tip.
3. Inspect every branch as a delta against its direct parent.
4. Improve any branch that is unnecessarily large, trivial, or mixed.
5. Run `gt log short` and `gt log long` to verify final topology.
6. Rerun checks affected by any restack or restructuring.
7. Leave the worktree clean unless the handoff explicitly identifies a safe,
   intentional exception.

Do not weaken task verification merely to make an intermediate branch pass.
Report unavailable manual or environment-dependent checks rather than implying
they ran.

## Publish the reviewed implementation

After validation, publish a reviewable pull request for implementation work by
the repository's normal branch and GitHub workflow. A ready-for-review pull
request is the default once the work is complete and validated; use a draft
only when the task asks for it or the handoff truthfully identifies unfinished
work. Do not merge unless the human separately authorizes it.

The default does not require Graphite setup for a single branch. A GitHub pull
request visible through Graphite sync is the intended normal review surface.
If publication is blocked by authentication, permissions, or repository
configuration, report the exact blocker rather than improvising a workaround.

Standalone research, planning, and documentation-only tasks may hand off in
Codex without publication unless the task asks for a pull request. This
exception does not apply to documentation changed as part of implementation.

### Publish a verified stack

After validation and final branch-boundary review, publish the whole intended
stack through direct `gt` commands. Do not stop with an unpublished local stack
merely to leave submission to the human.

From the top of the stack, use the installed version's equivalent of
`gt submit --stack --confirm` so the full publication boundary is previewed
explicitly. Add the installed CLI's supported draft option when the task says
new pull requests should remain drafts. Do not use an update-only mode when the
boundary contains new branches that need pull requests.

Publishing authorizes only the Graphite-managed branch pushes and pull-request
creation or updates needed for the task's stack. It does not authorize merging,
changing unrelated repository settings, or mutating a different review
boundary. Never merge unless the human separately authorizes it. If publishing
is blocked by authentication, permissions, repository configuration, or an
unclear CLI operation, stop and report the exact blocker rather than bypassing
Graphite with an improvised Git/GitHub workflow.

## Review rounds

Human review applies to the full integration line the human intends to merge,
including later verification, debugging, or workflow branches that remain part
of that line. For a single pull request, its bottom and top are the same branch;
the ownership and validation rules below still apply without stack restacking.
At the start of each round:

1. Verify a clean, single-writer worktree.
2. For a stack, use `gt log` to record the reviewed bottom and top branches;
   for a single pull request, record its branch and pull-request boundary.
3. Read unresolved review comments and review summaries across that entire
   boundary, not only the current or top pull request.
4. Group related comments into logical feedback items; several comments may
   describe one underlying issue.
5. Classify each item as a correction, a direct question, or a design question.
6. For each correction, identify the branch or branches that logically own the
   affected abstractions, behavior, or decision.

A comment's location is context, not ownership. Put a foundational correction
on the branch that introduced the foundation, a persistence correction in the
persistence layer, and an integration or UI correction where that concern
first belongs. Choose the lowest coherent owning branch without forcing a fix
downstack when that would mix unrelated ideas.

A review comment also does not require a diff merely because it exists. When
the review task authorizes replies, answer a direct question concisely in its
pull-request thread. If a question exposes a broader design choice that would
benefit from discussion, bring the evidence, tradeoffs, and plausible options
to the task's Codex chat and pause that decision. Do not conduct an extended
design negotiation through review comments.

For every code-bearing feedback item:

1. Check out the owning branch.
2. Implement and test the correction there.
3. For a stack, update it through `gt modify` and restack descendants. For a
   single pull request, update its normal branch through the repository's
   ordinary workflow.
4. Resolve conflicts carefully and validate affected branches.

Then rerun the validation required for the updated scope. For a stack, run full
validation at the tip and inspect the entire stack again. If feedback reveals a
poor boundary, split, combine, insert, move, or reorder branches. Conceptual
clarity is more important than minimizing branch count or preserving an
accidental original topology.

Restructuring a published stack may rewrite branch and pull-request history or
displace inline-comment context. Record the before-and-after branch mapping and
surface affected review context explicitly.

When the review task authorizes remote updates, update a single pull request
through the repository's ordinary workflow or submit the full reviewed stack
through `gt`. Do not merge. Do not mark remote review threads resolved unless
the human explicitly asks; instead, report which feedback item and branch
correspond to each thread so the human can verify and resolve it.

## Stop conditions

Stop and request human direction when:

- a task-specific orientation or design gate has not been accepted;
- an intended multi-branch stack has Graphite missing, uninitialized, or
  inconsistent with the expected trunk;
- the worktree contains changes whose ownership or disposition is unclear;
- an intended stack's starting branch cannot be placed safely in verified
  topology;
- an essential stack topology operation is unclear or unsupported by installed
  CLI help;
- progress would discard user work, reset Git/Graphite state, force-update
  branches, or require destructive recovery;
- sources of authority cannot be reconciled without a product decision; or
- the requested implementation would cross a task non-goal or resolve a named
  ambiguity speculatively.

## Final handoff

For every implementation pull request, report the outcome, validation, material
deviations or unresolved gaps, exact remote state changed, and pull-request URL
with draft/ready state. For a stack, also report:

1. branch names and commit titles from trunk to tip;
2. each branch's purpose and why its boundary was chosen;
3. boundaries that changed or remained judgment calls;
4. every logical review item and whether it produced a stack change, a direct
   reply, or a discussion in Codex;
5. the branch ownership of code-bearing feedback and any restructuring;
6. intentionally unresolved review threads; and
7. the pull-request URL and draft/ready state for every branch in the published
   stack.

## Suggested task prompt composition

> Follow `docs/stacked-feature-development-and-review.md` as the delivery and
> review model, composed with `<task-spec-path>` as the task-specific execution
> contract. Use the repository's canonical specs and accepted stability frontier
> as higher product authority. State whether the implementation is one cohesive
> pull request or likely needs a stack, honoring any orientation gates. Publish
> the verified implementation for review; if it needs a multi-branch stack, use
> the installed `gt` CLI directly and publish the complete stack through
> Graphite. Do not merge.
