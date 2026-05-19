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
  onStartSession,
  onEndSession,
}: {
  backendStatus: BackendStatus | null;
  sessionPrefetch: SessionPrefetchState;
  sessionStarted: boolean;
  sessionPhase: SessionPhase | null;
  sessionLoading: boolean;
  displayedSessionItemCount: number;
  onStartSession: () => void;
  onEndSession: () => void;
}) {
  const prefetchedSessionItemCount = !sessionStarted && sessionPrefetch.status === 'ready'
    ? displayedSessionItemCount
    : null;
  const canStartSession = sessionStarted || (prefetchedSessionItemCount ?? 0) > 0;

  return (
    <div className="panel">
      <h2>Overview</h2>
      <p className="notes">Home checks backend status, then prefetches the session payload in the background.</p>
      <div className="stack">
        <div className="stat-card">
          <span className="stat-label">{sessionStarted ? 'Items left in session' : 'Session words'}</span>
          <strong className="stat-value">
            {sessionStarted ? displayedSessionItemCount : prefetchedSessionItemCount ?? '...'}
          </strong>
        </div>
      </div>
      <p className="notes">Learning coverage day: {backendStatus?.learningCoverageDate ?? 'Unknown'}.</p>
      <section className="failure-rate-section" aria-label="Review failure rate">
        <h3>Review failure rate</h3>
        {backendStatus?.reviewFailureRateDays.length ? (
          <div className="failure-rate-list">
            {backendStatus.reviewFailureRateDays.slice(-7).map((day) => (
              <div key={day.dayKey} className="failure-rate-row">
                <span>{day.dayKey}</span>
                <strong>{formatFailureRate(day.failureRate)}</strong>
                <span>{day.failedReviewActionSessions}/{day.completedReviewActionSessions}</span>
                <span>3d {formatFailureRate(day.rolling3DayFailureRate)}</span>
                <span>7d {formatFailureRate(day.rolling7DayFailureRate)}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="notes">No review completions recorded yet.</p>
        )}
      </section>
      {!sessionStarted ? (
        <p className="notes">
          Session prefetch: {formatSessionPrefetchStatus(sessionPrefetch)}
        </p>
      ) : null}
      {!sessionStarted ? (
        <button type="button" onClick={onStartSession} disabled={sessionLoading || !canStartSession}>
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

function formatFailureRate(rate: number | null) {
  if (rate === null) {
    return 'n/a';
  }

  return `${Math.round(rate * 100)}%`;
}
