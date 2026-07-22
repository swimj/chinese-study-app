# Project steward + Linear trial orientation

status: active
type: work-bundle
created: 2026-07-22
retire-when: The initial project-steward trial is launched or deliberately rejected, and its accepted operating rules have graduated into their durable homes
related:
  - TASKS.md
  - AGENTS.md
  - STABILITY_FRONTIER.md
  - docs/vision/agentic_adaptive_language_learning_vision.md
  - docs/vision/initial_agentic_srs_product_focus.md

## Purpose and context

Orient the project for a serious but deliberately provisional trial of a
long-lived **project steward**: a generalist strategic teammate that can help
with project-wide idea intake, classification, prioritization, planning, and
organizational coherence without owning a particular implementation task or
Git worktree.

The main problem to test is not ordinary issue tracking. It is whether a
steward can accept low-friction idea dumps, interpret them against the product
vision, place them reliably, and notice when an accumulation of individually
secondary ideas suggests that the project should reconsider its current path.
The steward must calibrate its autonomy: respect strong human direction while
providing more active guidance when the human is uncertain.

Linear is the leading candidate for shared, extra-Git issue and portfolio
state. Its MCP and agent surfaces appear well matched to the desired role, but
using Linear is not itself the outcome. The task may recommend a different
minimal topology if it identifies a concrete limitation that would make the
trial misleading. Do not expand into general project-management-tool research
or build a bespoke tracker.

This is a trial setup, not a final operating system. Prefer a coherent first
loop that can be exercised and evaluated over a comprehensive design.

## Outcome

A launch-ready and reviewable pilot contract that lets the human, with a small
amount of explicit setup assistance, start a persistent steward relationship
and exercise end-to-end idea intake and prioritization against real project
context. The contract must make clear:

- which state lives in Git, Linear, GitHub, and the steward thread;
- what the steward may decide, recommend, write, or challenge;
- how the human's degree of conviction changes steward behavior;
- how raw ideas become classified portfolio items without losing their origin;
- how accumulated weak signals can trigger strategic advocacy;
- how the trial is launched, evaluated, revised, or abandoned; and
- which setup actions require the human rather than browser-heavy agent work.

## Working assumptions already accepted

- The steward is a persistent strategic counterpart, not another bounded
  implementation worker.
- The steward should default to analysis and project-level judgment. It does
  not modify code, dispatch implementation tasks, or make material strategic
  changes unless explicitly authorized.
- A long-lived conversation can carry taste and shared vocabulary, but durable
  product truth still belongs in canonical specs, vision/architecture docs,
  and the stability frontier.
- `TASKS.md` is a versioned work catalog, not live cross-worktree coordination
  state.
- GitHub pull requests remain the initial integration and code-review record.
- Extra-Git state is desirable for current issue/idea intake, prioritization,
  and portfolio awareness if it avoids ambiguous duplicate authority.
- Human conviction and issue priority are different dimensions. At minimum,
  the operating model must distinguish directive, leaning, open, and
  observational input, even if those modes are inferred from natural language
  rather than entered as required fields.
- Prioritization is multidimensional. Do not reduce it to an unexplained scalar
  score or pretend that precision exists where the evidence is qualitative.
- The steward should preserve strong human decisions, but repeated contrary
  evidence or thematic accumulation should cause it to advocate explicitly
  rather than silently comply forever.
- Initial use is human-in-the-loop and iterative. Scheduled reviews,
  automations, custom Linear agents, and coding-session delegation are later
  options, not prerequisites.

## Required inputs

Read first:

- `AGENTS.md`
- `STABILITY_FRONTIER.md`
- `TASKS.md`
- `docs/README.md`
- `notes/README.md`
- `docs/vision/agentic_adaptive_language_learning_vision.md`
- `docs/vision/initial_agentic_srs_product_focus.md`
- `PLANS/agentic-roadmap-glm-5.2.md`

Inspect only the additional product specs, plans, active notes, and recent Git
history needed to determine what project context the steward must load. Do not
turn this into a full repository documentation cleanup.

For current Linear capability checks, prefer the smallest relevant set of
official references:

- <https://linear.app/docs/mcp>
- <https://linear.app/docs/linear-agent>
- <https://linear.app/docs/agents-in-linear>
- <https://linear.app/docs/github-integration>
- <https://linear.app/docs/projects>
- <https://linear.app/docs/initiatives>

Do not browse broadly when an official page or a short human-assisted setup
step is sufficient.

