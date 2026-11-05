import { useEffect, useRef, useState } from 'react';
import type { VocabularyCaseQueueItem } from '../domain/vocabulary-case-queue';
import { ApiRequestError } from '../services/api';
import { vocabularyOperatorApi, type VocabularyOperatorApi, type VocabularyReassessmentModel } from '../features/vocabulary-operator/api';
import { CaseReviewCard } from '../features/vocabulary-operator/CaseReviewCard';
import { CASE_QUEUE_BATCH_SIZE, CASE_QUEUE_WINDOW_PAGES, approvalOutcomeUncertain, canInstallCaseRefresh, caseCanReview, canRetryLatestCaseJob, queueWindowItems, removeCaseFromWindow, replaceCaseProjection, selectionAfterCaseRemoval, type CaseQueueWindow } from '../features/vocabulary-operator/case-queue-model';
import { resolveReviewNavigation } from '../features/vocabulary-operator/review-navigation';
import { VocabularyOperatorPage, type VocabularyDetailActivity } from './VocabularyOperatorPage';
import './VocabularyOperatorPage.css';

type View = 'review' | 'history' | 'attention';
const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'The request could not finish.';
const visible = (element: HTMLElement | null) => document.visibilityState !== 'hidden' && !element?.closest('[hidden]');

export function VocabularyCaseReviewPage({ api = vocabularyOperatorApi }: { api?: VocabularyOperatorApi }) {
  const [view, setView] = useState<View>('review');
  const [pages, setPages] = useState<CaseQueueWindow>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [alternative, setAlternative] = useState<VocabularyCaseQueueItem | null>(null);
  const [search, setSearch] = useState(''), [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true), [loadingMore, setLoadingMore] = useState(false), [busy, setBusy] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [reason, setReason] = useState(''), [model, setModel] = useState<VocabularyReassessmentModel>('openai:gpt-6-sol-high');
  const [confirmSource, setConfirmSource] = useState<{ caseId: string; version: number } | null>(null);
  const [detail, setDetail] = useState<{ caseId: string; proposalId?: string; edit: boolean } | null>(null);
  const [detailActivity, setDetailActivity] = useState<VocabularyDetailActivity>({ dirty: false, busy: false });
  const [approvalUnconfirmed, setApprovalUnconfirmed] = useState(false);
  const approval = useRef<{ requestId: string; proposalId: string; version: number; notes: string } | null>(null);
  const pageRef = useRef<HTMLElement>(null), generation = useRef(0), moreRequest = useRef(false);
  const priorCursors = useRef<(string | null)[]>([]);
  const savedQueues = useRef<Partial<Record<'review' | 'history', { pages: CaseQueueWindow; selectedId: string | null; prior: (string | null)[]; query: string }>>>({});
  const current = useRef({ pages, selectedId, view, query, busy, detailActivity, detail, approvalUnconfirmed });
  current.current = { pages, selectedId, view, query, busy, detailActivity, detail, approvalUnconfirmed };
  function refreshContext(state:typeof current.current) {
    return {view:state.view,query:state.query,selectedId:state.selectedId,detailKey:state.detail?`${state.detail.caseId}:${state.detail.proposalId??''}`:null,busy:state.busy||state.detailActivity.busy,dirty:state.detailActivity.dirty,approvalUnconfirmed:state.approvalUnconfirmed};
  }
  const items = queueWindowItems(pages);
  const selected = items.find(item => item.caseId === selectedId) ?? null;
  const item = alternative?.caseId === selectedId ? alternative : selected;
  const index = items.findIndex(entry => entry.caseId === selectedId);
  const nextCursor = pages.at(-1)?.page.nextCursor ?? null;
  const blocked = busy || detailActivity.busy || approvalUnconfirmed;

  function mayLeaveDetails(): boolean {
    if (detailActivity.busy || busy || approvalUnconfirmed) return false;
    return !detailActivity.dirty || window.confirm('Discard your unsaved edits and leave this case?');
  }
  function clearSelectionState() { setAlternative(null); setReason(''); setConfirmSource(null); setDetail(null); setDetailActivity({ dirty: false, busy: false }); approval.current = null; setApprovalUnconfirmed(false); }
  function selectCase(id: string) {
    if (id === selectedId || !mayLeaveDetails()) return;
    clearSelectionState(); setSelectedId(id); setError(''); setNotice('');
  }
  function changeView(next: View) {
    if (next === view || !mayLeaveDetails()) return;
    if (view !== 'attention') savedQueues.current[view] = { pages, selectedId, prior: priorCursors.current, query };
    const saved = next !== 'attention' ? savedQueues.current[next] : undefined;
    const restore = saved && (next !== 'history' || saved.query === query) ? saved : undefined;
    generation.current++; moreRequest.current = false; priorCursors.current = restore?.prior ?? [];
    clearSelectionState(); setPages(restore?.pages ?? []); setSelectedId(restore?.selectedId ?? null); setLoadingMore(false); setView(next); setError(''); setNotice('');
  }
  async function refresh(initial = false) {
    const state = current.current;
    if (state.view === 'attention' || state.approvalUnconfirmed || (!initial && (!visible(pageRef.current) || state.busy || state.detailActivity.busy || state.detailActivity.dirty))) return;
    const request = ++generation.current;
    const started=refreshContext(state);
    const before = queueWindowItems(state.pages), oldIndex = before.findIndex(entry => entry.caseId === state.selectedId);
    const entries = initial || !state.pages.length ? [{ cursor: null }] : state.pages;
    try {
      const updated = await Promise.all(entries.map(async entry => ({ cursor: entry.cursor, page: await api.caseQueue({ view: state.view as 'review' | 'history', limit: CASE_QUEUE_BATCH_SIZE, ...(entry.cursor ? { cursor: entry.cursor } : {}), ...(state.view === 'history' && state.query ? { search: state.query } : {}) }) })));
      if (request !== generation.current||!canInstallCaseRefresh(started,refreshContext(current.current))) return;
      const fresh = queueWindowItems(updated);
      setPages(updated);
      if (state.selectedId && !fresh.some(entry => entry.caseId === state.selectedId)) clearSelectionState();
      setSelectedId(previous => fresh.some(entry => entry.caseId === previous) ? previous : fresh[Math.max(0, Math.min(oldIndex, fresh.length - 1))]?.caseId ?? null);
      // A selected alternative has its own exact proposal projection; don't replace it with current.
      if (alternative && fresh.some(entry => entry.caseId === alternative.caseId)) {
        const card = await api.caseCard(alternative.caseId, alternative.proposal?.proposalId);
        if (request === generation.current&&canInstallCaseRefresh(started,refreshContext(current.current))) setAlternative(card);
      }
      setError('');
    } catch (cause) { if (request === generation.current) setError(errorMessage(cause)); }
    finally { if (request === generation.current) setLoading(false); }
  }
  useEffect(() => {
    setLoading(view !== 'attention');
    if (view !== 'attention') void refresh(pages.length === 0);
    return () => { generation.current++; };
  }, [api, view, query]);
  useEffect(() => {
    if (view !== 'history') return;
    const timer = setTimeout(() => { if (query !== search.trim()) { generation.current++; priorCursors.current = []; setPages([]); setSelectedId(null); setQuery(search.trim()); } }, 300);
    return () => clearTimeout(timer);
  }, [search, view, query]);
  useEffect(() => {
    if (view === 'attention') return;
    const poll = setInterval(() => void refresh(), items.some(entry => entry.activeJob || entry.approvalState === 'pending') ? 3000 : 15000);
    const focus = () => void refresh();
    window.addEventListener('focus', focus); document.addEventListener('visibilitychange', focus);
    return () => { clearInterval(poll); window.removeEventListener('focus', focus); document.removeEventListener('visibilitychange', focus); };
  }, [api, view, query, alternative, items.some(entry => entry.activeJob || entry.approvalState === 'pending')]);
  async function loadMore() {
    const state = current.current, cursor = state.pages.at(-1)?.page.nextCursor;
    if (!cursor || state.view === 'attention' || moreRequest.current || state.detailActivity.dirty) return;
    moreRequest.current = true; setLoadingMore(true); const request = generation.current;
    try {
      const page = await api.caseQueue({ view: state.view, cursor, limit: CASE_QUEUE_BATCH_SIZE, ...(state.view === 'history' && state.query ? { search: state.query } : {}) });
      if (request !== generation.current) return;
      setPages(previous => {
        if (previous.some(entry => entry.cursor === cursor)) return previous;
        const next = [...previous, { cursor, page }];
        if (next.length > CASE_QUEUE_WINDOW_PAGES) {
          const first = next[0];
          if (first.page.items.some(entry => entry.caseId === current.current.selectedId)) return previous;
          priorCursors.current.push(first.cursor); next.shift();
        }
        return next;
      });
    } catch (cause) { if (request === generation.current) setError(errorMessage(cause)); }
    finally { moreRequest.current = false; setLoadingMore(false); }
  }
  useEffect(() => {
    if (view !== 'attention' && !detail && index >= Math.max(0, items.length - 5) && items.length > 0 && nextCursor) void loadMore();
  }, [index, items.length, nextCursor, view, detail]);
  async function loadPrevious() {
    if (!mayLeaveDetails() || !priorCursors.current.length || view === 'attention') return;
    const cursor = priorCursors.current.at(-1) ?? null, request = ++generation.current;
    setLoadingMore(true);
    try {
      const page = await api.caseQueue({ view, limit: CASE_QUEUE_BATCH_SIZE, ...(cursor ? { cursor } : {}), ...(view === 'history' && query ? { search: query } : {}) });
      if (request !== generation.current) return;
      priorCursors.current.pop(); clearSelectionState(); setPages(previous => [{ cursor, page }, ...previous].slice(0, CASE_QUEUE_WINDOW_PAGES)); setSelectedId(page.items.at(-1)?.caseId ?? null);
    } catch (cause) { setError(errorMessage(cause)); } finally { setLoadingMore(false); }
  }
  function installCard(card: VocabularyCaseQueueItem, advance = false) {
    generation.current++;
    if (current.current.view === 'review' && !caseCanReview(card)) {
      const loaded = queueWindowItems(current.current.pages);
      setSelectedId(previous => previous === card.caseId && loaded.some(entry => entry.caseId === card.caseId) ? selectionAfterCaseRemoval(loaded, card.caseId) : previous);
      setPages(previous => removeCaseFromWindow(previous, card.caseId));
      if (detail?.caseId === card.caseId) { setDetail(null); setDetailActivity({ dirty: false, busy: false }); }
      setAlternative(null);
    } else {
      if (card.proposal && !card.proposal.isCurrent) setAlternative(card);
      else { setPages(previous => replaceCaseProjection(previous, card)); if (advance || alternative?.caseId === card.caseId) setAlternative(null); }
    }
  }
  async function run(work: () => Promise<void>, success?: string) {
    generation.current++;
    setBusy(true); setError(''); setNotice('');
    try { await work(); if (success) setNotice(success); }
    catch (cause) {
      setError(errorMessage(cause));
      if (cause instanceof ApiRequestError && cause.status === 409 && item) {
        try { installCard(await api.caseCard(item.caseId)); } catch { /* Retain the original actionable conflict. */ }
      }
    } finally { setBusy(false); }
  }
  function approve() {
    if (!item?.proposal) return; const card = item, proposal = item.proposal;
    void run(async () => {
      approval.current ??= { requestId: crypto.randomUUID(), proposalId: proposal.proposalId, version: proposal.version, notes: reason };
      const request = approval.current;
      try { await api.requestApproval(request.proposalId, request.version, request.requestId, request.notes); }
      catch (cause) { const uncertain=approvalOutcomeUncertain(cause instanceof ApiRequestError?cause.status:undefined);setApprovalUnconfirmed(uncertain);if(!uncertain)approval.current=null;throw cause; }
      setApprovalUnconfirmed(false); approval.current = null;
      // Persisted ACK is enough to advance even if the following display refresh fails.
      installCard({ ...card, approvalState: 'pending', approvalRequestId: request.requestId });
      setReason('');
    }, 'Approval queued.');
  }
  function resolve() {
    if (!item) return; const card = item;
    void run(async () => {
      const result = card.proposal
        ? (await api.close(card.proposal.proposalId, card.proposal.version, reason), await api.caseCard(card.caseId))
        : await api.resolveCaseReview(card.caseId, card.version, reason);
      installCard(result, true); setReason('');
    }, card.proposal ? 'Proposal dismissed.' : 'Case resolved.');
  }
  function reassess(confirmedVersion?: number) {
    if (!item) return; const card = item;
    void run(async () => {
      const fresh = await api.caseCard(card.caseId, card.proposal?.proposalId);
      installCard(fresh);
      if (fresh.version !== card.version) throw new Error('This case changed since it was displayed. Review the updated case before requesting reassessment.');
      const source = fresh.reassessment.source;
      if (!fresh.reassessment.eligible || !source) throw new Error(fresh.reassessment.reason ?? 'This case cannot be reassessed.');
      if (source.currentVersion !== source.assessedVersion && confirmedVersion !== source.currentVersion) { setConfirmSource({ caseId: fresh.caseId, version: source.currentVersion }); return; }
      const result = await api.reassessCaseReview(fresh.caseId, fresh.version, model, source.currentVersion, fresh.proposal ? { proposalId: fresh.proposal.proposalId, expectedVersion: fresh.proposal.version } : undefined);
      installCard(result.item); setConfirmSource(null); setNotice('Reassessment queued.');
    });
  }
  function secondOpinion() {
    if (!item) return; const card = item;
    void run(async () => {
      if (card.advisoryOpinion?.status === 'failed') await api.retryJob(card.advisoryOpinion.jobId);
      else if (card.proposal) await api.requestSecondOpinion(card.proposal.proposalId, card.proposal.version, reason);
      else await api.requestCaseSecondOpinion(card.caseId, reason);
      installCard(await api.caseCard(card.caseId, card.proposal?.proposalId));
    }, 'Second opinion queued.');
  }
  function openDetails(edit = false) {
    if (!item || blocked) return;
    setDetail({ caseId: item.caseId, ...(item.proposal ? { proposalId: item.proposal.proposalId } : {}), edit });
  }
  async function detailsChanged(caseId: string,savedProposalId?:string) {
    const card = await api.caseCard(caseId); installCard(card, true);
    const open=current.current.detail;
    if(open?.caseId!==caseId||!caseCanReview(card))return;
    const proposalId=savedProposalId??open.proposalId;
    if(savedProposalId&&savedProposalId!==open.proposalId)setDetail({...open,proposalId:savedProposalId});
    if(proposalId&&proposalId!==card.currentProposalId)setAlternative(await api.caseCard(caseId,proposalId));
  }
  const reviewLocked = !item || item.state === 'resolved' || item.frozen || item.approvalState === 'pending' || blocked;
  const proposalResolved = item?.proposal && ['applied', 'closed'].includes(item.proposal.status);
  return <section ref={pageRef} className="vocabulary-operator-page vocabulary-case-review-page" aria-label="Content improvement" tabIndex={0} onKeyDown={event => {
    if (detail || view === 'attention') return;
    const target = event.target instanceof HTMLElement ? event.target : null;
    const next = resolveReviewNavigation(event.nativeEvent, { index, count: items.length, busy: blocked, nativeTarget: !!target?.closest('input,textarea,select,button,summary,[contenteditable="true"]') });
    if (next !== null) { event.preventDefault(); selectCase(items[next].caseId); }
  }}>
    <header><h2>Content improvement</h2><button className="secondary-button" disabled={blocked || detailActivity.dirty || view === 'attention'} onClick={() => void refresh()}>Refresh</button></header>
    <nav className="vocabulary-operator-tabs" aria-label="Review queues">{([['review', 'Awaiting review'], ['attention', 'Needs attention'], ['history', 'Archive']] as const).map(([value, label]) => <button key={value} aria-pressed={view === value} disabled={blocked} onClick={() => changeView(value)}>{label}</button>)}</nav>
    {error && <p role="alert" className="vocabulary-operator-error">{error}</p>}{notice && <p role="status">{notice}</p>}
    {view === 'attention' ? <VocabularyOperatorPage api={api} attentionOnly onActivity={setDetailActivity} /> : <>
      {view === 'history' && <form onSubmit={event => event.preventDefault()}><label>Search archive<input type="search" value={search} disabled={!!detail} onChange={event => setSearch(event.target.value)} /></label>{!query && <p className="vocabulary-operator-meta">Last 12 hours</p>}</form>}
      {loading && <p role="status">Loading cases…</p>}
      {!loading && items.length === 0 && <p role="status">{view === 'history' ? query ? 'No matching archived cases.' : 'No resolutions in the last 12 hours.' : 'No cases awaiting review.'}</p>}
      {item && <>
        <nav className="vocabulary-case-navigation" aria-label="Case navigation">
          <button className="secondary-button" aria-label="Previous case" aria-keyshortcuts="ArrowLeft" disabled={blocked || (index <= 0 && !priorCursors.current.length)} onClick={() => index > 0 ? selectCase(items[index - 1].caseId) : void loadPrevious()}>← Previous</button>
          <span aria-live="polite">{index + 1} / {items.length} loaded{nextCursor ? ' · more available' : ''}</span>
          <button className="secondary-button" aria-label="Next case" aria-keyshortcuts="ArrowRight" disabled={blocked || index >= items.length - 1} onClick={() => selectCase(items[index + 1].caseId)}>Next →</button>
        </nav>
        {detail ? <>
          <button className="secondary-button" disabled={detailActivity.busy || busy} onClick={() => { if (mayLeaveDetails()) { setDetail(null); setDetailActivity({ dirty: false, busy: false }); void refresh(); } }}>Back to case</button>
          <VocabularyOperatorPage key={`${detail.caseId}:${detail.proposalId ?? ''}`} api={api} detailOnly={{ ...detail, history: view === 'history', liveReview: item?.caseId === detail.caseId ? item : null, onChanged: detailsChanged, onSelectProposal: proposalId => void run(async () => { const projection = await api.caseCard(detail.caseId, proposalId); setAlternative(projection); setDetailActivity({ dirty: false, busy: false }); setDetail({ ...detail, proposalId, edit: false }); }) }} onActivity={setDetailActivity} />
        </> : <CaseReviewCard item={item} onDetails={() => openDetails()}>
          {item.alternativeCount > 0 && <label>Proposal<select disabled={blocked} value={item.proposal?.proposalId ?? ''} onChange={event => { const id = event.target.value; void run(async () => setAlternative(await api.caseCard(item.caseId, id || undefined))); }}><option value={item.currentProposalId ?? ''}>Current proposal</option>{item.alternatives.filter(proposal => proposal.proposalId !== item.currentProposalId).map(proposal => <option key={proposal.proposalId} value={proposal.proposalId}>{proposal.rationale || proposal.proposalId} · revision {proposal.version} · {proposal.status}</option>)}</select></label>}
          {item.alternativeCount > item.alternatives.length && <button className="secondary-button" onClick={() => openDetails()}>All retained proposals</button>}
          {view === 'review' && <>
            {item.requiresResolutionReason && !item.proposal ? <label>Case resolution<textarea value={reason} disabled={reviewLocked} onChange={event => setReason(event.target.value)} /></label> : <details><summary>Review note</summary><label>Note or question<textarea value={reason} disabled={reviewLocked} onChange={event => setReason(event.target.value)} /></label></details>}
            <div className="vocabulary-operator-actions">
              {item.proposal && !proposalResolved && <button disabled={reviewLocked && !approvalUnconfirmed || busy || item.stale || item.requiresDetails} onClick={approve}>{approvalUnconfirmed ? 'Retry approval' : 'Approve and apply'}</button>}
              {!proposalResolved && <button className="secondary-button" disabled={reviewLocked || (!item.proposal && item.requiresResolutionReason && !reason.trim()) || (!item.proposal && !item.currentAssessment && !item.requiresResolutionReason)} onClick={resolve}>{item.proposal ? 'Dismiss proposal' : 'Done'}</button>}
              {item.proposal && !proposalResolved && <button className="secondary-button" disabled={reviewLocked} onClick={() => openDetails(true)}>Edit proposal</button>}
              {item.kind === 'exercise_improvement' && (item.proposal || item.currentAssessment) && (!item.advisoryOpinion || item.advisoryOpinion.status === 'failed') && <button className="secondary-button" disabled={reviewLocked || !!item.activeJob || item.stale || !!proposalResolved} onClick={secondOpinion}>{item.advisoryOpinion?.status === 'failed' ? 'Retry second opinion' : 'Second opinion'}</button>}
              {canRetryLatestCaseJob(item) && !item.latestJob?.advisory && <button className="secondary-button" disabled={reviewLocked} onClick={() => void run(async () => { await api.retryJob(item.latestJob!.jobId); installCard(await api.caseCard(item.caseId)); }, 'Assessment queued.')}>Retry assessment {item.latestJob?.sequence}</button>}
            </div>
            {item.reassessment.eligible && <div className="vocabulary-reassessment-control"><label>Model for reassessment<select value={model} disabled={reviewLocked || !!item.activeJob} onChange={event => setModel(event.target.value as VocabularyReassessmentModel)}><option value="openai:gpt-6-sol-high">GPT-6 Sol high</option><option value="openai:gpt-5.6-luna-high">Luna high</option><option value="zai:glm-5.3-flash-high">GLM-5.3 Flash high</option></select></label><button className="secondary-button" disabled={reviewLocked || !!item.activeJob} onClick={() => reassess()}>Reassess</button>{confirmSource?.caseId === item.caseId && <div className="vocabulary-reassessment-confirmation"><p>Source changed from v{item.reassessment.source?.assessedVersion} to v{confirmSource.version}. Reassessment uses the current version.</p><button disabled={reviewLocked} onClick={() => reassess(confirmSource.version)}>Reassess current version</button><button className="secondary-button" onClick={() => setConfirmSource(null)}>Cancel</button></div>}</div>}
          </>}
          <div className="vocabulary-operator-actions"><button className="secondary-button" disabled={blocked} onClick={() => openDetails()}>Details</button></div>
        </CaseReviewCard>}
      </>}
      {nextCursor && <button className="secondary-button" disabled={blocked || loadingMore || detailActivity.dirty} onClick={() => void loadMore()}>{loadingMore ? 'Loading cases…' : 'Load more cases'}</button>}
    </>}
  </section>;
}
