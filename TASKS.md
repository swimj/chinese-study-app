# TASKS

Versioned current stability frontier plus the winding-down pre-Linear task
catalog.

## Portfolio Authority Cutoff — 2026-07-24

Effective from the commit containing this notice, Linear is the trial source of
truth for current idea intake, classification, portfolio priority, readiness,
themes, debt, parked work, declared Focus/Async work, and portfolio disposition.
See
`[PLANS/project-steward-linear-trial.md](PLANS/project-steward-linear-trial.md)`
for the approved operating contract.

The Focus, Async Ready, Inbox, Recently Completed, Debt, and Parked sections
below are closed to new intake, promotion, and reprioritization and are not
current portfolio authority. Entries already present at the cutoff may still
be moved or closed under explicit human direction to record their planned
terminal disposition during the settling period. Do not add follow-on work,
use these sections for post-cutoff capture, or bulk-migrate them merely for
completeness. Reconsider a legacy entry in Linear only when it becomes
relevant.

The current build-wave boundary remains active below. See
`[STABILITY_FRONTIER.md](STABILITY_FRONTIER.md)` for how to interpret, evolve,
and request human guidance on the stability frontier.

Current coordination is split deliberately:

- Linear records the current portfolio and which cataloged tasks the human has
declared in flight through `In Progress` plus a Focus/Async execution lane.
In-flight work includes execution, review, and revision.
- The initiating Codex prompt, linked task-spec note when one exists, and task
thread own the detailed execution contract and context.
- GitHub pull requests and Git history own review, CI, integration, and merge
truth.
- Durable product behavior, architecture, vision, and frontier decisions remain
in Git.

Operating limits remain Focus maximum 1, async in flight maximum 2, work
awaiting review maximum 2, and Linear `Todo` maximum 5. Capture is not dispatch:
the human selects and dispatches work and supplies disposition facts.

Brief directly requested one-offs do not need a Linear item and may remain
unknown to the steward. If an agent without authorized Linear access surfaces a
worthwhile new idea, report it for the human or steward to capture; do not
append it here or create another repository backlog.

Each independently dispatched async task runs in its own worktree. The task's
first prompt and subsequent thread define its semantic identity and execution
contract. Worktrees isolate file edits but do not eliminate semantic overlap,
merge conflicts, stale assumptions, or integration cost.

## Current Stability Frontier



### Near-term product outcome

Dogfood one learner-facing post-session reflection path:

```text
completed study session
  -> bounded session-evidence bundle
  -> one server-side Luna reflection call
  -> strict local validation
  -> durable reflection artifact with proposal-level review
  -> minimal asynchronous user review
  -> explicit application only for accepted, supported operations
```

The first useful outcome is not a complete agentic learning system. It is a
reflection that can inspect real session evidence, make language-aware and
bounded proposals, survive review after the session ends, and preserve a
truthful record of what the model proposed, what the user decided, and what the
application actually changed.

### Settled enough to build against

- Reflection is post-session and best-effort. It is outside the correctness
path for study commits, covering, and scheduling.
- `gpt-5.6-luna-high` is the initial reflection model. The first flow uses one
monolithic model call rather than a planner, debate, or specialist-agent
pipeline.
- Provider credentials and calls belong on the backend. Model output is
untrusted input and must pass strict local validation.
- The model has proposal-only authority. It never directly mutates durable
learner or content state.
- The bounded session-evidence bundle is the provisional input boundary for the
first reflection flow.
- The initial reflection is written for learner consumption. Developer-facing
reflection and development artifacts are outside this wave.
- Reflection output and proposal-level review state are durable so review can
resume asynchronously and provenance survives later application. The
provisionally settled persistence shape is one immutable provenance/blob row,
seeded proposal-review rows, and immutable authorized invocations with mutable
application projections. See
[`SPECS/reflection-proposals-and-handles.md`](SPECS/reflection-proposals-and-handles.md).
- SQLite is sufficient for the first personal dogfood. Hosted tenancy and
Postgres follow only after the agentic core proves useful on personal data.



### Invariants and constraints

- Existing study-session behavior remains correct if reflection generation
fails, times out, produces invalid output, or is never reviewed.
- Every durable operation requires explicit user authorization and domain-level
validation at application time.
- An accepted handle may remain unapplied when no adapter exists; the UI and
persistence model must not imply that acceptance changed study state.
- Review, edit, defer, dismiss, accept, and supported application may occur
asynchronously after the originating session ends.
- The original evidence, model/prompt/schema versions, original proposal,
user-authorized operation, disposition, and actual effect must remain
distinguishable wherever they materially differ.
- Until content ownership and customization policy is settled, operations that
customize learner or content state must preserve the distinguishability of
base state, user-authorized change, and applied effect. User-visible removal
or replacement should remain reversible unless true deletion is explicitly
intended. See the
`[hosted-beta tenancy table map](PLANS/hosted-beta-tenancy-table-map.md#near-term-deferral-constraint-preserve-the-layers)`
for rationale and boundaries.
- Existing manual management paths must not conflict with the handle lifecycle
or create effects that reflection application cannot reconcile truthfully.
- Initial implementation should remain narrow and reversible. Sticky operation
payload and identity decisions deserve more care than the storage substrate.



