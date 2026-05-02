# Adaptive Vocabulary Training — Product Notes

## 1. Product Philosophy

This project is not trying to replace real language use.

Real language skill comes from reading, listening, speaking, and writing in meaningful contexts. The app exists to bias the learner toward better language patterns through targeted drills.

Core principle:

> Success in the app should correlate with real-world language ability, not just memorization.

This means drills can be somewhat artificial or gamified. That is not a problem by itself. Most learning tools are contrived in some way. The important question is whether metric-based success inside the app has strong side effects for real language use.

The app should not try to be “everything a learner needs.” It should be a structured training system that complements real exposure and real output.

---

## 2. Core Problem with Traditional SRS

Traditional SRS usually assumes:

> word = atomic fact

Typical structure:

- one card per word
- one prompt type
- one strength value
- one review interval

This works well for certain kinds of memory, but vocabulary knowledge is not a single scalar.

Limitations of traditional word SRS:

- It often overemphasizes translation pathways.
- It treats recognition and production as versions of the same thing.
- It under-trains contextual selection.
- It does not handle natural alternates well.
- It tends to schedule fixed prompts, which can lead to memorizing the card rather than acquiring flexible language use.
- It often makes “knowing a word” mean “I can map this word to a definition,” which is weaker than real lexical mastery.

Traditional SRS is still useful, but it should be seen as one behavior within a broader adaptive study system.

---

## 3. Multi-Dimensional Word Knowledge

A “known word” is not one ability. It is a bundle of partially independent capabilities.

Important dimensions include:

### Recognition

Can I understand the word when I see it?

Example:

- 误解 → “misunderstand”
- 采取 → “adopt/take,” as in 采取措施

### Phonological Recall

Can I retrieve the pronunciation?

Example:

- 专项 → zhuānxiàng
- 重量 → zhòngliàng, not chóngliàng

This can diverge from character recognition. A learner may type or recognize the correct Hanzi while having the wrong reading.

### Orthographic Production

Can I produce the correct characters?

Example:

- “misunderstanding” → 误解
- “take measures” → 采取措施

### Contextual Selection

Can I choose the word correctly among plausible alternatives?

Example:

- 误解 vs 误会
- 批评 vs 指责

This is closer to real usage than definition recall.

### Collocation / Usage

Can I use the word in natural combinations?

Example:

- 采取措施
- 提出问题
- 作出决定
- 引起注意

This is especially important in Chinese, where word pairings can feel more constrained and more explicitly pedagogized than in English.

### Robustness

Can the word survive variation?

That is, can the learner retrieve it across different contexts rather than only in one memorized sentence shell?

---

## 4. Core Shift in Study Model

Classic SRS schedules cards.

This product should schedule skill samples for words.

Instead of asking:

> Which cards are due today?

Ask:

> For each tracked word, what kind of skill sample should be tested next, if any?

A word can be strong in recognition but weak in contextual production. It can be strong in basic recall but weak in collocation. So “the word is due” is too crude.

A better mental model:

- each word has per-skill strengths
- each word has a probability or priority distribution over possible study actions
- feedback updates those strengths and future action probabilities

Possible actions:

- no study
- recognition
- recall
- minimal context production
- collocation drill
- contrast drill
- robustness probe

Traditional SRS becomes a special case where the action distribution mostly collapses to:

- no study
- recognition
- recall

---

## 5. Exercise Types

### 5.1 Recognition

Prompt direction:

> Hanzi → meaning / pronunciation

Example:

> 误解

Expected recall:

> wùjiě, “misunderstand”

Recognition is still useful. It is close to reading and should remain part of the system.

### 5.2 Basic Production / Recall

Prompt direction:

> meaning or cue → Hanzi

Example:

> “misunderstand”

Expected answer:

> 误解

This is useful, but it has a serious limitation: it can overtrain translation mode.

The learner may build an English → Chinese mapping, which does not fully match real language use.

### 5.3 Minimal Context Production (MCP)

MCP is a short context prompt with a blank. The learner types the word that naturally completes the context.

