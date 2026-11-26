# Independent UI evaluation

This procedure gives a coordinator a reusable way to ask a fresh agent whether
meaningful user tasks work through the UI. It owns the evaluator assignment and
brief interface. It can use any existing or task-specific preview; the
[preview testbed](../preview-testbed.md) is an optional setup aid, not a runtime
dependency. Deterministic tests and human product judgment remain separate.

## Prepare and invoke

The coordinator chooses the preview and writes a concise
[brief](brief-template.md) with the starting situation, tasks and consequential
expectations, preview setup, real and simulated behavior, and evidence
destination. Describe outcomes without teaching navigation. Copying an
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
implementation-specific coaching. Browser-only evidence is a practical role
constraint, not enforced isolation. If the activity trace is unavailable,
report that independence is unverified.

## Preview and browser

1. **Run the preview on the browser host by default.** The evaluator may run
   the exact launch and reset commands in the brief for a standard disposable
   fixture. The coordinator supplies a frozen revision and isolated data and
   ports, and starts custom previews or previews whose setup would reveal
   implementation details. Use the printed URL including its hostname and port.
   If the browser must run on a different host, the coordinator supplies a URL
   reachable from that browser. A loopback URL points to the browser's own host.
2. **Try the Codex in-app browser first.** Open the exact preview URL and
   verify that the expected starting state renders before attempting a task.
   If the in-app browser is unavailable and a clean browser session is
   sufficient, switch promptly to isolated headless Playwright or Chrome on
   the preview host, where permitted. Use an available runner with a fresh
   profile. For example, an installed Playwright CLI can run
   `playwright-cli open "<preview-url>" --browser=chrome` and
   `playwright-cli snapshot`. Its terminal commands count as browser
   interaction when used to operate the browser or capture browser-visible
   evidence.
3. **Report the blocker to the coordinator if the fallback is unavailable.**
   Give the URL, browser or runner, observed error, and blocked task. Report a
   missing browser tool or runner separately from a browser that opened but
   could not load the preview. The coordinator diagnoses the preview or runner
   and restores the setup. If a remotely controlled check needs Justin's
   signed-in browser or interaction, the coordinator asks Justin to
   screen-share into the host and gives him the exact page and blocked step.

Let the evaluator finish first-pass findings before explaining implementation.
Distinguish blocked attempts from a new run after an environment repair.
Preserve the original findings if a later explanation changes their
interpretation. A rerun after coaching is not a fresh blind result. Do not
instruct the evaluator to fix the code or file issues.

## Interpret the result

Use attempted task, observation, consequence, reproduction, and evidence to
triage defects, product questions, taste suggestions, and environment limits.
Fix ordinary defects within scope; ask Justin about consequential product
choices. Do not treat every suggestion as a redesign request or summarize all
findings as a quality score. Match the reported claim to its fixture level.

At delivery, report the browser used, tasks attempted and completed, findings
and resolution, unverified scenarios, and any access limits or contamination.
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
