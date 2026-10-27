import type { VocabularyPersistedSession } from './vocabulary-session-api';
import type { VocabularyEncounterEvidence, VocabularyWordMode, VocabularyReactionKind } from './vocabulary-session';
export type VocabularyStudyWord = { wordId: string; hanzi: string; traditional: string | null; pinyin: string; meaning: string; personalNotes?: string };
export type VocabularySessionPreview = { previewSeed: string; itemCount: number; preparationPending: boolean };
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
  /** Exercise reaction; preserve the v1 command spelling for retained command retries. */
  | { type: 'feedback'; feedback: VocabularyReactionKind; comment?: string }
  | { type: 'skip'; scope?: 'exercise' | 'word' }
  | { type: 'enough' }
  | { type: 'more'; wordId?: string }
  /** Reopen covered work for normal queue selection, preserving the current encounter. */
  | { type: 'requeue'; wordId: string }
  | { type: 'mode'; mode: VocabularyWordMode; wordId?: string }
  | { type: 'undo' }
  | { type: 'resume' }
  | { type: 'finishForNow' }
  | { type: 'finishImmediately' };
