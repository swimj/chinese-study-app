# Working in this repository

This repository contains the [hosted Mandarin study app](README.md) and its
intended successor, the scrapbook journal in `spikes/mandarin-journal/`.
For hosted work, start with the [documentation index](docs/README.md).
The [journal learning model](spikes/mandarin-journal/MODEL.md) explains its
product direction and which hosted ideas carry forward; the
[journal interface](spikes/mandarin-journal/DESIGN.md) records its design
direction and open questions. To run or test the
journal, follow the [journal runbook](spikes/mandarin-journal/RUNBOOK.md) and
use the checkout's fixture by default. Never open Justin's live journal from
an agent worktree.

Claude Code reads this file through the `@AGENTS.md` import in
[CLAUDE.md](CLAUDE.md), and finds the skills in `.agents/skills/` through the
`.claude/skills` symlink. Keep shared guidance here and skills in `.agents/skills/`.

## Task scope and judgment

Justin's request and subsequent clarifications define the task. Solve the
requested problem coherently, including justified local refactoring. Discuss a
broader redesign or scope expansion before undertaking it. Preserve unrelated
work and existing behavior outside the authorized change.

Make routine implementation choices independently. When plausible interpretations
would materially change the result, state your working assumption early and
give a concrete example of what the user should be able to do or observe.
Continue with reversible work. If an unresolved choice affects a product
promise, the meaning of data, or an architectural commitment, bring Justin
the case and your recommendation before implementing the part that depends on
it. Ask before a costly-to-reverse step whose intended outcome is unclear.

