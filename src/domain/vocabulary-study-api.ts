import type { VocabularyPersistedSession } from './vocabulary-session-api';
import type { VocabularyEncounterEvidence, VocabularyWordMode } from './vocabulary-session';
export type VocabularyStudyWord = { wordId: string; hanzi: string; traditional: string | null; pinyin: string; meaning: string };
export type VocabularyStudy = {
  session: VocabularyPersistedSession;
  words: VocabularyStudyWord[];
  currentEncounter: VocabularyEncounterEvidence | null;
  currentWordId: string | null;
  controls: { canNext: boolean; canSkip: boolean; canEnough: boolean; canMore: boolean; canUndo: boolean;
    canFinishForNow: boolean; canFinishImmediately: boolean; canChangeMode: boolean };
  notice: string | null;
};
export type VocabularyStudyCommand =
  | { type: 'response'; response: string | null; selfAssessment?: 'accepted' | 'rejected'; selectedWordId?: string }
  | { type: 'feedback'; feedback: 'positive' | 'negative' | 'comment' | 'withdrawn'; comment?: string }
  | { type: 'skip'; scope?: 'exercise' | 'word' }
  | { type: 'enough' }
  | { type: 'more'; wordId?: string }
  | { type: 'mode'; mode: VocabularyWordMode; wordId?: string }
  | { type: 'undo' }
  | { type: 'resume' }
  | { type: 'finishForNow' }
  | { type: 'finishImmediately' };
