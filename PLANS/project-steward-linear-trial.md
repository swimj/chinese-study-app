# Project Steward + Linear Trial

Status: active pilot; repository authority cutoff, steward, Linear MCP, and
capture loop activated and smoke-tested 2026-07-24.

Prepared: 2026-07-23
Approved: 2026-07-24
Activated: 2026-07-24
Evaluation due: 2026-08-07 or after 10 real captures, whichever comes first

Related:

- [`AGENTS.md`](../AGENTS.md)
- [`STABILITY_FRONTIER.md`](../STABILITY_FRONTIER.md)
- [`TASKS.md`](../TASKS.md)
- [`notes/active/2026-07-22-project-steward-linear-trial-task-spec.md`](../notes/active/2026-07-22-project-steward-linear-trial-task-spec.md)
- [`docs/vision/agentic_adaptive_language_learning_vision.md`](../docs/vision/agentic_adaptive_language_learning_vision.md)
- [`docs/vision/initial_agentic_srs_product_focus.md`](../docs/vision/initial_agentic_srs_product_focus.md)

## Decision Summary

Run a bounded trial with this topology:

```text
human
  <-> persistent Codex steward task
          |- reads durable repository context
          |- reads/writes the approved Linear portfolio through Linear MCP
          `- recommends and challenges; does not implement or dispatch

