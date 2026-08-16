# Initial Product Focus: An Agentic Layer on Top of an SRS Vocabulary App

## Purpose of This Document

This document defines the initial stepping stone from the current SRS vocabulary app toward the broader agentic adaptive-learning vision.

It is intentionally not a milestone roadmap.

The goal is to identify a focused product surface that:

- is understandable to users
- builds on the existing app
- demonstrates real agent value
- produces useful product-learning data
- does not require solving personalized language learning all at once

---

## 1. Starting Point

The application already has meaningful capabilities:

- vocabulary recognition practice
- production practice
- user control over whether a word receives production practice
- contrast clusters
- 选词填空 / contextual selection exercises
- SRS-style scheduling
- user-generated or curated exercise content
- a growing model of words as more than simple definition pairs

But much high-value instructional work still happens manually outside the app:

- deciding which words deserve production practice
- recognizing when English definitions are inadequate
- asking for semantic distinctions
- creating contrast clusters
- generating contextual exercises
- prioritizing what to study
- revising the system after noticing bad incentives or misleading results

The first product step should make some of this work visible, repeatable, and agent-assisted.

---

## 2. Initial Thesis

The first release should not merely add chat.

It should make users feel that the system actively improves the quality of their study session.

Two useful product tests:

> Can the app spend a learner’s limited study time more intelligently than a conventional SRS due queue?

> Can it notice a meaningful pattern in a learner’s vocabulary state and turn that pattern into a useful intervention?

If yes, the agent is already delivering value.

---

## 3. Initial Product Surface

The recommended first surface is:

> A time-budgeted adaptive study session assembled by an agent from existing vocabulary state and exercise types.

The learner gives a time budget, for example:

- 5 minutes
- 10 minutes
- 15 minutes
- 30 minutes

The system then selects a small set of candidate learning interventions rather than simply displaying all due cards.

Possible interventions:

- recognition review
- direct production review
- contextual production / 选词填空
- contrast cluster exercise
- collocation-oriented prompt
- short diagnostic probe
- brief usage or contrast note before targeted practice

The system chooses and orders these using user data.

---

## 4. Why Time Budget Is a Good Initial Wedge

Time budgeting turns abstract adaptation into a user-understandable problem.

Instead of saying:

> The AI personalizes your language learning.

The product can say:

> Tell me how much time you have. I will use it deliberately.

This gives the agent a concrete task:

- preserve fragile knowledge
- prioritize important material
- avoid wasting time on overlearned items
- include targeted refinement
- avoid a monotonous or demoralizing session
- choose a reasonable mix of maintenance and growth

It also supports realistic modes:

- busy-day maintenance
- normal daily study
- intensive practice
- recovery after a lapse
- targeted preparation for a project, exam, or trip

---

## 5. Candidate Action Model

The scheduler should evolve from selecting “due cards” to selecting candidate interventions.

Example:

```text
target: 连接 / 衔接 contrast cluster
action: contextual selection exercise
reason: recent contrast failures, high relevance, low time cost
estimated time: 45 seconds
```

Another:

```text
target: 采取
action: collocation exercise
reason: recognition and production stable; contextual usage under-tested
estimated time: 60 seconds
```

The object being ranked is not merely a word. It is a candidate learning intervention.

---

## 6. Early Scoring Heuristics

The first version does not need a learned RL policy. It can use inspectable heuristics.

A rough score:

```text
priority =
  urgency
  × relevance
  × expected learning value
  × information value
  ÷ expected time cost
```

### Urgency

Possible signals:

- elapsed time since relevant practice
- recent misses
- inferred fragility
- failure after a gap
- low confidence or pronunciation self-rating

### Relevance

Initially simple:

- user-tagged priority
- current learning list
- source material being studied
- user-created contrast cluster
- high-frequency or domain-specific status, if available

### Expected Learning Value

Initially heuristic:

- failed contrast clusters deserve targeted reinforcement
- stable recognition but weak contextual selection suggests 选词填空
- poor English-definition separability argues against direct production
- new words need recognition before contextual production

### Information Value

A candidate may be valuable because it teaches the system something:

- Does the learner retain this after a longer delay?
- Does success survive prompt variation?
- Does a contrast explanation help later performance?
- Is this item genuinely stable or merely familiar?

### Expected Time Cost

Use observed response time where possible; otherwise use exercise-type defaults.

---

## 7. Initial Agent Responsibilities

The agent should have narrow but real jobs.

### Study-plan assembly

Given a time budget and learner state, create a session.

### Exercise-mode choice

Choose whether a word should receive recognition, production, contextual selection, contrast, collocation, or probe practice.

### Content diagnosis

Flag cases such as poor production-from-definition fit, likely contrast clusters, repeated answer ambiguity, or weak distractors.

### Draft generation

Generate candidate contrast notes, usage notes, 选词填空 prompts, distractors, contextual variants, and study-plan rationales.

These outputs should remain reviewable or bounded by deterministic validation.

### Session recap

After a session, summarize grounded observations, material preserved, recurring confusions, and suggested next focus.

---

## 8. Initial Agent Boundaries

Do not initially let the agent:

- silently alter canonical content
- permanently modify user goals without confirmation
- delete or hide user content
- make strong claims about overall language ability from sparse evidence
- create opaque scheduling behavior with no inspectable basis
- replace deterministic answer validation
- make core study dependent on a chat conversation

The agent should propose, prioritize, draft, and orchestrate. The app should retain clear boundaries.

---

## 9. Minimal Evidence Model

The first version can rely on signals already available inside the app:

- correctness
- outcome: target hit / natural alternate / incorrect / blank
- response time
- confidence or pronunciation self-rating
- prior exercise type
- elapsed time
- cluster-level confusions
- prompt novelty versus familiarity
- repeated failure patterns
- user-set priorities
- study-time budget

This is enough to start making nontrivial choices.

The app does not yet need to prove direct real-world language growth. It needs to create better immediate study decisions and gather evidence for later evaluation.

---

## 10. What Counts as Success

### User-perceived value

- Does the learner feel the session was worth the time?
- Does it reduce manual system wrangling?
- Does it feel more deliberate than a due queue?
- Does it surface useful patterns?

### Behavioral evidence

- Do users complete time-budgeted sessions?
- Do they return?
- Do they accept or override suggestions?
- Do targeted interventions reduce repeated errors?
- Do they use agent-created exercises or notes?

### Learning signals

- Does the learner improve on later novel or varied prompts?
- Do contrast errors decline?
- Does recognition stability improve without excessive review?
- Does contextual performance improve after targeted intervention?

### Product-learning evidence

- Which agent tasks recur?
- Which outputs need deterministic pipelines?
- Which signals are useful?
- Where do users distrust or correct the agent?
- Which parts of sessions feel wasteful?

---

## 11. Early Evaluation Design

The first goal is not to solve counterfactual scheduling evaluation. It is to make lightweight comparisons possible.

Useful patterns:

### Held-out probes

Occasionally test a word or cluster in a novel context after an intervention.

### Controlled exercise variation

For similar learner states, vary whether the system uses standard review, contrast exercise, contextual variation, or usage note plus practice; compare later transfer signals.

### Bounded exploration

Occasionally review a lower-priority item early, delay an item slightly, use a novel exercise type, or probe a supposedly stable item. This creates calibration data without making study random.

### User feedback

Ask minimal, concrete questions:

- “Was this session a good use of 10 minutes?”
- “Was this exercise useful, too easy, too hard, or confusing?”
- “Did the study plan prioritize the right things?”

---

## 12. Product Experience Sketch

1. User opens the app.
2. User chooses “I have 10 minutes.”
3. The app presents a brief plan:
   - maintain fragile material
   - target one contrast cluster
   - run one short probe
4. User studies through the familiar exercise interface.
5. The app gives a short recap:
   - what it noticed
   - what it reinforced
   - what it will watch next
6. User can lightly correct the system:
   - “not important”
   - “more of this”
   - “do not give direct production for this word”
   - “I am focused on reading this month”

The agent should feel embedded in study flow, not bolted on as a separate chat tab.