## Deliverables and scope

### 1. Pilot operating contract

Create `PLANS/project-steward-linear-trial.md` as the reviewable pilot plan and
runbook. It must describe the minimum useful end-to-end loop and explicitly map
the responsibilities of:

- durable repository documents;
- Linear or the selected extra-Git substrate;
- GitHub;
- Codex task threads and worktrees;
- the persistent steward; and
- the human.

Select and justify one initial topology. Possibilities worth distinguishing,
without over-researching them, include:

1. a persistent Codex steward that reads/writes Linear through MCP;
2. Linear Agent acting as the steward with repository context supplied through
   links, GitHub, guidance, or MCP; or
3. a deliberately small combination in which one surface owns intake and the
   other owns deeper strategic review.

The plan must not leave the user maintaining two authoritative idea catalogs.
Recommend an explicit pilot boundary for `TASKS.md` versus Linear and identify
the reversible transition steps. Do not change that authority boundary in
repository instructions until the human approves the recommendation.

### 2. Steward charter and launch prompt

Include a copy-ready initial prompt for the persistent steward in the pilot
plan. The charter must cover:

- project-level purpose and default read-only posture;
- the durable sources it should use to reorient;
- the fact that it cannot infer unmerged work or other task-thread state unless
  that context is supplied or exposed through an authorized tool;
- calibrated deference to directive, leaning, open, and observational input;
- permission to classify, link, synthesize, recommend, and challenge;
- boundaries around repository changes, implementation ownership, dispatch,
  external writes, and strategic decisions;
- a concise capture receipt so the human can see how an idea was interpreted
  without turning every intake into a planning meeting; and
- when to ask, proceed, or raise a strategic challenge.

Keep the first prompt in the pilot plan unless a concrete consumer justifies a
separate prompt or instruction file. Do not invent a new prompt-directory or
custom-agent architecture solely for tidiness.

### 3. Intake and prioritization policy

Define a small first-pass policy that can actually be tested. It should
preserve the raw idea while allowing normalization, deduplication, linking, and
placement. At minimum, reason about:

- product-vision alignment;
- learner value and strength of evidence;
- relevance to the current stability frontier;
- risk reduction and learning value;
- dependency or architectural leverage;
- effort, human attention, review cost, and opportunity cost;
- reversibility and timing;
- confidence and missing information;
- the human's expressed conviction; and
- thematic accumulation across individually lower-priority ideas.

Do not require the human to fill a long form before capturing an idea. Define
what the steward may infer, what its brief acknowledgment should report, and
which ambiguities are consequential enough to ask about.

Define an initial advocacy trigger or review cadence. It may be manual or
threshold-based for the first trial, such as a portfolio review after several
new items or at a focus boundary. Do not add an automation before the manual
loop has demonstrated value.

### 4. Minimal Linear trial design

If Linear remains the recommendation, specify the smallest useful workspace
shape and fields/views needed for the trial. Avoid importing the entire
backlog, introducing cycles or estimates without a consumer, enabling coding
sessions, or adopting paid features merely because they exist.

The design should answer:

- how ideas enter the system;
- how raw intake differs from accepted or execution-ready work;
- how human conviction is represented or inferred;
- how themes, duplicates, relationships, and priority are represented;
- how the steward reads and writes the system;
- how GitHub joins the flow once an item becomes implementation work;
- what remains in repository docs; and
- what would make the pilot successful enough to continue.

Prefer MCP/API/native integration over browser automation. Treat current
product documentation as time-sensitive and record the verified setup path and
any plan limitations that materially affect the trial.

### 5. Human-assisted setup and smoke-test protocol

Separate setup into:

- actions the agent can safely perform or prepare;
- exact actions the human should perform in Linear, GitHub, or Codex settings;
- actions that require explicit approval because they change global config,
  authorize OAuth, grant repository access, create external objects, enable a
  paid feature, or consume AI credits; and
- optional later enhancements.

The agent should complete all useful repository-only and read-only work before
requesting assistance. When assistance is needed, ask for one small coherent
batch rather than repeatedly interrupting the human.

Define a lightweight smoke test using representative inputs such as:

1. a strong directive that should be preserved rather than relitigated;
2. an uncertain idea for which the steward should recommend placement; and
3. an observation that should join an emerging theme without being promoted
   prematurely.

The smoke test should verify capture, interpretation, placement, retrieval, and
at least one portfolio-level question. It should not require production code
changes or a large backlog migration.

