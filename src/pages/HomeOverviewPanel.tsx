import type { BackendStatus } from '../services/api';
import {
  formatSessionPrefetchStatus,
  type SessionPrefetchState,
} from '../features/session/session-prefetch';
import type { SessionPhase } from '../lib/session-state';
import { getReviewFailureRatePeriods } from '../lib/review-failure-rates';
import { studyProfile, type ProductionMatchOptions } from '../study-profile';

export function HomeOverviewPanel({
  backendStatus,
  sessionPrefetch,
  sessionStarted,
  sessionPhase,
  sessionLoading,
  displayedSessionItemCount,
  productionMatchOptions,
  onStartSession,
  onEndSession,
  onProductionMatchOptionChange,
  onResetProductionMatchOptions,
}: {
  backendStatus: BackendStatus | null;
  sessionPrefetch: SessionPrefetchState;
  sessionStarted: boolean;
  sessionPhase: SessionPhase | null;
  sessionLoading: boolean;
  displayedSessionItemCount: number;
  productionMatchOptions: ProductionMatchOptions;
  onStartSession: () => void;
  onEndSession: () => void;
  onProductionMatchOptionChange: (option: keyof ProductionMatchOptions, value: boolean) => void;
  onResetProductionMatchOptions: () => void;
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
      {!sessionStarted ? (
        <p className="notes">
          Session prefetch: {formatSessionPrefetchStatus(sessionPrefetch)}
        </p>
      ) : null}
      <section className="answer-matching-section" aria-label="Production answer matching">
        <h3>Answer matching</h3>
        <p className="notes">{studyProfile.labels.source} → {studyProfile.labels.target} typed answers</p>
        <div className="match-options-grid">
          <MatchOption
            label="Ignore case"
            checked={productionMatchOptions.ignoreCase}
            onChange={(value) => onProductionMatchOptionChange('ignoreCase', value)}
          />
          <MatchOption
            label="Ignore accents"
            checked={productionMatchOptions.ignoreAccents}
            onChange={(value) => onProductionMatchOptionChange('ignoreAccents', value)}
          />
          <MatchOption
            label="Normalize apostrophes"
            checked={productionMatchOptions.normalizeApostrophes}
            onChange={(value) => onProductionMatchOptionChange('normalizeApostrophes', value)}
          />
          <MatchOption
            label="Trim edge punctuation"
            checked={productionMatchOptions.trimEdgePunctuation}
            onChange={(value) => onProductionMatchOptionChange('trimEdgePunctuation', value)}
          />
          <MatchOption
            label="Collapse spaces"
            checked={productionMatchOptions.collapseWhitespace}
            onChange={(value) => onProductionMatchOptionChange('collapseWhitespace', value)}
          />
          <MatchOption
            label="Remove spaces"
            checked={productionMatchOptions.removeWhitespace}
            onChange={(value) => onProductionMatchOptionChange('removeWhitespace', value)}
          />
          <MatchOption
            label="Ignore hyphen spacing"
            checked={productionMatchOptions.ignoreHyphenSpacing}
            onChange={(value) => onProductionMatchOptionChange('ignoreHyphenSpacing', value)}
          />
        </div>
        <button type="button" className="secondary-button" onClick={onResetProductionMatchOptions}>
          Reset matching
        </button>
      </section>
    </div>
  );
}

function MatchOption({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="checkbox-row match-option-row">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>{label}</span>
    </label>
  );
}

function formatFailureRate(rate: number | null) {
  if (rate === null) {
    return 'n/a';
  }

  return `${Math.round(rate * 100)}%`;
}