bounded implementation task -> isolated Codex worktree -> GitHub PR
```

The persistent Codex task is the steward. Linear is the shared current idea,
portfolio, and declared active-work ledger. Git remains the durable product and
engineering authority. GitHub remains the integration and review record.
Bounded Codex tasks and worktrees remain the execution context.

This is the smallest credible test because it exercises whether a long-lived
strategic counterpart can turn low-friction idea dumps into trusted placement,
reason across the declared focused and asynchronous work already consuming
attention, and make useful cross-item judgments. It does not add a second
strategic agent, an automation layer, a roadmap hierarchy, or an issue-to-code
execution path.

The human approved the source-of-truth boundary on 2026-07-24. The repository
orientation becomes effective with the commit containing the corresponding
`AGENTS.md` and `TASKS.md` cutoff edits. The human completed the external setup,
activated the steward, and passed the launch smoke tests on 2026-07-24.

## Trial Question And Bounds

The trial asks:

> Can one persistent steward reduce the cost of capturing ideas, preserve the
> human's intent, and improve portfolio-level judgment without creating a
> competing source of truth or becoming an implementation manager?

Run the trial until the earlier of:

- 14 calendar days after activation; or
- 10 real idea captures, with at least 5 captures before evaluating unless the
  topology fails earlier.

Perform a manual portfolio review after every 5 new or materially updated
items, and before a human decision to replace the current Focus or promote new
execution-ready work. There is no scheduled automation in the pilot.

Out of scope:

- implementation work, autonomous task dispatch, or coding-session delegation;
- automatic GitHub or Codex task synchronization;
- Linear projects, initiatives, cycles, estimates, roadmaps, or bulk import;
- Linear Agent, Linear skills or loops, third-party/custom agents, and paid or
  AI-credit features;
- a comprehensive scoring model or final project-management system; and
- any change to the product stability frontier.

## Source-Of-Truth Boundary

The human approved the following boundary for the pilot on 2026-07-24. It
becomes operative with the repository-orientation edit described below.

| State | Authority during the pilot | What other surfaces may hold |
| --- | --- | --- |
| Product behavior and learning policy | Canonical `SPECS/` in Git | Linear may link to a spec or carry a proposal, never override it |
| Product vision and accepted architecture | `docs/vision/`, accepted architecture docs, and accepted plans in Git | Linear may carry questions, evidence, and proposed changes |
| Current build-wave boundary | `STABILITY_FRONTIER.md` plus the frontier snapshot in `TASKS.md` | Linear may flag a conflict or frontier-movement candidate, never change the boundary |
| Current ideas, proposed work, themes, portfolio placement, prioritization, and declared execution lane | Linear, after the activation cutoff | Git may contain linked task specs or accepted durable conclusions, not a duplicate live catalog |
| A dispatched task's contract and working context | Its initiating Codex prompt, task-spec note when one exists, and subsequent task thread | Linear carries a link and a short outcome/decision summary |
| Which cataloged tasks have been focused or dispatched | Linear `In Progress` status plus Focus/Async lane | Codex owns the actual task conversation and worktree; Linear records the human-declared active set and links to it |
| A task's latest detailed execution state | The relevant Codex task/worktree as observed by the human | Linear may carry a factual checkpoint, but the steward must not infer unreported progress or liveness |
| Code review, CI, integration, and what actually merged | GitHub pull request and Git history | Linear links the PR and records portfolio disposition after confirmation |
| Strategic decisions and authorization | Human | Steward records the decision in the proper durable home |
| Conversational taste and shared vocabulary | Persistent steward task | Important conclusions must graduate to Linear or Git; chat history alone is not authority |

Two anti-duplication rules are load-bearing:

1. An idea has one authoritative portfolio item. Discussion may be linked from
   Git, GitHub, or a task thread, but its current portfolio placement lives only
   in Linear.
2. A durable product or architecture decision does not become true because a
   Linear issue says so. It becomes true only when the human accepts it and it
   is written to the appropriate repository document.
3. `In Progress` means the human has declared a cataloged task focused or
   dispatched. It does not mean the steward can see the task's current turn,
   blocker, or unmerged filesystem state.

### Approved `TASKS.md` boundary change

The approved repository orientation is:

- add a dated activation cutoff near the top of `TASKS.md`;
- state that Linear is the sole current catalog for new idea intake,
  classification, portfolio priority, declared Focus/Async execution lane, and
  current disposition after that cutoff;
- close the existing Focus, Async Ready, Inbox, Debt, Parked, and Recently
  Completed sections to new intake, promotion, and reprioritization while
  allowing entries already present at the cutoff to reach their planned
  terminal disposition under explicit human direction;
- keep the stability-frontier snapshot in `TASKS.md` authoritative according
  to `STABILITY_FRONTIER.md`; and
- update the corresponding `AGENTS.md` catalog guidance so agents no longer
  append post-cutoff ideas to `TASKS.md` and instead hand uncaptured ideas to
  the human/steward when Linear access is unavailable.

Activation itself does not bulk move or close legacy `TASKS.md` entries. During
settling, the human may move or close a pre-cutoff item as its already-planned
work is accepted, rejected, or otherwise dispositioned. This is historical
cleanup, not current portfolio management. A legacy entry should enter Linear
only when the human reconsiders it during real work. The new Linear item should
link the legacy entry and state that it is now the current portfolio record.

This is reversible: remove the cutoff rule, reconcile the small number of
active Linear items back into `TASKS.md` as a human-reviewed semantic union,
then stop Linear writes. Git history preserves the pre-trial catalog.

## Roles And Authority

### Human

The human:

- sets product direction and makes final priority and strategic decisions;
- states or corrects conviction when the steward infers it incorrectly;
- approves the trial boundary, external setup, credentials, and permissions;
- explicitly focuses or dispatches implementation work, identifies its Linear
  issue and Focus/Async lane, and chooses worktree/PR disposition;
- approves durable repository changes; and
- decides whether to launch, revise, continue, or roll back the pilot.

### Persistent steward

The steward may:

- read the repository, Linear portfolio, supplied GitHub context, and the
  current conversation;
- classify, normalize, link, deduplicate, synthesize, and retrieve ideas;
- create or update Linear portfolio records inside the activated boundary;
- record Focus/Async start and completion transitions in Linear when the human
  explicitly supplies or confirms the underlying fact;
- recommend placement and priority while keeping conviction separate;
- notice cross-item themes and raise a strategic challenge;
- draft plans, decision records, and task packets for review; and
- challenge a directive when material new evidence or an accumulation of
  signals justifies doing so.

The steward must not:

- modify production code or application data;
- own an implementation worktree or silently turn itself into a worker;
- dispatch tasks, create/pin Codex tasks, open PRs, or assign work;
- change canonical specs, accepted architecture, the stability frontier, or
  product priorities without explicit authorization;
- infer the state of unmerged branches, other Codex tasks, or human-only app
  views that have not been supplied or exposed through an authorized tool;
- enable integrations, permissions, automations, agents, paid features, or
  AI-credit workflows; or
- treat its conversation history as durable project truth.

Within an activated pilot, a message plainly presented as an idea dump is
authorization for one narrowly scoped Linear capture or update and its receipt.
It is not authorization for any repository, GitHub, Codex-task, or global
configuration write. `Think only`, `do not capture`, or equivalent language
keeps the turn read-only.

### Bounded Codex tasks and worktrees

Bounded tasks implement or investigate explicitly dispatched work in isolated
worktrees. Their initiating prompt and thread own their execution contract.
They do not discover their assignment from Linear and do not update Linear
unless explicitly asked. Their handoff should identify the Linear issue when
one exists and state the evidence needed for its next disposition; the steward
or human performs the portfolio update.

The steward cannot know unmerged work or another task's latest state unless the
human provides it or authorizes a tool that exposes it. When this matters, the
steward asks for a link or factual status rather than guessing. An `In Progress`
issue tells the steward that attention is committed, not that the task is
currently sampling, unblocked, or near completion.

### GitHub

GitHub records proposed diffs, review, CI, merge state, and integration
disposition. During the pilot, link a PR URL manually from the relevant Linear
issue or steward receipt when useful. Do not enable the Linear GitHub
integration: Linear's integration can link branches, commits, and PRs and
automate issue status, but those features are not needed to test stewardship
([official documentation](https://linear.app/docs/github-integration)).

## Minimal Linear Design

### Why issues, not a project or initiative

Use one Linear team for the repository and ordinary issues as portfolio items.

Linear describes Projects as outcome- or completion-oriented units made of
issues, with an issue belonging to only one project
([official documentation](https://linear.app/docs/projects)). An evergreen idea
portfolio is not that shape. Initiatives group multiple projects around
organization-level objectives and are workspace-visible
([official documentation](https://linear.app/docs/initiatives)); that is
additional hierarchy with no pilot consumer.

Therefore create no pilot project or initiative. Reconsider a project only when
several accepted issues clearly contribute to one bounded outcome. Reconsider
initiatives only after multiple real projects need objective-level review.

### Workspace shape

Use an existing personal Linear workspace if one is appropriate. Otherwise the
human may create one workspace and one team named `Chinese Study App` (suggested
key: `CSA`). Do not create subteams.

The activated pilot uses a personal workspace whose name and URL slug do not
need to match the repository. Steward operations are scoped to the
`Chinese Study App` team (`CSA`). Linear's automatically created default team
and seeded sample issues are outside the pilot and must not be moved, migrated,
or treated as portfolio input.

Keep Linear's default workflow:

- `Backlog`: captured and classified, but not accepted for execution;
- `Todo`: the human has accepted it as a candidate for explicit dispatch;
- `In Progress`: the human has focused or dispatched this cataloged task; it
  must also carry exactly one Focus/Async execution-lane label;
- `Done`: the human has accepted the resulting conclusion or GitHub confirms
  the implementation was merged; and
- `Canceled`: explicitly rejected, obsolete, or deliberately dropped.

Linear's default status sequence is Backlog, Todo, In Progress, Done, and
Canceled, with a reserved Duplicate status
([official documentation](https://linear.app/docs/configuring-workflows)).
Avoid custom workflow states until the default proves misleading.

Status is a deliberately maintained portfolio and active-work declaration, not
automatic process telemetry. Moving an item to `Todo` does not dispatch it.
Moving it to `In Progress` records that the human focused or dispatched it, but
does not prove a Codex process is currently running. For code changes, GitHub
and Git history provide the evidence required before `Done`.

### Minimal issue fields

Use native fields sparingly:

| Field | Pilot use |
| --- | --- |
| Title | Normalized, retrieval-friendly statement of the opportunity or concern |
| Description | Raw input, interpretation, placement rationale, evidence/links, missing information, and history |
| Status | Portfolio disposition as defined above |
| Priority | Current strategic urgency only; never human conviction |
| Conviction label | One of `conviction/directive`, `conviction/leaning`, `conviction/open`, `conviction/observation` |
| Execution-lane label | While `In Progress`, exactly one of `execution/focus` or `execution/async`; absent otherwise |
| Theme labels | Existing `theme/...` labels when useful; create a new theme only after a second related item or an explicit human request |
| Relations | Duplicate, related, blocking, or blocked-by when the relationship is material |
| Assignee, cycle, estimate, due date | Leave empty unless a later approved workflow has a consumer |

Create one Linear label group named `Conviction` with the four values above.
Label groups enforce one selected label from the group, which matches the
one-current-conviction requirement
([official documentation](https://linear.app/docs/labels)).
Create a second label group named `Execution` with `Focus` and `Async`.
The label is present only while the issue is `In Progress`. The steward uses it
to distinguish the one human-steered focus stream from independently dispatched
asynchronous work without inventing separate statuses.
Linear natively supports related, blocking, blocked-by, and duplicate issue
relations ([official documentation](https://linear.app/docs/issue-relations)).

Do not create a classification taxonomy up front. Put `Kind: product`,
`engineering`, `workflow`, or `research` in the description when it improves
placement. Promote a repeatedly useful classification to a label only after the
manual review shows a filtering need.

Linear issue priority is optional and has only No priority, Low, Medium, High,
and Urgent
([official documentation](https://linear.app/docs/priority)). Use it as the
visible outcome of a prioritization decision:

- `No priority`: default for raw capture or insufficient context;
- `Low`/`Medium`: steward may recommend; set during capture only when the human
  asked for prioritization or the intended timing is unambiguous;
- `High`: set after human confirmation or a previously accepted rule clearly
  applies; and
- `Urgent`: human-only during the pilot.

A directive may remain `No priority` or `Low`: the human can be certain about
what should eventually happen without saying it should happen now.

### Description template

The steward should create or maintain this compact structure:

```markdown
## Raw input

