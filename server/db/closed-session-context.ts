import type { VocabularySessionInitialContext } from '../../src/domain/vocabulary-session.ts';
import type { VocabularyStudyWord } from '../../src/domain/vocabulary-study-api.ts';

/** Called once on durable close, or for a previously closed session in the offline migration. */
export function compactClosedSessionContext(context: VocabularySessionInitialContext): VocabularySessionInitialContext {
  const { payload, ...initial } = context;
  if (context.closedHistory !== undefined) throw new Error('Session context is already closed');
  if (payload === undefined) return { ...initial, closedHistory: { version: 1 } };
  if (payload.version !== 1) throw new Error('Unrecognized session repertoire version');

  const lexicalWords: Record<string, VocabularyStudyWord> = Object.create(null);
  for (const { wordId } of context.words) {
    const lexical = payload.words[wordId]?.lexical;
    if (lexical?.wordId !== wordId) throw new Error(`Missing frozen lexical facts for session word ${wordId}`);
    lexicalWords[wordId] = lexical;
  }
  return { ...initial, closedHistory: { version: 1, lexicalWords } };
}
