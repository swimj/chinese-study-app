import { getDb } from './connection.ts';
import { isDeepStrictEqual } from 'node:util';
import { bulkHash, verifyBulkWord, type BulkCall, type BulkWordResult } from '../vocabulary/bulk-repertoire.ts';
import { snapshotBulkRepertoireWord } from './bulk-repertoire-snapshot.ts';
import { bulkRepertoireBlockers } from './bulk-repertoire-selection.ts';
import { getHostedServiceControls } from './hosted-operations.ts';
import { createVocabularyContent, getVocabularySenses, getVocabularySenseCatalog, emitBackendEvent } from './vocabulary-content.ts';
import { ensureVocabularySenses, createVocabularySenseProvider, VOCABULARY_SENSE_SERVICE } from '../vocabulary/sense-readiness.ts';
import { ensureVocabularyDefaultUsefulSelection, createUsefulSelectionProvider } from '../vocabulary/default-useful-selection.ts';
import { resolveVocabularySenseCoverage } from './vocabulary-sense-coverage.ts';
import { generalExerciseContent } from '../vocabulary/general-exercise-content.ts';
import { GENERAL_EXERCISE_CONTRACT, normalizeGeneralExerciseReferences, validateGeneralExerciseOutput, generalExerciseInvocation } from '../vocabulary/general-exercise-authoring.ts';
import { canonicalExerciseSource } from '../vocabulary/canonical-exercise-source.ts';
import { startServiceModelInvocation, recordServiceModelInvocationResponseSnapshot, recordServiceModelInvocationSpend, finishServiceModelInvocation } from './model-invocations.ts';
import { linkVocabularyInvocationContent, linkVocabularyInvocationSense } from './vocabulary-provenance.ts';
import { costForBulkResult } from '../llm/bulk-repertoire-pricing.ts';
import { requestBody } from '../llm/openai-compatible.ts';
import type { ProviderAdapter } from '../llm/types.ts';
import { BULK_REPERTOIRE_APPLIED, type BulkRepertoireReceipt } from './bulk-repertoire-state.ts';

const serviceId='vocabulary-bulk-repertoire';
function importCall(call:BulkCall):{id:string;serviceId:string} {
  const request=call.request,owner=request.invocationActor?.serviceId??serviceId;
  const id=startServiceModelInvocation({provider:'openai',model:request.model,invocationType:request.outputSchemaName,serviceId:owner,
    provenance:{...request.provenance,promptTemplate:request.systemPrompt,schemaName:request.outputSchemaName,schema:request.outputSchema,
      settings:{reasoningEffort:request.reasoningEffort,maxOutputTokens:request.maxOutputTokens,temperature:request.temperature,timeoutMs:request.timeoutMs,cachePrompt:request.cachePrompt},
      requestSnapshot:requestBody(request,'json_schema','max_completion_tokens',undefined)}});
  recordServiceModelInvocationResponseSnapshot(id,owner,call.result.rawResponse);
  recordServiceModelInvocationSpend(id,owner,call.cost??costForBulkResult(call.result));
  finishServiceModelInvocation(id,owner,'completed',call.latencyMs);
  // Imported observations keep their actual execution time, not the import time.
  getDb().prepare('UPDATE model_invocations SET timestamp=?,finished_at=? WHERE id=?').run(call.startedAt,call.finishedAt,id);
  return {id,serviceId:owner};
}

