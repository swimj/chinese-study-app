import React from 'react';
import App from '../../src/App';
import { createRoot } from 'react-dom/client';
import '../../src/styles.css';
import { VocabularyCaseReviewPage } from '../../src/pages/VocabularyCaseReviewPage';
import { OperatorShell } from '../../src/OperatorApp';
import { vocabularyOperatorApi, type VocabularyOperatorApi, type VocabularyCaseWorkspace } from '../../src/features/vocabulary-operator/api';
import type { VocabularyCaseQueueItem } from '../../src/domain/vocabulary-case-queue';
import type { VocabularySenseCoverageWorkspace } from '../../src/domain/vocabulary-sense-coverage';
import type { VocabularyContent } from '../../src/domain/vocabulary-content';
import type { VocabularyContentProposal, VocabularyApprovalRequest } from '../../src/domain/vocabulary-reflection';
import type { VocabularyEncounterEvidence } from '../../src/domain/vocabulary-session';
import { ApiRequestError } from '../../src/services/api';
import { caseReviewFixture } from '../fixtures/case-review-data';

const params = new URLSearchParams(location.search || import.meta.env.VITE_TESTBED_QUERY || '');
const odds = params.has('odds');
const cards = Array.from({ length: params.has('empty') ? 0 : params.has('repertoire') ? 1 : odds ? 3 : 85 }, (_, index) => caseReviewFixture(index + 1));
if (cards[1]) { cards[1].proposal = null; cards[1].currentProposalId = null; cards[1].assessment!.diagnosis = 'The original cue is appropriate. The learner’s response changes the intended meaning.'; }
if (cards[2]) { cards[2].served.push({ ...structuredClone(cards[2].served[0]), encounterId: 'second-encounter', responses: [{ actionId: 'second-response', text: '稠密', outcome: 'rejected', undone: true }] }); cards[2].proposal!.operations.push({ ...cards[2].proposal!.operations[0], operationKey: 'enrichment', strategy: 'create', learningRole: 'enrichment', groupLabel: 'Dense distribution', prompt: 'A dense cluster of closely scheduled interviews: 明天上午的面试安排得很____。', acceptedAnswers: ['密集'], sourceContentId: null, expectedVersion: null }); }
if (cards[3]) { cards[3].requiresDetails = true; cards[3].proposal!.operations[0].otherChanges = ['Teaching explanation also changes; inspect full content.']; }
if (cards[4]) { cards[4].alternatives = [{ proposalId: 'retained-alternative', version: 2, status: 'awaiting_review', rationale: 'Retained operator-edited alternative' }]; cards[4].alternativeCount = 1; }
if (params.has('failedReassessment') && cards[0]) {const item=cards[0];item.frozen=true;item.latestJob={jobId:'failed-reassessment',sequence:2,status:'failed',error:'validation_failed',advisory:false};}
if (params.has('blocked') && cards[0]) { const item=cards[0]; item.proposal=null; item.currentProposalId=null; item.needsDecision=true; item.finding={kind:'unmappable',message:'The served cue does not identify one intended sense.'}; item.assessment!.outcome='unmappable'; item.reassessment={eligible:false,reason:'The source exercise is retired.',source:null}; }
const identityOptions=[{form:'给',choices:[{wordId:'gei',hanzi:'给',traditional:'給',pinyin:'gěi',meaning:'to give; hand to'},{wordId:'ji',hanzi:'给',traditional:'給',pinyin:'jǐ',meaning:'to supply or provide'}]}];
if ((params.has('identities')||params.has('identitiesExisting')) && cards[0]) { const item=cards[0]; item.wordLabel='递给';item.served[0].prompt="Don't toss the keys—hand them to me.";item.served[0].responses[0].text='给';item.served[0].reactions=[];if(params.has('identities')){item.proposal=null;item.currentProposalId=null;item.needsDecision=true;item.assessment!.models=[];item.assessment!.diagnosis='Choose a dictionary entry for each ambiguous response before assessment.';item.finding={kind:'response_identity',message:'Choose a dictionary entry for each ambiguous response before assessment.'};item.responseIdentityOptions=identityOptions;} }
if (odds) {
  const examples = [
    {word:'脱', cue:'治疗后，病人终于____离危险。', outcome:'unmappable', message:'The intended phrase is 脱离危险.'},
    {word:'钗', cue:'hairpin', outcome:'needs_coverage', message:'Useful senses have not been selected.'},
    {word:'处置', cue:'to handle, to take care of, to punish', outcome:'needs_repertoire', message:'A dictionary fallback was served.'},
  ] as const;
  examples.forEach(({word,cue,outcome,message},index) => {
    const item=cards[index];
    item.proposal=null;
    item.currentProposalId=null;
    item.needsDecision=true;
    item.finding={kind:outcome,message};
    item.repertoireReviewAvailable=word==='处置';
    item.wordLabel=word;
    item.assessment={...item.assessment!,outcome,diagnosis:message};
    Object.assign(item.served[0],{prompt:cue,acceptedAnswers:[word],responses:[],reactions:[]});
  });
}
if (params.has('design') && cards[0]) {
 const first=cards[0];first.served.push({...structuredClone(first.served[0]),encounterId:'later',presentedAt:'2026-11-03T14:00:00Z',prompt:'A distinct later snapshot.',responses:[{actionId:'later-response',text:'报备',outcome:'accepted',undone:true}],skipped:true,presentationUndone:true});
 const pure=cards[1];pure.wordId=null;pure.wordLabel=null;pure.proposal=structuredClone(first.proposal);pure.proposal!.proposalId='pure-proposal';pure.currentProposalId='pure-proposal';pure.served[0].pureCue={axisNote:'Shared purpose from stored cue',teachingNote:'Original teaching note'};pure.proposal!.operations[0].pureCue={axisNote:'Shared purpose from stored cue',teachingNote:'Revised note preserving distinctions between all accepted forms.'};pure.proposal!.operations[0].acceptedAnswers=['报备','报告'];pure.proposal!.operations[0].sourceContentId=pure.served[0].contentId;pure.proposal!.operations[0].expectedVersion=pure.served[0].contentVersion;
 cards[2].assessment!.outcome='repertoire_bootstrap';
 cards[3].proposal=null;cards[3].requiresDetails=false;cards[3].needsDecision=true;cards[3].finding={kind:'unmappable',message:'The intended sense is unresolved.'};cards[3].reassessment={eligible:false,reason:'The source exercise is retired.',source:null};
 cards[4].stale=true;cards[4].sources[0].version=2;
}
const repertoireSenses=[{senseId:'sense-letter',label:'Formal letter or correspondence'},{senseId:'sense-envelope',label:'Envelope'},{senseId:'sense-case',label:'Literary case for books'},{senseId:'sense-function',label:'A mathematical function mapping each input to a corresponding output'}];
const repertoirePrompts=['A formal invitation sent in writing: 敬请查收邀请____。','A letter asking for confirmation: 我们已致____询问。','An envelope containing a letter.','A protective case for a set of books.'];
const repertoireIds=['sense-letter','sense-letter','sense-envelope','sense-case'];
let repertoireSelection=repertoireSenses.slice(0,3).map(sense=>sense.senseId),repertoireSelectionVersion=1;
const fallbackSenses=[
  {senseId:'handle',label:'Handle or deal with a matter'},
  {senseId:'punish',label:'Punish or take disciplinary action against someone'},
  {senseId:'dispose',label:'Dispose of or arrange the disposition of something'},
];
let hairpinDefaults: string[] | null = null;
let generatedSenseIds: string[] | null = null;
let retainedRepertoire:VocabularyContentProposal['operations']|null=null;
let retainedRepertoireProjection:NonNullable<VocabularyCaseQueueItem['proposal']>['operations']|null=null;
const repertoireSource='A formal letter; an envelope; a literary case or box.';
if(params.has('repertoire')&&cards[0]){
 const item=cards[0];item.wordLabel='函';item.assessment!.outcome='repertoire_bootstrap';item.assessment!.scopeLabel='Word defaults';
 item.assessment!.diagnosis='Replace the dictionary fallback with exercises for the selected uses of 函.';
 item.assessment!.models[0].stage='repertoire';
 Object.assign(item.served[0],{prompt:repertoireSource,acceptedAnswers:['函'],responses:[],reactions:[],skipped:true});
 Object.assign(item.sources[0],{prompt:repertoireSource,acceptedAnswers:['函']});
 item.proposal!.rationale='A repertoire organized by the word’s selected senses.';
 item.proposal!.operations=repertoirePrompts.map((prompt,index)=>({operationKey:`repertoire-${index}`,strategy:index===0?'replace':'create',
   learningRole:'source_repair',scopeLabel:'Shared',groupLabel:repertoireSenses.find(sense=>sense.senseId===repertoireIds[index])!.label,
   prompt,acceptedAnswers:['函'],rationale:'Teach this selected use of 函.',sourceContentId:index===0?'source':null,expectedVersion:index===0?1:null,otherChanges:[]}));
}
if(params.has('teaching')&&cards[0]){
 const item=cards[0];item.kind='teaching_review';item.proposal=null;item.currentProposalId=null;item.assessment=null;item.currentAssessment=null;item.needsDecision=true;
 item.reassessment={eligible:false,reason:'A completed assessment is required.',source:null};
 item.served[0].role='introduction';item.served[0].kind='introduction';item.served[0].prompt='Introduction';
}
function wordCoverage():VocabularySenseCoverageWorkspace{return {word:{wordId:'word',version:repertoireSelectionVersion,defaultUsefulSenseIds:[...repertoireSelection],excludedSenseIds:repertoireSenses.filter(sense=>!repertoireSelection.includes(sense.senseId)).map(sense=>sense.senseId)},review:null,includedSenseIds:[...repertoireSelection],selectionEstablished:true,fingerprint:String(repertoireSelectionVersion),senses:repertoireSenses.map(sense=>({senseId:sense.senseId,wordId:'word',description:{label:sense.label,notes:[`Usage notes for ${sense.label}. This sense keeps its own teaching context while selection controls which meanings receive practice.`]},status:'active',version:1,createdAt:'2026-11-01T00:00:00.000Z',updatedAt:'2026-11-01T00:00:00.000Z'}))};}
function repertoireAdmission(){return {outcome:'repertoire_bootstrap' as const,rationale:'Bootstrap the selected word repertoire.',wordId:'word',sourceContentId:'source',sourceContentVersion:1,catalogVersion:1,senseIds:[],sourceMapping:{senseId:null,establishedAt:null},generationScope:{selectionEstablished:true,senseIds:repertoireSenses.slice(0,3).map(sense=>sense.senseId),source:{kind:'word_defaults' as const,wordId:'word',capturedVersion:1}}};}
if (params.has('reuse') && cards[0]) {
 const item=cards[0]; item.wordLabel='静';
 item.served[0].prompt='夜深了，四周一点声音也没有，显得特别____。';item.served[0].acceptedAnswers=['静'];item.served[0].responses[0].text='宁静';item.served[0].reactions=[];
 item.proposal!.operations[0].prompt=item.served[0].prompt;item.proposal!.operations[0].acceptedAnswers=['静'];item.proposal!.operations[0].groupLabel='Quiet; silent';
 item.assessment!.diagnosis='Retire the single-answer exercise in favor of existing shared practice.';
 item.proposal!.rationale=item.assessment!.diagnosis;
 item.proposal!.operations[0].strategy='retire';
 item.reusedSharedCue={contentId:'existing-shared-cue',prompt:'清晨，村子里还没有人出门，四周显得格外____。',acceptedAnswers:['静','靜','宁静','寧靜'],teachingNote:'静 emphasizes the lack of sound; 宁静 adds a sense of serenity.',rationale:'The existing cue already accepts both natural responses and teaches their distinction.',version:1,expectedVersion:1,availability:'active'};
 if(params.get('reuse')==='missing') Object.assign(item.reusedSharedCue,{prompt:null,acceptedAnswers:[],teachingNote:null,version:null,availability:null});
 if(params.get('reuse')==='retired') item.reusedSharedCue.availability='retired';
}
const archived = caseReviewFixture(99); archived.state = 'resolved'; archived.resolvedAt = new Date().toISOString(); archived.proposal!.status = 'applied'; cards.push(archived);
const counts: Record<string, number> = { queue: 0, history: 0, card: 0, workspace: 0, proposal: 0, fullSnapshot: 0, attention: 0, mutations: 0, broadLists: 0 };
const requests: VocabularyApprovalRequest[] = []; let activeCase = cards[0]?.caseId, lostAck = false, rejectApproval = false, holdQueue = false; const pendingQueue: (()=>void)[]=[];
const controls = document.getElementById('fixture-controls')!;
controls.style.cssText = 'position:sticky;top:0;z-index:5;background:#eef6f4;padding:.6rem;border-bottom:1px solid #abc;';
if (params.has('clean')) controls.style.display = 'none';
const counter = document.createElement('output'); counter.setAttribute('aria-label', 'Fixture request counters'); controls.append(counter);
function count(key: string) { counts[key]++; counter.textContent = Object.entries(counts).map(([name, value]) => `${name}: ${value}`).join(' · '); }
count('mutations'); counts.mutations = 0;
function button(label: string, work: () => void) { const element = document.createElement('button'); element.textContent = label; element.style.margin = '.3rem'; element.onclick = work; controls.append(element); }
function card(id: string) { const result = cards.find(item => item.caseId === id); if (!result) throw new Error('Unknown fixture case'); return result; }
function copy<T>(value: T): T { return structuredClone(value); }
function editable(item: VocabularyCaseQueueItem) { if (item.frozen || item.approvalState === 'pending') throw new ApiRequestError('Case is frozen while work is pending', 409); }
function source(): VocabularyContent { return { contentId: 'source', version: 1, kind: 'exercise', payloadVersion: 1, body: { prompt: params.has('repertoire')?repertoireSource:'Before taking leave, you should ____ your supervisor.' }, exerciseType: 'definition', skill: 'production', exerciseRole: 'general', assessment: { match: 'prepared_answer_membership' }, accessScope: 'shared', availability: 'active', originKind: 'model', authorKind: 'service', authorId: 'fixture', words: [{ wordId: 'word', relation: 'target' }], answers: [{ wordId: 'word', acceptedForms: [params.has('repertoire')?'函':'报备'] }], createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z' }; }
const originals = new Map<string,VocabularyContentProposal>();
const drafts = new Map<string, VocabularyContentProposal>();
let failSavedCueRead=false;
function fullProposal(id: string): VocabularyContentProposal {
  if (drafts.has(id)) return copy(drafts.get(id)!);
  const owner = cards.find(item => item.proposal?.proposalId === id || item.alternatives.some(proposal => proposal.proposalId === id)); if (!owner) throw new Error('Unknown proposal');
  const projected = owner.proposal!, alternative = owner.alternatives.find(proposal => proposal.proposalId === id);
  return { proposalId: id, caseId: owner.caseId, version: alternative?.version ?? projected.version, status: alternative?.status ?? projected.status, rationale: alternative?.rationale ?? projected.rationale, authorKind: alternative ? 'operator' : 'service', authorId: 'fixture', invocationId: null, bases: [{ contentId: 'source', expectedVersion: 1 }], operations: projected.operations.map(operation => ({ operationKey: operation.operationKey, strategy: operation.strategy, ...(operation.strategy === 'create' ? {} : { sourceContentId: 'source', expectedVersion: 1 }), learningRole: operation.learningRole, scope: { kind: 'shared' as const }, rationale: operation.rationale, content: { ...source(), ...(params.has('repertoire')?{words:[{wordId:'word',relation:'target',senseId:repertoireIds[Number(operation.operationKey.split('-')[1])]}]}:{}), body: { prompt: operation.prompt ?? 'Full structured content', ...(owner.requiresDetails ? { reveal: { teachingNote: 'Full teaching explanation only loaded in Details.' } } : {}) }, answers: [{ wordId: 'word', acceptedForms: operation.acceptedAnswers }] } })) } as VocabularyContentProposal;
}
function workspace(id: string): VocabularyCaseWorkspace {
  const item = card(id), original = source();
  const evidence: VocabularyEncounterEvidence[] = item.served.map(entry => {
    const responses: VocabularyEncounterEvidence['responses'] = entry.responses.map((response,index) => ({protocolVersion:1,actionId:response.actionId,clientActionId:response.actionId,sequence:index+2,occurredAt:item.createdAt,kind:'response',payload:{encounterId:entry.encounterId,response:response.text,outcome:response.outcome==='accepted'?'accepted':'rejected'}}));
    const feedback: VocabularyEncounterEvidence['feedback'] = entry.reactions.map((reaction,index) => ({protocolVersion:1,actionId:reaction.actionId,clientActionId:reaction.actionId,sequence:index+20,occurredAt:item.createdAt,kind:'feedback',payload:{encounterId:entry.encounterId,feedback:'comment',comment:reaction.comment??reaction.feedback}}));
    return { encounterId: entry.encounterId, wordId: 'word',workNumber:1,presentedActionId:'presentation',presentedAt:item.createdAt,mode:'practice', snapshot: { contentId: 'source', contentVersion: 1, role: 'general', kind: 'production', body: { prompt: entry.prompt??'' }, assessment: { acceptedAnswers: entry.acceptedAnswers, criteria: {} } }, responses, effectiveResponses:responses.filter(response=>!entry.responses.find(value=>value.actionId===response.actionId)?.undone),feedback,effectiveFeedback:feedback.filter(reaction=>!entry.reactions.find(value=>value.actionId===reaction.actionId)?.undone), skipped:entry.skipped,presentationUndone:entry.presentationUndone };
  });
  return { case: { caseId: id, completionId: 'completion', learnerId: 'fixture-learner', kind: item.kind, wordId: 'word', contentId: 'source', createdAt: item.createdAt, status: item.state === 'resolved' ? 'closed' : 'completed', evidence, review: { ...item, currentJobId: item.currentAssessment?.jobId ?? null } }, sources: [original], proposals: [...(item.proposal ? [fullProposal(item.proposal.proposalId)] : []), ...item.alternatives.map(value => fullProposal(value.proposalId))], diagnosis: item.assessment?.diagnosis, senseLabels: params.has('repertoire')?repertoireSenses.map(sense=>({...sense,wordId:'word'})):[], ...(params.has('repertoire')?{admission:repertoireAdmission()}:{}), assessment: item.assessment ? { origin: item.assessment.origin, models: item.assessment.models,...(params.has('repertoire')?{admission:repertoireAdmission()}: {}) } : undefined, jobs: [{ jobId: item.currentAssessment?.jobId ?? 'first', caseSequence: 1, kind: 'exercise_improvement', status: 'succeeded', attemptNumber: 1, error: null, secondOpinion: false, result: null }], reassessmentUnavailableReason:item.reassessment.reason,reassessmentSource: item.reassessment.source, reassessment: item.latestJob && item.latestJob.sequence > 1 ? { caseId: id, jobId: item.latestJob.jobId, status: item.latestJob.status, error: item.latestJob.error } : null };
}
const targets=new Map<string,{version:number;currentSenseId:string;pendingSenseId:string|null}>();
function target(id:string){const item=card(id);if(!item.wordId)throw new Error('Unknown vocabulary word review');let intent=targets.get(id);if(!intent){intent={version:0,currentSenseId:'sense-advance',pendingSenseId:params.has('targetPending')?'sense-register':null};targets.set(id,intent);}return {caseId:id,wordId:item.wordId!,...intent,senses:[{senseId:'sense-advance',label:'report in advance'},{senseId:'sense-register',label:'register on record'}],available:!params.has('repertoire'),blocked:intent.pendingSenseId!==null,editable:item.state==='open'&&!item.frozen&&item.approvalState!=='pending'};}
let failTargetReads=params.has('targetReadFailure');
const heldTargetReads:(()=>void)[]=[];
let loseNoteAck=params.has('lostNoteAck');
let resolveBeforeNote=params.has('resolveBeforeNote');
function recordComment(item:VocabularyCaseQueueItem,action:NonNullable<VocabularyCaseQueueItem['activity']>[number]['action'],text:string,secondOpinionRequestId?:string){if(!text.trim()&&!secondOpinionRequestId)return;item.activity??=[];item.activity.push({activityId:crypto.randomUUID(),action,text,createdAt:new Date().toISOString(),actorId:'fixture',...(secondOpinionRequestId?{secondOpinionRequestId}:{})});}
const api: VocabularyOperatorApi = { ...vocabularyOperatorApi,
  addCaseNote:async(id,version,requestId,text)=>{count('mutations');const item=card(id);const prior=item.notes?.find(note=>note.noteId===requestId);if(prior)return copy(item);if(resolveBeforeNote){resolveBeforeNote=false;item.state='resolved';item.resolvedAt=new Date().toISOString();item.version++;throw new ApiRequestError('Case changed',409);}editable(item);if(version!==item.version)throw new ApiRequestError('Case changed',409);item.notes??=[];item.notes.push({noteId:requestId,text,createdAt:new Date().toISOString(),actorId:'fixture'});item.version++;if(loseNoteAck){loseNoteAck=false;throw new Error('Simulated lost note acknowledgement');}return copy(item);},
  wordSenseCoverage:async()=>{
    const value=wordCoverage();
    if (!odds) return copy(value);
    return {...value,word:{...value.word,version:hairpinDefaults===null?0:1,defaultUsefulSenseIds:hairpinDefaults},
      selectionEstablished:hairpinDefaults!==null,includedSenseIds:hairpinDefaults??[],
      senses:[{...value.senses[0],senseId:'hairpin',description:{label:'A traditional ornamental hairpin'}}]};
  },
  saveDefaultUsefulSenses:async(id,version,ids)=>{
    if(odds){hairpinDefaults=[...ids];return api.wordSenseCoverage(id);}
    if(version!==repertoireSelectionVersion)throw new ApiRequestError('Word defaults changed',409);
    repertoireSelection=[...ids];repertoireSelectionVersion++;return copy(wordCoverage());
  },
  proposeCaseRetirement:async(id,version)=>{
    const item=card(id);
    if(item.version!==version||item.proposal)throw new ApiRequestError('Case changed',409);
    const rationale='Retire the exercise without a replacement.';
    await api.create({caseId:id,rationale,operations:[{operationKey:'retire-source',strategy:'retire',sourceContentId:'source',
      expectedVersion:1,scope:{kind:'shared'},rationale,content:{...source(),body:{prompt:item.served[0].prompt}}}]});
    return copy(item);
  },
  fallbackRepertoire:async(id)=>({sourceVersion:1,catalogVersion:1,wordVersion:1,
    defaultSenseIds:card(id).wordLabel==='处置'?['handle','punish']:[],senses:card(id).wordLabel==='处置'?fallbackSenses:[],
    exercises:card(id).wordLabel==='处置'?[
      {contentId:'old-1',senseId:'dispose',prompt:'Decide what to do with the old office furniture.'},
      {contentId:'old-2',senseId:'dispose',prompt:'How should we dispose of the seized goods?'}]:[],
  }),
  generateFallbackRepertoire:async(id,input)=>{
    const queued=await api.reassessCaseReview(id,input.expectedVersion,input.modelChoice,input.expectedContentVersion);
    card(id).reassessment.eligible=false;
    queued.item.reassessment.eligible=false;
    generatedSenseIds=input.senseIds;
    return queued;
  },
  saveRepertoireWordDefaultsAndReassess:async(id,input)=>{
    const item=cards.find(value=>value.proposal?.proposalId===id)!;editable(item);
    if(params.has('selectionQueueFailure'))throw new ApiRequestError('Could not queue reassessment. Selection was not saved.',409);
    if(item.proposal!.version!==input.expectedVersion||item.version!==input.expectedCaseVersion||repertoireSelectionVersion!==input.expectedWordVersion)throw new ApiRequestError('Selection or case changed',409);
    if(!input.includedSenseIds.length)throw new ApiRequestError('Select at least one sense',409);
    const queued=await api.reassessCaseReview(item.caseId,input.expectedCaseVersion,input.modelChoice,input.expectedContentVersion,{proposalId:id,expectedVersion:input.expectedVersion});
    repertoireSelection=[...input.includedSenseIds];repertoireSelectionVersion++;
    return {...queued,coverage:copy(wordCoverage())};
  },
  saveRepertoireWordDefaults:async(id,version,wordVersion,ids)=>{
    const item=cards.find(value=>value.proposal?.proposalId===id)!;editable(item);const previous=fullProposal(id);
    if(previous.version!==version)throw new ApiRequestError('Proposal changed',409);
    if(wordVersion!==repertoireSelectionVersion)throw new ApiRequestError('Word defaults changed',409);
    retainedRepertoire??=copy(previous.operations);retainedRepertoireProjection??=copy(item.proposal!.operations);
    if(ids.some(sense=>!retainedRepertoire!.some(operation=>operation.content.words.some(word=>word.senseId===sense))))throw new ApiRequestError('New senses require reassessment and generation.',409);
    const operations=copy(retainedRepertoire.filter(operation=>operation.content.words.some(word=>word.senseId&&ids.includes(word.senseId))));
    if(!operations.length)throw new ApiRequestError('No exercises remain. Dismiss or generate a new repertoire.',409);
    if(retainedRepertoire.some(operation=>operation.strategy==='replace')&&!operations.some(operation=>operation.strategy==='replace'))operations[0]={...operations[0],strategy:'replace',sourceContentId:'source',expectedVersion:1};
    const result={...previous,operations,version:version+1};drafts.set(id,result);repertoireSelection=[...ids];repertoireSelectionVersion++;
    item.proposal!.operations=retainedRepertoireProjection.filter(operation=>operations.some(value=>value.operationKey===operation.operationKey)).map(operation=>({...operation,strategy:operations.find(value=>value.operationKey===operation.operationKey)!.strategy}));
    item.proposal!.version++;item.version++;return copy({proposal:result,coverage:wordCoverage()});
  },
  repairTarget:async id=>{if(params.has('holdTargetRead'))await new Promise<void>(resolve=>heldTargetReads.push(resolve));if(failTargetReads)throw new Error('Could not load target sense.');return copy(target(id));},
  saveRepairTarget:async(id,version,senseId)=>{const item=card(id);editable(item);const value=target(id);if(value.version!==version)throw new ApiRequestError('Target changed',409);targets.set(id,{version:version+1,currentSenseId:value.currentSenseId,pendingSenseId:senseId});item.version++;return copy(target(id));},
  caseQueue: async (query = {}) => { count(query.view === 'history' ? 'history' : 'queue'); const search = query.search?.toLocaleLowerCase(); const pool = cards.filter(item => query.view === 'history' ? item.state === 'resolved' && (!search || JSON.stringify(item).toLocaleLowerCase().includes(search)) : item.state === 'open' && !item.approvalState && (query.view === 'deferred' ? !!item.deferredAt : !item.deferredAt)); const limit=query.limit??20; const anchor=query.cursor?pool.findIndex(item=>item.caseId===query.cursor):-1; const offset=query.edge==='last'?Math.max(0,pool.length-limit):query.edge==='first'?0:query.direction==='previous'?Math.max(0,anchor-limit):anchor+1; const items=pool.slice(offset,query.direction==='previous'&&!query.edge?Math.max(0,anchor):offset+limit); const result=copy({items,anchorCursor:items[0]?.caseId??query.cursor??null,total:pool.length,startIndex:offset,previousCursor:offset>0?items[0]?.caseId??null:null,nextCursor:offset+items.length<pool.length?items.at(-1)?.caseId??null:null}); if(holdQueue){holdQueue=false;await new Promise<void>(resolve=>pendingQueue.push(resolve));}return result; },
  setCaseDeferred: async (id, version, deferred) => { const item=card(id);editable(item);if(item.version!==version||item.activeJob)throw new ApiRequestError('Case changed',409);item.deferredAt=deferred?new Date().toISOString():null;item.version++;count('mutations');return copy(item); },
  caseCard: async (id, proposalId) => { count('card'); if(failSavedCueRead){failSavedCueRead=false;throw new Error('Saved proposal could not be refreshed.');} activeCase = id; const item = copy(card(id)); if(params.has('identitiesExisting')&&id===cards[0]?.caseId)item.availableResponseIdentityOptions=copy(identityOptions); if (proposalId && proposalId !== item.currentProposalId) { const other = item.alternatives.find(value => value.proposalId === proposalId)!; item.proposal = { ...item.proposal!, ...other, authorKind: 'operator', isCurrent: false }; item.assessment = null; } return item; },
  workspace: async id => { count('workspace'); activeCase = id; return copy(workspace(id)); },
  originalModelProposal: async id => {if(!originals.has(id)){const value=fullProposal(id);originals.set(id,copy(value));}const value=originals.get(id)!;return {proposal:value.authorKind==='service'?copy(value):null};},
  proposal: async id => { count('proposal'); return fullProposal(id); },
  reviewBatch: async (id) => { count('fullSnapshot'); const proposal = fullProposal(id), full = workspace(proposal.caseId!); return { items: [{ proposal, case: full.case, assessment: full.assessment, currentSources: full.sources, senseLabels:full.senseLabels, reassessment: { eligible: true, source: full.reassessmentSource ?? null, latest: full.reassessment ?? null }, previews: proposal.operations.map(operation => ({ operationKey: operation.operationKey, source: operation.strategy === 'create' ? null : source(), result: operation.content })) }], nextProposalId: null }; },
  resolveCaseReview: async (id, version, reason) => { count('mutations'); const item = card(id); editable(item); if (version !== item.version || item.proposal) throw new ApiRequestError('Case changed', 409); recordComment(item,'done',reason); item.state = 'resolved'; item.resolvedAt = new Date().toISOString(); item.version++; return copy(item); },
  close: async (id, version, reason) => { count('mutations'); const item = cards.find(value => value.proposal?.proposalId === id || value.alternatives.some(proposal => proposal.proposalId === id))!; editable(item); recordComment(item,'dismiss',reason); if (item.proposal?.proposalId === id) { item.proposal.status = 'closed'; if (item.alternatives.length) { const alternative = item.alternatives.shift()!; item.proposal = { ...item.proposal, ...alternative, isCurrent: true }; item.currentProposalId = alternative.proposalId; item.alternativeCount--; } else { item.state = 'resolved'; item.resolvedAt = new Date().toISOString(); } } else { item.alternatives = item.alternatives.filter(proposal => proposal.proposalId !== id); item.alternativeCount--; } item.version++; return { ok: true }; },
  save: async (id, version, draft) => { count('mutations'); const owner = cards.find(item => item.proposal?.proposalId === id)!; editable(owner); if(target(owner.caseId).blocked)throw new ApiRequestError('Reassess or reset target',409);const previous = fullProposal(id); if(!originals.has(id))originals.set(id,copy(previous)); if (previous.version !== version) throw new ApiRequestError('Proposal changed', 409); const result = { ...previous, ...draft, version: version + 1 }; failSavedCueRead=params.has('cueRefreshFailure'); drafts.set(id, result); owner.version++; owner.proposal!.version++; owner.proposal!.rationale = draft.rationale; owner.proposal!.operations = owner.proposal!.operations.map(operation => {const body=draft.operations.find(value => value.operationKey === operation.operationKey)?.content.body;return { ...operation, prompt: body&&typeof body==='object'&&!Array.isArray(body)&&typeof body.prompt==='string'?body.prompt:operation.prompt };}); if(params.has('cueSaveLostAck'))throw new Error('Save acknowledgement lost.');return copy(result); },
  create: async draft => {count('mutations');if(!draft.caseId)throw new Error('Fixture manual correction requires a case');const owner=card(draft.caseId);editable(owner);const id=`manual-${owner.caseId}-${owner.version}`;const saved:VocabularyContentProposal={proposalId:id,caseId:owner.caseId,version:1,status:'draft',operations:draft.operations,rationale:draft.rationale,bases:draft.bases??[],authorKind:'operator',authorId:'fixture-operator',invocationId:null};drafts.set(id,saved);if(owner.proposal){owner.alternatives.push({proposalId:owner.proposal.proposalId,version:owner.proposal.version,status:owner.proposal.status,rationale:owner.proposal.rationale});owner.alternativeCount++;}owner.proposal={proposalId:id,version:1,status:'draft',authorKind:'operator',isCurrent:true,rationale:draft.rationale,operations:draft.operations.map(operation=>{const body=operation.content.body;return {operationKey:operation.operationKey,strategy:operation.strategy,scopeLabel:'Shared',groupLabel:'Operator correction',prompt:body&&typeof body==='object'&&!Array.isArray(body)&&typeof body.prompt==='string'?body.prompt:null,acceptedAnswers:operation.content.kind==='exercise'?operation.content.answers.flatMap(answer=>answer.acceptedForms):[],rationale:operation.rationale,sourceContentId:operation.strategy==='create'?null:operation.sourceContentId,expectedVersion:operation.strategy==='create'?null:operation.expectedVersion,otherChanges:[]};})};owner.currentProposalId=id;owner.version++;return copy(saved);},
  requestApproval: async (id, version, requestId, notes) => { count('mutations'); const existing = requests.find(item => item.requestId === requestId); if (existing) return copy(existing); const owner = cards.find(item => item.proposal?.proposalId === id || item.alternatives.some(proposal => proposal.proposalId === id))!; editable(owner);if(target(owner.caseId).blocked)throw new ApiRequestError('Reassess or reset target',409); if(rejectApproval){rejectApproval=false;owner.proposal!.version++;owner.version++;const saved=drafts.get(id);if(saved)drafts.set(id,{...saved,version:owner.proposal!.version});throw new ApiRequestError('Proposal changed before approval',409);} if(fullProposal(id).version!==version)throw new ApiRequestError('Proposal version is stale',409);owner.approvalState = 'pending'; owner.approvalRequestId = requestId; owner.version++; const request: VocabularyApprovalRequest = { requestId, proposalId: id, expectedVersion: version, notes, actorId: 'fixture', status: 'queued', attempts: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), error: null, application: null }; requests.push(request); if (lostAck) { lostAck = false; throw new Error('Simulated lost approval acknowledgement'); } return copy(request); },
  reassessCaseReview: async (id, version, _model, _source, _origin, editorial) => { count('mutations'); const item = card(id); editable(item); if (version !== item.version) throw new ApiRequestError('Case changed', 409); if(editorial)recordComment(item,'reassess',editorial.instructions,editorial.secondOpinionRequestId); const sequence = (item.latestJob?.sequence ?? 0) + 1, jobId = `${id}-job-${sequence}`; item.version++; item.frozen = true; item.activeJob = { jobId, sequence, status: 'queued' }; item.latestJob = { ...item.activeJob, error: null, advisory: false }; activeCase = id; return { caseId: id, jobId, item: copy(item) }; },
  abandonReassessment: async (id,version,jobId) => {count('mutations');const item=card(id);if(item.version!==version||item.latestJob?.jobId!==jobId)throw new ApiRequestError('Case changed',409);item.frozen=false;item.latestJob=null;item.version++;return copy(item);},
  retryJob: async id => { count('mutations'); const item = cards.find(value => value.latestJob?.jobId === id)!; item.latestJob!.status = 'queued'; item.latestJob!.error = null; item.activeJob = { jobId: id, sequence: item.latestJob!.sequence, status: 'queued' }; item.frozen = !item.latestJob!.advisory; item.version++; return { ok: true }; },
  requestSecondOpinion: async (id, version) => { count('mutations'); const item = cards.find(value => value.proposal?.proposalId === id)!; item.advisoryOpinion = { requestId: 'opinion', jobId: 'opinion-job', sequence: 2, status: 'succeeded', attemptNumber: 1, error: null, result: { verdict: 'support', rationale: 'The revised cue clearly targets advance reporting.' } }; item.version++; return { ...item.advisoryOpinion, proposalId: id, proposalVersion: version, requestedAt: new Date().toISOString() }; },
  requestCaseSecondOpinion: async id => { const item = card(id); item.advisoryOpinion = { requestId: 'opinion', jobId: 'opinion-job', sequence: 2, status: 'succeeded', attemptNumber: 1, error: null, result: { verdict: 'support', rationale: 'The no-change assessment is supported.' } }; item.version++; return { ok: true }; },
  secondOpinions: async () => ({ items: [] }),
  attentionQueue: async (query = {}) => { count('attention'); const failures=cards.filter(item=>item.frozen&&item.latestJob?.status==='failed').map(item=>({id:`case:${item.caseId}`,kind:'case' as const,title:item.wordLabel??'Content review',reason:'Assessment output failed validation.',createdAt:item.createdAt,caseId:item.caseId,caseKind:'exercise_improvement' as const,jobId:item.latestJob!.jobId,retryable:true,sourceSuperseded:false,dismissible:false,abandonable:true}));const approvals=requests.filter(request => request.status === 'attention').map(request => ({id: `approval:${request.requestId}`, kind: 'approval' as const, title: 'Content application', reason: request.error ?? 'Application failed.', createdAt: request.createdAt, caseId: cards.find(item => item.approvalRequestId === request.requestId)?.caseId ?? null, requestId: request.requestId, proposalId: request.proposalId, expectedVersion: request.expectedVersion, attempts: request.attempts, retryable: true}));const items=[...failures,...approvals].filter(item => !query.kind || query.kind === item.kind);const anchor=query.anchorId?items.findIndex(item=>item.id===query.anchorId):-1;const offset=anchor>=0?Math.floor(anchor/(query.limit??20))*(query.limit??20):query.offset??0;return {items: copy(items.slice(offset,offset+(query.limit??20))), total: items.length, offset}; },
  approvalRequests: async () => { count('attention'); return { items: copy(requests) }; },
  cases: async () => { count('attention'); return { items: [] }; },
  dispatches: async () => { count('attention'); return { items: [] }; },
  preparationFailures: async () => { count('attention'); return { items: [] }; },
  proposals: async () => { count('broadLists'); throw new Error('Broad proposal list must not be used'); },
  noProposalCases: async () => { count('broadLists'); throw new Error('Broad no-proposal list must not be used'); },
};
button('Release target reads',()=>heldTargetReads.splice(0).forEach(resolve=>resolve()));
button('Fail target refresh',()=>{failTargetReads=true;for(const item of cards)item.version++;});
button('Finish reassessment', () => {
  const item = cards.find(value => value.activeJob && !value.latestJob?.advisory);
  if (!item) return;
  const intent=targets.get(item.caseId);
  if(intent?.pendingSenseId){intent.currentSenseId=intent.pendingSenseId;intent.pendingSenseId=null;intent.version++;}
  item.currentAssessment={jobId:item.activeJob!.jobId,sequence:item.activeJob!.sequence};
  item.assessment={...item.assessment!,...item.currentAssessment,origin:'reassessment',diagnosis:'Fresh assessment completed within the same case.'};
  item.latestJob!.status='succeeded';item.frozen=false;item.activeJob=null;item.reassessment.eligible=true;item.version++;
  if(item.responseIdentityOptions){delete item.responseIdentityOptions;item.finding=null;item.needsDecision=false;}
  if(odds && generatedSenseIds && item.wordLabel==='处置'){
    const senseIds=generatedSenseIds;
    generatedSenseIds=null;
    const rationale='Generate additional practice for the selected senses.';
    item.finding=null;item.needsDecision=false;item.assessment.outcome='selected_repertoire';item.assessment.diagnosis=rationale;
    void api.create({caseId:item.caseId,rationale,operations:senseIds.map(senseId=>({
      operationKey:senseId,strategy:'create',scope:{kind:'shared'},rationale,
      content:{...source(),contentId:`generated-${senseId}`,body:{prompt:senseId==='punish'?'What penalty will the school impose for cheating?':'How did the team deal with the emergency?'},
        words:[{wordId:'word',relation:'target',senseId}]},
    }))}).then(()=>{
      item.proposal!.operations.forEach(op=>{op.groupLabel=fallbackSenses.find(sense=>sense.senseId===op.operationKey)!.label;});
    });
  }
});
button('Fail reassessment', () => { const item = cards.find(value => value.activeJob); if (!item) return; item.latestJob!.status = 'failed'; item.latestJob!.error = 'provider_failed'; item.activeJob = null; item.frozen = true; item.version++; });
button('Change shared source', () => { for (const item of cards) { item.sources[0].version = 2; item.sources[0].prompt = 'Updated shared source: file advance notice with your supervisor.'; item.reassessment.source!.currentVersion = 2; item.stale = true; } });
button('Resolve first case externally', () => { const item = cards.find(value => value.state === 'open'); if (item) { item.state = 'resolved'; item.version++; item.resolvedAt = new Date().toISOString(); } });
button('Hold next queue response',()=>{holdQueue=true;});
button('Release queue response',()=>{pendingQueue.splice(0).forEach(resolve=>resolve());});
button('Reject next approval with 409',()=>{rejectApproval=true;});
button('Lose next approval ACK', () => { lostAck = true; });
button('Fail pending approval', () => { const request = requests.find(value => value.status === 'queued'); if (!request) return; request.status = 'attention'; request.error = 'Source version changed before application'; request.updatedAt = new Date().toISOString(); const item = cards.find(value => value.approvalRequestId === request.requestId)!; item.approvalState = 'attention'; item.version++; });
button('Reset counters', () => { for (const key of Object.keys(counts)) counts[key] = 0; count('mutations'); counts.mutations = 0; counter.textContent = Object.entries(counts).map(([name, value]) => `${name}: ${value}`).join(' · '); });

// The testbed's app archetype uses the real root and route with this same API fixture.
if (params.has('shell')) {
  Object.assign(vocabularyOperatorApi, api);
  window.fetch = async input => { throw new Error(`Unsupported simulated request: ${String(input)}`); };
}
if(params.has('hideControls'))controls.style.display='none';
if (params.has('largeText')) document.documentElement.style.fontSize = '21px';
if (params.has('narrow')) { controls.style.display='none'; const url=new URL(location.href);url.searchParams.delete('narrow');url.searchParams.set('hideControls','1');const frame=document.createElement('iframe');frame.src=url.href;frame.title='Narrow operator review';frame.style.cssText='width:480px;max-width:100%;height:100dvh;border:0;display:block';document.getElementById('root')!.append(frame); } else createRoot(document.getElementById('root')!).render(params.has('shell') ? <App/> : params.has('usage') ? <OperatorShell tab="improvement"><VocabularyCaseReviewPage api={api} /></OperatorShell> : <VocabularyCaseReviewPage api={api} />);
