import { useEffect, useRef, useState } from 'react';
import type { BackendStatus, UnstudiedAdmissionSource } from '../services/api';
import type { CharacterPresentation, SentenceCharacterPresentation } from '../domain/card-characters';
import type { SessionPrefetchState } from '../features/session/session-prefetch';
import type { SessionPhase } from '../lib/session-state';
import { getReviewFailureRatePeriods } from '../lib/review-failure-rates';
import type { SessionFinalizationState } from '../features/session/session-finalization';
import { DietNudgePrompt } from '../features/diet/DietNudgePrompt';

export function HomeOverviewPanel({
  backendStatus,
  sessionPrefetch,
  sessionStarted,
  sessionPhase,
  sessionFinalization,
  sessionLoading,
  displayedSessionItemCount,
  sessionSettingsOpen,
  sessionSettingsSaving,
  dietIntakeStartBlocked,
  onToggleSessionSettings,
  onStartSession,
  onEndSession,
  onNudgeDiet,
}: {
  backendStatus: BackendStatus | null;
  sessionPrefetch: SessionPrefetchState;
  sessionStarted: boolean;
  sessionPhase: SessionPhase | null;
  sessionFinalization: SessionFinalizationState;
  sessionLoading: boolean;
  displayedSessionItemCount: number;
  sessionSettingsOpen: boolean;
  sessionSettingsSaving: boolean;
  dietIntakeStartBlocked: boolean;
  onToggleSessionSettings: () => void;
  onStartSession: () => void;
  onEndSession: () => void;
  onNudgeDiet: (direction: 'easier' | 'harder') => Promise<void>;
}) {
  const prefetchedSessionItemCount = !sessionStarted && sessionPrefetch.status === 'ready'
    ? displayedSessionItemCount
    : null;
  const failureRatePeriods = getReviewFailureRatePeriods(backendStatus?.reviewFailureRateDays ?? []);
  const preparationPending = sessionPrefetch.payload?.preparation?.pending === true;
  const entryWaiting = sessionPrefetch.status === 'pending';
  const canStartSession = sessionStarted || sessionPrefetch.status === 'ready' || sessionPrefetch.status === 'error';

  return (
    <div className="panel home-overview">
      {!sessionStarted ? (
        <div className={`session-start-shell${sessionSettingsOpen ? ' is-settings-open' : ''}`}>
          <button
            type="button"
            className="session-start-card"
            onClick={onStartSession}
            disabled={sessionSettingsOpen || sessionLoading || dietIntakeStartBlocked || !canStartSession}
          >
            <span className="session-start-card-label">
              {sessionLoading || dietIntakeStartBlocked || entryWaiting ? 'Preparing session...'
                : prefetchedSessionItemCount === 0 ? 'Check again' : 'Start session'}
            </span>
            <span className="session-start-card-helper">
              {entryWaiting ? 'Getting your study material ready. This may take about 30 seconds.'
                : preparationPending && prefetchedSessionItemCount === 0
                ? 'Preparing your session. You can check again shortly.'
                : prefetchedSessionItemCount === 0 ? 'No study material is ready right now. You can check again or return later.'
                : <>{prefetchedSessionItemCount ?? '...'} study items ready</>}
            </span>
          </button>
          <button
            type="button"
            className="session-settings-gear"
            aria-label="Session settings"
            aria-expanded={sessionSettingsOpen}
            aria-controls="session-settings-panel"
            disabled={sessionSettingsSaving}
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
          <button
            type="button"
            onClick={onEndSession}
            disabled={sessionPhase === 'draining' || sessionFinalization.kind === 'finalizing'}
          >
            {sessionPhase === 'active'
              ? 'End session'
              : sessionPhase === 'draining'
                ? 'Session draining'
              : sessionPhase === 'completed'
                ? sessionFinalization.kind === 'finalized'
                  ? 'Close summary'
                  : sessionFinalization.kind === 'finalizing'
                    ? 'Finishing...'
                    : 'Finish session'
                : 'Back to overview'}
          </button>
          {sessionPhase === 'completed' && backendStatus?.dietDecksActive ? (
            <DietNudgePrompt onNudge={onNudgeDiet} />
          ) : null}
        </div>
      )}
      <section className="failure-rate-section" aria-label="Exercise failure rate">
        <h3>Exercise failure rate</h3>
        <table className="overview-rate-table" aria-label="Exercise rates by period">
          <thead>
            <tr>
              <td />
              {failureRatePeriods.map((period) => <th key={period.days} scope="col">{period.days}-day</th>)}
            </tr>
          </thead>
          <tbody>
            <tr className="overview-rate-primary">
              <th scope="row">Adjusted failure</th>
              {failureRatePeriods.map((period) => <td key={period.days}>{formatFailureRate(period.adjustedFailureRate)}</td>)}
            </tr>
            <tr>
              <th scope="row">Compensation</th>
              {failureRatePeriods.map((period) => <td key={period.days}>{formatFailureRate(period.compensationRate)}</td>)}
            </tr>
          </tbody>
        </table>
        <details className="overview-rate-details">
          <summary>Rate details</summary>
          <table className="overview-rate-table" aria-label="Exercise counts by period">
            <thead>
              <tr>
                <td />
                {failureRatePeriods.map((period) => <th key={period.days} scope="col">{period.days}-day</th>)}
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">Recorded failures</th>
                {failureRatePeriods.map((period) => <td key={period.days}>{period.failedCount}</td>)}
              </tr>
              <tr>
                <th scope="row">Compensations</th>
                {failureRatePeriods.map((period) => <td key={period.days}>{period.compensatedCount}</td>)}
              </tr>
              <tr>
                <th scope="row">Exercises</th>
                {failureRatePeriods.map((period) => <td key={period.days}>{period.completedCount}</td>)}
              </tr>
            </tbody>
          </table>
          <p>Adjusted failure subtracts compensations from recorded failures, down to zero. Both rates divide by completed exercises.</p>
          <p>Compensations count when applied and may correct earlier failures. Periods include today, in UTC.</p>
        </details>
      </section>
      <section className="failure-rate-section" aria-label="Active study time">
        <h3>Active study time</h3>
        <div className="failure-rate-list">
          <ActiveTimeMetric label="Today" value={backendStatus?.sessionActiveTimeMetrics.todayActiveDurationMs ?? 0} />
          <ActiveTimeMetric label="3-day average" value={backendStatus?.sessionActiveTimeMetrics.rolling3DayAverageActiveDurationMs ?? 0} />
          <ActiveTimeMetric label="7-day average" value={backendStatus?.sessionActiveTimeMetrics.rolling7DayAverageActiveDurationMs ?? 0} />
        </div>
      </section>
    </div>
  );
}

