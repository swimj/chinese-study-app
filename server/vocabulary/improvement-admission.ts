import { createHash } from 'node:crypto';
import type { JsonSchema } from '../../src/domain/reflection-result-schema.ts';
import type { VocabularyContent } from '../../src/domain/vocabulary-content.ts';
import type { VocabularyReflectionJob, VocabularyReflectionResult } from '../../src/domain/vocabulary-reflection.ts';
import { getDb } from '../db/connection.ts';
import { getVocabularyContentForMaintenance, getVocabularySenseCatalog, mapVocabularyContentSense } from '../db/vocabulary-content.ts';
import { linkVocabularyInvocationContent, linkVocabularyInvocationSense } from '../db/vocabulary-provenance.ts';
import { invalidateServiceInvocation } from '../llm/invocation-ledger.ts';
import { validateJsonSchema } from '../llm/json-schema-validator.ts';
import { prepareVocabularyPureCuePromotion, vocabularyPureCuePromotionSchema, type PromotionResult } from './pure-cue-promotion.ts';
import { ensureVocabularySenses } from './sense-readiness.ts';

const serviceId = 'vocabulary-reflection';
const text: JsonSchema = { type: 'string' };
const object = (properties: Record<string,JsonSchema>): JsonSchema => ({ type: 'object',properties,required: Object.keys(properties),additionalProperties: false });
export const vocabularySenseMappingSchema = object({ outcome: { type: 'string',enum: ['single_sense','laundry_list','unmappable','inventory_gap'] },rationale: text,senseIds: { type: 'array',items: text } });
export const vocabularyRepertoireSchema = object({ diagnosis: text,exercises: { type: 'array',items: object({ senseId: text,prompt: text,rationale: text }) } });
type Mapping = { outcome: 'single_sense'|'laundry_list'|'unmappable'|'inventory_gap'; rationale: string; senseIds: string[] };
type MappingEvidence = Mapping & { observedMapping: {senseId:string|null; establishedAt:string|null}; mappingTimestamp:string };
type Repertoire = { diagnosis: string; exercises: { senseId: string; prompt: string; rationale: string }[] };
type ImprovementResult = Extract<VocabularyReflectionResult,{kind:'exercise_improvement'}>;
export type VocabularyAdmissionStage = 'sense_mapping'|'single_improvement'|'repertoire'|'pure_cue_promotion';
export type VocabularyAdmissionModelCall = (stage: VocabularyAdmissionStage,input: unknown,schema: JsonSchema) => Promise<{value: unknown; invocationId?: string|null}>;
export type VocabularySenseEnsurer = typeof ensureVocabularySenses;

