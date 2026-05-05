import type { BackendStatus } from '../services/api';
import {
  formatSessionPrefetchStatus,
  type SessionPrefetchState,
} from '../features/session/session-prefetch';
import type { SessionPhase } from '../lib/session-state';

export function HomeOverviewPanel({
  backendStatus,
  sessionPrefetch,
  sessionStarted,
  sessionPhase,
  sessionLoading,
  displayedSessionItemCount,
  reviewedCount,
  onStartSession,
  onEndSession,
}: {
  backendStatus: BackendStatus | null;
  sessionPrefetch: SessionPrefetchState;
  sessionStarted: boolean;
  sessionPhase: SessionPhase | null;
  sessionLoading: boolean;
  displayedSessionItemCount: number;
  reviewedCount: number;
  onStartSession: () => void;
  onEndSession: () => void;
}) {
  const statusCounts = backendStatus?.wordStatusCounts ?? {
    unstudied: 0,
    learning: 0,
    review: 0,
  };

  return (
    <div className="panel">
      <h2>Overview</h2>
      <p className="notes">Home loads lightweight counts first, then prefetches the session payload in the background.</p>
      <div className="stack">
        <div className="stat-card">
          <span className="stat-label">Due review items</span>
          <strong className="stat-value">{backendStatus?.dueReviewItemCount ?? 0}</strong>
        </div>
        <div className="stat-card">
          <span className="stat-label">Learning words due</span>
          <strong className="stat-value">{backendStatus?.pendingLearningWordCount ?? 0}</strong>
        </div>
        <div className="stat-card">
          <span className="stat-label">{sessionStarted ? 'Items left in session' : 'New words to introduce'}</span>
          <strong className="stat-value">
            {sessionStarted ? displayedSessionItemCount : backendStatus?.newWordIntroCount ?? 0}
          </strong>
        </div>
        <div className="stat-card">
          <span className="stat-label">{sessionStarted ? 'Answered this session' : 'Prefetched session items'}</span>
          <strong className="stat-value">{sessionStarted ? reviewedCount : displayedSessionItemCount}</strong>
        </div>
      </div>
      <p className="notes">
        Corpus status counts: {statusCounts.learning} learning, {statusCounts.review} review, {statusCounts.unstudied} unstudied.
      </p>
      <p className="notes">Learning coverage day: {backendStatus?.learningCoverageDate ?? 'Unknown'}.</p>
      {!sessionStarted ? (
        <p className="notes">
          Session prefetch: {formatSessionPrefetchStatus(sessionPrefetch)}
        </p>
      ) : null}
      {!sessionStarted ? (
        <button type="button" onClick={onStartSession} disabled={sessionLoading || !backendStatus?.hasSessionWork}>
          {sessionLoading ? 'Preparing session...' : 'Start session'}
        </button>
      ) : (
        <button type="button" onClick={onEndSession}>
          {sessionPhase === 'active'
            ? 'End session'
            : sessionPhase === 'completed'
              ? 'Close summary'
              : 'Back to overview'}
        </button>
      )}
    </div>
  );
}
