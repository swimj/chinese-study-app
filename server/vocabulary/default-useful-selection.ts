import { vocabularySenseReferences } from './model-sense-references.ts';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { linkVocabularyInvocationSense } from '../db/vocabulary-provenance.ts';
import { getDb } from '../db/connection.ts';
import { getVocabularySenses,getVocabularySenseCatalog,emitBackendEvent } from '../db/vocabulary-content.ts';
import { getVocabularyWordSenseCoverage,writeVocabularyDefaultUsefulSenses } from '../db/vocabulary-sense-coverage.ts';
import { getSharedIntroductionLexicalWord } from '../db/word-introductions.ts';
import type { VocabularySense } from '../../src/domain/vocabulary-content.ts';
import type { VocabularyWordSenseCoverage } from '../../src/domain/vocabulary-sense-coverage.ts';
import { createOpenAiCompatibleAdapter } from '../llm/openai-compatible.ts';
import { fetchImplementationForProvider } from '../llm/proxy-fetch.ts';
import { validateJsonSchema } from '../llm/json-schema-validator.ts';
import { invalidateServiceInvocation } from '../llm/invocation-ledger.ts';
import { isOutputTruncationFinishReason,type ProviderAdapter } from '../llm/types.ts';
import type { JsonSchema } from '../../src/domain/reflection-result-schema.ts';
import { VocabularySenseReadinessPending,VocabularySenseSelectionRequired,VOCABULARY_SENSE_SERVICE,VOCABULARY_SENSE_MODEL } from './sense-readiness.ts';
import { recordPreparationAttempt,linkPreparationInvocation,completePreparationAttempt,failPreparationAttempt } from './preparation-retry.ts';
const actor={kind:'service' as const,id:VOCABULARY_SENSE_SERVICE};
const prompt=readFileSync(new URL('./reflection-prompts/default-useful-selection.md',import.meta.url),'utf8');
const timeoutMs=180_000;
export type UsefulSelectionProvider={isConfigured():boolean;select(input:{word:NonNullable<ReturnType<typeof getSharedIntroductionLexicalWord>>;senses:VocabularySense[]},context:{workflowId:string;attemptNumber:number;onInvocation:(id:string|null|undefined)=>void}):Promise<unknown>};
export function createUsefulSelectionProvider(options:{environment?:NodeJS.ProcessEnv;adapter?:ProviderAdapter}={}):UsefulSelectionProvider {
  const environment=options.environment??process.env;
  const adapter=options.adapter??createOpenAiCompatibleAdapter({id:'openai',defaultBaseUrl:'https://api.openai.com/v1',apiKeyEnvironmentVariable:'OPENAI_API_KEY',structuredOutputMode:'json_schema',maxTokensField:'max_completion_tokens',fetchImplementation:fetchImplementationForProvider('openai',timeoutMs)});
  return {isConfigured:()=>Boolean(environment.OPENAI_API_KEY?.trim()),async select(input,context){
    const references=vocabularySenseReferences(input.senses.map(sense=>sense.senseId));
    const wire={...input,senses:input.senses.map(sense=>({...sense,senseId:references.alias(sense.senseId)}))};
    const schema:JsonSchema={type:'object',additionalProperties:false,required:['senseIds'],properties:{senseIds:{type:'array',items:{type:'string',enum:input.senses.map(sense=>references.alias(sense.senseId))}}}};
    const result=await adapter.run({model:VOCABULARY_SENSE_MODEL,reasoningEffort:'high',systemPrompt:prompt,userPrompt:JSON.stringify(wire),outputSchemaName:'vocabulary_default_useful_selection_v1',outputSchema:schema,maxOutputTokens:4000,temperature:null,timeoutMs,cachePrompt:true,invocationActor:{kind:'service',serviceId:VOCABULARY_SENSE_SERVICE},provenance:{workflowId:context.workflowId,attemptNumber:context.attemptNumber,stepName:'default_useful_selection',promptName:'vocabulary-default-useful-selection',promptVersion:'1',schemaVersion:'1',inputProjectionVersion:'canonical-inventory-local-senses-v1'}},{apiKey:environment.OPENAI_API_KEY?.trim()??'',baseUrl:environment.OPENAI_BASE_URL?.trim()||null});
    context.onInvocation(result.invocationId);
    try{if(isOutputTruncationFinishReason(result.finishReason))throw new Error('truncated');const value:unknown=JSON.parse(result.rawText);if(validateJsonSchema(value,schema).length)throw new Error('schema');const selected=(value as {senseIds:string[]}).senseIds;if(new Set(selected).size!==selected.length)throw new Error('duplicate');return {senseIds:selected.map(id=>references.canonical(id))};}
    catch{invalidateServiceInvocation(result.invocationId,VOCABULARY_SENSE_SERVICE);throw new Error('Default useful selection output is invalid');}
  }};
}
function atomic<T>(work:()=>T):T {const db=getDb(),point=`selection_${randomUUID().replaceAll('-','')}`;db.exec(`SAVEPOINT ${point}`);try{const result=work();db.exec(`RELEASE ${point}`);return result;}catch(error){db.exec(`ROLLBACK TO ${point}; RELEASE ${point}`);throw error;}}
/** Pure census: imported teaching senses already embody an editorial decision. */
export function defaultUsefulInitializationPlan(wordId:string):{kind:'known'|'imported'|'selector'|'attention';senseIds:string[];reason?:string} {
  const coverage=getVocabularyWordSenseCoverage(wordId);if(coverage.defaultUsefulSenseIds!==null)return {kind:'known',senseIds:coverage.defaultUsefulSenseIds};
  if(getVocabularySenseCatalog(wordId).establishedAt===null)return {kind:'attention',senseIds:[],reason:'Canonical inventory is not established; operator inventory review is required.'};
  const senses=getVocabularySenses(wordId).filter(sense=>sense.status==='active');
  if(!senses.length)return {kind:'attention',senseIds:[],reason:'No active canonical senses are available.'};
  let brokenImport=false;
  const importFlags=senses.map(sense=>{const description=sense.description;if(!description||typeof description!=='object'||Array.isArray(description))return false;const source=description.source;if(!source||typeof source!=='object'||Array.isArray(source)||typeof source.contentId!=='string'||typeof source.useId!=='string')return false;
    const valid=Boolean(getDb().prepare('SELECT 1 FROM legacy_sense_imports WHERE source_content_id=? AND source_use_id=? AND sense_id=? AND imported_sense_version=?').get(source.contentId,source.useId,sense.senseId,sense.version));if(!valid)brokenImport=true;return valid;});
  if(brokenImport)return {kind:'attention',senseIds:[],reason:'Imported teaching sense mappings are missing or stale; operator source review is required.'};
  return {kind:importFlags.every(Boolean)?'imported':'selector',senseIds:senses.map(sense=>sense.senseId).sort()};
}
export function recordEmptyUsefulRecommendation(wordId:string,workflowId:string,invocationId:string|null|undefined,source:'inventory'|'selector'):void {
  const at=new Date().toISOString();
  getDb().prepare(`INSERT INTO vocabulary_default_selection_readiness(word_id,status,expected_catalog_version,workflow_id,invocation_id,recommendation_json,last_error,created_at,updated_at) VALUES (?,'failed',?,?,?,?,?,?,?)
    ON CONFLICT(word_id) DO UPDATE SET status='failed',active_token=NULL,expires_at=NULL,invocation_id=excluded.invocation_id,recommendation_json=excluded.recommendation_json,last_error=excluded.last_error,updated_at=excluded.updated_at`).run(wordId,getVocabularySenseCatalog(wordId).version,workflowId,invocationId??null,JSON.stringify({senseIds:[],source}),'The model selected no useful senses; operator selection is required.',at,at);
  emitBackendEvent({name:'vocabulary.default_selection.needs_operator',entityKind:'word',entityId:wordId,actorKind:'service',actorId:VOCABULARY_SENSE_SERVICE,data:{workflowId,invocationId:invocationId??null,senseIds:[],source}});
}
export async function ensureVocabularyDefaultUsefulSelection(wordId:string,options:{workflowId:string;provider?:UsefulSelectionProvider;now?:()=>string;canPublish?:()=>boolean}):Promise<VocabularyWordSenseCoverage> {
  const now=options.now??(()=>new Date().toISOString());const before=getVocabularyWordSenseCoverage(wordId);if(before.defaultUsefulSenseIds!==null){resolveDefaultUsefulSelectionAttention(wordId);return before;}
  const plan=defaultUsefulInitializationPlan(wordId);if(plan.kind==='attention')throw new VocabularySenseSelectionRequired(plan.reason);
  if(options.canPublish&&!options.canPublish())throw new VocabularySenseReadinessPending(new Date(Date.parse(now())+30_000).toISOString());
  if(plan.kind==='imported')return atomic(()=>{const current=getVocabularyWordSenseCoverage(wordId);if(current.defaultUsefulSenseIds!==null)return current;const fresh=defaultUsefulInitializationPlan(wordId);if(fresh.kind!=='imported')throw new VocabularySenseReadinessPending(new Date(Date.parse(now())+30_000).toISOString());writeVocabularyDefaultUsefulSenses(wordId,current.version,fresh.senseIds,{...actor,reason:{workflowId:options.workflowId,source:'imported_teaching'}});return getVocabularyWordSenseCoverage(wordId);});
  const db=getDb(),catalog=getVocabularySenseCatalog(wordId),senses=getVocabularySenses(wordId).filter(sense=>sense.status==='active'),word=getSharedIntroductionLexicalWord(wordId);
  if(!word||catalog.establishedAt===null)throw new VocabularySenseSelectionRequired('Canonical inventory must be established before useful selection.');
  const failed=db.prepare("SELECT last_error FROM vocabulary_default_selection_readiness WHERE word_id=? AND status='failed'").get(wordId) as {last_error:string|null}|undefined;
  if(failed)throw new VocabularySenseSelectionRequired(failed.last_error??'Useful selection requires operator retry.');
  const provider=options.provider??createUsefulSelectionProvider();if(!provider.isConfigured())throw new VocabularySenseSelectionRequired('Useful selection provider is not configured.');
  const token=randomUUID(),at=now();
  const attempt=atomic(()=>{
    db.prepare("INSERT OR IGNORE INTO vocabulary_default_selection_readiness(word_id,status,expected_catalog_version,workflow_id,created_at,updated_at) VALUES (?,'queued',?,?,?,?)").run(wordId,catalog.version,options.workflowId,at,at);
    const old=db.prepare("SELECT active_token FROM vocabulary_default_selection_readiness WHERE word_id=? AND status='running' AND expires_at<=?").get(wordId,at) as {active_token:string}|undefined;
    if(old)failPreparationAttempt('selection',wordId,old.active_token,at,'interrupted_unknown_outcome',{interrupted:true});
    const changed=db.prepare("UPDATE vocabulary_default_selection_readiness SET status='running',active_token=?,expires_at=?,attempt_count=attempt_count+1,total_attempt_count=total_attempt_count+1,workflow_id=?,expected_catalog_version=?,updated_at=? WHERE word_id=? AND status='queued' AND attempt_count<3 AND next_attempt_at<=?").run(token,new Date(Date.parse(at)+300_000).toISOString(),options.workflowId,catalog.version,at,wordId,at);
    if(Number(changed.changes)!==1)return null;recordPreparationAttempt('selection',wordId,token,at);return Number(db.prepare('SELECT total_attempt_count FROM vocabulary_default_selection_readiness WHERE word_id=?').get(wordId)!.total_attempt_count);
  });
  if(attempt===null){const row=db.prepare('SELECT status,expires_at,next_attempt_at,last_error FROM vocabulary_default_selection_readiness WHERE word_id=?').get(wordId) as {status:string;expires_at:string|null;next_attempt_at:string;last_error:string|null};if(row.status==='running'||row.status==='queued')throw new VocabularySenseReadinessPending(row.expires_at??row.next_attempt_at);throw new VocabularySenseSelectionRequired(row.last_error??'Useful selection requires operator retry.');}
  let invocationId:string|null|undefined;
  try{
    const output=await provider.select({word,senses},{workflowId:options.workflowId,attemptNumber:attempt,onInvocation:id=>{invocationId=id;if(id!=null){linkPreparationInvocation(token,id);for(const sense of senses)linkVocabularyInvocationSense({invocationId:id,senseId:sense.senseId,senseVersion:sense.version,role:'input'},actor);db.prepare("UPDATE vocabulary_default_selection_readiness SET invocation_id=? WHERE word_id=? AND active_token=?").run(id,wordId,token);}}});
    const ids=output&&typeof output==='object'&&!Array.isArray(output)&&'senseIds' in output?output.senseIds:undefined;
    if(!output||typeof output!=='object'||Array.isArray(output)||Object.keys(output).length!==1||!Array.isArray(ids)||ids.some(id=>typeof id!=='string'||!senses.some(sense=>sense.senseId===id))||new Set(ids).size!==ids.length){invalidateServiceInvocation(invocationId,VOCABULARY_SENSE_SERVICE);throw new Error('Useful selection contains invalid canonical references');}
    let needsOperator=false;
    const result=atomic(()=>{
      if(options.canPublish&&!options.canPublish())throw new Error('Default selection publication is blocked');
      if(!db.prepare("SELECT 1 FROM vocabulary_default_selection_readiness WHERE word_id=? AND status='running' AND active_token=? AND expires_at>?").get(wordId,token,now()))throw new Error('Default selection lease changed');
      if(getVocabularySenseCatalog(wordId).version!==catalog.version||JSON.stringify(getSharedIntroductionLexicalWord(wordId))!==JSON.stringify(word))throw new Error('Default selection source changed');
      const current=getVocabularyWordSenseCoverage(wordId);
      const recommendation={senseIds:ids,invocationId:invocationId??null,workflowId:options.workflowId,attemptNumber:attempt};
      emitBackendEvent({name:'vocabulary.default_selection.recommended',entityKind:'word',entityId:wordId,actorKind:'service',actorId:VOCABULARY_SENSE_SERVICE,data:{...recommendation,applied:current.defaultUsefulSenseIds===null&&ids.length>0}});
      if(current.defaultUsefulSenseIds===null){if(!ids.length){recordEmptyUsefulRecommendation(wordId,options.workflowId,invocationId,'selector');needsOperator=true;}else writeVocabularyDefaultUsefulSenses(wordId,current.version,ids,{...actor,reason:recommendation});}
      if(!needsOperator)db.prepare("UPDATE vocabulary_default_selection_readiness SET status='ready',active_token=NULL,expires_at=NULL,recommendation_json=?,last_error=NULL,updated_at=? WHERE word_id=? AND active_token=?").run(JSON.stringify(recommendation),now(),wordId,token);
      if(needsOperator)db.prepare("UPDATE vocabulary_preparation_attempts SET finished_at=?,outcome='failed',diagnostic='No useful senses recommended; operator review required' WHERE attempt_id=? AND outcome IS NULL").run(now(),token);else completePreparationAttempt(token,now());return getVocabularyWordSenseCoverage(wordId);
    });
    if(needsOperator)throw new VocabularySenseSelectionRequired('The model selected no useful senses; operator selection is required.');resolveDefaultUsefulSelectionAttention(wordId);return result;
  }catch(error){if(error instanceof VocabularySenseSelectionRequired)throw error;const retryAt=failPreparationAttempt('selection',wordId,token,now(),'default_selection_failed',{retryable:true});if(retryAt)throw new VocabularySenseReadinessPending(retryAt);
    const current=getVocabularyWordSenseCoverage(wordId);if(current.defaultUsefulSenseIds!==null)return current;const state=db.prepare('SELECT status,expires_at,next_attempt_at FROM vocabulary_default_selection_readiness WHERE word_id=?').get(wordId) as {status:string;expires_at:string|null;next_attempt_at:string}|undefined;if(state&&(state.status==='running'||state.status==='queued'))throw new VocabularySenseReadinessPending(state.expires_at??state.next_attempt_at);throw new VocabularySenseSelectionRequired('Useful selection failed; operator retry is required.');}
}

