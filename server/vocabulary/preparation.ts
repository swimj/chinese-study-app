import { getVocabularyWordSenseCoverage } from '../db/vocabulary-sense-coverage.ts';
import { preparationProviderFailure, WordPreparationProviderError } from '../word-content/provider-failure.ts';
import { recordPreparationAttempt,linkPreparationInvocation,completePreparationAttempt,failPreparationAttempt } from './preparation-retry.ts';
import { createHash,randomUUID } from 'node:crypto';
import type { WordContentDocument } from '../../src/domain/word-content/types.ts';
import type { VocabularyContent,VocabularyJson } from '../../src/domain/vocabulary-content.ts';
import { generalExerciseInvocation, validateGeneralExerciseOutput, type GeneralExerciseOutput } from './general-exercise-authoring.ts';
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

/** The v4 brief is a replaceable editorial candidate; structural validity does not certify learning quality. */
export function createVocabularyPracticeProvider(options: { environment?: NodeJS.ProcessEnv; fetchImplementation?: FetchImplementation } = {}): VocabularyPracticeProvider {
  const environment = options.environment ?? process.env;
  const adapter = createOpenAiCompatibleAdapter({ id: 'openai',defaultBaseUrl: 'https://api.openai.com/v1',apiKeyEnvironmentVariable: 'OPENAI_API_KEY',
    structuredOutputMode: 'json_schema',maxTokensField: 'max_completion_tokens',
    fetchImplementation: options.fetchImplementation ?? fetchImplementationForProvider('openai',TIMEOUT) });
  return {
    model: VOCABULARY_PRACTICE_MODEL,
    isConfigured: () => Boolean(environment.OPENAI_API_KEY?.trim()),
    generationKey: (content) => { const invocation=generalExerciseInvocation(content); return hash({prompt:invocation.systemPrompt,promptVersion:'v4',schema:invocation.outputSchema,
      model: VOCABULARY_PRACTICE_MODEL,reasoning:'high',maxOutputTokens:24_000,inputProjectionVersion:'general-exercises-v1'}); },
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
        return JSON.parse(result.rawText) as unknown;
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
export function createVocabularyPracticePreparation(options: { provider?: VocabularyPracticeProvider; now?: () => string; canPublish?: () => boolean } = {}) {
  const provider = options.provider ?? createVocabularyPracticeProvider();
  const now = options.now ?? (() => new Date().toISOString());
  const pending = new Map<string,Promise<void>>();
  function productionSource(content:WordContentDocument):WordContentDocument { return content; }
  function generationKey(content:WordContentDocument):string { return provider.generationKey(content); }
  function ensure(wordId: string): VocabularyPracticeWork | null {
    const bootstrap = getSharedWordIntroductionContent(wordId);
    const content=bootstrap?productionSource(bootstrap):null;
    if (!content) return null;
    const key = generationKey(content);
    const workId = `vocabulary-practice:${hash([wordId,content.id,key])}`;
    getDb().prepare(`INSERT OR IGNORE INTO vocabulary_practice_preparation
      (work_id,word_id,source_content_id,generation_key,status,created_at,updated_at) VALUES (?,?,?,?,'queued',?,?)`)
      .run(workId,wordId,content.id,key,now(),now());
    return readWork(workId);
  }
  function claim(workId: string): string | null {
    if (!provider.isConfigured()) return null;
    const token = randomUUID(); const timestamp = now();
    return atomic(() => {
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
    let retryable=false;
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
            for (const sense of sourceSenses) linkVocabularyInvocationSense({ invocationId: id,senseId: sense.sense_id,
              senseVersion: sense.imported_sense_version,role: 'input' },actor);
          }
        } });
      } catch (error) { throw preparationProviderFailure(error); }
      let wire:GeneralExerciseOutput;
      try { wire=validateGeneralExerciseOutput(source,output); }
      catch(error) { invalidateServiceInvocation(invocationId,VOCABULARY_PRACTICE_SERVICE);throw error; }
      retryable=false;
      return atomic(() => {
        if (options.canPublish && !options.canPublish()) throw new Error('Vocabulary preparation publication is currently blocked');
        const current = readWork(workId);
        if (!current || current.status !== 'running' || current.activeToken !== token || current.expiresAt! <= now()) throw new Error('Vocabulary preparation lease changed');
        if (getSharedWordIntroductionContent(work.wordId)?.id !== source!.id || getVocabularySenseCatalog(work.wordId).version !== catalogue.version
          || !productionSource(getSharedWordIntroductionContent(work.wordId)!) || generationKey(source!)!==work.generationKey) {
          throw new Error('Vocabulary preparation source changed');
        }
        const content = wire.exercises.map((exercise) => {
          const mapping = exercise.sourceUseId === null ? null : sourceSenses.find((sense) => sense.source_use_id === exercise.sourceUseId);
          const created = createVocabularyContent({ contentId: `vocabulary-practice-content:${hash([workId,exercise.id])}`,
            kind: 'exercise',payloadVersion: 1,body: { prompt: exercise.stimulus.kind === 'direct_text' ? exercise.stimulus.text : `${exercise.stimulus.frame}\n${exercise.stimulus.text}`,
              instruction: '',stimulus: exercise.stimulus as unknown as VocabularyJson,reveal: { teachingNote: exercise.teachingNote },
              source: { kind: 'general_exercises',bootstrapContentId: source!.id,localId: exercise.id,promptVersion: 'v4',model: provider.model } },
            exerciseType: exercise.stimulus.kind === 'phrase_cloze' ? 'cloze' : 'definition_gloss',skill: 'production',exerciseRole: 'general',
            assessment: { responseMode: 'hanzi_entry',matchingProfile: 'mandarin' },accessScope: 'shared',availability: 'active',originKind: 'model',
            authorKind: 'service',authorId: VOCABULARY_PRACTICE_SERVICE,
            words: [{ wordId: work.wordId,relation: 'target',senseId: mapping?.sense_id ?? null,
              senseMappingEstablishedAt: mapping ? now() : null }],
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
      failPreparationAttempt('practice',workId,token,now(),'generation_failed',{retryable});
      if (error instanceof WordPreparationProviderError) throw error;
      if (error instanceof Error && /^Vocabulary (practice|preparation)/.test(error.message)) throw error;
      throw new Error('Vocabulary practice generation failed; inspect its retained invocation');
    }
  }
  return {
    isConfigured: () => provider.isConfigured(),ensure,claim,run,
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
      return rows.map(row => ({...row,retryable:true}));
    },
    recoverExpired(): void {
      const rows=getDb().prepare(`SELECT work_id,active_token FROM vocabulary_practice_preparation WHERE status='running' AND expires_at<=?`).all(now()) as Array<{work_id:string;active_token:string}>;
      for(const row of rows)failPreparationAttempt('practice',row.work_id,row.active_token,now(),'interrupted_unknown_outcome',{interrupted:true});
    },
    retry(workId: string,operatorId: string): void {
      if (!operatorId.trim()) throw new Error('Operator authority is required');
      atomic(() => {
        const changed = getDb().prepare(`UPDATE vocabulary_practice_preparation SET status='queued',attempt_count=0,last_error=NULL,invocation_id=NULL,updated_at=?,next_attempt_at=?
          WHERE work_id=? AND status='failed'`).run(now(),now(),workId);
        if (Number(changed.changes) !== 1) throw new Error('Preparation is not retryable');
        emitBackendEvent({ name: 'vocabulary.practice_preparation.retry_requested',data: { workId },
          actorKind: 'operator',actorId: operatorId,entityKind: 'vocabulary_practice_preparation',entityId: workId });
      });
    },
    async prepare(wordId: string): Promise<void> {
      let task = pending.get(wordId);
      if (!task) {
        task = (async () => { const work = ensure(wordId); if (!work) return; const token = claim(work.workId); if (token) await run(work.workId,token); })();
        pending.set(wordId,task);
        void task.finally(() => pending.delete(wordId)).catch(() => undefined);
      }
      await task;
    },
  };
}
