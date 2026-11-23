import { z } from 'zod';
import { checkAction, exerciseDesign, exerciseSchema, rejectOtherEffects, type Situation, type TutorAction } from './core.ts';

const schema = z.object({
  reply: z.string(),
  action: z
    .object({ kind: z.literal('practice'), title: z.string(), detail: z.string(), exercise: exerciseSchema })
    .nullable(),
});

// One personalized exercise for a practice session, or none.
export const practiceGen: Situation<typeof schema, { reply: string; action: TutorAction | null }> = {
  instructions: `On practice, select one teachable intention anchored to the source or learner evidence. If nothing warrants a follow-up, keep action null and reply empty. Honor the requested mode and the concrete target in the supplied source, including a saved word, a past mistake, a selected takeaway or the learner’s own phrasing. previousPrompts are exercises already served: vary both the scene and the expressive task, keeping the actual learning intention. Never repeat one. Merely changing a name or swapping a noun does not make a new task. Consult recall if history would inform that choice. ${exerciseDesign} For practice supply a complete exercise. Honor the limited output contract: no schedule changes, fabricated identities, or promise of ongoing work.`,
  schema,
  buildInput: (input) => ({
    trigger: input.trigger,
    practiceWord: input.practiceWord,
    surface: input.surface,
    source: input.source,
    recentTutorTurns: input.tutorHistory.slice(-8),
    recentChatTurns: input.chatHistory.slice(-6),
    topic: input.topic,
    readingContext: input.readingContext,
    previousPrompts: input.previousPrompts,
    message: input.message,
  }),
  validate(result) {
    rejectOtherEffects(result, ['action']);
    if (result.action && result.action.kind !== 'practice') throw new Error('Tutor returned no practice');
    return { reply: result.reply ?? '', action: checkAction(result.action) };
  },
};
