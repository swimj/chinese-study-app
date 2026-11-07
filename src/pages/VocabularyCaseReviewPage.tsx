import { useEffect, useRef, useState } from 'react';
import type { VocabularyCaseQueueItem, VocabularyCaseQueueQuery } from '../domain/vocabulary-case-queue';
import { ApiRequestError } from '../services/api';
import { vocabularyOperatorApi, type VocabularyOperatorApi, type VocabularyReassessmentModel } from '../features/vocabulary-operator/api';
import type { VocabularyRepairTargetWorkspace } from '../domain/vocabulary-reflection';
import { repairTargetBlocksMutation } from '../features/vocabulary-operator/sense-coverage';
import { ScopeCoverageEditor } from '../features/vocabulary-operator/ScopeCoverageEditor';
import { ReassessmentDialog } from '../features/vocabulary-operator/ReassessmentDialog';
import { RepairTargetEditor } from '../features/vocabulary-operator/RepairTargetEditor';
import { CaseNotes } from '../features/vocabulary-operator/CaseNotes';
import { loadCueEdit, cueEditDraft } from '../features/vocabulary-operator/quick-cue-edit';
import { QuickCueEditor } from '../features/vocabulary-operator/QuickCueEditor';
import { CaseReviewCard } from '../features/vocabulary-operator/CaseReviewCard';
import { CASE_QUEUE_BATCH_SIZE, approvalOutcomeUncertain, canInstallCaseRefresh, caseCanReview, canRetryLatestCaseJob, queueWindowItems, removeCaseFromWindow, replaceCaseProjection, selectionAfterCaseRemoval, type CaseQueueWindow } from '../features/vocabulary-operator/case-queue-model';
import { shortcutEventBlocked } from '../lib/keyboard';
import { VocabularyOperatorPage, type VocabularyDetailActivity } from './VocabularyOperatorPage';
import { VocabularyAttentionPage, type AttentionPosition } from './VocabularyAttentionPage';
import './VocabularyOperatorPage.css';

type View = 'review' | 'history' | 'attention' | 'deferred';
const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'The request could not finish.';
const visible = (element: HTMLElement | null) => document.visibilityState !== 'hidden' && !element?.closest('[hidden]');