/** Intermediate evidence is durable; source identity is not a substitute for the exact version examined. */
export async function runVocabularyImprovementAdmission(options: {
  job: VocabularyReflectionJob; original: VocabularyContent; projectedInput: unknown;
  ensureSenses?: VocabularySenseEnsurer; canPublish?: ()=>boolean;
  call: VocabularyAdmissionModelCall; improvementSchema: JsonSchema;
  stageIdentity: (stage:VocabularyAdmissionStage,schema:JsonSchema)=>Promise<unknown>;
  normalize: (value: unknown,invocationId?: string|null)=>VocabularyReflectionResult;
}): Promise<ImprovementResult> {
  const {job,original} = options;
  const wordId = job.evidence.wordId;
  if (!wordId || original.kind !== 'exercise' || original.exerciseRole !== 'general'
    || original.answers.length !== 1 || original.answers[0]!.wordId !== wordId) throw new Error('Sense admission requires a single-word general exercise');
  const assertPublish = () => { if (options.canPublish && !options.canPublish()) throw new Error('Improvement admission lost publication authority'); };
  assertPublish();
  const readiness = await (options.ensureSenses ?? ensureVocabularySenses)(wordId,{ workflowId: job.jobId,attemptNumber: job.attemptNumber,canPublish: options.canPublish });
  let current = getVocabularyContentForMaintenance(original.contentId);
  if (!current || current.version !== original.version || current.availability !== 'active') throw new Error('Improvement source changed before admission');
  const originalMapping = current.words.find(word=>word.wordId===wordId);
  if (!originalMapping) throw new Error('Improvement source has no target relationship');
  let expectedMapping = {senseId: originalMapping.senseId??null,establishedAt: originalMapping.senseMappingEstablishedAt??null};
  const fence = () => {
    assertPublish();
    current = getVocabularyContentForMaintenance(original.contentId);
    const mapping = current?.words.find(word=>word.wordId===wordId);
    if (!current || current.version !== original.version || current.availability !== 'active'
      || !mapping || mapping.senseId != expectedMapping.senseId || mapping.senseMappingEstablishedAt != expectedMapping.establishedAt
      || getVocabularySenseCatalog(wordId).version !== readiness.catalog.version) throw new Error('Improvement source, mapping, or sense catalog changed');
  };
  fence();
  const inventory = readiness.senses.filter(sense=>sense.status==='active');
  const ids = new Set(inventory.map(sense=>sense.senseId));
  const word = getDb().prepare('SELECT id AS wordId,hanzi,traditional,pinyin,meaning FROM lexical_words WHERE id=?')
    .get(wordId) as {wordId:string;hanzi:string;traditional:string|null;pinyin:string;meaning:string}|undefined;
  if (!word) throw new Error('Improvement target lexical word is unavailable');
  const base = {sourceContent: original,wordId,word,catalog: readiness.catalog,senses: inventory};
  async function stage<T>(name: VocabularyAdmissionStage,input: unknown,schema: JsonSchema,normalize: (value: unknown,invocationId?: string|null)=>T,extra?:{fence:()=>void;contents:VocabularyContent[]}): Promise<{value:T; invocationId?:string}> {
    fence();extra?.fence();
    const identity=await options.stageIdentity(name,schema);
    fence();extra?.fence();
    const inputJson = JSON.stringify({contract:identity,input});
    const hash = createHash('sha256').update(inputJson).digest('hex');
    const cached = getDb().prepare('SELECT result_json,invocation_id FROM vocabulary_improvement_stages WHERE job_id=? AND stage=? AND input_hash=?')
      .get(job.jobId,name,hash) as {result_json:string;invocation_id:string|null}|undefined;
    if (cached) return {value: JSON.parse(cached.result_json) as T,...(cached.invocation_id?{invocationId:cached.invocation_id}:{})};
    const response = await options.call(name,input,schema);
    let value:T;
    try {
      if (validateJsonSchema(response.value,schema).length) throw new Error('Improvement stage failed strict output schema');
      value = normalize(response.value,response.invocationId);
    } catch (error) { invalidateServiceInvocation(response.invocationId,serviceId); throw error; }
    fence();extra?.fence();
    const db = getDb();
    db.exec('SAVEPOINT vocabulary_improvement_stage');
    try {
      if(response.invocationId) {
        // Shared content and sense versions receive normal ledger edges. Private authored
        // sources retain their exact snapshot in this private job evidence instead.
        if(original.accessScope==='shared') linkVocabularyInvocationContent({invocationId:response.invocationId,contentId:original.contentId,contentVersion:original.version,role:'input'},{kind:'service',id:serviceId});
        for(const content of extra?.contents??[])if(content.accessScope==='shared')linkVocabularyInvocationContent({invocationId:response.invocationId,contentId:content.contentId,contentVersion:content.version,role:'input'},{kind:'service',id:serviceId});
        for(const sense of inventory) linkVocabularyInvocationSense({invocationId:response.invocationId,senseId:sense.senseId,senseVersion:sense.version,role:'input'},{kind:'service',id:serviceId});
      }
      db.prepare('INSERT INTO vocabulary_improvement_stages(job_id,stage,input_hash,input_json,result_json,invocation_id,recorded_at) VALUES (?,?,?,?,?,?,?)')
        .run(job.jobId,name,hash,inputJson,JSON.stringify(value),response.invocationId??null,new Date().toISOString());
      db.exec('RELEASE vocabulary_improvement_stage');
    } catch(error) { db.exec('ROLLBACK TO vocabulary_improvement_stage; RELEASE vocabulary_improvement_stage'); throw error; }
    return {value,...(response.invocationId?{invocationId:response.invocationId}:{})};
  }
  const mapped = await stage<MappingEvidence>('sense_mapping',base,vocabularySenseMappingSchema,value=>{
    const result = value as Mapping;
    if(!result.rationale.trim() || new Set(result.senseIds).size!==result.senseIds.length || result.senseIds.some(id=>!ids.has(id))
      || (result.outcome==='single_sense'&&result.senseIds.length!==1)
      || (result.outcome!=='single_sense'&&result.senseIds.length!==0)) throw new Error('Invalid mapping outcome or supplied sense references');
    return {...result,observedMapping:{...expectedMapping},mappingTimestamp:new Date().toISOString()};
  });
  const before = mapped.value.observedMapping;
  const sameBefore = expectedMapping.senseId===before.senseId && expectedMapping.establishedAt===before.establishedAt;
  const samePublished = mapped.value.outcome==='single_sense' && expectedMapping.senseId===mapped.value.senseIds[0]
    && expectedMapping.establishedAt===mapped.value.mappingTimestamp;
  if(!sameBefore&&!samePublished) throw new Error('Sense mapping changed since the retained admission decision');
  const {observedMapping:_observed,mappingTimestamp:_timestamp,...mappingDecision}=mapped.value;
  const admission = {...mappingDecision,wordId,sourceContentId:original.contentId,sourceContentVersion:original.version,catalogVersion:readiness.catalog.version,sourceMapping:{...expectedMapping},
    ...(mapped.invocationId?{invocationId:mapped.invocationId}:{})};
  if (mapped.value.outcome==='unmappable'||mapped.value.outcome==='inventory_gap') {
    fence();
    return {kind:'exercise_improvement',result:{diagnosis:mapped.value.rationale,proposal:null,admission,...(mapped.invocationId?{invocationId:mapped.invocationId}:{})}};
  }
  if (mapped.value.outcome==='single_sense') {
    fence();
    if(expectedMapping.senseId!==mapped.value.senseIds[0] || !expectedMapping.establishedAt) {
      const establishedAt = mapped.value.mappingTimestamp;
      mapVocabularyContentSense({contentId:original.contentId,wordId,expectedContentVersion:original.version,expectedCatalogVersion:readiness.catalog.version,
        expectedMapping,senseId:mapped.value.senseIds[0]!,establishedAt},{kind:'service',id:serviceId,reason:{jobId:job.jobId,mappingInvocationId:mapped.invocationId??null}});
      expectedMapping={senseId:mapped.value.senseIds[0]!,establishedAt};
    }
    admission.sourceMapping={...expectedMapping};
    const result = await stage<ImprovementResult>('single_improvement',{evidence:options.projectedInput,...base,admission,intendedSense:inventory.find(sense=>sense.senseId===mapped.value.senseIds[0])},options.improvementSchema,(value,invocationId)=>{
      const normalized = options.normalize(value,invocationId);
      if(normalized.kind!=='exercise_improvement')throw new Error('Unexpected improvement result');
      for(const op of normalized.result.proposal?.operations??[])op.content.words=op.content.words.map(word=>word.wordId===wordId?{...word,senseId:mapped.value.senseIds[0],senseMappingEstablishedAt:expectedMapping.establishedAt}:word);
      return normalized;
    });
    fence();
    const local=result.value.result;
    if(!local.pureCueReferral)return {kind:'exercise_improvement',result:{...local,admission}};
    const promotion=prepareVocabularyPureCuePromotion(job,original,local.pureCueReferral);
    const promoted=promotion.attention??(await stage<PromotionResult>('pure_cue_promotion',{
      ...base,evidence:options.projectedInput,intendedSense:inventory.find(sense=>sense.senseId===mapped.value.senseIds[0]),
      localAssessment:local.diagnosis,...promotion.input,
    },vocabularyPureCuePromotionSchema,promotion.normalize,promotion)).value;
    fence();promotion.fence();
    const operations=[...(local.proposal?.operations??[]),...promoted.operations];
    return {kind:'exercise_improvement',result:{...local,admission,pureCuePromotion:promoted.assessment,
      proposal:operations.length?{operations,rationale:local.proposal?.rationale??promoted.assessment.rationale,
        bases:[{contentId:original.contentId,expectedVersion:original.version},...promoted.bases],
        ...(local.invocationId?{invocationId:local.invocationId}:{})}:null}};
  }
  const result = await stage<ImprovementResult>('repertoire',{...base,admission,acceptedAnswers:original.answers.flatMap(answer=>answer.acceptedForms)},vocabularyRepertoireSchema,(value,invocationId)=>{
    const repertoire = value as Repertoire;
    if(!repertoire.diagnosis.trim()||repertoire.exercises.length<2||repertoire.exercises.length>18
      || repertoire.exercises.some(exercise=>!ids.has(exercise.senseId)||!exercise.prompt.trim()||!exercise.rationale.trim()))throw new Error('Repertoire requires two to eighteen valid exercises with supplied sense references');
    const normalized=options.normalize({diagnosis:repertoire.diagnosis,operations:repertoire.exercises.map((exercise,index)=>({sourceContentId:original.contentId,
      strategy:index===0?'replace':'create',rationale:exercise.rationale,prompt:exercise.prompt,acceptedAnswers:original.answers.flatMap(answer=>answer.acceptedForms)}))},invocationId);
    if(normalized.kind!=='exercise_improvement'||!normalized.result.proposal)throw new Error('Repertoire did not produce a proposal');
    const timestamp=new Date().toISOString();
    normalized.result.proposal.operations.forEach((op,index)=>{
      const exercise=repertoire.exercises[index]!;
      // These are newly authored standalone exercises, not new text pasted into old
      // teaching/reveal material. Preserve answer assessment and publication scope only.
      op.content.body={prompt:exercise.prompt,instruction:'',stimulus:{kind:'direct_text',text:exercise.prompt},
        source:{kind:'vocabulary_repertoire',assessedContentId:original.contentId,assessedContentVersion:original.version,invocationId:invocationId??null}};
      if(op.content.kind==='exercise')op.content.exerciseType='word';
      op.content.words=[{wordId,relation:'target',senseId:exercise.senseId,senseMappingEstablishedAt:timestamp}];
    });
    return normalized;
  });
  fence();
  return {kind:'exercise_improvement',result:{...result.value.result,admission}};
}
