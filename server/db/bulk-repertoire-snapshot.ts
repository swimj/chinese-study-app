import { getVocabularySenses, getVocabularySenseCatalog, getVocabularyContentForMaintenance } from './vocabulary-content.ts';
import { getDb } from './connection.ts';
import { isVocabularyDefinitionFallback } from '../../src/domain/vocabulary-production-coverage.ts';
import { getVocabularyWordSenseCoverage } from './vocabulary-sense-coverage.ts';
import { getSharedIntroductionLexicalWord, getSharedWordIntroductionContent } from './word-introductions.ts';
import type { BulkWordSnapshot } from '../vocabulary/bulk-repertoire.ts';

/** Caller owns a coherent read transaction and the connection. */
export function snapshotBulkRepertoireWord(wordId: string): BulkWordSnapshot {
  const word = getSharedIntroductionLexicalWord(wordId);
  if (!word) throw new Error('Unknown bulk repertoire word');
  const fallbacks = (getDb().prepare(`SELECT c.content_id FROM content_items c JOIN exercise_answer_words a ON a.exercise_id=c.content_id
    WHERE a.word_id=? AND c.kind='exercise' AND c.exercise_role='general' AND c.skill='production'
    AND c.availability='active' AND c.access_scope='shared' ORDER BY c.content_id`).all(wordId) as {content_id:string}[])
    .map(row => getVocabularyContentForMaintenance(row.content_id)!).filter(isVocabularyDefinitionFallback);
  return { word, catalog: getVocabularySenseCatalog(wordId), senses: getVocabularySenses(wordId), fallbacks,
    coverage: getVocabularyWordSenseCoverage(wordId), hasBootstrap: getSharedWordIntroductionContent(wordId) !== null };
}