export function VocabularyCaseReviewPage({ api = vocabularyOperatorApi }: { api?: VocabularyOperatorApi }) {
  const attentionPosition = useRef<AttentionPosition>({selectedId: null, kind: '', offset: 0});
  const [cueEdit,setCueEdit]=useState<{operationKey:string|null}|null>(null);
  const [cueActivity,setCueActivity]=useState({dirty:false,busy:false});
  const [view, setView] = useState<View>('review');
  const [pages, setPages] = useState<CaseQueueWindow>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [alternative, setAlternative] = useState<VocabularyCaseQueueItem | null>(null);
  const [search, setSearch] = useState(''), [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true), [loadingMore, setLoadingMore] = useState(false), [busy, setBusy] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [action,setAction]=useState<'approve'|'resolve'|'opinion'|null>(null);
  const [actionText,setActionText]=useState('');
  const [editorialText,setEditorialText]=useState('');
  const [attachedOpinion,setAttachedOpinion]=useState<VocabularyCaseQueueItem['advisoryOpinion']>(null);
  const [noteActivity,setNoteActivity]=useState({dirty:false,busy:false});
  function closeAction(){setAction(null);setActionText('');}
  function openAction(value:NonNullable<typeof action>){setError('');setMoreOpen(false);setActionText('');setAction(value);}
  function openReassessment(opinion: VocabularyCaseQueueItem['advisoryOpinion'] = null){setError('');setEditorialText('');setAttachedOpinion(opinion);setReassessmentOpen(true);}
  function closeReassessment(){setReassessmentOpen(false);setConfirmSource(null);setEditorialText('');setAttachedOpinion(null);}
  const [model, setModel] = useState<VocabularyReassessmentModel>('openai:gpt-6-sol-high');
  const [confirmSource, setConfirmSource] = useState<{ caseId: string; version: number } | null>(null);
  const [detail, setDetail] = useState<{ caseId: string; proposalId?: string; edit: boolean } | null>(null);
  const [detailActivity, setDetailActivity] = useState<VocabularyDetailActivity>({ dirty: false, busy: false });
  const [approvalUnconfirmed, setApprovalUnconfirmed] = useState(false);
  const [repairTarget,setRepairTarget]=useState<VocabularyRepairTargetWorkspace|null>(null);
  const [targetSaving,setTargetSaving]=useState(false);
  const [reassessmentOpen,setReassessmentOpen]=useState(false);
  const [wordDefaultsEditing, setWordDefaultsEditing] = useState(false);
  const approval = useRef<{ requestId: string; proposalId: string; version: number; notes: string } | null>(null);
  const pageRef = useRef<HTMLElement>(null), generation = useRef(0);
  const [showDetails, setShowDetails] = useState(false), [moreOpen, setMoreOpen] = useState(false);
  const savedQueues = useRef<Partial<Record<'review' | 'history' | 'deferred', { pages: CaseQueueWindow; selectedId: string | null; query: string }>>>({});
  const current = useRef({ pages, selectedId, view, query, busy, loadingMore, detailActivity, detail, approvalUnconfirmed, wordDefaultsEditing, reassessmentOpen, action, noteActivity, cueEdit, cueActivity });
  current.current = { pages, selectedId, view, query, busy, loadingMore, detailActivity, detail, approvalUnconfirmed, wordDefaultsEditing, reassessmentOpen, action, noteActivity, cueEdit, cueActivity };
  function refreshContext(state:typeof current.current) {
    return {view:state.view,query:state.query,selectedId:state.selectedId,detailKey:state.detail?`${state.detail.caseId}:${state.detail.proposalId??''}`:null,busy:state.busy||state.loadingMore||state.detailActivity.busy||state.noteActivity.busy||state.cueActivity.busy,dirty:state.detailActivity.dirty || state.wordDefaultsEditing || state.reassessmentOpen || !!state.action || state.noteActivity.dirty || !!state.cueEdit,approvalUnconfirmed:state.approvalUnconfirmed};
  }
  const items = queueWindowItems(pages);
  const selected = items.find(item => item.caseId === selectedId) ?? null;
  const item = alternative?.caseId === selectedId ? alternative : selected;
  const index = items.findIndex(entry => entry.caseId === selectedId);
  const blocked = wordDefaultsEditing || busy || targetSaving || detailActivity.busy || noteActivity.busy || cueActivity.busy || approvalUnconfirmed || loadingMore;

  function mayLeaveDetails(): boolean {
    if (wordDefaultsEditing || detailActivity.busy || noteActivity.busy || cueActivity.busy || busy || approvalUnconfirmed) return false;
    return !(detailActivity.dirty || noteActivity.dirty || cueActivity.dirty) || window.confirm('Discard your unsaved edits and leave this case?');
  }
  function clearSelectionState() { setCueEdit(null);setCueActivity({dirty:false,busy:false}); setReassessmentOpen(false); setRepairTarget(null); setShowDetails(false); setMoreOpen(false); setAlternative(null); closeAction(); closeReassessment(); setNoteActivity({dirty:false,busy:false}); setConfirmSource(null); setDetail(null); setDetailActivity({ dirty: false, busy: false }); approval.current = null; setApprovalUnconfirmed(false); }
  function selectCase(id: string) {
    if (id === selectedId || !mayLeaveDetails()) return;
    clearSelectionState(); setSelectedId(id); setError(''); setNotice('');
  }
  function changeView(next: View) {
    if (next === view || !mayLeaveDetails()) return;
    if (view !== 'attention') savedQueues.current[view] = { pages, selectedId, query };
    const saved = next !== 'attention' ? savedQueues.current[next] : undefined;
    const restore = saved && (next !== 'history' || saved.query === query) ? saved : undefined;
    generation.current++;
    clearSelectionState(); setPages(restore?.pages ?? []); setSelectedId(restore?.selectedId ?? null); setLoadingMore(false); setView(next); setError(''); setNotice('');
  }
  async function refresh(initial = false) {
    const state = current.current;
    if (state.view === 'attention' || state.loadingMore || state.approvalUnconfirmed || (!initial && (!visible(pageRef.current) || state.busy || state.detailActivity.busy || state.detailActivity.dirty || state.wordDefaultsEditing || state.reassessmentOpen || !!state.action || state.noteActivity.dirty || !!state.cueEdit))) return;
    const request = ++generation.current;
    const started=refreshContext(state);
    const before = queueWindowItems(state.pages), oldIndex = before.findIndex(entry => entry.caseId === state.selectedId);
    const entries: Omit<CaseQueueWindow[number], 'page'>[] = initial || !state.pages.length ? [{ cursor: state.pages[0]?.page.anchorCursor ?? null, edge: 'first' }] : state.pages;
    try {
      const updated = await Promise.all(entries.map(async entry => ({ cursor: entry.cursor, direction: entry.direction, edge: entry.edge, page: await api.caseQueue({ direction: entry.direction, edge: entry.edge, view: state.view as 'review' | 'history' | 'deferred', limit: CASE_QUEUE_BATCH_SIZE, ...(entry.cursor ? { cursor: entry.cursor } : {}), ...(state.view === 'history' && state.query ? { search: state.query } : {}) }) })));
      if (request !== generation.current||!canInstallCaseRefresh(started,refreshContext(current.current))) return;
      const fresh = queueWindowItems(updated);
      setPages(updated.map(entry => entry.edge && !entry.cursor && entry.page.anchorCursor ? {...entry, cursor: entry.page.anchorCursor} : entry));
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
    const timer = setTimeout(() => { if (query !== search.trim()) { generation.current++;  setPages([]); setSelectedId(null); setQuery(search.trim()); } }, 300);
    return () => clearTimeout(timer);
  }, [search, view, query]);
  useEffect(() => {
    if (view === 'attention') return;
    const poll = setInterval(() => void refresh(), items.some(entry => entry.activeJob || entry.approvalState === 'pending') ? 3000 : 15000);
    const focus = () => void refresh();
    window.addEventListener('focus', focus); document.addEventListener('visibilitychange', focus);
    return () => { clearInterval(poll); window.removeEventListener('focus', focus); document.removeEventListener('visibilitychange', focus); };
  }, [api, view, query, alternative, items.some(entry => entry.activeJob || entry.approvalState === 'pending')]);
  async function navigate(direction: 'next' | 'previous') {
    if (loadingMore || view === 'attention') return;
    const adjacent = items[index + (direction === 'next' ? 1 : -1)];
    if (adjacent) { selectCase(adjacent.caseId); return; }
    if (!mayLeaveDetails()) return;
    const page = pages[0]?.page;
    if (!page) return;
    const cursor = direction === 'next' ? page.nextCursor : page.previousCursor;
    const edge = cursor ? undefined : direction === 'next' ? 'first' : 'last';
    const queryInput: VocabularyCaseQueueQuery = { view, limit: CASE_QUEUE_BATCH_SIZE, direction, ...(edge ? {edge} : {}),
      ...(cursor || page.anchorCursor ? {cursor: cursor ?? page.anchorCursor!} : {}),
      ...(view === 'history' && query ? {search: query} : {}) };
    const request = ++generation.current;
    setLoadingMore(true);
    try {
      const next = await api.caseQueue(queryInput);
      if (request !== generation.current) return;
      clearSelectionState();
      const id = (direction === 'next' ? next.items[0] : next.items.at(-1))?.caseId ?? null;
      setPages([{cursor: queryInput.cursor ?? null, direction, edge, page: next}]);
      setSelectedId(id);
    } catch (cause) { if (request === generation.current) setError(errorMessage(cause)); }
    finally { setLoadingMore(false); }
  }
  useEffect(()=>{
    if(!cueActivity.dirty)return;
    const warn=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue='';};
    window.addEventListener('beforeunload',warn);
    return()=>window.removeEventListener('beforeunload',warn);
  },[cueActivity.dirty]);
  const wasCueEditing=useRef(false);
  useEffect(()=>{
    const closed=wasCueEditing.current && !cueEdit;
    wasCueEditing.current=!!cueEdit;
    if(closed)void refresh();
  },[cueEdit]);
  useEffect(() => { closeAction(); closeReassessment(); setNoteActivity({dirty:false,busy:false}); if (!detail && document.activeElement === document.body) pageRef.current?.focus({preventScroll: true}); }, [selectedId]);
  // A resolved final card may leave an empty local page while other cases remain.
  useEffect(() => { if (!loading && !busy && view !== 'attention' && !items.length && pages[0]?.page.total) void refresh(true); }, [items.length, pages[0]?.page.total, busy, loading, loadingMore, view]);
  function installCard(card: VocabularyCaseQueueItem, advance = false) {
    generation.current++;
    if ((current.current.view === 'review' || current.current.view === 'deferred') && (current.current.view === 'deferred' ? card.state !== 'open' || !card.deferredAt : !caseCanReview(card) || !!card.deferredAt)) {
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
  function resetCue(operationKey:string) {
    if(!item?.proposal||reviewLocked||item.stale)return;
    const card=item;
    void run(async()=>{
      const edit=await loadCueEdit(api,card,operationKey);
      if(!edit.proposal||!edit.originalCue)throw new Error('No matching original model cue is retained for this item.');
      if(JSON.stringify(edit.cue)===JSON.stringify(edit.originalCue)){setNotice('This cue already matches the original model proposal.');return;}
      const fresh=await api.caseCard(card.caseId,edit.proposal.proposalId);
      if(fresh.version!==card.version||fresh.frozen||fresh.approvalState||fresh.state!=='open'||fresh.stale)throw new Error('This case changed. Review it again before resetting.');
      const saved=await api.save(edit.proposal.proposalId,edit.proposal.version,cueEditDraft(edit,edit.originalCue));
      installCard(await api.caseCard(card.caseId,saved.proposalId));
      setNotice('Original model cue restored in the draft. Ready to approve and apply.');
    });
  }
function approve(reason = '') {
    if (!item?.proposal) return; const card = item, proposal = item.proposal;
    void run(async () => {
      approval.current ??= { requestId: crypto.randomUUID(), proposalId: proposal.proposalId, version: proposal.version, notes: reason };
      const request = approval.current;
      try { await api.requestApproval(request.proposalId, request.version, request.requestId, request.notes); }
      catch (cause) { const uncertain=approvalOutcomeUncertain(cause instanceof ApiRequestError?cause.status:undefined);setApprovalUnconfirmed(uncertain);if(!uncertain)approval.current=null;throw cause; }
      setApprovalUnconfirmed(false); approval.current = null;
      // Persisted ACK is enough to advance even if the following display refresh fails.
      installCard({ ...card, approvalState: 'pending', approvalRequestId: request.requestId });
      closeAction();
    }, 'Approval queued.');
  }
  function resolve(reason = '') {
    if (!item) return; const card = item;
    void run(async () => {
      const result = card.proposal
        ? (await api.close(card.proposal.proposalId, card.proposal.version, reason), await api.caseCard(card.caseId))
        : await api.resolveCaseReview(card.caseId, card.version, reason);
      installCard(result, true); closeAction();
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
      const result = await api.reassessCaseReview(fresh.caseId, fresh.version, model, source.currentVersion, fresh.proposal ? { proposalId: fresh.proposal.proposalId, expectedVersion: fresh.proposal.version } : undefined, {instructions:editorialText.trim(),...(attachedOpinion?{secondOpinionRequestId:attachedOpinion.requestId}:{})});
      installCard(result.item); closeReassessment(); setNotice('Reassessment queued.');
    });
  }
  function secondOpinion(reason = '') {
    if (!item) return; const card = item;
    void run(async () => {
      if (card.advisoryOpinion?.status === 'failed') await api.retryJob(card.advisoryOpinion.jobId);
      else if (card.proposal) await api.requestSecondOpinion(card.proposal.proposalId, card.proposal.version, reason);
      else await api.requestCaseSecondOpinion(card.caseId, reason);
      installCard(await api.caseCard(card.caseId, card.proposal?.proposalId)); closeAction();
    }, 'Second opinion queued.');
  }
  function openDetails(edit = false) {
    if (!item || blocked || !mayLeaveDetails()) return;
    setNoteActivity({dirty:false,busy:false});
    setCueEdit(null);setCueActivity({dirty:false,busy:false});
    setDetail({ caseId: item.caseId, ...(item.proposal ? { proposalId: item.proposal.proposalId } : {}), edit });
  }
  async function detailsChanged(caseId: string|null,savedProposalId?:string) {
    if (!caseId) throw new Error('Compact case review requires a case identity.');
    const card = await api.caseCard(caseId); installCard(card, true);
    const open=current.current.detail;
    if(open?.caseId!==caseId||!caseCanReview(card))return;
    const proposalId=savedProposalId??open.proposalId;
    if(savedProposalId&&savedProposalId!==open.proposalId)setDetail({...open,proposalId:savedProposalId});
    if(proposalId&&proposalId!==card.currentProposalId)setAlternative(await api.caseCard(caseId,proposalId));
  }
  const reviewLocked = noteActivity.dirty || !item || item.state === 'resolved' || item.frozen || item.approvalState === 'pending' || blocked || !!cueEdit;
  const repairBlocked=item?.kind==='exercise_improvement'&&view!=='history'&&repairTargetBlocksMutation(item.caseId,repairTarget);
  const proposalResolved = item?.proposal && ['applied', 'closed'].includes(item.proposal.status);
  return <section ref={pageRef} className="vocabulary-operator-page vocabulary-case-review-page" aria-label="Content improvement" tabIndex={0} onKeyDown={event => {
    if (detail || view === 'attention') return;
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (shortcutEventBlocked(event.nativeEvent) || event.shiftKey || blocked || target?.closest('input,textarea,select,[role="slider"],[role="listbox"],[role="combobox"],[contenteditable="true"]')) return;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); void navigate(event.key === 'ArrowLeft' ? 'previous' : 'next'); }
  }}>
    <header><h2>Content improvement</h2></header>
    <div className="vocabulary-review-toolbar">    <nav className="vocabulary-operator-tabs" aria-label="Review queues">{([['review', 'Awaiting review'], ['attention', 'Needs attention'], ['deferred', 'Deferred'], ['history', 'Archive']] as const).map(([value, label]) => <button key={value} aria-pressed={view === value} disabled={blocked} onClick={() => changeView(value)}>{label}</button>)}</nav>{item && view !== 'attention' && <>        <nav className="vocabulary-case-navigation" aria-label="Case navigation">
          <button className="secondary-button" aria-label="Previous case" aria-keyshortcuts="ArrowLeft" disabled={blocked || pages[0]?.page.total === 1} onClick={() => void navigate('previous')}>←</button>
          <span aria-live="polite">{(pages[0]?.page.startIndex ?? 0) + index + 1} / {pages[0]?.page.total ?? items.length}</span>
          <button className="secondary-button" aria-label="Next case" aria-keyshortcuts="ArrowRight" disabled={blocked || pages[0]?.page.total === 1} onClick={() => void navigate('next')}>→</button>
        </nav>
</>}</div>
    {error && <p role="alert" className="vocabulary-operator-error">{error}</p>}{notice && <p role="status">{notice}</p>}
    {view === 'attention' ? <VocabularyAttentionPage api={api} position={attentionPosition} onActivity={setDetailActivity} /> : <>
      {view === 'history' && <form onSubmit={event => event.preventDefault()}><label>Search archive<input type="search" value={search} disabled={!!detail} onChange={event => setSearch(event.target.value)} /></label>{!query && <p className="vocabulary-operator-meta">Last 12 hours</p>}</form>}
      {loading && <p role="status">Loading cases…</p>}
      {!loading && items.length === 0 && <p role="status">{view === 'history' ? query ? 'No matching archived cases.' : 'No resolutions in the last 12 hours.' : view === 'deferred' ? 'No deferred cases.' : 'No cases awaiting review.'}</p>}
      {item && <>
        {detail ? <>
          <button className="secondary-button" disabled={detailActivity.busy || busy} onClick={() => { if (mayLeaveDetails()) { setDetail(null); setDetailActivity({ dirty: false, busy: false }); void refresh(); } }}>Back to case</button>
          <VocabularyOperatorPage key={`${detail.caseId}:${detail.proposalId ?? ''}`} api={api} detailOnly={{ ...detail, history: view === 'history', liveReview: item?.caseId === detail.caseId ? item : null, onChanged: detailsChanged, onSelectProposal: proposalId => void run(async () => { const projection = await api.caseCard(detail.caseId, proposalId); setAlternative(projection); setDetailActivity({ dirty: false, busy: false }); setDetail({ ...detail, proposalId, edit: false }); }) }} onActivity={setDetailActivity} />
        </> : <div className="vocabulary-case-frame"><div key={item.caseId} className="vocabulary-case-scroll" tabIndex={0} aria-label="Case content"><CaseReviewCard key={item.caseId} item={item} editCue={view !== 'history' && item.kind === 'exercise_improvement' && !proposalResolved ? key => cueEdit?.operationKey === key ? <QuickCueEditor key={key ?? 'source'} api={api} item={item} operationKey={key} onActivity={setCueActivity} onCancel={()=>{setCueEdit(null);setCueActivity({dirty:false,busy:false});}} onSaved={card=>{setCueEdit(null);setCueActivity({dirty:false,busy:false});installCard(card);setNotice('Proposal saved. Ready to approve and apply.');}} /> : <><button className="secondary-button vocabulary-edit-cue" disabled={reviewLocked || item.stale || !!repairBlocked} onClick={()=>{setCueEdit({operationKey:key});setNotice('');}}>Edit cue</button>{key!==null&&item.proposal?.authorKind==='service'&&item.proposal.version>1&&<button className="secondary-button" disabled={reviewLocked || item.stale || !!repairBlocked} onClick={()=>resetCue(key)}>Reset to original</button>}</> : undefined} onReassessOpinion={()=>openReassessment(item.advisoryOpinion)} reassessmentDisabled={reviewLocked} showDetails={showDetails} onDetails={() => openDetails()} wordDefaults={view === 'review' && item.wordId && item.assessment?.outcome === 'repertoire_bootstrap' && <ScopeCoverageEditor key={item.caseId} api={api} wordId={item.wordId} disabled={!!cueEdit || busy || targetSaving || approvalUnconfirmed || item.frozen || item.state !== 'open' || item.approvalState === 'pending'} onActivity={setWordDefaultsEditing} onSaved={() => { void run(async () => { installCard(await api.caseCard(item.caseId, item.proposal?.proposalId)); }, 'Word defaults saved.'); }} repertoire={item.proposal && !proposalResolved ? {proposal:item.proposal,reassessment:item.reassessment.eligible&&item.reassessment.source?{caseVersion:item.version,source:item.reassessment.source,onQueued:card=>{installCard(card);setNotice('Selection saved. Reassessment queued.');}}:undefined,onSaved:proposal => { void run(async () => { installCard(await api.caseCard(item.caseId, proposal.proposalId)); }, 'Defaults and proposal updated.'); }} : undefined} />}>
          {item.alternativeCount > 0 && <label>Proposal<select disabled={blocked || !!cueEdit} value={item.proposal?.proposalId ?? ''} onChange={event => { const id = event.target.value; void run(async () => setAlternative(await api.caseCard(item.caseId, id || undefined))); }}><option value={item.currentProposalId ?? ''}>Current proposal</option>{item.alternatives.filter(proposal => proposal.proposalId !== item.currentProposalId).map(proposal => <option key={proposal.proposalId} value={proposal.proposalId}>{proposal.rationale || proposal.proposalId} · revision {proposal.version} · {proposal.status}</option>)}</select></label>}
          {item.alternativeCount > item.alternatives.length && <button className="secondary-button" onClick={() => openDetails()}>All retained proposals</button>}
        </CaseReviewCard><CaseNotes key={item.caseId} item={item} api={api} disabled={!!cueEdit||busy||wordDefaultsEditing||approvalUnconfirmed||item.frozen||item.approvalState==='pending'} onSaved={card=>installCard(card)} onActivity={setNoteActivity}/></div>
          {(view === 'review' || view === 'deferred') && <div className="vocabulary-case-action-frame" aria-label="Case review actions">
            <div className="vocabulary-operator-actions">
              {item.proposal && !proposalResolved && <button disabled={reviewLocked && !approvalUnconfirmed || busy || item.stale || item.requiresDetails || repairBlocked} onClick={()=>{if(approvalUnconfirmed||mayLeaveDetails())approve();}}>{approvalUnconfirmed ? 'Retry approval' : 'Approve and apply'}</button>}
              {!proposalResolved && <button className="secondary-button" disabled={reviewLocked || (!item.proposal && !item.currentAssessment && !item.needsDecision)} onClick={()=>{if(mayLeaveDetails())resolve();}}>{item.proposal ? 'Dismiss proposal' : 'Done'}</button>}
              {item.reassessment.eligible && <button className="secondary-button" disabled={reviewLocked || !!item.activeJob} aria-haspopup="dialog" onClick={() => openReassessment()}>Reassess{repairTarget?.blocked?' · target pending':''}</button>}
              <button className="secondary-button" disabled={reviewLocked || !!item.activeJob} onClick={()=>void run(async()=>{const card=await api.setCaseDeferred(item.caseId,item.version,!item.deferredAt);savedQueues.current={};installCard(card,true);},item.deferredAt?'Returned to review.':'Case deferred.')}>{item.deferredAt?'Return to review':'Defer'}</button>
              <span className="vocabulary-action-spacer" /><button className="secondary-button" aria-expanded={showDetails} onClick={() => setShowDetails(value => !value)}>Details</button><button className="secondary-button" aria-expanded={moreOpen} onClick={() => setMoreOpen(value => !value)}>More</button>
            </div>
            {moreOpen && <div className="vocabulary-more-actions">
              {!proposalResolved&&<button className="secondary-button" disabled={reviewLocked} onClick={()=>openAction('resolve')}>{item.proposal?'Dismiss with reason…':'Done with note…'}</button>}
              {item.proposal&&!proposalResolved&&<button className="secondary-button" disabled={reviewLocked||item.stale||item.requiresDetails||repairBlocked} onClick={()=>openAction('approve')}>Approve with note…</button>}
              {item.proposal && !proposalResolved && <button className="secondary-button" disabled={reviewLocked || repairBlocked} onClick={() => openDetails(true)}>Edit proposal</button>}
              {item.kind === 'exercise_improvement' && (item.proposal || item.currentAssessment) && (!item.advisoryOpinion || item.advisoryOpinion.status === 'failed') && <button className="secondary-button" disabled={reviewLocked || !!item.activeJob || item.stale || !!proposalResolved} onClick={()=>item.advisoryOpinion?.status==='failed'?secondOpinion():openAction('opinion')}>{item.advisoryOpinion?.status === 'failed' ? 'Retry second opinion' : 'Second opinion'}</button>}
              {canRetryLatestCaseJob(item) && !item.latestJob?.advisory && <button className="secondary-button" disabled={reviewLocked} onClick={() => void run(async () => { await api.retryJob(item.latestJob!.jobId); installCard(await api.caseCard(item.caseId)); }, 'Assessment queued.')}>Retry assessment {item.latestJob?.sequence}</button>}

            </div>}
            <ReassessmentDialog open={reassessmentOpen} onClose={closeReassessment} busy={busy||targetSaving}>
              {error&&<p role="alert">{error}</p>}
            {item.kind==='exercise_improvement'&&item.wordId&&<RepairTargetEditor key={item.caseId} api={api} caseId={item.caseId} revision={item.version} disabled={reviewLocked} onState={setRepairTarget} onActivity={setTargetSaving} onSaved={async()=>{installCard(await api.caseCard(item.caseId,item.proposal?.proposalId));}}/>}
            {item.reassessment.eligible && <div className="vocabulary-reassessment-control"><label>Model for reassessment<select value={model} disabled={reviewLocked || !!item.activeJob} onChange={event => setModel(event.target.value as VocabularyReassessmentModel)}><option value="openai:gpt-6-sol-high">GPT-6 Sol high</option><option value="openai:gpt-6-luna-high">Luna high</option><option value="zai:glm-5.3-flash-high">GLM-5.3 Flash high</option></select></label><label>Editorial direction (optional)<textarea value={editorialText} maxLength={10000} disabled={reviewLocked} onChange={event=>setEditorialText(event.target.value)}/></label>
              {attachedOpinion?.result&&<section aria-label="Attached second opinion"><div className="vocabulary-operator-actions"><strong>Second opinion · {attachedOpinion.sequence}</strong><button type="button" className="secondary-button" disabled={reviewLocked} onClick={()=>setAttachedOpinion(null)}>Remove opinion</button></div><details><summary>{{support:'Supports this judgment',revise:'Suggests revision',reject:'Recommends against this judgment'}[attachedOpinion.result.verdict]}</summary><p>{attachedOpinion.result.rationale}</p></details></section>}
              <button disabled={reviewLocked || !!item.activeJob} onClick={() => reassess()}>Submit reassessment</button>{confirmSource?.caseId === item.caseId && <div className="vocabulary-reassessment-confirmation"><p>Source changed from v{item.reassessment.source?.assessedVersion} to v{confirmSource.version}. Reassessment uses the current version.</p><button disabled={reviewLocked} onClick={() => reassess(confirmSource.version)}>Reassess current version</button><button className="secondary-button" onClick={() => setConfirmSource(null)}>Cancel</button></div>}</div>}
            </ReassessmentDialog>
            <ReassessmentDialog open={action!==null} onClose={closeAction} busy={busy||approvalUnconfirmed} title={action==='approve'?'Approve with note':action==='resolve'?(item.proposal?'Dismiss with reason':'Done with note'):'Second opinion'}>
              <form onSubmit={event=>{event.preventDefault();if(action==='approve')approve(actionText);else if(action==='resolve')resolve(actionText);else if(action==='opinion')secondOpinion(actionText);}}>
                <label>{action==='opinion'?'Question (optional)':'Note (optional)'}<textarea autoFocus value={actionText} maxLength={10000} disabled={busy||approvalUnconfirmed} onChange={event=>setActionText(event.target.value)}/></label>
                {error&&<p role="alert">{error}</p>}
                <button disabled={busy||reviewLocked&&!approvalUnconfirmed||action==='approve'&&(item.stale||item.requiresDetails||repairBlocked)}>{action==='approve'?(approvalUnconfirmed?'Retry approval':'Approve and apply'):action==='resolve'?(item.proposal?'Dismiss proposal':'Mark done'):'Request second opinion'}</button>
              </form>
            </ReassessmentDialog>
          </div>}
          {view === 'history' && <div className="vocabulary-case-action-frame"><button className="secondary-button" aria-expanded={showDetails} onClick={() => setShowDetails(value => !value)}>Details</button></div>}
        </div>}
      </>}
      {loadingMore && <p role="status">Loading cases…</p>}
    </>}
  </section>;
}
