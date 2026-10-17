import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { VocabularyContent, VocabularyJson } from '../../src/domain/vocabulary-content.ts';
import type { VocabularyReflectionJob, VocabularyReflectionResult, VocabularyProposalOperation } from '../../src/domain/vocabulary-reflection.ts';
import type { JsonSchema } from '../../src/domain/reflection-result-schema.ts';
import { effectiveVocabularyFeedback } from '../../src/domain/vocabulary-session.ts';
import { runWithLearnerId } from '../db/learner-context.ts';
import { getReflectionSpendCap } from '../db/reflections.ts';
import { assertReflectionModelAllowedUnderSpendCap, type ReflectionSpendCap } from '../reflection/spend-cap.ts';
import { LUNA_REFLECTION_MODEL_CHOICE } from '../reflection/model-arms.ts';
import { getDb } from '../db/connection.ts';
import { createOpenAiCompatibleAdapter } from '../llm/openai-compatible.ts';
import { invalidateServiceInvocation } from '../llm/invocation-ledger.ts';
import { validateJsonSchema } from '../llm/json-schema-validator.ts';
import { fetchImplementationForProvider } from '../llm/proxy-fetch.ts';
import { isOutputTruncationFinishReason, type ProviderAdapter } from '../llm/types.ts';
import { LUNA_REFLECTION_MODEL_CONFIG } from '../reflection/luna-provider.ts';