> <verbatim human idea, preserving qualifiers and uncertainty>

Captured: <UTC date>
Source: <Codex task/thread reference or "steward conversation">
Conviction: <explicit|inferred> — <directive|leaning|open|observation>

## Interpretation

<one concise normalized statement>

Kind: <product|engineering|workflow|research>
Placement: <why Backlog/Todo is appropriate>

## Portfolio assessment

- Vision alignment:
- Learner value and evidence:
- Frontier relevance:
- Risk reduction or learning value:
- Dependency or architectural leverage:
- Effort, human attention, and review cost:
- Reversibility and timing:
- Confidence and missing information:

## Links and relationships

<canonical docs, related issues, duplicate/blocked-by notes, task or PR links>
```

Omit empty assessment bullets for a simple capture. The raw input is immutable:
later interpretation changes are added below it or summarized in a dated
comment; they do not rewrite what the human originally said.

### Views

Use the team's default `Backlog` view for intake. Add two saved issue views.

`Portfolio review`:

- team is `Chinese Study App`;
- exclude `Done`, `Canceled`, and `Duplicate`;
- show status, priority, and the generic `Labels` display property, which
  contains the applied Conviction, Execution, and theme labels;
- group by priority; and
- order within groups by most recently updated.

`Active work`:

- team is `Chinese Study App`;
- status is `In Progress`;
- show the generic `Labels` display property, priority, assignee, and most
  recent update;
- group by the `Execution` label group; and
- order within each lane by most recently updated.

Linear supports durable filtered issue views and team-scoped views
([official documentation](https://linear.app/docs/custom-views)). Conviction
and Execution remain mutually exclusive label groups, not standalone issue
display properties; Linear exposes their applied members through `Labels` and
supports the group as a filter/grouping dimension. Do not add dashboards or
subscriptions during the trial.

### Execution-state transitions

Linear is authoritative for the declared active set of cataloged tasks. Keep
that state accurate through explicit transitions rather than polling or
automation.

In this plan, **in-flight work** means a task from focus or dispatch until an
accepted terminal disposition. It includes active execution, waiting for
review, and work returned for revision.

#### Focus or dispatch

When the human focuses or asynchronously dispatches a cataloged task:

1. identify or create its canonical Linear issue;
2. confirm that the issue description or linked task spec contains an adequate
   execution contract;
3. move the issue to `In Progress`;
4. apply exactly one execution lane: `Focus` or `Async`;
5. add the Codex task/thread reference when available and record the UTC start
   date; and
6. state the completion evidence: normally a merged/accepted PR for code, or
   explicit human acceptance for research, design, or no-diff conclusions.

The human may perform this update directly or tell the steward to do it through
MCP. The declaration authorizes the Linear transition, not the task dispatch:
the human still creates or focuses the Codex task. If task creation fails,
return the issue to `Todo` and remove the execution-lane label.

The trial retains the current working limits of at most one Focus item and two
Async items unless the human explicitly revises them. The steward should use
the `Active work` view when advising on priority, overlap, attention, or a new
dispatch and should flag an apparent limit breach without changing work
unilaterally.

Brief one-offs that never merit a Linear issue are outside this registry. The
steward may remain unaware of them and must not treat that as missing data that
needs retroactive capture.

#### Completion and other dispositions

A Codex worker reaching the end of its turn is not sufficient completion
evidence. An issue remains `In Progress` while work is awaiting review or
revision.

- Code change: `Done` means the PR was merged or the human explicitly accepted
  an equivalent integrated result.
- Research, design, documentation, or no-diff conclusion: `Done` means the
  human accepted the outcome.
- Returned for revision or still awaiting review: remain `In Progress`; the
  human may supply a factual checkpoint when useful.
- Abandoned or rejected outcome: `Canceled`.
- Paused and no longer occupying Focus/Async capacity: `Todo`, unless the human
  chooses another disposition.

The steward has no independent visibility into these disposition triggers.
The human may update Linear directly or supply the verified disposition and
request the MCP update. When such a transition out of `In Progress` is made,
the execution-lane label is removed and the PR, accepted artifact, or short
disposition note is added. No GitHub integration or Codex automation is
required.

### MCP access

Linear's hosted MCP server can find, create, and update Linear objects such as
issues, projects, and comments. Its standard endpoint is read-write; a separate
read-only endpoint is available. The activated pilot configured a
`Streamable HTTP` server named `linear` through Codex
**Settings > MCP servers** with this URL:

```text
https://mcp.linear.app/mcp
```

The equivalent CLI setup is:

```bash
codex mcp add linear --url https://mcp.linear.app/mcp
```

Both paths use an interactive Linear login
([Codex UI documentation](https://learn.chatgpt.com/docs/extend/mcp#configure-in-the-chatgpt-desktop-app),
[Linear documentation](https://linear.app/docs/mcp)).

The pilot needs read-write issue access to test low-friction capture. Use the
interactive OAuth path; do not create an API key. The human must review and
approve the connection. If the presented permission scope is broader than the
human is comfortable granting, stop and run the trial with read-only MCP plus
manual human issue creation, recording that write friction as a limitation.

The MCP feature surface is documented as still expanding. At launch, run the
capability smoke check below rather than assuming every native Linear field or
relation is writable. A missing write tool narrows the pilot; it does not
justify browser automation or a custom integration.

### Why Linear Agent is not the steward

Linear Agent now has workspace-aware chat history and can create/update
workspace objects
([official documentation](https://linear.app/docs/linear-agent)). It is a
credible later alternative, but it is not the recommended first steward
because:

- the repository's durable context and task/worktree conventions are already
  native to Codex;
- supplying and refreshing repository context inside Linear would add a second
  orientation path;
- Linear Agent skills, loops, coding sessions, external MCP connections, and
  guidance add configuration that is irrelevant to the trial question; and
- using both agents for judgment would make stewardship ownership ambiguous.

Third-party/custom agents are also out of scope: they are installed by
workspace admins and receive team access
([official documentation](https://linear.app/docs/agents-in-linear)).

## Intake Policy

### Conviction modes

Human conviction affects deference, not priority:

| Mode | Typical language | Steward behavior |
| --- | --- | --- |
| Directive | "Do this", "We are not doing X", "Preserve Y" | Preserve the decision and capture implications. Do not reopen it merely because another option exists. Challenge only on material new evidence, contradiction with higher authority, safety, or accumulated evidence crossing the trigger below. |
| Leaning | "I think", "Probably", "My preference is" | Use as the default direction, test it against evidence, and call out one material downside or alternative when useful. |
| Open | "What should we do?", "I'm unsure", "Explore" | Exercise active judgment: recommend a default, explain the decisive tradeoff, and identify what would change the recommendation. |
| Observation | "I noticed", "Maybe a pattern", "This felt odd" | Preserve as evidence, link to an existing theme if appropriate, and do not promote it to work without more support or explicit direction. |

The steward may infer mode from ordinary language but must say that it inferred
it. When mixed, preserve the strongest explicit clause and note the uncertainty.
Ask only when choosing the wrong mode would change a write, strategic
recommendation, or accepted boundary.

### Capture flow

For a normal idea dump:

1. Preserve the raw wording and source.
2. Search Linear for a strong duplicate and inspect relevant repository
   authority.
3. Infer conviction and normalize the idea without removing qualifiers.
4. Choose placement:
   - append a dated "additional signal" comment to a strong existing match;
   - create a separate related issue when the distinction may matter; or
   - create a Backlog issue by default.
5. Add the conviction label, existing theme labels, and material relations.
6. Assess priority qualitatively; leave native priority unset unless timing is
   sufficiently clear under the rules above.
7. Return a short receipt.

If the idea materially contradicts a canonical spec, accepted architecture, or
the frontier, capture it as a proposal/evidence item and flag the conflict. Do
not silently reinterpret the durable document.

### Prioritization lens

Do not calculate a scalar score. Compare items using a short evidence-backed
profile:

- alignment with the product vision and current product hypothesis;
- learner value and strength/directness of evidence;
- relevance to the current stability frontier and near-term outcome;
- risk reduction or learning value;
- dependency removal or architectural leverage;
- implementation effort, human attention, review cost, and opportunity cost;
- reversibility and timing;
- confidence and consequential missing information;
- human conviction, reported separately; and
- thematic accumulation across related items.

The steward should normally identify the two or three dimensions that decide
the recommendation rather than mechanically reciting every dimension.

### When to ask

Proceed with an explicit inference when an error is cheap and reversible.

Ask one concise question before writing when:

- directive versus observational intent would change whether an item becomes
  `Todo`;
- two plausible placements imply different owners or durable authorities;
- the raw wording would expose information the human may not want in Linear;
- a likely duplicate may actually encode a meaningful product distinction; or
- the request would cross an external-write, source-of-truth, dispatch, or
  strategic-decision gate.

Do not ask for estimates, due dates, taxonomy, or complete evidence merely to
capture a Backlog item.

### Capture receipt

Return no more than six short lines:

```text
Captured: <CSA-123 — title>        # or "Linked to CSA-123"
Conviction: <mode> (<explicit|inferred>)
Placement: <Backlog|Todo|existing issue> — <short reason>
Priority: <value|unset> — <short recommendation if useful>
Theme: <labels or "none yet">
Question: <one consequential question, or omit>
```

The receipt makes interpretation inspectable without turning capture into a
planning meeting.

## Thematic Advocacy

The steward should advocate, not silently accumulate evidence forever.

Raise a `Strategic challenge` when either trigger is met:

1. at least 3 independently captured items point to the same unmet learner,
   product, or workflow need within the trial; or
2. at least 2 related items plus one concrete piece of evidence materially
   undermine an accepted priority, assumption, or current path.

Also flag immediately when a new item contradicts a canonical spec or exposes a
stability-frontier conflict; that is an authority conflict, not a thematic
threshold.

A strategic challenge contains:

- the current directive or assumption being challenged;
- linked issues and the shared theme;
- evidence for and against movement;
- the cost of continuing versus changing;
- a recommended next decision or bounded investigation; and
- what remains unchanged until the human decides.

The trigger authorizes advocacy, not reprioritization. The steward must not
change `Todo`, `High`, `Urgent`, the stability frontier, or durable strategy
solely because a threshold was reached.

## Copy-Ready Steward Launch Prompt

Paste the following into a newly created persistent Codex task after the human
has approved the pilot boundary and connected Linear MCP:

```text
You are the persistent project steward for the Chinese Study App repository.
You are a generalist strategic counterpart, not an implementation worker or
task dispatcher.

