import { useEffect,useRef,useState,type ReactNode } from 'react';
import type { VocabularyContent,VocabularyContentDraft,VocabularyJson } from '../domain/vocabulary-content';
import type { VocabularyContentProposal,VocabularyProposalDraft,VocabularyProposalOperation,VocabularyReflectionCase } from '../domain/vocabulary-reflection';
import { getEffectiveVocabularyEncounterReactions } from '../domain/vocabulary-session';
import { vocabularyOperatorApi,type VocabularyOperatorApi,type VocabularyCaseWorkspace,type VocabularyFailedDispatch,type VocabularyFailedPreparation,type VocabularyProposalPreview,type VocabularyReassessmentModel,type VocabularyReviewSnapshot } from '../features/vocabulary-operator/api';
import { ApiRequestError } from '../services/api';
import './VocabularyOperatorPage.css';
import { CardInbox } from '../components/CardInbox';
import { OperatorPrefetchCache } from '../features/vocabulary-operator/prefetch-cache';
import { filterArchiveItems, resolveReviewNavigation, reviewItemKey } from '../features/vocabulary-operator/review-navigation';
import { ProposalSecondOpinion } from '../features/vocabulary-operator/ProposalSecondOpinion';
import { ContentImprovementEntry, proposalServedEvidence, ReadableJson } from '../features/vocabulary-operator/content-improvement-entry';

type ReviewItem = {kind:'proposal';value:VocabularyContentProposal} | {kind:'case';value:VocabularyReflectionCase};
type ReviewSnapshot = VocabularyReviewSnapshot;
const snapshotKey = (proposal: VocabularyContentProposal) => `${proposal.proposalId}:${proposal.version}:${proposal.status}`;

const brief=(text:string)=>text.match(/^.*?[.!?](?:\s|$)/)?.[0].trim()??text;
const proposalSummary=(proposal:VocabularyContentProposal)=>brief(proposal.rationale);
function diagnosisSummary(value:VocabularyJson|undefined):string {
  if(typeof value==='string')return brief(value);
  if(value&&typeof value==='object'&&!Array.isArray(value)){for(const key of ['assessment','diagnosis','rationale'])if(typeof value[key]==='string')return brief(value[key]);}
  return 'No authored change was proposed.';
}
const proposalTitle=(proposal:VocabularyContentProposal)=>Array.from(new Set(proposal.operations.flatMap(operation=>operation.content.kind==='exercise'?operation.content.answers.map(answer=>answer.acceptedForms[0]).filter(Boolean):[]))).join(' · ')||'Teaching content';
const kinds={exercise_improvement:'Exercise issues',teaching_review:'Teaching inbox',learner_feedback:'Feedback cases'} as const;
const labels={create:'Add another item',update_existing:'Update existing item',replace:'Replace with new item'} as const;
const admissionLabels={single_sense:'Intended sense identified',laundry_list:'Multiple senses: fresh repertoire',unmappable:'Intended sense could not be established',inventory_gap:'Possible gap in the sense inventory'} as const;
const pretty=(value:unknown)=>JSON.stringify(value,null,2);
const message=(error:unknown)=>error instanceof Error?error.message:'The request could not finish. Refresh and try again.';
function draftOf(value:VocabularyContentProposal):VocabularyProposalDraft{return {caseId:value.caseId??undefined,operations:value.operations,rationale:value.rationale,bases:value.bases};}
function authored(value:VocabularyContent):VocabularyContentDraft {
  const {version:_version,createdAt:_created,updatedAt:_updated,...draft}=value;return draft;
}
function contentDetailsChanged(source:VocabularyContent|null,result:VocabularyContentDraft) {
  const details=(content:VocabularyContentDraft)=>{
    const body=content.body!==null&&typeof content.body==='object'&&!Array.isArray(content.body)?content.body:{};
    const {prompt:_prompt,...rest}=body;
    return pretty({assessment:content.kind==='exercise'?content.assessment:null,body:rest});
  };
  return source!==null&&details(source)!==details(result);
}
function AuthoredContent({content,expandDetails=false}:{content:VocabularyContentDraft;expandDetails?:boolean}) {
  const body=content.body!==null&&typeof content.body==='object'&&!Array.isArray(content.body)?content.body:{};
  const {prompt:_prompt,reveal,...other}=body;
  const criteria=content.kind==='exercise'&&pretty(content.assessment)!==pretty({match:'prepared_answer_membership'})?content.assessment:null;
  const hasDetails=criteria!==null||reveal!==undefined||Object.keys(other).length>0;
  return <div className="vocabulary-authored">{typeof body.prompt==='string'?<p className="vocabulary-operator-cue">{body.prompt}</p>:<ReadableJson value={content.body}/>}
    {content.kind==='exercise'&&<div className="vocabulary-operator-answers"><strong>Expected answers</strong><p>{content.answers.map(answer=>answer.acceptedForms.join(' / ')).join(' · ')}</p>
      {hasDetails&&expandDetails&&<div className="vocabulary-authored-details">{criteria!==null&&<ReadableJson value={criteria}/>}{reveal!==undefined&&<ReadableJson value={reveal}/>}{Object.keys(other).length>0&&<ReadableJson value={other}/>}</div>}</div>}
  </div>;
}
function editableDraft(value:unknown):value is VocabularyProposalDraft {
  if(!value||typeof value!=='object')return false;const item=value as Record<string,unknown>;
  return typeof item.rationale==='string'&&Array.isArray(item.operations)&&item.operations.every(value=>{
    if(!value||typeof value!=='object')return false;const operation=value as Record<string,unknown>;
    if(typeof operation.operationKey!=='string'||typeof operation.rationale!=='string'||!['create','update_existing','replace'].includes(String(operation.strategy)))return false;
    const scope=operation.scope as Record<string,unknown>|undefined,content=operation.content as Record<string,unknown>|undefined;
    if(!scope||!['shared','learner'].includes(String(scope.kind))||!content||!['exercise','introduction'].includes(String(content.kind))||!('body' in content))return false;
    return content.kind==='introduction'||(Array.isArray(content.answers)&&content.answers.every(value=>!!value&&typeof value==='object'&&Array.isArray((value as Record<string,unknown>).acceptedForms)&&((value as Record<string,unknown>).acceptedForms as unknown[]).every(form=>typeof form==='string')));
  });
}
function Scope({operation}:{operation:VocabularyProposalOperation}) {return <p className="vocabulary-scope">{operation.scope.kind==='shared'?'Shared content':`Private content: learner ${operation.scope.learnerId}`}</p>;}

