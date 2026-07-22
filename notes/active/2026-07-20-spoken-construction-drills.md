# Spoken construction habit drills

status: active
type: research
created: 2026-07-20
retire-by: 2026-08-20
related:
  - TASKS.md

## Product instinct

Vocabulary and collocation practice does not directly train the online act of assembling an utterance. A potentially higher-leverage complementary habit is a repertoire of **spoken constructions**: reusable form-and-meaning shapes that a learner can launch, extend, qualify, and close without rebuilding the sentence from English or from explicit grammar rules.

The target is not abstract syntactic complexity. It is proceduralized:

- word order and function-word frames;
- prosodic chunking, timing, and sentence-level tone/rhythm;
- retrieval of connectors and clause shapes under time pressure;
- selection of a construction because it fits the communicative move.

This is orthogonal to the current implementation and makes no architectural commitment.

## Known drill families worth borrowing

### 1. Chunked shadowing and back-chaining

Hear a short native utterance and reproduce it with the same chunk boundaries, timing, and intonation. For a difficult sentence, build backward by phrase, then shadow the whole sentence. Finally remove the transcript and reproduce it from a meaning cue.

- Strongest for: articulatory/prosodic shape and fluent chunks.
- Weakness: exact imitation can remain parroting unless followed by variation or fresh production.
- Evidence pointer: a systematic review found generally positive results for comprehensibility, intelligibility, fluency, and prosody, while segmental-pronunciation evidence was less conclusive: [Foote & McDonough, 2025](https://doi.org/10.1080/29984475.2025.2546827). A Mandarin study found sentence-level spontaneous tone gains after both textbook and authentic-video shadowing: [Lu & Chiu, 2023](https://doi.org/10.1075/jslp.22033.lu).

### 2. Delayed elicited imitation / listen-and-reconstruct

Hear an utterance, hold its meaning through a short delay or distractor, then reconstruct it aloud. Score preservation of meaning and the target construction rather than verbatim recall.

- Strongest for: binding meaning, syntax, morphology, and pronunciation into one production.
- Weakness: commonly used as an assessment; training transfer would need to be validated.
- Evidence pointer: elicited-imitation performance has measurable relationships with meaning, syntax, morphology, vocabulary, pronunciation, sentence length, and broader proficiency: [Gaillard & Tremblay, 2016](https://doi.org/10.1111/lang.12157).

### 3. Meaningful substitution and transformation

Keep a construction frame stable while a situational or semantic cue forces one or more slots to change. Then transform the utterance: affirmative to negative, claim to correction, event to counterfactual, direct to softened, and so on.

Traditional audio-lingual substitution drills are genuinely mechanical precedent, but the useful modern version should require understanding the cue and making a communicative choice. It should not show the learner the exact words to swap.

- Strongest for: rapid access to word order, function words, and construction frames.
- Weakness: blocked repetition can produce narrow item learning; interleaving and transfer prompts are essential.

### 4. Spoken expansion, compression, and combining

Start with a proposition and add one meaningful layer at a time (time, stance, cause, concession, result), saying the full utterance after each addition. Reverse the drill by compressing a long sentence to its communicative core, or combine several facts into one natural utterance.

- Strongest for: planning clause order and maintaining the sentence while adding structure.
- Weakness: sentence combining has more lineage in writing than speaking; the spoken version is a product hypothesis.

### 5. Same-message task repetition / 4-3-2

Tell the same story or opinion repeatedly, traditionally to different listeners in four, three, then two minutes. Repetition frees attention from deciding what to say, while decreasing time encourages more efficient formulation and reusable chunks.

- Strongest for: utterance planning, automaticity, and fluency beyond a single sentence.
- Weakness: not naturally a flashcard-sized action; excessive massed repetition may overfit one task.
- Evidence pointers: repeated oral tasks improved speech rate, pausing, and self-repair at different rates across repetitions: [Lambert, Kormos & Minn, 2017](https://doi.org/10.1017/S0272263116000085). The original decreasing-time story-retell study found faster speech and fewer hesitations: [Arevart & Nation, 1991](https://doi.org/10.1177/003368829102200106).

### 6. Dialogue-turn completion

Hear a conversational turn and respond within a target communicative move: clarify, gently disagree, correct a premise, give a reason, concede, sequence instructions, or repair a misunderstanding. The construction may be constrained, but the lexical content should vary.

- Strongest for: closeness to speaking and selection based on conversational intent.
- Weakness: multiple natural answers make automatic evaluation harder.

### 7. Dictogloss and retell

Listen to a short passage at normal speed, note only key content, then reconstruct or retell it. Classic dictogloss is collaborative and often written; an individual spoken adaptation could bridge sentence frames and discourse.

- Strongest for: noticing form while preserving a message across multiple sentences.
- Weakness: heavier and less speaking-like if reconstruction becomes transcription.
- Evidence pointer: dictogloss has been studied as a focus-on-form task in both collaborative and individual conditions: [Basterrechea & García Mayo, 2014](https://doi.org/10.6018/j.177321).

### 8. Produce, compare, reformulate, retry

Answer an open cue aloud, compare with one or more native-like realizations, notice one structural or rhythmic difference, and immediately answer a parallel cue again. This resembles real speaking most closely while still closing a deliberate-practice feedback loop.

- Strongest for: transfer from spontaneous output into a better habit.
- Weakness: feedback quality, acceptable-answer breadth, and speech evaluation are the hard product problems.

## A possible drill ladder

Treat one item as a **construction**, not a grammar point:

- communicative job;
- canonical spoken form or small family of forms;
- audio with meaningful chunk boundaries;
- typed slots and constraints;
- several natural examples from different contexts;
- common mis-orderings or pragmatic misuses.

Then progress through:

1. **Echo:** reproduce the audio's chunks and rhythm.
2. **Reconstruct:** hear it, wait, then say it from meaning.
3. **Vary:** change slots from a semantic cue.
4. **Transform:** express a related move using the same structural family.
5. **Respond:** answer a conversational turn without seeing the frame.
6. **Transfer:** later use it in a fresh mini-retell or opinion prompt.

This could be interleaved with vocabulary: known words fill the slots, but the scheduled skill is the construction. Exact wording matters in the early rungs; semantic and pragmatic fit matter increasingly in later rungs.

## Concrete Mandarin-flavored examples

Prefer useful conversational moves over textbook labels:

- expectation overturned: `我本来想……，结果……`
- correction/reframing: `不是……的问题，是……`
- conditional planning: `要是……的话，就……`
- clarification: `你说的……是指……吗？`
- sequencing: `先……，再……，最后……`
- concession: `虽然……，但是……`

Example transformation chain:

1. Audio model: `我本来想坐地铁，结果末班车已经走了。`
2. Cue variation: planned to cook / discovered no groceries.
3. Conversational cue: `你不是说今天在家吃吗？`
4. Free response using the same expectation-overturned move.

The interesting evaluation target is whether `本来……结果……` is complete, ordered, semantically coherent, and delivered in plausible chunks—not whether every content word matches a reference.

## One-month revisit: narrow experiment

Do not begin with schema or speech-recognition architecture. Manually curate roughly five high-frequency conversational constructions and prototype three experiences:

1. chunked shadow -> delayed reconstruction;
2. meaningful slot variation -> dialogue-turn response;
3. spontaneous response -> model comparison -> parallel retry.

Use recording/playback and learner self-comparison first. The questions are product questions:

- Does this feel like rehearsal for speaking, or like disguised grammar homework?
- Does performance improve on a fresh cue after a delay?
- Is the construction the right unit, or should the unit be a larger discourse move/chunk family?
- Which rung creates useful difficulty without requiring unreliable open-ended scoring?

Only after that decide whether it belongs beside existing study actions, in a separate speaking mode, or nowhere.
