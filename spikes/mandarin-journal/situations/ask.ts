import { z } from 'zod';
import { actionSchema, checkAction, exerciseDesign, rejectOtherEffects, type Situation, type TutorAction } from './core.ts';

const schema = z.object({ reply: z.string(), action: actionSchema.nullable() });

// A direct exchange with the tutor, including a question on an annotation.
export const ask: Situation<typeof schema, { reply: string; action: TutorAction | null }> = {
  instructions: `On ask, first answer what the learner wanted. A bare word in a reading or a question about its sense is an invitation to explain. Save a stash item only on an explicit request to keep the word for study. For it, identify the expression and the meaning intended here, with a brief example when useful. A detail inside a larger fixed expression is not automatically a sense of its component: 过时不候 as a whole says latecomers won't be waited for; do not teach that as an extra sense of 过时. If the requested target or sense genuinely remains unclear, ask one short question and emit no action. A confirmed request to keep a personal thought can yield a note. A request to explain, a hypothetical, a typo, and a switch to English do not authorize adding a study item. Use one action at most; leave it null for ordinary conversation. Never claim a database effect that isn't in the result.

The practiceStatus lists the exercises waiting for a future session (pending) and those already in the current session (active). If asked whether an exercise exists, answer from that state and leave action null. If asked to queue one, check whether that intention is already covered. Describe an existing relevant exercise, or return a practice action with a concrete exercise. When a later exercise is explicitly requested, briefly confirm where the learner can find it in Practice. Leave the actual prompt for the practice screen. Saving a word preserves a word and its contextual sense; saving a note preserves the learner's thought. Resolve “that” from the exchange and ask for clarification if it is still ambiguous. Do not turn a request for an explanation or status into an enrollment.

${exerciseDesign} For stash and note set exercise=null. For practice supply a complete exercise. Honor the limited output contract: no schedule changes, fabricated identities, or promise of ongoing work.`,
  schema,
  buildInput: (input) => ({
    trigger: input.trigger,
    surface: input.surface,
    source: input.source,
    recentTutorTurns: input.tutorHistory.slice(-8),
    recentChatTurns: input.surface.toLowerCase() === 'chat' ? input.chatHistory.slice(-6) : undefined,
    topic: input.topic,
    readingContext: input.readingContext,
    practiceStatus: input.practiceStatus,
    message: input.message,
  }),
  validate(result) {
    rejectOtherEffects(result, ['action']);
    const reply = result.reply ?? '';
    if (!reply.trim()) throw new Error('Tutor returned no reply');
    return { reply, action: checkAction(result.action) };
  },
};
