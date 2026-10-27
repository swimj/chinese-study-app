import type { VocabularyContent, VocabularyJson } from '../../src/domain/vocabulary-content.ts';
import type { VocabularyEncounterSnapshot } from '../../src/domain/vocabulary-session.ts';
import { selectBootstrapReveal, selectSequentialBootstrapReveal } from '../../src/domain/word-content/reveal.ts';
import { parseWordContent } from '../../src/domain/word-content/validation.ts';
import { getDb } from '../db/connection.ts';
import { getVocabularySenses } from '../db/vocabulary-content.ts';
import { vocabularyTeachingSource } from './teaching-source.ts';

function object(value: VocabularyJson | undefined): Record<string, VocabularyJson> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

/** All answer/reference facts are persisted with the encounter, never resolved during replay. */
export function vocabularyRevealSnapshot(content: VocabularyContent, options: {
  fallbackIntroduction?: (wordId: string) => VocabularyJson | undefined;
  completedTeachingRecognitionAttempts?: number;
  now?: Date;
} = {}): Pick<VocabularyEncounterSnapshot['body'], 'revealWords' | 'bootstrapReveal' | 'wordReference'> {
  if (content.kind !== 'exercise') return {};
  const ids = [...new Set([...content.words.filter(word => word.relation === 'target').map(word => word.wordId),
    ...content.answers.map(answer => answer.wordId)])];
  const revealWords = ids.map(wordId => {
    const word = getDb().prepare('SELECT id AS wordId,hanzi,traditional,pinyin,meaning FROM lexical_words WHERE id=?').get(wordId) as
      { wordId: string; hanzi: string; traditional: string | null; pinyin: string; meaning: string } | undefined;
    if (!word) throw new Error(`Missing reveal word ${wordId}`);
    const mapping = content.words.find(word => word.wordId === wordId && word.relation === 'target');
    const sense = mapping?.senseId ? getVocabularySenses(wordId).find(sense => sense.senseId === mapping.senseId) : undefined;
    if (mapping?.senseId && !sense) throw new Error(`Missing mapped reveal sense ${mapping.senseId}`);
    return { ...word, ...(sense ? { sense: { senseId: sense.senseId, version: sense.version, description: sense.description } } : {}) };
  });
  if (ids.length !== 1 || !(content.skill === 'recognition' || content.exerciseType === 'definition')) return { revealWords };
  const wordId = ids[0]!;
  const material = object(content.body);
  const source = object(material.source);
  const mappedSource = object(object(revealWords[0]?.sense?.description).source);
  const pinnedId = source.bootstrapContentId ?? mappedSource.contentId;
  const sourceMaterial = typeof pinnedId === 'string' ? { bootstrapContentId: pinnedId }
    : options.fallbackIntroduction?.(wordId);
  const raw = sourceMaterial === undefined ? undefined : vocabularyTeachingSource(sourceMaterial);
  if (raw === undefined) return { revealWords };
  const wordReference = parseWordContent(raw);
  if (wordReference.word.wordId !== wordId) throw new Error('Reveal source belongs to another word');
  if (revealWords[0]?.sense) {
    // A daily example must not imply that another source use is the mapped sense.
    if (mappedSource.contentId !== wordReference.id || typeof mappedSource.useId !== 'string') return { revealWords, wordReference };
    const index = wordReference.uses.findIndex(use => use.id === mappedSource.useId);
    if (index < 0) throw new Error('Mapped reveal source use is missing');
    return { revealWords,wordReference,bootstrapReveal: selectSequentialBootstrapReveal(wordReference,index) };
  }
  const bootstrapReveal = options.completedTeachingRecognitionAttempts === undefined
    ? selectBootstrapReveal(wordReference, options.now ?? new Date())
    : selectSequentialBootstrapReveal(wordReference, options.completedTeachingRecognitionAttempts);
  return { revealWords, wordReference, bootstrapReveal };
}