Use the [documentation principles](docs/documentation-principles.md#intent-evidence-and-disagreement)
to reconcile sources: contracts describe intended promises, code and observed
execution establish actual behavior, and tests provide bounded evidence. Surface
material discrepancies; correct clearly stale descriptions within scope. An
authorized change to a product promise updates the owning contract alongside
the implementation and relevant tests. Neither existing code nor an old
specification automatically settles disputed intent.

## Find the relevant guidance

Choose reading from the task's needs. The links below are routes, not a list to
read before every edit.

| Task or question | Guidance |
| --- | --- |
| Write or maintain documentation | [Authoring procedure](docs/documentation-authoring.md), following the [documentation principles](docs/documentation-principles.md) |
| Reason about implementation choices and quality | [Development principles](docs/development-principles.md); [testing map](docs/testing.md) for affected coverage |
| Keep a document that evolves over a discussion (a "living doc") | [living-doc skill](.agents/skills/living-doc/SKILL.md) |
| Organize, publish, or revise pull requests | [PR delivery and Graphite stacks](docs/stacked-feature-development-and-review.md) |
| Create, adapt, or review a model prompt | [Prompt development](docs/prompt-development.md): working lineage, contract adaptation, and behavioral comparisons |
| Set up a contributor environment or find a command | [Contributor setup and scripts](docs/scripts.md#contributor-setup-and-local-checks); [package.json](package.json) for command definitions |
| Understand hosted product behavior or current implementation | [Documentation index](docs/README.md), then the owning contracts, implementation explanations, relevant code, and tests |
| Hosted work affecting architectural assumptions or invariants | [Stability frontier](STABILITY_FRONTIER.md) for preserved assumptions and unresolved decisions, then the relevant contracts |
| Change hosted persistence or schema | [Database map](docs/server-db.md) and [migration guide](docs/ops/schema-migrations.md#writing-the-next-migration) |
| Operate or release the hosted service | [Release and maintenance runbook](docs/ops/hosted-beta-deployment.md), including its agent terminal-driver procedure; [offline migrations](docs/ops/schema-migrations.md) for schema-changing work |
| Find hosted configuration | [Configuration reference](docs/architecture.md#configuration), [.env.example](.env.example), and the relevant operations guide |

Existing documents are sources to reconcile against the documentation target;
the index records known adoption gaps. Read supplied task notes and historical
material when they help answer the task's question. An old plan's `active` label
does not establish current priority, unfinished work, or authorization.

## Working preferences

**Prompt work.** Prepare your own outline before drafting a substantive prompt
or revision. State its purpose, what the model can observe, and how it should
use that evidence to produce a good result. Read the closest relevant working prompt in full, even
when writing an original prompt. Identify the principles and examples that
transfer to the new task. Draft from the outline and check representative
outputs. When plausible interpretations would produce meaningfully different
results and the intended choice is
unresolved, bring Justin a concrete case and a recommendation.

- Use the existing architecture where it fits. Add dependencies, global state
  machinery, or new abstractions when the task warrants them; explain material
  additions. Avoid introducing single-machine assumptions into hosted behavior.
- Preserve shared behavior and applicable regression evidence when implementation
  machinery changes. Use the [development principles](docs/development-principles.md)
  to choose reuse boundaries and verify that coverage reaches the current path.
- Keep strict TypeScript types. Use `any` only with a concrete justification.
- In domain and state transitions, fail loudly when a programmer invariant is
  violated. Tolerant no-ops belong to explicitly user-driven or externally
  uncertain inputs, not hidden recovery from broken caller contracts.
- Store backend timestamps as UTC instants. Hosted date keys use UTC
  (`YYYY-MM-DD`). The journal derives learning days in the learner's time zone.
- In the hosted app, keep HTTP handlers thin and place domain and persistence
  logic in `server/db/` or the owning subsystem. Centralize frontend API calls
  in `src/services/api.ts`.
  Endpoint changes preserve validation and meaningful status codes and update
  the client contract where needed. Use the [API map](docs/api.md) for navigation.

Use subagents proactively for parallel work, large investigations, or independent
checks when that improves the result. Keep tightly coupled work together.
When a task is easy to brief and a cheaper model is likely to produce a result
nearly as useful, give it a self-contained brief and explicitly select that
model and its reasoning effort. Favor stronger reasoning when a mistake would
be consequential or hard to detect. Include briefing, verification, and likely
rework when weighing savings. The coordinator owns integration and verification.
Use separate worktrees for independently dispatched implementation tasks and
follow the Graphite single-writer rule for stacks.

For UI work, make the next action and its consequences clear through labels,
controls, and layout. When a flow seems to need explanatory copy, first look
for a clearer interaction. Omit instructions such as “Give the Mandarin word”
when the exercise already establishes the action. Keep copy that teaches,
explains a consequential choice, or helps someone recover from an error.

## Data and operational boundaries

Use production data read-only when needed for analysis. Keep learner data
private in extracts, logs, and review artifacts. Production mutations require
authorization for the specific operation.

`data/` can contain valued databases, backups, and source artifacts. Identify
the target and its role before running a mutating command. Intentional changes
or resets to development data are allowed when needed for the task; explain
them. Preserve backups (`data/*.backup*`), sources (`data/sources/*`), and useful
`tmp/` or export artifacts unless their disposal is authorized. Ask before an
irreversible data change whose scope has not already been authorized.

Keep secrets out of commits, logs, and artifacts. Use local environment
configuration or the hosted secret mechanism as appropriate; `.env.example`
documents names without real credentials.

Persistence changes belong in the owning module with relevant tests. Hosted schema
changes follow the versioned migration procedure, not edits to startup
constructors or previously applied migrations. A hosted code-only release
permits no schema or data migration. Follow the runbook for the requested
operation and retain its required evidence; successful implementation alone
does not establish release or recovery readiness.

### Review publication authorization

Justin authorizes pushing task branches and creating or updating review pull
requests in this project's configured GitHub repository. Before publishing,
verify that `origin` points to `https://github.com/swimj/chinese-study-app.git`.
This authorization covers review publication, not merging, deploying,
or publishing to another repository. Agents may force-push an existing task
branch when updating the pull request they created or are responsible for. Use
`--force-with-lease` so the update is rejected if the remote branch changed
since it was last observed. This authorization does not cover rewriting another
person's branch or a branch outside the task's review boundary.

A sandbox failure accessing shared Git metadata or GitHub does not establish
that host authentication is broken. Diagnose the execution context and request
the supported permission when needed. Respect an explicit denial and report
its reason; do not bypass it through another route.

## Verification and delivery

For substantial user-facing changes, identify representative user goals and
what successful completion looks like before implementation. Exercise those
flows through the actual interface. Use the
[coordinator procedure](docs/evaluation/coordinator.md) to prepare the preview
and brief when an independent evaluation would add useful evidence.

When success depends on model judgment or generated content, inspect
representative outputs and say which model path produced them. If verification
used an offline fixture or test double, identify the quality question that
remains open.

Choose checks that establish the requested behavior and cover affected risks.
Use the [testing map](docs/testing.md) to find focused Node tests and
[contributor commands](docs/scripts.md#contributor-setup-and-local-checks) to run
them. Add or update behavior tests where practical. For hosted scheduling or session
changes, start with composition and completion coverage. Run compilation/build
checks for substantial code changes and broader tests when the affected surface
warrants them. Documentation-only changes need content and link verification.

Verify visual changes in their actual container, including narrow desktop
panels and enlarged text. Check that text wraps and stays readable. Exercise
relevant long labels, large values, empty states, expanded disclosures, and
keyboard access. A build does not establish
visual correctness; report missing rendered verification.

Update owning documentation when a change affects the explanations readers
need, using the authoring procedure to choose useful detail and scope. Report
meaningful remaining gaps; touching a document does not certify its entire
contents. Documentation completeness is not a blanket merge gate, while
task-specific correctness and safety requirements still apply.

Implementation work normally finishes with a verified review pull request.
Explain a proposed split early when the division or sequencing materially
affects review. Use ordinary GitHub delivery for a single PR and the
installed `gt` CLI for a useful multi-branch stack, following the PR delivery
and Graphite workflow. Standalone research, planning, and documentation tasks may
return in the agent conversation without a PR unless publication is requested.

At handoff, explain the outcome, verification and its limits, material open
choices or documentation gaps, and any remote state changed. Check the final
diff for unintended files or data changes. For published work, include the PR
link and review state; distinguish implemented, merged, deployed, and observed.

<a id="11-project-context-and-task-scope"></a>

## Project context

Consult [Steward](https://github.com/swimj/steward) when product direction or
priorities bear on a decision. Its `vision.md` describes the north star,
`outlook.md` the weekly priorities, and `chewing.md` unresolved thinking.
A direct request from Justin is sufficient to begin work. Surface material
overlap and worthwhile follow-ups. Get authorization before creating portfolio
tasks or changing external planning records.
