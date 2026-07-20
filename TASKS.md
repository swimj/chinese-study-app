# TASKS

Universal work queue. Frictionless capture in **Inbox**; triage into **Ready**; work moves items to **In Progress**. Anything one-shot-able doesn't belong here — just do it.

Commit cadence: edit freely during work; commit either alongside the code commit that a queue change describes, or as a management commit at a session boundary. Appending to Inbox/Debt is the agent's job; triage and reordering are the human's (or done on explicit ask).

Item format: `- [ ] description #tag #tag (optional context)`. Priority in Ready is list position (top = next).

## Inbox

(raw capture — unsorted)

## Ready

(actionable, priority order — top is next)

- hosted-beta tenancy pre-design: shared-vs-user-owned table map for the current schema (Workstream A question 1 from `PLANS/beta-web-service-plan.md`) #m0 #design (design doc, can run in parallel)


## In Progress

(active / blocked: reason / waiting: thing — supports parallel items)

- handle registry V0 spec: constrained-operations list, payload schemas, proposal-only vs apply, lifecycle states (`proposed / accepted / applied / dismissed / deferred / superseded`) #m0 #design (design doc, can run in parallel with the spikes)
- LLM provider spike: select which API provider; validate structured-output reliability and Mandarin reflection quality; build the developer-facing reflection prototype on real session traces; produce provider decision + per-session cost estimate for hosted scale #m0 #spike (interdependent with the bundle spike — needs a rough bundle to send, refines the bundle from what the model needs; context: notes/active/2026-07-20-llm-provider-spike-summary.md)


## Debt

(workarounds with a trigger condition — "revisit when X")

## Parked

(tangential ideas, nice-to-haves, deferred — review periodically; promote to Ready, move to `BACKLOG.md`, or drop)

- reflection adjudication tracking: as part of initial Luna integration, persist the evidence bundle, model proposal, proposal-level accept/reject/edit decision, optional rationale, and final applied operation so real use becomes regression fixtures and prompt-improvement evidence #m0 #reflection #evaluation
- reflection observability: define and capture operational metrics for reflection runs and proposal handling (volume, latency, token/cost estimates, validation failures, proposal/action mix, and acceptance/edit/rejection rates), separate from prompt-improvement fixture curation #m0 #reflection #observability
- production answer classes spike: model many-to-many `gloss/cue -> acceptable words` for definition-based production; compare against aliases, contrast clusters, and bad-prompt handling; sketch reflection handle(s) for creating/extending an answer class #spike #design #reflection (sparked by `notes/active/2026-07-06-session-reflection-workflow.md` examples like 难怪/怪不得)
- anchor glosses spike: model per-word/per-sense gloss fragments that carry the core usage distinction for production prompts and reflection; explore how anchors interact with long gloss lists, answer classes, contrast suggestions, and prompt-as-shown evidence #spike #design #reflection (sparked by 合成/组合 and 商标/标志 examples in `notes/active/2026-07-06-session-reflection-workflow.md`)
- linked suppress-and-substitute-priority handle: explore an atomic or explicitly grouped proposal that suppresses definition-based production for a low-value isolated target while prioritizing a more useful related unstudied lexical item, without weakening recognition of the original hanzi/reading #design #reflection #handle (surfaced by 给 jǐ: prefer recognition through common items such as 自给自足 or 供给)
