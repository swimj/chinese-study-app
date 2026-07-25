import { useEffect, useRef, useState } from 'react';
import type { BackendStatus } from '../services/api';
import {
  formatSessionPrefetchStatus,
  type SessionPrefetchState,
} from '../features/session/session-prefetch';
import type { SessionPhase } from '../lib/session-state';
import { getReviewFailureRatePeriods } from '../lib/review-failure-rates';

export function HomeOverviewPanel({
  backendStatus,
  sessionPrefetch,
  sessionStarted,
  sessionPhase,
  sessionLoading,
  displayedSessionItemCount,
  sessionSettingsOpen,
  onToggleSessionSettings,
  onStartSession,
  onEndSession,
}: {
  backendStatus: BackendStatus | null;
  sessionPrefetch: SessionPrefetchState;
  sessionStarted: boolean;
  sessionPhase: SessionPhase | null;
  sessionLoading: boolean;
  displayedSessionItemCount: number;
  sessionSettingsOpen: boolean;
  onToggleSessionSettings: () => void;
  onStartSession: () => void;
  onEndSession: () => void;
}) {
  const prefetchedSessionItemCount = !sessionStarted && sessionPrefetch.status === 'ready'
    ? displayedSessionItemCount
    : null;
  const canStartSession = sessionStarted || (prefetchedSessionItemCount ?? 0) > 0;

  return (
    <div className="panel">
      {!sessionStarted ? (
        <div className={`session-start-shell${sessionSettingsOpen ? ' is-settings-open' : ''}`}>
          <button
            type="button"
            className="session-start-card"
            onClick={onStartSession}
            disabled={sessionLoading || !canStartSession}
          >
            <span className="session-start-card-label">
              {sessionLoading ? 'Preparing session...' : 'Start session'}
            </span>
            <span className="session-start-card-helper">
              words: {prefetchedSessionItemCount ?? '...'}
            </span>
          </button>
          <button
            type="button"
            className="session-settings-gear"
            aria-label="Session settings"
            aria-expanded={sessionSettingsOpen}
            aria-controls="session-settings-panel"
            onClick={onToggleSessionSettings}
          >
            <SettingsGearIcon />
          </button>
        </div>
      ) : (
        <div className="stack">
          <div className="stat-card">
            <span className="stat-label">Items left in session</span>
            <strong className="stat-value">{displayedSessionItemCount}</strong>
          </div>
          <button type="button" onClick={onEndSession}>
            {sessionPhase === 'active'
              ? 'End session'
              : sessionPhase === 'completed'
                ? 'Close summary'
                : 'Back to overview'}
          </button>
        </div>
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

export function SessionSettingsPanel({
  backendStatus,
  onSaveDailyNewWordLimit,
  onClose,
}: {
  backendStatus: BackendStatus | null;
  onSaveDailyNewWordLimit: (dailyNewWordLimit: number) => Promise<void>;
  onClose: () => void;
}) {
  const limitInputRef = useRef<HTMLInputElement | null>(null);
  const [limitEditing, setLimitEditing] = useState(false);
  const [limitDraft, setLimitDraft] = useState(() => (
    backendStatus?.dailyNewWordLimit === undefined || backendStatus?.dailyNewWordLimit === null
      ? ''
      : String(backendStatus.dailyNewWordLimit)
  ));
  const [limitSaving, setLimitSaving] = useState(false);
  const [limitError, setLimitError] = useState<string | null>(null);

  const committedLimit = backendStatus?.dailyNewWordLimit ?? null;
  const limitDirty = committedLimit !== null && limitDraft.trim() !== String(committedLimit);

  function beginLimitEdit() {
    setLimitDraft(committedLimit === null ? '' : String(committedLimit));
    setLimitEditing(true);
    setLimitError(null);
  }

  function cancelAndClose() {
    setLimitDraft(committedLimit === null ? '' : String(committedLimit));
    setLimitEditing(false);
    setLimitError(null);
    onClose();
  }

  async function saveAndClose() {
    if (limitSaving) {
      return;
    }

    if (!limitDirty) {
      onClose();
      return;
    }

    if (committedLimit === null) {
      return;
    }

    const dailyNewWordLimit = Number(limitDraft);
    if (limitDraft.trim().length === 0 || !Number.isSafeInteger(dailyNewWordLimit) || dailyNewWordLimit < 0) {
      setLimitError('Enter a non-negative integer.');
      setLimitEditing(true);
      return;
    }

    setLimitSaving(true);
    setLimitError(null);
    try {
      await onSaveDailyNewWordLimit(dailyNewWordLimit);
      setLimitDraft(String(dailyNewWordLimit));
      setLimitEditing(false);
      onClose();
    } catch (error) {
      setLimitError(error instanceof Error ? error.message : 'Failed to save daily new-word limit');
    } finally {
      setLimitSaving(false);
    }
  }

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        cancelAndClose();
        return;
      }

      if (event.key === 'Enter' && !limitSaving) {
        const target = event.target as HTMLElement | null;
        if (target?.closest('textarea, button')) {
          return;
        }
        event.preventDefault();
        void saveAndClose();
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [limitDraft, limitSaving, limitDirty, committedLimit]);

  useEffect(() => {
    if (limitEditing) {
      limitInputRef.current?.focus();
      limitInputRef.current?.select();
    }
  }, [limitEditing]);

  useEffect(() => {
    if (!limitEditing && committedLimit !== null) {
      setLimitDraft(String(committedLimit));
    }
  }, [committedLimit, limitEditing]);

  return (
    <div
      id="session-settings-panel"
      className="panel study-session-panel session-settings-panel"
      role="dialog"
      aria-label="Session settings"
    >
      <h2>Session Settings</h2>
      <div className="session-settings-body">
        <div className="session-settings-row">
          <span className="session-settings-label">Daily New Word Limit:</span>
          {limitEditing ? (
            <input
              ref={limitInputRef}
              className="session-settings-limit-input"
              type="number"
              min={0}
              step={1}
              inputMode="numeric"
              value={limitDraft}
              disabled={committedLimit === null || limitSaving}
              aria-label="Daily new-word limit"
              onChange={(event) => {
                setLimitDraft(event.target.value);
                setLimitError(null);
              }}
            />
          ) : (
            <button
              type="button"
              className="session-settings-limit-value"
              disabled={committedLimit === null}
              onClick={beginLimitEdit}
            >
              {committedLimit ?? '...'}
            </button>
          )}
        </div>
        {limitError ? <p className="form-error" role="alert">{limitError}</p> : null}
        <div className="session-settings-actions">
          <button
            type="button"
            className="secondary-button"
            disabled={limitSaving}
            onClick={cancelAndClose}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={limitSaving}
            onClick={() => {
              void saveAndClose();
            }}
          >
            {limitSaving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

function SettingsGearIcon() {
  return (
    <svg
      className="session-settings-gear-icon"
      viewBox="0 0 24 24"
      width="16"
      height="16"
      aria-hidden="true"
      focusable="false"
    >
      <path
        fill="currentColor"
        d="M19.14 12.94c.04-.31.06-.63.06-.94s-.02-.63-.06-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.1 7.1 0 0 0-1.63-.94l-.36-2.54a.5.5 0 0 0-.5-.42h-3.84a.5.5 0 0 0-.5.42l-.36 2.54c-.58.23-1.12.54-1.63.94l-2.39-.96a.5.5 0 0 0-.6.22L2.71 8.84a.5.5 0 0 0 .12.64l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94L2.83 14.52a.5.5 0 0 0-.12.64l1.92 3.32c.14.24.43.34.68.22l2.39-.96c.5.4 1.05.71 1.63.94l.36 2.54c.05.24.26.42.5.42h3.84c.24 0 .45-.18.5-.42l.36-2.54c.58-.23 1.12-.54 1.63-.94l2.39.96c.25.12.54.02.68-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58ZM12 15.6A3.6 3.6 0 1 1 12 8.4a3.6 3.6 0 0 1 0 7.2Z"
      />
    </svg>
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
