import type { VocabularySenseCoverageWorkspace } from '../../src/domain/vocabulary-sense-coverage';
import React from 'react';
import {createRoot} from 'react-dom/client';
import {VocabularyOperatorPage} from '../../src/pages/VocabularyOperatorPage';
import {OperatorUsagePulsePage} from '../../src/pages/OperatorUsagePulsePage';
import type {VocabularyOperatorApi} from '../../src/features/vocabulary-operator/api';
import {ApiRequestError} from '../../src/services/api';
import type {VocabularyContent} from '../../src/domain/vocabulary-content';
import type {VocabularyApprovalRequest,VocabularyContentProposal,VocabularyReflectionCase,VocabularySecondOpinion} from '../../src/domain/vocabulary-reflection';
import type {VocabularyEncounterEvidence,VocabularySessionAction} from '../../src/domain/vocabulary-session';
import '../../src/styles.css';
const at='2026-10-17T12:00:00.000Z';
const general:VocabularyContent={contentId:'exercise-general-with-a-long-identity-for-narrow-panels',kind:'exercise',payloadVersion:1,
  body:{prompt:'Notify the relevant people in advance so your planned absence is on record.',reveal:{example:'明天我想调休，先向主管报备一下。',translation:'I want to take time off tomorrow, so I will let my supervisor know first.'}},
  exerciseType:'circumstance',skill:'production',exerciseRole:'general',assessment:{match:'prepared_answer_membership'},accessScope:'shared',availability:'active',originKind:'human',
  words:[{wordId:'word-baobei',relation:'target'}],answers:[{wordId:'word-baobei',acceptedForms:['报备','報備']}],version:1,createdAt:at,updatedAt:at};
const teaching:VocabularyContent={...general,contentId:'teaching-exercise',exerciseRole:'teaching'};
const intro:VocabularyContent={contentId:'introduction',kind:'introduction',payloadVersion:1,body:{beats:[{heading:'Before a plan changes',parts:['报备 means to report a plan or change in advance so the relevant people have it on record.','明天我想调休，先向主管报备一下。']}]},
  accessScope:'shared',availability:'active',originKind:'human',words:[{wordId:'word-baobei',relation:'target'}],teachingExercises:[{exerciseId:teaching.contentId,exerciseVersion:1}],version:1,createdAt:at,updatedAt:at};
function evidence(content:VocabularyContent,role:'general'|'teaching',id:string):VocabularyEncounterEvidence{return {encounterId:id,wordId:content.words[0]?.wordId??null,workNumber:1,presentedActionId:`present-${id}`,presentedAt:at,mode:role==='general'?'practice' as const:'unstudied' as const,
  snapshot:{contentId:content.contentId,contentVersion:1,kind:content.kind==='introduction'?'introduction' as const:'production' as const,role,body:{prompt:content.kind==='introduction'?'Introduction':String((content.body as Record<string,unknown>).prompt),material:content.body},assessment:content.kind==='exercise'?{acceptedAnswers:content.answers?.flatMap(answer=>answer.acceptedForms)??[]}:null},
  responses:[],effectiveResponses:[],feedback:[],effectiveFeedback:[],skipped:true,presentationUndone:false};}
