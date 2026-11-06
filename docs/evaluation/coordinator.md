# Plan and carry task-level evaluation

Use this procedure when coordinating substantial work that changes user-facing
behavior. It explains when to plan evaluation, how to prepare a usable preview
and brief, and how to carry findings through delivery. The
[independent evaluator procedure](independent-ui-evaluation.md) owns the role and
shared [brief interface](brief-template.md); the [preview testbed](../preview-testbed.md)
owns fixture selection and operation. Existing or custom previews also work.

## Plan early enough to steer

Substantial means behavioral complexity or consequences: a new workflow,
interacting states, or a change to an important action. A backend Save/Apply
change can qualify; a large mechanical diff need not. Use proportional judgment
for small changes rather than requiring a separate evaluation ritual each time.

Alongside the implementation approach, give Justin a concise evaluation plan:
representative user goals, important consequences, suitable preview environments,
and where independent UI evaluation will help. Derive these from the request
and product contract, not only the implementation's happy path. Write the brief
yourself; Justin should be able to say “also try this” or correct an expectation
without writing a test plan.

For example:

> I’ll exercise selecting, saving, restoring, and applying senses through the
> normal operator entry. I’ll use a real isolated backend for persistence and a
> simulated failure for recovery. A fresh evaluator will inspect whether the
> consequences are understandable. One unresolved expectation: should adding an
> ungenerated sense save immediately or wait for generation?

Reporting the approach is not an approval gate. Continue settled implementation
while Justin can steer. Resolve consequential product ambiguities before the
work that depends on them; ordinary fixture and implementation choices remain
the coordinator's responsibility. If a meta-evaluation supplies the coordinator's
briefs in advance, label that portion mocked rather than claiming the coordinator
chose the scenarios independently.

## Prepare alongside development

Choose fixture levels by the claim: presentation for local layout; app-shell
simulation for complete UI transitions; isolated real backend for persistence
and application semantics. Reuse the nearest useful fixture without forcing a
full matrix. The actual entry path and container matter. Include a meaningful
failure or adjacent regression risk when warranted, plus important long/empty
states, keyboard access, or narrow/enlarged-text views.

Fill the shared brief with role/purpose, starting situation, outcomes, exploratory
scope, URL, reset, evidence destination, and real/simulated limits. Avoid button
locations and prescribed click paths. Keep suspected defects and implementation
explanations out of the first-pass brief.

Before handoff, check that the preview loads and the tasks are possible with its
starting data. Record the source revision (and any uncommitted fixture changes).
Freeze the served files during an evaluator pass: Vite hot reload can reset state
and invalidate observations. If implementation must continue, use an independently
served frozen snapshot with its own ports/data, or defer source edits until the
pass ends. Do not run multiple writers against one fixture database. Tell the
evaluator about an unavoidable interruption, retain its blocked findings, and
restart from a known state.

## Evaluate, resolve, deliver

When a coherent interaction is available, invoke a fresh evaluator with only the
assignment and brief. Follow the independence audit in the evaluator procedure:
record injected context, observable tool activity, source reads, and coaching.
First-pass findings must be complete before implementation explanations are
supplied. Restore failed infrastructure as coordinator; do not redirect the
evaluator into source debugging.

Triage the compact report. Fix straightforward defects within scope and rerun
the affected scenario when the change warrants it. Bring consequential product
questions to Justin. Taste suggestions are inputs to judgment, not mandatory
redesigns. An unrelated finding does not authorize a new portfolio task or
external bookkeeping. Preserve useful evidence of missed paths or fixture limits.

At handoff, distinguish:

- User tasks/scenarios actually attempted and their fixture levels.
- UI observations, simulated behavior, and deterministic checks.
- Findings resolved, open choices, contamination, and untested areas.
- Implementation/PR state versus merged, deployed, or observed hosted behavior.

Keep this report proportional. Stop repeated review when the relevant questions
are answered; do not add unbounded loops, automatic issue filing, or new merge
and deployment authority.

## Worked example: evaluating this workflow

The [November 6 pilot](trials/2026-11-06.md) used a coordinator-authored plan:
first validate the fixture entry/reset and real Save/Apply path, then ask fresh
agents to attempt ordinary tasks, then compare clean and deliberately faulty
feature scenarios. Justin received prospective selection, save-recovery,
compact-layout, and environment-control scenarios before the fault trials began,
with time to correct their relevance. Briefs specified user outcomes rather than
control locations or defect hints.

The coordinator prepared previews, froze files during independent passes,
separated a fixture-only navigation observation from a production defect, and
reported both successful tasks and the browser-availability limit. This is a
worked demonstration of planning, preparation and handoff. The coordinator role
was supplied by the experiment, so the results do not establish autonomous
scenario selection by a future coordinating agent.
