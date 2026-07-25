import { useState } from 'react';
import type { BackendStatus } from '../services/api';
import {
  formatSessionPrefetchStatus,
  type SessionPrefetchState,
} from '../features/session/session-prefetch';
import type { SessionPhase } from '../lib/session-state';
import { getReviewFailureRatePeriods } from '../lib/review-failure-rates';

export function HomeOverviewPanel({
  backendStatus,
  onSaveDailyNewWordLimit,
  sessionPrefetch,
  sessionStarted,
  sessionPhase,
  sessionLoading,
  displayedSessionItemCount,
  onStartSession,
  onEndSession,
}: {
  backendStatus: BackendStatus | null;
  onSaveDailyNewWordLimit: (dailyNewWordLimit: number) => Promise<void>;
  sessionPrefetch: SessionPrefetchState;
  sessionStarted: boolean;
  sessionPhase: SessionPhase | null;
  sessionLoading: boolean;
  displayedSessionItemCount: number;
  onStartSession: () => void;
  onEndSession: () => void;
}) {
  const [dailyNewWordLimitDraft, setDailyNewWordLimitDraft] = useState('');
  const [dailyNewWordLimitSaving, setDailyNewWordLimitSaving] = useState(false);
  const [dailyNewWordLimitError, setDailyNewWordLimitError] = useState<string | null>(null);
  const [dailyNewWordLimitSaved, setDailyNewWordLimitSaved] = useState(false);
  const prefetchedSessionItemCount = !sessionStarted && sessionPrefetch.status === 'ready'
    ? displayedSessionItemCount
    : null;
  const canStartSession = sessionStarted || (prefetchedSessionItemCount ?? 0) > 0;

  async function handleDailyNewWordLimitSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setDailyNewWordLimitError(null);
    setDailyNewWordLimitSaved(false);

    const dailyNewWordLimit = Number(dailyNewWordLimitDraft);
    if (
      dailyNewWordLimitDraft.trim().length === 0 ||
      !Number.isSafeInteger(dailyNewWordLimit) ||
      dailyNewWordLimit < 0
    ) {
      setDailyNewWordLimitError('Enter a non-negative integer.');
      return;
    }

    setDailyNewWordLimitSaving(true);
    try {
      await onSaveDailyNewWordLimit(dailyNewWordLimit);
      setDailyNewWordLimitDraft('');
      setDailyNewWordLimitSaved(true);
    } catch (error) {
      setDailyNewWordLimitError(error instanceof Error ? error.message : 'Failed to save daily new-word limit');
    } finally {
      setDailyNewWordLimitSaving(false);
    }
  }

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
      <section className="daily-new-word-limit-section" aria-labelledby="daily-new-word-limit-heading">
        <h3 id="daily-new-word-limit-heading">Daily new words</h3>
        <p className="notes">
          Limit: {backendStatus?.dailyNewWordLimit ?? '...'}. Changes apply to the next session only.
        </p>
        <form className="daily-new-word-limit-form" onSubmit={(event) => void handleDailyNewWordLimitSubmit(event)}>
          <label htmlFor="daily-new-word-limit">New-word limit</label>
          <div className="daily-new-word-limit-controls">
            <input
              id="daily-new-word-limit"
              type="number"
              min="0"
              step="1"
              inputMode="numeric"
              placeholder="Enter new limit"
              value={dailyNewWordLimitDraft}
              disabled={!backendStatus || dailyNewWordLimitSaving}
              onChange={(event) => {
                setDailyNewWordLimitDraft(event.target.value);
                setDailyNewWordLimitError(null);
                setDailyNewWordLimitSaved(false);
              }}
            />
            <button
              type="submit"
              disabled={!backendStatus || dailyNewWordLimitSaving || dailyNewWordLimitDraft.trim().length === 0}
            >
              {dailyNewWordLimitSaving ? 'Saving...' : 'Save'}
            </button>
          </div>
          {dailyNewWordLimitError ? <p className="form-error" role="alert">{dailyNewWordLimitError}</p> : null}
          {dailyNewWordLimitSaved ? <p className="form-success" role="status">Saved for the next session.</p> : null}
        </form>
      </section>
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
      <section className="failure-rate-section" aria-label="Review failure rate">
        <h3>Review failure rate</h3>
        <div className="failure-rate-list">
          {getReviewFailureRatePeriods(backendStatus?.reviewFailureRateDays ?? []).map((period) => (
            <div key={period.days} className="failure-rate-period">
              <span>{period.days}-day</span>
              <strong>{formatFailureRate(period.failureRate)}</strong>
            </div>
          ))}
        </div>
      </section>
      <section className="failure-rate-section" aria-label="Active study time">
        <h3>Active study time</h3>
        <div className="failure-rate-list">
          <ActiveTimeMetric label="Today" value={backendStatus?.sessionActiveTimeMetrics.todayActiveDurationMs ?? 0} />
          <ActiveTimeMetric label="3-day average" value={backendStatus?.sessionActiveTimeMetrics.rolling3DayAverageActiveDurationMs ?? 0} />
          <ActiveTimeMetric label="7-day average" value={backendStatus?.sessionActiveTimeMetrics.rolling7DayAverageActiveDurationMs ?? 0} />
        </div>
      </section>
      {!sessionStarted ? (
        <p className="notes">
          Session prefetch: {formatSessionPrefetchStatus(sessionPrefetch)}
        </p>
      ) : null}
    </div>
  );
}

function ActiveTimeMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="failure-rate-period">
      <span>{label}</span>
      <strong>{formatActiveTime(value)}</strong>
    </div>
  );
}

function formatFailureRate(rate: number | null) {
  if (rate === null) {
    return 'n/a';
  }

  return `${Math.round(rate * 100)}%`;
}

function formatActiveTime(durationMs: number) {
  const totalSeconds = Math.floor(Math.max(0, durationMs) / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}