const exerciseCase:VocabularyReflectionCase={caseId:'general-case',completionId:'completion',learnerId:'learner-with-a-long-private-identity',kind:'exercise_improvement',wordId:'word-baobei',contentId:general.contentId,status:'open',evidence:[evidence(general,'general','encounter-general')],createdAt:at};
const teachingCase:VocabularyReflectionCase={...exerciseCase,caseId:'teaching-case',kind:'teaching_review',contentId:teaching.contentId,evidence:[evidence(intro,'teaching','encounter-intro'),evidence(teaching,'teaching','encounter-teaching')]};
function serveHistoricalCue(item:VocabularyEncounterEvidence,prompt:string,answers?:string[]){item.snapshot.body.prompt=prompt;if(item.snapshot.body.material&&typeof item.snapshot.body.material==='object'&&!Array.isArray(item.snapshot.body.material))item.snapshot.body.material={...item.snapshot.body.material,prompt};if(answers&&item.snapshot.assessment)item.snapshot.assessment={acceptedAnswers:answers};}
serveHistoricalCue(exerciseCase.evidence[0]!,'Give the office advance notice of a planned absence.',['报备']);
const servedTeaching=teachingCase.evidence.find(item=>item.snapshot.kind==='production');if(servedTeaching)serveHistoricalCue(servedTeaching,'Served teaching cue: tell them before the absence.');
const {version:_v,createdAt:_c,updatedAt:_u,...draft}=general;
const initial:VocabularyContentProposal={proposalId:'proposal',caseId:'general-case',version:1,status:'awaiting_review',operations:[{operationKey:'repair',strategy:'update_existing',sourceContentId:general.contentId,expectedVersion:1,scope:{kind:'shared'},rationale:'Preserve this useful exercise identity while clarifying the everyday reporting intention.',content:{...draft,body:{prompt:'Let your supervisor know about planned time off beforehand, so they have it on record.',reveal:{example:'明天我想调休，先向主管报备一下。',translation:'I want to take time off tomorrow, so I will let my supervisor know first.'}}}}],rationale:'Clarify the practical intention without making the exercise a bureaucratic definition puzzle.',bases:[{contentId:general.contentId,expectedVersion:1}],invocationId:null,authorKind:'service',authorId:'vocabulary-reflection'};
const pepper:VocabularyContent={...general,contentId:'pepper-exercise',body:{prompt:'What ingredient gives the chicken its fragrant, tingling flavour?',reveal:{example:'这道藤椒鸡吃起来很香。',translation:'This green Sichuan pepper chicken tastes fragrant.'}},words:[{wordId:'word-tengjiao',relation:'target'}],answers:[{wordId:'word-tengjiao',acceptedForms:['藤椒']}]};
const crave:VocabularyContent={...general,contentId:'crave-exercise',body:{prompt:'You smell food. What do you feel?',reveal:{example:'闻到烤红薯的香味，我一下子就馋了。',translation:'The smell of roasted sweet potatoes suddenly made me crave them.'}},words:[{wordId:'word-chan',relation:'target'}],answers:[{wordId:'word-chan',acceptedForms:['馋','饞']}]};
const additionalCases:VocabularyReflectionCase[]=[{...exerciseCase,caseId:'pepper-case',learnerId:'learner-two',wordId:'word-tengjiao',contentId:pepper.contentId,evidence:[evidence(pepper,'general','pepper-encounter')]},{...exerciseCase,caseId:'crave-case',learnerId:'learner-three',wordId:'word-chan',contentId:crave.contentId,evidence:[evidence(crave,'general','crave-encounter')]}];
for(const item of additionalCases){
  const encounter=item.evidence[0];
  const response:Extract<VocabularySessionAction,{kind:'response'}>={protocolVersion:1,actionId:`response-${item.caseId}`,clientActionId:`client-response-${item.caseId}`,sequence:2,occurredAt:at,kind:'response',payload:{encounterId:encounter.encounterId,response:item.caseId==='pepper-case'?'青花椒':'饿',outcome:'rejected'}};
  const reaction:Extract<VocabularySessionAction,{kind:'feedback'}>={protocolVersion:1,actionId:`reaction-${item.caseId}`,clientActionId:`client-reaction-${item.caseId}`,sequence:3,occurredAt:at,kind:'feedback',payload:{encounterId:encounter.encounterId,feedback:'comment',comment:item.caseId==='pepper-case'?'I know this ingredient as 青花椒. Is that also accepted?':'This could mean hungry as well. I could not tell you wanted 馋.'}};
  encounter.responses=[response];encounter.effectiveResponses=[response];encounter.feedback=[reaction];encounter.effectiveFeedback=[reaction];encounter.skipped=false;
}
const reviewSenseLabels=[
  {senseId:'12345678-1111-4000-8000-111111111111',wordId:'word-baobei',label:'Formal letter or correspondence'},
  {senseId:'23456789-1111-4000-8000-111111111111',wordId:'word-baobei',label:'Envelope'},
  {senseId:'34567890-1111-4000-8000-111111111111',wordId:'word-baobei',label:'Literary case or box, especially a protective container for a set of books'},
];
if(new URLSearchParams(location.search).has('many')||new URLSearchParams(location.search).has('actions')||new URLSearchParams(location.search).has('defaultSelectionFinding')) {
  if(general.kind==='exercise')general.answers=[{wordId:'word-baobei',acceptedForms:['函']}];
  if(draft.kind==='exercise')draft.answers=[{wordId:'word-baobei',acceptedForms:['函']}];
  general.body={prompt:'A formal letter; an envelope; a literary case or box.'};
  draft.body=general.body;
  serveHistoricalCue(exerciseCase.evidence[0]!,'A formal letter; an envelope; a literary case or box.',['函']);
  exerciseCase.evidence[0]!.snapshot.body.material=general.body;
}
if(new URLSearchParams(location.search).has('many')) {
  const cues=['A formal written letter.','The document accompanying an official reply.','A letter requesting confirmation.','Official correspondence received today.','A formal invitation in writing.','A letter conveying thanks.','An envelope containing the letter.','A protective case for a set of books.','A box used in literary descriptions.'];
  initial.rationale='Mapping 12345678-1111-4000-8000-111111111111 and 23456789 suggests several practice routes.';
  initial.operations=cues.map((cue,index)=>({scope:{kind:'shared' as const},operationKey:`item-${index+1}`,strategy:index===0?'replace' as const:'create' as const,
    ...(index===0?{sourceContentId:general.contentId,expectedVersion:1}:{}),rationale:`Practice ${reviewSenseLabels[index<6?0:index===6?1:2]!.senseId}.`,
    content:{...draft,contentId:`repertoire-${index+1}`,words:[{wordId:'word-baobei',relation:'target' as const,senseId:reviewSenseLabels[index<6?0:index===6?1:2]!.senseId}],body:index===1?{prompt:'A formal letter\n请查收此____。',stimulus:{kind:'phrase_cloze',frame:'A formal letter',text:'请查收此____。'},reveal:{note:'Retain this explanation.'}}:{prompt:cue,stimulus:{kind:'direct_text',text:cue}}}}));
}
if(new URLSearchParams(location.search).has('actions')){initial.rationale='Retire this source without a replacement.';initial.operations=[
  {operationKey:'retire-source',strategy:'retire',sourceContentId:general.contentId,expectedVersion:1,scope:{kind:'shared'},rationale:'No faithful repair was established.',content:draft},
];}
if(new URLSearchParams(location.search).has('defaultSelectionFinding')){
  initial.rationale='Repair the formal correspondence cue while reviewing the missing shared default selection separately.';
  initial.operations[0]!.rationale='Trust the mapped formal-letter sense and evoke the exact word.';
  initial.operations[0]!.content={...draft,contentId:initial.operations[0]!.strategy==='update_existing'?general.contentId:'letter-repair',words:[{wordId:'word-baobei',relation:'target',senseId:reviewSenseLabels[0]!.senseId,senseMappingEstablishedAt:at}],body:{prompt:'A formal written letter requesting confirmation.'}};
}
if(new URLSearchParams(location.search).has('criteriaOnly'))initial.operations=[{...initial.operations[0]!,strategy:'update_existing',sourceContentId:general.contentId,expectedVersion:1,content:{...general,assessment:{match:'semantic'},body:{...(general.body as object),reveal:{teachingNote:'Use the formal reporting sense.'}}}}];
const displaySenseLabels=[...reviewSenseLabels];
if(new URLSearchParams(location.search).has('multiwordLabels')){
  const senseId='45678901-1111-4000-8000-111111111111';
  displaySenseLabels.push({senseId,wordId:'word-tengjiao',label:'green Sichuan pepper'});
  initial.operations.push({operationKey:'another-word',strategy:'create',scope:{kind:'shared'},rationale:`Practice ${senseId}.`,content:{...pepper,contentId:'additional-pepper',words:[{wordId:'word-tengjiao',relation:'target',senseId}],body:{prompt:'Fresh green Sichuan pepper with a tingling citrus scent.'}}});
}
const contents=new Map([general,pepper,crave,intro,teaching].map(item=>[item.contentId,item]));
const proposals=new Map<string,VocabularyContentProposal>([initial,{...initial,proposalId:'pepper-proposal',caseId:'pepper-case',rationale:'The learner used the equivalent ingredient name 青花椒. Keep the cue and accept both forms.',bases:[{contentId:pepper.contentId,expectedVersion:1}],operations:[{operationKey:'accept-equivalent',strategy:'update_existing',sourceContentId:pepper.contentId,expectedVersion:1,scope:{kind:'shared'},rationale:'Accept the equivalent ingredient name without changing the question.',content:{...pepper,answers:[{wordId:'word-tengjiao',acceptedForms:['藤椒','青花椒']}]}}]},{...initial,proposalId:'crave-proposal',caseId:'crave-case',rationale:'The original question can reasonably elicit 饿. A more specific sensory cue separates appetite from hunger.',bases:[{contentId:crave.contentId,expectedVersion:1}],operations:[{operationKey:'clarify-craving',strategy:'replace',sourceContentId:crave.contentId,expectedVersion:1,scope:{kind:'learner',learnerId:'learner-three'},rationale:'Give this learner a concrete craving scenario; retain existing schedules on the previous exercise.',content:{...crave,contentId:'crave-successor',accessScope:'private',ownerLearnerId:'learner-three',body:{reveal:{example:'闻到烤红薯的香味，我一下子就馋了。',translation:'The smell of roasted sweet potatoes suddenly made me crave them.'},prompt:'You have just eaten, but the smell of roasted sweet potatoes makes you want one. Describe that craving.'}}}]},{...initial,proposalId:'reviewed-proposal',caseId:null,status:'applied',rationale:'A previously approved wording correction.',resolvedAt:new Date().toISOString()}].map(item=>[item.proposalId,item as VocabularyContentProposal]));
if(new URLSearchParams(location.search).has('oldArchive'))proposals.set('older-archived-proposal',{...initial,proposalId:'older-archived-proposal',caseId:null,status:'closed',resolvedAt:new Date(Date.now()-13*60*60*1000).toISOString(),rationale:'Older archived wording correction.'});
if(new URLSearchParams(location.search).has('noSnapshot'))initial.caseId=null;
function proposal(id:string){const value=proposals.get(id);if(!value)throw new Error(`Unknown fixture proposal ${id}`);return value;}
function update(id:string,patch:Partial<VocabularyContentProposal>){const value={...proposal(id),...patch};proposals.set(id,value);return value;}
const refreshScenario=new URLSearchParams(location.search).has('refresh');
if(refreshScenario)setTimeout(()=>{proposals.set('incoming-proposal',{...initial,proposalId:'incoming-proposal',rationale:'An incoming proposal delivered by the background queue refresh.'});},1000);
let dispatches=[{dispatchId:'dispatch',learnerId:'learner-with-a-long-private-identity',sessionId:'session-with-a-long-retained-evidence-identity',error:'evidence_ingestion_failed'}];
if(new URLSearchParams(location.search).has('narrow')) { document.getElementById('root')!.style.maxWidth='540px'; }
const empty=new URLSearchParams(location.search).has('empty');
const noProposal=new URLSearchParams(location.search).has('noProposal');
const noProposalCase={...exerciseCase,caseId:'no-proposal-case',status:'completed' as const};
let noProposalClosed=false;let noProposalResolvedAt:string|null=null;let noProposalOpinion=false;
let reassessmentRequest:{parentId:string;caseId:string;jobId:string;status:string;error:string|null}|null=null;
const promotion=new URLSearchParams(location.search).get('promotion');
const senseGap=new URLSearchParams(location.search).has('admission');
const reassessment=new URLSearchParams(location.search).has('reassessment');
if(reassessment) exerciseCase.status='completed';
const reassessmentSource={contentId:general.contentId,assessedVersion:1,currentVersion:new URLSearchParams(location.search).get('reassessment')==='changed'?2:1};
if(new URLSearchParams(location.search).has('large')) document.documentElement.style.fontSize='125%';
let failApplication=new URLSearchParams(location.search).has('applyFailure');
const secondOpinions=new Map<string,VocabularySecondOpinion[]>();
const secondState=new URLSearchParams(location.search).get('second');
const reviewResult={verdict:'revise' as const,rationale:'The narrower situation is helpful, but “have it on record” still sounds administrative. Preserve the natural conversational example and avoid implying formal approval is needed.'};
if(secondState)secondOpinions.set('proposal',[{requestId:'second-fixture',proposalId:'proposal',proposalVersion:1,jobId:'second-job',status:secondState==='failed'?'failed':secondState==='pending'?'queued':'succeeded',attemptNumber:1,error:secondState==='failed'?'provider_outcome_unknown':null,requestedAt:at,result:secondState==='failed'||secondState==='pending'?null:reviewResult}]);
let failNextLoad=new URLSearchParams(location.search).has('failNext');
const approvalRequests=new Map<string,VocabularyApprovalRequest>();
function receipt(id:string,version:number,requestId:string,notes=''):VocabularyApprovalRequest{return {requestId,proposalId:id,expectedVersion:version,actorId:'fixture-operator',notes,status:'queued',attempts:0,createdAt:at,updatedAt:at,error:null,application:null};}
function scheduleApproval(item:VocabularyApprovalRequest){
  if(new URLSearchParams(location.search).has('holdApproval'))return;
  setTimeout(()=>{
    item.attempts++;item.updatedAt=new Date().toISOString();
    if(new URLSearchParams(location.search).has('staleApply')||failApplication){failApplication=false;item.status='attention';item.error='The source changed during validation. Revise the proposal or retry after inspecting its source.';}
    else{const current=update(item.proposalId,{status:'applied',resolvedAt:item.updatedAt});item.status='succeeded';item.application={applicationId:`application-${item.proposalId}`,proposalId:item.proposalId,proposalVersion:current.version,reviewId:`approved-${item.proposalId}`,changes:[]};}
  },800);
}
if(new URLSearchParams(location.search).has('approvalAttention'))approvalRequests.set('failed-approval',{...receipt('proposal',1,'failed-approval'),status:'attention',attempts:1,error:'The source changed during validation. This exact revision was not applied.'});
if(new URLSearchParams(location.search).has('approvalQueued'))approvalRequests.set('queued-approval',receipt('proposal',1,'queued-approval'));
const scopeScenario=new URLSearchParams(location.search).has('scope');
const defaultSelectionFindingScenario=new URLSearchParams(location.search).has('defaultSelectionFinding');
const unknownCoverage=defaultSelectionFindingScenario||new URLSearchParams(location.search).has('unknownCoverage')||new URLSearchParams(location.search).has('needsCoverage');
const needsCoverage=new URLSearchParams(location.search).has('needsCoverage');
if(scopeScenario||needsCoverage)exerciseCase.status=needsCoverage?'open':'completed';
const sharedSelections=new Map<string,{ids:string[]|null;version:number}>(),reviewSelections=new Map<string,{ids:string[]|null;version:number}>();
const changedWords=new Set<string>(),changedCases=new Set<string>();
const heldScopeSaves:(()=>void)[]=[];
function coverage(wordId:string,caseId?:string):VocabularySenseCoverageWorkspace {
  const defaults=sharedSelections.get(wordId)??{ids:unknownCoverage?null:reviewSenseLabels.slice(0,2).map(sense=>sense.senseId),version:unknownCoverage?0:1};
  const review=caseId?reviewSelections.get(caseId)??{ids:null,version:0}:null;
  const ids=review?.ids??defaults.ids;
  return {word:{wordId,version:defaults.version,defaultUsefulSenseIds:defaults.ids,excludedSenseIds:defaults.ids===null?[]:reviewSenseLabels.filter(sense=>!defaults.ids!.includes(sense.senseId)).map(sense=>sense.senseId)},review:review&&caseId?{caseId,wordId,version:review.version,includedSenseIds:review.ids}:null,includedSenseIds:ids??[],selectionEstablished:ids!==null,fingerprint:JSON.stringify([defaults,review]),productionExerciseCounts:Object.fromEntries(reviewSenseLabels.map((sense,index)=>[sense.senseId,[6,1,2][index]!])),senses:reviewSenseLabels.map((sense,index)=>({senseId:sense.senseId,wordId,description:{label:sense.label,notes:[index===2?'Literary register; a case holding books.':'A natural contemporary use; preserve the exact target.']},status:'active',version:1,createdAt:at,updatedAt:at}))};
}
function defaultFinding(wordId:string){return defaultSelectionFindingScenario&&wordId==='word-baobei'&&coverage(wordId).word.defaultUsefulSenseIds===null?{status:'needs_operator' as const,reason:'The inventory model recommended no default useful senses. Choose the word defaults for future teaching and practice.',invocationId:'zero-useful-selection-invocation',recommendedSenseIds:[]}:null;}
async function scopeRead<T>(read:()=>T):Promise<T>{if(new URLSearchParams(location.search).has('slowCoverageRead'))await new Promise(resolve=>setTimeout(resolve,3500));return read();}
function fixtureWord(caseId:string):string{return [exerciseCase,...additionalCases,noProposalCase].find(item=>item.caseId===caseId)?.wordId??'word-baobei';}
async function saveCoverage(scope:'word'|'case',id:string,expectedVersion:number,ids:string[]|null):Promise<VocabularySenseCoverageWorkspace>{
  const wordId=scope==='word'?id:fixtureWord(id),current=coverage(wordId,scope==='case'?id:undefined);
  if((scope==='word'?current.word.version:current.review!.version)!==expectedVersion)throw new ApiRequestError('Coverage changed; reload before saving.',409);
  if(new URLSearchParams(location.search).has('holdCoverage'))await new Promise<void>(resolve=>heldScopeSaves.push(resolve));
  if(scope==='word'){sharedSelections.set(id,{ids,version:expectedVersion+1});changedWords.add(id);}else{reviewSelections.set(id,{ids,version:expectedVersion+1});changedCases.add(id);}
  if(new URLSearchParams(location.search).has('sourceDriftAfterCoverage')){contents.set(general.contentId,{...general,version:2});reassessmentSource.currentVersion=2;}
  document.body.dataset.coverageSaved=scope;return coverage(wordId,scope==='case'?id:undefined);
}
if(new URLSearchParams(location.search).has('scopeSibling')){
  additionalCases.push({...exerciseCase,caseId:'same-word-case',wordId:'word-baobei'});
  proposals.set('same-word-proposal',{...initial,proposalId:'same-word-proposal',caseId:'same-word-case',rationale:'Another assessment of the same word.'});
}
let loseApprovalAck=new URLSearchParams(location.search).has('lostAck');
const api:VocabularyOperatorApi={
  resolvePureCueIdentities:async(parentId,modelChoice,expectedContentVersion,selections)=>{document.body.dataset.identitySelections=JSON.stringify(selections);document.body.dataset.identityModel=modelChoice;document.body.dataset.identityVersion=String(expectedContentVersion);reassessmentRequest={parentId,caseId:'resolved-promotion',jobId:'resolved-promotion-job',status:'queued',error:null};return reassessmentRequest;},
  wordSenseCoverage:async wordId=>scopeRead(()=>coverage(wordId)),caseSenseCoverage:async caseId=>scopeRead(()=>coverage(fixtureWord(caseId),caseId)),
  saveDefaultUsefulSenses:async(wordId,version,ids)=>saveCoverage('word',wordId,version,ids),
  saveWordSenseCoverage:async(wordId,version,excluded)=>saveCoverage('word',wordId,version,reviewSenseLabels.filter(sense=>!excluded.includes(sense.senseId)).map(sense=>sense.senseId)),
  saveCaseSenseCoverage:async(caseId,version,ids)=>saveCoverage('case',caseId,version,ids),
  approvalRequests:async()=>({items:structuredClone([...approvalRequests.values()])}),
  requestApproval:async(id,version,requestId,notes)=>{if(new URLSearchParams(location.search).has('stale'))throw new ApiRequestError('The proposal revision changed; reload this proposal.',409);const existing=approvalRequests.get(requestId);if(existing)return structuredClone(existing);const item=receipt(id,version,requestId,notes);approvalRequests.set(requestId,item);scheduleApproval(item);document.body.dataset.approvalRequests=String(approvalRequests.size);if(loseApprovalAck){loseApprovalAck=false;throw new Error('Approval acknowledgement lost. Retry to recover the same request.');}return structuredClone(item);},
  retryApproval:async requestId=>{const item=approvalRequests.get(requestId)!;item.status='queued';item.error=null;item.updatedAt=new Date().toISOString();scheduleApproval(item);return structuredClone(item);},
  cases:async kind=>({items:empty?[]:kind==='teaching_review'?[teachingCase]:kind==='exercise_improvement'?[exerciseCase,...additionalCases]:[]}),workspace:async id=>({defaultSelectionFinding:defaultFinding(fixtureWord(id)),senseLabels:displaySenseLabels,case:id==='no-proposal-case'?{...noProposalCase,status:noProposalClosed?'closed' as const:'completed' as const,resolvedAt:noProposalResolvedAt}:[exerciseCase,teachingCase,...additionalCases].find(item=>item.caseId===id)!,reassessmentSource:reassessment||scopeScenario||needsCoverage?reassessmentSource:null,reassessment:reassessmentRequest?.parentId===id?reassessmentRequest:null,sources:id==='no-proposal-case'?[general]:id==='teaching-case'?[intro,teaching]:[contents.get([exerciseCase,...additionalCases].find(item=>item.caseId===id)!.contentId!)!],diagnosis:id==='no-proposal-case'?'The learner suggested a related answer, but the visible exercise asks for the specific act of notifying the relevant people in advance so the planned absence is on record. The existing answer fits that context and no change is needed.':undefined,jobs:id==='no-proposal-case'?(noProposalOpinion?[{jobId:'case-opinion',kind:'exercise_improvement',status:'succeeded',attemptNumber:1,error:null,secondOpinion:true,result:reviewResult}]:[]):id==='teaching-case'?[]:[{jobId:'failed-job',kind:'exercise_improvement',status:'succeeded',attemptNumber:2,error:null,secondOpinion:false,result:null}],proposals:[...proposals.values()].filter(item=>item.caseId===id),...(promotion&&id!=='teaching-case'?{pureCueIdentityOptions:[{form:'报备',choices:[{wordId:'word-baobei',hanzi:'报备',traditional:null,pinyin:'bào bèi',meaning:'Report a plan for the relevant authority to keep on record.'}]},{form:'报告',choices:new URLSearchParams(location.search).has('missingIdentity')?[]:[{wordId:'word-baogao',hanzi:'报告',traditional:null,pinyin:'bào gào',meaning:'Report information, including lengthy details about an event, a planned change, or a factual circumstance.'},{wordId:'word-baogao-other',hanzi:'报告',traditional:null,pinyin:'alternate reading',meaning:'A second synthetic dictionary reading for exercising explicit selection.'}]}],pureCueReferral:{candidateWords:['报备','报告'],sharedPurpose:'Report a planned change so the relevant person has it on record.',rationale:'The learner suggested another reporting word; investigate its fit to the actual slot and expressive purpose.'},pureCuePromotion:{outcome:promotion==='needs_operator'?'needs_operator' as const:'extend' as const,rationale:promotion==='needs_operator'?'The suggested word has multiple lexical identities. Choose the intended pronunciation before any shared cue membership change.':'The existing reporting cue supports the additional member while preserving its stimulus, semantic axis, and existing accepted answers.',candidateWordIds:['word-baobei','word-baogao'],existingContentId:null}}:{}),...(needsCoverage&&id!=='teaching-case'?{admission:{outcome:'needs_coverage' as const,rationale:'Default useful senses are unknown; select the desired uses before reassessment.',wordId:'word-baobei',sourceContentId:general.contentId,sourceContentVersion:1,catalogVersion:1,senseIds:[],sourceMapping:{senseId:null,establishedAt:null}}}:(reassessment||promotion)&&id!=='teaching-case'?{admission:{outcome:'single_sense' as const,rationale:'The intended sense is clear.',wordId:'word-baobei',sourceContentId:general.contentId,sourceContentVersion:1,catalogVersion:1,senseIds:['sense-one'],sourceMapping:{senseId:'sense-one',establishedAt:at}}}:senseGap&&id!=='teaching-case'?{admission:{outcome:'inventory_gap' as const,rationale:'This exercise appears to use a reporting sense that is not represented clearly in the current inventory. It needs inspection before an exercise can be repaired.',wordId:'word-baobei',sourceContentId:general.contentId,sourceContentVersion:1,catalogVersion:1,senseIds:[],sourceMapping:{senseId:null,establishedAt:null}}}:{})}),
  preparationFailures:async()=>({defaultSelectionFindings:defaultFinding('word-baobei')?[{...defaultFinding('word-baobei')!,wordId:'word-baobei',hanzi:'函',caseId:'general-case'}]:[],items:empty?[]:[{workId:'failed-practice',wordId:'word-one',sourceContentId:'source-one',attemptCount:3,invocationId:'retained-call',lastError:'generation_failed',retryable:true}]}),retryPreparation:async()=>({ok:true}),
  noProposalCases:async(status='completed')=>({items:noProposal&&((status==='closed')===noProposalClosed)?[{...noProposalCase,resolvedAt:noProposalResolvedAt}]:[]}),reassessCase:async(parentId,modelChoice,expectedContentVersion)=>{reassessmentRequest={parentId,caseId:'reassessment',jobId:'reassessment-job',status:'queued',error:null};document.body.dataset.reassessmentModel=modelChoice;document.body.dataset.reassessmentVersion=String(expectedContentVersion);return reassessmentRequest;},requestCaseSecondOpinion:async()=>{noProposalOpinion=true;return {ok:true as const};},
    secondOpinions:async id=>({items:structuredClone(secondOpinions.get(id)??[])}),
  requestSecondOpinion:async(id,version)=>{const requested:VocabularySecondOpinion={requestId:`second-${id}-${version}`,proposalId:id,proposalVersion:version,jobId:`second-job-${id}`,status:'queued',attemptNumber:0,error:null,requestedAt:at,result:null};secondOpinions.set(id,[...(secondOpinions.get(id)??[]),requested]);setTimeout(()=>{requested.status='succeeded';requested.attemptNumber=1;requested.result=reviewResult;},800);return requested;},
  proposals:async()=>({items:empty||noProposal||needsCoverage?[]:[...proposals.values()]}),proposal:async id=>proposal(id),dispatches:async()=>({items:empty?[]:dispatches}),retryDispatch:async()=>{dispatches=[];return {ok:true};},retryJob:async jobId=>{for(const items of secondOpinions.values()){const item=items.find(value=>value.jobId===jobId);if(item){item.status='succeeded';item.error=null;item.attemptNumber+=1;item.result=reviewResult;}}return {ok:true};},closeCase:async()=>{noProposalClosed=true;noProposalResolvedAt=new Date().toISOString();return {ok:true};},
  create:async value=>{const created={...initial,proposalId:`manual-${proposals.size}`,version:1,caseId:value.caseId??null,operations:value.operations,rationale:value.rationale,status:'awaiting_review' as const};proposals.set(created.proposalId,created);return created;},
  save:async(id,version,value)=>{if(new URLSearchParams(location.search).has('saveFailure'))throw new Error('Simulated save failure; draft retained.');document.body.dataset.savedChanges=String(value.operations.length);document.body.dataset.savedDraft=JSON.stringify(value);return update(id,{version:version+1,operations:value.operations,rationale:value.rationale,status:'awaiting_review'});},
  reviewBatch:async(start,limit=20)=>{
    if(failNextLoad&&start==='pepper-proposal'){if(proposals.get('proposal')?.status==='closed')failNextLoad=false;throw new Error('Simulated next item failure');}
    const open=[...proposals.values()].filter(item=>!['closed','applied'].includes(item.status));const offset=open.findIndex(item=>item.proposalId===start);
    if(offset<0)return {items:[],nextProposalId:null};
    const items=await Promise.all(open.slice(offset,offset+limit).map(async proposal=>({defaultSelectionFinding:defaultFinding(fixtureWord(proposal.caseId??'')),coverageChanged:proposal.bases.some(base=>contents.get(base.contentId)?.version!==base.expectedVersion),senseLabels:displaySenseLabels,proposal,case:proposal.caseId?[exerciseCase,teachingCase,...additionalCases].find(item=>item.caseId===proposal.caseId)??null:null,reassessment:proposal.caseId?{eligible:reassessment||scopeScenario,source:reassessmentSource,latest:reassessmentRequest?.parentId===proposal.caseId?reassessmentRequest:null}:null,previews:proposal.operations.map(operation=>({operationKey:operation.operationKey,source:operation.strategy==='create'?null:contents.get(operation.sourceContentId)!,result:operation.content}))})));
    return {items,nextProposalId:open[offset+items.length]?.proposalId??null};
  },
  preview:async id=>{if(failNextLoad&&id==='pepper-proposal'){if(proposals.get('proposal')?.status==='closed')failNextLoad=false;throw new Error('Simulated next preview failure');}if(new URLSearchParams(location.search).has('stale'))throw new Error('The source changed; revise or dismiss this proposal.');const current=proposal(id);return {proposal:current,previews:current.operations.map(operation=>({operationKey:operation.operationKey,source:operation.strategy==='create'?null:contents.get(operation.sourceContentId)!,result:{...general,...operation.content,version:2} as VocabularyContent})),operations:current.operations.map(operation=>({operationKey:operation.operationKey,strategy:operation.strategy,scope:operation.scope,schedulesRemainOnSource:operation.scope.kind==='shared'?12:1,deactivationsRemainOnSource:0,teachingBindingsRemainOnSource:0,sourceSenseMappings:1,sourceCurations:0,sourceIntroductionExercises:0,transfersRelationships:false}))};},
  approve:async id=>{if(new URLSearchParams(location.search).has('stale'))throw new ApiRequestError('The source changed; revise or dismiss this proposal.',409);update(id,{status:'approved'});return {reviewId:`approved-${id}`};},apply:async id=>{if(new URLSearchParams(location.search).has('staleApply'))throw new ApiRequestError('The source changed during application.',409);if(failApplication){failApplication=false;throw new Error('Application response failed; retry the approved version.');}const current=update(id,{status:'applied',resolvedAt:new Date().toISOString()});return {applicationId:`application-${id}`,proposalId:id,proposalVersion:current.version,reviewId:`approved-${id}`,changes:[]};},close:async id=>{update(id,{status:'closed',resolvedAt:new Date().toISOString()});return {ok:true};}};
if (new URLSearchParams(location.search).has('slow')) {
  const originalProposal=api.proposal,originalWorkspace=api.workspace,originalPreview=api.preview,originalBatch=api.reviewBatch;
  const delay=()=>new Promise<void>(resolve=>setTimeout(resolve,800));
  api.proposal=async id=>{await delay();return originalProposal(id);};
  api.workspace=async id=>{await delay();return originalWorkspace(id);};
  api.preview=async(id,version)=>{await delay();return originalPreview(id,version);};
  api.reviewBatch=async(id,limit)=>{await delay();return originalBatch(id,limit);};
}
createRoot(document.getElementById('root')!).render(<React.StrictMode>{new URLSearchParams(location.search).has('holdCoverage')&&<button onClick={()=>heldScopeSaves.splice(0).forEach(resolve=>resolve())}>Finish pending coverage save</button>}{new URLSearchParams(location.search).has('usage')?<OperatorUsagePulsePage initialTab="improvement" improvementApi={api}/>:<VocabularyOperatorPage api={api}/>}</React.StrictMode>);
