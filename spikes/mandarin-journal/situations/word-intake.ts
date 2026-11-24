import { z } from 'zod';
import { wordDecisionSchema, type WordDecision } from '../word-intake.ts';
import { rejectOtherEffects, type Situation } from './core.ts';

const schema = z.object({ wordDecision: wordDecisionSchema });

// A narrow decision about an expression the learner submitted for study. The
// journal applies it with finishWord only while the request is still current.
export const wordIntake: Situation<typeof schema, { wordDecision: WordDecision }> = {
  instructions: `On wordIntake the learner brought the wordIntake.text into their journal, with optional wording about where they met it. Usually they want to know what it means, especially there; sometimes they asked to save it. Work from that submission and its own history. A fragmentary reply to a clarification answers the previous question, not a new bare-word request. Read the suggestions alongside that reply (including “both” or “the second one”). localWords are existing entries in this journal. When an entry teaches the same reading and intended use, return its reuseId; never invent IDs. There is no external dictionary lookup. A missing local entry says nothing about the validity of the expression.

Decide which learnable Mandarin expression and use the learner meant. Judge what the exact expression contributes. A different setting or object need not be a different sense: 树枝垂到水面 and 垂着头 both illustrate hanging or lowering. A word in a construction can be a good learning target: 有所 in 有所改善 contributes an unspecified degree. A shortened noun like 泡沫 in 包裹底下垫着泡沫 itself names the padding material. Technical and literary uses can be worthwhile, including 双误 for a double fault and 石沉大海 for a message that gets no reply. Do not split an established idiom into its characters. A meaning belonging only to a compound or fixed expression must stay with the whole: 蜘 is a component of 蜘蛛, and the deadline warning in 过时不候 does not establish a deadline sense of 过时. Bound-form evidence is a reason to offer useful compounds, never to manufacture a standalone meaning.

For a clear exact word, return wordDecision.kind=ready with one word. Give its pinyin, a short English gloss specific to this use, a natural Simplified Mandarin example containing the exact title, and a faithful contextual English translation. These examples support teaching and are not claimed to uniquely elicit the word as a cloze. Keep register or tone when it changes practical use: 报备 can be a considerate heads-up or sound controlling depending on the situation. A single everyday foothold suffices. No diagnostic quiz, approval ritual or generic greeting.

The explanation is what the learner reads first, so it answers what they came for. Say what the expression means here, in the context they gave when they gave one, and its register: who says it, how it sounds, and where it would be odd. If where they met it raises a question of its own, such as why a friend wrote it or what joke it makes, answer that. 绝了 under a friend's food photo is gushing praise, roughly "this is amazing"; it is casual and online-flavored, fine among friends and out of place in a work email. Without context, explain the everyday use and register. Two to four sentences, English by default with Chinese where it helps; do not restate the gloss as a heading. Do not mention saving, vocabulary lists or practice: whether this item is practiced is decided separately and reported after your explanation. saveRequested is true only when a reply in the history explicitly asks to save, keep, learn, study or practice the expression; otherwise false.

If spelling, reading, intended meaning or word boundary changes the target materially, return wordDecision.kind=clarify. Ask one focused question that explains the choice. Ask which expression or reading they mean, not whether to save it. Offer a few directly usable replies (a compound, labeled reading, or smaller expression); for a piece better studied in parts, offer its useful units and a combined selection when appropriate. The learner can answer in their own words. Ask for the source sentence when no honest candidate is available. Do not substitute, split or accumulate alternatives without their choice. A learner may confirm several proposed expressions in one reply; return one contextual word for each. Keep questions and glosses in English by default with Chinese examples.`,
  schema,
  buildInput: (input) => ({
    trigger: input.trigger,
    wordIntake: input.wordIntake,
    surface: input.surface,
    source: input.source,
    topic: input.topic,
    readingContext: input.readingContext,
    message: input.message,
  }),
  validate(result) {
    rejectOtherEffects(result, ['wordDecision']);
    if (!result.wordDecision) throw new Error('Expected one word intake decision');
    return { wordDecision: result.wordDecision };
  },
};
