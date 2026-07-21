# Working memory notes

Medium-lived documents for cross-thread coordination — research memos, handoffs, decisions-in-progress, and occasional work bundles.

Prefer **one note per artifact** (e.g. one spike output, one paste-capture memo) rather than consolidating unrelated outputs into a single doc.

**Lifetime:** days to a few weeks. **Authority:** provisional only; defer to `SPECS/` on conflict.

## When to use

| Type | Use when |
| --- | --- |
| **work-bundle** | Several related threads or days of work share assumptions, open forks, or a common goal |
| **research** | Non-development investigation (provider eval, gap analysis, paste captures) that should inform a later decision |
| **coordination** | Pending decisions, blockers, or handoffs between agent threads |
| **handoff** | Session-boundary snapshot of where work stopped and what to pick up next |

## When not to use

| Instead | Use when |
| --- | --- |
| `TASKS.md` | A single actionable queue item |
| `PLANS/`, `SPECS/*-plan.md` | Committed multi-step milestone work (weeks–months) |
| `SPECS/` (canonical) | Behavior that must be enforced and tested |
| `docs/vision/`, `BACKLOG.md` | Long-term ideas without a near-term expiry |

## Layout

```
notes/
  README.md       # this file — taxonomy and active index
  active/         # current working memory
  archive/        # retired notes (context only; not default agent read)
```

## Document template

Create `notes/active/YYYY-MM-DD-short-slug.md`:

```markdown
# Title

status: active          # active | winding-down | archived
type: work-bundle       # work-bundle | research | coordination | handoff
created: YYYY-MM-DD
retire-by: YYYY-MM-DD   # calendar TTL, or use retire-when: <condition>
related:
  - TASKS.md (In Progress item …)
  - path/to/other/doc.md
```

Body is freeform: findings, open questions, decisions-in-progress, links to PRs/commits.

## Lifecycle

1. **Create** when you would otherwise re-explain context in a new chat.
2. **Reference** from `TASKS.md` In Progress items (`context: notes/active/…`).
3. **Graduate** durable outcomes upward (`SPECS/`, `PLANS/`, `TASKS/`) — the note is scaffolding, not the artifact.
4. **Archive** when `retire-by` passes or `retire-when` is satisfied: move to `notes/archive/`, set `status: archived`, remove from the active index below.

Agents may propose archive; triage and confirmation follow the same pattern as `TASKS.md`.

## Active index

*(Update at session boundary or when creating/retiring a note.)*

| Note | Type | Retire by | Linked from |
| --- | --- | --- | --- |
| [2026-07-06-session-reflection-workflow.md](active/2026-07-06-session-reflection-workflow.md) | research | 2026-07-20 | TASKS.md (Parked / related) |
| [2026-07-10-session-lifecycle-code-verification.md](active/2026-07-10-session-lifecycle-code-verification.md) | research | 2026-07-24 | TASKS.md (In Progress — code-verification) |
| [2026-07-10-session-evidence-bundle-design.md](active/2026-07-10-session-evidence-bundle-design.md) | research | 2026-07-24 | TASKS.md (Ready — session-evidence bundle design spike) |
| [2026-07-20-llm-provider-spike-summary.md](active/2026-07-20-llm-provider-spike-summary.md) | research | 2026-09-20 | TASKS.md (Recently Completed — LLM provider spike) |
| [2026-07-20-m1-artifact-store-planning.md](active/2026-07-20-m1-artifact-store-planning.md) | planning | 2026-09-20 | TASKS.md (Inbox — M1 artifact store planning) |
| [2026-07-20-spoken-construction-drills.md](active/2026-07-20-spoken-construction-drills.md) | research | 2026-08-20 | TASKS.md (Parked — spoken construction habit drills) |
| [2026-07-21-handle-registry-v0-task-spec.md](active/2026-07-21-handle-registry-v0-task-spec.md) | work-bundle | when registry V0 stabilizes | TASKS.md (In Progress — active focus) |
