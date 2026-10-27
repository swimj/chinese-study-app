import type { VocabularySessionWordProjection, VocabularyWordMode } from '../../domain/vocabulary-session';
import type { VocabularyWordOutcome } from '../vocabulary-ui/types';

/** Group only observed teaching/coverage and the mode actually selected for the summary. */
export function vocabularyCompletionOutcomeGroup(word: VocabularySessionWordProjection, mode: VocabularyWordMode, dismissed: boolean): VocabularyWordOutcome['group'] {
  if (dismissed) return 'unfinished';
  if (word.initialMode === 'unstudied' && word.teachingCompleted) return 'new';
  if (word.initialMode === 'solidify' && (mode === 'practice' || mode === 'maintain')) return 'graduated';
  return word.covered ? 'covered' : 'unfinished';
}
