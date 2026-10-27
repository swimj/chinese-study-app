import { vocabularyAuthoredPromptBody } from '../../src/domain/vocabulary-production-coverage.ts';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { VocabularyContent, VocabularyJson } from '../../src/domain/vocabulary-content.ts';
import type { VocabularyReflectionJob, VocabularyReflectionResult, VocabularyProposalOperation } from '../../src/domain/vocabulary-reflection.ts';
import type { JsonSchema } from '../../src/domain/reflection-result-schema.ts';
import { getEffectiveVocabularyEncounterReactions, getVocabularyEncounterReactions } from '../../src/domain/vocabulary-session.ts';
import { runWithLearnerId } from '../db/learner-context.ts';
import { getReflectionSpendCap } from '../db/reflections.ts';
import { assertReflectionModelAllowedUnderSpendCap, type ReflectionSpendCap } from '../reflection/spend-cap.ts';
import { REFLECTION_MODEL_ARMS, isOfferedReflectionModelChoice, type ReflectionModelChoice } from '../reflection/model-arms.ts';
import { reflectionConfigForChoice, routeIndividualReflectionModel } from '../reflection/model-routing.ts';
import { vocabularyReflectionModelChoice } from '../db/vocabulary-reflection-routing.ts';
import { getDb } from '../db/connection.ts';
import { createOpenAiCompatibleAdapter } from '../llm/openai-compatible.ts';
import { invalidateServiceInvocation } from '../llm/invocation-ledger.ts';
import { validateJsonSchema } from '../llm/json-schema-validator.ts';
import { fetchImplementationForProvider } from '../llm/proxy-fetch.ts';
import { isOutputTruncationFinishReason, type ProviderAdapter } from '../llm/types.ts';
import { eligibleVocabularyReflectionJob } from './reflection-eligibility.ts';
import { prepareVocabularyPureCueImprovement, vocabularyPureCueImprovementSchema } from './pure-cue-improvement.ts';
import { vocabularyPureCueReferralSchema, validateVocabularyPureCueReferral } from './pure-cue-promotion.ts';
import { runVocabularyImprovementAdmission, type VocabularySenseEnsurer } from './improvement-admission.ts';

export const VOCABULARY_REFLECTION_SERVICE_ID='vocabulary-reflection';
export class VocabularyReflectionOutputError extends Error {}
export type VocabularyReflectionProvider={isConfigured():boolean;run(job:VocabularyReflectionJob,context?:{canPublish?:()=>boolean}):Promise<VocabularyReflectionResult>};
const text:JsonSchema={type:'string'};
function object(properties:Record<string,JsonSchema>):JsonSchema{return {type:'object',properties,required:Object.keys(properties),additionalProperties:false};}
const feedbackSchema=object({diagnosis:text,lesson:text,unfairEncounterIds:{type:'array',items:text}});
const improvementSchema=object({diagnosis:text,operations:{type:'array',items:object({sourceContentId:text,
  strategy:{type:'string',enum:['create','update_existing','replace']},rationale:text,prompt:text,acceptedAnswers:{type:'array',items:text}})}});
