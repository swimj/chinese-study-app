import type { DeferredSessionCommit } from '../features/session/session-commit';
import type { SessionDebriefInventoryItem } from './session-debrief';

export const SESSION_COMPLETION_UNDO_MS = 15_000;

export type SessionCompletionWord = { id: string; hanzi: string; traditional: string | null; pinyin: string; meaning: string };
export type SessionCompletionReport = {
  newWords: SessionCompletionWord[];
  graduatedWords: SessionCompletionWord[];
};
export type SessionCompletionSummary = {
  completedAt: string;
  completedReviewActionCount: number;
  failedReviewActionCount: number;
  completedLearningWordCount?: number;
  activeDurationMs: number;
  debriefInventory?: SessionDebriefInventoryItem[];
};
export type StageSessionCompletionRequest = {
  revisionId: string;
  startedAt: string;
  studyDayKey: string;
  summary: SessionCompletionSummary;
  pendingCommit: DeferredSessionCommit | null;
  /** Exact supplement passed to initial reflection; null means no requested reflection. */
  reflectionEvidence: unknown | null;
};
export type SessionCompletion = {
  sessionId: string;
  revisionId: string;
  status: 'pending' | 'cancelled' | 'closed' | 'failed';
  closeAt: string;
  serverNow: string;
  completedAt: string;
  canUndo: boolean;
  /** Pending reports include the staged final transition; closed reports are confirmed. */
  report: SessionCompletionReport;
  error: string | null;
};