/** Operator surface: private evidence, authored drafts, exact review, then explicit application. */
export function VocabularyOperatorPage({api=vocabularyOperatorApi,previewOnly=false,proposalContext}:{api?:VocabularyOperatorApi;previewOnly?:boolean;proposalContext?:(proposal:VocabularyContentProposal)=>ReactNode}) {
  const [queue,setQueue]=useState<'review'|'attention'|'history'>('review');
  const [editing,setEditing]=useState(false);
  const [detailsOpen,setDetailsOpen]=useState(false);
  const [archiveSearch,setArchiveSearch]=useState('');
  const pageRef=useRef<HTMLElement>(null);
  const cursors=useRef<Partial<Record<'review'|'history',string>>>({});
  const queueRequest=useRef(0);
  const interacting=useRef(false);
  const initialSelection=useRef(false);
  const [kind,setKind]=useState<VocabularyReflectionCase['kind']>('exercise_improvement');
  const [closedNoProposalCases,setClosedNoProposalCases]=useState<VocabularyReflectionCase[]>([]);
  const [noProposalCases,setNoProposalCases]=useState<VocabularyReflectionCase[]>([]);
  const [caseNotes,setCaseNotes]=useState('');
  const [reassessmentModel,setReassessmentModel]=useState<VocabularyReassessmentModel>('openai:gpt-6-sol-high');
  const [cases,setCases]=useState<VocabularyReflectionCase[]>([]),[proposals,setProposals]=useState<VocabularyContentProposal[]>([]),[dispatches,setDispatches]=useState<VocabularyFailedDispatch[]>([]);
  const [preparationFailures,setPreparationFailures]=useState<VocabularyFailedPreparation[]>([]);
  const [reviewCase,setReviewCase]=useState<VocabularyReflectionCase|null>(null);
  const [reviewReassessment,setReviewReassessment]=useState<VocabularyReviewSnapshot['reassessment']>(null);
  const [workspaceLoading,setWorkspaceLoading]=useState(false);
  const workspaceRequest=useRef<{caseId:string;token:number}|null>(null);
  const workspaceSerial=useRef(0);
  const [workspace,setWorkspace]=useState<VocabularyCaseWorkspace|null>(null),[selected,setSelected]=useState<VocabularyContentProposal|null>(null);
  const [draftText,setDraftText]=useState(''),[savedText,setSavedText]=useState('');
  const [display,setDisplay]=useState<ReviewSnapshot['previews']|null>(null);
  const [preview,setPreview]=useState<VocabularyProposalPreview|null>(null),[review,setReview]=useState<{reviewId:string;version:number}|null>(null);
  const [reviewNote,setReviewNote]=useState(''),[reason,setReason]=useState('');
  const cache=useRef(new OperatorPrefetchCache<ReviewSnapshot>());
  const prefetchChain=useRef<Promise<void>>(Promise.resolve());
  const [snapshotOutdated,setSnapshotOutdated]=useState(false);
  const [nextLoad,setNextLoad]=useState<ReviewItem|null>(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [refreshError,setRefreshError]=useState('');
  const [receipt,setReceipt]=useState<string|null>(null);const selectedRequest=useRef(0),applicationKey=useRef('');
  const dirty=draftText!==savedText;
  interacting.current=busy||dirty;
  const promotionNeedsAttention=workspace?.pureCuePromotion?.outcome==='needs_operator';
  const admissionNeedsAttention=workspace?.admission?.outcome==='unmappable'||workspace?.admission?.outcome==='inventory_gap';
  let draft:VocabularyProposalDraft|null=null;try{const value:unknown=JSON.parse(draftText);if(editableDraft(value))draft=value;}catch{/* Keep invalid editing text intact. */}
  const editable=selected===null||!['applied','closed'].includes(selected.status);
  async function loadCases(){return {items:(await Promise.all(Object.keys(kinds).map(value=>api.cases(value as VocabularyReflectionCase['kind'])))).flatMap(result=>result.items)};}
  async function reload(){const request=++queueRequest.current;const [caseList,proposalList,dispatchList,preparationList,noProposalList,closedList]=await Promise.all([loadCases(),api.proposals(),api.dispatches(),api.preparationFailures(),api.noProposalCases(),api.noProposalCases('closed')]);if(request!==queueRequest.current)return proposalList.items;setClosedNoProposalCases(closedList.items);setNoProposalCases(noProposalList.items);setCases(caseList.items);setProposals(proposalList.items);setDispatches(dispatchList.items);setPreparationFailures(preparationList.items);return proposalList.items;}
  useEffect(()=>{
    let active=true;
    let timer:ReturnType<typeof setTimeout>;
    async function refresh(initial=false){
      try {
        if(!initial&&(interacting.current||document.visibilityState==='hidden'||pageRef.current?.closest('[hidden]')))return;
        const request=++queueRequest.current;
        const [a,b,c,d,e,f]=await Promise.all([loadCases(),api.proposals(),api.dispatches(),api.preparationFailures(),api.noProposalCases(),api.noProposalCases('closed')]);
        if(active&&request===queueRequest.current){setCases(a.items);setProposals(b.items);setDispatches(c.items);setPreparationFailures(d.items);setNoProposalCases(e.items);setClosedNoProposalCases(f.items);setRefreshError('');}
      }catch(cause){if(active)setRefreshError(message(cause));}
      finally{if(active){clearTimeout(timer);timer=setTimeout(()=>void refresh(),15000);}}
    }
    const onFocus=()=>{clearTimeout(timer);void refresh();};
    void refresh(true);
    window.addEventListener('focus',onFocus);
    document.addEventListener('visibilitychange',onFocus);
    return()=>{active=false;queueRequest.current++;selectedRequest.current++;clearTimeout(timer);window.removeEventListener('focus',onFocus);document.removeEventListener('visibilitychange',onFocus);};
  },[api]);
  async function run(work:()=>Promise<void>,success?:string){selectedRequest.current++;setBusy(true);setError('');setNotice('');try{await work();if(success)setNotice(success);}catch(cause){setError(message(cause));}finally{setBusy(false);}}
  function maySwitch(){return !dirty||window.confirm('Discard your unsaved draft edits and open another item?');}
  function resetReview(){setPreview(null);setReview(null);setReceipt(null);applicationKey.current='';}
  function install(value:VocabularyContentProposal){setSnapshotOutdated(false);setSelected(value);setEditing(false);const text=pretty(draftOf(value));setDraftText(text);setSavedText(text);setReviewNote('');setReason('');setDetailsOpen(false);resetReview();}
  function changeDraft(next:VocabularyProposalDraft){setDraftText(pretty(next));resetReview();}
  async function loadCase(id:string){workspaceSerial.current++;workspaceRequest.current=null;setWorkspaceLoading(false);setReviewCase(null);setDisplay(null);const request=++selectedRequest.current;const value=await api.workspace(id);if(request!==selectedRequest.current)return;setWorkspace(value);setSelected(null);setDraftText('');setSavedText('');setReason('');setCaseNotes('');setEditing(false);setDetailsOpen(false);resetReview();}
  function openCase(id:string){if(!maySwitch())return;void run(()=>loadCase(id));}
  async function fetchSnapshot(value:VocabularyContentProposal):Promise<ReviewSnapshot>{
    if(['applied','closed'].includes(value.status)){
      const [proposal,workspace]=await Promise.all([api.proposal(value.proposalId),value.caseId?api.workspace(value.caseId):Promise.resolve(null)]);
      return {proposal,case:workspace?.case??null,reassessment:null,previews:[]};
    }
    const batch=await api.reviewBatch(value.proposalId,1);
    const item=batch.items.find(entry=>entry.proposal.proposalId===value.proposalId);
    if(!item)throw new Error('This proposal is no longer open. Refresh the queue.');
    return item;
  }
  async function loadProposal(value:VocabularyContentProposal){
    workspaceSerial.current++;workspaceRequest.current=null;setWorkspaceLoading(false);
    const request=++selectedRequest.current;
    const snapshot=cache.current.get(snapshotKey(value))??await fetchSnapshot(value);
    if(request!==selectedRequest.current)return;
    cache.current.set(snapshotKey(snapshot.proposal),snapshot);
    setWorkspace(null);setReviewCase(snapshot.case);setReviewReassessment(snapshot.reassessment);install(snapshot.proposal);setDisplay(snapshot.previews);
    setSnapshotOutdated(!['applied','closed'].includes(snapshot.proposal.status)&&snapshot.proposal.operations.some(operation=>operation.strategy!=='create'&&snapshot.previews.find(item=>item.operationKey===operation.operationKey)?.source?.version!==operation.expectedVersion));
  }
  async function loadWorkspaceForProposal(value:VocabularyContentProposal){
    if(!value.caseId||workspace?.case.caseId===value.caseId||workspaceRequest.current?.caseId===value.caseId)return;
    const request=selectedRequest.current,token=++workspaceSerial.current;
    workspaceRequest.current={caseId:value.caseId,token};setWorkspaceLoading(true);
    try{const result=await api.workspace(value.caseId);if(request===selectedRequest.current&&token===workspaceSerial.current)setWorkspace(result);}
    catch(cause){if(request===selectedRequest.current&&token===workspaceSerial.current)setError(message(cause));}
    finally{if(token===workspaceSerial.current){workspaceRequest.current=null;setWorkspaceLoading(false);}}
  }
  function openProposal(value:VocabularyContentProposal){if(!maySwitch())return;void run(()=>loadProposal(value));}
  function startDraft(source:VocabularyContent){if(!maySwitch())return;if(queue==='history')cursors.current.history=selected?`proposal:${selected.proposalId}`:workspace?`case:${workspace.case.caseId}`:undefined;setQueue('review');initialSelection.current=true;setDisplay(null);setDetailsOpen(false);const next:VocabularyProposalDraft={caseId:workspace?.case.caseId,
    rationale:'',operations:[{operationKey:'repair-1',scope:source.accessScope==='shared'?{kind:'shared'}:{kind:'learner',learnerId:source.ownerLearnerId!},
      strategy:'update_existing',sourceContentId:source.contentId,expectedVersion:source.version,rationale:'',content:authored(source)}]};setSelected(null);setEditing(true);setSavedText('');changeDraft(next);setNotice('');}
  function strategy(index:number,next:VocabularyProposalOperation['strategy']) {
    if(!draft)return;const operation=draft.operations[index];if(!operation)return;
    const base=operation.strategy==='create'?draft.bases?.[index]??draft.bases?.[0]:{contentId:operation.sourceContentId,expectedVersion:operation.expectedVersion};
    const source=workspace?.sources.find(source=>source.contentId===(base?.contentId??operation.content.contentId))??workspace?.sources.find(source=>source.kind===operation.content.kind);
    if(next!=='create'&&!base&&!source){setError('Open the source case to select an existing content identity.');return;}
    const sourceId=base?.contentId??source?.contentId??operation.content.contentId??'',sourceVersion=base?.expectedVersion??source?.version??1;
    const content={...operation.content,contentId:next==='update_existing'?sourceId:operation.content.contentId===sourceId?crypto.randomUUID():operation.content.contentId??crypto.randomUUID(),
      ...(next==='update_existing'&&source?{originKind:source.originKind,authorKind:source.authorKind,authorId:source.authorId,accessScope:source.accessScope,ownerLearnerId:source.ownerLearnerId}:{})};
    const common={operationKey:operation.operationKey,scope:operation.scope,rationale:operation.rationale,content};
    const changed:VocabularyProposalOperation=next==='create'?{...common,strategy:'create'}:{...common,strategy:next,sourceContentId:sourceId,expectedVersion:sourceVersion};
    changeDraft({...draft,bases:base?draft.bases??[base]:draft.bases,operations:draft.operations.map((old,i)=>i===index?changed:old)});
  }
  function save(){void run(async()=>{if(!draft)throw new Error('Fix the JSON draft before saving.');const value=selected?await api.save(selected.proposalId,selected.version,draft):await api.create(draft);await loadProposal(value);await reload();},'New version saved.');}
  function invalidateOnConflict(cause:unknown,value:VocabularyContentProposal){if(cause instanceof ApiRequestError&&cause.status===409){cache.current.delete(snapshotKey(value));setSnapshotOutdated(true);}throw cause;}
  function inspect(){if(!selected||dirty)return;void run(async()=>{try{setPreview(await api.preview(selected.proposalId,selected.version));}catch(cause){invalidateOnConflict(cause,selected);}setReview(null);},'Preview validated. Review the cue, expected answers, scope and identity effects.');}
  async function advanceAfterResolution(proposalId:string,status:'applied'|'closed') {
    const oldIndex=reviewItems.findIndex(item=>item.kind==='proposal'&&item.value.proposalId===proposalId);
    const remaining=reviewItems.filter(item=>item.kind!=='proposal'||item.value.proposalId!==proposalId);
    setProposals(items=>items.map(item=>item.proposalId===proposalId?{...item,status}:item));
    const next=remaining[Math.min(Math.max(oldIndex,0),remaining.length-1)];
    try {
      if(next){if(next.kind==='proposal')await loadProposal(next.value);else await loadCase(next.value.caseId);}
      else {initialSelection.current=false;setWorkspace(null);setSelected(null);setDraftText('');setSavedText('');resetReview();}
    } catch(cause) { setNextLoad(next??null);setError(`The action succeeded, but the next item could not load: ${message(cause)}`); }
    finally { void reload().catch(cause=>setRefreshError(message(cause))); }
  }
  function approveAndApply(){if(!selected||dirty)return;void run(async()=>{
    let approval=review?.version===selected.version?review:null;
    if(!approval){try{approval={...await api.approve(selected.proposalId,selected.version,reviewNote),version:selected.version};}catch(cause){invalidateOnConflict(cause,selected);throw cause;}}
    setReview(approval);setSelected({...selected,status:'approved'});applicationKey.current||=crypto.randomUUID();
    let result;try{result=await api.apply(selected.proposalId,selected.version,approval.reviewId,applicationKey.current);}catch(cause){invalidateOnConflict(cause,selected);throw cause;}
    setReceipt(result.applicationId);setSelected({...selected,status:'applied'});await advanceAfterResolution(selected.proposalId,'applied');
  },'Applied.');}
  function dismissProposal(){if(!selected)return;void run(async()=>{await api.close(selected.proposalId,selected.version,reason);setSelected({...selected,status:'closed'});if(queue==='review')await advanceAfterResolution(selected.proposalId,'closed');else{install(await api.proposal(selected.proposalId));await reload();}},'Dismissed.');}
  const pending=proposals.filter(item=>!['applied','closed'].includes(item.status));
  const history=proposals.filter(item=>['applied','closed'].includes(item.status));
  const reviewItems=[...pending.map(value=>({kind:'proposal' as const,value})),...noProposalCases.map(value=>({kind:'case' as const,value}))];
  const allHistoryItems=[...history.map(value=>({kind:'proposal' as const,value})),...closedNoProposalCases.map(value=>({kind:'case' as const,value}))];
  const historyItems=filterArchiveItems(allHistoryItems,archiveSearch);
  const visibleCases=cases.filter(item=>item.kind===kind);
  useEffect(()=>{if(queue==='review'&&!initialSelection.current&&reviewItems.length){initialSelection.current=true;const first=reviewItems[0];if(first.kind==='proposal')openProposal(first.value);else openCase(first.value.caseId);}},[proposals,noProposalCases]);
  useEffect(()=>{if(busy||dirty||!workspace||selected||!workspace.jobs.some(job=>job.secondOpinion&&['queued','running'].includes(job.status)))return;let active=true;const timer=setTimeout(()=>{void api.workspace(workspace.case.caseId).then(value=>{if(active)setWorkspace(value);}).catch(cause=>{if(active)setError(message(cause));});},3000);return()=>{active=false;clearTimeout(timer);};},[api,workspace,selected,busy,dirty]);
  useEffect(()=>{if(!workspace?.reassessment||!['queued','running'].includes(workspace.reassessment.status)||busy||dirty)return;let active=true;const caseId=workspace.case.caseId;const timer=setTimeout(()=>{void api.workspace(caseId).then(async value=>{if(!active)return;setWorkspace(value);if(!value.reassessment||!['queued','running'].includes(value.reassessment.status))await reload();}).catch(cause=>{if(active)setError(message(cause));});},3000);return()=>{active=false;clearTimeout(timer);};},[api,workspace,busy,dirty]);
  useEffect(()=>{if(!selected||!reviewReassessment?.latest||!['queued','running'].includes(reviewReassessment.latest.status)||busy||dirty)return;let active=true;const value=selected;const timer=setTimeout(()=>{void api.reviewBatch(value.proposalId,1).then(async batch=>{if(!active)return;const snapshot=batch.items.find(item=>item.proposal.proposalId===value.proposalId);if(!snapshot)return;cache.current.set(snapshotKey(snapshot.proposal),snapshot);setReviewReassessment(snapshot.reassessment);if(!snapshot.reassessment?.latest||!['queued','running'].includes(snapshot.reassessment.latest.status))await reload();}).catch(cause=>{if(active)setError(message(cause));});},3000);return()=>{active=false;clearTimeout(timer);};},[api,selected,reviewReassessment,busy,dirty]);
  function selectItem(item:(typeof reviewItems)[number]){setNextLoad(null);if(item.kind==='proposal')openProposal(item.value);else openCase(item.value.caseId);}
  function switchQueue(next:typeof queue){
    if(busy||next===queue||!maySwitch())return;
    if(queue!=='attention'){
      const key=selected?`proposal:${selected.proposalId}`:workspace?`case:${workspace.case.caseId}`:undefined;
      if(key)cursors.current[queue]=key;
    }
    selectedRequest.current++;workspaceSerial.current++;workspaceRequest.current=null;setWorkspaceLoading(false);setNextLoad(null);setDisplay(null);setReviewCase(null);setQueue(next);setWorkspace(null);setSelected(null);setDraftText('');setSavedText('');setEditing(false);resetReview();
    const items=next==='review'?reviewItems:next==='history'?historyItems:[];
    const nextItem=items.find(item=>reviewItemKey(item)===(next==='attention'?undefined:cursors.current[next]))??items[0];
    if(nextItem)void run(()=>nextItem.kind==='proposal'?loadProposal(nextItem.value):loadCase(nextItem.value.caseId));
  }
  const navigationItems=queue==='review'?reviewItems:queue==='history'?historyItems:[];
  const selectedKey=selected?`proposal:${selected.proposalId}`:workspace?`case:${workspace.case.caseId}`:'';
  const navigationIndex=navigationItems.findIndex(item=>reviewItemKey(item)===selectedKey);
  const prefetchItems=queue==='review'?reviewItems.filter(item=>item.kind==='proposal').map(item=>item.value):[];
  const prefetchSignature=prefetchItems.map(snapshotKey).join('|');
  useEffect(()=>{
    let active=true;
    const start=Math.max(0,prefetchItems.findIndex(item=>item.proposalId===selected?.proposalId));
    const ordered=[...prefetchItems.slice(start+1),...prefetchItems.slice(0,start+1)].slice(0,20);
    cache.current.retain(new Set(prefetchItems.map(snapshotKey)));
    async function prefetch(){
      let cursor:string|null=null;let remaining=20;const visited=new Set<string>();
      while(active&&remaining>0){
        if(!cursor)cursor=ordered.find(value=>!visited.has(value.proposalId)&&!cache.current.get(snapshotKey(value)))?.proposalId??null;
        if(!cursor||visited.has(cursor))return;
        visited.add(cursor);
        try{
          const batch=await api.reviewBatch(cursor,remaining);if(!active)return;
          for(const snapshot of batch.items){
            visited.add(snapshot.proposal.proposalId);
            const known=ordered.find(value=>snapshotKey(value)===snapshotKey(snapshot.proposal));
            if(known)cache.current.set(snapshotKey(snapshot.proposal),snapshot);
          }
          remaining-=batch.items.length;cursor=batch.nextProposalId;
        }catch{return;}
      }
    }
    prefetchChain.current=prefetchChain.current.then(prefetch);return()=>{active=false;};
  },[api,queue,prefetchSignature,selected?.proposalId]);
  const itemVisible=queue!=='history'||historyItems.some(item=>reviewItemKey(item)===selectedKey);
  const proposalOutdated=!!selected&&proposals.some(item=>item.proposalId===selected.proposalId&&(item.version!==selected.version||(['applied','closed'].includes(item.status)&&item.status!==selected.status)));
  const itemOutdated=!!selected&&(snapshotOutdated||proposalOutdated);
  const noChangeVisible=itemVisible&&!!workspace&&!selected&&!draftText&&((queue==='review'&&noProposalCases.some(item=>item.caseId===workspace.case.caseId))||(queue==='history'&&closedNoProposalCases.some(item=>item.caseId===workspace.case.caseId)));
  const reassessmentCase=selected?reviewCase:workspace?.case;
  const reassessmentLatest=selected?reviewReassessment?.latest:workspace?.reassessment;
  const canReassess=!previewOnly&&queue==='review'&&!!reassessmentCase&&(selected?!!reviewReassessment?.eligible:workspace?.case.kind==='exercise_improvement'&&workspace.case.status==='completed'&&(workspace.admission?.outcome==='single_sense'||workspace.admission?.outcome==='laundry_list'||workspace.sources.some(source=>source.kind==='exercise'&&source.exerciseType==='pure_cue')));
  const reassessmentPending=!!reassessmentLatest&&['queued','running'].includes(reassessmentLatest.status);
  const reassessmentControl=canReassess&&reassessmentCase?<div className="vocabulary-reassessment-control"><label>Model for reassessment<select aria-label="Model for reassessment" disabled={busy||dirty||itemOutdated||reassessmentPending} value={reassessmentModel} onChange={event=>setReassessmentModel(event.target.value as VocabularyReassessmentModel)}><option value="openai:gpt-6-sol-high">GPT-6 Sol high</option><option value="openai:gpt-5.6-luna-high">Luna high</option><option value="zai:glm-5.3-flash-high">GLM-5.3 Flash high</option></select></label><button className="secondary-button" disabled={busy||dirty||itemOutdated||reassessmentPending} onClick={()=>void run(async()=>{const result=await api.reassessCase(reassessmentCase.caseId,reassessmentModel);if(selected){const latest={...result,status:'queued',error:null};setReviewReassessment({eligible:true,latest});cache.current.delete(snapshotKey(selected));}else setWorkspace(await api.workspace(reassessmentCase.caseId));await reload();},'Reassessment queued. Its result will appear in the review queue.')}>Reassess improvement</button>{reassessmentLatest&&<span role="status">{reassessmentPending?'Reassessment '+reassessmentLatest.status:reassessmentLatest.status==='failed'?'Reassessment failed. You can reassess again.':'Reassessment complete'}</span>}</div>:null;
  const caseEntryVisible=itemVisible&&!!workspace&&!selected&&!draftText&&!noChangeVisible;
  return <section ref={pageRef} className="vocabulary-operator-page" tabIndex={0} aria-label="Content improvement" onKeyDown={event=>{
    const target=event.target as HTMLElement;
    const index=resolveReviewNavigation(event.nativeEvent,{index:navigationIndex,count:navigationItems.length,busy,
      nativeTarget:!!target.closest('input,textarea,select,summary,[contenteditable="true"],[role="tablist"],[role="tab"],.vocabulary-operator-table')});
    if(index!==null){event.preventDefault();selectItem(navigationItems[index]);}
  }}>
    <header><h2>Content improvement</h2><button className="secondary-button" disabled={busy} onClick={()=>void run(async()=>{await reload();},'Queues refreshed.')}>Refresh</button></header>
    {nextLoad&&<button className="secondary-button" disabled={busy} onClick={()=>void run(async()=>{if(nextLoad.kind==='proposal')await loadProposal(nextLoad.value);else await loadCase(nextLoad.value.caseId);setNextLoad(null);})}>Retry loading next item</button>}
    {refreshError&&<p role="alert" className="vocabulary-operator-error">{refreshError}</p>}{error&&<p role="alert" className="vocabulary-operator-error">{error}</p>}{notice&&<p role="status">{notice}</p>}
    <nav className="vocabulary-operator-tabs" aria-label="Review queues">{([['review','Awaiting review',pending.length+noProposalCases.length],['attention','Needs attention',cases.length+preparationFailures.length+dispatches.length],['history','Archive',history.length+closedNoProposalCases.length]] as const).map(([value,label,count])=><button key={value} disabled={busy} aria-pressed={queue===value} onClick={()=>switchQueue(value)}>{label}{value!=='history'&&<span>{count}</span>}</button>)}</nav>
    {queue==='attention'&&preparationFailures.length>0&&<section aria-label="Practice preparation failures"><h2>Practice preparation needs attention</h2><ul>{preparationFailures.map(item=><li key={item.workId}><span>Word {item.wordId} · attempt {item.attemptCount} of 3</span>{item.retryable?<button disabled={busy} onClick={()=>void run(async()=>{await api.retryPreparation(item.workId);await reload();},'Preparation queued for another retry cycle.')}>Retry preparation</button>:<p>Attempt limit reached; inspect the retained invocation before changing preparation.</p>}<details><summary>Failure details</summary><p>{item.lastError}</p><p>Invocation: {item.invocationId??'No retained invocation'}</p><p>Source: {item.sourceContentId}</p></details></li>)}</ul></section>}
    {queue==='attention'&&dispatches.length>0&&<section aria-label="Evidence processing failures"><h2>Evidence needs processing</h2><ul>{dispatches.map(item=><li key={item.dispatchId}><span>Session {item.sessionId} · learner {item.learnerId}</span><button disabled={busy} onClick={()=>void run(async()=>{await api.retryDispatch(item.dispatchId);await reload();},'Evidence processing queued.')}>Retry evidence processing</button><details><summary>Failure details</summary><p>{item.error}</p></details></li>)}</ul></section>}
    <div className={queue==='attention'?"vocabulary-operator-layout":"vocabulary-operator-single"}>{queue==='attention'&&<aside aria-label="Review queues">
      {queue==='attention'&&<section><h2>Cases</h2><label>Inbox<select value={kind} disabled={busy} onChange={event=>setKind(event.target.value as VocabularyReflectionCase['kind'])}>{Object.entries(kinds).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
        {visibleCases.length===0?<p>No open cases in this inbox.</p>:<ul className="vocabulary-operator-list">{visibleCases.map(item=><li key={item.caseId}><button disabled={busy} aria-pressed={workspace?.case.caseId===item.caseId} onClick={()=>openCase(item.caseId)}>{item.wordId??item.contentId??'Content issue'}<span>{item.evidence.length} encounter{item.evidence.length===1?'':'s'} · {new Date(item.createdAt).toLocaleString()}</span></button></li>)}</ul>}
      </section>}
    </aside>}<div className="vocabulary-operator-detail">
      {queue==='review'&&navigationIndex>=0&&<CardInbox count={reviewItems.length} index={Math.max(0,reviewItems.findIndex(item=>item.kind==='proposal'?item.value.proposalId===selected?.proposalId:!selected&&item.value.caseId===workspace?.case.caseId))} itemLabel="item" emptyCopy="" keyboardNavigation busy={busy} onSelect={index=>{const item=reviewItems[index];if(item.kind==='proposal')openProposal(item.value);else openCase(item.value.caseId);}} />}
      {queue==='history'&&<label className="vocabulary-archive-search">Search archive<input type="search" value={archiveSearch} onChange={event=>setArchiveSearch(event.target.value)} /></label>}
      {queue==='history'&&!archiveSearch.trim()&&<p className="vocabulary-operator-meta">Last 12 hours</p>}
      {queue==='history'&&historyItems.length===0&&<p role="status">{archiveSearch.trim()?'No matching archived items.':'No resolutions in the last 12 hours.'}</p>}
      {queue==='history'&&historyItems.length>0&&(archiveSearch.trim()||!itemVisible)&&<ul className="vocabulary-operator-list vocabulary-archive-results">{historyItems.map(item=><li key={reviewItemKey(item)}><button disabled={busy} aria-pressed={reviewItemKey(item)===selectedKey} onClick={()=>selectItem(item)}>{item.kind==='proposal'?proposalTitle(item.value):item.value.wordId??'No change review'}<small>{item.kind==='proposal'?(item.value.status==='applied'?'Applied':'Dismissed'):'No change'}</small></button></li>)}</ul>}
      {queue==='history'&&navigationIndex>=0&&<CardInbox count={historyItems.length} index={Math.max(0,historyItems.findIndex(item=>item.kind==='proposal'?item.value.proposalId===selected?.proposalId:!selected&&item.value.caseId===workspace?.case.caseId))} itemLabel="item" emptyCopy="" keyboardNavigation busy={busy} onSelect={index=>{const item=historyItems[index];if(item.kind==='proposal')openProposal(item.value);else openCase(item.value.caseId);}} />}
      {queue!=='history'&&!workspace&&!selected&&<section><h2>{queue==='attention'?'Choose an issue':'Ready for review'}</h2>{queue==='review'&&reviewItems.length===0&&<p>Suggestions will appear here when processing finishes.</p>}</section>}
      {itemVisible&&(selected||draftText)&&<ContentImprovementEntry label="Proposal review" evidence={selected?proposalServedEvidence(selected.caseId,reviewCase?{caseId:reviewCase.caseId,evidence:reviewCase.evidence}:null):workspace?.case.evidence??null}><h2>{selected?proposalTitle(selected):'New correction draft'}</h2>{selected&&<p>{proposalSummary(selected)}</p>}{selected&&proposalContext?.(selected)}{queue==='history'&&selected&&<p><strong>{selected.status==='applied'?'Applied':'Dismissed'}</strong></p>}{dirty&&<p role="status">Unsaved changes</p>}{itemOutdated&&<p role="alert">This proposal or its source has changed or is unavailable. <button disabled={busy||dirty} onClick={()=>{cache.current.delete(snapshotKey(selected!));openProposal(selected!);}}>Reload proposal</button></p>}

        {selected&&display&&display.length>0&&<div className="vocabulary-operator-preview">{display.map(item=><article key={item.operationKey}><h3>{labels[selected.operations.find(operation=>operation.operationKey===item.operationKey)!.strategy]}</h3><Scope operation={selected.operations.find(operation=>operation.operationKey===item.operationKey)!}/>{selected.operations.find(operation=>operation.operationKey===item.operationKey)!.strategy==='replace'&&<p className="vocabulary-operator-meta">Retires the current item. Existing schedules and teaching references stay with it.</p>}<div className="vocabulary-operator-comparison"><div><h5>{previewOnly?'Original cue':'Current item'}</h5>{item.source?<AuthoredContent content={item.source} expandDetails={detailsOpen||contentDetailsChanged(item.source,item.result)}/>:<p>{selected.operations.find(operation=>operation.operationKey===item.operationKey)!.strategy==='create'?'New item':'Current item unavailable'}</p>}</div><div><h5>Proposed result</h5><AuthoredContent content={item.result} expandDetails={detailsOpen||contentDetailsChanged(item.source,item.result)}/></div></div></article>)}

        </div>}
        {selected&&!editable&&(!display||display.length===0)&&selected.operations.map(operation=><article key={operation.operationKey}><h3>{labels[operation.strategy]}</h3><Scope operation={operation}/><AuthoredContent content={operation.content} expandDetails={detailsOpen}/></article>)}
        {selected&&<ProposalSecondOpinion expanded={detailsOpen} key={selected.proposalId} api={api} proposal={selected} eligible={!previewOnly&&editable&&reviewCase?.kind==='exercise_improvement'} disabled={busy||dirty||itemOutdated} actions={secondOpinionAction=>editable?<div className="vocabulary-operator-actions vocabulary-review-actions"><button disabled={busy||dirty||itemOutdated} onClick={approveAndApply}>{review?'Retry application':previewOnly?'Approve in local preview':'Approve and apply'}</button><button className="secondary-button" disabled={busy} onClick={()=>{if(!editing)void loadWorkspaceForProposal(selected);setEditing(!editing);}}>{editing?'Close editor':'Edit proposal'}</button><button className="secondary-button" disabled={busy||dirty||proposalOutdated} onClick={dismissProposal}>Dismiss</button>{previewOnly?<button className="secondary-button" disabled title="Historical preview; no model calls run here">Ask AI for a second opinion</button>:secondOpinionAction}{reassessmentControl}</div>:null}/>}
        {editing&&<div className="vocabulary-proposal-editor"><h3>Edit proposal</h3>
        {selected?.caseId&&!workspace?<p role="status">{workspaceLoading?'Loading case details…':<button className="secondary-button" onClick={()=>void loadWorkspaceForProposal(selected)}>Load case details</button>}</p>:<>
        {draft&&Array.isArray(draft.operations)?<><label>Diagnosis and overall rationale<textarea disabled={!editable||busy} value={draft.rationale??''} onChange={event=>changeDraft({...draft!,rationale:event.target.value})}/></label>{draft.operations.map((operation,index)=><fieldset key={`${index}-${operation.operationKey}`}><legend>Change {index+1}</legend><Scope operation={operation}/><label>Identity decision<select disabled={!editable||busy} value={operation.strategy} onChange={event=>strategy(index,event.target.value as VocabularyProposalOperation['strategy'])}>{Object.entries(labels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
          <p>{operation.strategy==='update_existing'?'Preserves the content ID and its identity-bound schedules and deactivations.':operation.strategy==='replace'?'Creates a new item and retires the old item. Existing schedules, deactivations and teaching references stay on the old identity.':'Creates an additional item; existing items stay active. No learner state or teaching relationships transfer automatically.'}</p>
          <label>Why this strategy and content are appropriate<textarea disabled={!editable||busy} value={operation.rationale} onChange={event=>changeDraft({...draft!,operations:draft!.operations.map((item,i)=>i===index?{...item,rationale:event.target.value}:item)})}/></label>
          {operation.content.body!==null&&typeof operation.content.body==='object'&&!Array.isArray(operation.content.body)&&typeof operation.content.body.prompt==='string'&&<label>Proposed cue<textarea disabled={!editable||busy} value={operation.content.body.prompt} onChange={event=>changeDraft({...draft!,operations:draft!.operations.map((item,i)=>i===index?{...item,content:{...item.content,body:{...(item.content.body as Record<string,VocabularyJson>),prompt:event.target.value}}}:item)})}/></label>}
          <AuthoredContent content={operation.content} expandDetails={detailsOpen}/></fieldset>)}</>:<p role="status">The JSON draft is incomplete. Fix it below before saving.</p>}
        <div><h4>Full authored draft</h4><p>Change authored content and answer criteria here. The server validates relationships and scope before approval. Saving invalidates previous review.</p><label>Draft JSON<textarea className="vocabulary-operator-json" rows={18} value={draftText} disabled={busy||!editable} spellCheck={false} onChange={event=>{setDraftText(event.target.value);resetReview();}}/></label></div>
        {editable&&<div className="vocabulary-operator-actions"><button disabled={busy||!draft||!dirty} onClick={save}>{selected?'Save new version':'Save draft'}</button><button className="secondary-button" disabled={busy||!selected||dirty} onClick={inspect}>Validate and preview saved version</button></div>}
        </>}
        </div>}

        {receipt&&<p role="status">Application receipt: <code>{receipt}</code></p>}
      </ContentImprovementEntry>}
      {noChangeVisible&&workspace&&<ContentImprovementEntry label="No change judgment" evidence={workspace.case.evidence}>
        <h2>{workspace.sources.flatMap(source=>source.kind==='exercise'?source.answers.map(answer=>answer.acceptedForms[0]):[]).filter(Boolean).join(' · ')||workspace.case.wordId||'Content review'}</h2>
        <p><strong>No change proposed</strong></p><p>{diagnosisSummary(workspace.diagnosis)}</p>
        {workspace.jobs.filter(job=>job.secondOpinion).map(job=><div className="vocabulary-second-opinion" key={job.jobId}>{job.result?<><p><strong>{{support:'Supports no change',revise:'Suggests revision',reject:'Recommends a change'}[job.result.verdict]}</strong></p><p>{detailsOpen?job.result.rationale:brief(job.result.rationale)}</p></>:<p role="status">Second opinion: {job.status}</p>}{job.status==='failed'&&<button disabled={busy} onClick={()=>void run(async()=>{await api.retryJob(job.jobId);setWorkspace(await api.workspace(workspace.case.caseId));})}>Retry second opinion</button>}</div>)}
        {queue==='review'&&<div className="vocabulary-operator-actions"><button disabled={busy} onClick={()=>void run(async()=>{await api.closeCase(workspace.case.caseId,reason);await reload();setWorkspace(null);initialSelection.current=false;},'Review closed.')}>Done</button><button className="secondary-button" disabled={busy||workspace.jobs.some(job=>job.secondOpinion&&['queued','running'].includes(job.status))} onClick={()=>void run(async()=>{await api.requestCaseSecondOpinion(workspace.case.caseId,caseNotes);setCaseNotes('');setWorkspace(await api.workspace(workspace.case.caseId));},'Second opinion queued.')}>Second opinion</button>{reassessmentControl}</div>}
      </ContentImprovementEntry>}
      {caseEntryVisible&&workspace&&<ContentImprovementEntry label="Content improvement entry" evidence={workspace.case.evidence}/>}
      {itemVisible&&(workspace||selected)&&<details key={selected?.proposalId??workspace?.case.caseId} open={detailsOpen} onToggle={event=>{const open=event.currentTarget.open;setDetailsOpen(open);if(open&&selected)void loadWorkspaceForProposal(selected);}} className="vocabulary-evidence"><summary>Details</summary>
        {selected&&<section><h3>Proposal details</h3><p>{selected.rationale}</p><p className="vocabulary-operator-meta">{selected.status.replaceAll('_',' ')} · revision {selected.version}</p>{selected.operations.map(operation=><p key={operation.operationKey}>{operation.rationale}</p>)}
          {preview&&!previewOnly&&<section><h3>Schedule and relationship effects</h3><div className="vocabulary-operator-table" role="region" aria-label="Identity relationship effects" tabIndex={0}><table><caption>Identity-bound relationships; no automatic transfer</caption><thead><tr><th>Change</th><th>Scope</th><th>Learner schedules for this cue</th><th>Deactivations</th><th>Teaching references</th><th>Sense relationships</th><th>Curation records</th></tr></thead><tbody>{preview.operations.map(item=><tr key={item.operationKey}><th>{labels[item.strategy]}</th><td>{item.scope.kind==='shared'?'Shared':`Private: ${item.scope.learnerId}`}</td><td>{item.schedulesRemainOnSource}</td><td>{item.deactivationsRemainOnSource}</td><td>{item.teachingBindingsRemainOnSource+item.sourceIntroductionExercises}</td><td>{item.sourceSenseMappings}</td><td>{item.sourceCurations}</td></tr>)}</tbody></table></div></section>}
          {editable&&<><button className="secondary-button" disabled={busy||dirty||itemOutdated} onClick={inspect}>Validate proposal and show relationship effects</button><label>Approval note (optional)<textarea value={reviewNote} disabled={busy} onChange={event=>setReviewNote(event.target.value)}/></label><label>Dismissal reason (optional)<textarea value={reason} disabled={busy} onChange={event=>setReason(event.target.value)}/></label></>}
        </section>}
        {workspace&&!selected&&queue!=='attention'&&<section><h3>Assessment</h3><ReadableJson value={workspace.diagnosis??null}/><label>Reason (optional)<textarea value={reason} disabled={busy||queue==='history'} onChange={event=>setReason(event.target.value)}/></label>{queue==='review'&&<label>Question for second opinion (optional)<textarea value={caseNotes} disabled={busy} onChange={event=>setCaseNotes(event.target.value)}/></label>}</section>}
        {selected?.caseId&&!workspace&&<p role="status">{workspaceLoading?'Loading case details…':<button className="secondary-button" onClick={()=>void loadWorkspaceForProposal(selected)}>Load case details</button>}</p>}
        {workspace&&<section aria-label="Case evidence"><h2>{kinds[workspace.case.kind]}</h2>{!previewOnly&&<p className="vocabulary-operator-meta">Learner {workspace.case.learnerId} · {workspace.case.status}</p>}
        {workspace.admission&&<section aria-label="Sense assessment"><h3>{admissionLabels[workspace.admission.outcome]}</h3><p>{workspace.admission.rationale}</p>{admissionNeedsAttention&&<p>No automatic repair or sense expansion follows this finding. Learner feedback is processed independently.</p>}<pre>{pretty(workspace.admission)}</pre></section>}
        {workspace.pureCueReferral&&<section aria-label="Pure cue assessment"><h3>Pure cue exploration</h3><p>{workspace.pureCueReferral.candidateWords.join(' · ')}</p><p>{workspace.pureCueReferral.sharedPurpose}</p>{workspace.pureCuePromotion&&<><p><strong>{{reject:'Referral rejected',reuse:'Existing cue fits',extend:'Proposed membership extension',create:'Proposed new cue',needs_operator:'Candidate words need review'}[workspace.pureCuePromotion.outcome]}</strong></p><p>{workspace.pureCuePromotion.rationale}</p></>}<p>{workspace.pureCueReferral.rationale}</p><pre>{pretty(workspace.pureCuePromotion)}</pre></section>}
        {workspace.jobs.map(job=><div className="vocabulary-operator-job" key={job.jobId}><span>{job.kind==='learner_feedback'?'Learner feedback':'Exercise improvement'} · {job.status} · attempt {job.attemptNumber}</span>{job.status==='failed'&&<button disabled={busy} onClick={()=>void run(async()=>{await api.retryJob(job.jobId);setWorkspace(await api.workspace(workspace.case.caseId));await reload();},'Processing queued. Other feedback and proposals remain independent.')}>Retry processing</button>}{job.error&&<p>{job.error==='provider_outcome_unknown'?'The provider outcome is unknown. An explicit retry may make another call.':job.error}</p>}</div>)}
        <h3>What the learner encountered</h3>{workspace.case.evidence.map(encounter=><article className="vocabulary-operator-encounter" key={encounter.encounterId}><p className="vocabulary-operator-meta">{encounter.snapshot.role} · {encounter.snapshot.kind} · content version {encounter.snapshot.contentVersion}{encounter.skipped?' · skipped':''}</p><p className="vocabulary-operator-cue">{encounter.snapshot.body.prompt}</p>
          {encounter.snapshot.kind==='introduction'&&encounter.snapshot.body.material!==undefined&&<ReadableJson value={encounter.snapshot.body.material}/>}
          {encounter.snapshot.assessment&&<p><strong>Expected answers:</strong> {encounter.snapshot.assessment.acceptedAnswers.join(' / ')}</p>}
          {encounter.responses.length?<ul>{encounter.responses.map(response=><li key={response.actionId}>{response.payload.response??'No answer'} · {response.payload.outcome}{!encounter.effectiveResponses.some(item=>item.actionId===response.actionId)?' · undone':''}</li>)}</ul>:<p>{previewOnly?'Response details were excluded from this preview.':'No answer was submitted.'}</p>}
          {getEffectiveVocabularyEncounterReactions(encounter).map(reaction=><p key={reaction.actionId}><strong>Learner reaction:</strong> {reaction.payload.comment||reaction.payload.feedback}</p>)}
          <h4>Retained encounter and reaction history</h4><pre>{pretty(encounter)}</pre></article>)}
        {workspace.case.kind!=='learner_feedback'&&<><h3>{workspace.case.kind==='teaching_review'?'Current introduction and teaching repertoire':'Current authored content'}</h3><p>Draft from the current version below. The encounters above preserve what was actually served.</p>{workspace.sources.map(source=><article key={source.contentId} className="vocabulary-operator-source"><h4>{source.kind==='introduction'?'Introduction':source.kind==='exercise'&&source.exerciseRole==='teaching'?'Teaching exercise':'General exercise'} · version {source.version}</h4><AuthoredContent content={source} expandDetails/><p className="vocabulary-operator-meta">{source.contentId} · {source.accessScope} · {source.availability}</p><button disabled={busy} onClick={()=>startDraft(source)}>{selected?'Create a separate correction':'Draft a correction'}</button></article>)}</>}
        {(workspace.case.kind==='teaching_review'||admissionNeedsAttention||promotionNeedsAttention)&&<div className="vocabulary-operator-close"><label>Case resolution<textarea value={reason} onChange={event=>setReason(event.target.value)} placeholder="Explain the manual review outcome"/></label><button className="secondary-button" disabled={busy||!reason.trim()||workspace.case.status==='closed'} onClick={()=>void run(async()=>{await api.closeCase(workspace.case.caseId,reason);setWorkspace(await api.workspace(workspace.case.caseId));await reload();},'Case closed; its evidence remains retained.')}>{workspace.case.kind==='teaching_review'?'Close teaching case':promotionNeedsAttention?'Close pure cue assessment':'Close sense assessment'}</button></div>}
      </section>}</details>}
    </div></div>
  </section>;
}
