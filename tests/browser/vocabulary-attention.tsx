import React from 'react';
import App from '../../src/App';
import { createRoot } from 'react-dom/client';
import '../../src/styles.css';
import { VocabularyCaseReviewPage } from '../../src/pages/VocabularyCaseReviewPage';
import { OperatorShell } from '../../src/OperatorApp';
import { vocabularyOperatorApi, type VocabularyOperatorApi, type VocabularyCaseWorkspace } from '../../src/features/vocabulary-operator/api';
import type { VocabularyAttentionItem } from '../../src/domain/vocabulary-attention';
import type { VocabularySenseCoverageWorkspace } from '../../src/domain/vocabulary-sense-coverage';
import type { VocabularyContent } from '../../src/domain/vocabulary-content';
import type { VocabularyContentProposal, VocabularyApprovalRequest } from '../../src/domain/vocabulary-reflection';
import { ApiRequestError } from '../../src/services/api';

const params = new URLSearchParams(location.search || import.meta.env.VITE_TESTBED_QUERY || '');
const at = '2026-11-05T12:00:00.000Z';
const copy = <T,>(value: T): T => structuredClone(value);
const finding = {status:'needs_operator' as const,reason:'No useful senses were selected from the nonempty inventory.',invocationId:'selector-invocation',recommendedSenseIds:[]};
const base = {createdAt:at,caseId:null};
let items: VocabularyAttentionItem[] = params.has('empty') ? [] : [
  {...base,id:'defaults:函',kind:'defaults',title:'函',reason:finding.reason,wordId:'word-han',finding},
  {...base,id:'approval:standalone',kind:'approval',title:'报备',reason:'Application stopped after a temporary database failure.',requestId:'standalone-request',proposalId:'standalone-proposal',expectedVersion:1,attempts:1,retryable:true},
  {...base,id:'preparation:failed',kind:'preparation',title:'密集',reason:'Practice preparation could not finish after its bounded retries.',workId:'failed-preparation',wordId:'word-miji',sourceContentId:'source-practice',attemptCount:3,invocationId:'preparation-call',retryable:true},
  {...base,id:'dispatch:failed',kind:'dispatch',title:'Study session',reason:'Encounter evidence processing failed before review cases could be created.',dispatchId:'failed-dispatch',sessionId:'session-with-retained-evidence',learnerId:'fixture-learner'},
  {...base,id:'case:feedback',kind:'case',title:'Learner feedback',reason:'The feedback provider outcome is unknown. Retrying may make another call.',caseId:'feedback-case',caseKind:'learner_feedback',jobId:'feedback-job',retryable:true,sourceSuperseded:false,dismissible:false},
  {...base,id:'approval:stale',kind:'approval',title:'报备 · source changed',reason:'The approved source version has changed. Revise the proposal before applying it.',requestId:'stale-request',proposalId:'stale-proposal',expectedVersion:1,attempts:2,retryable:false},
  {...base,id:'preparation:exhausted',kind:'preparation',title:'A very long preparation target label that must wrap without hiding controls',reason:'Attempt limit reached. Inspect the retained invocation before changing preparation.',workId:'exhausted-preparation',wordId:'word-long',sourceContentId:'source-with-a-long-stable-identity',attemptCount:9,invocationId:null,retryable:false},
  ...Array.from({length:22},(_,index):VocabularyAttentionItem=>({...base,id:`dispatch:extra-${index}`,kind:'dispatch',title:`Retained session ${index+1}`,reason:'Evidence processing requires an explicit retry.',dispatchId:`extra-${index}`,sessionId:`session-${index}`,learnerId:'fixture-learner'})),
];
if (params.has('canonical')) items = [{...base,id:'preparation:failed',kind:'preparation',title:'挂钩',reason:'Repertoire replacement failed while teaching is still pending.',workId:'failed-preparation',wordId:'word-guagou',sourceContentId:null,reconciliationId:'resolution-canonical-snapshot',attemptCount:3,invocationId:'preparation-call',retryable:true}];
if (params.has('superseded')) items = [{...base,id:'case:superseded',kind:'case',title:'他',reason:'The source has changed or been retired.',caseId:'superseded',caseKind:'exercise_improvement',jobId:'superseded-job',retryable:false,sourceSuperseded:true,dismissible:true}];
let slow=params.has('slow'),failSave=params.has('saveFailure'),failRetry=false,holdRead=false;
const heldReads:(()=>void)[]=[];
const counters:Record<string,number>={attention:0,workspace:0,proposal:0,snapshot:0,save:0,retry:0};
const controls=document.getElementById('fixture-controls')!;
controls.style.cssText='background:#eef6f4;padding:.5rem;border-bottom:1px solid #abc;';
const counter=document.createElement('output');counter.setAttribute('aria-label','Fixture request counters');controls.append(counter);
function count(key:string){counters[key]++;counter.textContent=Object.entries(counters).map(([label,value])=>`${label}: ${value}`).join(' · ');}
function control(label:string,action:()=>void){const button=document.createElement('button');button.textContent=label;button.style.margin='.25rem';button.onclick=action;controls.append(button);}
control('Toggle slow requests',()=>{slow=!slow;document.body.dataset.slow=String(slow);});
control('Fail next save',()=>{failSave=true;});
control('Fail next retry',()=>{failRetry=true;});
control('Hold next attention read',()=>{holdRead=true;});
control('Release attention read',()=>heldReads.splice(0).forEach(resolve=>resolve()));
control('Clear attention externally',()=>{items=[];});
control('Finish feedback',()=>{feedbackStatus='succeeded';});
if(params.has('clean'))controls.hidden=true;
async function delay(){if(slow)await new Promise(resolve=>setTimeout(resolve,900));}
function remove(id:string){items=items.filter(item=>item.id!==id);}
let selected:string[]|null=null,wordVersion=1;
function coverage():VocabularySenseCoverageWorkspace{return {
  word:{wordId:'word-han',version:wordVersion,defaultUsefulSenseIds:selected,excludedSenseIds:[]},review:null,
  includedSenseIds:selected??[],selectionEstablished:selected!==null,fingerprint:String(wordVersion),productionExerciseCounts:{'sense-letter':12,'sense-case':0},
  senses:[{senseId:'sense-letter',wordId:'word-han',description:{label:'Letter; correspondence',notes:['Formal written correspondence, including an invitation or official inquiry.']},status:'active',version:1,createdAt:at,updatedAt:at},
    {senseId:'sense-case',wordId:'word-han',description:{label:'A protective case or container for books and documents',notes:['A literary use; choosing it is a shared word-default decision.']},status:'active',version:1,createdAt:at,updatedAt:at}],
};}
const source:VocabularyContent={contentId:'source',version:1,kind:'exercise',payloadVersion:1,body:{prompt:'Before taking leave, you should ____ your supervisor.'},exerciseType:'definition',skill:'production',exerciseRole:'general',assessment:{match:'prepared_answer_membership'},accessScope:'shared',availability:'active',originKind:'model',authorKind:'service',authorId:'fixture',words:[{wordId:'word-baobei',relation:'target'}],answers:[{wordId:'word-baobei',acceptedForms:['报备']}],createdAt:at,updatedAt:at};
const proposal=(id:string):VocabularyContentProposal=>({proposalId:id,caseId:null,version:1,status:'awaiting_review',rationale:'Clarify the requirement to report a planned absence in advance.',authorKind:'operator',authorId:'fixture',invocationId:null,bases:[{contentId:'source',expectedVersion:1}],operations:[{operationKey:'repair',strategy:'update_existing',sourceContentId:'source',expectedVersion:1,scope:{kind:'shared'},rationale:'Make advance notification explicit.',content:{...source,body:{prompt:'Report your planned absence to your supervisor in advance: ____。'}}}]});
const proposals=new Map(['standalone-proposal','stale-proposal'].map(id=>[id,proposal(id)]));
function getProposal(id:string){const result=proposals.get(id);if(!result)throw new Error('Unknown fixture proposal');return copy(result);}
let feedbackStatus='failed';
function workspace(id:string):VocabularyCaseWorkspace{
  if(id==='superseded')return {case:{caseId:id,completionId:'fixture-completion',learnerId:'fixture-learner',kind:'exercise_improvement',wordId:null,contentId:'source',status:'open',createdAt:at,evidence:[{
    encounterId:'served-encounter',wordId:'word-ta',workNumber:1,presentedActionId:'presentation',presentedAt:at,mode:'practice',snapshot:{contentId:'source',contentVersion:1,role:'general',kind:'production',body:{prompt:'He is a teacher.'},assessment:{acceptedAnswers:['他'],criteria:{}}},responses:[],effectiveResponses:[],feedback:[],effectiveFeedback:[],skipped:true,presentationUndone:false,
  }]},sources:[{...source,version:2,body:{prompt:'He works as a teacher.'},answers:[{wordId:'word-ta',acceptedForms:['他']}]}],proposals:[],jobs:[{jobId:'superseded-job',kind:'exercise_improvement',status:'failed',attemptNumber:1,error:'source_conflict',secondOpinion:false,result:null}],reassessmentUnavailableReason:'The earlier assessment did not complete.'};
  if(id!=='feedback-case')throw new Error('Unexpected workspace lookup: standalone proposals have no case.');
  return {case:{caseId:id,completionId:'fixture-completion',learnerId:'fixture-learner',kind:'learner_feedback',wordId:null,contentId:null,status:feedbackStatus==='succeeded'?'completed':'open',createdAt:at,evidence:[{
    encounterId:'served-encounter',wordId:'word-baobei',workNumber:1,presentedActionId:'presentation',presentedAt:at,mode:'practice',snapshot:{contentId:'source',contentVersion:1,role:'general',kind:'production',body:{prompt:'Before taking leave, you should ____ your supervisor.'},assessment:{acceptedAnswers:['报备'],criteria:{}}},responses:[],effectiveResponses:[],feedback:[],effectiveFeedback:[],skipped:true,presentationUndone:false,
  }]},sources:[],proposals:[],jobs:[{jobId:'feedback-job',kind:'learner_feedback',status:feedbackStatus,attemptNumber:3,error:feedbackStatus==='failed'?'provider_outcome_unknown':null,secondOpinion:false,result:null}]};
}
async function retry(id:string){count('retry');await delay();if(failRetry){failRetry=false;throw new Error('Simulated retry failure; the item remains available.');}remove(id);}
function request(id:string,requestId:string):VocabularyApprovalRequest{return {requestId,proposalId:id,expectedVersion:getProposal(id).version,actorId:'fixture',notes:'',status:'queued',attempts:1,createdAt:at,updatedAt:at,error:null,application:null};}
const api:VocabularyOperatorApi={...vocabularyOperatorApi,
  caseQueue:async()=>({items:[],total:0,startIndex:0,nextCursor:null,previousCursor:null,anchorCursor:null}),
  attentionQueue:async(query={})=>{count('attention');const all=items.filter(item=>!query.kind||item.kind===query.kind);const anchor=query.anchorId?all.findIndex(item=>item.id===query.anchorId):-1;const offset=anchor>=0?Math.floor(anchor/(query.limit??20))*(query.limit??20):query.offset??0;const result=copy({items:all.slice(offset,offset+(query.limit??20)),total:all.length,offset});if(holdRead){holdRead=false;await new Promise<void>(resolve=>heldReads.push(resolve));}await delay();return result;},
  wordSenseCoverage:async()=>{await delay();return copy(coverage());},
  saveDefaultUsefulSenses:async(_word,version,ids)=>{count('save');await delay();if(failSave){failSave=false;throw new Error('Simulated save failure. Your selected senses are retained.');}if(version!==wordVersion)throw new ApiRequestError('Word defaults changed',409);selected=[...ids];wordVersion++;remove('defaults:函');return copy(coverage());},
  retryApproval:async id=>{await retry(id==='stale-request'?'approval:stale':'approval:standalone');return request(id==='stale-request'?'stale-proposal':'standalone-proposal',id);},
  retryPreparation:async id=>{await retry(id==='failed-preparation'?'preparation:failed':'preparation:exhausted');return {ok:true};},
  retryDispatch:async id=>{await retry(id==='failed-dispatch'?'dispatch:failed':`dispatch:${id}`);return {ok:true};},
  retryJob:async()=>{await retry('case:feedback');feedbackStatus='queued';return {ok:true};},
  dismissSupersededCase:async id=>{await delay();remove(`case:${id}`);return {ok:true};},
  workspace:async id=>{count('workspace');await delay();return copy(workspace(id));},
  proposal:async id=>{count('proposal');await delay();return getProposal(id);},
  reviewBatch:async id=>{count('snapshot');await delay();const value=getProposal(id);return {items:[{proposal:value,case:null,reassessment:null,assessment:null,senseLabels:[],coverageChanged:false,currentSources:[source],previews:value.operations.map(operation=>({operationKey:operation.operationKey,source,result:operation.content}))}],nextProposalId:null};},
  secondOpinions:async()=>({items:[]}),
  save:async(id,version,draft)=>{count('save');await delay();if(failSave){failSave=false;throw new Error('Simulated proposal save failure. Draft retained.');}const current=getProposal(id);if(current.version!==version)throw new ApiRequestError('Proposal version changed',409);const updated={...current,...draft,caseId:null,version:version+1};proposals.set(id,updated);return copy(updated);},
  close:async(id,version)=>{await delay();const current=getProposal(id);if(current.version!==version)throw new ApiRequestError('Proposal version changed',409);proposals.set(id,{...current,status:'closed'});remove(id==='stale-proposal'?'approval:stale':'approval:standalone');return {ok:true};},
  requestApproval:async(id,version,requestId)=>{const current=getProposal(id);if(current.version!==version)throw new ApiRequestError('Proposal version changed',409);await delay();remove(id==='stale-proposal'?'approval:stale':'approval:standalone');return request(id,requestId);},
  preview:async id=>{const value=getProposal(id);return {proposal:value,previews:value.operations.map(operation=>({operationKey:operation.operationKey,source,result:{...operation.content,contentId:operation.content.contentId??source.contentId,version:2,createdAt:at,updatedAt:at}})),operations:[]};},
  approvalRequests:async()=>({items:[]}),cases:async()=>({items:[]}),dispatches:async()=>({items:[]}),preparationFailures:async()=>({items:[]}),
};
// The testbed's app archetype uses the real root and route with this same API fixture.
if (params.has('shell')) {
  Object.assign(vocabularyOperatorApi, api);
  window.fetch = async input => { throw new Error(`Unsupported simulated request: ${String(input)}`); };
}
if(params.has('largeText'))document.documentElement.style.fontSize='22px';
if(params.has('narrow')){
  controls.hidden=true;
  const url=new URL(location.href);url.searchParams.delete('narrow');url.searchParams.set('clean','1');
  const frame=document.createElement('iframe');frame.src=url.href;frame.title='Narrow attention review';
  frame.style.cssText='width:480px;max-width:100%;height:100dvh;border:0;display:block';
  document.getElementById('root')!.append(frame);
}else createRoot(document.getElementById('root')!).render(params.has('shell') ? <App/> : <React.StrictMode><OperatorShell tab="improvement"><VocabularyCaseReviewPage api={api}/></OperatorShell></React.StrictMode>);
