# Working in this repository

AGENTS.md defines how agents conduct work in this repository and routes them to
more specific contributor procedures. [README.md](README.md) introduces the
hosted Mandarin study app; the [documentation index](docs/README.md) routes to
application knowledge. Contributor development and tests are separate from
learner use of the hosted service.

## Task scope and judgment

Justin's request and subsequent clarifications define the task. Solve the
requested problem coherently, including justified local refactoring. Discuss a
broader redesign or scope expansion before undertaking it. Preserve unrelated
work and existing behavior outside the authorized change.

Make routine implementation choices and continue well-defined work. When a
consequential product or architectural decision is unresolved, explain the
choice, evidence, and recommendation to Justin before implementing that part.
A request to work in one shot does not settle an ambiguous learning policy,
data effect, or architectural boundary.

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
| Implement or review a change | [Development and review workflow](docs/stacked-feature-development-and-review.md); [testing map](docs/testing.md) for affected coverage |
| Set up a contributor environment or find a command | [Contributor setup and scripts](docs/scripts.md#contributor-setup-and-local-checks); [package.json](package.json) for command definitions |
| Understand product behavior or current implementation | [Documentation index](docs/README.md), then the owning contracts, implementation explanations, relevant code, and tests |
| Work affecting architectural assumptions or invariants | [Stability frontier](STABILITY_FRONTIER.md) for preserved assumptions and unresolved decisions, then the relevant contracts |
| Change persistence or schema | [Database map](docs/server-db.md) and [migration guide](docs/ops/schema-migrations.md#writing-the-next-migration) |
| Operate or release the hosted service | [Release and maintenance runbook](docs/ops/hosted-beta-deployment.md), including its agent terminal-driver procedure; [offline migrations](docs/ops/schema-migrations.md) for schema-changing work |
| Find configuration | [Configuration reference](docs/architecture.md#configuration), [.env.example](.env.example), and the relevant operations guide |

Existing documents are sources to reconcile against the documentation target;
the index records known adoption gaps. Read supplied task notes and historical
material when they help answer the task's question. An old plan's `active` label
does not establish current priority, unfinished work, or authorization.

## Working preferences

- Use the existing architecture where it fits. Add dependencies, global state
  machinery, or new abstractions when the task warrants them; explain material
  additions. Avoid introducing single-machine assumptions into hosted behavior.
- Keep strict TypeScript types. Use `any` only with a concrete justification.
- In domain and state transitions, fail loudly when a programmer invariant is
  violated. Tolerant no-ops belong to explicitly user-driven or externally
  uncertain inputs, not hidden recovery from broken caller contracts.
- Keep backend timestamps and date keys in UTC (`toISOString`, `YYYY-MM-DD` UTC)
  unless the task explicitly changes that policy.
- Keep HTTP handlers thin and domain/persistence logic in `server/db/` or its
  owning subsystem. Centralize frontend API calls in `src/services/api.ts`.
  Endpoint changes preserve validation and meaningful status codes and update
  the client contract where needed. Use the [API map](docs/api.md) for navigation.

Own your assigned task's end-to-end completion, including how the work is divided,
coordinated, integrated, and verified. For substantial work, proactively choose
an orchestration approach and revise it as the task develops; Justin need not
separately request orchestration or identify opportunities to delegate.

Use subagents when they can keep substantial intermediate detail out of the
main context, enable useful parallel progress, or improve the result. Choose
subtasks by their context needs and dependencies. Exploration, implementation,
testing, and independent review are examples, not an exhaustive list. When you
delegate part of your task, retain responsibility for integrating and verifying
the result against your task's objective and constraints. Give each subagent a
clear scope, relevant context, and expected outcome.
Request concise results with evidence, relevant changes, and unresolved questions.

Keep tightly coupled work together when delegation would add more coordination
than value, avoid duplicating effort, and coordinate concurrent edits explicitly.
Independently dispatched tasks belong in separate worktrees. Graphite stacks
follow the review workflow's single-writer rule.

For UI work, make the next action and necessary consequences clear. Put optional
calculation details and technical explanations in accessible disclosures. Avoid
repeated prose in compact cards; use shared labels or tables when they make
comparisons clearer. Preserve readable text and wrapping rather than shrinking
or clipping content to fit.

## Data and operational boundaries

`data/` can contain valued databases, backups, and source artifacts. Identify
the target and its role before running a mutating command. Intentional changes
or resets to development data are allowed when needed for the task; explain
them. Preserve backups (`data/*.backup*`), sources (`data/sources/*`), and useful
`tmp/` or export artifacts unless their disposal is authorized. Ask before an
irreversible data change whose scope has not already been authorized.

Keep secrets out of commits, logs, and artifacts. Use local environment
configuration or the hosted secret mechanism as appropriate; `.env.example`
documents names without real credentials.

Persistence changes belong in the owning module with relevant tests. New schema
changes follow the versioned migration procedure, not edits to startup
constructors or previously applied migrations. The hosted app-only upgrade
route permits no schema or data migration. Follow the runbook for the requested
operation and retain its required evidence; successful implementation alone
does not establish release or recovery readiness.

### Review publication authorization

Justin authorizes pushing task branches and creating or updating review pull
requests in this project's configured GitHub repository. Before publishing,
verify that `origin` points to `https://github.com/swimj/chinese-study-app.git`.
This authorization covers review publication, not merging, deploying,
force-pushing, or publishing to another repository. Those actions need separate
explicit authorization.

A sandbox failure accessing shared Git metadata or GitHub does not establish
that host authentication is broken. Diagnose the execution context and request
the supported permission when needed. Respect an explicit denial and report
its reason; do not bypass it through another route.

## Verification and delivery

Choose checks that establish the requested behavior and cover affected risks.
Use the [testing map](docs/testing.md) to find focused Node tests and
[contributor commands](docs/scripts.md#contributor-setup-and-local-checks) to run
them. Add or update behavior tests where practical. For scheduling or session
changes, start with composition and completion coverage. Run compilation/build
checks for substantial code changes and broader tests when the affected surface
warrants them. Documentation-only changes need content and link verification.

Verify visual changes in their actual container, including narrow desktop
panels and enlarged text. Exercise relevant long labels, large values, empty
states, expanded disclosures, and keyboard access. A build does not establish
visual correctness; report missing rendered verification.

Update owning documentation when a change affects the explanations readers
need, using the authoring procedure to choose useful detail and scope. Report
meaningful remaining gaps; touching a document does not certify its entire
contents. Documentation completeness is not a blanket merge gate, while
task-specific correctness and safety requirements still apply.

Implementation work normally finishes with a verified review pull request.
Before substantial implementation, state whether the change is one cohesive PR
or likely needs a stack. Use ordinary GitHub delivery for a single PR and the
installed `gt` CLI for a useful multi-branch stack, following the development
and review workflow. Standalone research, planning, and documentation tasks may
return in Codex without a PR unless publication is requested.

At handoff, explain the outcome, verification and its limits, material open
choices or documentation gaps, and any remote state changed. Check the final
diff for unintended files or data changes. For published work, include the PR
link and review state; distinguish implemented, merged, deployed, and observed.

<a id="11-project-context-and-task-scope"></a>

## Project context

The persistent Steward workspace at `/Users/jw/dev/chinese-study-steward`
maintains the north star in `vision.md`, weekly priorities in `outlook.md`, and
unresolved thinking in `chewing.md`. Consult it for alignment when relevant and
available. Its AGENTS.md governs the Steward role; this repository retains the
contracts needed to carry out a well-scoped application task without that
workspace.

Task conversations establish execution context. Git and GitHub supply review
and integration evidence. Linear supports issue intake and retrieval, but its
bookkeeping is incomplete: a direct task needs no Linear item, and later issue
edits do not silently change the ongoing task. The frontier is a checkout's
architectural snapshot, not a live task ledger or release certificate.

Justin selects portfolio work. Historical Steward/Linear dispatch rituals are
not prerequisites for implementation. Report material overlap and worthwhile
out-of-scope ideas in the handoff; creating additional portfolio tasks, changing
external records, or maintaining a replacement backlog requires authorization.
