import { VocabularySenseCoverageConflict,getVocabularySenseCoverageWorkspace,setVocabularyWordSenseCoverage,setVocabularyCaseSenseCoverage } from '../db/vocabulary-sense-coverage.ts';
import type { Express,Request,Response } from 'express';
import type { VocabularyContentDraft, VocabularyJson } from '../../src/domain/vocabulary-content.ts';
import type { VocabularyProposalDraft, VocabularyProposalOperation, VocabularyContentProposal, VocabularyReflectionCase } from '../../src/domain/vocabulary-reflection.ts';
import { isOfferedReflectionModelChoice } from '../reflection/model-arms.ts';
import { createVocabularyPracticePreparation } from './preparation.ts';
import { createOperatorAllowlistMiddleware } from '../operator-access.ts';
import { getVocabularyApprovalRequests } from './approval-requests.ts';
import { getVocabularyCaseWorkspace, listVocabularyReflectionCases, listVocabularyProposals, listVocabularyProposalReviewBatch, getVocabularyProposal,
  requestVocabularyReassessment, requestVocabularySecondOpinion, listVocabularySecondOpinions, listVocabularyNoProposalCases, requestVocabularyCaseSecondOpinion, createVocabularyProposal, saveVocabularyProposal, previewVocabularyProposal, approveVocabularyProposal,
  applyVocabularyProposal, closeVocabularyProposal, closeVocabularyCase, listOwnVocabularyMessages,
  getOwnVocabularyFeedbackAttention,listOwnVocabularyFeedbackFailures,listOwnVocabularyFeedbackJobs, markOwnVocabularyMessageSeen, dismissOwnVocabularyMessage, restoreOwnVocabularyMessage, retryOwnVocabularyFeedback,
  retryVocabularyReflectionJob, listVocabularyFailedDispatches, retryVocabularyPostSessionDispatch, VocabularyReflectionConflict } from '../db/vocabulary-reflection.ts';