Example:

> 他以为我在生气，其实是他____了我的意思。

Target:

> 误解

MCP is cloze-like, but the pedagogical goal is different from ordinary cloze.

The goal is not simply to complete a memorized sentence. The goal is controlled contextual production: the learner reads a small piece of Chinese context and produces the word that naturally belongs there.

Important properties:

- The prompt should be short.
- The target word should be the most natural completion.
- Some natural alternates may exist.
- The prompt should not be so open that any number of answers are equally valid.
- The prompt should not be so constrained that the answer is trivial.

MCP sits between basic recall and real production.

### 5.4 Contrast Drills

Contrast drills force selection between similar or confusable items.

Example:

> 他不是在____你，他只是想指出问题。  
> A. 批评  
> B. 指责

This trains semantic and social nuance.

Contrast drills are high leverage because many language errors are not failures of knowing a word, but failures of choosing the right word among nearby options.

### 5.5 Collocation Drills

Collocation drills test whether the learner knows natural word pairings.

Example:

> 政府决定____措施。

Target:

> 采取

This is not just vocabulary recall. It tests whether the learner knows that measures are typically “采取,” not simply “做.”

Chinese language education often emphasizes 搭配, and this seems highly relevant for advanced learners.

### 5.6 Robustness Probes

A probe is a novel or semi-novel prompt designed to test whether the target word is truly available across contexts.

A probe should not simply recycle a known sentence shell.

Its purpose is evaluation more than reinforcement.

---

## 6. Minimal Context Production: Why It Matters

MCP tries to fix the main weakness of definition-based production.

Definition-based production:

> English meaning → Chinese word

Real usage:

> situation / intention → Chinese expression

MCP is closer to real usage because it asks the learner to respond to context.

However, MCP must be designed carefully. If the same five prompts repeat forever, the learner may overfit to the sentence pattern.

This creates a shift from:

> context → lexical emergence

to:

> memorized sentence shell → answer

That is still useful in moderation, but it is not the main goal.

Therefore MCP needs both repetition and variation.

---

## 7. Evaluation Model

Responses should not be binary.

For MCP and related drills, possible outcomes include:

1. Target hit
2. Natural alternate
3. Incorrect or awkward
4. Blank / forgot

### Target Hit

The user produces the intended target word.

This should strongly increase target retrieval strength.

### Natural Alternate

The user produces a different word that is natural in context.

This is important. A learner may produce good Chinese without retrieving the target word.

Example:

Prompt target:

> 误解

User answer:

> 误会

Depending on context, this may be natural.

This should count as communicative success, but not full target-word retrieval success.

### Incorrect / Awkward

The user produces something unnatural, wrong, or inappropriate.

This should decrease or weaken the relevant skill dimension.

### Blank / Forgot

The user cannot produce an answer.

This should be treated differently from producing a wrong but plausible answer.

---

## 8. Dual Scoring

The system should separate at least two scoring axes:

### Communicative Success

Did the user produce something natural and contextually acceptable?

### Target Retrieval

Did the user retrieve the intended word?

These should not be collapsed.

A natural alternate is not a failure of language ability, but it may still show that the target word is not active.

This distinction is central to the product.

---

## 9. Prompt Design Principle: Target Dominance

Good MCP prompts should have target dominance.

That means:

- the semantic field is constrained
- the target word is the most natural or expected answer
- alternates may exist, but they are weaker, more marked, or slightly different
- the prompt gives enough context to select the target
- the prompt does not give so much context that the answer becomes pure pattern matching

Bad prompt types:

### Too Open

If too many answers are natural, the response gives little signal.

### Too Constrained

If only one answer is possible due to a memorized phrase, the drill becomes trivial.

Ideal MCP lives in the middle.

---

## 10. Training vs Evaluation

Training prompts and evaluation prompts should not be treated exactly the same.

### Training Prompts

These can repeat. They are used to build access.

Useful when:

- the word is new
- the learner recently failed
- the system wants reinforcement

