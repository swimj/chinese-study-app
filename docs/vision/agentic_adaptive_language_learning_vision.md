# Product Vision: Agentic Adaptive Language Learning

## Purpose of This Document

This document captures the overarching product ideas that justify investing in the app beyond a conventional SRS vocabulary tool.

It is not a roadmap. It is a set of durable hypotheses, questions, and design principles that should inform product decisions, technical architecture, experiments, and the choice of what not to build.

---

## 1. Core Thesis

Language learning is not a single skill, and there is no canonical best path for every learner.

A useful learning system should not merely deliver content or schedule flashcards. It should make informed, adaptive decisions about how to spend a learner's limited attention in ways that improve the language capabilities they actually care about.

> Build an adaptive language-learning system that spends a learner's attention budget intelligently.

The system should use imperfect but improving evidence about:

- what the learner knows
- what kinds of errors they make
- what they are trying to do with the language
- what learning methods seem to work for them
- how much time and energy they currently have
- what interventions are likely to help next

---

## 2. Why Existing Products Are Incomplete

Many language-learning products make implicit decisions for users about both how language should be learned and what language profile is worth optimizing toward.

They may optimize for streaks, lesson completion, beginner comprehension, test-like progression, broad phrase fluency, vocabulary breadth, or motivation. None of these is inherently bad. They are simply partial objectives, often treated as universal ones.

The product opportunity is to make the optimization target more explicit, personalized, revisable, and grounded in observed learning behavior.

---

## 3. Language Competence Is Multi-Dimensional

A learner does not simply “know” or “not know” a word, grammar point, or language.

Vocabulary alone includes partially independent dimensions:

- recognition
- phonological recall
- orthographic production
- meaning and sense knowledge
- contextual selection
- collocation
- register awareness
- robustness across varied contexts

At the macro level, language ability includes reading, listening, writing, speaking, pronunciation, pragmatic appropriateness, domain literacy, and style.

The system should not collapse all of these into one score.

---

## 4. Learners Have Different Goals and Changing Trajectories

Users may want to speak with family, pass an exam, travel, read literature, work in the language, write, understand media, maintain a heritage language, or develop nuanced near-native expression.

Even one learner’s goals can change over time.

The target profile should be treated as:

- partly explicit
- partly inferred from behavior
- revisable
- incomplete
- subject to change

A learner may say they want “speaking fluency,” while the actual bottleneck is lexical selection, reading speed, pronunciation confidence, contextual usage, or a narrow but important domain.

---

## 5. The Agent Is a First-Class Product Concept

The agent is not primarily a chat interface.

It is the system that performs instructional labor which would otherwise require a highly attentive tutor or technically sophisticated learner. For example:

- detecting that an English gloss is a poor production cue
- identifying likely contrast clusters
- generating or revising exercises
- spotting ambiguous prompts or weak distractors
- choosing recognition, production, contextual, or collocation practice
- turning repeated mistakes into targeted interventions
- adapting a session to a time budget
- detecting unstable versus robust knowledge
- proposing changes in study strategy

Chat may be one interface to the system, but it is not the essence of it.

> The agent is the adaptive curriculum designer and study-session operator.

---

## 6. Why an Agentic Approach Is Plausible Now

The current prototype already reveals that a great deal of high-value instructional work happens outside the app:

- selecting words
- deciding whether direct production is appropriate
- identifying semantic contrasts
- requesting nuance explanations
- creating or refining exercises
- deciding what to study under time constraints
- diagnosing misleading drills
- revising the model after usage

AI agents can help automate this heterogeneous work while the workflow is still being discovered.

A likely development pattern:

```text
agent handles messy, evolving instructional tasks
→ recurring workflow becomes visible
→ stable workflow is encoded in deterministic product logic
→ agent remains orchestrator, generator, and exception handler
```

This avoids trying to fully specify the system before use has revealed what matters.

---

## 7. Reinforcement Learning as an Organizing Analogy

The product need not literally implement reinforcement learning early on. But RL is a useful analogy.

### State

Potential state includes learner goals, skill profile, vocabulary and exercise history, recurring confusions, available time, current interests, self-reports, and engagement signals.

### Actions

Potential actions include scheduling recognition, production, contrast, contextual, collocation, or probe exercises; generating a new prompt; showing a usage note; deferring low-value work; or recommending a focused short session.

### Reward / Evaluation

Potential signals include retention, contextual selection, transfer to novel prompts, reduced recurring errors, user-reported usefulness, sustainable engagement, and efficient use of time.

### Policy

The policy chooses which intervention to offer next.

The point is not to claim a solved optimizer. It is to design around adaptive intervention selection rather than fixed content delivery.

---

## 8. Evaluation Is Central

If the product optimizes streaks, it creates streaks. If it optimizes cards completed, it creates card completion. If it optimizes flashcard accuracy, it creates flashcard accuracy.

Those can correlate with real learning, but imperfectly.

