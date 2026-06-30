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

## 15. Explicit Non-Commitments

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
