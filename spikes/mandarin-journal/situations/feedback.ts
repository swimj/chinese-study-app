import { z } from 'zod';
import { rejectOtherEffects, type Situation } from './core.ts';

const schema = z.object({
  reply: z.string(),
  observation: z.string().nullable(),
  landed: z.boolean().nullable().describe('On answer: whether the reply landed as an apt response to the lead-in. null on miss.'),
});

// A reaction to a missed choice or recall (miss) or an open response (answer).
export const feedback: Situation<typeof schema, { reply: string; observation: string | null; landed: boolean | null }> = {
  instructions: `On miss the learner is still practicing. The message is the option they chose; they have asked nothing and said nothing about why they chose it. When a precise cue, distinction or remembered example adds something to the revealed answer, offer it in one short reply about the choice actually made, such as what that option would say in this sentence. Do not frame it as an answer to a question or doubt the learner has not raised here; earlier tutor exchanges are background, not the topic of this reply. When the app has already supplied everything helpful, return reply="". Never lecture through a succession of routine misses. On answer the learner has replied, as themselves, to an open exercise: a line someone said to them, a conversation under way, or a moment that invites a reaction. First judge the reply as a whole for 贴切, aptness: would it land as a fitting response to this lead-in, from this person, in this register? It lands when it makes sense here, responds to what was said, and reads as Chinese a native speaker would accept in the moment, even with a small slip. It does not land when the meaning would not come across, it misreads the lead-in, or the wording would confuse or jar a listener. Return landed accordingly. The reference answer and explanation show one apt reply, not a key: a reply that goes somewhere else, or never uses an expression the reference or the source material involved, can land completely, and then the expression it did without is not worth mentioning. Then respond to the learner's actual language and the exercise. Credit a natural alternative that conveys their meaning, even when a reference answer took a different route. Explain a consequential mismatch in meaning, collocation or register with a natural reformulation; when the reply landed, that is at most the one point that matters most, or none. When it did not land, say plainly what a listener would take from it and offer a natural way to say what they seem to mean. Distinguish inadequate prompt context from learner difficulty. Give a direct, useful reaction; no grade, invented outcome, or new action is needed. Full feedback stays next to the exercise. For an answer or miss you may also return one short observation for the continuous journal, only when there is a specific, portable insight worth revisiting later. Ground it in the actual attempt and context. For instance, a learner wrote 只在等 while trying to say they were merely waiting: a note about what follows 只 can carry to other situations. Avoid reporting routine correctness, generic encouragement or a diagnosis based on one answer. Leave observation=null when the reaction belongs only beside the exercise, and on every other trigger.`,
  schema,
  buildInput: (input) => ({
    trigger: input.trigger,
    surface: input.surface,
    source: input.source,
    recentTutorTurns: input.tutorHistory.slice(-8),
    topic: input.topic,
    readingContext: input.readingContext,
    message: input.message,
  }),
  validate(result, input) {
    rejectOtherEffects(result, ['observation', 'landed']);
    const observation = result.observation ?? null;
    if (observation !== null && !observation.trim()) throw new Error('Tutor returned an empty observation');
    const landed = result.landed ?? null;
    if (input.trigger === 'answer' && landed === null) throw new Error('Feedback on an open answer judges whether it landed');
    if (input.trigger !== 'answer' && landed !== null) throw new Error('Only an open answer is judged for whether it landed');
    return { reply: result.reply ?? '', observation, landed };
  },
};
