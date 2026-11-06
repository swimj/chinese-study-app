import type { VocabularyCaseQueueItem } from '../domain/vocabulary-case-queue';
import { caseReviewLocked } from '../features/vocabulary-operator/case-queue-model';
import { AssessmentReview } from '../features/vocabulary-operator/AssessmentReview';
import { PureCueIdentityResolution } from '../features/vocabulary-operator/PureCueIdentityResolution';
import { vocabularyPhraseClozeError } from '../domain/vocabulary-production-coverage';
import type { VocabularyDefaultSelectionFinding,VocabularySenseCoverageWorkspace } from '../domain/vocabulary-sense-coverage';
import type { VocabularyRepairTargetWorkspace } from '../domain/vocabulary-reflection';
import { repairTargetBlocksMutation } from '../features/vocabulary-operator/sense-coverage';
import { ReassessmentDialog } from '../features/vocabulary-operator/ReassessmentDialog';
import { RepairTargetEditor } from '../features/vocabulary-operator/RepairTargetEditor';
import { ScopeCoverageEditor } from '../features/vocabulary-operator/ScopeCoverageEditor';
import { mergeSenseLabels,scopeAffectsProposal } from '../features/vocabulary-operator/sense-coverage';
import { useEffect,useRef,useState } from 'react';
import type { VocabularyContent,VocabularyContentDraft,VocabularyJson } from '../domain/vocabulary-content';
import type { VocabularyApprovalRequest,VocabularyContentProposal,VocabularyProposalDraft,VocabularyProposalOperation,VocabularySenseLabel,VocabularyReflectionCase } from '../domain/vocabulary-reflection';
import { getEffectiveVocabularyEncounterReactions } from '../domain/vocabulary-session';
import { vocabularyOperatorApi,type VocabularyOperatorApi,type VocabularyCaseWorkspace,type VocabularyProposalPreview,type VocabularyReassessmentModel,type VocabularyReviewSnapshot } from '../features/vocabulary-operator/api';
import { CompactProposalReview } from '../features/vocabulary-operator/CompactProposalReview';
import { editableProposalDraft,readableSenseProse,selectedOperations,selectedProposalDraft,toggleOperation } from '../features/vocabulary-operator/proposal-review';
import { ApiRequestError } from '../services/api';
import './VocabularyOperatorPage.css';
import { OperatorPrefetchCache } from '../features/vocabulary-operator/prefetch-cache';
import { mergeApprovalRequests } from '../features/vocabulary-operator/approval-state';
import { ProposalSecondOpinion } from '../features/vocabulary-operator/ProposalSecondOpinion';
import { ContentImprovementEntry, proposalServedEvidence, ReadableJson } from '../features/vocabulary-operator/content-improvement-entry';

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
const labels={create:'Add another item',update_existing:'Update existing item',replace:'Replace with new item',retire:'Retire exercise'} as const;
const admissionLabels={repertoire_bootstrap:'Dictionary fallback: fresh repertoire',already_covered:'Authored practice already exists',needs_coverage:'Select useful senses before generation',no_senses_requested:'No senses requested for generation',single_sense:'Intended sense identified',laundry_list:'Multiple senses: fresh repertoire',unmappable:'Intended sense could not be established',inventory_gap:'Possible gap in the sense inventory'} as const;
const pretty=(value:unknown)=>JSON.stringify(value,null,2);
const message=(error:unknown)=>error instanceof Error?error.message:'The request could not finish. Refresh and try again.';
function draftOf(value:VocabularyContentProposal):VocabularyProposalDraft{return {caseId:value.caseId??undefined,operations:value.operations,rationale:value.rationale,bases:value.bases};}
function authored(value:VocabularyContent):VocabularyContentDraft {
  const {version:_version,createdAt:_created,updatedAt:_updated,...draft}=value;return draft;
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
export type VocabularyDetailActivity = {dirty:boolean;busy:boolean};
export type VocabularyOperatorDetail = ({caseId:string;proposalId?:string} | {caseId:null;proposalId:string}) & {edit?:boolean;history?:boolean;liveReview:VocabularyCaseQueueItem|null;onChanged:(caseId:string|null,savedProposalId?:string)=>Promise<void>;onSelectProposal:(proposalId:string)=>void};
type VocabularyOperatorPageProps = {api?:VocabularyOperatorApi;detailOnly:VocabularyOperatorDetail;onActivity?:(activity:VocabularyDetailActivity)=>void};
/** On-demand authored editor and retained evidence for cases or standalone proposals. */
export function VocabularyOperatorPage(props:VocabularyOperatorPageProps) {
  const api=props.api??vocabularyOperatorApi;
  const detailOnly=props.detailOnly;
  const onActivity=props.onActivity;
  const queue=detailOnly.history?'history':'detail';
  const [editing,setEditing]=useState(false);
  const [detailsOpen,setDetailsOpen]=useState(false);
  const pageRef=useRef<HTMLElement>(null);
  const [caseNotes,setCaseNotes]=useState('');
  const [confirmReassessment,setConfirmReassessment]=useState<string|null>(null);
  const [reassessmentOpen,setReassessmentOpen]=useState(false);
  const [reassessmentModel,setReassessmentModel]=useState<VocabularyReassessmentModel>('openai:gpt-6-sol-high');
  const [proposals,setProposals]=useState<VocabularyContentProposal[]>([]);
  const [approvalRequests,setApprovalRequests]=useState<VocabularyApprovalRequest[]>([]);
  const [reviewCase,setReviewCase]=useState<VocabularyReflectionCase|null>(null);
  const [reviewAssessment,setReviewAssessment]=useState<VocabularyReviewSnapshot['assessment']>(null);
  const [reviewReassessment,setReviewReassessment]=useState<VocabularyReviewSnapshot['reassessment']>(null);
  const [workspaceLoading,setWorkspaceLoading]=useState(false);
  const workspaceRequest=useRef<{caseId:string;token:number}|null>(null);
  const workspaceSerial=useRef(0);
  const [workspace,setWorkspace]=useState<VocabularyCaseWorkspace|null>(null),[selected,setSelected]=useState<VocabularyContentProposal|null>(null);
  const [senseLabels,setSenseLabels]=useState<VocabularySenseLabel[]>([]);
  const [excludedKeys,setExcludedKeys]=useState<Set<string>>(()=>new Set());
  const [draftText,setDraftText]=useState(''),[savedText,setSavedText]=useState('');
  const [currentSources,setCurrentSources]=useState<VocabularyContent[]>([]);
  const [display,setDisplay]=useState<ReviewSnapshot['previews']|null>(null);
  const [preview,setPreview]=useState<VocabularyProposalPreview|null>(null);
  const [reviewNote,setReviewNote]=useState(''),[reason,setReason]=useState('');
  const cache=useRef(new OperatorPrefetchCache<ReviewSnapshot>());
  const [snapshotOutdated,setSnapshotOutdated]=useState(false);
  const [repairTarget,setRepairTarget]=useState<VocabularyRepairTargetWorkspace|null>(null);
  const [coverageChanged,setCoverageChanged]=useState(false),[scopeEditing,setScopeEditing]=useState(false);
  const [defaultSelectionFinding,setDefaultSelectionFinding]=useState<VocabularyDefaultSelectionFinding|null>(null);
  const [freshReassessmentSource,setFreshReassessmentSource]=useState<{caseId:string;source:import('../features/vocabulary-operator/api').VocabularyReassessmentSource}|null>(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [refreshError,setRefreshError]=useState('');
  const selectedRequest=useRef(0);
  const approvalSubmission=useRef<{requestId:string;proposalId:string;expectedVersion:number;notes:string}|null>(null);
  const [approvalUnconfirmed,setApprovalUnconfirmed]=useState(false);
  const dirty=draftText!==savedText||excludedKeys.size>0;
  const promotionNeedsAttention=workspace?.pureCuePromotion?.outcome==='needs_operator';
  const admissionNeedsAttention=workspace?.admission?.outcome==='unmappable'||workspace?.admission?.outcome==='inventory_gap'||workspace?.admission?.outcome==='needs_coverage';
  let draft:VocabularyProposalDraft|null=null;try{const value:unknown=JSON.parse(draftText);if(editableProposalDraft(value))draft=value;}catch{/* Keep invalid editing text intact. */}
  const activeOperations=draft?selectedOperations(draft.operations,excludedKeys):[];
  const invalidCue=activeOperations.some(operation=>operation.strategy!=='retire'&&vocabularyPhraseClozeError(operation.content.body)!==null);
  const zeroSelected=draft!==null&&activeOperations.length===0;
  const selectedApproval=selected?approvalRequests.find(item=>item.proposalId===selected.proposalId&&item.expectedVersion===selected.version&&(item.status==='queued'||item.status==='running')):undefined;
  const caseLocked=caseReviewLocked(detailOnly.caseId??undefined,detailOnly?.liveReview,(selected?reviewCase:workspace?.case)?.review);
  const detailStale=!!detailOnly?.liveReview&&(detailOnly.liveReview.stale||!!selected&&(detailOnly.liveReview.proposal?.proposalId!==selected.proposalId||detailOnly.liveReview.proposal.version!==selected.version));
  useEffect(()=>{onActivity?.({dirty,busy:busy||scopeEditing||approvalUnconfirmed||reassessmentOpen});},[dirty,busy,scopeEditing,approvalUnconfirmed,reassessmentOpen,onActivity]);
  const repairCase=selected?reviewCase:workspace?.case;
  const repairBlocked=queue!=='history'&&repairCase?.kind==='exercise_improvement'&&repairTargetBlocksMutation(repairCase.caseId,repairTarget);
  const editable=!repairBlocked&&!caseLocked&&!selectedApproval&&(selected===null||!['applied','closed'].includes(selected.status));
  async function reload(savedProposalId?:string){
    let proposals:VocabularyContentProposal[];
    if(detailOnly.caseId){
      const result=await api.workspace(detailOnly.caseId);
      setWorkspace(result);setProposals(result.proposals);setReviewCase(result.case);proposals=result.proposals;
    }else{
      const proposalId=savedProposalId??selected?.proposalId??detailOnly.proposalId;
      if(!proposalId)throw new Error('Standalone details require a proposal identity.');
      const proposal=await api.proposal(proposalId);proposals=[proposal];setProposals(proposals);
    }
    await detailOnly.onChanged(detailOnly.caseId,savedProposalId??selected?.proposalId);
    return proposals;
  }
  useEffect(()=>{
    let active=true;setBusy(true);setError('');
    void (async()=>{
      const full=detailOnly.caseId?await api.workspace(detailOnly.caseId):null;
      if(!active)return;
      setWorkspace(full);setSenseLabels(full?.senseLabels??[]);setProposals(full?.proposals??[]);setReviewCase(full?.case??null);
      setDefaultSelectionFinding(full?.defaultSelectionFinding??null);
      if(detailOnly.proposalId){
        const value=await api.proposal(detailOnly.proposalId);if(!active)return;
        await loadProposal(value);if(!active)return;
        setWorkspace(full);setEditing(!!detailOnly.edit);
      }
      setDetailsOpen(true);
    })().catch(cause=>{if(active)setError(message(cause));}).finally(()=>{if(active)setBusy(false);});
    return()=>{active=false;selectedRequest.current++;};
  },[api,detailOnly.caseId,detailOnly.proposalId]);
  const hasActiveCaseWork=!!workspace?.jobs.some(job=>['queued','running'].includes(job.status))||!!workspace?.case.review?.activeJob;
  useEffect(()=>{
    // Compact review supplies live status itself. Attention's pinned editor needs
    // status refreshes, without installing over its authored proposal or draft.
    if(detailOnly.liveReview||!detailOnly.caseId||busy||dirty||scopeEditing||reassessmentOpen||approvalUnconfirmed)return;
    const caseId=detailOnly.caseId;
    let active=true,inFlight=false,timer:ReturnType<typeof setTimeout>;
    const schedule=()=>{if(active){clearTimeout(timer);timer=setTimeout(()=>void refreshStatus(),hasActiveCaseWork?3000:15000);}};
    async function refreshStatus(){
      if(inFlight)return;
      if(document.visibilityState==='hidden'||pageRef.current?.closest('[hidden]')){schedule();return;}
      inFlight=true;
      const request=selectedRequest.current;
      try{
        const result=await api.workspace(caseId);
        if(!active||request!==selectedRequest.current)return;
        setWorkspace(result);setReviewCase(result.case);setProposals(result.proposals);
        setReviewReassessment(previous=>previous?{...previous,latest:result.reassessment??null,source:result.reassessmentSource??null,eligible:!!result.reassessmentSource}:previous);
        setRefreshError('');
      }catch(cause){if(active&&request===selectedRequest.current)setRefreshError(`Case status could not refresh: ${message(cause)}`);}
      finally{inFlight=false;schedule();}
    }
    const onFocus=()=>{clearTimeout(timer);void refreshStatus();};
    schedule();window.addEventListener('focus',onFocus);document.addEventListener('visibilitychange',onFocus);
    return()=>{active=false;clearTimeout(timer);window.removeEventListener('focus',onFocus);document.removeEventListener('visibilitychange',onFocus);};
  },[api,detailOnly.caseId,!!detailOnly.liveReview,hasActiveCaseWork,busy,dirty,scopeEditing,reassessmentOpen,approvalUnconfirmed]);
  async function run(work:()=>Promise<void>,success?:string){selectedRequest.current++;setBusy(true);setError('');setNotice('');try{await work();if(success)setNotice(success);}catch(cause){setError(message(cause));}finally{setBusy(false);}}
  function maySwitch(){if(scopeEditing)return false;return !dirty||window.confirm('Discard your unsaved edits and open another item?');}
  function resetReview(){setPreview(null);approvalSubmission.current=null;setApprovalUnconfirmed(false);}
  function install(value:VocabularyContentProposal){setFreshReassessmentSource(null);setCoverageChanged(false);setExcludedKeys(new Set());setSnapshotOutdated(false);setSelected(value);setEditing(false);const text=pretty(draftOf(value));setDraftText(text);setSavedText(text);setReviewNote('');setReason('');setDetailsOpen(false);resetReview();}
  function changeDraft(next:VocabularyProposalDraft){setDraftText(pretty(next));resetReview();}
  async function fetchSnapshot(value:VocabularyContentProposal):Promise<ReviewSnapshot>{
    if(['applied','closed'].includes(value.status)){
      const [proposal,workspace]=await Promise.all([api.proposal(value.proposalId),value.caseId?api.workspace(value.caseId):Promise.resolve(null)]);
      return {proposal,assessment:workspace?.assessment??null,senseLabels:workspace?.senseLabels??[],case:workspace?.case??null,reassessment:null,previews:[]};
    }
    const batch=await api.reviewBatch(value.proposalId,1);
    const item=batch.items.find(entry=>entry.proposal.proposalId===value.proposalId);
    if(!item)throw new Error('This proposal is no longer open. Refresh the queue.');
    return item;
  }
  async function loadProposal(value:VocabularyContentProposal){
    workspaceSerial.current++;workspaceRequest.current=null;setWorkspaceLoading(false);
    const request=++selectedRequest.current,epoch=cache.current.epoch();
    const snapshot=cache.current.get(snapshotKey(value))??await fetchSnapshot(value);
    if(request!==selectedRequest.current)return;
    if(!cache.current.setIfCurrent(snapshotKey(snapshot.proposal),snapshot,epoch))return;
    setSenseLabels(snapshot.senseLabels??[]);setDefaultSelectionFinding(snapshot.defaultSelectionFinding??null);setWorkspace(null);setReviewCase(snapshot.case);setReviewReassessment(snapshot.reassessment);setReviewAssessment(snapshot.assessment);install(snapshot.proposal);setCoverageChanged(snapshot.coverageChanged??false);setDisplay(snapshot.previews);setCurrentSources(snapshot.currentSources??[]);
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
  async function refreshSelectedSnapshot(value:VocabularyContentProposal){
    const request=selectedRequest.current,epoch=cache.current.epoch();
    const snapshot=await fetchSnapshot(value);
    if(request!==selectedRequest.current||!cache.current.setIfCurrent(snapshotKey(snapshot.proposal),snapshot,epoch))return;
    // Refresh evidence without installing over the edited full pool or inclusion set.
    setProposals(previous=>previous.map(item=>item.proposalId===snapshot.proposal.proposalId?snapshot.proposal:item));
    setReviewCase(snapshot.case);setReviewReassessment(snapshot.reassessment);setReviewAssessment(snapshot.assessment);setDisplay(snapshot.previews);setCurrentSources(snapshot.currentSources??[]);
    setSenseLabels(snapshot.senseLabels??[]);setDefaultSelectionFinding(snapshot.defaultSelectionFinding??null);
    setCoverageChanged(snapshot.coverageChanged??false);
    setSnapshotOutdated(snapshot.proposal.version!==value.version||snapshot.proposal.status!==value.status||snapshot.proposal.operations.some(operation=>operation.strategy!=='create'&&snapshot.previews.find(item=>item.operationKey===operation.operationKey)?.source?.version!==operation.expectedVersion));
  }
  function scopeSaved(scope:'case'|'word',value:VocabularySenseCoverageWorkspace){
    const request=selectedRequest.current;
    const caseId=value.review?.caseId??(selected?reviewCase?.caseId:workspace?.case.caseId)??'';
    if(scope==='case'&&!caseId)return;
    cache.current.invalidateWhere(snapshot=>scopeAffectsProposal(snapshot.proposal,scope,caseId,value.word.wordId)||scope==='word'&&snapshot.case?.wordId===value.word.wordId);
    resetReview();setFreshReassessmentSource(null);setConfirmReassessment(null);
    if(scope==='word'&&value.word.wordId===(selected?reviewCase?.wordId:workspace?.case.wordId))setDefaultSelectionFinding(null);
    setSenseLabels(previous=>mergeSenseLabels(previous,value.word.wordId,value.senses.map(sense=>({senseId:sense.senseId,wordId:sense.wordId,label:typeof sense.description==='string'?sense.description:sense.description&&typeof sense.description==='object'&&!Array.isArray(sense.description)&&typeof sense.description.label==='string'?sense.description.label:'Sense label unavailable'}))));
    if(selected)void refreshSelectedSnapshot(selected).catch(cause=>{if(selectedRequest.current===request)setRefreshError(`Coverage was saved, but proposal evidence could not refresh: ${message(cause)}`);});
    else if(workspace)void api.workspace(workspace.case.caseId).then(value=>{if(selectedRequest.current===request){setWorkspace(value);setDefaultSelectionFinding(value.defaultSelectionFinding??null);}}).catch(cause=>{if(selectedRequest.current===request)setRefreshError(message(cause));});
    if(scope==='word')void reload().catch(cause=>{if(selectedRequest.current===request)setRefreshError(message(cause));});
    setNotice(scope==='word'?'Word defaults saved. Serving selection updated.':'Review coverage saved. New reassessments use this selection.');
  }
  function startDraft(source:VocabularyContent){if(repairBlocked||!maySwitch())return;if(selected&&reviewCase)setWorkspace({case:reviewCase,sources:[source],jobs:[],proposals:[],assessment:reviewAssessment??undefined,senseLabels});setCurrentSources([source]);setDisplay([{operationKey:'repair-1',source,result:authored(source)}]);setDetailsOpen(false);const next:VocabularyProposalDraft={caseId:selected?.caseId??workspace?.case.caseId,
    rationale:'',operations:[{operationKey:'repair-1',scope:source.accessScope==='shared'?{kind:'shared'}:{kind:'learner',learnerId:source.ownerLearnerId!},
      strategy:'update_existing',sourceContentId:source.contentId,expectedVersion:source.version,rationale:'',content:authored(source)}]};setExcludedKeys(new Set());setSelected(null);setCoverageChanged(false);setSnapshotOutdated(false);setEditing(true);setSavedText('');changeDraft(next);setNotice('');}
  function strategy(index:number,next:'create'|'update_existing'|'replace'|'retire') {
    if(!draft)return;const operation=draft.operations[index];if(!operation)return;
    const base=operation.strategy==='create'?draft.bases?.[index]??draft.bases?.[0]:{contentId:operation.sourceContentId,expectedVersion:operation.expectedVersion};
    const source=workspace?.sources.find(source=>source.contentId===(base?.contentId??operation.content.contentId))??display?.find(item=>item.source?.contentId===(base?.contentId??operation.content.contentId))?.source??workspace?.sources.find(source=>source.kind===operation.content.kind);
    if(next!=='create'&&!base&&!source){setError('Open the source case to select an existing content identity.');return;}
    const sourceId=base?.contentId??source?.contentId??operation.content.contentId??'',sourceVersion=base?.expectedVersion??source?.version??1;
    const content={...operation.content,contentId:next==='update_existing'||next==='retire'?sourceId:operation.content.contentId===sourceId?crypto.randomUUID():operation.content.contentId??crypto.randomUUID(),
      ...(next==='update_existing'&&source?{originKind:source.originKind,authorKind:source.authorKind,authorId:source.authorId,accessScope:source.accessScope,ownerLearnerId:source.ownerLearnerId}:{})};
    const common={operationKey:operation.operationKey,scope:operation.scope,rationale:operation.rationale,...(operation.learningRole?{learningRole:operation.learningRole}:{}),content};
    const changed:VocabularyProposalOperation=next==='create'?{...common,strategy:'create'}:{...common,strategy:next,sourceContentId:sourceId,expectedVersion:sourceVersion};
    changeDraft({...draft,bases:base?draft.bases??[base]:draft.bases,operations:draft.operations.map((old,i)=>i===index?changed:old)});
  }
  function save(){if(scopeEditing||busy||repairBlocked)return;void run(async()=>{if(!draft)throw new Error('Fix the JSON draft before saving.');if(invalidCue)throw new Error('Fix the Mandarin cloze before saving.');if(!activeOperations.length)throw new Error('Select at least one change to save, or dismiss the proposal.');const outgoing=selectedProposalDraft(draft,excludedKeys);const value=selected?await api.save(selected.proposalId,selected.version,outgoing):await api.create(outgoing);await loadProposal(value);await reload(value.proposalId);},'New version saved.');}
  function invalidateOnConflict(cause:unknown,value:VocabularyContentProposal){if(cause instanceof ApiRequestError&&cause.status===409){cache.current.delete(snapshotKey(value));setSnapshotOutdated(true);}throw cause;}
  function inspect(){if(!selected||dirty||scopeEditing||busy)return;void run(async()=>{try{setPreview(await api.preview(selected.proposalId,selected.version));}catch(cause){invalidateOnConflict(cause,selected);}},'Preview validated. Review the cue, expected answers, scope and identity effects.');}
  async function advanceAfterResolution() {
    await detailOnly.onChanged(detailOnly.caseId,selected?.proposalId);
  }
  function approveAndApply(){if(!selected||dirty||scopeEditing||repairBlocked)return;void run(async()=>{
    approvalSubmission.current??={requestId:crypto.randomUUID(),proposalId:selected.proposalId,expectedVersion:selected.version,notes:reviewNote};
    const submission=approvalSubmission.current;
    let result:VocabularyApprovalRequest;
    try{result=await api.requestApproval(submission.proposalId,submission.expectedVersion,submission.requestId,submission.notes);}
    catch(cause){setApprovalUnconfirmed(!(cause instanceof ApiRequestError&&cause.status>=400&&cause.status<500));invalidateOnConflict(cause,selected);throw cause;}
    setApprovalUnconfirmed(false);
    setApprovalRequests(items=>mergeApprovalRequests(items,[result]));
    await advanceAfterResolution();
    setNotice(result.status==='succeeded'?'Applied.':result.status==='attention'?'Approval needs attention.':'Approval queued.');
  });}
  function dismissProposal(){if(!selected||scopeEditing||busy)return;void run(async()=>{await api.close(selected.proposalId,selected.version,reason);setSelected({...selected,status:'closed'});install(await api.proposal(selected.proposalId));await advanceAfterResolution();},'Dismissed.');}
  function resolveCurrentCase(closeView:boolean){
    if(!workspace||scopeEditing||busy||caseLocked)return;const caseId=workspace.case.caseId;
    void run(async()=>{if(detailOnly&&workspace.case.review)await api.resolveCaseReview(caseId,workspace.case.review.version,reason);else await api.closeCase(caseId,reason);await reload();if(closeView)setWorkspace(null);else setWorkspace(await api.workspace(caseId));},'Case closed; its evidence remains retained.');
  }
  const queuedApprovals=approvalRequests.filter(item=>item.status==='queued'||item.status==='running');
  const proposalOutdated=!!selected&&proposals.some(item=>item.proposalId===selected.proposalId&&(item.version!==selected.version||(['applied','closed'].includes(item.status)&&item.status!==selected.status)));
  const itemOutdated=!!selected&&(snapshotOutdated||proposalOutdated||coverageChanged||detailStale);
  const noChangeVisible=!!workspace&&workspace.case.kind==='exercise_improvement'&&workspace.case.status==='completed'&&!selected&&!draftText;
  const reassessmentCase=selected?reviewCase:workspace?.case;
  const liveCase=detailOnly?.liveReview?.caseId===reassessmentCase?.caseId?detailOnly?.liveReview:null;
  const reassessmentLatest=liveCase
    ?liveCase.latestJob&&!liveCase.latestJob.advisory&&liveCase.latestJob.sequence>1?{caseId:liveCase.caseId,...liveCase.latestJob}:null
    :selected?reviewReassessment?.latest:workspace?.reassessment;
  const canReassess=queue!=='history'&&!!reassessmentCase&&(selected?!!reviewReassessment?.eligible:workspace?.case.kind==='exercise_improvement'&&!!workspace.reassessmentSource);
  const reassessmentSource=freshReassessmentSource&&freshReassessmentSource.caseId===reassessmentCase?.caseId?freshReassessmentSource.source:selected?reviewReassessment?.source:workspace?.reassessmentSource;
  const reassessmentConfirmationKey=reassessmentCase&&reassessmentSource?`${reassessmentCase.caseId}/${reassessmentSource.currentVersion}`:null;
  const confirmingReassessment=!!reassessmentConfirmationKey&&confirmReassessment===reassessmentConfirmationKey;
  const reassessmentPending=liveCase?!!liveCase.activeJob:!!reassessmentLatest&&['queued','running'].includes(reassessmentLatest.status);
  const submitReassessment=(confirmedVersion?:number)=>void run(async()=>{
    if(!reassessmentCase)throw new Error('Assessment source is unavailable. Reload the review.');
    const current=await api.workspace(reassessmentCase.caseId),source=current.reassessmentSource;
    if(detailOnly&&reassessmentCase.review?.version!==current.case.review?.version){await detailOnly.onChanged(detailOnly.caseId);throw new Error('This case changed. Reload its details before requesting reassessment.');}
    if(!source)throw new Error('Current exercise is unavailable for reassessment.');
    setFreshReassessmentSource({caseId:reassessmentCase.caseId,source});
    if(selected)setReviewReassessment({eligible:true,source,latest:current.reassessment??null});
    else setWorkspace(previous=>previous?.case.caseId===reassessmentCase.caseId?{...previous,reassessmentSource:source,reassessment:current.reassessment}:previous);
    if(source.currentVersion!==source.assessedVersion&&confirmedVersion!==source.currentVersion){setConfirmReassessment(`${reassessmentCase.caseId}/${source.currentVersion}`);return;}
    const result=detailOnly&&current.case.review?await api.reassessCaseReview(reassessmentCase.caseId,current.case.review.version,reassessmentModel,source.currentVersion,selected?{proposalId:selected.proposalId,expectedVersion:selected.version}:undefined):await api.reassessCase(reassessmentCase.caseId,reassessmentModel,source.currentVersion,selected?{proposalId:selected.proposalId,expectedVersion:selected.version}:undefined);
    setConfirmReassessment(null);
    const latest={...result,status:'queued',error:null};
    if(selected){setReviewReassessment({eligible:true,source,latest});cache.current.delete(snapshotKey(selected));}
    else setWorkspace(previous=>previous?.case.caseId===reassessmentCase.caseId?{...previous,reassessmentSource:source,reassessment:latest}:previous);
    setReassessmentOpen(false);await reload();setNotice('Reassessment queued.');
  });
  const reassessmentDisabled=busy||dirty||scopeEditing||reassessmentPending||caseLocked;
  const scopeCase=selected?reviewCase:workspace?.case;
  const reassessmentUnavailableReason=scopeCase?.kind==='teaching_review'?undefined:selected?reviewReassessment?.unavailableReason:workspace?.reassessmentUnavailableReason;
  const repairTargetControl=scopeCase?.kind==='exercise_improvement'&&scopeCase.wordId?(
    <RepairTargetEditor key={scopeCase.caseId} api={api} caseId={scopeCase.caseId} revision={scopeCase.review?.version} disabled={busy||dirty||!!selectedApproval||approvalUnconfirmed||caseLocked} onState={setRepairTarget} onActivity={setScopeEditing} onSaved={async()=>{setEditing(false);resetReview();await reload();}}/>
  ):null;
  const reassessmentControl=canReassess&&reassessmentCase?<>
    <button className="secondary-button" aria-haspopup="dialog" disabled={reassessmentDisabled} onClick={()=>setReassessmentOpen(true)}>Reassess{repairTarget?.blocked?' · target pending':''}</button>
    <ReassessmentDialog open={reassessmentOpen} onClose={()=>{setReassessmentOpen(false);setConfirmReassessment(null);}} busy={busy||scopeEditing}>
    {error&&<p role="alert">{error}</p>}
    {repairTargetControl}
    <div className="vocabulary-reassessment-control">
    <label>Model for reassessment<select aria-label="Model for reassessment" disabled={reassessmentDisabled} value={reassessmentModel} onChange={event=>setReassessmentModel(event.target.value as VocabularyReassessmentModel)}><option value="openai:gpt-6-sol-high">GPT-6 Sol high</option><option value="openai:gpt-6-luna-high">Luna high</option><option value="zai:glm-5.3-flash-high">GLM-5.3 Flash high</option></select></label>
    {confirmingReassessment&&reassessmentSource?<div className="vocabulary-reassessment-confirmation" role="group" aria-label="Confirm changed source version">
      <p>Source changed from v{reassessmentSource.assessedVersion} to v{reassessmentSource.currentVersion}. Reassessment uses the current exercise.</p>
      <button className="secondary-button" autoFocus disabled={reassessmentDisabled} onClick={()=>submitReassessment(reassessmentSource.currentVersion)}>Reassess v{reassessmentSource.currentVersion}</button>
      <button className="secondary-button" disabled={busy} onClick={()=>setConfirmReassessment(null)}>Cancel</button>
    </div>:<button disabled={reassessmentDisabled} onClick={()=>submitReassessment()}>Submit reassessment</button>}
    {reassessmentLatest&&<span role="status">{reassessmentPending?'Reassessment '+reassessmentLatest.status:reassessmentLatest.status==='failed'?'Reassessment failed. You can reassess again.':'Reassessment complete'}</span>}
  </div></ReassessmentDialog></>:null;
  const scopeEditor=queue!=='history'&&scopeCase?.kind==='exercise_improvement'&&scopeCase.wordId?<>
    {!canReassess&&repairTargetControl}
    {repairTarget?.caseId===scopeCase.caseId&&!repairTarget.available&&<><ScopeCoverageEditor key={scopeCase.wordId} api={api} wordId={scopeCase.wordId} disabled={busy||dirty||!!selectedApproval||approvalUnconfirmed||caseLocked} finding={defaultSelectionFinding} onActivity={setScopeEditing} onSaved={scopeSaved} repertoire={selected&&editable&&reviewAssessment?.admission?.outcome==='repertoire_bootstrap'?{proposal:selected,reassessment:canReassess&&reassessmentSource&&scopeCase.review?{caseVersion:scopeCase.review.version,source:reassessmentSource,onQueued:()=>{void run(async()=>{await reload(selected.proposalId);},'Selection saved. Reassessment queued.');}}:undefined,onSaved:value=>{void run(async()=>{await loadProposal(value);await reload(value.proposalId);},'Defaults and proposal updated.');}}:undefined}/></>}
  </>:null;
  const caseEntryVisible=!!workspace&&!selected&&!draftText&&!noChangeVisible;
  return <section ref={pageRef} className="vocabulary-operator-page vocabulary-full-review" tabIndex={0} aria-label={detailOnly.caseId?'Case details':'Proposal details'}>
    <header><h2>{detailOnly.caseId?'Case details':'Proposal details'}</h2><button className="secondary-button" disabled={busy} onClick={()=>void run(async()=>{await reload();},'Details refreshed.')}>Refresh</button></header>
    {refreshError&&<p role="alert" className="vocabulary-operator-error">{refreshError}</p>}{error&&<p role="alert" className="vocabulary-operator-error">{error}</p>}{notice&&<p role="status">{notice}</p>}
    {queuedApprovals.length>0&&<p role="status">{queuedApprovals.length} approval{queuedApprovals.length===1?'':'s'} queued</p>}
    <div className="vocabulary-operator-single"><div className="vocabulary-operator-detail">
      {(selected||draftText)&&<ContentImprovementEntry assessedVersion={(selected?reviewCase:workspace?.case)?.reassessmentSource?.version} label="Proposal review" evidence={selected?proposalServedEvidence(selected.caseId,reviewCase?{caseId:reviewCase.caseId,evidence:reviewCase.evidence}:null):workspace?.case.evidence??null}><h2>{selected?proposalTitle(selected):'New correction draft'}</h2>{selected&&<p>{readableSenseProse(proposalSummary(selected),senseLabels)}</p>}{selectedApproval&&<p role="status">Approval queued · revision {selectedApproval.expectedVersion}</p>}{dirty&&<p role="status">Unsaved changes</p>}{itemOutdated&&<p role="alert">{coverageChanged?'The proposal was assessed against earlier evidence. Compare the current source below, then dismiss, reassess, or draft a separate correction.':'This proposal or its source has changed or is unavailable.'} <button disabled={busy||scopeEditing} onClick={()=>{cache.current.invalidateWhere(snapshot=>snapshot.proposal.proposalId===selected!.proposalId);void refreshSelectedSnapshot(selected!).catch(cause=>setError(message(cause)));}}>Refresh snapshot</button>{proposalOutdated&&<button disabled={busy||scopeEditing} onClick={()=>{cache.current.invalidateWhere(snapshot=>snapshot.proposal.proposalId===selected!.proposalId);openProposal(proposals.find(item=>item.proposalId===selected!.proposalId)??selected!);}}>Load current proposal</button>}</p>}

        {scopeEditor}
        {selected&&<AssessmentReview assessment={reviewAssessment} senses={senseLabels} operator={selected.authorKind==='operator'}/>}
        {!canReassess&&reassessmentUnavailableReason&&<p className="vocabulary-operator-meta">Reassessment unavailable: {reassessmentUnavailableReason}</p>}
        {draft&&<CompactProposalReview currentSources={currentSources} bases={draft.bases??[]} stale={itemOutdated} onDraftCorrection={startDraft} operations={draft.operations} previews={display??[]} senses={senseLabels} excluded={excludedKeys} disabled={!editable||busy||approvalUnconfirmed} editing={editing} toggle={key=>{setExcludedKeys(keys=>toggleOperation(keys,key));resetReview();}} onChange={(key,change)=>changeDraft({...draft,operations:draft.operations.map(operation=>operation.operationKey===key?change(operation):operation)})} onStrategy={strategy}/>}
        {zeroSelected&&<p role="status">No changes selected. <button className="secondary-button" disabled={busy} onClick={()=>{setExcludedKeys(new Set());if(draft?.operations.length===0&&selected)changeDraft(draftOf(selected));resetReview();}}>Restore selection</button></p>}
        {dirty&&!editing&&editable&&<div className="vocabulary-operator-actions"><button disabled={busy||scopeEditing||!draft||zeroSelected||invalidCue||approvalUnconfirmed} onClick={save}>Save changes</button></div>}
        {selected&&<ProposalSecondOpinion expanded={detailsOpen} key={selected.proposalId} api={api} proposal={selected} eligible={editable&&reviewCase?.kind==='exercise_improvement'} disabled={busy||scopeEditing||dirty||itemOutdated||approvalUnconfirmed} actions={secondOpinionAction=>editable||repairBlocked?<div className="vocabulary-operator-actions vocabulary-review-actions"><button disabled={repairBlocked||busy||scopeEditing||dirty||itemOutdated||zeroSelected} onClick={approveAndApply}>{approvalUnconfirmed?'Retry approval':'Approve and apply'}</button><button className="secondary-button" disabled={busy||scopeEditing||approvalUnconfirmed||repairBlocked&&!editing} onClick={()=>{if(!editing)void loadWorkspaceForProposal(selected);setEditing(!editing);}}>{editing?'Close editor':'Edit proposal'}</button><button className="secondary-button" disabled={busy||scopeEditing||(!zeroSelected&&dirty)||proposalOutdated||approvalUnconfirmed} onClick={dismissProposal}>Dismiss</button>{secondOpinionAction}{reassessmentControl}</div>:null}/>}
        {editing&&<div className="vocabulary-proposal-editor"><h3>Edit proposal</h3>
        {draft?<label>Diagnosis and overall rationale<textarea disabled={!editable||busy||approvalUnconfirmed} value={draft.rationale} onChange={event=>changeDraft({...draft,rationale:event.target.value})}/></label>:<p role="status">The JSON draft is incomplete. Fix it below before saving.</p>}
        <details className="vocabulary-full-draft"><summary>Full authored draft</summary><label>Draft JSON (including excluded items)<textarea className="vocabulary-operator-json" rows={18} value={draftText} disabled={busy||!editable||approvalUnconfirmed} spellCheck={false} onChange={event=>{setDraftText(event.target.value);resetReview();}}/></label></details>
        {editable&&<div className="vocabulary-operator-actions"><button disabled={busy||scopeEditing||!draft||!dirty||zeroSelected||invalidCue||approvalUnconfirmed} onClick={save}>{selected?'Save new version':'Save draft'}</button><button className="secondary-button" disabled={busy||scopeEditing||!selected||dirty} onClick={inspect}>Validate and preview saved version</button></div>}
        </div>}

      </ContentImprovementEntry>}
      {noChangeVisible&&workspace&&<ContentImprovementEntry assessedVersion={workspace.case.reassessmentSource?.version} label="No change judgment" evidence={workspace.case.evidence}><AssessmentReview assessment={workspace.assessment} senses={senseLabels}/>{!canReassess&&reassessmentUnavailableReason&&<p>Reassessment unavailable: {reassessmentUnavailableReason}</p>}
        <h2>{workspace.sources.flatMap(source=>source.kind==='exercise'?source.answers.map(answer=>answer.acceptedForms[0]):[]).filter(Boolean).join(' · ')||workspace.case.wordId||'Content review'}</h2>
        {scopeEditor}
        <p><strong>No change proposed</strong></p><p>{readableSenseProse(diagnosisSummary(workspace.diagnosis),senseLabels)}</p>
        {workspace.jobs.filter(job=>job.secondOpinion).map(job=><div className="vocabulary-second-opinion" key={job.jobId}>{job.result?<><p><strong>{{support:'Supports no change',revise:'Suggests revision',reject:'Recommends a change'}[job.result.verdict]}</strong></p><p>{detailsOpen?job.result.rationale:brief(job.result.rationale)}</p></>:<p role="status">Second opinion: {job.status}</p>}{job.status==='failed'&&job.error!=='source_conflict'&&<button disabled={busy} onClick={()=>void run(async()=>{await api.retryJob(job.jobId);setWorkspace(await api.workspace(workspace.case.caseId));})}>Retry second opinion</button>}</div>)}
        {detailOnly&&queue==='detail'&&<div className="vocabulary-operator-actions"><button disabled={busy||scopeEditing||caseLocked} onClick={()=>resolveCurrentCase(true)}>Done</button><button className="secondary-button" disabled={busy||scopeEditing||caseLocked||workspace.jobs.some(job=>job.secondOpinion&&['queued','running'].includes(job.status))} onClick={()=>void run(async()=>{await api.requestCaseSecondOpinion(workspace.case.caseId,caseNotes);setCaseNotes('');setWorkspace(await api.workspace(workspace.case.caseId));},'Second opinion queued.')}>Second opinion</button>{reassessmentControl}</div>}
      </ContentImprovementEntry>}
        {workspace&&promotionNeedsAttention&&workspace.pureCueIdentityOptions&&queue!=='history'&&workspace.case.status!=='closed'&&<PureCueIdentityResolution key={`identities:${workspace.case.caseId}`} options={workspace.pureCueIdentityOptions} disabled={busy||dirty||scopeEditing||reassessmentPending||caseLocked} onSubmit={(model,selections)=>void run(async()=>{
          if(!workspace.admission)throw new Error('Source assessment is unavailable.');
          const result=await api.resolvePureCueIdentities(workspace.case.caseId,model,workspace.admission.sourceContentVersion,selections);
          setWorkspace({...workspace,reassessment:{...result,status:'queued',error:null}});
          if(selected)setReviewReassessment(previous=>previous?{...previous,latest:{...result,status:'queued',error:null}}:previous);
          await reload();
        },'Promotion assessment queued. Content still requires review.')} />}
      {caseEntryVisible&&workspace&&<ContentImprovementEntry assessedVersion={workspace.case.reassessmentSource?.version} label="Content improvement entry" evidence={workspace.case.evidence}><AssessmentReview assessment={workspace.assessment} senses={senseLabels}/>{!canReassess&&reassessmentUnavailableReason&&<p>Reassessment unavailable: {reassessmentUnavailableReason}</p>}{scopeEditor}{reassessmentControl}</ContentImprovementEntry>}
      {(workspace||selected)&&<details key={selected?.proposalId??workspace?.case.caseId} open={detailsOpen} onToggle={event=>{const open=event.currentTarget.open;setDetailsOpen(open);if(open&&selected)void loadWorkspaceForProposal(selected);}} className="vocabulary-evidence"><summary>Details</summary>
        {selected&&<section><h3>Proposal details</h3><p>{selected.rationale}</p><p className="vocabulary-operator-meta">{selected.status.replaceAll('_',' ')} · revision {selected.version}</p>{selected.operations.map(operation=><p key={operation.operationKey}>{operation.rationale}</p>)}
          {preview&&<section><h3>Schedule and relationship effects</h3><div className="vocabulary-operator-table" role="region" aria-label="Identity relationship effects" tabIndex={0}><table><caption>Identity-bound relationships; no automatic transfer</caption><thead><tr><th>Change</th><th>Scope</th><th>Learner schedules for this cue</th><th>Deactivations</th><th>Teaching references</th><th>Sense relationships</th><th>Curation records</th></tr></thead><tbody>{preview.operations.map(item=><tr key={item.operationKey}><th>{labels[item.strategy]}</th><td>{item.scope.kind==='shared'?'Shared':`Private: ${item.scope.learnerId}`}</td><td>{item.schedulesRemainOnSource}</td><td>{item.deactivationsRemainOnSource}</td><td>{item.teachingBindingsRemainOnSource+item.sourceIntroductionExercises}</td><td>{item.sourceSenseMappings}</td><td>{item.sourceCurations}</td></tr>)}</tbody></table></div></section>}
          {editable&&<><button className="secondary-button" disabled={busy||scopeEditing||dirty||itemOutdated||approvalUnconfirmed} onClick={inspect}>Validate proposal and show relationship effects</button><label>Approval note (optional)<textarea value={reviewNote} disabled={busy||approvalUnconfirmed} onChange={event=>setReviewNote(event.target.value)}/></label><label>Dismissal reason (optional)<textarea value={reason} disabled={busy} onChange={event=>setReason(event.target.value)}/></label></>}
        </section>}
        {workspace&&!selected&&<section><h3>Assessment</h3><ReadableJson value={workspace.diagnosis??null}/><label>Reason (optional)<textarea value={reason} disabled={busy||queue==='history'} onChange={event=>setReason(event.target.value)}/></label>{workspace.case.kind==='exercise_improvement'&&queue==='detail'&&<label>Question for second opinion (optional)<textarea value={caseNotes} disabled={busy} onChange={event=>setCaseNotes(event.target.value)}/></label>}</section>}
        {selected?.caseId&&!workspace&&<p role="status">{workspaceLoading?'Loading case details…':<button className="secondary-button" onClick={()=>void loadWorkspaceForProposal(selected)}>Load case details</button>}</p>}
        {detailOnly&&workspace&&workspace.proposals.length>1&&<section aria-label="Retained proposals"><h3>Retained proposals</h3><ul>{workspace.proposals.map(value=><li key={value.proposalId}><button className="secondary-button" disabled={busy||scopeEditing} onClick={()=>{if(maySwitch())detailOnly.onSelectProposal(value.proposalId);}}>{value.rationale||value.proposalId} · revision {value.version} · {value.status}</button></li>)}</ul></section>}
        {workspace&&<section aria-label="Case evidence"><h2>{kinds[workspace.case.kind]}</h2><p className="vocabulary-operator-meta">Learner {workspace.case.learnerId} · {workspace.case.status}</p>
        {workspace.admission&&<section aria-label="Sense assessment"><h3>{admissionLabels[workspace.admission.outcome]}</h3><p>{workspace.admission.rationale}</p>{admissionNeedsAttention&&<p>No automatic repair or sense expansion follows this finding. Learner feedback is processed independently.</p>}<pre>{pretty(workspace.admission)}</pre></section>}
        {workspace.pureCueReferral&&<section aria-label="Pure cue assessment"><h3>Pure cue exploration</h3><p>{workspace.pureCueReferral.candidateWords.join(' · ')}</p><p>{workspace.pureCueReferral.sharedPurpose}</p>{workspace.pureCuePromotion&&<><p><strong>{{reject:'Referral rejected',reuse:'Existing cue fits',extend:'Proposed membership extension',create:'Proposed new cue',needs_operator:'Candidate words need review'}[workspace.pureCuePromotion.outcome]}</strong></p><p>{workspace.pureCuePromotion.rationale}</p></>}<p>{workspace.pureCueReferral.rationale}</p><pre>{pretty(workspace.pureCuePromotion)}</pre></section>}
        {workspace.jobs.map(job=><div className="vocabulary-operator-job" key={job.jobId}><span>{job.caseSequence?`Job ${job.caseSequence} · `:''}{job.secondOpinion?'Advisory opinion':job.kind==='learner_feedback'?'Learner feedback':'Assessment'} · {job.status} · attempt {job.attemptNumber}</span>{job.status==='failed'&&job.error!=='source_conflict'&&<button disabled={busy} onClick={()=>void run(async()=>{await api.retryJob(job.jobId);setWorkspace(await api.workspace(workspace.case.caseId));await reload();},'Processing queued. Other feedback and proposals remain independent.')}>Retry processing</button>}{job.error&&<p>{job.error==='provider_outcome_unknown'?'The provider outcome is unknown. An explicit retry may make another call.':job.error}</p>}</div>)}
        <h3>What the learner encountered</h3>{workspace.case.evidence.map(encounter=><article className="vocabulary-operator-encounter" key={encounter.encounterId}><p className="vocabulary-operator-meta">{encounter.snapshot.role} · {encounter.snapshot.kind} · content version {encounter.snapshot.contentVersion}{encounter.skipped?' · skipped':''}</p><p className="vocabulary-operator-cue">{encounter.snapshot.body.prompt}</p>
          {encounter.snapshot.kind==='introduction'&&encounter.snapshot.body.material!==undefined&&<ReadableJson value={encounter.snapshot.body.material}/>}
          {encounter.snapshot.assessment&&<p><strong>Expected answers:</strong> {encounter.snapshot.assessment.acceptedAnswers.join(' / ')}</p>}
          {encounter.responses.length?<ul>{encounter.responses.map(response=><li key={response.actionId}>{response.payload.response??'No answer'} · {response.payload.outcome}{!encounter.effectiveResponses.some(item=>item.actionId===response.actionId)?' · undone':''}</li>)}</ul>:<p>No answer was submitted.</p>}
          {getEffectiveVocabularyEncounterReactions(encounter).map(reaction=><p key={reaction.actionId}><strong>Learner reaction:</strong> {reaction.payload.comment||reaction.payload.feedback}</p>)}
          <h4>Retained encounter and reaction history</h4><pre>{pretty(encounter)}</pre></article>)}
        {workspace.case.kind!=='learner_feedback'&&<><h3>{workspace.case.kind==='teaching_review'?'Current introduction and teaching repertoire':'Current authored content'}</h3><p>Draft from the current version below. The encounters above preserve what was actually served.</p>{workspace.sources.map(source=><article key={source.contentId} className="vocabulary-operator-source"><h4>{source.kind==='introduction'?'Introduction':source.kind==='exercise'&&source.exerciseRole==='teaching'?'Teaching exercise':'General exercise'} · version {source.version}</h4><AuthoredContent content={source} expandDetails/><p className="vocabulary-operator-meta">{source.contentId} · {source.accessScope} · {source.availability}</p><button disabled={busy||scopeEditing||caseLocked||repairBlocked} onClick={()=>startDraft(source)}>{selected?'Create a separate correction':'Draft a correction'}</button></article>)}</>}
        {(workspace.case.kind==='teaching_review'||admissionNeedsAttention||promotionNeedsAttention)&&<div className="vocabulary-operator-close"><label>Review note (optional)<textarea value={reason} onChange={event=>setReason(event.target.value)}/></label><button className="secondary-button" disabled={busy||scopeEditing||caseLocked||workspace.case.status==='closed'} onClick={()=>resolveCurrentCase(false)}>{workspace.case.kind==='teaching_review'?'Close teaching case':promotionNeedsAttention?'Close pure cue assessment':'Close sense assessment'}</button></div>}
      </section>}</details>}
    </div></div>
  </section>;
}
