# Production-cue vertical Graphite stack task spec

status: archived
type: work-bundle
created: 2026-08-05
archived: 2026-08-05
retired-because: reusable guidance was consolidated into the durable stacked feature development and review model; production authority remains in the linked plan, specs, and frontier
replaced-by: ../../docs/stacked-feature-development-and-review.md
related:

- SWI-26
- SWI-24
- [`PLANS/swi-24-production-task-cue-contract.md`](../../PLANS/swi-24-production-task-cue-contract.md)
- [`SPECS/study-action-model.md`](../../SPECS/study-action-model.md)
- [`SPECS/reflection-proposals-and-handles.md`](../../SPECS/reflection-proposals-and-handles.md)
- [`STABILITY_FRONTIER.md`](../../STABILITY_FRONTIER.md)

## Purpose and authority

This note is the execution contract for delivering the accepted V0
production-task and cue vertical as a local Graphite stack. It governs
orientation, implementation coverage, stack structure, review mechanics, and
handoff. It does not replace product authority.

The canonical specifications own product behavior. The accepted SWI-24 design
memo explains the V0 decisions and implementation seams. The current stability
frontier owns this build wave's boundary. If this note conflicts with those
sources, stop, follow the higher authority, and report the conflict rather than
silently choosing an interpretation.

All branches and any eventual pull requests belong to one Linear implementation
issue. The number of branches does not create additional portfolio work or
permit independent dispatch of parts of the stack.

## Outcome

Implement the bounded production-cue vertical end to end:

```text
completed production attempt with a misleading or overloaded cue
  -> post-session reflection proposes repair_production_cue@2
  -> learner reviews and authorizes exact cue changes
  -> a faithful adapter applies immutable cue content and lifecycle effects
  -> a later production action selects and serves an active cue
  -> answer checking uses the served accepted-word snapshot
  -> durable attempt evidence preserves exactly what was tested
  -> cue facts and later judgments append into non-scheduling shadow evidence
```

The implementation is one vertical product outcome, delivered as `N` coherent
Graphite branches. `N` emerges from implementation and review needs; neither
the design memo's sections nor the implementation seams below prescribe a
one-to-one branch map.

## Admission state and human-guided orientation

This task begins **Yellow**. Before substantial implementation or Graphite
topology mutation, perform a read-only orientation and report:

1. the installed `gt` version, configured trunk, worktree cleanliness, starting
   Git branch, and current Graphite topology;
2. the relevant persistence, operation-registry, reflection generation/review,
   session-composition, grading, attempt-evidence, Undo, and test seams;
3. a proposed exact nested `repair_production_cue@2` wire contract, including:
   - create, one-to-one replace, one-to-many replace, activate, and deactivate
     change variants;
   - cue draft and accepted-word-set representation;
   - optional source-attempt judgment representation;
   - validation, atomicity, idempotency, `already_satisfied`, and effect-ref
     semantics; and
   - how V1 remains readable and unsupported while new generation emits V2;
4. proposed append-only cue-attempt, later-judgment, compensation, and shadow-
   projection records, with the boundary between existing attempt evidence and
   new cue evidence made explicit;
5. a proposed bounded word-scheduler reconciliation response for accepted
   anchor, accepted non-anchor, and rejected/out-of-set submissions, including
   commit and one-step Undo behavior;
6. response normalization and catalogue-word resolution rules, especially for
   ambiguous or unresolved text;
7. the proposed first review unit and likely stack direction, without fixing a
   final branch count; and
8. material ambiguity, overlap, migration risk, or review cost already visible.

Wait for the human to accept the V2 wire contract and provisional scheduler
response. Their confirmation moves the task to **Green**. Ordinary engineering
choices and later stack-boundary revisions do not require repeated approval,
but all stop conditions remain in force.

The orientation is intentionally part of the task, not a separate design
issue. It must choose representations faithful to the accepted behavior; it
must not reopen the one-default-task model, multi-active immutable cues, random
V0 selection, snapshot-based answer checking, or word-based scheduling.

## Required preflight

Before orientation:

1. Read `AGENTS.md`, `STABILITY_FRONTIER.md`, the SWI-24 design memo, both
   canonical specs linked above, and this note.
2. Read the reflection generation spec and relevant architecture/API docs
   routed by `AGENTS.md`.
3. Inspect the current implementation and focused tests before proposing types
   or branch boundaries.
4. Confirm the installed Graphite version and consult that version's CLI help
   for every uncertain topology-changing command.
5. Verify the configured trunk, current Graphite topology, clean worktree, and
   relationship of the task's starting branch to trunk.

