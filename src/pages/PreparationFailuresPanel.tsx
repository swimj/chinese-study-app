import { useEffect, useState } from 'react';
import { fetchPreparationFailures, retryPreparationWork, type PreparationFailure } from '../services/api';

export function PreparationFailuresPanel() {
  const [failures, setFailures] = useState<PreparationFailure[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState<string | null>(null);

  async function refresh() {
    setError(null);
    setLoading(true);
    try { setFailures(await fetchPreparationFailures()); }
    catch { setError('Could not load preparation failures.'); }
    finally { setLoading(false); }
  }
  useEffect(() => { void refresh(); }, []);
  async function retry(workId: string) {
    setRetrying(workId);
    setError(null);
    try { await retryPreparationWork(workId); await refresh(); }
    catch { setError('Could not retry this preparation. Refresh to check its current state.'); }
    finally { setRetrying(null); }
  }
  return <section className="stack" aria-label="Word preparation failures">
    <div className="section-heading">
      <h2>Word preparation</h2>
      <button type="button" className="secondary-button" disabled={loading || retrying !== null} onClick={() => void refresh()}>Refresh failures</button>
    </div>
    <p className="notes">Failures retry automatically up to three attempts per shared stage. Paused work needs an operator retry; completed earlier stages are reused.</p>
    {error && <p role="alert">{error}</p>}
    {loading ? <p role="status">Loading preparation failures…</p> : failures.length === 0 ? <p>No preparation failures.</p> :
      failures.map((failure) => <article className="stat-card" key={failure.workId}>
        <strong>{failure.hanzi} · {failure.stage}</strong>
        <p>{failure.status === 'paused' ? 'Paused for operator attention' : 'Automatic retry pending'} · {failure.attemptCount}/3 attempts</p>
        <p>{failure.lastError}</p>
        {failure.status !== 'paused' && <p className="notes">Next eligible attempt: {failure.nextAttemptAt}</p>}
        <details><summary>Attempt history</summary><ol>{failure.attempts.map((attempt) => <li key={attempt.attemptId}>
          {attempt.startedAt} — {attempt.outcome ?? 'running'}{attempt.finishedAt && ` (${attempt.finishedAt})`}
          {attempt.diagnostic && <p>{attempt.diagnostic}</p>}
        </li>)}</ol></details>
        {failure.status === 'paused' && <button type="button" disabled={retrying !== null} onClick={() => void retry(failure.workId)}>
          {retrying === failure.workId ? 'Queuing…' : 'Retry this stage'}
        </button>}
      </article>)}
  </section>;
}
