import type { VocabularyPersistedSession } from './vocabulary-session-api';
import type { VocabularyEncounterEvidence, VocabularyWordMode, VocabularyReactionKind } from './vocabulary-session';
import type { VocabularyTimedStudyState } from './timed-session';
export type VocabularyStudyWord = { wordId: string; hanzi: string; traditional: string | null; pinyin: string; meaning: string; personalNotes?: string };
/** Home presents no item count in the timed paradigm; the count still detects an empty start. */
export type VocabularySessionPreview = { previewSeed: string; itemCount: number; preparationPending: boolean; timed: boolean };
export type VocabularyStudy = {
  session: VocabularyPersistedSession;
  words: VocabularyStudyWord[];
  currentEncounter: VocabularyEncounterEvidence | null;
  currentWordId: string | null;
  controls: { canNext: boolean; canSkip: boolean; canEnough: boolean; canMore: boolean; canUndo: boolean;
    canFinishForNow: boolean; canFinishImmediately: boolean; canChangeMode: boolean };
  notice: string | null;
  /** Null for classic sessions. */
  timed: VocabularyTimedStudyState | null;
};
export type VocabularyStudyCommand =
  | { type: 'response'; response: string | null; selfAssessment?: 'accepted' | 'rejected'; selectedWordId?: string }
  /** Exercise reaction; preserve the v1 command spelling for retained command retries. */
  | { type: 'feedback'; feedback: VocabularyReactionKind; comment?: string }
  /** A word skip may name a word other than the current encounter's, e.g. while a pure cue is showing. */
  | { type: 'skip'; scope?: 'exercise' | 'word'; wordId?: string }
  | { type: 'enough' }
  | { type: 'more'; wordId?: string }
  /** Reopen covered work for normal queue selection, preserving the current encounter. */
  | { type: 'requeue'; wordId: string }
  | { type: 'mode'; mode: VocabularyWordMode; wordId?: string }
  | { type: 'undo' }
  | { type: 'resume' }
  /** Timed only: after a budget wrap-up, extend the day by a little and resume ordinary selection. */
  | { type: 'studyMore'; activeDurationMs: number }
  | { type: 'finishForNow' }
  | { type: 'finishImmediately' };
