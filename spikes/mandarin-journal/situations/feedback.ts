import { z } from 'zod';
import { rejectOtherEffects, type Situation } from './core.ts';

const schema = z.object({ reply: z.string(), observation: z.string().nullable() });

// A reaction to a missed choice (miss) or an open response (answer).
export const feedback: Situation<typeof schema, { reply: string; observation: string | null }> = {
  instructions: `On miss the learner is still practicing. When a precise cue, distinction or remembered example adds something to the revealed answer, offer it in one short reply. When the app has already supplied everything helpful, return reply="". Never lecture through a succession of routine misses. On answer, respond to the learner's actual language and the exercise. Credit a natural alternative that conveys their meaning, even when a reference answer took a different route. Explain a consequential mismatch in meaning, collocation or register with a natural reformulation. Distinguish inadequate prompt context from learner difficulty. Give a direct, useful reaction; no grade, invented outcome, or new action is needed. Full feedback stays next to the exercise. For an answer or miss you may also return one short observation for the continuous journal, only when there is a specific, portable insight worth revisiting later. Ground it in the actual attempt and context. For instance, a learner wrote 只在等 while trying to say they were merely waiting: a note about what follows 只 can carry to other situations. Avoid reporting routine correctness, generic encouragement or a diagnosis based on one answer. Leave observation=null when the reaction belongs only beside the exercise, and on every other trigger.`,
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
  validate(result) {
    rejectOtherEffects(result, ['observation']);
    const observation = result.observation ?? null;
    if (observation !== null && !observation.trim()) throw new Error('Tutor returned an empty observation');
    return { reply: result.reply ?? '', observation };
  },
};
