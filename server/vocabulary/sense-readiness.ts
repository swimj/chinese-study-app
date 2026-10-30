import { readFileSync } from 'node:fs';
import { getVocabularyWordSenseCoverage,writeVocabularyDefaultUsefulSenses } from '../db/vocabulary-sense-coverage.ts';
import { recordPreparationAttempt,linkPreparationInvocation,completePreparationAttempt,failPreparationAttempt } from './preparation-retry.ts';
import { randomUUID } from 'node:crypto';
import type { VocabularySense, VocabularySenseCatalog } from '../../src/domain/vocabulary-content.ts';
import type { WordContentDocument } from '../../src/domain/word-content/types.ts';
import type { JsonSchema } from '../../src/domain/reflection-result-schema.ts';
import { config, getDb } from '../db/connection.ts';
import { isOperatorSubject, parseOperatorAllowlist } from '../operator-access.ts';
import { createVocabularySense, establishVocabularySenseCatalog, getVocabularySenseCatalog,
  getVocabularySenses, emitBackendEvent } from '../db/vocabulary-content.ts';
import { getSharedWordIntroductionContent, getSharedIntroductionLexicalWord } from '../db/word-introductions.ts';
import { linkVocabularyInvocationSense } from '../db/vocabulary-provenance.ts';
import { createOpenAiCompatibleAdapter } from '../llm/openai-compatible.ts';
import { fetchImplementationForProvider } from '../llm/proxy-fetch.ts';
import { invalidateServiceInvocation } from '../llm/invocation-ledger.ts';
import { validateJsonSchema } from '../llm/json-schema-validator.ts';
import { isOutputTruncationFinishReason, type ProviderAdapter } from '../llm/types.ts';

export const VOCABULARY_SENSE_SERVICE = 'vocabulary-sense-readiness';
export const VOCABULARY_SENSE_MODEL = 'gpt-5.6-luna';
const actor = { kind: 'service' as const, id: VOCABULARY_SENSE_SERVICE };
const timeoutMs = 180_000;
const prompt = readFileSync(new URL('./reflection-prompts/sense-inventory.md',import.meta.url),'utf8');
const schema: JsonSchema = { type: 'object', additionalProperties: false, required: ['senses'], properties: {
  senses: { type: 'array', minItems: 1, maxItems: 16, items: { type: 'object', additionalProperties: false,
    required: ['label','notes','defaultUseful'], properties: { label: { type: 'string' },defaultUseful:{type:'boolean'},
      notes: { type: 'array', maxItems: 8, items: { type: 'string' } } } } },
} };
export type VocabularySenseLexicalWord = NonNullable<ReturnType<typeof getSharedIntroductionLexicalWord>>;
type Inventory = { senses: Array<{ label: string; notes: string[];defaultUseful:boolean }> };
export type VocabularySenseProvider = {
  isConfigured(): boolean;
  generate(word: VocabularySenseLexicalWord, options: {
    workflowId: string; attemptNumber?: number; onInvocation(id: string | null | undefined): void;
  }): Promise<unknown>;
};
export type VocabularySenseReadiness = {
  catalog: VocabularySenseCatalog; senses: VocabularySense[]; source: 'existing' | 'bootstrap' | 'generated';
};
export class VocabularySenseReadinessError extends Error {}
export class VocabularySenseSelectionRequired extends VocabularySenseReadinessError {}
/** The caller must durably defer its dependent job; this is not a failed reflection invocation. */
export class VocabularySenseReadinessPending extends VocabularySenseReadinessError {
  constructor(readonly retryAt:string) { super('Sense readiness is running or waiting for automatic retry'); }
}