/** Offline per-word transaction. Caller must stop all application writers; replay makes zero network calls. */
export async function applyBulkRepertoireWord(result:BulkWordResult,options:{operationId:string;actorId:string;confirmAppStopped:boolean}):Promise<BulkRepertoireReceipt & {replayed:boolean}> {
  if(!options.confirmAppStopped||!options.actorId.trim()||!options.operationId.trim())throw new Error('Attributed stopped-writer authority is required');
  const db=getDb();if(db.isTransaction)throw new Error('Bulk application owns its transaction');
  const controls=getHostedServiceControls();
  if(!controls.maintenanceMode||controls.providerWorkEnabled)throw new Error('Maintenance with provider work disabled is required');
  await verifyBulkWord(result);
  if(result.status!=='ready'||!result.source)throw new Error('Only nonempty validated repertoire can be applied');
  const resultHash=bulkHash(result),wordId=result.snapshot.word.wordId;
  db.exec('BEGIN IMMEDIATE');
  try {
    const existing=db.prepare(`SELECT data_json FROM backend_events WHERE name=? AND entity_kind='word' AND entity_id=? AND json_extract(data_json,'$.operationId')=?`)
      .get(BULK_REPERTOIRE_APPLIED,wordId,options.operationId) as {data_json:string}|undefined;
    if(existing){
      const receipt=JSON.parse(existing.data_json) as BulkRepertoireReceipt;
      if(receipt.resultHash!==resultHash||receipt.actorId!==options.actorId)throw new Error('Operation identity belongs to different content or authority');
      db.exec('COMMIT');return {...receipt,replayed:true};
    }
    const blockers=bulkRepertoireBlockers(db,wordId);
    if(blockers.length)throw new Error(`Word is no longer eligible: ${blockers.join(', ')}`);
    if(!isDeepStrictEqual(snapshotBulkRepertoireWord(wordId),result.snapshot))throw new Error('Word inputs changed since generation');
    for(const table of ['vocabulary_sense_readiness','vocabulary_default_selection_readiness','vocabulary_practice_preparation'])
      if(db.prepare(`SELECT 1 FROM ${table} WHERE word_id=? AND status='running'`).get(wordId))throw new Error('Active preparation requires disposition before bulk application');
    const invocationIds:string[]=[];
    const byStep=new Map(result.calls.map(call=>[call.request.provenance?.stepName,call]));
    function replayAdapter(step:string):ProviderAdapter {
      return {id:'openai',defaultBaseUrl:'',apiKeyEnvironmentVariable:'',structuredOutputMode:'json_schema',async run(request){
        const call=byStep.get(step);if(!call)throw new Error('Missing retained prerequisite response');
        // Workflow/attempt metadata changes when publishing; linguistic input and contract must not.
        if(request.systemPrompt!==call.request.systemPrompt||request.userPrompt!==call.request.userPrompt
          ||bulkHash(request.outputSchema)!==bulkHash(call.request.outputSchema))throw new Error('Prerequisite input changed');
        const imported=importCall(call);invocationIds.push(imported.id);
        return {...call.result,invocationId:imported.id};
      }};
    }
    const environment={OPENAI_API_KEY:'offline-replay'};
    const workflowId=`bulk-apply:${options.operationId}:${wordId}`;
    await ensureVocabularySenses(wordId,{workflowId,provider:createVocabularySenseProvider({environment,adapter:replayAdapter('sense_inventory')})});
    await ensureVocabularyDefaultUsefulSelection(wordId,{workflowId,provider:createUsefulSelectionProvider({environment,adapter:replayAdapter('default_useful_selection')})});
    const current=getVocabularySenses(wordId).filter(sense=>sense.status==='active');
    const original=result.snapshot.catalog.establishedAt===null
      ? result.source.uses.map(use=>{
        const sense=current.find(sense=>typeof sense.description==='object'&&sense.description!==null&&!Array.isArray(sense.description)&&sense.description.label===use.label);
        if(!sense)throw new Error('Generated canonical identity could not be rebound');return sense;
      })
      :result.source.uses.map(use=>{const sense=current.find(s=>s.senseId===use.id);if(!sense)throw new Error('Canonical identity disappeared');return sense;});
    const coverage=resolveVocabularySenseCoverage(wordId);
    if(bulkHash([...coverage.includedSenseIds].sort())!==bulkHash(original.map(sense=>sense.senseId).sort()))throw new Error('Selected scope changed');
    const source=canonicalExerciseSource(result.source.word,original);
    const repertoire=byStep.get('general_exercises');if(!repertoire)throw new Error('Missing repertoire response');
    const expected=generalExerciseInvocation(source);
    if(expected.userPrompt!==repertoire.request.userPrompt||expected.systemPrompt!==repertoire.request.systemPrompt
      ||bulkHash(expected.outputSchema)!==bulkHash(repertoire.request.outputSchema))throw new Error('Rebound repertoire input differs');
    const output=validateGeneralExerciseOutput(source,normalizeGeneralExerciseReferences(source,JSON.parse(repertoire.result.rawText)));
    const imported=importCall(repertoire);invocationIds.push(imported.id);
    const at=new Date().toISOString(),actor={kind:'operator' as const,id:options.actorId,reason:{operationId:options.operationId,resultHash,authorization:'bulk_after_preflight'}};
    for(const sense of original)linkVocabularyInvocationSense({invocationId:imported.id,senseId:sense.senseId,senseVersion:sense.version,role:'input'},{kind:'service',id:imported.serviceId});
    const contentIds:string[]=[];
    for(const exercise of output.exercises){
      const draft=generalExerciseContent({contentId:`bulk-repertoire:${bulkHash([options.operationId,wordId,exercise.id])}`,word:source.word,exercise,
        senseId:exercise.sourceUseId,now:at,serviceId,source:{kind:'general_exercises',bulkOperationId:options.operationId,localId:exercise.id,
          promptVersion:GENERAL_EXERCISE_CONTRACT.promptVersion,model:result.model,invocationId:imported.id}});
      const content=createVocabularyContent(draft,actor);
      contentIds.push(content.contentId);linkVocabularyInvocationContent({invocationId:imported.id,contentId:content.contentId,contentVersion:content.version,role:'output'},{kind:'service',id:imported.serviceId});
    }
    const receipt:BulkRepertoireReceipt={operationId:options.operationId,resultHash,wordId,actorId:options.actorId,appliedAt:at,
      catalogVersion:getVocabularySenseCatalog(wordId).version,coverageFingerprint:coverage.fingerprint,contentIds,invocationIds,retiredFallbackIds:[]};
    emitBackendEvent({name:BULK_REPERTOIRE_APPLIED,entityKind:'word',entityId:wordId,actorKind:'operator',actorId:options.actorId,data:receipt});
    db.exec('COMMIT');return {...receipt,replayed:false};
  }catch(error){db.exec('ROLLBACK');throw error;}
}
