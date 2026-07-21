# TASKS

Universal work queue. Frictionless capture in **Inbox**; triage into **Ready**; work moves items to **In Progress**. Anything one-shot-able doesn't belong here — just do it.

Commit cadence: edit freely during work; commit either alongside the code commit that a queue change describes, or as a management commit at a session boundary. Appending to Inbox/Debt is the agent's job; triage and reordering are the human's (or done on explicit ask).

Item format: `- [ ] description #tag #tag (optional context)`. Priority in Ready is list position (top = next).

## Inbox

(raw capture — unsorted)

- M1 artifact store planning: reflection artifact as durable carrier of disposition (not a consumable log); only time-gap bridge + disposition lifecycle are load-bearing for first dogfood, planner/eval/extraction purposes deferred; learner-facing only (developer-facing artifacts dropped from M1); storage shape converged to one DB provenance table + one seeded per-item disposition table, blob kept in a DB column, thin store interface seam; dispositions are the precious/irrecoverable part, not blobs; store design is downstream of the spike's per-item schema contract #m1 #design (memory: notes/active/2026-07-20-m1-artifact-store-planning.md; handle registry is the other half of M1 and a separate conversation)

## Ready

(actionable, priority order — top is next)

- hosted-beta tenancy pre-design: shared-vs-user-owned table map for the current schema (Workstream A question 1 from `PLANS/beta-web-service-plan.md`) #m0 #design (design doc, can run in parallel)


## In Progress

(active / blocked: reason / waiting: thing — supports parallel items)

- handle registry V0 post-spike stabilization: confirm the first-prototype handle inventory; finish the handle, lifecycle, provenance/override, and invocation-path contracts; reconcile existing manual suppression, bad-prompt, and contrast-management paths without requiring their implementation or removal #m0 #design (active focus; task spec: `notes/active/2026-07-21-handle-registry-v0-task-spec.md`)


## Recently Completed

(completed outcomes kept briefly for handoff; durable conclusions live in the linked artifact)

- [x] LLM provider spike: selected `gpt-5.6-luna-high`, produced a solid first reflection prompt/result draft, and evaluated it through an out-of-band runner over hard-coded fixtures #m0 #spike (closed at its intended risk-reduction boundary; in-product integration, live bundle assembly, and future LLM evaluation work remain separate; outcome: `notes/active/2026-07-20-llm-provider-spike-summary.md`)


## Debt

(workarounds with a trigger condition — "revisit when X")

## Parked

(tangential ideas, nice-to-haves, deferred — review periodically; promote to Ready, move to `BACKLOG.md`, or drop)

- spoken construction habit drills: explore speaking-adjacent practice for proceduralizing reusable Mandarin sentence shapes, prosodic chunks, and conversational moves; test an imitation -> constrained recomposition -> fresh response ladder with a tiny curated set before making architecture or scoring commitments #spike #design #speaking (revisit 2026-08-20; context: notes/active/2026-07-20-spoken-construction-drills.md)
- reflection adjudication tracking: as part of initial Luna integration, persist the evidence bundle, model proposal, proposal-level accept/reject/edit decision, optional rationale, and final applied operation so real use becomes regression fixtures and prompt-improvement evidence #m0 #reflection #evaluation
- reflection observability: define and capture operational metrics for reflection runs and proposal handling (volume, latency, token/cost estimates, validation failures, proposal/action mix, and acceptance/edit/rejection rates), separate from prompt-improvement fixture curation #m0 #reflection #observability
- production answer classes spike: model many-to-many `gloss/cue -> acceptable words` for definition-based production; compare against aliases, contrast clusters, and bad-prompt handling; sketch reflection handle(s) for creating/extending an answer class #spike #design #reflection (sparked by `notes/active/2026-07-06-session-reflection-workflow.md` examples like 难怪/怪不得)
- anchor glosses spike: model per-word/per-sense gloss fragments that carry the core usage distinction for production prompts and reflection; explore how anchors interact with long gloss lists, answer classes, contrast suggestions, and prompt-as-shown evidence #spike #design #reflection (sparked by 合成/组合 and 商标/标志 examples in `notes/active/2026-07-06-session-reflection-workflow.md`)
- linked suppress-and-substitute-priority handle: explore an atomic or explicitly grouped proposal that suppresses definition-based production for a low-value isolated target while prioritizing a more useful related unstudied lexical item, without weakening recognition of the original hanzi/reading #design #reflection #handle (surfaced by 给 jǐ: prefer recognition through common items such as 自给自足 or 供给)