### 6. Evaluation and rollback

Define an early evaluation checkpoint based on a small volume of real use or a
short time window. Evaluate whether the trial:

- reduces the mental cost of capturing ideas;
- produces placements the human trusts;
- preserves strong intent without becoming deferential everywhere;
- notices meaningful cross-item patterns;
- improves prioritization conversations;
- avoids duplicated sources of truth;
- costs less attention than it saves; and
- remains easy to revise or abandon.

State how to export or preserve useful conclusions and how to return to the
current Git-based catalog if the experiment fails.

### 7. Repository orientation

After the human approves the operating boundary and chosen topology, make only
the minimal repository documentation or configuration changes required for the
trial. Likely candidates are `AGENTS.md`, `TASKS.md`, this note, the pilot plan,
and relevant documentation indexes. Do not change the stability frontier's
product outcome or product-development invariants merely to accommodate a
project-management trial.

## Execution constraints

- Run this as a documentation/tooling task in an isolated worktree based on the
  current project revision.
- Do not modify production code, application data, dependencies, or the current
  product stability frontier.
- Do not change the authority or meaning of existing `TASKS.md` entries unless
  the human explicitly approves the proposed repo/Linear boundary. New ideas
  discovered during the task may still be appended under the catalog's normal
  capture rules.
- Keep all external writes, authentication, integration setup, and paid-feature
  enablement behind the human-assist gates below.

## Human-assist and external-action gates

Stop and request human assistance before any of the following:

- creating or materially configuring a Linear workspace or team;
- authenticating Linear or installing its MCP server into global Codex
  configuration;
- creating or using an API key, OAuth grant, or external secret;
- connecting Linear to GitHub or changing GitHub organization/repository
  permissions;
- creating a persistent steward task/thread or pinning it in the app;
- enabling Linear coding sessions, AI-credit usage, a paid plan, webhooks,
  automations, or a custom agent/application;
- bulk-creating or migrating issues;
- declaring Linear or another service authoritative over a category of project
  state; or
- making a material change to the project's durable vision, stability
  frontier, or product priorities.

Ordinary ambiguity in the pilot design should be handled through alternatives
plus a recommended default. Stop only when a missing human choice would make
the setup misleading, authorize external state, or create competing sources of
truth.

## Non-goals

- Build a custom project-management application or Linear integration.
- Design the final multi-agent organization for the project.
- Dispatch or manage implementation workers through Linear during this task.
- Enable autonomous coding sessions or automatic issue-to-PR execution.
- Migrate all existing tasks, notes, plans, or backlog items.
- Create a comprehensive scoring formula, estimation process, sprint cadence,
  or reporting bureaucracy.
- Replace canonical repository specs or the stability frontier with Linear
  documents.
- Assume that a persistent conversation alone is durable project memory.
- Prove that Linear is the permanent choice.

## Definition of done

The task is ready for review when:

- [ ] `PLANS/project-steward-linear-trial.md` contains a coherent, bounded pilot
      contract and one recommended initial topology.
- [ ] The source-of-truth boundary among Git, Linear, GitHub, Codex threads,
      and the human is explicit and does not require duplicate authoritative
      intake.
- [ ] A copy-ready steward charter and initial prompt are included.
- [ ] The intake/prioritization policy distinguishes human conviction from
      strategic priority and supports cross-item thematic advocacy.
- [ ] Required human setup is consolidated into a small, ordered checklist,
      with authentication and external-write gates clearly marked.
- [ ] The Linear/MCP path or selected alternative has been verified against
      current official documentation without broad browser-driven setup.
- [ ] Representative smoke-test cases and an early evaluation/rollback test
      are defined.
- [ ] Any repository changes made beyond the pilot plan are minimal,
      reversible, and based on an explicitly approved operating boundary.
- [ ] No paid feature, AI-credit consumption, bulk migration, global config
      mutation, OAuth grant, GitHub permission change, persistent task creation,
      or external workspace mutation occurs without explicit human assistance.

## Handoff expectations

Return:

- the recommended pilot topology and why it is the smallest credible test;
- the exact human actions still needed, grouped into one setup checkpoint;
- any product or access limitation that narrows the trial;
- the proposed change, if any, to `TASKS.md` authority during the pilot;
- the first three smoke-test prompts; and
- a recommendation to launch, revise, or reject the trial.

Do not return merely a survey of Linear features. The artifact should leave the
human one short setup session away from exercising the proposed steward loop.