export const VOCABULARY_REFLECTION_SERVICE_ID='vocabulary-reflection';
// The existing spend guard narrows legacy reflection to this Luna arm at its
// daily threshold; using that same permitted fallback needs no new budget policy.
export const VOCABULARY_REFLECTION_MODEL=LUNA_REFLECTION_MODEL_CONFIG.providerModel;
export class VocabularyReflectionOutputError extends Error {}
export type VocabularyReflectionProvider={isConfigured():boolean;run(job:VocabularyReflectionJob):Promise<VocabularyReflectionResult>};
const text:JsonSchema={type:'string'};
function object(properties:Record<string,JsonSchema>):JsonSchema{return {type:'object',properties,required:Object.keys(properties),additionalProperties:false};}
const feedbackSchema=object({diagnosis:text,lesson:text,unfairEncounterIds:{type:'array',items:text}});
const improvementSchema=object({diagnosis:text,operations:{type:'array',items:object({sourceContentId:text,
  strategy:{type:'string',enum:['create','update_existing','replace']},rationale:text,prompt:text,acceptedAnswers:{type:'array',items:text}})}});
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
  const content=source(job);
  const wordIds=[...new Set(job.evidence.evidence.flatMap(item=>item.wordId===null?content?.words.map(word=>word.wordId)??[]:[item.wordId]))];
  const words=wordIds.map(id=>getDb().prepare('SELECT id AS wordId,hanzi,traditional,pinyin,meaning FROM lexical_words WHERE id=?').get(id));
  return {caseId:job.caseId,subject:job.evidence.wordId!==null?{kind:'word',wordId:job.evidence.wordId}
    :{kind:'pureCue',contentId:job.evidence.contentId},words,
    sourceContent:content,encounters:job.evidence.evidence.map(item=>({encounterId:item.encounterId,wordId:item.wordId,
      purpose:item.snapshot.role,mode:item.mode,served:item.snapshot,responses:item.responses.map(response=>({actionId:response.actionId,
        response:response.payload.response,outcome:response.payload.outcome,effective:item.effectiveResponses.some(effective=>effective.actionId===response.actionId)})),
      feedback:(item.effectiveFeedback??effectiveVocabularyFeedback(item.feedback)).map(feedback=>feedback.payload),skipped:item.skipped,presentationUndone:item.presentationUndone}))};
}
export function normalizeVocabularyReflectionOutput(job:VocabularyReflectionJob,value:unknown,invocationId?:string|null):VocabularyReflectionResult {
  const schema=job.kind==='learner_feedback'?feedbackSchema:improvementSchema;
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
      ...encounter.feedback.flatMap(feedback=>feedback.payload.comment?.trim().length? [feedback.payload.comment.trim()]:[]),
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
    const content={...draft,body,...(operation.strategy==='update_existing'?{contentId:original.contentId}
      :{contentId:randomUUID(),originKind:'model' as const,authorKind:'service',authorId:VOCABULARY_REFLECTION_SERVICE_ID})};
    const common={operationKey:`repair-${index+1}`,scope:original.accessScope==='shared'?{kind:'shared' as const}
      :{kind:'learner' as const,learnerId:original.ownerLearnerId!},rationale:operation.rationale,content};
    return operation.strategy==='create'?{...common,strategy:'create'}
      :{...common,strategy:operation.strategy,sourceContentId:original.contentId,expectedVersion:original.version};
  });
  return {kind:'exercise_improvement',result:{diagnosis:result.diagnosis,proposal:operations.length?{operations,rationale:result.diagnosis,
    bases:[{contentId:original.contentId,expectedVersion:original.version}],...(invocationId?{invocationId}:{})}:null,...(invocationId?{invocationId}:{})}};
}
export function createVocabularyReflectionProvider(options:{environment?:NodeJS.ProcessEnv;adapter?:ProviderAdapter;spendCap?:(learnerId:string)=>ReflectionSpendCap}={}):VocabularyReflectionProvider {
  const environment=options.environment??process.env;
  const spendCap=options.spendCap??((learnerId:string)=>runWithLearnerId(learnerId,()=>getReflectionSpendCap()));
  const adapter=options.adapter??createOpenAiCompatibleAdapter({id:'openai',defaultBaseUrl:LUNA_REFLECTION_MODEL_CONFIG.defaultBaseUrl,
    apiKeyEnvironmentVariable:'OPENAI_API_KEY',structuredOutputMode:'json_schema',maxTokensField:'max_completion_tokens',
    fetchImplementation:fetchImplementationForProvider('openai',LUNA_REFLECTION_MODEL_CONFIG.timeoutMs)});
  return {isConfigured:()=>Boolean(environment.OPENAI_API_KEY?.trim()),async run(job){
    if(!environment.OPENAI_API_KEY?.trim())throw new Error('Vocabulary reflection provider is not configured');
    if(job.evidence.kind==='teaching_review'||job.evidence.evidence.some(item=>item.snapshot.role!=='general'))throw new VocabularyReflectionOutputError('Teaching belongs to the manual inbox');
    assertReflectionModelAllowedUnderSpendCap(LUNA_REFLECTION_MODEL_CHOICE,spendCap(job.learnerId));
    const kind=job.kind==='learner_feedback'?'feedback':'improvement';
    const [reasoning,task]=await Promise.all(['reasoning',kind].map(name=>readFile(new URL(`./reflection-prompts/${name}.md`,import.meta.url),'utf8')));
    const result=await adapter.run({model:VOCABULARY_REFLECTION_MODEL,reasoningEffort:LUNA_REFLECTION_MODEL_CONFIG.reasoningEffort,
      systemPrompt:`${reasoning}\n\n${task}`,userPrompt:JSON.stringify(projectVocabularyReflectionInput(job)),
      outputSchemaName:`vocabulary_reflection_${kind}_v1`,outputSchema:kind==='feedback'?feedbackSchema:improvementSchema,
      maxOutputTokens:LUNA_REFLECTION_MODEL_CONFIG.maxOutputTokens,temperature:null,timeoutMs:LUNA_REFLECTION_MODEL_CONFIG.timeoutMs,cachePrompt:true,
      invocationActor:{kind:'service',serviceId:VOCABULARY_REFLECTION_SERVICE_ID,requestingLearnerId:job.learnerId},
      provenance:{workflowId:job.jobId,stepName:kind,attemptNumber:job.attemptNumber,promptName:`vocabulary-reflection-${kind}`,
        promptVersion:'1',schemaVersion:'1',inputProjectionVersion:'vocabulary-reflection.v1'}},
      {apiKey:environment.OPENAI_API_KEY?.trim()??'',baseUrl:environment.OPENAI_BASE_URL?.trim()||null});
    try {
      if(isOutputTruncationFinishReason(result.finishReason))throw new VocabularyReflectionOutputError('Reflection output was truncated');
      return normalizeVocabularyReflectionOutput(job,JSON.parse(result.rawText),result.invocationId);
    }catch(error){invalidateServiceInvocation(result.invocationId,VOCABULARY_REFLECTION_SERVICE_ID);throw error;}
  }};
}