export class VocabularyReflectionRequestError extends Error {}
function object(value:unknown,allowed:readonly string[]):Record<string,unknown> {
  if(value===null||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!allowed.includes(key)))throw new VocabularyReflectionRequestError('Expected an object with supported fields');
  return value as Record<string,unknown>;
}
function text(value:unknown):string {if(typeof value!=='string'||!value.trim())throw new VocabularyReflectionRequestError('Expected nonempty text');return value;}
function optionalText(value:unknown):string {if(value===undefined)return '';if(typeof value!=='string')throw new VocabularyReflectionRequestError('Expected text');return value;}
function version(value:unknown):number{if(typeof value!=='number'||!Number.isSafeInteger(value)||value<1)throw new VocabularyReflectionRequestError('Expected positive version');return value;}
function list(value:unknown):unknown[]{if(!Array.isArray(value))throw new VocabularyReflectionRequestError('Expected array');return value;}
function choice<T extends string>(value:unknown,options:readonly T[]):T{if(typeof value!=='string'||!options.includes(value as T))throw new VocabularyReflectionRequestError('Unsupported choice');return value as T;}
function json(value:unknown):void {
  if(value===null||typeof value==='string'||typeof value==='boolean'||(typeof value==='number'&&Number.isFinite(value)))return;
  if(Array.isArray(value)){value.forEach(json);return;}
  if(value!==null&&typeof value==='object'){Object.values(value).forEach(json);return;}
  throw new VocabularyReflectionRequestError('Expected JSON value');
}
function contentDraft(value:unknown):VocabularyContentDraft {
  const item=object(value,['contentId','kind','payloadVersion','body','accessScope','ownerLearnerId','availability','originKind','authorKind','authorId',
    'words','exerciseType','skill','exerciseRole','assessment','answers','teachingExercises']);
  const kind=choice(item.kind,['exercise','introduction']);version(item.payloadVersion);json(item.body);
  const scope=choice(item.accessScope,['shared','private']);
  if(scope==='private')text(item.ownerLearnerId);else if(item.ownerLearnerId!=null)throw new VocabularyReflectionRequestError('Shared content cannot have a learner owner');
  choice(item.availability,['active','quarantined','retired']);choice(item.originKind,['model','human','import']);
  for(const key of ['contentId','authorKind','authorId'])if(item[key]!=null)text(item[key]);
  for(const value of list(item.words)) {
    const word=object(value,['wordId','relation','senseId','senseMappingEstablishedAt']);text(word.wordId);choice(word.relation,['target','context']);
    if(word.senseId!=null)text(word.senseId);if(word.senseMappingEstablishedAt!=null) {
      const at=text(word.senseMappingEstablishedAt);if(!Number.isFinite(Date.parse(at))||new Date(at).toISOString()!==at)throw new VocabularyReflectionRequestError('Expected canonical UTC mapping timestamp');
    }
  }
  if(kind==='exercise') {
    text(item.exerciseType);text(item.skill);choice(item.exerciseRole,['teaching','general']);json(item.assessment);
    if(list(item.answers).length===0)throw new VocabularyReflectionRequestError('Exercise requires answers');
    for(const value of list(item.answers)){const answer=object(value,['wordId','acceptedForms']);text(answer.wordId);if(list(answer.acceptedForms).length===0)throw new VocabularyReflectionRequestError('Expected accepted forms');list(answer.acceptedForms).forEach(text);}
    if(item.teachingExercises!==undefined)throw new VocabularyReflectionRequestError('Exercise cannot define an introduction repertoire');
  }else {
    if(['exerciseType','skill','exerciseRole','assessment','answers'].some(key=>item[key]!==undefined))throw new VocabularyReflectionRequestError('Introduction cannot define exercise fields');
    for(const value of list(item.teachingExercises)){const binding=object(value,['exerciseId','exerciseVersion']);text(binding.exerciseId);version(binding.exerciseVersion);}
  }
  return value as VocabularyContentDraft;
}
export function parseVocabularyProposalDraft(value:unknown):VocabularyProposalDraft {
  const draft=object(value,['caseId','operations','rationale','invocationId','bases']);text(draft.rationale);
  for(const key of ['caseId','invocationId'])if(draft[key]!==undefined)text(draft[key]);
  if(list(draft.operations).length===0)throw new VocabularyReflectionRequestError('Proposal requires operations');
  const operations=list(draft.operations).map(value=>{
    const operation=object(value,['operationKey','scope','rationale','strategy','sourceContentId','expectedVersion','content']);
    text(operation.operationKey);text(operation.rationale);const strategy=choice(operation.strategy,['create','update_existing','replace','retire']);
    const scope=object(operation.scope,['kind','learnerId']);choice(scope.kind,['shared','learner']);
    if(scope.kind==='learner')text(scope.learnerId);else if(scope.learnerId!==undefined)throw new VocabularyReflectionRequestError('Shared effect cannot carry learner scope');
    if(strategy!=='create'){text(operation.sourceContentId);version(operation.expectedVersion);}
    else if(operation.sourceContentId!==undefined||operation.expectedVersion!==undefined)throw new VocabularyReflectionRequestError('Creation has no source write');
    contentDraft(operation.content);return value as VocabularyProposalOperation;
  });
  if(draft.bases!==undefined)for(const value of list(draft.bases)){const base=object(value,['contentId','expectedVersion']);text(base.contentId);version(base.expectedVersion);}
  return {...draft,operations} as VocabularyProposalDraft;
}
function noBody(req:Request):void{object(req.body??{},[]);}
function failure(error:unknown,res:Response):void {
  const message=error instanceof Error?error.message:'';
  const status=error instanceof VocabularyReflectionConflict||error instanceof VocabularySenseCoverageConflict?409
    :message==='Operator access required'||message.includes('does not belong to current')||message.includes('Learner context')?403
    :/^Unknown vocabulary/.test(message)?404
    :error instanceof VocabularyReflectionRequestError||error instanceof TypeError?400
    :error instanceof Error&&!('code' in error)?400:500;
  res.status(status).json({error:status===500?'Vocabulary reflection operation failed.':message});
}
export function registerVocabularyReflectionRoutes(app:Express,options:{wake?:()=>void}={}):void {
  const base='/api/operator/vocabulary',feedback='/api/vocabulary/feedback',gate=createOperatorAllowlistMiddleware();
  const handle=(work:(req:Request,actor:string)=>unknown)=>(req:Request,res:Response)=>{
    try{res.json(work(req,res.locals.operatorSubject as string));}catch(error){failure(error,res);}
  };
  app.get(`${feedback}/attention`,handle(()=>getOwnVocabularyFeedbackAttention()));
  app.get(feedback,handle(()=>({messages:listOwnVocabularyMessages(),failures:listOwnVocabularyFeedbackFailures(),jobs:listOwnVocabularyFeedbackJobs()})));
  app.post(`${feedback}/:messageId/seen`,handle(req=>{noBody(req);markOwnVocabularyMessageSeen(text(req.params.messageId));return {ok:true};}));
  app.post(`${feedback}/:messageId/dismiss`,handle(req=>{noBody(req);dismissOwnVocabularyMessage(text(req.params.messageId));return {ok:true};}));
  app.post(`${feedback}/:messageId/restore`,handle(req=>{noBody(req);restoreOwnVocabularyMessage(text(req.params.messageId));return {ok:true};}));
  app.post(`${feedback}/jobs/:jobId/retry`,handle(req=>{noBody(req);retryOwnVocabularyFeedback(text(req.params.jobId));options.wake?.();return {ok:true};}));
  for(const scope of ['word','case'] as const) {
    const path=`${base}/${scope==='word'?'words':'cases'}/:id/sense-coverage`;
    app.get(path,gate,handle((req,actor)=>{object(req.query,[]);return getVocabularySenseCoverageWorkspace(scope,text(req.params.id),actor);}));
    app.put(path,gate,handle((req,actor)=>{
      const key=scope==='word'?'excludedSenseIds':'includedSenseIds',input=object(req.body,['expectedVersion',key]);
      if(!Number.isSafeInteger(input.expectedVersion)||Number(input.expectedVersion)<0)throw new VocabularyReflectionRequestError('Expected nonnegative coverage version');
      const selected=scope==='case'&&input[key]===null?null:list(input[key]).map(text);
      return scope==='word'?setVocabularyWordSenseCoverage(text(req.params.id),Number(input.expectedVersion),selected!,actor)
        :setVocabularyCaseSenseCoverage(text(req.params.id),Number(input.expectedVersion),selected,actor);
    }));
  }
  const practicePreparation=createVocabularyPracticePreparation();
  app.get(`${base}/practice-preparation/failures`,gate,handle(req=>{object(req.query,[]);return {items:practicePreparation.listFailed()};}));
  app.post(`${base}/practice-preparation/:id/retry`,gate,handle((req,actor)=>{
    noBody(req);practicePreparation.retry(text(req.params.id),actor);options.wake?.();return {ok:true};
  }));
  app.get(`${base}/dispatches`,gate,handle((_req,actor)=>({items:listVocabularyFailedDispatches(actor)})));
  app.post(`${base}/dispatches/:id/retry`,gate,handle((req,actor)=>{noBody(req);retryVocabularyPostSessionDispatch(text(req.params.id),actor);options.wake?.();return {ok:true};}));
  app.get(`${base}/cases`,gate,handle((req,actor)=>{
    object(req.query,['kind']);const kind=choice(req.query.kind??'exercise_improvement',['learner_feedback','exercise_improvement','teaching_review'] as const);
    return {items:listVocabularyReflectionCases(kind,actor)};
  }));
  app.get(`${base}/no-proposal-cases`,gate,handle((req,actor)=>{object(req.query,['status']);const status=choice(req.query.status??'completed',['completed','closed'] as const);return {items:listVocabularyNoProposalCases(actor,status)};}));
  app.post(`${base}/cases/:id/second-opinions`,gate,handle((req,actor)=>{
    const input=object(req.body,['notes']);
    if(input.notes!==undefined&&typeof input.notes!=='string')throw new VocabularyReflectionRequestError('Expected text notes');
    requestVocabularyCaseSecondOpinion(text(req.params.id),actor,(input.notes as string|undefined)??'');options.wake?.();return {ok:true};
  }));
  app.post(`${base}/cases/:id/reassessments`,gate,handle((req,actor)=>{
    const input=object(req.body,['modelChoice','expectedContentVersion']);
    if(!Number.isSafeInteger(input.expectedContentVersion)||Number(input.expectedContentVersion)<1)throw new VocabularyReflectionRequestError('Expected positive source content version');
    if(!isOfferedReflectionModelChoice(input.modelChoice)) throw new VocabularyReflectionRequestError('Unsupported assessment model');
    const result=requestVocabularyReassessment(text(req.params.id),actor,input.modelChoice as import('../reflection/model-arms.ts').ReflectionModelChoice,input.expectedContentVersion as number);options.wake?.();return result;
  }));
  app.get(`${base}/cases/:id`,gate,handle((req,actor)=>getVocabularyCaseWorkspace(text(req.params.id),actor)));
  app.post(`${base}/cases/:id/close`,gate,handle((req,actor)=>{const input=object(req.body,['reason']);closeVocabularyCase(text(req.params.id),actor,optionalText(input.reason));return {ok:true};}));
  app.get(`${base}/proposals`,gate,handle((req,actor)=>{
    object(req.query,['status']);const status=req.query.status===undefined?undefined:choice(req.query.status,['draft','awaiting_review','approved','applied','closed'] as const);
    return {items:listVocabularyProposals(actor,status)};
  }));
  app.get(`${base}/approval-requests`,gate,handle(req=>{
    object(req.query,[]);return {items:getVocabularyApprovalRequests().list()};
  }));
  app.post(`${base}/proposals/:id/approval-requests`,gate,(req,res)=>{
    try {
      const input=object(req.body,['expectedVersion','requestId','notes']);if(input.notes!==undefined)json(input.notes);
      const requestId=text(input.requestId);
      if(requestId.length>200)throw new VocabularyReflectionRequestError('Request ID is too long');
      const queue=getVocabularyApprovalRequests();
      const result=queue.enqueue({requestId,proposalId:text(req.params.id),expectedVersion:version(input.expectedVersion),
        actorId:res.locals.operatorSubject as string,notes:(input.notes??null) as VocabularyJson});
      res.status(202).json(result);queue.wake();
    }catch(error){failure(error,res);}
  });
  app.post(`${base}/approval-requests/:id/retry`,gate,(req,res)=>{
    try {
      noBody(req);const queue=getVocabularyApprovalRequests();
      const result=queue.retry(text(req.params.id),res.locals.operatorSubject as string);
      res.status(202).json(result);queue.wake();
    }catch(error){failure(error,res);}
  });
  app.get(`${base}/proposals/review-batch`,gate,handle((req,actor)=>{
    object(req.query,['limit','startProposalId']);
    const raw=req.query.limit;
    if(raw!==undefined&&(typeof raw!=='string'||!/^\d+$/.test(raw)))throw new VocabularyReflectionRequestError('Expected batch limit');
    const limit=raw===undefined?20:Number(raw);
    if(!Number.isSafeInteger(limit)||limit<1||limit>50)throw new VocabularyReflectionRequestError('Expected batch limit between 1 and 50');
    return listVocabularyProposalReviewBatch(actor,{limit,...(req.query.startProposalId===undefined?{}:{startProposalId:text(req.query.startProposalId)})});
  }));
  app.post(`${base}/proposals`,gate,handle((req,actor)=>createVocabularyProposal(parseVocabularyProposalDraft(req.body),actor)));
  app.get(`${base}/proposals/:id`,gate,handle((req,actor)=>getVocabularyProposal(text(req.params.id),actor)));
  app.get(`${base}/proposals/:id/second-opinions`,gate,handle((req,actor)=>({items:listVocabularySecondOpinions(text(req.params.id),actor)})));
  app.post(`${base}/proposals/:id/second-opinions`,gate,handle((req,actor)=>{
    const input=object(req.body,['expectedVersion','notes']);
    if(input.notes!==undefined&&typeof input.notes!=='string')throw new VocabularyReflectionRequestError('Expected text notes');
    const result=requestVocabularySecondOpinion(text(req.params.id),version(input.expectedVersion),actor,input.notes as string|undefined);
    options.wake?.();return result;
  }));
  app.put(`${base}/proposals/:id`,gate,handle((req,actor)=>{const input=object(req.body,['expectedVersion','draft']);
    return saveVocabularyProposal(text(req.params.id),version(input.expectedVersion),parseVocabularyProposalDraft(input.draft),actor);
  }));
  app.post(`${base}/proposals/:id/preview`,gate,handle((req,actor)=>{const input=object(req.body,['expectedVersion']);return previewVocabularyProposal(text(req.params.id),version(input.expectedVersion),actor);}));
  app.post(`${base}/proposals/:id/approve`,gate,handle((req,actor)=>{const input=object(req.body,['expectedVersion','notes']);if(input.notes!==undefined)json(input.notes);
    return {reviewId:approveVocabularyProposal(text(req.params.id),version(input.expectedVersion),actor,input.notes as Parameters<typeof approveVocabularyProposal>[3])};
  }));
  app.post(`${base}/proposals/:id/apply`,gate,handle((req,actor)=>{const input=object(req.body,['expectedVersion','reviewId','idempotencyKey']);
    return applyVocabularyProposal(text(req.params.id),version(input.expectedVersion),text(input.reviewId),text(input.idempotencyKey),actor);
  }));
  app.post(`${base}/proposals/:id/close`,gate,handle((req,actor)=>{const input=object(req.body,['expectedVersion','reason']);closeVocabularyProposal(text(req.params.id),version(input.expectedVersion),actor,optionalText(input.reason));return {ok:true};}));
  app.post(`${base}/jobs/:id/retry`,gate,handle((req,actor)=>{noBody(req);retryVocabularyReflectionJob(text(req.params.id),actor);options.wake?.();return {ok:true};}));
}