Keep the entire stack in the one isolated worktree supplied for this task. Do
not install or upgrade Graphite, authenticate it, initialize or reinitialize
the repository, reset Graphite state, or perform destructive Git/Graphite
recovery without explicit authorization. Use Graphite-aware operations verified
against installed CLI help; do not improvise ordinary Git operations that leave
stack metadata inconsistent.

## Required implementation coverage

The final stack must close all of these seams, even if their branch boundaries
combine or split differently.

### Durable production-task and cue content

- Represent the V0 `default_production` task identity per word without making
  tasks a second scheduling stream.
- Persist immutable cue content, supported cue types, accepted visible-word
  sets, creation attribution, and explicit activation state.
- Implement create, replace/split, activate, and deactivate lifecycle effects.
- Keep the meaning-derived gloss as non-cue fallback content; preserve legacy
  bad-prompt and definition-production suppression behavior.
- Do not manufacture cue rows for existing words during migration.

### V2 reflection proposal and faithful application

- Add the human-approved V2 schema to the operation registry, strict provider
  validation, prompt contract, materialization, review/editor surface,
  invocation storage, and adapter dispatch.
- Make new reflection generation emit V2 directly.
- Apply all requested cue changes atomically with attributable effect refs,
  correct idempotency, `already_satisfied`, stale, and failure behavior.
- Keep historical V1 proposals/invocations readable and unsupported. Do not
  build the lower-priority learner-visible V1-to-V2 migration flow.
- Keep `accept_production_alternate@1` unsupported; do not reinterpret its
  directional claim as cue-scoped acceptance.

### Serving, answer checking, and historical evidence

- Select randomly among active cues only after a word has been admitted by the
  existing scheduler; serve the fallback only when no active cue applies.
- Extend `StudyContentRef` and the served action with exact task/cue identity
  and immutable presentation/acceptance snapshots.
- Resolve submissions using the accepted orientation rules and accept a cue
  response only when it matches the served accepted-word set. No live-session
  LLM or learner-confirmed alternate path is permitted.
- Persist anchor word, cue type/text, accepted-word set, raw submitted text,
  nullable resolved submitted word, and session-time result so later cue edits
  cannot reinterpret history.
- Preserve current session commit and one-step Undo invariants.

### Cue evidence and provisional scheduler seam

- Append stable cue-attempt facts and later learner-authorized judgments; use
  compensating records for withdrawal or supersession rather than mutation.
- Implement the accepted asynchronous shadow projection and demonstrate that
  V0 scheduling does not consume it.
- Encapsulate the human-approved temporary word-scheduler response behind an
  explicit replaceable reconciliation seam. Report known divergence between
  cue shadow state and word strength/interval state; do not disguise it as cue
  semantics.

### Integration and dogfood readiness

- Keep backend validation and provider credentials server-side.
- Preserve proposal-only model authority and failure isolation from session
  correctness.
- Update API, architecture, and operational documentation where the implemented
  contract changes them.
- Exercise at least one single-answer durable cue and one multi-answer cue
  through generation/review/application, later serving, answer checking, and
  evidence.

## Stack design

Produce a stack of `N` branches, where `N` emerges from the implementation.
Optimize primarily for reviewer comprehension, dependency order, and semantic
cohesion—not a fixed count, uniform line count, or plan-section mapping.

A branch boundary is useful when:

- a coherent representation, domain primitive, or behavior is complete;
- the next work moves to a distinct conceptual concern;
- the current delta can be tested or reasoned about on its own;
- a small change carries enough semantic weight to deserve isolated review;
- later work depends on the current change but is not needed to explain it; or
- the current diff is becoming cognitively expensive.

Do not create a branch merely because a checklist bullet was completed, a line
threshold was reached, or another file is being edited. Avoid giant
mixed-concern branches and trivial branches that provide no explanatory review
boundary. A larger branch is acceptable when it still reduces to one cohesive
idea.

Order foundational and reusable concepts downstack, followed by behavior,
integration, and presentation where that dependency order fits. Every branch
must make sense as a delta against its direct parent, and a reviewer should be
able to state its purpose in one or two sentences. The final stack should
explain the implementation rather than preserve coding chronology.

Prefer one commit per branch unless there is a concrete reason for more. Put
tests in the branch where they best explain the behavior. Keep intermediate
branches buildable and testable where practical, but do not add fake
abstractions, temporary production behavior, or excessive scaffolding solely to
make every intermediate branch independently shippable.

## Incremental Graphite workflow

For each coherent review unit:

1. Implement only the intended unit and preserve unrelated user changes.
2. Inspect the diff against its direct parent for one digestible purpose.
3. Run focused checks that validate that unit.
4. Stage only intended files.
5. Use the installed Graphite CLI's supported `gt create` workflow with a
   concise semantic branch name and commit title.
6. Continue the next unit on top.