The deeper question is:

> What observable evidence would make us believe the learner has become more capable in ways they care about?

A single master metric is unlikely. A more realistic approach is a portfolio of noisy signals:

- retention after meaningful delay
- performance on unseen or varied prompts
- contextual discrimination
- constrained writing use
- reading comprehension on new material
- speaking/listening diagnostics later
- self-reported real-world capability
- task-specific “can you now do X?” probes
- time-efficiency and frustration signals

---

## 9. Honest Measurement Is a Product Value

The app should aim to be rigorous without becoming punishing.

The desired feeling is:

> Here is a precise diagnosis. Here is the next lever. Here is evidence that the lever is working.

Not:

> You are worse than you thought.

Serious evaluation should lead to useful action.

---

## 10. Minimal Effective Dose and Attention Budgets

Learner attention is scarce. A learner may have five minutes today, fifteen minutes on normal days, a busy month with little capacity, or a temporary intensive push.

The system should do more than scale a card quota. It should allocate limited time between maintenance, fragile knowledge, high-priority material, contextual refinement, diagnostic probes, new learning, and goal-specific content.

A product promise worth testing:

> Maintain or improve the language capabilities you care about with the smallest sustainable amount of deliberate practice.

---

## 11. Legibility and Correctability

The product does not need formal explainability research to be trustworthy. It should be able to provide grounded summaries of policy inputs, for example:

> You have recognized these words reliably, but missed them in contrast exercises twice this week, so today includes contextual selection practice.

For serious learners, the ability to inspect and correct the model may itself be valuable:

- “This is not important to me.”
- “I want more reading-oriented practice.”
- “Do not give direct production for this category.”
- “I am in maintenance mode this month.”

---

## 12. Product Principles

### Build for transfer, not merely local scores

A drill is valuable when success transfers meaningfully to real language use.

### Preserve learner agency

The system should adapt, but users should be able to inspect, override, and redirect it.

### Use artificial drills without apology

Drills are contrived by nature. The question is whether they create high-value side effects.

### Favor small closed loops

A feature should observe something, make an intervention, and later test whether it helped.

### Keep the agent bounded

Early agent actions should mostly produce suggestions, drafts, classifications, exercises, and plans. Irreversible changes should require confirmation or narrow rules.

### Do not confuse chat with agency

The agent may operate mostly in the background.

### Let deterministic systems emerge from repetition

Agentic flexibility is valuable during discovery; specialized deterministic code is valuable once a recurring workflow stabilizes.

---

## 13. Questions Worth Carrying Forward

- Which learner signals are genuinely predictive of future improvement?
- Which interventions reliably improve transfer?
- What are the most useful early skill dimensions to track?
- How much explicit goal setting is needed versus inference from behavior?
- What feedback is honest without being demoralizing?
- Which agent actions are safe to automate?
- What is the smallest time-budgeted study plan users perceive as better than a due queue?
- What should the system do when it is uncertain?
- How should a learner correct the agent’s model?
- When does a repeated agent workflow deserve deterministic product code?

---

## 14. Non-Goals

At least initially, this product is not trying to be:

- a replacement for real language use
- a universal curriculum
- a guarantee of fluency
- an opaque black-box optimizer
- a chat companion with no instructional substrate
- a gamified tracker disconnected from real capability

---

## 15. LLM Integration Architecture And Cold-Start

The vision above is silent on two structural concerns that should be made explicit because they shape everything downstream.

### LLM Integration Is A First-Class Decision

The agent's quality ceiling, cost profile, latency, offline capability, and data-egress posture all depend on a decision the vision does not make: which LLM provider, run locally or via API, or a hybrid of both.

This is not an implementation detail to defer. It cascades into deployment shape (local model versus hosted API), whether the local-browser-first identity survives, whether learner data leaves the machine, per-session cost, and the realistic quality ceiling for language-aware reflection. It should be resolved through a dedicated spike before the first agentic milestone commits to an architecture.

Current direction (settled in roadmap discussion, revisitable): **API provider**, not local. The deciding factors are the linguistic-judgment quality ceiling (the core differentiator for language-aware reflection), avoiding inference-infrastructure ownership while product viability is still the main risk, and egress being acceptable for the target serious-learner user. The call layer should still target the OpenAI-compatible chat-completions interface so provider choice remains swappable.

### Cold-Start As A Structural Challenge

The agent's value scales with accumulated evidence about a specific learner. A new user has none of that evidence, which means the product is weakest exactly when a hosted offering needs it to be strongest.

This is a structural tension, not a bug. It implies that onboarding, placement, and new-user bootstrap are first-class product work, not niceties, and that the system should produce useful behavior from sparse state rather than requiring a warm-up period before it becomes valuable.

## 16. North-Star Statement

> Build an adaptive language-learning system in which an agent uses imperfect but improving evidence to spend a learner's limited attention on interventions most likely to create meaningful, durable, personally relevant language growth.
