# Independent UI evaluation

This procedure gives a coordinator a reusable way to ask a fresh agent whether
meaningful user tasks work through the UI. It owns the evaluator assignment and
brief interface. It can use any existing or task-specific preview; the
[preview testbed](../preview-testbed.md) is an optional setup aid, not a runtime
dependency. Deterministic tests and human product judgment remain separate.

## Prepare and invoke

The coordinator operates the preview and writes a concise
[brief](brief-template.md): URL, role/purpose, starting situation, tasks and
consequential expectations, real/simulated boundary, reset, limits, and evidence
return destination. Describe outcomes without teaching navigation. Copying an
implementation plan into the brief defeats its purpose.

Supply the [evaluator assignment](ui-evaluator-prompt.md) and completed brief as
the sole task message to a fresh-context agent. With the collaboration tool,
use `spawn_agent` with `fork_turns: "none"`; omit model overrides to inherit the
session model. Do not fork the implementation conversation. Pass the text itself,
not repository paths that require the evaluator to inspect source. Separate
scenarios can use separate fresh contexts when learning one would coach another.
The coordinator remains the sole implementation/stack writer.

A tool invocation might have this shape (fill in the actual text):

```text
spawn_agent(task_name="ui_evaluation", fork_turns="none",
            message="<assignment text>\n\n<completed brief>")
```

Inspect the actual invocation behavior in the current host. Fresh context does
not guarantee absence of injected AGENTS.md, project context, memory, or other
tools. Record which instructions are visibly supplied and what the evaluator
reports receiving. Audit its tool activity for repository/source/API reads and
implementation-specific coaching. A request to stay browser-only is a practical
role constraint, not enforced isolation. If the activity trace is unavailable,
say that independence is unverified; self-report alone is weaker evidence.

In the Codex desktop host used by the [pilot](trials/2026-11-06.md), subagents
cannot explicitly request browser visibility. Let them open background tabs
without a visibility option; record browser availability failures separately
from preview-server failures.

Let the evaluator finish first-pass findings before explaining implementation.
For an environment blockage, repair the preview as coordinator and distinguish
blocked attempts from a new run. Preserve the original findings if a later
explanation changes their interpretation. A rerun after coaching is not a fresh
blind result. Do not instruct the evaluator to fix the code or file issues.

## Interpret the result

Use attempted task, observation, consequence, reproduction, and evidence to
triage defects, product questions, taste suggestions, and environment limits.
Fix ordinary defects within scope; ask Justin about consequential product
choices. Do not treat every suggestion as a redesign request or summarize all
findings as a quality score. Match the reported claim to its fixture level.

At delivery, report tasks attempted and completed, findings and resolution,
remaining uncertainty, actual context/access limitations, and any contamination.
A few successful runs establish feasibility, not a reliability estimate.

## Evaluate the evaluator

For a deliberately seeded trial, first validate a clean control. Keep the
coordinator's defect inventory, changed files, and expected symptoms separate
from evaluator briefs. Use plausible feature goals and nearby user tasks; do not
advertise bug count or locations. Include primary-feature failure, related
regression, and a clean case. An unavailable-preview trial checks blockage
reporting separately. Freeze first-pass findings before revealing the inventory,
then compare detections, misses, false alarms, and unexplored paths.

Keep seeded defects on a disposable local branch outside the implementation PR
stack. Retain a reproducible patch, scenario briefs, first-pass findings, and
coordinator interpretation. Mocking the coordinator demonstrates the fixture and
evaluator interface; it does not test autonomous scenario selection or the
coordinator's full workflow. Do not optimize the prompt against only known bugs
and report those same runs as held-out evidence.

The [retained pilot and seeded trials](trials/2026-11-06.md) include the clean
control, first-pass findings, reproducible fault patch, context/tool audit, and
limits of the mocked coordinator.
