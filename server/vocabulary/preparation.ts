import { ensureVocabularyDefaultUsefulSelection,retryDefaultUsefulSelection,defaultUsefulSelectionRetryable } from './default-useful-selection.ts';
import { VocabularySenseReadinessPending,VocabularySenseSelectionRequired } from './sense-readiness.ts';
import { resolveVocabularySenseCoverage } from '../db/vocabulary-sense-coverage.ts';
import { preparationProviderFailure, WordPreparationProviderError } from '../word-content/provider-failure.ts';
import { recordPreparationAttempt,linkPreparationInvocation,completePreparationAttempt,failPreparationAttempt } from './preparation-retry.ts';
import { createHash,randomUUID } from 'node:crypto';
import type { WordContentDocument } from '../../src/domain/word-content/types.ts';
import type { VocabularyContent,VocabularyJson } from '../../src/domain/vocabulary-content.ts';
import { GENERAL_EXERCISE_CONTRACT,generalExerciseInvocation, normalizeGeneralExerciseReferences, validateGeneralExerciseOutput, type GeneralExerciseOutput } from './general-exercise-authoring.ts';
import { parseWordContent } from '../../src/domain/word-content/validation.ts';
import { createOpenAiCompatibleAdapter } from '../llm/openai-compatible.ts';
import { fetchImplementationForProvider } from '../llm/proxy-fetch.ts';
import type { FetchImplementation } from '../llm/http.ts';
import { isOutputTruncationFinishReason } from '../llm/types.ts';
import { invalidateServiceInvocation } from '../llm/invocation-ledger.ts';
import { getDb } from '../db/connection.ts';
import { getSharedWordIntroductionContent } from '../db/word-introductions.ts';
import { createVocabularyContent,getVocabularySenseCatalog,emitBackendEvent } from '../db/vocabulary-content.ts';
import { linkVocabularyInvocationContent,linkVocabularyInvocationSense } from '../db/vocabulary-provenance.ts';

export const VOCABULARY_PRACTICE_SERVICE = 'vocabulary-practice-authoring';
export const VOCABULARY_PRACTICE_MODEL = 'gpt-5.6-luna';
const TIMEOUT = 180_000;
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export type VocabularyPracticeProvider = {
  model: string; isConfigured(): boolean; generationKey(content: WordContentDocument): string;
  generate(content: WordContentDocument,options: { workflowId: string; attemptNumber?: number; onInvocation(id: string | null | undefined): void }): Promise<unknown>;
};
export type VocabularyPracticeWork = { workId: string; wordId: string; sourceContentId: string; generationKey: string;
  status: 'queued' | 'running' | 'ready' | 'failed'; attemptCount: number; activeToken: string | null; expiresAt: string | null;
  invocationId: string | null; lastError: string | null; nextAttemptAt:string; totalAttemptCount:number };
const projection = `work_id AS workId,word_id AS wordId,source_content_id AS sourceContentId,generation_key AS generationKey,
  status,attempt_count AS attemptCount,active_token AS activeToken,expires_at AS expiresAt,invocation_id AS invocationId,last_error AS lastError,next_attempt_at AS nextAttemptAt,total_attempt_count AS totalAttemptCount`;
const actor = { kind: 'service' as const,id: VOCABULARY_PRACTICE_SERVICE };