export const vocabularySingleImprovementSchema=object({...improvementSchema.properties!,pureCueReferral:vocabularyPureCueReferralSchema});
function nonempty(value:string):void{if(!value.trim())throw new VocabularyReflectionOutputError('Reflection output contains empty text');}
function source(job:VocabularyReflectionJob):VocabularyContent|null {
  const encounter=job.evidence.evidence[0];
  if(!encounter)return null;
  const row=getDb().prepare('SELECT snapshot_json FROM content_revision_history WHERE content_id=? AND version=?')
    .get(encounter.snapshot.contentId,encounter.snapshot.contentVersion) as {snapshot_json:string}|undefined;
  if(!row)throw new VocabularyReflectionOutputError('Reflection source version is unavailable');
  const content=JSON.parse(row.snapshot_json) as VocabularyContent;
  if(content.accessScope==='private'&&content.ownerLearnerId!==job.learnerId)throw new VocabularyReflectionOutputError('Reflection source access mismatch');
  return content;
}
/** Excludes unrelated learners, live interpretation, and inferred sense targets. */
export function projectVocabularyReflectionInput(job:VocabularyReflectionJob):unknown {
  job=eligibleVocabularyReflectionJob(job);
  const content=source(job);
  const pureCue=content?.kind==='exercise'&&content.exerciseType==='pure_cue';
  const wordIds=[...new Set(pureCue?content.answers.map(answer=>answer.wordId):job.evidence.evidence.flatMap(item=>item.wordId===null?content?.words.map(word=>word.wordId)??[]:[item.wordId]))];
  const words=wordIds.map(id=>getDb().prepare('SELECT id AS wordId,hanzi,traditional,pinyin,meaning FROM lexical_words WHERE id=?').get(id));
  return {caseId:job.caseId,subject:!pureCue&&job.evidence.wordId!==null?{kind:'word',wordId:job.evidence.wordId}
    :{kind:'pureCue',contentId:job.evidence.contentId},words,
    sourceContent:content,encounters:job.evidence.evidence.map(item=>({encounterId:item.encounterId,wordId:item.wordId,
      purpose:item.snapshot.role,mode:item.mode,served:item.snapshot,responses:item.responses.map(response=>({actionId:response.actionId,
        response:response.payload.response,outcome:response.payload.outcome,effective:item.effectiveResponses.some(effective=>effective.actionId===response.actionId)})),
      reactions:getEffectiveVocabularyEncounterReactions(item).map(({payload})=>({encounterId:payload.encounterId,reaction:payload.feedback,...(payload.comment!==undefined?{comment:payload.comment}:{})})),skipped:item.skipped,presentationUndone:item.presentationUndone}))};
}
export function normalizeVocabularyReflectionOutput(job:VocabularyReflectionJob,value:unknown,invocationId?:string|null,withReferral=false):VocabularyReflectionResult {
  job=eligibleVocabularyReflectionJob(job);
  const schema=job.kind==='learner_feedback'?feedbackSchema:withReferral?vocabularySingleImprovementSchema:improvementSchema;
  if(validateJsonSchema(value,schema).length)throw new VocabularyReflectionOutputError('Reflection output failed its strict schema');
  if(job.evidence.kind==='teaching_review'||job.evidence.evidence.some(item=>item.snapshot.role!=='general'))throw new VocabularyReflectionOutputError('Teaching belongs to the manual inbox');
  if(job.kind==='learner_feedback') {
    const result=value as {diagnosis:string;lesson:string;unfairEncounterIds:string[]};
    nonempty(result.diagnosis);nonempty(result.lesson);
    if(new Set(result.unfairEncounterIds).size!==result.unfairEncounterIds.length||result.unfairEncounterIds.some(id=>
      !job.evidence.evidence.some(item=>item.encounterId===id&&item.responses.some(response=>response.payload.outcome==='rejected')))) {
      throw new VocabularyReflectionOutputError('Unfair judgment must reference a supplied rejected encounter');
    }
    return {kind:'learner_feedback',judgment:{diagnosis:result.diagnosis,message:result.lesson,unfairEncounterIds:result.unfairEncounterIds,
      ...(invocationId?{invocationId}:{})}};
  }
  const result=value as {diagnosis:string;operations:{sourceContentId:string;strategy:VocabularyProposalOperation['strategy'];rationale:string;prompt:string;acceptedAnswers:string[]}[]};
  const referral=withReferral?(value as {pureCueReferral:import('../../src/domain/vocabulary-reflection.ts').VocabularyPureCueReferral|null}).pureCueReferral:undefined;
  if(referral)validateVocabularyPureCueReferral(referral);
  nonempty(result.diagnosis);
  const original=source(job);
  if(!original||original.kind!=='exercise'||original.exerciseRole!=='general')throw new VocabularyReflectionOutputError('Improvement requires a general exercise');
  const accepted=original.answers.flatMap(answer=>answer.acceptedForms);
  if(result.operations.filter(operation=>operation.strategy!=='create').length>1)throw new VocabularyReflectionOutputError('A source can only be updated or replaced once');
  const operations:VocabularyProposalOperation[]=result.operations.map((operation,index)=>{
    nonempty(operation.rationale);nonempty(operation.prompt);
    if(operation.sourceContentId!==original.contentId||!isDeepStrictEqual([...operation.acceptedAnswers].sort(),[...accepted].sort())) {
      throw new VocabularyReflectionOutputError('Repair cannot invent source identities or change answer criteria');
    }
    const privateFragments=job.evidence.evidence.flatMap(encounter=>[
      ...getVocabularyEncounterReactions(encounter).flatMap(reaction=>reaction.payload.comment?.trim().length? [reaction.payload.comment.trim()]:[]),
      ...encounter.responses.flatMap(response=>response.payload.response&&response.payload.response.length>=12?[response.payload.response]:[]),
    ]).filter(fragment=>fragment.length>=4);
    if(original.accessScope==='shared'&&privateFragments.some(fragment=>operation.prompt.includes(fragment))) {
      throw new VocabularyReflectionOutputError('Shared authored content cannot copy private learner evidence');
    }
    if(accepted.some(answer=>answer.trim()&&operation.prompt.includes(answer)))throw new VocabularyReflectionOutputError('Retrieval prompt exposes an accepted answer');
    const previousBody=original.body!==null&&typeof original.body==='object'&&!Array.isArray(original.body)?original.body:{};
    const body:Record<string,VocabularyJson>={...previousBody,prompt:operation.prompt};
    if('stimulus' in body)body.stimulus={kind:'direct_text',text:operation.prompt};
    const {contentId:_id,version:_version,createdAt:_created,updatedAt:_updated,...draft}=original;
    const content={...draft,body:vocabularyAuthoredPromptBody(original.body,body),...(operation.strategy==='update_existing'?{contentId:original.contentId}
      :{contentId:randomUUID(),originKind:'model' as const,authorKind:'service',authorId:VOCABULARY_REFLECTION_SERVICE_ID})};
    const common={operationKey:`repair-${index+1}`,scope:original.accessScope==='shared'?{kind:'shared' as const}
      :{kind:'learner' as const,learnerId:original.ownerLearnerId!},rationale:operation.rationale,content};
    return operation.strategy==='create'?{...common,strategy:'create'}
      :{...common,strategy:operation.strategy,sourceContentId:original.contentId,expectedVersion:original.version};
  });
  return {kind:'exercise_improvement',result:{diagnosis:result.diagnosis,...(withReferral?{pureCueReferral:referral}:{}),proposal:operations.length?{operations,rationale:result.diagnosis,
    bases:[{contentId:original.contentId,expectedVersion:original.version}],...(invocationId?{invocationId}:{})}:null,...(invocationId?{invocationId}:{})}};
}
export function createVocabularyReflectionProvider(options:{environment?:NodeJS.ProcessEnv;adapter?:ProviderAdapter;adapters?:Partial<Record<ReflectionModelChoice,ProviderAdapter>>;random?:()=>number;fetchImplementation?:typeof globalThis.fetch;spendCap?:(learnerId:string)=>ReflectionSpendCap;ensureSenses?:VocabularySenseEnsurer}={}):VocabularyReflectionProvider {
  const environment=options.environment??process.env;
  const spendCap=options.spendCap??((learnerId:string)=>runWithLearnerId(learnerId,()=>getReflectionSpendCap()));
  const adapters=new Map<ReflectionModelChoice,ProviderAdapter>();
  const adapterFor=(choice:ReflectionModelChoice)=>{
    const existing=options.adapters?.[choice]??options.adapter??adapters.get(choice);
    if(existing)return existing;
    const config=reflectionConfigForChoice(choice);
    const adapter=createOpenAiCompatibleAdapter({id:config.provider,defaultBaseUrl:config.defaultBaseUrl,
      apiKeyEnvironmentVariable:config.apiKeyEnvironmentVariable,structuredOutputMode:config.structuredOutputMode,
      maxTokensField:config.maxTokensField,additionalRequestBody:config.additionalRequestBody,
      fetchImplementation:options.fetchImplementation??fetchImplementationForProvider(config.provider,config.timeoutMs)});
    adapters.set(choice,adapter);return adapter;
  };
  return {isConfigured:()=>REFLECTION_MODEL_ARMS.some(arm=>arm.enabledByDefault&&Boolean(environment[reflectionConfigForChoice(arm.choice).apiKeyEnvironmentVariable]?.trim())),async run(job,context){
    if(job.evidence.kind==='teaching_review')throw new VocabularyReflectionOutputError('Teaching belongs to the manual inbox');
    job=eligibleVocabularyReflectionJob(job);
    if(!job.evidence.evidence.length){
      const diagnosis='Provider review is deferred for non-production exercises; original evidence remains in the session log.';
      return job.kind==='learner_feedback'?{kind:'learner_feedback',judgment:{diagnosis,message:null,unfairEncounterIds:[]}}
        :{kind:'exercise_improvement',result:{diagnosis,proposal:null}};
    }
    if(context?.canPublish&&!context.canPublish())throw new Error('Reflection lost publication authority');
    const choice=vocabularyReflectionModelChoice(job.jobId,()=>routeIndividualReflectionModel(spendCap(job.learnerId),options.random));
    if(!isOfferedReflectionModelChoice(choice))throw new Error(`Stored reflection model is no longer offered: ${choice}`);
    const config=reflectionConfigForChoice(choice);
    const adapter=adapterFor(choice);
    const apiKey=environment[config.apiKeyEnvironmentVariable]?.trim();
    const baseUrl=config.baseUrlEnvironmentVariable?environment[config.baseUrlEnvironmentVariable]?.trim()||null:null;
    if(!apiKey)throw new Error(`Vocabulary reflection provider ${config.provider} is not configured`);
    if(job.evidence.kind==='teaching_review'||job.evidence.evidence.some(item=>item.snapshot.role!=='general'))throw new VocabularyReflectionOutputError('Teaching belongs to the manual inbox');
    assertReflectionModelAllowedUnderSpendCap(choice,spendCap(job.learnerId));
    const kind=job.kind==='learner_feedback'?'feedback':'improvement';
    const prompts=new Map<string,string>();
    const promptFor=async(promptFile:string)=>{
      const cached=prompts.get(promptFile);if(cached!==undefined)return cached;
      let task=await readFile(new URL(`./reflection-prompts/${promptFile}.md`,import.meta.url),'utf8');
      const reasoning=promptFile==='improvement'||promptFile==='second-opinion'
        ?await readFile(new URL('./reflection-prompts/reasoning.md',import.meta.url),'utf8'):'';
      const systemPrompt=promptFile==='feedback'?task:`${reasoning}\n\n${task}`;prompts.set(promptFile,systemPrompt);return systemPrompt;
    };
    const stagePrompt=(stage:string)=>stage==='sense_mapping'?'sense-mapping':stage==='repertoire'?'repertoire':stage==='pure_cue_promotion'?'pure-cue-promotion':'single-improvement';
    const admissionPromptVersion=(stage:string)=>stage==='single_improvement'||stage==='pure_cue_promotion'?'3':'2';
    const schemaVersion=(step:string)=>step==='single_improvement'||step==='pure_cue_promotion'?'2':'1';
    const projectionVersion=(step:string)=>step==='second_opinion'?'vocabulary-second-opinion.v1'
      :step==='feedback'||step==='improvement'?'vocabulary-reflection.v2'
      :step==='single_improvement'?'vocabulary-admission.v2':'vocabulary-admission.v1';
    const runCall=async (step:string,input:unknown,schema:JsonSchema,promptFile:string,promptVersion:string)=>{
      if(context?.canPublish&&!context.canPublish())throw new Error('Reflection lost publication authority');
      assertReflectionModelAllowedUnderSpendCap(choice,spendCap(job.learnerId));
      const systemPrompt=await promptFor(promptFile);
      const result=await adapter.run({model:config.providerModel,reasoningEffort:config.reasoningEffort,
        systemPrompt,userPrompt:JSON.stringify(input),
        outputSchemaName:`vocabulary_reflection_${step}_v${schemaVersion(step)}`,outputSchema:schema,
        maxOutputTokens:config.maxOutputTokens,temperature:null,timeoutMs:config.timeoutMs,cachePrompt:true,
        invocationActor:{kind:'service',serviceId:VOCABULARY_REFLECTION_SERVICE_ID,requestingLearnerId:job.learnerId},
        provenance:{workflowId:job.jobId,stepName:step,attemptNumber:job.attemptNumber,promptName:`vocabulary-reflection-${promptFile}`,
          promptVersion,schemaVersion:schemaVersion(step),inputProjectionVersion:projectionVersion(step)}},
        {apiKey,baseUrl});
      try {
        if(isOutputTruncationFinishReason(result.finishReason))throw new VocabularyReflectionOutputError('Reflection output was truncated');
        return {value:JSON.parse(result.rawText) as unknown,invocationId:result.invocationId};
      }catch(error){invalidateServiceInvocation(result.invocationId,VOCABULARY_REFLECTION_SERVICE_ID);throw error;}
    };
    if (job.secondOpinion) {
      if (job.kind !== 'exercise_improvement') throw new VocabularyReflectionOutputError('Second opinion requires an improvement job');
      const schema=object({verdict:{type:'string',enum:['support','revise','reject']},rationale:text});
      const sources=job.secondOpinion.proposal.bases.map(base=>{
        const row=getDb().prepare('SELECT snapshot_json FROM content_revision_history WHERE content_id=? AND version=?')
          .get(base.contentId,base.expectedVersion) as {snapshot_json:string}|undefined;
        if(!row)throw new VocabularyReflectionOutputError('Second opinion source version is unavailable');
        const content=JSON.parse(row.snapshot_json) as VocabularyContent;
        if(content.accessScope==='private'&&content.ownerLearnerId!==job.learnerId)throw new VocabularyReflectionOutputError('Second opinion source access mismatch');
        return content;
      });
      const response=await runCall('second_opinion',{proposal:job.secondOpinion.proposal,operatorNotes:job.secondOpinion.notes,
        sources,evidence:projectVocabularyReflectionInput(job)},schema,'second-opinion','1');
      try {
        if(validateJsonSchema(response.value,schema).length)throw new VocabularyReflectionOutputError('Second opinion failed its strict schema');
        const opinion=response.value as import('../../src/domain/vocabulary-reflection.ts').VocabularySecondOpinionVerdict;
        nonempty(opinion.rationale);
        if(context?.canPublish&&!context.canPublish())throw new VocabularyReflectionOutputError('Second opinion lost publication authority');
        return {kind:'exercise_improvement',result:{diagnosis:opinion.rationale,proposal:null,secondOpinion:opinion,
          ...(response.invocationId?{invocationId:response.invocationId}:{})}};
      } catch(error) {invalidateServiceInvocation(response.invocationId,VOCABULARY_REFLECTION_SERVICE_ID);throw error;}
    }
    const original=job.kind==='exercise_improvement'?source(job):null;
    if(original?.kind==='exercise'&&original.exerciseType==='pure_cue'){
      const review=prepareVocabularyPureCueImprovement(job,original);review.fence();
      const response=await runCall('pure_cue_improvement',{sourceContent:original,evidence:projectVocabularyReflectionInput(job),...review.input},vocabularyPureCueImprovementSchema,'pure-cue-improvement','1');
      if(context?.canPublish&&!context.canPublish())throw new Error('Reflection lost publication authority');
      review.fence();
      try{return review.normalize(response.value,response.invocationId);}
      catch(error){invalidateServiceInvocation(response.invocationId,VOCABULARY_REFLECTION_SERVICE_ID);throw error;}
    }
    if(job.kind==='exercise_improvement'&&job.evidence.wordId!==null&&original?.kind==='exercise'
      &&original.skill==='production'&&original.exerciseType!=='pure_cue'&&original.answers.length===1&&original.answers[0]?.wordId===job.evidence.wordId
      &&job.evidence.evidence.every(encounter=>encounter.snapshot.schedulingScope!=='pure_cue')) {
      return runVocabularyImprovementAdmission({job,original,projectedInput:projectVocabularyReflectionInput(job),
        ensureSenses:options.ensureSenses,canPublish:context?.canPublish,improvementSchema:vocabularySingleImprovementSchema,
        stageIdentity:async(stage,schema)=>({provider:adapter.id,baseUrl:baseUrl??adapter.defaultBaseUrl,
          model:config.providerModel,reasoningEffort:config.reasoningEffort,systemPrompt:await promptFor(stagePrompt(stage)),
          schema,outputSchemaName:`vocabulary_reflection_${stage}_v${schemaVersion(stage)}`,promptVersion:admissionPromptVersion(stage),schemaVersion:schemaVersion(stage),inputProjectionVersion:projectionVersion(stage),
          maxOutputTokens:config.maxOutputTokens,temperature:null,timeoutMs:config.timeoutMs,cachePrompt:true}),
        call:(stage,input,schema)=>runCall(stage,input,schema,stagePrompt(stage),admissionPromptVersion(stage)),
        normalize:(value,invocationId)=>normalizeVocabularyReflectionOutput(job,value,invocationId,!!value&&typeof value==='object'&&'pureCueReferral' in value)});
    }
    if(job.kind==='exercise_improvement')throw new VocabularyReflectionOutputError('Exercise has no supported improvement contract');
    const result=await runCall(kind,projectVocabularyReflectionInput(job),feedbackSchema,kind,'4');
    try{return normalizeVocabularyReflectionOutput(job,result.value,result.invocationId);}
    catch(error){invalidateServiceInvocation(result.invocationId,VOCABULARY_REFLECTION_SERVICE_ID);throw error;}
  }};
}