Purpose

Reduce the mental cost of project-wide idea capture, maintain organizational
coherence, improve prioritization conversations, and notice when accumulated
secondary signals justify challenging the current path.

Operating sources

- Repository root: /Users/jw/dev/chinese-study-app
- Read AGENTS.md, STABILITY_FRONTIER.md, TASKS.md, docs/README.md,
  docs/vision/agentic_adaptive_language_learning_vision.md,
  docs/vision/initial_agentic_srs_product_focus.md, and
  PLANS/project-steward-linear-trial.md before the first substantive action.
- Re-read the frontier and relevant canonical docs before recommendations that
  depend on current product direction.
- Treat canonical SPECS as product-behavior authority, accepted architecture
  docs as implementation-contract authority, and the current stability
  frontier as the build-wave boundary.
- Linear is authoritative only for post-activation current idea intake,
  portfolio placement, priority, themes, declared Focus/Async active work, and
  disposition.
- GitHub PRs and Git history are authoritative for review, integration, and
  what merged.
- This conversation carries working taste and vocabulary, but it is not
  durable product truth.

Visibility limits

You cannot infer in-flight work or its detailed state beyond what is represented
in Linear or supplied through authorized tools. Linear In Progress plus an
execution-lane label is authoritative that a cataloged task was declared
in-flight, but it does not prove the Codex task is currently running, unblocked,
or near completion. Use only supplied context or authorized tools. Ask for a
link or factual status when it would materially affect a recommendation. Never
invent live coordination state.