/** The shared brief is a replaceable editorial candidate; structural validity does not certify learning quality. */
export function createVocabularyPracticeProvider(options: { environment?: NodeJS.ProcessEnv; fetchImplementation?: FetchImplementation } = {}): VocabularyPracticeProvider {
  const environment = options.environment ?? process.env;
  const adapter = createOpenAiCompatibleAdapter({ id: 'openai',defaultBaseUrl: 'https://api.openai.com/v1',apiKeyEnvironmentVariable: 'OPENAI_API_KEY',
    structuredOutputMode: 'json_schema',maxTokensField: 'max_completion_tokens',
    fetchImplementation: options.fetchImplementation ?? fetchImplementationForProvider('openai',TIMEOUT) });
  return {
    model: VOCABULARY_PRACTICE_MODEL,
    isConfigured: () => Boolean(environment.OPENAI_API_KEY?.trim()),
    generationKey: (content) => { const invocation=generalExerciseInvocation(content); return hash({prompt:invocation.systemPrompt,promptVersion:invocation.promptVersion,schema:invocation.outputSchema,
      model: VOCABULARY_PRACTICE_MODEL,reasoning:'high',maxOutputTokens:24_000,inputProjectionVersion:invocation.inputProjectionVersion}); },
    async generate(content,options) {
      if (!environment.OPENAI_API_KEY?.trim()) throw new Error('Vocabulary practice provider is not configured');
      const {promptName,promptVersion,schemaVersion,inputProjectionVersion,...invocation}=generalExerciseInvocation(parseWordContent(content));
      const result = await adapter.run({ ...invocation,model: VOCABULARY_PRACTICE_MODEL,reasoningEffort: 'high',
        maxOutputTokens: 24_000,temperature: null,timeoutMs: TIMEOUT,cachePrompt: true,
        invocationActor: { kind: 'service',serviceId: VOCABULARY_PRACTICE_SERVICE },
        provenance: { workflowId: options.workflowId,attemptNumber: options.attemptNumber,stepName: 'general_exercises',
          promptName,promptVersion,schemaVersion,inputProjectionVersion } },
      { apiKey: environment.OPENAI_API_KEY.trim(),baseUrl: environment.OPENAI_BASE_URL?.trim() || null });
      options.onInvocation(result.invocationId);
      try {
        if (isOutputTruncationFinishReason(result.finishReason)) throw new Error('truncated');
        return normalizeGeneralExerciseReferences(content,JSON.parse(result.rawText) as unknown);
      } catch {
        invalidateServiceInvocation(result.invocationId,VOCABULARY_PRACTICE_SERVICE);
        throw new Error('Vocabulary practice output is invalid or incomplete');
      }
    },
  };
}
function atomic<T>(work: () => T): T {
  const db = getDb(); const nested = db.isTransaction; const savepoint = `practice_${randomUUID().replaceAll('-','')}`;
  db.exec(nested ? `SAVEPOINT ${savepoint}` : 'BEGIN IMMEDIATE');
  try { const result = work(); db.exec(nested ? `RELEASE ${savepoint}` : 'COMMIT'); return result; }
  catch (error) { db.exec(nested ? `ROLLBACK TO ${savepoint}` : 'ROLLBACK'); if (nested) db.exec(`RELEASE ${savepoint}`); throw error; }
}
function readWork(workId: string): VocabularyPracticeWork | null {
  return getDb().prepare(`SELECT ${projection} FROM vocabulary_practice_preparation WHERE work_id=?`).get(workId) as VocabularyPracticeWork | undefined ?? null;
}

/** Shared bounded authoring, invoked asynchronously by the backend worker. No session path awaits it.
 * A source/brief is prepared once. Failures retry after 30 and 60 seconds; exhausted cycles require an operator restart. */