Revise the stack as understanding improves: split mixed or oversized units,
combine artificial separations, insert newly discovered prerequisites at the
correct point, or reorder by dependency. Use Graphite-aware operations verified
against installed CLI help and preserve valid topology.

When correcting completed work, check out the earliest branch where the change
logically belongs, apply it there, use `gt modify`, and restack dependents.
Resolve genuine conflicts carefully and rerun all checks affected upstack. Do
not accumulate every correction at the stack tip for convenience.

Use direct `gt` CLI commands for all Graphite operations. No Graphite MCP
integration is required.

## Verification

Focused coverage must include, at minimum:

- cue persistence, lifecycle, attribution, and migration/fallback behavior;
- V2 strict validation, direct generation, adapter atomicity, idempotency,
  `already_satisfied`, stale, and failure isolation;
- one-to-many replacement leaving unrelated cues untouched;
- single- and multi-answer snapshot-based answer checking;
- out-of-set response behavior with no hot-path model call;
- served `contentRef` and attempt-snapshot invariance after later replacement;
- accepted anchor, accepted non-anchor, rejected response, commit, and Undo
  behavior under the provisional scheduler seam;
- append-only later judgments, compensation, and shadow projection;
- existing suppression/bad-prompt behavior and fallback selection; and
- historical V1 readability with unsupported application.

Use repository-native test suites and add focused tests where the contract has
no coverage. At the stack tip, run full `npm test` and `npm run build`, confirm
documentation consistency, and perform a manual study-mode dogfood pass through
the advancement cases when credentials/data make that safe and available.
Report any unavailable manual step; do not use real study data destructively.

Before handoff:

1. run `gt log short` and `gt log long`;
2. inspect every branch against its direct parent;
3. revise any branch that is unnecessarily large, trivial, or mixed;
4. rerun affected checks and the full tip validation; and
5. leave the working tree clean.

## Local-only boundary

Construct and verify the complete stack locally. Do not push branches, run
`gt submit`, create pull requests, merge, squash the completed stack, or alter
remote state. The human will inspect the local stack and authorize publication
separately.

## Stop conditions

Stop and request human input if:

- either orientation gate has not been accepted;
- faithful implementation would require mutating lexical meanings, rewriting
  historical attempts, retroactively changing scheduler outcomes, or putting
  an LLM on the session hot path;
- a proposed representation collapses task, cue, accepted-answer, evidence, or
  scheduler identities beyond the accepted V0 simplifications;
- progress requires general alternate-answer policy, sense-specific tasks,
  free-form accepted expressions, destructive deletion, full scheduler
  redesign, manual cue authoring, or V1 migration UX;
- Graphite is missing, uninitialized, or inconsistent with the expected trunk;
- the worktree contains changes whose ownership or disposition is unclear;
- the starting branch cannot be placed safely in a verified stack topology;
- a needed topology operation is unsupported or unclear in installed CLI help;
- continuing would discard user work, reset Git/Graphite state, force-update
  branches, or require other destructive recovery; or
- a spec, accepted design, verified implementation constraint, and frontier
  cannot be reconciled without a product decision.

## Final handoff

Report:

1. branch names and commit titles from trunk to tip;
2. each branch's purpose and why its boundary was chosen;
3. boundaries that were judgment calls or changed during implementation;
4. the accepted V2 wire, cue-evidence, normalization, and provisional scheduler
   decisions actually implemented;
5. focused, full, and manual checks with results;
6. migrations, known temporary divergences, deviations, and unresolved gaps;
7. confirmation that no remote state was changed and the worktree is clean;
   and
8. the exact human publication command verified against installed CLI help but
   not executed.

## Suggested initiating Codex prompt

> Work on the production-cue implementation issue in the isolated Codex
> worktree already provided. First read `AGENTS.md`, `STABILITY_FRONTIER.md`,
> `PLANS/swi-24-production-task-cue-contract.md`,
> `SPECS/study-action-model.md`,
> `SPECS/reflection-proposals-and-handles.md`, and
> `notes/active/2026-08-05-production-cue-graphite-stack-task-spec.md`.
> Treat the specs as product authority, the accepted SWI-24 memo and frontier
> as the build-wave contract, and the task-spec note as the local Graphite
> delivery contract. Begin only with its read-only human-guided orientation:
> verify Graphite/worktree topology, map code and tests, propose the exact V2
> wire and cue-evidence records, propose the provisional scheduler response and
> normalization rules, and propose the first review unit. Do not make
> substantial implementation or topology changes until I confirm the V2 wire
> contract and scheduler response. After confirmation, implement the full
> bounded vertical as a dynamically structured local-only Graphite stack and
> satisfy all verification and handoff requirements. Do not push, submit,
> create pull requests, merge, or squash the stack.
