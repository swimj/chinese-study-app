# Add-word chat — simulated transcript

> Historical design input, archived with implementation delivery on 2026-11-15.
> Current behavior is owned by the vocabulary contracts and [chat runtime](../../docs/chat-runtime.md);
> see the [implementation evaluation](../../docs/evaluation/trials/2026-11-15-custom-senses.md).
> The pre-implementation descriptions and simulated behavior below are retained as history.

status: archived
type: handoff
created: 2026-11-15
retire-when: the add-word agent prompt and its transcript evaluation set exist, or the design is declined
related:
  - notes/archive/2026-11-14-learner-sense-preferences-spec.md

A hand-written simulation of the add-word chat specified in the
[sense preferences spec](2026-11-14-learner-sense-preferences-spec.md#add-flow-a-bounded-chat).
Justin played the learner; the agent's replies and every tool result were
invented. No model or application code ran. Justin judged the behaviour and
tone promising, so these exchanges are the reference for the agent prompt's
voice and the seed for its evaluation set.

Tool names here are illustrative. The spec's tool table is the source for what
to build. Lines in brackets are card buttons; ● is a selected sense, ○ an
unselected one.

## Where the transcript differs from the settled design

Read the exchanges with these corrections:

| Exchange | In the transcript | Settled |
| --- | --- | --- |
| All | Cards do not show their state, and it was unclear whether anything had been added | Every card shows Proposed, Added, Preparing, Ready or Already studying |
| 帮派, 纠结 | The agent waits for Add | A clean bare word, or a context matching a listed sense, is added immediately with Undo |
| 接发 | Offers "Add 接发 on its own" | No learner override; the refused request is logged as an operator finding |
| 蒸馏 | The new sense is created before the learner presses Add | The sense is proposed on the card and created only on Add |
| 致密 | The inventory has one default sense | The real word currently has no default senses; the agent recommends a set, pre-selected |
| Several | `resolve_intent`, `judge_proposed_use` and `related_words` appear as tools | These are the chat model's own judgments for now; any word or sense it names must pass a lookup |
| All | Senses are fixed once shown | The sense list on a card is directly tickable |

## Exchanges

### 1. Word with a context that fits a listed sense

> 帮派 - came up in conversation discussing characters in a movie, young people who seem loosely tied to a criminal organization

```
lookup_word("帮派")            → found · bāngpài · freq rank ~9k
learner_word_state("帮派")     → not studied, not stashed
list_senses("帮派")            → 2 senses, both default
  s1  a gang; an organised group, usually criminal
  s2  a faction or clique inside a larger organisation
resolve_intent(s1 | s2, "characters in a movie, young people loosely tied to a criminal organization")
                               → s1, confident
related_words(s1)              → 黑帮, 混混, 团伙
```

**帮派** bāngpài is the gang itself, which is your movie sense.

> **帮派** bāngpài
> ● a gang; an organised group, usually criminal *(your context)*
> ● a faction or clique inside a larger organisation
>
> 这几个年轻人跟一个帮派有点关系。
> *These young people have some connection to a gang.*
>
> **[ Add ]**  [ Only the gang sense ]

The second sense is the same word turned on politics or office life (党内帮派), so I'd keep both.

For the young people themselves, the usual word is **混混** hùnhun: hangers-on and small-time punks, not full members. **[ Add 混混 too ]**

> *(learner presses Add)*

```
add_word("帮派", senses: default)   → added · following default senses
teaching_status("帮派", default)    → not prepared · queued
```

Added **帮派**. Its lesson is being prepared and it will come up in your new words once ready.

### 2. No inventory yet

> 绵长 - in "用绵长、安静、不紧张的温柔..."

```
lookup_word("绵长")            → found · miáncháng · freq rank ~14k
learner_word_state("绵长")     → not studied, not stashed
list_senses("绵长")            → no inventory yet
queue_sense_bootstrap("绵长")  → queued
dictionary_gloss("绵长")       → "long and continuous; lingering; drawn-out"
```

**绵长** miáncháng means long and unbroken in a soft, continuous way. In your phrase it describes the tenderness as slow, sustained and unhurried, sitting alongside 安静 and 不紧张.

It is used for things that stretch on gently: feelings, breath, sound, an aftertaste, time. 漫长 is also "long" but usually wearying (漫长的等待); 绵长 is warm.

> **绵长** miáncháng
> long and unbroken; lingering, sustained
>
> 用绵长、安静、不紧张的温柔…
>
> **[ Add ]**

Its senses are still being prepared. If you add it now, I'll keep your sentence with it and match the sense once they're ready.

> yes, add

```
add_word("绵长", senses: pending, context: "用绵长、安静、不紧张的温柔…")
                                   → added · sense match deferred until inventory is ready
teaching_status("绵长")             → waiting on senses
```

Added **绵长**, with your sentence kept. It will show as preparing in My Words until its senses and lesson are ready.

### 3. The request is part of a larger word

> 接发 - specifically the word used in tennis broadcasts for the player receiving a serve

```
lookup_word("接发")                → not in lexicon
find_expressions_containing("接发") → 接发球 jiēfāqiú · found · freq rank ~21k
learner_word_state("接发球")        → not studied, not stashed
list_senses("接发球")               → 1 sense, default
  s1  to return serve; the return of serve (tennis, table tennis, badminton)
judge_proposed_use("接发", "tennis broadcasts, the player receiving a serve")
                                   → shortening of 接发球 · names the return, not the player
```

In broadcasts **接发** jiēfā is short for **接发球**, the return of serve. It names the act, not the player: 他的接发很稳, "his return is very steady". The player receiving is the 接发球方, and a return game is a 接发球局.

> **接发球** jiēfāqiú
> ● to return serve; the return of serve
> Often shortened to 接发 in commentary.
>
> 德约科维奇的接发球是他最大的武器。
> *Djokovic's return of serve is his biggest weapon.*
>
> **[ Add 接发球 ]**  [ Add 接发 on its own ]

I'd add the full word; its lesson can cover the short form. 接发 isn't in the word list by itself, so adding it separately means it goes for review first and won't be ready to study right away.

One thing to know when reading: written 接发 can also be jiēfà, hair extensions.

### 4. Bare word

> 纠结

```
lookup_word("纠结")            → found · jiūjié · freq rank ~3k
learner_word_state("纠结")     → not studied, not stashed
list_senses("纠结")            → 3 senses, 2 default
  s1  torn, conflicted; to agonise over a choice          (default)
  s2  tangled, knotted together                           (default)
  s3  to gang up, to band together (dated; now usually 纠集)
teaching_status("纠结", default) → ready
```

> **纠结** jiūjié
> ● torn, conflicted; to agonise over a choice
> ● tangled, knotted together
> ○ to gang up, to band together *(dated)*
>
> 我很纠结要不要去。
> *I'm torn about whether to go.*
>
> **[ Add ]**

The first sense is the one you'll hear every day.

### 5. An uncommon word

> 致密

```
lookup_word("致密")            → found · zhìmì · freq rank ~19k
learner_word_state("致密")     → not studied, not stashed
list_senses("致密")            → 2 senses, 1 default
  s1  dense, compact; fine and close in texture or structure   (default)
  s2  meticulous, tightly reasoned (of thinking or writing; literary)
teaching_status("致密", default) → not prepared
```

> **致密** zhìmì
> ● dense, compact; fine and close in texture or structure
> ○ meticulous, tightly reasoned *(literary)*
>
> 这种岩石的结构非常致密。
> *This rock has a very dense structure.*
>
> **[ Add ]**

Mostly a technical and written word: materials, rock, bone, fabric, and astronomy's 致密星 (compact star).

### 6. Already studied

> 宠溺 *(the learner already has this word in review)*

```
lookup_word("宠溺")            → found · chǒngnì · freq rank ~11k
learner_word_state("宠溺")     → studied · Practice · added 2026-10-21 · last reviewed 2 days ago
learner_senses("宠溺")         → following default
list_senses("宠溺")            → 2 senses, 1 default
  s1  to spoil, to dote on, to indulge (someone)               (default)
  s2  doting, indulgent (of a look, tone or smile: 宠溺的眼神)
exercise_coverage("宠溺", s2)  → none yet
```

You're already studying **宠溺**. It's in Practice, last reviewed two days ago.

> **宠溺** chǒngnì · *in Practice*
> ● to spoil, to dote on, to indulge (someone)
> ○ doting, indulgent, of a look, tone or smile
>
> [ Include the second sense ]

You're practising the first sense only. The second is the one fiction leans on (他宠溺地笑了); including it adds practice for that use, without repeating the lesson.

### 7. Phrase or components

> 怡然自得 - not clear if this is best to study as a single phrase, or also its components?

```
lookup_word("怡然自得")        → found · yírán zìdé · idiom · freq rank ~24k
learner_word_state("怡然自得") → not studied, not stashed
list_senses("怡然自得")        → 1 sense, default
  s1  contented and at ease; happily absorbed in one's own enjoyment
lookup_word("怡然")            → found · literary · freq rank ~38k · not studied
lookup_word("自得")            → found · freq rank ~17k · not studied
find_expressions_containing("自得") → 自得其乐, 洋洋自得, 悠然自得
```

Study it as one phrase. It behaves as a single unit, and neither half is used much alone.

- **怡然** (cheerful, at ease) is literary and rarely appears outside this idiom.
- **自得** (pleased, content in oneself) mostly shows up inside other four-character phrases: 自得其乐, 悠然自得, and 洋洋自得, where it turns smug.

The lesson for the phrase will explain both halves, which is enough to recognise them elsewhere.

> **怡然自得** yírán zìdé
> ● contented and at ease; happily absorbed in one's own enjoyment
>
> 老人坐在院子里喝茶，怡然自得。
> *The old man sat in the courtyard drinking tea, perfectly content.*
>
> **[ Add ]**

### 8. Wrong character

> 海眠 - sponge

```
lookup_word("海眠")                 → not in lexicon
find_similar("海眠", gloss: "sponge") → 海绵 hǎimián · found · freq rank ~8k
learner_word_state("海绵")          → not studied, not stashed
list_senses("海绵")                 → 2 senses, both default
  s1  a sponge for washing or cleaning; sponge or foam material
  s2  a sea sponge (the animal)
teaching_status("海绵", default)    → ready
```

Sponge is **海绵**, with 绵 (soft, cottony). 眠 is "sleep", and 海眠 isn't a word.

> **海绵** hǎimián
> ● a sponge for washing or cleaning; sponge or foam material
> ● a sea sponge (the animal)
>
> 用海绵把桌子擦干净。
> *Wipe the table clean with a sponge.*
>
> **[ Add ]**

### 9. A valid use the inventory lacks

> 蒸馏 - in the new context of ai model distillation

```
lookup_word("蒸馏")            → found · zhēngliú · freq rank ~12k
learner_word_state("蒸馏")     → not studied, not stashed
list_senses("蒸馏")            → 1 sense, default
  s1  to distil; distillation (of liquids, in chemistry or spirits)
resolve_intent(s1, "AI model distillation") → no match
judge_proposed_use("蒸馏", "AI model distillation")
                               → valid · established technical use (知识蒸馏, 模型蒸馏)
propose_sense("蒸馏", "to distil a model: train a smaller model to reproduce a larger one's behaviour")
                               → s2 created · not default · flagged for review
teaching_status("蒸馏", {s1, s2}) → not prepared
```

Yes, Chinese uses the same word. Training a small model on a large one's outputs is **模型蒸馏** or **知识蒸馏** (knowledge distillation), and it works as a verb: 把大模型蒸馏成小模型.

That use wasn't listed for this word, so I've added it and selected it for you.

> **蒸馏** zhēngliú
> ● to distil; distillation (liquids, chemistry, spirits)
> ● to distil a model: train a smaller model to reproduce a larger one *(your context · new)*
>
> 这个小模型是从大模型蒸馏出来的。
> *This small model was distilled from a large one.*
>
> **[ Add ]**  [ Only the AI sense ]

I'd keep both, since the AI sense is a metaphor on the first. The lesson for this pairing has to be written, so it will take a little longer than usual to be ready.

## What Justin liked

- The choices offered felt natural while mapping to fixed actions.
- Mostly one-shot replies, with the learner free to follow up.
- The redirect from 接发 to 接发球, as content discipline delivered as a small lesson.
- Being able to act on the item the chat returns.
- A little teaching in the chat is welcome.
