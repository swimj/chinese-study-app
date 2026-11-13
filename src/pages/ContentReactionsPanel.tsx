import { useEffect, useState } from 'react';
import { fetchOperatorContentReactions } from '../services/api';
import { NOT_FOR_ME_REASON_LABELS, type ContentReactionSummary } from '../domain/content-reactions';

const kindLabel = { connection: 'Connections', lesson: 'Feedback lessons' } as const;
const percent = (part: number, whole: number) => whole ? `${Math.round((part / whole) * 100)}%` : '—';

/** Learner Save / Not for me reactions across learners, by kind, reason and connection prompt. */
export function ContentReactionsPanel() {
  const [summary, setSummary] = useState<ContentReactionSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  async function refresh() {
    setError(null); setLoading(true);
    try { setSummary(await fetchOperatorContentReactions()); }
    catch { setError('Could not load reactions.'); }
    finally { setLoading(false); }
  }
  useEffect(() => { void refresh(); }, []);
  const count = (kind: 'connection' | 'lesson', reaction: 'saved' | 'not_for_me') =>
    summary?.totals.find((row) => row.kind === kind && row.reaction === reaction)?.count ?? 0;
  return <section className="stack" aria-label="Learner reactions">
    <div className="section-heading">
      <h2>Learner reactions</h2>
      <button type="button" className="secondary-button" disabled={loading} onClick={() => void refresh()}>Refresh</button>
    </div>
    {error && <p role="alert">{error}</p>}
    {loading && !summary ? <p role="status">Loading reactions…</p> : summary ? <>
      <table className="operator-table">
        <caption>Current reactions</caption>
        <thead><tr><th scope="col">Kind</th><th scope="col">Saved</th><th scope="col">Not for me</th></tr></thead>
        <tbody>{(['connection', 'lesson'] as const).map((kind) => <tr key={kind}>
          <th scope="row">{kindLabel[kind]}</th><td>{count(kind, 'saved')}</td><td>{count(kind, 'not_for_me')}</td>
        </tr>)}</tbody>
      </table>
      <table className="operator-table">
        <caption>Not-for-me reasons</caption>
        <thead><tr><th scope="col">Kind</th><th scope="col">Reason</th><th scope="col">Count</th></tr></thead>
        <tbody>{summary.reasons.length ? summary.reasons.map((row) => <tr key={`${row.kind}-${row.reason}`}>
          <td>{kindLabel[row.kind]}</td><td>{NOT_FOR_ME_REASON_LABELS[row.reason]}</td><td>{row.count}</td>
        </tr>) : <tr><td colSpan={3}>No reasons given yet.</td></tr>}</tbody>
      </table>
      <table className="operator-table">
        <caption>Connections by prompt and model</caption>
        <thead><tr><th scope="col">Prompt</th><th scope="col">Model</th><th scope="col">Notes</th><th scope="col">Saved</th><th scope="col">Not for me</th></tr></thead>
        <tbody>{summary.connectionsByPrompt.length ? summary.connectionsByPrompt.map((row) => <tr key={`${row.promptVersion}-${row.model}`}>
          <td>{row.promptVersion}</td><td>{row.model}</td><td>{row.notes}</td>
          <td>{row.saved} ({percent(row.saved, row.notes)})</td><td>{row.notForMe} ({percent(row.notForMe, row.notes)})</td>
        </tr>) : <tr><td colSpan={5}>No generated connections yet.</td></tr>}</tbody>
      </table>
      <h3>Marked Wrong</h3>
      {summary.flaggedWrong.length ? summary.flaggedWrong.map((row, index) => <article className="stat-card" key={`${row.learnerId}-${row.at}-${index}`}>
        <strong>{row.label}</strong>
        <p className="notes">{row.learnerId} · {new Date(row.at).toLocaleString()}</p>
        <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{row.text}</p>
      </article>) : <p>Nothing marked Wrong.</p>}
    </> : null}
  </section>;
}
