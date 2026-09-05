# Working memory notes

Medium-lived documents for cross-thread context continuity — research memos,
handoffs, decisions-in-progress, and occasional work bundles. They may preserve
coordination context, but they are not a live task-status system.

Prefer **one note per artifact** (e.g. one spike output, one paste-capture memo) rather than consolidating unrelated outputs into a single doc.

**Lifetime:** days to a few weeks. **Authority:** provisional only; defer to `SPECS/` on conflict.

Most notes are lightweight **working notes**: capture what is useful and avoid
adding structure that has no clear consumer. When a body of work becomes
important enough to execute as a tracked task, consolidate its critical
context into a **task-spec note** and link that note from the relevant Linear
item. This is a usage distinction, not a new required metadata type.

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
| Linear | A current idea, cataloged work item, or dispatch-ready task that should remain retrievable and prioritized |
| `PLANS/`, `SPECS/*-plan.md` | Committed multi-step milestone work (weeks–months) |
| `SPECS/` (canonical) | Behavior that must be enforced and tested |
| `docs/vision/` | Durable long-term product direction, only when an explicit documentation change is wanted |

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
related:                # optional; include only useful semantic references
  - path/to/other/doc.md
```

Body is freeform: findings, open questions, decisions-in-progress, links to PRs/commits.

Working notes do not need a backlink to Linear. For a task-spec note, the
relevant Linear item should link to the note so the catalog points to its
executable context. Neither the note nor Linear is a source of detailed
execution or review state. Codex task threads and GitHub pull requests hold
that state; agents should not assume shared access to those views.

## Lifecycle

1. **Create** when you would otherwise re-explain context in a new chat.
2. **Consolidate** critical inputs into a task-spec note when the work becomes a
   tracked task; link that note from Linear.
3. **Graduate** durable outcomes upward (`SPECS/`, `PLANS/`, or another
   owning document) — the note is scaffolding, not the artifact.
4. **Archive** when `retire-by` passes or `retire-when` is satisfied: move to `notes/archive/`, set `status: archived`, remove from the active index below.

Agents may propose archive; triage and confirmation follow the same human-led
portfolio-disposition pattern as Linear.

## Active index

*(Update at session boundary or when creating/retiring a note.)*

| Note | Type | Retire by |
| --- | --- | --- |
| [2026-09-04-swi-51-app-only-upgrade-pipeline.md](active/2026-09-04-swi-51-app-only-upgrade-pipeline.md) | work-bundle | when the first app-only upgrade pipeline is dispositioned |
| [2026-09-04-swi-51-release-maturity-map.md](active/2026-09-04-swi-51-release-maturity-map.md) | work-bundle | when SWI-51's accepted contract graduates |
| [2026-09-03-swi-51-hosted-release-design.md](active/2026-09-03-swi-51-hosted-release-design.md) | work-bundle | when SWI-51 is dispositioned and its accepted release contract has graduated |
| [2026-08-23-swi-43-beta-interaction-brief.md](active/2026-08-23-swi-43-beta-interaction-brief.md) | work-bundle | when SWI-43 is dispositioned and the first implementation slice is accepted or declined |
| [2026-08-16-swi-42-service-boundary-design.md](active/2026-08-16-swi-42-service-boundary-design.md) | work-bundle | when SWI-42 is dispositioned and the steel thread is dispatched |
| [2026-08-14-meta-project-direction-todo.md](active/2026-08-14-meta-project-direction-todo.md) | work-bundle | 2026-09-14 |
| [2026-07-06-session-reflection-workflow.md](active/2026-07-06-session-reflection-workflow.md) | research | 2026-07-20 |
| [2026-07-10-session-lifecycle-code-verification.md](active/2026-07-10-session-lifecycle-code-verification.md) | research | 2026-07-24 |
| [2026-07-10-session-evidence-bundle-design.md](active/2026-07-10-session-evidence-bundle-design.md) | research | 2026-07-24 |
| [2026-07-20-llm-provider-spike-summary.md](active/2026-07-20-llm-provider-spike-summary.md) | research | 2026-09-20 |
| [2026-07-20-m1-artifact-store-planning.md](active/2026-07-20-m1-artifact-store-planning.md) | planning | 2026-09-20 |
| [2026-07-20-spoken-construction-drills.md](active/2026-07-20-spoken-construction-drills.md) | research | 2026-08-20 |