### Evaluation / Probe Prompts

These should be novel or varied.

Useful when:

- the learner has succeeded before
- the system wants to test robustness
- the system wants to avoid sentence-pattern overfitting

Core rule:

> Train with some stability. Assess with controlled novelty.

---

## 11. Stability vs Variation

Learning requires both stability and variation.

### Stability

Repetition helps build the initial retrieval pathway.

Example:

- repeat one anchor MCP until the learner can produce the word reliably

### Variation

Variation tests whether the word is truly available beyond a memorized sentence.

Progression:

1. Anchor prompt  
   Same or nearly same sentence.

2. Local variation  
   Same situation, different wording.

3. Semantic variation  
   Different situation that still licenses the target.

4. Contrast  
   Similar words become plausible alternatives.

5. Probe  
   Novel context used primarily for evaluation.

This supports a richer notion of mastery:

> mastery = retrieval × robustness

---

## 12. Collocation Strategy

Collocations are important, but tracking all possible word pairings would create a combinatorial explosion.

Do not model collocations as arbitrary edges between all words at the beginning.

Instead, treat collocation as a behavioral dimension of a word.

Example:

For 采取, collocation skill includes knowing that it pairs naturally with:

- 措施
- 行动
- 态度
- 方法

For 措施, collocation skill includes knowing that it pairs naturally with:

- 采取
- 实施
- 制定

The system does not need to track every pair as a first-class object early on.

For the POC:

- schedule words
- test collocation as one exercise mode
- update the word’s collocation or contextual-selection strength

Possible later extension:

- promote especially important collocations into explicit tracked units if data shows that is useful

---

## 13. Unlocking Collocation Drills

Collocation should probably be introduced after basic word knowledge is stable.

Possible heuristic:

- weak recognition → recognition drills
- stable recognition → production drills
- stable production → MCP
- stable MCP → collocation
- stable collocation → contrast / probe

Another possibility:

> only test a collocation when both words involved are already known enough

Example:

Do not drill 采取措施 if either 采取 or 措施 is still too weak.

This does not require a formal unlock graph. It can be a simple policy rule.

---

## 14. Scheduling Model

Traditional SRS combines strength and interval.

In this model, they should be separated.

A word may have:

- high recognition strength
- medium production strength
- low collocation strength
- unknown robustness

So the word does not have one interval. Instead, each study decision asks:

> What skill should be sampled next?

A conceptual action distribution for a word might look like:

- no study: high
- recognition: low
- recall: medium
- MCP: medium
- collocation: low
- probe: very low

Feedback changes this distribution.

Example:

### Recognition failure

Increase probability of recognition soon.

### Recall success

Shift some probability toward MCP.

### MCP success

Increase robustness and reduce near-term study probability.

### Collocation failure

Do not necessarily punish basic recognition. Instead, shift the word back toward MCP or collocation reinforcement.

### Probe success

Increase robustness and lengthen time before next study.

---

## 15. Traditional SRS as Early Behavior

Traditional SRS can be understood as an early stage of this model.

For a new word, the system may behave like normal SRS:

- show recognition
- show recall
- space reviews based on success/failure

As the word matures, the system introduces richer drills.

This avoids throwing away what SRS does well while allowing the model to grow beyond it.

---

## 16. Pronunciation Handling

Typed Hanzi production is a useful step up from self-reveal/self-grade.

However, correct Hanzi does not guarantee correct pronunciation.

Recommended approach:

### Step 1: Require typed Hanzi

The system can objectively validate the characters.

### Step 2: Ask for pronunciation self-rating

After correct Hanzi, ask:

- solid
- unsure
- wrong / did not recall

This separates orthographic production from phonological recall.

Avoid requiring full numeric pinyin such as:

> zhuan1xiang4

This is clunky and may test interface compliance more than pronunciation.

Occasional targeted pinyin probes may still be useful, especially for 多音字 or known pronunciation weaknesses.

---

## 17. Handling Typos

For production input, exact Hanzi matching is simplest.