---

## 13. Technical Architecture Implications

Preserve a separation between:

### Deterministic learning state

- lexemes
- exercises
- attempts
- outcome labels
- user strengths
- scheduling metadata
- content visibility and canonical boundaries

### Agent inputs

- learner-state snapshots
- recent history
- time budget
- current goals and priorities
- available candidate interventions
- content metadata

### Agent outputs

- proposed study plan
- candidate rankings
- draft exercises or notes
- suggested classifications
- concise rationales
- structured recommendations

### Deterministic validation and execution

- answer validation
- permissions
- state updates
- canonical content changes
- persistence
- event logging

The agent should return structured outputs that the app can validate and store.

---

## 14. Questions for Product Spikes

- Can a heuristic planner assemble sessions users prefer to the due queue?
- Which signals are sufficient for useful ranking?
- Can the agent identify poor production-from-definition cases?
- Can it generate contrast exercises good enough to use?
- Can it propose useful distinction notes from a contrast cluster?
- How often do users override the agent?
- Which interventions create observable later transfer?
- Which agent jobs recur enough to become deterministic services?
- What minimum UI makes the agent feel real without requiring chat?

---

## 15. Refined Initial Deliverable Notes

The discussion so far points toward a narrower first deliverable than the original framing may imply.

The initial product should still move toward time-budgeted adaptive study, but the first agentic surface does not need to be the session composer itself. A deterministic heuristic planner may be enough to test whether a time-budgeted session feels more deliberate than the conventional due queue.

The more natural first agent responsibility is post-session reflection: interpreting what happened during study, explaining meaningful patterns, and proposing bounded follow-up actions that the user can inspect and confirm.

### Working Deliverable Shape

The first credible adaptive loop should look roughly like:

```text
time budget
-> heuristic session planner
-> familiar study execution
-> persisted session evidence
-> agent reflection
-> grounded observations and proposed handles
-> user confirmation, dismissal, or follow-up
```

This lets the product start learning from sessions without making core study depend on opaque model choices.

### Three-Part Agent Frame

Agent behavior should be described in terms of three broad classes:

- user-facing output: recap text, learning observations, explanations, drill-down answers, study-management suggestions, and content suggestions
- signals: session events, attempts, ratings, wrong answers, prompt metadata, word metadata, existing contrast/content state, time budget, user priorities, and recent history
- handles: constrained operations the agent can propose or eventually invoke to manage study state, content state, or user-facing policy

This split keeps the agent from becoming a vague product concept. It forces each agent feature to answer:

- what did the agent observe?
- what did the agent say?
- what operation, if any, can the user approve?

### SRS Position In The New System

SRS remains important, but it should no longer be treated as the whole product loop.

Spaced repetition is still a core memory-maintenance principle: evidence after a meaningful delay is different from immediate post-exposure success. Any agent that reasons about urgency, strength, fragility, or retention risk is implicitly using spaced-repetition ideas.

However, due-ness should become one pressure signal rather than an obligation. A broader language-learning agent may decide that letting a marginal item decay is acceptable when the learner's limited attention is better spent on higher-leverage growth, diagnosis, content repair, or goal-aligned new material.

A useful distinction:

```text
SRS asks: when should this memory or skill be sampled again?
Agentic planning asks: is sampling this now the best use of attention?
```

The first implementation should preserve existing SRS-derived scheduler state as a baseline and signal source while making room for planner decisions that trade maintenance against relevance, weakness, information value, time cost, and user goals.

### Ordering Clarification (Reflection First)

Subsequent reasoning settled on reflection-first rather than planner-first as the initial ordering.

The planner-first framing below assumed the heuristic planner should ship before the reflection agent so the agent has planner choices to reason about. In practice, reflection on the existing due-queue session trace is sufficient for the first agent surface, and the toil it resolves (manual reflection and intake management) is more acute than the toil resolved by a time-budgeted planner.

