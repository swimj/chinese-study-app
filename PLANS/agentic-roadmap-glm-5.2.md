# Agentic Roadmap (First Cut)

Status: draft long-term roadmap, model-generated first cut. Not an implementation contract.

**Produced by:** GLM 5.2
**Date:** 2026-07-04
**Relationship to other docs:**

- Long-term vision: [`docs/vision/agentic_adaptive_language_learning_vision.md`](../docs/vision/agentic_adaptive_language_learning_vision.md)
- First product focus (milestone-1 sketch): [`docs/vision/initial_agentic_srs_product_focus.md`](../docs/vision/initial_agentic_srs_product_focus.md)
- Hosted beta plan (folded into this roadmap): [`PLANS/beta-web-service-plan.md`](./beta-web-service-plan.md)
- Canonical substrate specs: [`SPECS/learning-review-model.md`](../SPECS/learning-review-model.md), [`SPECS/session-covering-criteria.md`](../SPECS/session-covering-criteria.md), [`SPECS/study-action-model.md`](../SPECS/study-action-model.md)

This document captures the milestone sequencing agreed in roadmap discussion. Vision-level adjustments made directly to the `docs/vision/` docs; this file holds the milestone-level plan.

## Sequencing Decisions Embedded In This Plan

1. **Reflection-first, planner-later.** The first agent surface is post-session reflection on the existing due-queue session trace, not the time-budgeted planner. Rationale and the adjustment to the vision doc's §15 are recorded in `initial_agentic_srs_product_focus.md`. The planner emerges later from accumulated reflection dispositions rather than being specified upfront.
2. **M0 de-risking before any building.** The LLM provider/cost/quality/offline decision is the single biggest architecture dependency and is unresolved. It lands first as a spike, evaluated through the hosted-multi-user lens (because the hosted beta is folded in, not deferred).
3. **Reflection artifact store and handle registry before the reflection LLM.** The receiving schema is designed before the producing agent, so the agent's output is validated against a fixed contract rather than retrofit to whatever the model emits. Handle schemas are sticky once reflections exist.
4. **Tenancy/Postgres after the agentic core is proven on personal data, before inviting anyone.** "Folded" means the agent is the reason to host, not that all beta infra precedes any agent value. Proving the agent on yourself first is the cheapest de-risking before committing to tenancy work.
5. **Evaluation harness is late.** Tempting to build early because the vision emphasizes it, but you cannot evaluate an agent that has not shipped. The harness lands once the loop exists, at which point it also starts closing the loop (reflection dispositions become planning signals).
6. **Top-down learning model deferred.** Per discussion, the top-down prototype (analyze real reading/writing → generate drills) is out of scope until the agentic core (reflection + planner) is proven.

## The One Big Conditional

The roadmap assumes the M0 LLM spike lands on **API provider** or **hybrid**. If it lands on **local-model-only**, the folded-beta sequencing in M3–M4 becomes hard to honor, because you cannot economically run a per-user local model on hosted infrastructure. In that case the roadmap forks: either (a) hosted beta defers and the agent stays a local-first personal feature, or (b) the architecture gets significantly more complex (client-side inference, or hybrid where only cheap draft work runs locally). A local-only spike outcome should trigger a re-decision of the beta sequencing, not be treated as a minor adjustment.

## Milestones

### M0 — De-risking And Foundations

No product value yet. Pure de-risking.

Deliverables:

- **LLM spike**, evaluated through the hosted-multi-user lens. Throwaway end-to-end prototype: send one real session-evidence bundle to a model, get a structured reflection back. The sharper spike goal (informed by the user's existing manual chat-window workflow): *can a structured session-evidence bundle plus a stable system prompt replace the user's manual context-gathering and curation well enough that automated reflection approaches the quality of hand-curated chat reflection?* Output: a decision doc plus a working call path.
- **Session-evidence bundle design spike.** Gap analysis between what is durably reconstructable from current attempt events and what an LLM needs to produce a grounded, evidence-cited Mandarin reflection. Recommended pre-spike exercise: capture what the user actually pastes into the chat window across a few real sessions, and what they wish they had time to paste but do not. That is the cheapest, highest-signal requirements source for the bundle schema. Output: a bundle schema plus a "what is missing" list.
- **Handle registry V0 spec.** The constrained-operations list, payload schemas, proposal-only versus apply, lifecycle states (`proposed / accepted / applied / dismissed / deferred / superseded`). Output: a spec doc, not code.
- **Hosted-beta tenancy pre-design.** The shared-vs-user-owned table map for the current schema (Workstream A question 1 from `beta-web-service-plan.md`). Output: a table-ownership map doc.
- **Code-verification pass:** session composition and word-skill admission/action-selection in `server/db/`; attempt-event projection path; `src/features/session/useStudySession.ts` session-end and commit flow; `src/services/api.ts` contract surface. Purpose: size the lift from due-queue composition to time-budgeted planner (later milestone), and confirm the reflection hook-in point.

Product hypothesis tested: none directly. The LLM spike doubles as a check on the scariest product hypothesis — is language-aware reflection on Mandarin contrast actually good enough to ship? — but note this is already partially de-risked by the user's manual chat-window workflow. What is not de-risked is whether *automated* context-gathering replaces manual curation.

Technical risk surfaced: LLM quality bar, data-plumbing gap, tenancy modeling risk, the real size of the due-queue to time-budgeted-planner lift.

### M1 — Reflection Artifact Store And Handle Registry

Substrate for the agent. No LLM yet.

Deliverables:

- Persistence for reflection artifacts: session id, generated-at, model/prompt/schema version, summary, observations, evidence references, proposed handles, disposition. Per the §15 schema in the initial-focus vision doc.
- Handle registry as a hard-coded list of allowed operations with payload schemas and lifecycle. Initial handle set drawn from the vision doc: add contrast candidate, propose cluster after confirmation, draft or revise contrast prompt, block or flag bad prompt, mark definition-based production poor fit, suppress production, change study priority, suggest maintenance tier, recommend next-session focus, ask clarifying question.
- Validation layer: all handle payloads validated before persistence; the agent cannot mutate durable state directly.

Product hypothesis: none directly. Forces the agent-output contract to be decided before the agent exists.

Technical risk surfaced: handle schema design is sticky. Worth getting the V0 registry right even if the set is small.

Dependencies: M0 handle-registry spec.

### M2 — First Language-Aware Reflection Agent

The first real agent value. Operates on the existing due-queue session trace (no planner required).

Deliverables:

- Wire the M0-decided LLM into a post-session reflection flow: feed session-evidence bundle, get structured observations and proposed handles back, validate against M1 registry, persist as reflection artifacts.
- Reflection UI: card-like flow per the vision doc (concise observation, evidence, language-aware explanation, optional handle proposal, user response: accept / dismiss / defer / mark wrong / ask more / feedback).
- All handles proposal-only. No auto-apply.
- **High-leverage sub-thread: agent-assisted contrast intake.** Let the agent draft contrast cluster and prompt suggestions from captured production mistakes, validated by the existing intake UI. Lower-risk than reflection because the receiving validation surface already exists, and it directly targets the user's highest-toil surface (manual intake management). This is the first concrete instance of "agent absorbs a visible deterministic workflow."

Product hypothesis: post-session reflection feels like a helpful continuation of study, not second homework. Language-aware reflection is distinguishable from deterministic pattern detection — the LLM's linguistic judgment is doing real work, not paraphrasing what code already surfaced.

Technical risk surfaced: LLM quality on Mandarin linguistic judgment (register, collocation, why a contrast is form-similarity versus usage-domain). User trust erosion if reflection is shallow or wrong. Reflection engagement and return rate.

Dependencies: M0 LLM decision and bundle schema, M1 artifact store and handle registry.

Notes: this is the milestone where the vision becomes true or false. If reflection does not feel language-aware and useful, the whole agentic thesis needs revisiting before M3–M4 infra investment.

### M3 — Tenancy And Persistence Migration

The folded-beta foundation. Lands after the agentic core is proven on personal data, before anyone else is invited.

Deliverables:

- Postgres migration; `user_id` boundaries on learner-state tables; shared-content versus user-owned content split (the M0 tenancy map becomes real).
- Auth: invite-only accounts, sign-in and sign-out, per-user backend request context.
- New-user bootstrap: study profile assignment, shared-content visibility, per-user word and skill state initialization, placement-or-fresh-start decision. This is first-class product work, not a nicety, because of the cold-start structural challenge (see vision doc §15).
- Existing personal study data migration path.

Product hypothesis: the agentic features survive the multi-user transition intact; per-user learner state is isolated; the agent's quality does not degrade when reasoning about a user with sparse history.

Technical risk surfaced: the shared-vs-user-owned boundary is the beta plan's number-one named risk and is genuinely hard — private clusters, curated prompt libraries, content feedback, and account migration all get awkward if the line is wrong. Schema migration timing (moving real personal data). Cold-start value for new users (the agent is weakest exactly when hosted beta needs it to be strongest).

Dependencies: M2 proven on personal data first. M0 tenancy map.

### M4 — Hosted Deployment And Agentic MVP As A Hosted Product

Deliverables:

- Deploy frontend, backend, managed DB, LLM API wiring, secrets and env, migrations in deploy, logs, health checks, backup and restore.
- The M1–M2 agentic core accessible to a small invite cohort.
- Admin surface: user list, account enable/disable, basic study-state diagnostics, content-feedback review path.

Product hypothesis: external users get value from the agentic loop; "study, then the agent reflects" holds up for users who are not the developer.

Technical risk surfaced: LLM cost at multi-user scale (the M0 spike cost estimates get stress-tested for real). Cold-start for new users with no accumulated state. Support burden — even a small cohort generates "why did the agent say X?" questions that require diagnostic tooling.

Dependencies: M3. The M0 LLM cost estimate becomes a real budget line here.

### M5 — Heuristic Time-Budgeted Planner

Informed by accumulated reflection dispositions. Lands late and partly emergent, per the reflection-first decision.

Deliverables:

- Extend session composition into a budget-aware candidate-intervention ranker using the vision doc's §6 heuristics (`urgency × relevance × expected-learning-value × information-value ÷ time-cost`). Deterministic, inspectable.
- User picks a time budget (5/10/15/30 min); planner assembles a session; familiar study execution.
- "Why was this in your session" rationale display, sourced from ranker scores and from accumulated reflection dispositions (e.g., "suppressed production for this word per your reflection on 2026-...").
- The planner consumes reflection-derived signals (suppressed skills, priority changes, next-session-focus recommendations) as first-class inputs.

Product hypothesis: a time-budgeted session built on top of real reflection data feels more deliberate than the due-queue-with-reflection baseline, enough to justify the conceptual overhead.

Technical risk surfaced: whether observed response-time data is good enough for time-cost estimates (likely sparse — may need type-default fallbacks). Whether the ranker produces felt variety versus reordering.

Dependencies: M4 (real user reflection data is the strongest input). Builds on the existing word-skill admission and action-selection.

Notes: the clean "heuristic planner versus due queue" comparison experiment is sacrificed by this ordering. The planner is instead evaluated against the due-queue-with-reflection baseline, which is the more honest baseline since it is what would actually be shipped.

### M6 — Evaluation Harness And The Loop Starts Closing

Deliverables:

- Held-out probes, controlled exercise variation, bounded exploration (vision doc §11).
- Accepted and dismissed reflections become planning signals: the "reflection agent learns what the planner missed" loop becomes real code. The planner (M5) starts adjusting from reflection dispositions.
- First "when does a recurring agent workflow deserve deterministic code?" extraction pass — identify handle proposals or reflection patterns that have stabilized and promote them to deterministic logic.

Product hypothesis: the agent's planning actually improves from accumulated reflection data; transfer signals (performance on novel or varied prompts after an intervention) are observable, even if noisy.

Technical risk surfaced: evaluation attribution — "did this intervention help?" is genuinely hard from sparse, noisy signals. The agent/deterministic boundary extraction is a judgment call, not an algorithm.

Dependencies: M4 and M5 (real user data is the only way to test this). This is where the product starts improving itself, which is the deeper version of the vision's thesis.

### M7+ (Long Horizon) — Top-Down Learning Model

Deferred per the sequencing decision until the agentic core is proven.

Deliverables (eventual):

- Reading, writing, and speaking analysis feeding drill generation. The agent extends beyond vocabulary into macro skills; the contrast and collocation substrate feeds back into top-down analysis.

Product hypothesis: the bottom-up (SRS plus skills) and top-down (real-language-use analysis) halves reinforce each other through the agent.

Technical risk surfaced: a large new surface area; the risk is opening it before the agentic core (M1–M6) is genuinely stable.

## Cross-Cutting Threads

These are carried alongside milestones, not as dedicated milestones.

- **Skill inventory expansion** (phonological recall, collocation, register, robustness): opportunity-driven, slotted in when a skill becomes the next bottleneck. Collocation is the natural next skill after `contextual_selection` is proven and is where top-down eventually feeds back. Do not force a dedicated milestone; let real usage pull it in.
- **Contrast-intake agent absorption**: the deterministic intake workflow is the vision's canonical "messy evolving instructional work" already running. The M2 sub-thread (agent drafts cluster and prompt suggestions) is the first extraction candidate; later extractions go the other way (stabilized agent patterns to deterministic code) per M6.
- **Legibility**: the "why was this in your session" rationale from M5 should extend through every agent layer — reflection items cite session evidence, handle proposals explain their effect. This is a continuous design discipline, not a milestone.

## Embedded Decision Points Worth Surfacing

1. **The LLM spike outcome reshapes M2–M4.** If local-only, the folded-beta sequencing in M3–M4 needs re-deciding. The single biggest embedded dependency.
2. **M2 before M3 ordering.** Proving the agent on yourself before committing to tenancy is the cheapest de-risking. If the agent is not worth hosting after M2, M3–M4 do not happen and the roadmap shortens dramatically — a good failure mode.
3. **M1 before M2 (schema-first).** Designing the receiving schema before building the producing agent protects against "the agent emits whatever the model emits." A defensible alternative is to build M2 throwaway-first and let the schema emerge from real model output; this plan weights schema-first higher because handle schemas are sticky.
4. **Cold-start as a first-class problem.** Appears in M3 and again in M4. The agentic value scales with accumulated learner state, which is exactly what new beta users lack. Onboarding and placement are on the critical path, folded into M3 explicitly rather than discovered in M4.