/** The route/service authorizes the operator; explicit retry starts a fresh bounded cycle. */
export function retryDefaultUsefulSelection(wordId:string,operatorId:string):void {
  if(!operatorId.trim())throw new Error('Operator identity required');const now=new Date().toISOString();
  const changed=getDb().prepare("UPDATE vocabulary_default_selection_readiness SET status='queued',attempt_count=0,last_error=NULL,next_attempt_at=?,updated_at=? WHERE word_id=? AND status='failed'").run(now,now,wordId);
  if(Number(changed.changes)!==1)throw new VocabularySenseSelectionRequired('Useful selection is not retryable');
  emitBackendEvent({name:'vocabulary.default_selection.retry_requested',entityKind:'word',entityId:wordId,actorKind:'operator',actorId:operatorId,data:{wordId}});
}

/** Bounded, restartable cutover: dry-run never creates jobs or contacts a model. */
export async function initializeDefaultUsefulBatch(options:{apply:boolean;includeModelSelection?:boolean;afterWordId?:string;limit?:number;provider?:UsefulSelectionProvider}):Promise<{items:{wordId:string;kind:string;outcome:string;reason?:string}[];nextWordId:string|null}> {
  const limit=options.limit??100;if(!Number.isSafeInteger(limit)||limit<1||limit>1000)throw new Error('Batch limit must be between 1 and 1000');
  const words=getDb().prepare(`SELECT DISTINCT word_id FROM senses WHERE status='active' AND word_id>? ORDER BY word_id LIMIT ?`).all(options.afterWordId??'',limit) as {word_id:string}[];
  const items=[];
  for(const {word_id:wordId} of words){const plan=defaultUsefulInitializationPlan(wordId);
    if(!options.apply||plan.kind==='known'||plan.kind==='attention'||(plan.kind==='selector'&&!options.includeModelSelection)){items.push({wordId,kind:plan.kind,outcome:options.apply?'skipped':'dry_run',...(plan.reason?{reason:plan.reason}:{})});continue;}
    try{await ensureVocabularyDefaultUsefulSelection(wordId,{workflowId:`default-useful-cutover:${wordId}`,provider:options.provider});items.push({wordId,kind:plan.kind,outcome:'initialized'});}
    catch(error){items.push({wordId,kind:plan.kind,outcome:error instanceof VocabularySenseReadinessPending?'deferred':'needs_operator',reason:error instanceof Error?error.message:'Initialization failed'});}
  }
  return {items,nextWordId:words.length===limit?words.at(-1)!.word_id:null};
}


/** A saved operator decision resolves prerequisite attention without consuming authoring attempts. */
export function resolveDefaultUsefulSelectionAttention(wordId:string):void {
  if(getVocabularyWordSenseCoverage(wordId).defaultUsefulSenseIds===null)return;
  const at=new Date().toISOString();
  getDb().prepare("UPDATE vocabulary_default_selection_readiness SET status='ready',last_error=NULL,updated_at=? WHERE word_id=? AND status='failed'").run(at,wordId);
  getDb().prepare("UPDATE vocabulary_practice_preparation SET status='queued',last_error='default_selection_pending',next_attempt_at=?,updated_at=? WHERE word_id=? AND status='failed' AND last_error LIKE 'selection_requires_operator:%'").run(at,at,wordId);
}

export function defaultUsefulSelectionRetryable(wordId:string):boolean {
  const row=getDb().prepare("SELECT last_error FROM vocabulary_default_selection_readiness WHERE word_id=? AND status='failed'").get(wordId) as {last_error:string|null}|undefined;
  return row?.last_error==='default_selection_failed'||row?.last_error==='interrupted_unknown_outcome';
}