### Current blocking decisions

- The accepted V0 operation inventory, proposal/application lifecycle,
provenance/override semantics, and compatibility boundaries are defined in
[`SPECS/reflection-proposals-and-handles.md`](SPECS/reflection-proposals-and-handles.md).
The bounded first implementation contract, post-session trigger/API boundary,
and minimum review surface are defined in
[`PLANS/initial-reflection-steel-thread.md`](PLANS/initial-reflection-steel-thread.md).

### Explicit non-goals for this wave

- Multi-agent reflection, planner/debate loops, or content-authoring specialists.
- Time-budgeted session planning or autonomous scheduling changes.
- Hosted-tenancy implementation, authentication, Postgres migration, or beta
deployment. The bounded ownership-map task may proceed as pre-design but must
not expand into implementing these areas.
- Developer-facing reflection artifacts or assistant-product-manager behavior.
- A comprehensive evaluation harness or automatic extraction into deterministic
product logic.
- Automatic application of model proposals.
- Broad user-history context engineering.
- Final production-cue stacks, answer classes, general word-priority handles,
or a universal command framework unless a confirmed V0 handle strictly
requires a small decision now.
- Removal of existing manual remediation surfaces merely because an equivalent
reflection handle exists.



### Frontier advancement test

The frontier advances when a real completed session can produce a useful,
validated learner-facing reflection; the user can return later to review and
disposition its items; accepted, supported operations can be applied with
truthful provenance; and normal study correctness is unaffected when any
reflection step fails or the reflection is never reviewed.

## Focus — Max 1

(the one workstream receiving active human steering)

## Async Ready — Max 5

(fully specified dispatch candidates; potentially stale, so revalidate before
dispatch; top is next)

## Inbox

(raw capture — unsorted; capture does not imply priority or dispatch readiness)

- M1 artifact store planning: reflection artifact as durable carrier of disposition (not a consumable log); only time-gap bridge + disposition lifecycle are load-bearing for first dogfood, planner/eval/extraction purposes deferred; the first stored artifacts come from learner-facing reflection (developer-facing artifacts dropped from M1); storage shape converged to one DB provenance table + one seeded per-item disposition table, blob kept in a DB column, thin store interface seam; dispositions are the precious/irrecoverable part, not blobs; store design is downstream of the spike's per-item schema contract #m1 #design (memory: notes/active/2026-07-20-m1-artifact-store-planning.md; handle registry is the other half of M1 and a separate conversation)

## Recently Completed

(completed outcomes kept briefly for handoff; durable conclusions live in the linked artifact)

- [x] orient and prepare a bounded project-steward + Linear trial: define the persistent steward charter, calibrated intake/prioritization behavior, extra-Git source-of-truth boundary, minimal Linear/MCP topology, human-assisted setup, smoke tests, and evaluation/rollback criteria without enabling paid or autonomous coding workflows #workflow #design #spike (task spec: `notes/active/2026-07-22-project-steward-linear-trial-task-spec.md`)

- [x] LLM provider spike: selected `gpt-5.6-luna-high`, produced a solid first reflection prompt/result draft, and evaluated it through an out-of-band runner over hard-coded fixtures #m0 #spike (closed at its intended risk-reduction boundary; in-product integration, live bundle assembly, and future LLM evaluation work remain separate; outcome: `notes/active/2026-07-20-llm-provider-spike-summary.md`)

