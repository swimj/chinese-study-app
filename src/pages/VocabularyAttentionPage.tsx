import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import type { VocabularyAttentionItem, VocabularyAttentionKind, VocabularyAttentionPage as AttentionPage } from '../domain/vocabulary-attention';
import type { VocabularyOperatorApi } from '../features/vocabulary-operator/api';
import { SenseReconciliationPage } from './SenseReconciliationPage';
import { ScopeCoverageEditor } from '../features/vocabulary-operator/ScopeCoverageEditor';
import { shortcutEventBlocked } from '../lib/keyboard';
import { VocabularyOperatorPage, type VocabularyDetailActivity, type VocabularyOperatorDetail } from './VocabularyOperatorPage';

const labels: Record<VocabularyAttentionKind, string> = {
  reconciliation: 'Sense reconciliation', defaults: 'Word defaults', approval: 'Application', preparation: 'Practice preparation', dispatch: 'Evidence processing', case: 'Case processing',
};
const message = (cause: unknown) => cause instanceof Error ? cause.message : 'The request could not finish.';
const batchSize = 20;

export type AttentionPosition = {selectedId: string | null; kind: VocabularyAttentionKind | ''; offset: number};

export function VocabularyAttentionPage({ api, onActivity, position }: { api: VocabularyOperatorApi; position: MutableRefObject<AttentionPosition>; onActivity: (activity: VocabularyDetailActivity) => void }) {
  const [page, setPage] = useState<AttentionPage>({items: [], total: 0, offset: position.current.offset});
  const [selectedId, setSelectedId] = useState<string | null>(position.current.selectedId);
  const [kind, setKind] = useState<VocabularyAttentionKind | ''>(position.current.kind);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [scopeEditing, setScopeEditing] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [details, setDetails] = useState(false);
  const [editor, setEditor] = useState<{caseId: string | null; proposalId?: string} | null>(null);
  const [editorActivity, setEditorActivity] = useState<VocabularyDetailActivity>({dirty: false, busy: false});
  const [actionsContainer, setActionsContainer] = useState<HTMLDivElement | null>(null);
  const root = useRef<HTMLElement>(null), serial = useRef(0);
  const current = useRef({page, selectedId, kind, busy, loading, scopeEditing, editor, editorActivity});
  current.current = {page, selectedId, kind, busy, loading, scopeEditing, editor, editorActivity};
  useEffect(() => { if (!loading) position.current = {selectedId, kind, offset: page.offset}; }, [selectedId, kind, page.offset, loading, position]);
  const index = page.items.findIndex(item => item.id === selectedId);
  const item = page.items[index] ?? null;
  const blocked = busy || loading || scopeEditing || editorActivity.busy || editorActivity.dirty;
  useEffect(() => { onActivity({dirty: editorActivity.dirty, busy: busy || scopeEditing || editorActivity.busy}); }, [busy, scopeEditing, editorActivity, onActivity]);
  useEffect(() => () => onActivity({dirty: false, busy: false}), [onActivity]);

  async function refresh(options: {offset?: number; kind?: VocabularyAttentionKind | ''; select?: 'first' | 'last'; force?: boolean} = {}) {
    const state = current.current;
    if (!options.force && (state.busy || state.loading || state.scopeEditing || state.editor || state.editorActivity.dirty || document.visibilityState === 'hidden' || root.current?.closest('[hidden]'))) return;
    const token = ++serial.current;
    const filter = options.kind ?? state.kind;
    const offset = options.offset ?? state.page.offset;
    try {
      let result = await api.attentionQueue({offset, limit: batchSize, ...(options.offset === undefined && options.kind === undefined && state.selectedId ? {anchorId: state.selectedId} : {}), ...(filter ? {kind: filter} : {})});
      if (token !== serial.current) return;
      if (!result.items.length && result.total > 0 && offset > 0) {
        result = await api.attentionQueue({offset: Math.floor((result.total - 1) / batchSize) * batchSize, limit: batchSize, ...(filter ? {kind: filter} : {})});
      }
      if (token !== serial.current || (!options.force && (current.current.scopeEditing || current.current.editor || current.current.busy))) return;
      const oldIndex = state.page.items.findIndex(entry => entry.id === state.selectedId);
      const next = options.select === 'first' ? result.items[0] : options.select === 'last' ? result.items.at(-1)
        : result.items.find(entry => entry.id === state.selectedId) ?? result.items[Math.max(0, Math.min(oldIndex, result.items.length - 1))];
      setPage(result); setSelectedId(next?.id ?? null); setError('');
      if (next?.id !== state.selectedId) setDetails(false);
    } catch (cause) { if (token === serial.current) setError(message(cause)); }
    finally { if (token === serial.current) setLoading(false); }
  }
  useEffect(() => {
    void refresh({force: true});
    const timer = setInterval(() => void refresh(), 15000);
    const focus = () => void refresh();
    window.addEventListener('focus', focus); document.addEventListener('visibilitychange', focus);
    return () => { serial.current++; clearInterval(timer); window.removeEventListener('focus', focus); document.removeEventListener('visibilitychange', focus); };
  }, [api]);
  async function navigate(direction: -1 | 1) {
    if (blocked || editor || !item) return;
    serial.current++;
    setError(''); setNotice(''); setDetails(false);
    const neighbor = page.items[index + direction];
    if (neighbor) { setSelectedId(neighbor.id); return; }
    const position = page.offset + index + direction;
    const offset = position < 0 ? Math.floor((page.total - 1) / batchSize) * batchSize : position >= page.total ? 0 : Math.floor(position / batchSize) * batchSize;
    setLoading(true);
    await refresh({offset, select: direction === 1 ? 'first' : 'last', force: true});
  }
  async function run(work: () => Promise<unknown>, success: string) {
    serial.current++; setBusy(true); setError(''); setNotice('');
    try { await work(); setNotice(success); await refresh({force: true}); }
    catch (cause) { setError(message(cause)); }
    finally { setBusy(false); }
  }
  const defaultsSaved = useCallback(() => {
    setScopeEditing(false); setLoading(true);
    void refresh({force: true});
    setNotice('Word defaults saved.');
  }, [api]);
  function openEditor() {
    if (!item || blocked) return;
    serial.current++;
    setEditor({caseId: item.caseId, ...(item.kind === 'approval' ? {proposalId: item.proposalId} : {})});
  }
  function closeEditor() {
    if (editorActivity.busy || (editorActivity.dirty && !window.confirm('Discard your unsaved edits and return to attention?'))) return;
    serial.current++; setEditor(null); setEditorActivity({dirty: false, busy: false}); setLoading(true);
    void refresh({force: true});
  }
  const editorProps: VocabularyOperatorDetail | null = editor ? {
    ...(editor.caseId === null ? {caseId: null, proposalId: editor.proposalId!} : {caseId: editor.caseId, proposalId: editor.proposalId}), liveReview: null,
    onChanged: async () => { /* Keep the editor pinned until the operator returns. */ },
    onSelectProposal: proposalId => setEditor(previous => previous ? {...previous, proposalId} : null),
  } : null;

  return <section className="vocabulary-attention-page" ref={root} aria-label="Needs attention" tabIndex={0} onKeyDown={event => {
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (editor || blocked || shortcutEventBlocked(event.nativeEvent) || event.shiftKey || target?.closest('input,textarea,select,summary,button,[contenteditable="true"]')) return;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); void navigate(event.key === 'ArrowLeft' ? -1 : 1); }
  }}>
    {editorProps ? <>
      <button className="secondary-button vocabulary-attention-back" disabled={editorActivity.busy} onClick={closeEditor}>Back to attention</button>
      <div className="vocabulary-attention-editor"><VocabularyOperatorPage key={`${editorProps.caseId}:${editorProps.proposalId ?? ''}`} api={api} detailOnly={editorProps} onActivity={setEditorActivity}/></div>
    </> : <>
      <div className="vocabulary-attention-toolbar">
        <label><select aria-label="Attention type" value={kind} disabled={blocked} onChange={event => {
          const value = event.target.value as VocabularyAttentionKind | ''; setKind(value); setPage({items: [], total: 0, offset: 0}); setSelectedId(null); setLoading(true); setDetails(false); setNotice('');
          void refresh({offset: 0, kind: value, select: 'first', force: true});
        }}><option value="">All types</option>{Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <button className="secondary-button" disabled={blocked} onClick={() => void refresh()}>Refresh</button>
        {item && <nav className="vocabulary-case-navigation" aria-label="Attention navigation"><button className="secondary-button" aria-label="Previous attention item" disabled={blocked || page.total === 1} onClick={() => void navigate(-1)}>←</button><span aria-live="polite">{page.offset + index + 1} / {page.total}</span><button className="secondary-button" aria-label="Next attention item" disabled={blocked || page.total === 1} onClick={() => void navigate(1)}>→</button></nav>}
      </div>
      {error && <p role="alert" className="vocabulary-operator-error">{error}</p>}{notice && <p role="status">{notice}</p>}
      {loading && <p role="status">Loading attention…</p>}
      {!loading && !error && !item && <p role="status">{kind ? 'No items of this type need attention.' : 'Nothing needs attention.'}</p>}
      {item && <div className="vocabulary-case-frame">
        <div className="vocabulary-case-scroll" tabIndex={0} aria-label="Attention content">
          <article className="vocabulary-case-card vocabulary-attention-card" key={item.id}>
            <div className="vocabulary-case-heading"><h2>{item.title}</h2><span className="vocabulary-operator-meta">{labels[item.kind]}</span></div>
            <p>{item.reason}</p>
            {item.kind === 'reconciliation' && <>
              <details className="reconciliation-related"><summary>{item.children.some(child=>child.kind==='preparation')?`Individual cases (${item.children.filter(child=>child.kind==='preparation').length})`:'Source details'}</summary>
                {item.children.map(child=><article key={child.id}>
                  <h3>{child.kind==='source'?'Teaching source':'Practice preparation'}</h3>
                  <p>{child.reason}</p>
                  <dl><dt>{child.reconciliationId ? 'Canonical resolution' : 'Source'}</dt><dd><code>{child.reconciliationId ?? child.sourceContentId}</code></dd><dt>Record</dt><dd><code>{child.sourceId}</code></dd></dl>
                </article>)}
              </details>
              <SenseReconciliationPage key={item.id} wordId={item.wordId} onActivity={setEditorActivity}/>
            </>}
            {item.kind === 'defaults' && <ScopeCoverageEditor api={api} wordId={item.wordId} disabled={busy || loading} expanded onActivity={setScopeEditing} onSaved={defaultsSaved} actionsContainer={actionsContainer}/>}
            {item.kind === 'approval' && <p>Approved revision {item.expectedVersion} · application not completed</p>}
            {details && <section className="vocabulary-case-provenance" aria-label="Attention details">
              <p>Opened {new Date(item.createdAt).toLocaleString()}</p>
              {item.kind === 'approval' && <><p>Request: {item.requestId}</p><p>Proposal: {item.proposalId}</p><p>Attempts: {item.attempts}</p></>}
              {item.kind === 'preparation' && <><p>Attempt: {item.attemptCount}</p><p>{item.reconciliationId ? 'Canonical resolution' : 'Source'}: {item.reconciliationId ?? item.sourceContentId}</p><p>Invocation: {item.invocationId ?? 'No retained invocation'}</p></>}
              {item.kind === 'dispatch' && <><p>Session: {item.sessionId}</p><p>Learner: {item.learnerId}</p></>}
              {item.kind === 'defaults' && <p>Invocation: {item.finding.invocationId ?? 'No retained invocation'}</p>}
              {item.caseId && <p>Case: {item.caseId}</p>}
            </section>}
          </article>
        </div>
        <div className="vocabulary-case-action-frame">
          <div ref={setActionsContainer}/>
          <div className="vocabulary-operator-actions">
            {item.kind === 'approval' && item.retryable && <button disabled={blocked} onClick={() => void run(() => api.retryApproval(item.requestId), 'Application queued.')}>Retry application</button>}
            {item.kind === 'preparation' && item.retryable && <button disabled={blocked} onClick={() => void run(() => api.retryPreparation(item.workId), 'Preparation queued.')}>Retry preparation</button>}
            {item.kind === 'dispatch' && <button disabled={blocked} onClick={() => void run(() => api.retryDispatch(item.dispatchId), 'Evidence processing queued.')}>Retry evidence processing</button>}
            {item.kind === 'case' && item.retryable && item.jobId && <button disabled={blocked} onClick={() => void run(() => api.retryJob(item.jobId!), 'Processing queued.')}>Retry processing</button>}
            {item.kind === 'case' && item.abandonable && item.jobId && <button className="secondary-button" disabled={blocked} onClick={() => void run(async () => {const card=await api.caseCard(item.caseId);await api.abandonReassessment(item.caseId,card.version,item.jobId!);}, 'Reassessment abandoned; the earlier assessment is available.')}>Abandon reassessment</button>}
            {item.kind === 'case' && item.dismissible && <button disabled={blocked} onClick={() => void run(() => api.dismissSupersededCase(item.caseId), 'Case dismissed; its evidence remains retained.')}>Dismiss</button>}
            {(item.caseId || item.kind === 'approval') && <button className="secondary-button" disabled={blocked} onClick={openEditor}>{item.caseId ? 'Open case' : 'Open proposal'}</button>}
            <span className="vocabulary-action-spacer"/><button className="secondary-button" aria-expanded={details} onClick={() => setDetails(value => !value)}>Details</button>
          </div>
        </div>
      </div>}
    </>}
  </section>;
}
