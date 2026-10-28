import { useEffect, useState } from 'react';
import type { VocabularyContentProposal, VocabularySecondOpinion } from '../../domain/vocabulary-reflection';
import type { VocabularyOperatorApi } from './api';

const verdicts = { support: 'Supports this proposal', revise: 'Suggests revision', reject: 'Recommends against this proposal' };
export function ProposalSecondOpinion({ api, proposal, eligible, disabled, expanded = false }: {
  api: VocabularyOperatorApi; proposal: VocabularyContentProposal; eligible: boolean; disabled: boolean; expanded?: boolean;
}) {
  const [opinions, setOpinions] = useState<VocabularySecondOpinion[]>([]);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function refresh() {
      try {
        const { items } = await api.secondOpinions(proposal.proposalId);
        if (!active) return;
        setOpinions(items); setError('');
        if (items.some(item => item.status === 'queued' || item.status === 'running')) timer = setTimeout(refresh, 3000);
      } catch (cause) { if (active) setError(cause instanceof Error ? cause.message : 'Could not load second opinions.'); }
    }
    void refresh();
    return () => { active = false; clearTimeout(timer); };
  }, [api, proposal.proposalId, proposal.version, busy, refreshKey]);
  const current = opinions.find(item => item.proposalVersion === proposal.version);
  const older = opinions.filter(item => item.proposalVersion !== proposal.version);
  async function request(retry?: VocabularySecondOpinion) {
    setBusy(true); setError('');
    try {
      if (retry) await api.retryJob(retry.jobId);
      else await api.requestSecondOpinion(proposal.proposalId, proposal.version, notes);
      setOpinions((await api.secondOpinions(proposal.proposalId)).items);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not request a second opinion.'); }
    finally { setBusy(false); }
  }
  return <div className="vocabulary-second-opinion" aria-label="Second opinion">
    {error && <div role="alert"><p>{error}</p><button className="secondary-button" onClick={() => setRefreshKey(value => value + 1)}>Reload second opinions</button></div>}
    {current ? <>
      {current.result ? <><p><strong>{verdicts[current.result.verdict]}</strong></p><p>{expanded ? current.result.rationale : current.result.rationale.match(/^.*?[.!?](?:\s|$)/)?.[0].trim() ?? current.result.rationale}</p></>
        : <p role="status">{current.status === 'queued' ? 'Second opinion queued' : current.status === 'running' ? 'Reviewing…' : 'Review failed'}</p>}
      {current.status === 'failed' && eligible && <><button className="secondary-button" disabled={busy || disabled} onClick={() => void request(current)}>Retry second opinion</button>{expanded && <p>{current.error}</p>}</>}
    </> : eligible && <>
      <button className="secondary-button" disabled={busy || disabled} onClick={() => void request()}>Second opinion</button>
      {expanded && <label>Question for second opinion (optional)<textarea value={notes} onChange={event => setNotes(event.target.value)} disabled={busy || disabled} /></label>}
    </>}
    {expanded && older.length > 0 && <div><h4>Earlier opinions</h4>{older.map(item => <article key={item.requestId}><h4>Version {item.proposalVersion} · earlier draft</h4><p>{item.result ? verdicts[item.result.verdict] : item.status}</p><p>{item.result?.rationale}</p></article>)}</div>}
  </div>;
}
