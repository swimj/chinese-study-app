import { reactionSubjectKey, type ContentReactionState } from '../../src/domain/content-reactions';
import type { ContentReactionsApi } from '../../src/features/reactions/useContentReactions';

/** In-memory reactions for standalone fixtures; `failNext` simulates one failed save. */
export function createMemoryReactionsApi(initial: ContentReactionState[] = []) {
  const states = new Map(initial.map((state) => [reactionSubjectKey(state.subject), state]));
  const control = { failNext: false };
  const api: ContentReactionsApi = {
    fetch: async () => [...states.values()],
    save: async (input) => {
      await new Promise((resolve) => setTimeout(resolve, 150));
      if (control.failNext) { control.failNext = false; throw new Error('Couldn’t save. Check your connection and try again.'); }
      const key = reactionSubjectKey(input.subject);
      if (input.reaction === null) { states.delete(key); return null; }
      const state = { subject: input.subject, reaction: input.reaction, reasons: input.reasons, note: input.note, updatedAt: new Date().toISOString() };
      states.set(key, state);
      return state;
    },
  };
  return { api, states, control };
}