Eventually, light typo tolerance may be useful, but it should be conservative.

The system should avoid treating a genuinely different character as a typo just because it is visually or phonetically close.

For the POC, exact match plus manual override is probably enough.

---

## 18. Important Behavioral Detail: Failure Should Be Local

If a user fails a collocation drill, that should not necessarily weaken basic recognition.

Example:

If the user knows 采取 but fails 采取措施, the system should not conclude that they do not recognize 采取.

Instead:

- weaken collocation/contextual-selection strength
- schedule easier contextual drills
- perhaps return to MCP

This is one of the main advantages of separating skill dimensions.

---

## 19. Product Scope

The product should not become too strict about realism.

The app is allowed to use artificial drills.

The question is not:

> Is this drill exactly like real life?

The question is:

> Does this drill push the learner toward a capability that transfers to real life?

This framing allows useful, constrained, measurable exercises without pretending that drills equal language mastery.

---

## 20. Near-Term Deliverable: Suggested POC

The most promising near-term experiment is MCP plus simple adaptive scheduling.

### Minimum Feature Set

- typed Hanzi production
- MCP prompt type
- target hit / alternate / wrong / blank evaluation
- per-word skill strength fields
- simple scheduling policy that chooses exercise type based on skill state
- limited prompt variation

### Optional Companion Feature

Contrast or collocation drills.

These may be easier to validate than open-ended MCP and are especially useful for Chinese.

### What Not to Build Yet

- full collocation graph
- fully autonomous scheduling policy
- perfect answer grading
- full macro writing/speaking analysis
- elaborate multi-dimensional scoring UI

---

## 21. Implementation Direction

For the POC, prefer a mostly rule-based policy over a fully probabilistic or learned system.

Internally, the model can be thought of probabilistically, but implementation should remain debuggable.

Example policy:

- if recognition weak: mostly recognition
- if recognition stable but production weak: recall
- if production stable: MCP
- if MCP stable: collocation / contrast
- if strong: rare probe

This can later evolve into a richer action-selection model.

---

## 22. Dynamic Prompt Generation

Long-term, an “oracle” that generates appropriate MCP prompts on demand would be valuable.

The oracle should optimize for:

- naturalness
- target dominance
- novelty relative to previous prompts
- appropriate difficulty
- manageable alternate-answer space

However, this is hard.

For the POC, a hybrid approach is safer:

- handcrafted or semi-generated anchor prompts
- generated paraphrases
- occasional fresh probe prompts

---

## 23. Prompt Overfitting Risk

If the user sees the same MCP prompt too many times, they may learn:

> sentence shell → answer

instead of:

> context → lexical emergence

This is not useless, but it weakens the purpose of MCP.

Mitigation:

- vary prompts as strength grows
- reserve some prompts as probes
- do not overuse tiny fixed prompt sets
- separate training prompts from evaluation prompts

---

## 24. Macro Skill Integration: Later Direction

Long-term, the app may analyze user writing, speaking, or reading mistakes and convert them into drills.

Example:

- user writes unnatural collocation
- system identifies pattern
- system schedules collocation drills for relevant words

This would connect top-down language use with bottom-up training.

But this is not necessary for the first POC.

---

## 25. Key Open Questions

Important unresolved questions:

- How should natural alternates be detected?
- How much should the system rely on self-rating?
- How many skill dimensions are enough for the POC?
- How should prompt variation be generated and validated?
- When should collocation drills unlock?
- Should important collocations eventually become explicit tracked units?
- How much randomness should exist in scheduling?
- What is the minimum scheduling policy that produces useful product discovery?

---

## 26. Final Product Framing

This system is best understood as:

> an adaptive training loop for lexical competence

It is not merely a flashcard app.

It is not a conversation simulator.

Its core movement is:

> from “recall this word”  
> to “resolve this situation with a word”

The product should preserve what SRS does well:

- scheduling
- repetition
- progress tracking
- low-friction daily study

But extend it toward:

- contextual production
- word choice
- collocation
- robustness
- better transfer to real language use
