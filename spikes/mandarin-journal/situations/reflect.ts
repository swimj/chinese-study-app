import { z } from 'zod';
import { rejectOtherEffects, type Situation } from './core.ts';

export const reflectionSchema = z.object({
  overview: z.string(),
  takeaways: z.array(z.object({ messageId: z.string(), quote: z.string(), text: z.string() })),
});
export type Reflection = z.infer<typeof reflectionSchema>;
const schema = z.object({ reflection: reflectionSchema });

// A review of one stretch of a casual conversation, anchored to the learner's lines.
export const reflect: Situation<typeof schema, { reflection: Reflection }> = {
  instructions: `On reflect, read the complete reflectionTurns for this conversation in order. Consider what the learner tried to communicate across the whole exchange. Return one reflection object. In overview, summarize the actual conversation and communicative progress in a sentence or two. Pick roughly three or four distinct takeaways for a rich conversation and fewer for a brief exchange; zero is fine if you have no evidence. Each takeaway should anchor one observation, idiomatic alternative or fresh possibility to the learner's line via its messageId and an EXACT, contiguous nonempty quote from that learner message. Your text should explain what that specific phrase did or how it could better express the intended meaning. Read both speakers to catch clarifications and avoid reviving misunderstandings the learner has already corrected. If they wrote 等着鸟来喂 and later explained that the birds come to eat seeds, 等着鸟来吃鸟食 makes the birds the eaters; 等着喂鸟 describes waiting to feed them. Where English “only” is involved, distinguish what is limited: 我只在早上等 singles out mornings, whereas 我只是在等 means “I’m just waiting.” Offer such a contrast only when grounded in their intent.`,
  schema,
  buildInput: (input) => ({
    trigger: input.trigger,
    surface: input.surface,
    source: input.source,
    recentTutorTurns: input.tutorHistory.slice(-8),
    reflectionTurns: input.reflectionTurns,
    topic: input.topic,
    readingContext: input.readingContext,
    message: input.message,
  }),
  validate(result, input) {
    rejectOtherEffects(result, ['reflection']);
    const reflection = result.reflection;
    if (!reflection?.overview.trim()) throw new Error('Tutor returned no reflection overview');
    const turns = input.reflectionTurns ?? [];
    if (
      reflection.takeaways.some(
        (t) =>
          !t.quote.trim() ||
          !t.text.trim() ||
          !turns.some((m) => m.role === 'user' && m.id === t.messageId && m.text.includes(t.quote)),
      )
    )
      throw new Error('The reflection could not be anchored to the learner’s words.');
    return { reflection };
  },
};