export function createVocabularySenseProvider(options: { environment?: NodeJS.ProcessEnv; adapter?: ProviderAdapter } = {}): VocabularySenseProvider {
  const environment = options.environment ?? process.env;
  const adapter = options.adapter ?? createOpenAiCompatibleAdapter({ id: 'openai', defaultBaseUrl: 'https://api.openai.com/v1',
    apiKeyEnvironmentVariable: 'OPENAI_API_KEY', structuredOutputMode: 'json_schema', maxTokensField: 'max_completion_tokens',
    fetchImplementation: fetchImplementationForProvider('openai',timeoutMs) });
  return {
    isConfigured: () => Boolean(environment.OPENAI_API_KEY?.trim()),
    async generate(word, context) {
      if (!environment.OPENAI_API_KEY?.trim()) throw new VocabularySenseReadinessError('Sense provider is not configured');
      const result = await adapter.run({ model: VOCABULARY_SENSE_MODEL, reasoningEffort: 'high', systemPrompt: prompt,
        userPrompt: JSON.stringify({ word }), outputSchemaName: 'vocabulary_sense_inventory_v2', outputSchema: schema,
        maxOutputTokens: 8000, temperature: null, timeoutMs, cachePrompt: true,
        invocationActor: { kind: 'service', serviceId: VOCABULARY_SENSE_SERVICE },
        provenance: { workflowId: context.workflowId, attemptNumber: context.attemptNumber, stepName: 'sense_inventory',
          promptName: 'vocabulary-sense-inventory', promptVersion: '2', schemaVersion: '2', inputProjectionVersion: 'lexical-word-v1' } },
      { apiKey: environment.OPENAI_API_KEY.trim(), baseUrl: environment.OPENAI_BASE_URL?.trim() || null });
      context.onInvocation(result.invocationId);
      try {
        if (isOutputTruncationFinishReason(result.finishReason)) throw new Error('truncated');
        return validateInventory(JSON.parse(result.rawText));
      } catch {
        invalidateServiceInvocation(result.invocationId,VOCABULARY_SENSE_SERVICE);
        throw new VocabularySenseReadinessError('Sense inventory output is invalid or incomplete');
      }
    },
  };
}
function validateInventory(value: unknown): Inventory {
  if (validateJsonSchema(value,schema).length) throw new VocabularySenseReadinessError('Sense inventory failed validation');
  const inventory = value as Inventory;
  const labels = inventory.senses.map(sense => sense.label.trim().toLowerCase());
  if (labels.some(label => !label || label.length > 600) || new Set(labels).size !== labels.length
    || inventory.senses.some(sense => sense.notes.some(note => !note.trim() || note.length > 1600))) {
    throw new VocabularySenseReadinessError('Sense inventory contains blank or duplicate descriptions');
  }
  return inventory;
}
function atomic<T>(operation: () => T): T {
  const db = getDb(); const nested = db.isTransaction; const name = `senses_${randomUUID().replaceAll('-','')}`;
  db.exec(nested ? `SAVEPOINT ${name}` : 'BEGIN IMMEDIATE');
  try { const result = operation(); db.exec(nested ? `RELEASE ${name}` : 'COMMIT'); return result; }
  catch (error) { db.exec(nested ? `ROLLBACK TO ${name}` : 'ROLLBACK'); if (nested) db.exec(`RELEASE ${name}`); throw error; }
}
function existing(wordId: string): VocabularySenseReadiness | null {
  const catalog = getVocabularySenseCatalog(wordId);
  if (catalog.establishedAt === null) return null;
  const senses = getVocabularySenses(wordId).filter(sense => sense.status === 'active');
  if (!senses.length) throw new VocabularySenseReadinessError('Established sense catalog has no active senses; operator review required');
  return { catalog,senses,source: 'existing' };
}
function publishGuard(options: { canPublish?: () => boolean }): void {
  if (options.canPublish && !options.canPublish()) throw new VocabularySenseReadinessPending(new Date(Date.now()+30_000).toISOString());
}
/** Existing inventories remain readable without assuming that their useful selection is known.
 * Legacy rich documents do not establish a new canonical inventory during ordinary runtime. */
export function canEnsureVocabularySensesFromBootstrap(wordId:string):boolean { return ensureVocabularySensesFromBootstrap(wordId)!==null; }
export function ensureVocabularySensesFromBootstrap(wordId:string,_options:{canPublish?:()=>boolean}={}):VocabularySenseReadiness|null {
  const ready=existing(wordId);if(!ready&&getVocabularySenses(wordId).length)throw new VocabularySenseReadinessError('Partial sense inventory requires operator review');return ready;
}

/** Establish an inventory on demand; never creates teaching or exercise repertoires.
 * Provider failures retry durably after 30/60 seconds; only exhausted cycles require an operator restart. */