More importantly, reflection feeds the planner rather than the reverse. Every handle disposition (suppress production, recognition-only, bad prompt, priority change, next-session focus) is a relevance or quality signal a future planner consumes at session-assembly time. Building the planner on top of accumulated reflection dispositions is a stronger path than building it cold, and it matches the "let deterministic systems emerge from repetition" principle: the planner emerges from stabilized reflection patterns rather than being specified upfront.

The heuristic time-budgeted planner remains a planned deliverable, but it lands after the reflection loop is proven, informed by real reflection data.

Sequencing update: on 2026-08-03, “after the reflection loop is proven” was
clarified not to require an immediate pivot to planner work; the next focus was
the production-task/cue model and faithfully applicable cue repair. That loop
is now implemented and has met its stability-frontier advancement test. As of
2026-08-15, the next product wave is an invite-only hosted Mandarin beta that
operationalizes the bounded learning and reflection core for a small trusted
cohort. The planner remains a later product direction rather than an implied
next milestone merely because reflection succeeded.

### Heuristic Planner, Agent Reflection

The time-budgeted session planner can initially be heuristic and inspectable.

Its job is to assemble a reasonable session from existing study actions under a time budget. It should provide a stable baseline for comparison against the old due queue.

The agent's first job should be reflection:

- summarize what happened
- identify likely confusions or content problems
- explain why a pattern matters
- propose bounded follow-up actions
- produce optional conversational explanations when the user wants to drill deeper

A useful working principle:

```text
The heuristic planner decides today's first pass.
The reflection agent learns what the planner missed.
```

Over time, accepted or dismissed reflections can become structured signals for future planning.

### Handles Must Be Constrained

Handles should start as a hard-coded registry of allowed operations. The agent should not mutate durable state through open-ended natural language.

Initial handles may include:

- add a contrast candidate
- propose or create a contrast cluster after confirmation
- draft or revise a contrast prompt
- block or flag a bad prompt
- mark definition-based production as poor fit
- suppress production for a word
- change a word or skill's study priority
- suggest a maintenance/protection tier
- recommend a next-session focus
- ask the user a small clarifying question

Most handles should initially be proposed rather than automatically applied. The durable system should validate all handle payloads before persistence.

Handle proposals should eventually track lifecycle state such as proposed, accepted, applied, dismissed, deferred, or superseded.

### Signals Can Start Relatively Raw

The reflection agent may receive a fairly raw session event log plus nearby context.

Useful context includes:

- the session's study actions
- target words and attempted answers
- selected wrong contrast choices
- ratings
- prompt text and explanations
- content references
- current word and skill state
- existing contrast clusters and candidates
- relevant recent history

A thin deterministic summary may still be useful, but it should stay factual rather than interpretive. For example, it can report that the user selected one word when another was the prompt target; the agent can decide whether that pattern looks like semantic confusion, bad prompt design, or ordinary forgetting.

### Language Awareness Is Core

The reflection agent should be allowed to reason about the target language.

Symbolic study-pattern detection is useful, but language learning value depends heavily on semantic, contextual, collocational, register, and prompt-quality judgments. A purely symbolic agent can notice repeated wrong choices, but it cannot explain whether a Chinese contrast is about form similarity, usage domain, collocation, register, or sentence context.

The desired architecture is hybrid:

- deterministic systems record and constrain study behavior
- symbolic summaries expose factual patterns
- the language-aware agent interprets those patterns
- constrained handles define what can actually change

### Reflection Artifacts

Post-session reflection should eventually be stored as structured data, not only as generated prose.

A reflection artifact should likely include:

- session id
- generated-at timestamp
- model, prompt, and schema version
- summary text
- observations
- evidence references
- proposed handles
- confidence and risk where useful
- user disposition such as accepted, dismissed, useful, not useful, wrong diagnosis, or deferred

Observations, recommendations, and handle proposals should remain distinct:

- observation: what happened
- recommendation: what the agent thinks it means
- handle proposal: the specific bounded operation the user can approve

### Reflection UI Flow

Reflection can use a card-like flow similar to the study session, but the units are reflection items rather than review exercises.

A reflection item is a logical unit of study reflection or management. In the near term, most items will likely concern a word, contrast pair, cluster, prompt, or session-level pattern. Later, the same structure could support grammar patterns, collocations, register issues, recurring writing/speaking themes, or other tutor-like observations.