- [x] **Classify ownership of every current persisted table** #m0 #design
  - **Outcome:** A reviewable shared-vs-user-owned map that exposes the tenancy decisions the hosted beta will eventually need without designing the migration itself.
  - **Deliverable:** `PLANS/hosted-beta-tenancy-table-map.md`, linked back to the relevant immediate question in `PLANS/beta-web-service-plan.md` if a link improves navigation.
  - **Scope:** Inventory the current schema and classify every persisted table by both its present role and its likely hosted ownership: shared content/reference data, user-owned learner state/history, service-operational/provenance data, or mixed/unresolved. Identify tables that would need an ownership column, split, or explicit policy decision, but do not design those changes.
  - **Read first:** `PLANS/beta-web-service-plan.md`, `server/db/schema.ts`, `server/db/persistence.ts`, `server/db/types.ts`, and `docs/server-db.md`. Consult canonical specs only when a table's product ownership is otherwise ambiguous.
  - **Done when:**
    - every current table defined by the schema is listed exactly once;
    - each classification has a concise rationale grounded in current behavior;
    - mixed ownership, shared-content customization, and provenance/forensics ambiguities are called out explicitly;
    - open product questions are separated from recommendations;
    - the result identifies which conclusions appear safe to carry into hosted-beta planning and which require human confirmation; and
    - no code, schema, migration, auth, deployment, or data changes are made.
  - **Non-goals:** Choose Postgres strategy, design authentication or request context, add `user_id`, design migrations, decide cloud infrastructure, or implement tenancy.
  - **Dependencies:** None. This is intentionally independent of the current Handle Registry focus.
  - **Execution:** Docs-only in an isolated worktree based on current `HEAD` at dispatch. Do not mutate existing `TASKS.md` entries; new work discovered during execution may be appended to Inbox or Parked under the catalog rules above.
  - **Stop/ask:** Record ordinary ambiguity as alternatives plus a recommended default. Stop for human input only if a missing decision makes a useful complete map impossible, not merely because one row remains unresolved.

- [x] remove the home-page production answer-matching controls and localStorage overrides; retain profile-default normalization for typed production, and record deferred French configurability as debt #ui #cleanup #french (task spec: `notes/archive/2026-07-22-remove-answer-matching-ui-task-spec.md`)

- [x] persist browser-visible active time for completed sessions and show only today, 3-day average, and 7-day average cumulative session-time metrics on the home page #analytics #session #ui (task spec: `notes/archive/2026-07-22-session-active-time-metrics-task-spec.md`)

- [x] make the daily new-word limit configurable while preserving the independent per-day completed-new-word counter and next-session-only effect #session #policy #ui (task spec: `notes/archive/2026-07-22-configurable-daily-new-word-limit-task-spec.md`)

- [ ] handle registry V0 post-spike stabilization: confirm the first-prototype handle inventory; define the provisional handle, lifecycle, provenance/override, and invocation-path contracts; reconcile existing manual suppression, bad-prompt, and contrast-management paths without requiring their implementation or removal #m0 #design (task spec: `notes/archive/2026-07-21-handle-registry-v0-task-spec.md`)

## Debt

(workarounds with a trigger condition — "revisit when X")

- Reconsider configurable French production answer matching (including whether the retained profile-default normalizer remains sufficient) when French production becomes an active product direction again; the former home-page panel and localStorage overrides were intentionally removed during French deprioritization #french #production #ui



## Parked

(tangential ideas, nice-to-haves, deferred — review periodically; promote to Inbox or Async Ready, move to `BACKLOG.md`, or drop)

- spoken construction habit drills: explore speaking-adjacent practice for proceduralizing reusable Mandarin sentence shapes, prosodic chunks, and conversational moves; test an imitation -> constrained recomposition -> fresh response ladder with a tiny curated set before making architecture or scoring commitments #spike #design #speaking (revisit 2026-08-20; context: notes/active/2026-07-20-spoken-construction-drills.md)
- reflection adjudication tracking: as part of initial Luna integration, persist the evidence bundle, model proposal, proposal-level accept/reject/edit decision, optional rationale, and final applied operation so real use becomes regression fixtures and prompt-improvement evidence #m0 #reflection #evaluation
- reflection observability: define and capture operational metrics for reflection runs and proposal handling (volume, latency, token/cost estimates, validation failures, proposal/action mix, and acceptance/edit/rejection rates), separate from prompt-improvement fixture curation #m0 #reflection #observability
- production answer classes spike: model many-to-many `gloss/cue -> acceptable words` for definition-based production; compare against aliases, contrast clusters, and bad-prompt handling; sketch reflection handle(s) for creating/extending an answer class #spike #design #reflection (sparked by `notes/active/2026-07-06-session-reflection-workflow.md` examples like 难怪/怪不得)
- anchor glosses spike: model per-word/per-sense gloss fragments that carry the core usage distinction for production prompts and reflection; explore how anchors interact with long gloss lists, answer classes, contrast suggestions, and prompt-as-shown evidence #spike #design #reflection (sparked by 合成/组合 and 商标/标志 examples in `notes/active/2026-07-06-session-reflection-workflow.md`)
- linked suppress-and-substitute-priority handle: explore an atomic or explicitly grouped proposal that suppresses definition-based production for a low-value isolated target while prioritizing a more useful related unstudied lexical item, without weakening recognition of the original hanzi/reading #design #reflection #handle (surfaced by 给 jǐ: prefer recognition through common items such as 自给自足 or 供给)
