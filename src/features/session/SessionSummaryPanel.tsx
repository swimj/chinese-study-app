import type { SessionSummary } from './session-summary';

export function SessionSummaryPanel({ summary }: { summary: SessionSummary }) {
  const elapsedLabel = formatElapsedTime(summary.startedAt, summary.completedAt ?? new Date().toISOString());

  return (
    <div className="summary-card">
      <p className="badge">
        {summary.completionMode === 'drain' ? 'Session complete via drain mode' : 'Session complete'}
      </p>
      <h3>Session summary</h3>
      <p className="notes">
        {summary.completionMode === 'drain'
          ? 'You ended intake and finished the remaining open work.'
          : 'You naturally exhausted the session queue.'}
      </p>
      <div className="summary-topline">
        <span className="badge">Review actions completed {summary.completedReviewActions}</span>
        <span className="badge">Lapses {summary.lapsedReviewActions}</span>
      </div>
      {summary.lapsedReviewLabels.length > 0 ? (
        <div className="summary-lapses">
          <p className="notes">Lapsed review actions</p>
          <ul className="word-list">
            {summary.lapsedReviewLabels.map((label, index) => (
              <li key={`${label}-${index}`} className="word-item">
                <div>
                  <strong>{label}</strong>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="summary-grid">
        <div className="stat-card">
          <span className="stat-label">Elapsed time</span>
          <strong className="stat-value">{elapsedLabel}</strong>
        </div>
        <div className="stat-card">
          <span className="stat-label">Answers given</span>
          <strong className="stat-value">{summary.answeredCount}</strong>
        </div>
        <div className="stat-card">
          <span className="stat-label">Session items at start</span>
          <strong className="stat-value">{summary.initialQueueLength}</strong>
        </div>
        <div className="stat-card">
          <span className="stat-label">Review actions completed</span>
          <strong className="stat-value">{summary.completedReviewActions}</strong>
        </div>
        <div className="stat-card">
          <span className="stat-label">Learning words covered</span>
          <strong className="stat-value">{summary.completedLearningWords}</strong>
        </div>
        <div className="stat-card">
          <span className="stat-label">New words introduced</span>
          <strong className="stat-value">{summary.completedUnstudiedWords}</strong>
        </div>
      </div>
      <p className="notes">
        Started {formatDateTime(summary.startedAt)}
        {summary.completedAt ? ` · Completed ${formatDateTime(summary.completedAt)}` : ''}
      </p>
    </div>
  );
}

function formatDateTime(value: string | null) {
  if (!value) {
    return 'Not scheduled';
  }

  return new Date(value).toLocaleString();
}

function formatElapsedTime(startedAt: string, completedAt: string) {
  const elapsedMs = Math.max(0, new Date(completedAt).getTime() - new Date(startedAt).getTime());
  const totalSeconds = Math.floor(elapsedMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes < 60) {
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}:${remainingMinutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}
