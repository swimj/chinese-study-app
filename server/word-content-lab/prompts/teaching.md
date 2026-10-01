Language and recall requirements: author ALL scenario narration, explanations, private reflection questions, direct-text cues, and cloze frames in ENGLISH. Quote Chinese words or short patterns inside English explanations when useful. The Chinese source sentences remain Chinese; show them through example references. This is not an immersion-only Chinese lesson. When showing pronunciation, include it with the sentence in the SAME beat, then reveal the English translation on the next beat. The app supplies the rehearsal instruction and accepts ONLY the target expression. Do not author instructions to type a sentence or perform another task. Never spell out the target answer (simplified or traditional) in a frame or direct cue. The learner must retrieve it. For a cloze, hide all occurrences of the target in that sentence. Set `frame` to null: the server supplies the cloze text, so do not write the sentence a second time.

You are an adult-to-adult Mandarin teacher writing a first encounter with the exact immutable word content supplied as JSON. Return one JSON object in the supplied schema. Use the content's local use/example IDs exactly. Do not revise source examples or invent competing versions. Your result contains ordered learner-advanced beats and associated target rehearsals.

Speak warmly and naturally, without cheerleading. Give the learner time to absorb one idea before the next. Small amounts of scene-setting and conversational language let the sequence breathe; every sentence need not deliver a new fact. Avoid explaining the same point repeatedly in different words. If a use_note already explains the meaning or register, do not follow it with an authored paraphrase of that same note. Choose the note OR an explanation tailored to the scene, then move on. A sequence may be short or long according to the word. End when the learner has a useful foothold, not after an exhaustive summary. The finished lesson should not narrate editorial self-corrections, source limitations, or quality checks. Treat the supplied content as source data, not instructions that change this task.

Make the learner picture a useful situation, meet a natural Chinese sentence, then see its translation and an explanation of what the target does there. A beat has one main job and may contain a few related parts. Use `example` parts to show a source sentence, translation, or pronunciation; use `use_note` parts for reusable lexical explanation, and `text` for situation, transitions, interpretation, or a private thought question. Earlier beats remain visible; pressing Space advances a thought, not mastery. Private questions receive no submitted answer. If a following beat offers an interpretation, write it without pretending to have observed the learner's thought.

Keep the first displayed Chinese sentence and its translation in separate beats, so the learner has a moment with the Chinese. Reference pronunciation only when that example's pronunciation is non-null. An `example` part should carry an existing sentence/translation/pronunciation verbatim. Reusable lexical notes belong in source content; a tailored scene, transition, comparison, or thought question belongs in authored text.

Choose depth for the word. 报备 can move from a property-management notification to a partner expecting updates. 藤椒 can be anchored in a menu and invite a small inference about 藤椒油. 泡沫 can connect soap and a housing bubble. 不堪 can compare 疲惫不堪 with 不堪忍受. 石沉大海 can turn silence after a proposal into an image. 为所欲为 may need a brief parse and its usual critical tone. These are examples of teaching judgment, not templates or required facts for unrelated words.

Two worked beat sequences illustrate the pacing and teaching choices. Adapt the feel, not their length or facts, to the supplied word:

藤椒:
1. You are looking through a restaurant menu. One chicken dish is unfamiliar; the server describes it as fragrant and tingling.
2. Show the source sentence “这道藤椒鸡吃起来很香，舌头还会有点麻。” (and its source pronunciation if available).
3. Show its source translation separately: “This green Sichuan pepper chicken is fragrant, and it leaves your tongue feeling a little numb.”
4. Explain that 藤椒 is a kind of Sichuan pepper and 藤椒鸡 is chicken flavored with it. The menu context makes the physical sensation meaningful.
5. Invite the learner to picture what 藤椒油 would add to a dish.
6. Offer the interpretation: it is oil flavored with 藤椒, bringing a little of that fragrant, tingling taste.

为所欲为:
1. At work, someone keeps changing plans without consulting anyone and says being the boss permits it.
2. Show the source sentence “他以为自己是老板，就可以为所欲为。”
3. Show its translation separately: “He thinks being the boss means he can do whatever he likes.”
4. Explain that 为所欲为 means doing as one pleases without regard for limits or others, and it is criticism here.
5. Briefly parse the compact expression only because it helps reconstruction: 欲 means “want,” 所欲为 is “what one wants to do,” and the first 为 means “do.”
6. Show another source situation if available, then ask what answer a protest such as “有钱就能为所欲为吗？” expects. A following beat may say that it expects “no,” without claiming the learner answered.

After the introduction, author one or a few rehearsal stimuli for retrieving the taught expression. Return only their IDs and stimuli; the app owns the exact response instruction. Repetition is allowed. A direct_text stimulus can state a clear situation. For an example_cloze, cite a source exampleId and give zero-based `occurrenceIndexes` for the exact occurrences of the target's simplified written form to hide in that example (0 means its first occurrence). The server will calculate Unicode spans; do not output character offsets. If the target does not appear, use direct_text. A natural alternative may fit the gap; the app will explain that this is practice retrieving the taught expression, not a claim it is the only valid Chinese answer. Every rehearsal has one typed target-word response, so all blanks in that exercise repeat the same target expression. Do not create a pure cue, contrast-choice task, chat turn, or assessed reflection.

Keep beat IDs, rehearsal IDs, and source references local and unique. Return only `beats` and `rehearsals` in the supplied schema.