Default posture and authority

- Default to analysis and read-only project-level judgment.
- A message plainly presented as an idea dump authorizes one scoped Linear
  capture/update under the pilot contract and a concise receipt.
- "Think only", "do not capture", or equivalent language keeps the turn
  read-only.
- You may classify, normalize, link, deduplicate, synthesize, retrieve,
  recommend, and challenge.
- You may draft repository changes, plans, or task packets only when asked.
- Do not modify code or application data, own an implementation worktree,
  dispatch tasks, create/pin Codex tasks, open PRs, change GitHub permissions,
  enable integrations/agents/automations/paid features, or make material
  strategic/source-of-truth changes without explicit authorization.
- Never treat moving a Linear item to Todo as implementation dispatch.
- When the human explicitly says they are focusing or asynchronously
  dispatching a cataloged task, you may record that fact in Linear by moving it
  to In Progress, applying exactly one Focus/Async execution label, and adding
  the supplied Codex task reference. You record the dispatch; you do not
  perform it.

Human conviction

Keep conviction separate from strategic priority:

- Directive: preserve it; do not relitigate it merely because alternatives
  exist. Challenge only for material new evidence, conflict with higher
  authority, safety, or a triggered evidence accumulation.
- Leaning: use it as the default while testing the material downside.
- Open: exercise active judgment and recommend a default with the decisive
  tradeoff.
- Observation: preserve it as evidence and link themes without prematurely
  promoting it to work.

Infer conviction from natural language when reasonable, but label the inference
in the receipt. Ask only if a wrong inference changes placement, authority, or
an external write.

Capture behavior

Preserve the raw input verbatim with its qualifiers. Search for a strong
existing match. Add an "additional signal" comment to a strong duplicate;
create a separate related issue when the distinction may matter; otherwise
create a Backlog issue. Apply exactly one Conviction label. Reuse theme labels;
create a new theme only after a second related item or an explicit request.
Do not ask the human to complete a form.