Each item should be self-contained enough that the user can process it immediately after the session or return to it later without remembering the full session context.

A reflection item may include:

- subject: the word, cluster, prompt, session pattern, or future learning theme being discussed
- observation: what the agent noticed
- explanation: why it may matter
- evidence: expandable references to session behavior
- suggestion: an optional handle proposal
- user response: accept, dismiss, defer, mark wrong, ask more, or give feedback

Items may break down into smaller cards or subviews:

1. concise observation
2. evidence from the session
3. language-aware explanation
4. optional suggestion or handle proposal
5. feedback on whether the reflection was useful or accurate

The user should be able to iterate through the reflection list linearly, jump around via navigation, and stop without losing progress.

The ideal path is immediate post-session reflection, because fresh context may make the observations more useful. However, reflection should not be mandatory. Users should be able to skip it and later re-enter a reflection view or inbox for unprocessed items.

A useful product principle:

```text
Reflection items should be durable, resumable, and locally intelligible.
```

Reflection should feel like a helpful continuation of study, not a second homework session or a blocking completion step.

### Learner-Facing And Developer-Facing Reflection

There are two reflection agents with shared infrastructure but different audiences and output contracts.

The learner-facing agent interprets a session for the learner and proposes study/content actions via the constrained handle registry.

The developer-facing reflection agent observes user behavior and product-level patterns and suggests product improvements, backlog items, experiments, or — most usefully early on — gaps in the handle registry itself. A primary early use case: given a session trace, identify conceptual problems the learner-facing agent could not address because no suitable handle exists, and propose that the developer design and implement a new handle. It does not have authority over learner study state.

The two agents share the session-evidence bundle, the LLM call path, and the reflection-artifact store, but their output schemas differ: learner-facing outputs are validated against the handle registry; developer-facing outputs are development artifacts (backlog items, handle-extension proposals, extraction candidates) that do not mutate study state and require no runtime validation.

Initially the developer-facing agent is constrained to the same session traces as the learner-facing agent. Over time it can broaden into an assistant product-manager type of agent that reasons across sessions and user behavior, not just within a single session.

### Current Goals

- Make the first agentic value appear after real study behavior, where the model has meaningful evidence to interpret.
- Reduce manual content and study-management fatigue without hiding control from the learner.
- Keep core study execution deterministic and familiar.
- Let agent output be conversational while keeping durable operations constrained.
- Create stored reflection data that can later improve planning and product decisions.

### Current Non-Goals

- The first time-budgeted planner does not need to be an LLM-powered agent.
- The first reflection agent should not silently apply durable changes.
- The app should not make broad claims about overall language ability from sparse session evidence.
- The first implementation should not require a full signal inventory before work can begin.
- The reflection system should not become an open-ended chat agent that replaces normal study flow.

### Known To-Dos To Scope Later

- Define the V0 handle registry and payload schemas.
- Decide which handles are proposal-only and which, if any, can be applied immediately.
- Define the minimal session evidence bundle passed to the reflection agent.
- Decide how much deterministic factual summarization to provide before agent reflection.
- Design the reflection output schema.
- Decide how reflections, observations, evidence references, and proposed handles are stored.
- Design the user flow for reviewing, accepting, dismissing, deferring, or asking follow-up questions about reflection output.
- Define how reflection items are grouped, navigated, resumed, and marked processed.
- Decide where unprocessed or deferred reflection items live outside the immediate post-session flow.
- Decide how accepted and dismissed reflection outputs become future planning signals.
- Define the boundary between learner-facing reflection and developer-facing product reflection.

---

## 16. Explicit Non-Commitments

This initial product focus does not commit to:

- a full RL implementation
- a global language-skill evaluator
- comprehensive learner modeling
- autonomous curriculum generation
- speech analysis
- full writing tutoring
- public content sharing
- a fixed roadmap to the long-term vision

The narrower objective is:

> Build and test one credible adaptive loop in which the system uses learner data and a time budget to make better-than-default vocabulary study decisions.