export async function ensureVocabularySenses(wordId: string, options: {
  workflowId: string; attemptNumber?: number; provider?: VocabularySenseProvider; now?: () => string; canPublish?: () => boolean;
}): Promise<VocabularySenseReadiness> {
  if (!options.workflowId.trim() || (options.attemptNumber !== undefined && (!Number.isSafeInteger(options.attemptNumber) || options.attemptNumber < 1))) {
    throw new VocabularySenseReadinessError('Sense readiness requires valid workflow provenance');
  }
  const ready = ensureVocabularySensesFromBootstrap(wordId,options); if (ready) return ready;
  publishGuard(options);
  const catalog = getVocabularySenseCatalog(wordId);
  const bootstrap = getSharedWordIntroductionContent(wordId);
  // An unestablished partial inventory is an editorial question, not permission to duplicate it.
  if (bootstrap || getVocabularySenses(wordId).length) throw new VocabularySenseReadinessError('Partial sense inventory requires operator review');
  const provider = options.provider ?? createVocabularySenseProvider();
  if (!provider.isConfigured()) throw new VocabularySenseReadinessError('Sense provider is not configured');
  const now = options.now ?? (() => new Date().toISOString());
  const timestamp = now(); const token = randomUUID(); const db = getDb();
  const attempt = atomic(() => {
    publishGuard(options);
    db.prepare(`INSERT OR IGNORE INTO vocabulary_sense_readiness(word_id,status,expected_catalog_version,workflow_id,created_at,updated_at)
      VALUES (?,'queued',?,?,?,?)`).run(wordId,catalog.version,options.workflowId,timestamp,timestamp);
    const expired=db.prepare(`SELECT active_token FROM vocabulary_sense_readiness WHERE word_id=? AND status='running' AND expires_at<=?`).get(wordId,timestamp) as {active_token:string}|undefined;
    if(expired)failPreparationAttempt('sense',wordId,expired.active_token,timestamp,'interrupted_unknown_outcome',{interrupted:true});
    const claimed = db.prepare(`UPDATE vocabulary_sense_readiness SET status='running',active_token=?,expires_at=?,attempt_count=attempt_count+1,total_attempt_count=total_attempt_count+1,invocation_id=NULL,
      expected_catalog_version=?,workflow_id=?,updated_at=? WHERE word_id=? AND status='queued' AND attempt_count<3 AND next_attempt_at<=?`)
      .run(token,new Date(Date.parse(timestamp)+5*60_000).toISOString(),catalog.version,options.workflowId,timestamp,wordId,timestamp);
    if (Number(claimed.changes) !== 1) return null;
    recordPreparationAttempt('sense',wordId,token,timestamp);
    return Number(db.prepare('SELECT total_attempt_count FROM vocabulary_sense_readiness WHERE word_id=?').get(wordId)!.total_attempt_count);
  });
  if (attempt === null) {
    const state=db.prepare('SELECT status,next_attempt_at,expires_at FROM vocabulary_sense_readiness WHERE word_id=?').get(wordId) as {status:string;next_attempt_at:string;expires_at:string|null};
    if(state.status==='queued'||state.status==='running')throw new VocabularySenseReadinessPending(state.expires_at??state.next_attempt_at);
    throw new VocabularySenseReadinessError('Sense readiness requires explicit operator retry');
  }
  let invocationId: string | null | undefined;
  let retryable=true;
  try {
    const word = getSharedIntroductionLexicalWord(wordId)!;
    const output = await provider.generate(word,{ workflowId: options.workflowId,attemptNumber: attempt,
      onInvocation: id => {
        invocationId = id;
        if (id != null) {linkPreparationInvocation(token,id);db.prepare("UPDATE vocabulary_sense_readiness SET invocation_id=? WHERE word_id=? AND status='running' AND active_token=?").run(id,wordId,token);}
      } });
    let inventory: Inventory;
    try { inventory = validateInventory(output); }
    catch (error) { invalidateServiceInvocation(invocationId,VOCABULARY_SENSE_SERVICE); throw error; }
    // Publication races are retried under a new lease; valid output is not invalidated.
    const {recordEmptyUsefulRecommendation}=await import('./default-useful-selection.ts');
    return atomic(() => {
      publishGuard(options);
      if (!db.prepare("SELECT 1 FROM vocabulary_sense_readiness WHERE word_id=? AND status='running' AND active_token=? AND expires_at>?").get(wordId,token,now())) {
        throw new VocabularySenseReadinessError('Sense readiness lease changed');
      }
      if (getVocabularySenseCatalog(wordId).version !== catalog.version || JSON.stringify(getSharedIntroductionLexicalWord(wordId)) !== JSON.stringify(word)
        || getSharedWordIntroductionContent(wordId) !== null) throw new VocabularySenseReadinessError('Sense readiness source changed');
      const selected:string[]=[];
      for (const {defaultUseful,...description} of inventory.senses) {
        const sense = createVocabularySense({ wordId,description: { ...description,source: { kind: 'sense_inventory' } } },actor);
        if(defaultUseful)selected.push(sense.senseId);
        if (invocationId != null) linkVocabularyInvocationSense({ invocationId,senseId: sense.senseId,senseVersion: sense.version,role: 'output' },actor);
      }
      establishVocabularySenseCatalog(wordId,getVocabularySenseCatalog(wordId).version,actor);
      const currentCoverage=getVocabularyWordSenseCoverage(wordId);
      const recommendation={invocationId:invocationId??null,workflowId:options.workflowId,attemptNumber:attempt,senseIds:selected};
      emitBackendEvent({name:'vocabulary.default_selection.recommended',entityKind:'word',entityId:wordId,actorKind:'service',actorId:VOCABULARY_SENSE_SERVICE,data:{...recommendation,applied:currentCoverage.defaultUsefulSenseIds===null&&selected.length>0}});
      if(currentCoverage.defaultUsefulSenseIds===null){if(selected.length)writeVocabularyDefaultUsefulSenses(wordId,currentCoverage.version,selected,{...actor,reason:recommendation});else recordEmptyUsefulRecommendation(wordId,options.workflowId,invocationId,'inventory');}
      db.prepare("UPDATE vocabulary_sense_readiness SET status='ready',active_token=NULL,expires_at=NULL,last_error=NULL,updated_at=? WHERE word_id=? AND active_token=?")
        .run(now(),wordId,token);
      completePreparationAttempt(token,now());
      return { ...existing(wordId)!,source: 'generated' };
    });
  } catch (error) {
    const retryAt=failPreparationAttempt('sense',wordId,token,now(),'generation_failed',{retryable});
    if(retryAt)throw new VocabularySenseReadinessPending(retryAt);
    if(error instanceof VocabularySenseReadinessPending)throw error;
    const latest=existing(wordId);if(latest)return latest;
    const state=db.prepare('SELECT status,expires_at,next_attempt_at FROM vocabulary_sense_readiness WHERE word_id=?').get(wordId) as {status:string;expires_at:string|null;next_attempt_at:string}|undefined;
    if(state&&(state.status==='running'||state.status==='queued'))throw new VocabularySenseReadinessPending(state.expires_at??state.next_attempt_at);
    if (error instanceof VocabularySenseReadinessError) throw error;
    throw new VocabularySenseReadinessError('Sense inventory generation failed; inspect retained invocation');
  }
}

export function retryVocabularySenseReadiness(wordId: string, operatorId: string): void {
  if (!isOperatorSubject(operatorId,parseOperatorAllowlist(),config.authMode)) throw new VocabularySenseReadinessError('Operator access required');
  atomic(() => {
    const result = getDb().prepare(`UPDATE vocabulary_sense_readiness SET status='queued',attempt_count=0,invocation_id=NULL,last_error=NULL,updated_at=?,next_attempt_at=?
      WHERE word_id=? AND status='failed'`).run(new Date().toISOString(),new Date().toISOString(),wordId);
    if (Number(result.changes) !== 1) throw new VocabularySenseReadinessError('Sense readiness is not retryable');
    emitBackendEvent({ name: 'vocabulary.sense_readiness.retry_requested',data: { wordId },actorKind: 'operator',actorId: operatorId,
      entityKind: 'word',entityId: wordId });
  });
}