export function SessionSettingsPanel({
  backendStatus,
  onSaveSessionSettings,
  onSavingChange,
  onClose,
}: {
  backendStatus: BackendStatus | null;
  onSaveSessionSettings: (settings: {
    dailyNewWordLimit?: number;
    studyNewWordsFirst?: boolean;
    unstudiedAdmissionSource?: UnstudiedAdmissionSource;
    characterPresentation?: CharacterPresentation;
    sentenceCharacterPresentation?: SentenceCharacterPresentation;
    debriefInterests?: string;
  }) => Promise<void>;
  onSavingChange: (saving: boolean) => void;
  onClose: () => void;
}) {
  const limitInputRef = useRef<HTMLInputElement | null>(null);
  const [limitEditing, setLimitEditing] = useState(false);
  const [limitDraft, setLimitDraft] = useState(() => (
    backendStatus?.dailyNewWordLimit === undefined || backendStatus?.dailyNewWordLimit === null
      ? ''
      : String(backendStatus.dailyNewWordLimit)
  ));
  const [newWordsFirstDraft, setNewWordsFirstDraft] = useState(backendStatus?.studyNewWordsFirst ?? false);
  const [sourceDraft, setSourceDraft] = useState<UnstudiedAdmissionSource>(
    backendStatus?.unstudiedAdmissionSource ?? 'mixed',
  );
  const [presentationDraft, setPresentationDraft] = useState<CharacterPresentation>(
    backendStatus?.characterPresentation ?? 'simplified',
  );
  const [sentencePresentationDraft, setSentencePresentationDraft] = useState<SentenceCharacterPresentation>(
    backendStatus?.sentenceCharacterPresentation ?? 'simplified',
  );
  const [interestsDraft, setInterestsDraft] = useState(backendStatus?.debriefInterests ?? '');
  const [limitSaving, setLimitSaving] = useState(false);
  const [limitError, setLimitError] = useState<string | null>(null);

  const committedLimit = backendStatus?.dailyNewWordLimit ?? null;
  const committedNewWordsFirst = backendStatus?.studyNewWordsFirst ?? false;
  const newWordsFirstDirty = newWordsFirstDraft !== committedNewWordsFirst;
  const committedSource = backendStatus?.unstudiedAdmissionSource ?? 'mixed';
  const committedPresentation = backendStatus?.characterPresentation ?? 'simplified';
  const committedSentencePresentation = backendStatus?.sentenceCharacterPresentation ?? 'simplified';
  const limitDirty = committedLimit !== null && limitDraft.trim() !== String(committedLimit);
  const sourceDirty = sourceDraft !== committedSource;
  const presentationDirty = backendStatus?.studyProfile === 'mandarin' && presentationDraft !== committedPresentation;
  const sentencePresentationDirty = backendStatus?.studyProfile === 'mandarin'
    && sentencePresentationDraft !== committedSentencePresentation;
  const committedInterests = backendStatus?.debriefInterests ?? '';
  const interestsDirty = backendStatus?.studyProfile === 'mandarin' && interestsDraft !== committedInterests;
  const settingsDirty = newWordsFirstDirty || limitDirty || sourceDirty || presentationDirty || sentencePresentationDirty || interestsDirty;

  function beginLimitEdit() {
    setLimitDraft(committedLimit === null ? '' : String(committedLimit));
    setLimitEditing(true);
    setLimitError(null);
  }

  function cancelAndClose() {
    setLimitDraft(committedLimit === null ? '' : String(committedLimit));
    setNewWordsFirstDraft(committedNewWordsFirst);
    setSourceDraft(committedSource);
    setPresentationDraft(committedPresentation);
    setSentencePresentationDraft(committedSentencePresentation);
    setInterestsDraft(committedInterests);
    setLimitEditing(false);
    setLimitError(null);
    onClose();
  }

  async function saveAndClose() {
    if (limitSaving) {
      return;
    }

    if (!settingsDirty) {
      onClose();
      return;
    }

    if (committedLimit === null) {
      return;
    }

    const patch: {
      dailyNewWordLimit?: number;
      studyNewWordsFirst?: boolean;
      unstudiedAdmissionSource?: UnstudiedAdmissionSource;
      characterPresentation?: CharacterPresentation;
      sentenceCharacterPresentation?: SentenceCharacterPresentation;
      debriefInterests?: string;
    } = {};

    if (limitDirty) {
      const dailyNewWordLimit = Number(limitDraft);
      if (limitDraft.trim().length === 0 || !Number.isSafeInteger(dailyNewWordLimit) || dailyNewWordLimit < 0 || dailyNewWordLimit > 20) {
        setLimitError('Enter a whole number from 0 to 20.');
        setLimitEditing(true);
        return;
      }
      patch.dailyNewWordLimit = dailyNewWordLimit;
    }

    if (newWordsFirstDirty) patch.studyNewWordsFirst = newWordsFirstDraft;

    if (sourceDirty) {
      patch.unstudiedAdmissionSource = sourceDraft;
    }

    if (presentationDirty) {
      patch.characterPresentation = presentationDraft;
    }

    if (sentencePresentationDirty) {
      patch.sentenceCharacterPresentation = sentencePresentationDraft;
    }

    if (interestsDirty) patch.debriefInterests = interestsDraft;

    setLimitSaving(true);
    onSavingChange(true);
    setLimitError(null);
    try {
      await onSaveSessionSettings(patch);
      if (patch.dailyNewWordLimit !== undefined) {
        setLimitDraft(String(patch.dailyNewWordLimit));
      }
      setLimitEditing(false);
      onClose();
    } catch (error) {
      setLimitError(error instanceof Error ? error.message : 'Failed to save session settings');
    } finally {
      setLimitSaving(false);
      onSavingChange(false);
    }
  }

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        if (limitSaving) {
          return;
        }
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
  }, [limitDraft, sourceDraft, presentationDraft, sentencePresentationDraft, interestsDraft, committedInterests, limitSaving, settingsDirty, committedLimit, committedSource, committedPresentation, committedSentencePresentation]);

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

  useEffect(() => {
    setSourceDraft(committedSource);
  }, [committedSource]);

  useEffect(() => {
    setPresentationDraft(committedPresentation);
  }, [committedPresentation]);

  useEffect(() => {
    setSentencePresentationDraft(committedSentencePresentation);
  }, [committedSentencePresentation]);

  useEffect(() => { setNewWordsFirstDraft(committedNewWordsFirst); }, [committedNewWordsFirst]);

  useEffect(() => { setInterestsDraft(committedInterests); }, [committedInterests]);

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
              max={20}
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
        <div className="session-settings-row">
          <label className="inline-checkbox">
            <input
              type="checkbox"
              checked={sourceDraft === 'stash_only'}
              disabled={backendStatus?.unstudiedAdmissionSource === undefined || limitSaving}
              aria-label="New words from stash only"
              onChange={(event) => {
                setSourceDraft(event.target.checked ? 'stash_only' : 'mixed');
                setLimitError(null);
              }}
            />
            New words from stash only
          </label>
        </div>
        <div className="session-settings-row">
          <label className="inline-checkbox" title="Introduce all new words first; later practice stays interleaved.">
            <input
              type="checkbox"
              checked={newWordsFirstDraft}
              disabled={backendStatus?.studyNewWordsFirst === undefined || limitSaving}
              onChange={(event) => { setNewWordsFirstDraft(event.target.checked); setLimitError(null); }}
            />
            Study new words first
          </label>
        </div>
        {backendStatus?.studyProfile === 'mandarin' ? (
          <div className="session-settings-row">
            <label className="session-settings-label" htmlFor="card-character-presentation">
              Card characters:
            </label>
            <select
              id="card-character-presentation"
              className="session-settings-select"
              value={presentationDraft}
              disabled={backendStatus.characterPresentation === undefined || limitSaving}
              onChange={(event) => {
                const next = event.target.value;
                if (next === 'simplified' || next === 'traditional' || next === 'both') {
                  setPresentationDraft(next);
                  setLimitError(null);
                }
              }}
            >
              <option value="simplified">Simplified</option>
              <option value="traditional">Traditional</option>
              <option value="both">Both</option>
            </select>
          </div>
        ) : null}
        {backendStatus?.studyProfile === 'mandarin' && presentationDraft === 'both' ? (
          <div className="session-settings-row">
            <label className="session-settings-label" htmlFor="sentence-character-presentation">
              Sentences and examples:
            </label>
            <select
              id="sentence-character-presentation"
              className="session-settings-select"
              value={sentencePresentationDraft}
              disabled={backendStatus.sentenceCharacterPresentation === undefined || limitSaving}
              onChange={(event) => {
                const next = event.target.value;
                if (next === 'simplified' || next === 'traditional') {
                  setSentencePresentationDraft(next);
                  setLimitError(null);
                }
              }}
            >
              <option value="simplified">Simplified</option>
              <option value="traditional">Traditional</option>
            </select>
          </div>
        ) : null}
        {backendStatus?.studyProfile === 'mandarin' ? <div className="session-settings-interests">
          <label htmlFor="debrief-interests">Interests <span className="notes">(optional)</span></label>
          <p className="notes" id="debrief-interests-help">Topics you’re curious about, to help connect the words after a session.</p>
          <textarea id="debrief-interests" aria-describedby="debrief-interests-help" maxLength={1000} rows={3}
            placeholder="professional tennis, 汉服, wukong video game, ..."
            value={interestsDraft} disabled={limitSaving} onChange={(event) => setInterestsDraft(event.target.value)} />
        </div> : null}
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
