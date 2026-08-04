# Stacked Feature Development And Review

This document defines a reusable Graphite-backed development and review model
for substantial features. Use it as a delivery overlay alongside a specific
task spec; it is not itself a task spec, a source of product behavior, or
authorization to dispatch work.

The model is useful when a feature benefits from several dependent review units
that should explain the implementation from foundations through integration.
It is optional. A small or naturally atomic change should remain a normal
single-branch change unless the task explicitly selects this model.

## Compose this model with the task contract

The initiating prompt or task spec must provide the task-specific contract:

- the product outcome and done criteria;
- authoritative specs, plans, frontier sections, and required inputs;
- required implementation coverage and explicit non-goals;
- decisions or orientation gates that require human confirmation;
- focused, full-suite, manual, migration, and data-safety verification;
- task-specific stop conditions; and
- the permitted publication state: local-only, draft publication, or an update
  to an already-published review boundary.

This document owns the delivery and review mechanics: worktree and Graphite
preflight, review-unit design, stack evolution, feedback placement, validation,
publication mechanics, and handoff.

Use the repository's normal authority order when sources disagree. Canonical
product specs and accepted architecture contracts own behavior. The stability
frontier owns the current build-wave boundary. The task prompt and task spec
own the detailed execution contract. This model supplies workflow defaults;
an explicit task-specific workflow rule may override a default. Stop and report
any conflict that cannot be resolved through that order.

One feature stack still represents one dispatched task or portfolio outcome.
Creating several branches does not create new Linear items or authorize parts
of the feature to be dispatched independently.

## Direct Graphite CLI policy

Agents should use the installed `gt` CLI directly for Graphite operations. This
is the preferred interface for the smoothest eventual human workflow; no
Graphite MCP layer should be introduced or required.

Before using a topology-changing or publishing command whose behavior is not
certain, inspect the installed version's `gt help` output. Ordinary read-only
Git inspection remains appropriate, as does deliberate staging, but do not use
Git mutations that bypass Graphite and leave stack metadata inconsistent.

Do not install or upgrade Graphite, authenticate it, initialize or reinitialize
the repository, reset Graphite state, force-update branches, or perform
destructive Git/Graphite recovery without explicit authorization.

## Worktree and orientation preflight

Keep the full stack in one isolated task worktree with one writer at a time.
Do not spread one stack across worktrees or create a second worktree during a
review round.

Before substantial implementation or topology mutation:

1. Read the repository guidance, current frontier, task spec, and its linked
   product and architecture authorities.
2. Inspect the relevant implementation and focused tests.
3. Record the installed `gt` version, configured trunk, current branch,
   worktree status, and current Graphite topology.
4. Verify how any pre-created task branch relates to trunk and tracked
   Graphite branches.
5. Report the important code/test seams, material ambiguity or overlap, the
   proposed first review unit, and the likely stack direction without fixing a
   final branch count.
6. Pause only for the human gates named by the task contract or when a stop
   condition below applies.

If the task requires a human-guided orientation checkpoint, complete only
read-only orientation until the named decisions are accepted. After that, the
stack may evolve without approval for every ordinary branch boundary.

## Design the stack as an explanation

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
5. Use the installed CLI's supported `gt create` workflow with a concise,
   semantic branch name and commit title.
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

The companion task spec owns the exact verification matrix. In addition:

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

## Publication boundary

The prompt or task spec must choose the remote-state boundary. If it is silent,
construct and verify the stack locally and stop before pushing or creating pull
requests.

For a local-only task, do not push branches, run `gt submit`, create pull
requests, merge, or squash the completed stack. Report the exact next command
for the human only after checking it against the installed CLI help.

When publication is explicitly authorized, publish the whole intended boundary
through direct `gt` commands. From the top of the stack, the installed version's
equivalent of `gt submit --stack --confirm` should provide an explicit preview
before pushing; add its supported draft option when new pull requests should
remain drafts. Do not use an update-only mode when the boundary contains new
branches that need pull requests. Never merge unless the human separately
authorizes it.

## Review rounds

Human review applies to the full integration line the human intends to merge,
including later verification, debugging, or workflow branches that remain part
of that line. At the start of each round:

1. Verify a clean, single-writer worktree.
2. Use `gt log` to record the reviewed bottom and top branches.
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
3. Update it through `gt modify` and restack descendants.
4. Resolve conflicts carefully and validate affected branches.

Then run full validation at the tip and inspect the entire stack again. If
feedback reveals a poor boundary, split, combine, insert, move, or reorder
branches. Conceptual clarity is more important than minimizing branch count or
preserving an accidental original topology.

Restructuring a published stack may rewrite branch and pull-request history or
displace inline-comment context. Record the before-and-after branch mapping and
surface affected review context explicitly.

When the review task authorizes remote updates, submit the full reviewed
boundary through `gt`. Do not merge. Do not mark remote review threads resolved
unless the human explicitly asks; instead, report which feedback item and
branch correspond to each thread so the human can verify and resolve it.

## Stop conditions

Stop and request human direction when:

- a task-specific orientation or design gate has not been accepted;
- Graphite is missing, uninitialized, or inconsistent with the expected trunk;
- the worktree contains changes whose ownership or disposition is unclear;
- the starting branch cannot be placed safely in verified topology;
- an essential topology operation is unclear or unsupported by installed CLI
  help;
- progress would discard user work, reset Git/Graphite state, force-update
  branches, or require destructive recovery;
- sources of authority cannot be reconciled without a product decision; or
- the requested implementation would cross a task non-goal or resolve a named
  ambiguity speculatively.

## Final handoff

Report:

1. branch names and commit titles from trunk to tip;
2. each branch's purpose and why its boundary was chosen;
3. boundaries that changed or remained judgment calls;
4. every logical review item and whether it produced a stack change, a direct
   reply, or a discussion in Codex;
5. the branch ownership of code-bearing feedback and any restructuring;
6. focused, full, and manual validation with results;
7. deviations, migrations, unresolved gaps, and displaced review context;
8. the exact remote state changed, or confirmation that none changed;
9. intentionally unresolved review threads; and
10. when local-only, the next human publication command verified against the
    installed CLI help but not executed.

## Suggested task prompt composition

> Follow `docs/stacked-feature-development-and-review.md` as the delivery and
> review model, composed with `<task-spec-path>` as the task-specific execution
> contract. Use the repository's canonical specs and accepted stability
> frontier as higher product authority. Work in the supplied isolated worktree,
> use the installed `gt` CLI directly for Graphite operations, honor the task's
> orientation and remote-state boundaries, and satisfy both documents' stop,
> verification, and handoff requirements.
