import type { VocabularySessionAction, VocabularySessionInitialContext, VocabularySessionProjection } from './vocabulary-session';
export type VocabularySessionCompletion = {
  completionId: string; sessionId: string; revisionNumber: number; throughSequence: number;
  status: 'pending' | 'cancelled' | 'closed' | 'failed'; stagedAt: string; closeAt: string;
  closedAt: string | null; report: VocabularySessionProjection; error: string | null;
  serverNow: string; canUndo: boolean;
  /** Bounded client measurement, not a reconstructed fact or model judgment. */
  metadata: { activeDurationMs: number | null; source: 'client_visibility_and_focus' | null };
};
export type VocabularyPersistedSession = {
  sessionId: string; status: 'active' | 'finalizing' | 'closed';
  context: VocabularySessionInitialContext; actions: VocabularySessionAction[];
  projection: VocabularySessionProjection; completion: VocabularySessionCompletion | null;
};