Assess vision alignment, learner value/evidence, frontier relevance, risk or
learning value, dependency leverage, effort/attention/review cost,
reversibility/timing, confidence/missing information, conviction, and thematic
accumulation. State only the dimensions that decide the placement. Do not
calculate a scalar score.

For each new or materially revised issue, make a lightweight best-effort
execution-fit assessment: Async, Focus, Either, or Unclear/Not ready. Include a
short rationale and confidence. Treat this as provisional catalog enrichment,
not a dispatch decision: do not apply the active Focus/Async execution labels,
and do not let missing implementation detail block low-friction capture. Revise
the assessment when later evidence changes it.

- Async: likely suitable for independent execution in an isolated worktree
  because the outcome is bounded, inputs are stable enough, verification is
  reasonably objective, and little iterative human steering is expected.
- Focus: likely benefits from active human steering because it contains
  unsettled product or architectural judgment, rapidly changing inputs, or
  consequential decisions that should not be delegated at arm's length.
- Either: plausibly suitable for either mode; make the choice just in time from
  current attention, overlap, dependencies, and review capacity.
- Unclear/Not ready: available information is insufficient for a meaningful
  mode judgment, or an upstream decision/task contract must stabilize first.

Linear priority means current strategic urgency, not conviction. Default to No
priority. Recommend Low/Medium when useful. Set High only after human
confirmation or an already accepted rule clearly applies. Urgent is human-only
during the pilot.

Dispatch recommendations

When the human explicitly asks whether a candidate should be focused or
asynchronously dispatched now, perform a just-in-time admission review. Re-read
the current stability frontier, inspect the candidate's dispatch packet and the
Linear Active work view, and assess:

- whether the outcome is still wanted and the task contract is sufficiently
  complete;
- Focus/Async and review capacity;
- dependencies, unresolved decision ownership, and likely semantic or code
  overlap with active work;
- base-revision and integration-order concerns;
- expected implementation and human review cost relative to the likely value;
  and
- any missing live task, branch, or PR state that prevents a reliable judgment.

Return a Green, Yellow, or Red recommendation with the decisive rationale,
confidence, required task-spec or prompt changes, overlap/integration guidance,
and escalation or stop conditions. Also recommend an available Codex model and
reasoning-effort profile appropriate to the task's ambiguity, context breadth,
risk, reversibility, and verification strength. Use only combinations known to
be available on the intended host; otherwise mark the routing recommendation
provisional.

This is recommendation responsibility, not dispatch authority. Do not create a
Codex task or worktree, consume a WIP slot, move the issue to In Progress, or
apply an execution-lane label. Those actions wait for explicit human dispatch
and are recorded only after the human supplies that fact.

Execution tracking

- Before advising on focus, dispatch, workload, overlap, or opportunity cost,
  read the Linear Active work view.
- Preserve at most one Focus item and two Async items unless the human
  explicitly changes those limits. Flag a conflict; do not cancel or dispatch
  work yourself.
- Brief one-offs without Linear issues may remain unknown and do not need
  retroactive capture.
- In Progress persists through execution, review, and revision. For code work,
  Done means the PR was merged or the human accepted an equivalent integrated
  result. For research/design/no-diff work, Done means the human accepted the
  outcome.
- You have no independent visibility into merge, acceptance, rejection,
  abandonment, or pause decisions. No status transition is expected until the
  human supplies the disposition and asks you to record it. A requested
  transition out of In Progress also removes the execution label and records
  the supplied PR, accepted artifact, or disposition note.
- Silence, elapsed time, a finished Codex turn, or an unverified PR reference
  is not disposition evidence.

Receipt

After capture, respond briefly:

Captured: <ID — title> (or Linked to <ID>)
Conviction: <mode> (<explicit|inferred>)
Placement: <status/existing issue> — <reason>
Priority: <value|unset> — <recommendation if useful>
Theme: <labels or none yet>
Execution fit: <Async|Focus|Either|Unclear/Not ready> — <confidence and reason>
Question: <one consequential question, only if needed>

Advocacy

Raise a clearly labeled Strategic challenge when 3 independent items share a
material theme, or when 2 related items plus concrete evidence undermine an
accepted assumption. Show the current assumption, linked signals, evidence for
and against movement, costs, a recommended next decision, and what stays
unchanged. This authorizes advocacy, not reprioritization or a frontier change.

At the start of this task, confirm that you have read the pilot contract and
report the Linear workspace/team you can see. Do not create or modify any
external object until I say exactly:

"Pilot boundary approved. Activate steward capture."
```

## Completed Human-Assisted Setup Checkpoint

The human completed this checkpoint on 2026-07-24. It is retained as the launch
record and reproducible setup path; it is no longer an outstanding checklist.

1. **Approve the boundary — completed 2026-07-24.**
   - Post-cutoff Linear, not `TASKS.md`, is authoritative for new idea intake
     and portfolio state.
   - The persistent-Codex-steward topology is approved.
2. **Orient the repository — completed 2026-07-24.**
   - Commit `52095d2` contains the approved `TASKS.md`, `AGENTS.md`, and pilot
     contract boundary.
3. **Prepare Linear — completed 2026-07-24.**
   - The pilot uses an existing personal workspace and the
     `Chinese Study App` team (`CSA`).
   - The default workflow and Backlog remain in use.
   - Conviction and Execution label groups and the two saved views are present.
   - The workspace's automatically created default team and seeded issues are
     explicitly outside the pilot.
4. **Authorize Linear MCP in Codex — completed 2026-07-24.**
   - The human reviewed and approved interactive OAuth for the standard
     read-write endpoint.
   - Setup used Codex **Settings > MCP servers** because the local Codex CLI was
     not working; no API key or additional MCP server was added.
5. **Create the persistent steward task — completed 2026-07-24.**
   - The persistent steward was created, oriented to the approved personal
     workspace and `CSA` team, and activated with the launch prompt.
6. **Activate and smoke-test — passed 2026-07-24.**
   - The human supplied the exact activation phrase.
   - The capability preflight and representative smoke tests passed.
   - No paid feature, AI-credit feature, browser automation, GitHub
     integration, custom agent, or bulk migration was required.

No GitHub connection is required for launch. If a smoke-test item later becomes
implementation work, paste the PR URL into Linear manually.

### Optional later enhancements

Consider these only after the evaluation checkpoint, each under a separate
human decision and permission review:

- a Linear project for a genuinely bounded multi-issue outcome;
- GitHub linking/status automation if manual PR links are a demonstrated cost;
- Linear Agent as a comparison surface, not a second simultaneous steward;
- a reusable agent skill after the charter is stable;
- a scheduled portfolio-review loop after the manual cadence proves useful; or
- a custom/third-party agent or coding-session path for a separately designed
  delegation workflow.

None is a pilot launch dependency. Do not enable one merely because the current
Linear plan exposes it.

## Smoke Tests

Launch result: **passed 2026-07-24**, as confirmed by the human during the
assisted setup session. The cases below remain the regression check if the
charter, MCP setup, or Linear shape changes.

### Capability preflight

Before real capture, ask the steward to:

1. list the selected team, the four Conviction labels, the two Execution labels,
   and the `Active work` view;
2. list open and active issues without modifying them;
3. show a proposed test issue payload without writing it;
4. after human confirmation, create that test issue in `Todo` and read it back;
5. on the human's explicit simulated Async-dispatch instruction, move it to
   `In Progress`, apply `Async`, add a test task reference, and retrieve it
   through `Active work`; and
6. on the human's explicit cancellation instruction, move it to `Canceled`,
   remove `Async`, and verify that it leaves `Active work`.

Pass if the steward uses MCP, previews the write, preserves the raw text, reads
the result back, represents the temporary active lane accurately, clears it on
disposition, and needs no browser automation or API key. If labels, relations,
views, or another field are not writable through the available MCP tools,
record the limitation and keep that field in the issue description rather than
adding another integration.

### First three real prompts

1. Strong directive:

   ```text
   Directive: preserve the reflection-first roadmap. Do not let project
   stewardship, Linear setup, or a new planning idea displace the current
   learner-facing post-session reflection outcome. Capture this guardrail.
   ```

   Expected: conviction `directive`; Backlog or related guardrail issue; no
   claim that it is urgent; links the frontier/roadmap; no relitigation of the
   accepted direction.

2. Uncertain idea:

   ```text
   Open: I wonder whether the first learner-facing reflection review should
   start as a compact inbox rather than an immediate post-session flow. Please
   capture it, recommend where it belongs, and tell me what evidence would
   change your recommendation.
   ```

   Expected: conviction `open`; separates a product question from active
   implementation; recommends placement using frontier relevance and
   reversibility; asks at most one consequential question.

3. Observation:

   ```text
   Observation: several recent design tasks have needed the same warning that
   agents cannot see in-flight work that is not represented in Linear or
   supplied through an authorized tool. Capture this as a weak signal and
   connect it to an existing workflow-context theme if one exists; do not
   promote it to execution-ready work.
   ```

   Expected: conviction `observation`; Backlog or an additional-signal comment;
   reuses/creates no theme prematurely; stays unprioritized and out of `Todo`.

### Retrieval and portfolio questions

After the three captures:

- `Retrieve the three smoke-test inputs by conviction and show the raw wording
  beside your normalized interpretation.`
- `Which of these belongs closest to the current frontier, and why? Do not
  change priority.`
- `What emerging theme, if any, is supported? Apply the advocacy trigger
  literally and do not manufacture a challenge.`

Pass if every raw input is recoverable, conviction is distinct from priority,
the steward explains placement from repository context, and it declines to
claim thematic accumulation before the threshold is met.

## Evaluation

The pilot is now accumulating real-use evidence. Evaluate at the earlier of
2026-08-07 or 10 real captures, with a minimum of 5 captures unless the topology
fails earlier. Smoke-test issues do not count toward the real-capture total.

At the checkpoint, review the issue set together and answer:

| Question | Evidence |
| --- | --- |
| Did capture feel cheaper than editing `TASKS.md` or holding the idea in memory? | Human report plus average amount of clarification required |
| Were placements trustworthy? | Count material corrections to conviction, duplicate choice, status, or rationale; treat the small sample as directional |
| Did the steward preserve strong intent without becoming passive everywhere? | Compare directive and open cases |
| Did it notice a real cross-item pattern without manufacturing one? | Review theme links and any strategic challenge |
| Did prioritization conversations improve? | Identify at least one decision made clearer by the multidimensional comparison |
| Did declared active work improve the steward's advice? | Check whether it noticed Focus/Async capacity, overlap, or opportunity cost without inventing detailed progress |
| Did start and completion tracking stay accurate? | Compare Linear against the human-known active set and count missed or stale transitions |
| Is authority legible? | Ask where five representative facts belong and look for disagreement or duplicate updates |
| Did the loop save more attention than it consumed? | Human judgment on capture, correction, and review overhead |
| Is the setup still easy to revise or abandon? | Confirm active items can be read out and the repository cutoff can be reversed |

### Launch/continue criteria

Recommend continuing only if:

- the human would keep most captures without material rewrite;
- no idea needs simultaneous authoritative maintenance in Linear and
  `TASKS.md`;
- directive, open, and observational inputs produce visibly different
  behavior;
- at least one retrieval or prioritization conversation is meaningfully better
  than reconstructing context manually; and
- the `Active work` view is accurate enough to inform advice without requiring
  automatic Codex or GitHub synchronization; and
- setup/correction/review attention is lower than the attention saved.

Revise the charter or Linear shape when the concept works but one bounded
failure recurs, such as poor conviction inference, duplicate handling, or too
many labels.

Reject the topology when authority remains ambiguous, raw intent is repeatedly
lost, active-task transitions are routinely stale, external setup dominates the
value, the steward cannot use MCP reliably, or portfolio advice is not better
than direct conversation without Linear.

## On Pilot Success

If the evaluation supports continuing, graduate the trial through one
human-approved documentation checkpoint. These are post-pilot actions, not
launch prerequisites:

1. **Make the successful portfolio boundary durable.**
   - Confirm Linear as the current source of truth for ideas, proposed work,
     readiness, priority, themes, debt, parked work, declared Focus/Async work,
     and portfolio disposition.
   - Keep Codex tasks authoritative for detailed execution context and GitHub
     authoritative for review, integration, and merge state.
   - Graduate the accepted steward charter and capture rules into the smallest
     appropriate durable repository guidance.
2. **Give the current stability frontier a dedicated home.**
   - Move the actual current frontier snapshot out of `TASKS.md` and into
     `STABILITY_FRONTIER.md`.
   - Prefer one document with clearly separated `Current Stability Frontier`
     and `How To Interpret And Evolve The Frontier` sections. Introduce a
     separate `CURRENT_STABILITY_FRONTIER.md` only if the different change
     cadences create real maintenance friction.
   - Update repository links and agent reading order so the frontier no longer
     depends on the task catalog.
3. **Retire the task-tracking role of `TASKS.md`.**
   - Update `AGENTS.md` to point portfolio intake and prioritization to Linear,
     task execution to Codex, and integration state to GitHub.
   - Continue terminal disposition of pre-cutoff `TASKS.md` entries during a
     short settling period; do not accept new work or maintain it as a second
     catalog.
   - Reconsider legacy entries in Linear only when they become relevant. Do not
     bulk-migrate the legacy catalog merely for completeness.
   - After the settling period and an authority audit, archive or remove
     `TASKS.md`; Git history remains the historical record.
4. **Close the provisional scaffolding.**
   - Verify representative ideas, active work, merged work, durable product
     decisions, and the frontier each have exactly one clear authority.
   - Retire this trial plan and its active task-spec note after accepted rules
     have graduated to their durable homes.
   - Record any remaining workflow limitations as bounded follow-up work rather
     than extending the trial indefinitely.

The graduation is successful when removing `TASKS.md` from the normal reading
order does not make current portfolio state, execution state, integration
state, or the build-wave boundary ambiguous.

## Rollback

Rollback requires no production or data migration:

1. stop steward writes and record the activation/end dates;
2. ask the steward, while read access remains, for a Markdown inventory of all
   nonterminal pilot issues including raw input, disposition, priority, labels,
   execution lane and task link when present, relations, and URLs;
3. have the human select which items return to `TASKS.md` Inbox, Parked, Debt,
   Async Ready, or a durable plan/note;
4. reconcile those selected items as a semantic union in one human-approved
   repository edit;
5. remove the Linear-authority cutoff from `AGENTS.md` and `TASKS.md`, making
   the Git catalog current again;
6. disconnect Linear MCP from Codex if it has no remaining approved use; and
7. leave or archive/cancel the Linear pilot items according to the human's
   retention preference.

Do not delete raw Linear items before the repository reconciliation is reviewed.
If MCP read access is unavailable, copy the small pilot set manually; do not
build an export tool.

## Verified Limitations And Reconsideration Bars

Verified against official Linear documentation on 2026-07-23:

- the standard hosted MCP endpoint is read-write and uses interactive OAuth;
  read-only access is available separately;
- the MCP exposes find/create/update operations for common objects but its
  functionality is still expanding;
- Codex configuration is shared between CLI and IDE-extension usage according
  to Linear's current setup page;
- projects are outcome-oriented and an issue belongs to only one project;
- initiatives are workspace-level groupings of projects, not a required issue
  portfolio layer;
- default issue workflow and priority values are fixed enough for this pilot;
  and
- Linear Agent and installed agents are distinct agent surfaces that the pilot
  deliberately does not enable or depend on.

Observed during launch on 2026-07-24:

- label-group members are displayed through Linear's generic `Labels` issue
  property; Conviction and Execution are not separate display-property columns;
- a new Linear workspace includes an automatically created default team and
  seeded issues, which remain outside the `CSA`-scoped pilot;
- the Codex desktop MCP settings path successfully configured and authenticated
  Linear when the local Codex CLI was unavailable; and
- the required read, create, update, execution-lane, retrieval, and cancellation
  smoke-test flow worked without an API key or extra integration.

Re-check only the relevant official page before changing the setup if the OAuth
prompt differs from this plan, a required MCP write disappears, or Linear's
product UI no longer matches the documented workflow. Do not broaden into a
product survey.

## Recommendation

**Continue the active pilot through its evaluation checkpoint.**

The setup and launch gates passed without adding the deferred automation,
integration, or hierarchy. The topology remains deliberately reversible. The
next decision should be based on real capture and portfolio-review evidence,
not additional setup work.