export function createVocabularyPracticePreparation(options: { provider?: VocabularyPracticeProvider; now?: () => string; canPublish?: () => boolean;ensureDefaults?:typeof ensureVocabularyDefaultUsefulSelection } = {}) {
  const provider = options.provider ?? createVocabularyPracticeProvider();
  const now = options.now ?? (() => new Date().toISOString());
  const pending = new Map<string,Promise<void>>();
  function productionSource(content:WordContentDocument):WordContentDocument|null {
    const mappings=getDb().prepare(`SELECT m.source_use_id,m.sense_id,m.imported_sense_version,s.version AS current_sense_version,s.status
      FROM legacy_sense_imports m JOIN senses s ON s.sense_id=m.sense_id AND s.word_id=?
      WHERE m.source_content_id=?`).all(content.word.wordId,content.id) as {source_use_id:string;sense_id:string;imported_sense_version:number;current_sense_version:number;status:string}[];
    const represented=content.uses.map(use=>mappings.find(mapping=>mapping.source_use_id===use.id));
    if(!represented.length||represented.some(mapping=>!mapping||mapping.status!=='active'||mapping.imported_sense_version!==mapping.current_sense_version)
      ||new Set(represented.map(mapping=>mapping!.sense_id)).size!==content.uses.length)return null;
    return content;
  }
  function generationKey(content:WordContentDocument):string { return provider.generationKey(content); }
  function ensure(wordId: string): VocabularyPracticeWork | null {
    const bootstrap=getSharedWordIntroductionContent(wordId);if(!bootstrap)return null;
    // A source owns one automatic lifecycle across prompt revisions, including ready-empty and exhausted work.
    const existing=getDb().prepare(`SELECT ${projection} FROM vocabulary_practice_preparation WHERE word_id=? AND source_content_id=? ORDER BY CASE status WHEN 'ready' THEN 0 WHEN 'running' THEN 1 WHEN 'queued' THEN 2 ELSE 3 END,created_at,work_id LIMIT 1`).get(wordId,bootstrap.id) as VocabularyPracticeWork|undefined;
    if(existing){
      if(existing.status==='ready'&&existing.lastError==='No automatic practice demand for the selected senses.'){
        const policy=resolveVocabularySenseCoverage(wordId);
        const mappings=getDb().prepare('SELECT sense_id FROM legacy_sense_imports WHERE source_content_id=?').all(bootstrap.id) as {sense_id:string}[];
        if(policy.selectionEstablished&&mappings.some(mapping=>policy.includedSenseIds.includes(mapping.sense_id))){
          const valid=productionSource(bootstrap)!==null;
          getDb().prepare("UPDATE vocabulary_practice_preparation SET status=?,last_error=?,next_attempt_at=?,updated_at=? WHERE work_id=? AND status='ready' AND last_error='No automatic practice demand for the selected senses.'").run(valid?'queued':'failed',valid?null:'source_mapping_requires_operator',now(),now(),existing.workId);
          return readWork(existing.workId);
        }
      }
      return existing;
    }
    const key=generationKey(bootstrap),workId=`vocabulary-practice:${hash([wordId,bootstrap.id,key])}`;
    const content=productionSource(bootstrap),coverage=resolveVocabularySenseCoverage(wordId);
    const mapped=getDb().prepare('SELECT sense_id FROM legacy_sense_imports WHERE source_content_id=?').all(bootstrap.id) as {sense_id:string}[];
    if(coverage.selectionEstablished&&!mapped.some(mapping=>coverage.includedSenseIds.includes(mapping.sense_id)))return null;
    const diagnostic=!content?'source_mapping_requires_operator':!coverage.selectionEstablished?'default_selection_pending':null;
    getDb().prepare(`INSERT OR IGNORE INTO vocabulary_practice_preparation(work_id,word_id,source_content_id,generation_key,status,last_error,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`).run(workId,wordId,bootstrap.id,key,content?'queued':'failed',diagnostic,now(),now());
    return readWork(workId);
  }
  async function preflight(workId:string):Promise<boolean> {
    const work=readWork(workId);if(!work||work.status!=='queued')return false;
    const source=getSharedWordIntroductionContent(work.wordId);
    if(!source||source.id!==work.sourceContentId||!productionSource(source)){
      getDb().prepare("UPDATE vocabulary_practice_preparation SET status='failed',last_error='source_mapping_requires_operator',updated_at=? WHERE work_id=? AND status='queued'").run(now(),workId);return false;
    }
    if(work.lastError==='default_selection_pending'){
      try{await (options.ensureDefaults??ensureVocabularyDefaultUsefulSelection)(work.wordId,{workflowId:workId,canPublish:options.canPublish,now});}
      catch(error){
        if(error instanceof VocabularySenseReadinessPending){getDb().prepare("UPDATE vocabulary_practice_preparation SET next_attempt_at=?,updated_at=? WHERE work_id=? AND status='queued' AND last_error='default_selection_pending'").run(error.retryAt,now(),workId);return false;}
        if(error instanceof VocabularySenseSelectionRequired){getDb().prepare("UPDATE vocabulary_practice_preparation SET status='failed',last_error=?,updated_at=? WHERE work_id=? AND status='queued'").run(`selection_requires_operator: ${error.message}`,now(),workId);return false;}
        throw error;
      }
      const coverage=resolveVocabularySenseCoverage(work.wordId);
      const mappings=getDb().prepare('SELECT sense_id FROM legacy_sense_imports WHERE source_content_id=?').all(source.id) as {sense_id:string}[];
      if(!mappings.some(mapping=>coverage.includedSenseIds.includes(mapping.sense_id))){getDb().prepare("UPDATE vocabulary_practice_preparation SET status='ready',last_error='No automatic practice demand for the selected senses.',updated_at=? WHERE work_id=? AND status='queued'").run(now(),workId);return false;}
      getDb().prepare("UPDATE vocabulary_practice_preparation SET last_error=NULL,next_attempt_at=?,updated_at=? WHERE work_id=? AND status='queued' AND last_error='default_selection_pending'").run(now(),now(),workId);
    }
    return true;
  }
  function claim(workId: string): string | null {
    if (!provider.isConfigured()) return null;
    const token = randomUUID(); const timestamp = now();
    return atomic(() => {
    const work=readWork(workId),source=work?getSharedWordIntroductionContent(work.wordId):null;
    if(!work||work.status!=='queued'||work.lastError==='default_selection_pending'||!source||source.id!==work.sourceContentId||!productionSource(source))return null;
    const key=generationKey(source);
    if(key!==work.generationKey){
      getDb().prepare("UPDATE vocabulary_practice_preparation SET generation_key=?,updated_at=? WHERE work_id=? AND status='queued'").run(key,now(),workId);
      emitBackendEvent({name:'vocabulary.practice_preparation.contract_updated',entityKind:'vocabulary_practice_preparation',entityId:workId,actorKind:'service',actorId:VOCABULARY_PRACTICE_SERVICE,data:{previousGenerationKey:work.generationKey,generationKey:key,attemptCount:work.attemptCount}});
    }
    const changed = getDb().prepare(`UPDATE vocabulary_practice_preparation SET status='running',attempt_count=attempt_count+1,total_attempt_count=total_attempt_count+1,invocation_id=NULL,
      active_token=?,expires_at=?,updated_at=? WHERE work_id=? AND status='queued' AND attempt_count<3 AND next_attempt_at<=?`)
      .run(token,new Date(Date.parse(timestamp)+5*60_000).toISOString(),timestamp,workId,timestamp);
    if(Number(changed.changes)!==1)return null;
    recordPreparationAttempt('practice',workId,token,timestamp);
    return token;
    });
  }
  async function run(workId: string,token: string): Promise<VocabularyContent[]> {
    const work = readWork(workId);
    if (!work || work.status !== 'running' || work.activeToken !== token || work.expiresAt! <= now()) throw new Error('Vocabulary preparation lease is not active');
    let invocationId: string | null | undefined;
    let source: WordContentDocument | null = null;
    let retryable=false,emptyOutput=false;
    const catalogue = getVocabularySenseCatalog(work.wordId);
    const sourceSenses = getDb().prepare(`SELECT sense_id,imported_sense_version,source_use_id FROM legacy_sense_imports WHERE source_content_id=?`)
      .all(work.sourceContentId) as Array<{ sense_id: string; imported_sense_version: number; source_use_id: string }>;
    try {
      const bootstrap=getSharedWordIntroductionContent(work.wordId);
      source = bootstrap?productionSource(bootstrap):null;
      if (!source || source.id !== work.sourceContentId || generationKey(source) !== work.generationKey) throw new Error('Vocabulary preparation source changed');
      retryable=true;
      let output: unknown;
      try {
        output = await provider.generate(source,{ workflowId: workId,attemptNumber: work.totalAttemptCount,onInvocation: (id) => {
          invocationId = id;
          if (id != null) {
            linkPreparationInvocation(token,id);
            getDb().prepare("UPDATE vocabulary_practice_preparation SET invocation_id=? WHERE work_id=? AND status='running' AND active_token=?").run(id,workId,token);
            for (const sense of sourceSenses.filter(sense=>source!.uses.some(use=>use.id===sense.source_use_id))) linkVocabularyInvocationSense({ invocationId: id,senseId: sense.sense_id,
              senseVersion: sense.imported_sense_version,role: 'input' },actor);
          }
        } });
      } catch (error) { throw preparationProviderFailure(error); }
      let wire:GeneralExerciseOutput;
      try { wire=validateGeneralExerciseOutput(source,output); }
      catch(error) { invalidateServiceInvocation(invocationId,VOCABULARY_PRACTICE_SERVICE);throw error; }
      retryable=false;
      if(!wire.exercises.length){
        emptyOutput=true;
        emitBackendEvent({name:'vocabulary.practice_preparation.no_exercises',entityKind:'vocabulary_practice_preparation',entityId:workId,
          actorKind:'service',actorId:VOCABULARY_PRACTICE_SERVICE,data:{workId,sourceContentId:source.id,invocationId:invocationId??null,exercises:[]}});
        throw new Error('Vocabulary practice authored no exercises; operator review required');
      }
      return atomic(() => {
        if (options.canPublish && !options.canPublish()) throw new Error('Vocabulary preparation publication is currently blocked');
        const current = readWork(workId);
        if (!current || current.status !== 'running' || current.activeToken !== token || current.expiresAt! <= now()) throw new Error('Vocabulary preparation lease changed');
        if (getSharedWordIntroductionContent(work.wordId)?.id !== source!.id || getVocabularySenseCatalog(work.wordId).version !== catalogue.version
          || !productionSource(getSharedWordIntroductionContent(work.wordId)!) || generationKey(source!)!==work.generationKey) {
          throw new Error('Vocabulary preparation source changed');
        }
        const content = wire.exercises.map((exercise) => {
          const mapping = sourceSenses.find((sense) => sense.source_use_id === exercise.sourceUseId);
          if(!mapping)throw new Error('Vocabulary preparation lost its canonical use binding');
          const created = createVocabularyContent({ contentId: `vocabulary-practice-content:${hash([workId,exercise.id])}`,
            kind: 'exercise',payloadVersion: 1,body: { prompt: exercise.stimulus.kind === 'direct_text' ? exercise.stimulus.text : `${exercise.stimulus.frame}\n${exercise.stimulus.text}`,
              instruction: '',stimulus: exercise.stimulus as unknown as VocabularyJson,reveal: { teachingNote: exercise.teachingNote },
              source: { kind: 'general_exercises',bootstrapContentId: source!.id,localId: exercise.id,promptVersion: GENERAL_EXERCISE_CONTRACT.promptVersion,model: provider.model } },
            exerciseType: exercise.stimulus.kind === 'phrase_cloze' ? 'cloze' : 'definition_gloss',skill: 'production',exerciseRole: 'general',
            assessment: { responseMode: 'hanzi_entry',matchingProfile: 'mandarin' },accessScope: 'shared',availability: 'active',originKind: 'model',
            authorKind: 'service',authorId: VOCABULARY_PRACTICE_SERVICE,
            words: [{ wordId: work.wordId,relation: 'target',senseId: mapping.sense_id,
              senseMappingEstablishedAt: now() }],
            answers: [{ wordId: work.wordId,acceptedForms: [...new Set([source!.word.hanzi,source!.word.traditional].filter((form): form is string => form !== null))] }] },actor);
          if (invocationId != null) linkVocabularyInvocationContent({ invocationId,contentId: created.contentId,contentVersion: created.version,role: 'output' },actor);
          return created;
        });
        getDb().prepare(`UPDATE vocabulary_practice_preparation SET status='ready',active_token=NULL,expires_at=NULL,updated_at=?,last_error=NULL
          WHERE work_id=? AND status='running' AND active_token=?`).run(now(),workId,token);
        completePreparationAttempt(token,now());
        return content;
      });
    } catch (error) {
      // Provider bodies and transport failures may contain secrets; retain only a safe workflow code.
      const currentSource=getSharedWordIntroductionContent(work.wordId);
      const diagnostic=!currentSource||currentSource.id!==work.sourceContentId||!productionSource(currentSource)?'source_mapping_requires_operator':emptyOutput?'no_faithful_exercises':'generation_failed';
      failPreparationAttempt('practice',workId,token,now(),diagnostic,{retryable});
      if (error instanceof WordPreparationProviderError) throw error;
      if (error instanceof Error && /^Vocabulary (practice|preparation)/.test(error.message)) throw error;
      throw new Error('Vocabulary practice generation failed; inspect its retained invocation');
    }
  }
  return {
    isConfigured: () => provider.isConfigured(),ensure,preflight,claim,run,
    listQueued(limit = 20): VocabularyPracticeWork[] {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error('Invalid preparation batch size');
      return getDb().prepare(`SELECT ${projection} FROM vocabulary_practice_preparation WHERE status='queued' AND next_attempt_at<=? ORDER BY next_attempt_at,created_at,work_id LIMIT ?`).all(now(),limit) as VocabularyPracticeWork[];
    },
    /** Operator diagnostics omit lease tokens and retained source/provider bodies. */
    listFailed(limit = 50): Array<Pick<VocabularyPracticeWork,'workId'|'wordId'|'sourceContentId'|'attemptCount'|'invocationId'|'lastError'> & {retryable:boolean}> {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error('Invalid preparation batch size');
      const rows = getDb().prepare(`SELECT work_id AS workId,word_id AS wordId,source_content_id AS sourceContentId,
        attempt_count AS attemptCount,invocation_id AS invocationId,last_error AS lastError
        FROM vocabulary_practice_preparation WHERE status='failed' ORDER BY updated_at DESC,work_id LIMIT ?`).all(limit) as Array<Pick<VocabularyPracticeWork,'workId'|'wordId'|'sourceContentId'|'attemptCount'|'invocationId'|'lastError'>>;
      return rows.map(row => ({...row,retryable:(()=>{const source=getSharedWordIntroductionContent(row.wordId);return Boolean(source&&source.id===row.sourceContentId&&productionSource(source))&&!row.lastError?.startsWith('source_mapping_requires_operator')&&!(row.lastError?.startsWith('selection_requires_operator:')&&resolveVocabularySenseCoverage(row.wordId).word.defaultUsefulSenseIds===null&&!defaultUsefulSelectionRetryable(row.wordId));})()}));
    },
    recoverExpired(): void {
      const rows=getDb().prepare(`SELECT work_id,active_token FROM vocabulary_practice_preparation WHERE status='running' AND expires_at<=?`).all(now()) as Array<{work_id:string;active_token:string}>;
      for(const row of rows)failPreparationAttempt('practice',row.work_id,row.active_token,now(),'interrupted_unknown_outcome',{interrupted:true});
    },
    retry(workId: string,operatorId: string): void {
      if (!operatorId.trim()) throw new Error('Operator authority is required');
      atomic(() => {
        const work=readWork(workId);if(!work||work.status!=='failed')throw new Error('Preparation is not retryable');
        const source=getSharedWordIntroductionContent(work.wordId);if(!source||source.id!==work.sourceContentId||!productionSource(source))throw new Error('Source mappings require operator review before retry');
        if(work.lastError?.startsWith('selection_requires_operator:')&&resolveVocabularySenseCoverage(work.wordId).word.defaultUsefulSenseIds===null)retryDefaultUsefulSelection(work.wordId,operatorId);
        const changed = getDb().prepare(`UPDATE vocabulary_practice_preparation SET status='queued',attempt_count=0,last_error=CASE WHEN last_error LIKE 'selection_requires_operator:%' THEN 'default_selection_pending' ELSE NULL END,invocation_id=NULL,updated_at=?,next_attempt_at=?
          WHERE work_id=? AND status='failed'`).run(now(),now(),workId);
        if (Number(changed.changes) !== 1) throw new Error('Preparation is not retryable');
        emitBackendEvent({ name: 'vocabulary.practice_preparation.retry_requested',data: { workId },
          actorKind: 'operator',actorId: operatorId,entityKind: 'vocabulary_practice_preparation',entityId: workId });
      });
    },
    async prepare(wordId: string): Promise<void> {
      let task = pending.get(wordId);
      if (!task) {
        task = (async () => { const work = ensure(wordId); if (!work||!await preflight(work.workId)) return; const token = claim(work.workId); if (token) await run(work.workId,token); })();
        pending.set(wordId,task);
        void task.finally(() => pending.delete(wordId)).catch(() => undefined);
      }
      await task;
    },
  };
}
