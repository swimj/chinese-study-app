import { getPureCueResolution, pureCueIdentityOptions, PURE_CUE_RESOLUTION_CONTRACT, type PureCueResolution } from '../vocabulary/pure-cue-promotion.ts';
import { getVocabularyDefaultSelectionFinding,inheritVocabularyCaseSenseCoverage } from './vocabulary-sense-coverage.ts';
import { failPreparationAttempt } from '../vocabulary/preparation-retry.ts';
import { randomUUID } from 'node:crypto';
import { vocabularyAuthoredPromptBody,vocabularyPhraseClozeError } from '../../src/domain/vocabulary-production-coverage.ts';
import type { VocabularyActor, VocabularyJson, VocabularyContent } from '../../src/domain/vocabulary-content.ts';
import { VOCABULARY_COMPENSATION_POLICY, type VocabularySecondOpinion, type VocabularyReflectionCase, type VocabularyReflectionJob,
  type VocabularyFeedbackJudgmentInput, type VocabularyProposalDraft, type VocabularyContentProposal,
  type VocabularyAssessmentReview, type VocabularySenseLabel, type VocabularyProposalOperation, type VocabularyProposalApplication, type VocabularyImprovementResultInput, type VocabularyImprovementAdmission, type VocabularyPureCuePromotion, type VocabularyPureCueReferral, type VocabularyReflectionResult } from '../../src/domain/vocabulary-reflection.ts';
import { getEffectiveVocabularyEncounterReactions, type VocabularySessionProjection, type VocabularyEncounterEvidence } from '../../src/domain/vocabulary-session.ts';
import { config, getDb } from './connection.ts';
import { requireLearnerId } from './learner-context.ts';
import { isOperatorSubject, parseOperatorAllowlist } from '../operator-access.ts';
import { isVocabularyProviderEncounter } from '../vocabulary/reflection-eligibility.ts';
import { createVocabularyContent, updateVocabularyContent, replaceVocabularyContent, getVocabularySenseCatalog,
  getVocabularyContentForMaintenance, getVocabularySenses, emitBackendEvent } from './vocabulary-content.ts';
import { isOfferedReflectionModelChoice, type ReflectionModelChoice } from '../reflection/model-arms.ts';
import { resolveSharedDictionaryBaselineRevision } from './dictionary-baseline-sharing.ts';

export class VocabularyReflectionConflict extends Error {}
function atomic<T>(work: () => T): T {
  const db = getDb(), nested = db.isTransaction, point = `reflection_${randomUUID().replaceAll('-', '')}`;
  db.exec(nested ? `SAVEPOINT ${point}` : 'BEGIN IMMEDIATE');
  try { const result = work(); db.exec(nested ? `RELEASE ${point}` : 'COMMIT'); return result; }
  catch (error) { db.exec(nested ? `ROLLBACK TO ${point}` : 'ROLLBACK'); if (nested) db.exec(`RELEASE ${point}`); throw error; }
}
function timestamp(value = new Date().toISOString()): string {
  if (!Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) throw new Error('Expected canonical UTC timestamp');
  return value;
}
function nonempty(value: string): void { if (typeof value !== 'string' || !value.trim()) throw new Error('Expected nonempty identity or rationale'); }
function encode(value: unknown): string {
  const result = JSON.stringify(value);
  if (result === undefined) throw new Error('Expected JSON evidence');
  return result;
}
function operator(actorId: string): VocabularyActor {
  if (!isOperatorSubject(actorId, parseOperatorAllowlist(), config.authMode)) throw new Error('Operator access required');
  return { kind: 'operator', id: actorId };
}
function event(name: string, entityId: string, data: VocabularyJson, actor?: VocabularyActor): void {
  emitBackendEvent({ name, entityKind: 'reflection', entityId, data,
    actorKind: actor?.kind ?? 'service', actorId: actor?.id ?? 'vocabulary-reflection' });
}
function latestClosureTime(entityId: string, names: readonly string[]): string | null {
  const row = getDb().prepare(`SELECT occurred_at FROM backend_events
    WHERE entity_kind='reflection' AND entity_id=? AND name IN (${names.map(() => '?').join(',')})
    ORDER BY occurred_at DESC,recorded_at DESC,event_id DESC LIMIT 1`).get(entityId,...names) as { occurred_at: string } | undefined;
  return row?.occurred_at ?? null;
}
type CaseRow = { case_id: string; completion_id: string; learner_id: string; kind: VocabularyReflectionCase['kind'];
  word_id: string | null; content_id: string | null; status: VocabularyReflectionCase['status']; evidence_snapshot_json: string; created_at: string };
/** Internal private evidence reader. HTTP callers must establish operator authority before using it. */
export function getVocabularyReflectionCase(caseId: string): VocabularyReflectionCase {
  const row = getDb().prepare('SELECT * FROM reflection_cases WHERE case_id=?').get(caseId) as CaseRow | undefined;
  if (!row) throw new Error('Unknown vocabulary reflection case');
  const assessment=getDb().prepare('SELECT * FROM vocabulary_reflection_jobs WHERE case_id=?').get(caseId) as {reassessment_source_json?:string|null}|undefined;
  const pinned=assessment?.reassessment_source_json ? JSON.parse(assessment.reassessment_source_json) as VocabularyContent : null;
  return { caseId: row.case_id, completionId: row.completion_id, learnerId: row.learner_id, kind: row.kind,
    wordId: row.word_id, contentId: row.content_id, status: row.status,
    ...(pinned?{reassessmentSource:{contentId:pinned.contentId,version:pinned.version}}:{}),
    evidence: JSON.parse(row.evidence_snapshot_json) as VocabularyEncounterEvidence[], createdAt: row.created_at,
    resolvedAt: row.status === 'closed' ? latestClosureTime(caseId,['vocabulary.reflection.admission_case_closed','vocabulary.reflection.teaching_case_closed']) : null };
}
export function listVocabularyReflectionCases(kind: VocabularyReflectionCase['kind'], actorId: string): VocabularyReflectionCase[] {
  operator(actorId);
  return (getDb().prepare('SELECT c.case_id FROM reflection_cases c WHERE c.kind=? AND c.status=? AND NOT EXISTS (SELECT 1 FROM vocabulary_reflection_jobs j WHERE j.case_id=c.case_id AND j.second_opinion_json IS NOT NULL) ORDER BY c.created_at,c.case_id')
    .all(kind, 'open') as { case_id: string }[]).map(row => getVocabularyReflectionCase(row.case_id));
}
/** Completed original judgments without a proposal remain reviewable, including historical results. */
export function listVocabularyNoProposalCases(actorId: string, status: 'completed' | 'closed' = 'completed'): VocabularyReflectionCase[] {
  operator(actorId);
  const rows = getDb().prepare(`SELECT c.case_id FROM reflection_cases c
    JOIN vocabulary_reflection_jobs j ON j.case_id=c.case_id
    WHERE c.kind='exercise_improvement' AND c.status=? AND j.status='succeeded'
      AND j.second_opinion_json IS NULL AND json_type(j.result_json, '$.input.proposal')='null'
      AND NOT EXISTS (SELECT 1 FROM content_proposals p WHERE p.case_id=c.case_id)
    ORDER BY c.created_at DESC,c.case_id`).all(status) as {case_id:string}[];
  return rows.map(row=>getVocabularyReflectionCase(row.case_id));
}
function createCase(learnerId: string, completionId: string, kind: VocabularyReflectionCase['kind'], subjectKey: string,
  wordId: string | null, contentId: string | null, evidence: VocabularyEncounterEvidence[], at: string): string {
  const id = randomUUID(), db = getDb();
  db.prepare(`INSERT INTO reflection_cases(case_id,completion_id,learner_id,kind,subject_key,word_id,content_id,status,evidence_snapshot_json,created_at)
    VALUES (?,?,?,?,?,?,?,'open',?,?)`).run(id,completionId,learnerId,kind,subjectKey,wordId,contentId,encode(evidence),at);
  for (const item of evidence) db.prepare('INSERT INTO reflection_case_evidence(case_id,encounter_id,snapshot_json) VALUES (?,?,?)')
    .run(id,item.encounterId,encode(item));
  if (kind !== 'teaching_review') db.prepare(`INSERT INTO vocabulary_reflection_jobs
    (job_id,case_id,kind,dedupe_key,status,next_attempt_at,created_at) VALUES (?,?,?,?,'queued',?,?)`)
    .run(randomUUID(),id,kind,`${completionId}/${subjectKey}`,at,at);
  event('vocabulary.reflection.case_created',id,{ completionId, kind, subjectKey });
  return id;
}
/** Trusted service ingestion after closure. It never relies on current learner context. */
export function ingestVocabularySessionEvidence(learnerId: string, completionId: string, projection: VocabularySessionProjection, recordedAt = timestamp()): string[] {
  return atomic(() => {
    const db = getDb();
    const completion = db.prepare(`SELECT session_id,through_sequence,status,report_json FROM vocabulary_session_completions
      WHERE completion_id=? AND learner_id=?`).get(completionId,learnerId) as { session_id: string; through_sequence: number; status: string; report_json: string } | undefined;
    if (!completion || completion.status !== 'closed' || completion.session_id !== projection.sessionId
      || completion.through_sequence !== projection.throughSequence || completion.report_json !== encode(projection)) throw new Error('Reflection requires the exact closed completion boundary');
    const encoded = encode(projection), previous = db.prepare('SELECT projection_json FROM vocabulary_reflection_session_evidence WHERE completion_id=?')
      .get(completionId) as { projection_json: string } | undefined;
    if (previous) {
      if (previous.projection_json !== encoded) throw new VocabularyReflectionConflict('Completion evidence is immutable');
      return (db.prepare('SELECT case_id FROM reflection_cases WHERE completion_id=? ORDER BY case_id').all(completionId) as { case_id: string }[]).map(row => row.case_id);
    }
    const at = timestamp(recordedAt);
    db.prepare('INSERT INTO vocabulary_reflection_session_evidence VALUES (?,?,?,?,?)').run(completionId,learnerId,projection.sessionId,encoded,at);
    const rejected = (item: VocabularyEncounterEvidence) => item.responses.some(response => response.payload.outcome === 'rejected');
    const comment = (item: VocabularyEncounterEvidence) => getEffectiveVocabularyEncounterReactions(item).some(reaction => reaction.payload.feedback === 'comment' || !!reaction.payload.comment?.trim());
    const issue = (item: VocabularyEncounterEvidence) => rejected(item) || comment(item) || item.skipped
      || getEffectiveVocabularyEncounterReactions(item).some(reaction => reaction.payload.feedback === 'negative');
    const cases: string[] = [];
    const general = projection.encounters.filter(isVocabularyProviderEncounter);
    const wordIds = new Set(general.flatMap(item => item.wordId === null || item.snapshot.schedulingScope === 'pure_cue' ? [] : [item.wordId]));
    for (const wordId of wordIds) {
      const encounters = general.filter(item => item.wordId === wordId && item.snapshot.schedulingScope !== 'pure_cue');
      if (encounters.some(item => rejected(item) || comment(item))) cases.push(createCase(learnerId,completionId,'learner_feedback',`word/${wordId}`,wordId,null,encounters,at));
    }
    const pureIds = new Set(general.filter(item => item.snapshot.schedulingScope === 'pure_cue').map(item => item.snapshot.contentId));
    for (const contentId of pureIds) {
      const encounters = general.filter(item => item.snapshot.schedulingScope === 'pure_cue' && item.snapshot.contentId === contentId);
      if (encounters.some(item => rejected(item) || comment(item))) cases.push(createCase(learnerId,completionId,'learner_feedback',`pure/${contentId}`,null,contentId,encounters,at));
    }
    const exercises = new Map<string, VocabularyEncounterEvidence[]>();
    for (const encounter of general) {
      const key = JSON.stringify([encounter.snapshot.contentId, encounter.snapshot.contentVersion]);
      const encounters = exercises.get(key) ?? [];
      encounters.push(encounter);
      exercises.set(key, encounters);
    }
    for (const [key, encounters] of exercises) {
      if (!encounters.some(issue)) continue;
      const first = encounters[0]!;
      cases.push(createCase(learnerId,completionId,'exercise_improvement',`exercise/${key}`,
        first.wordId,first.snapshot.contentId,encounters,at));
    }
    for (const encounter of projection.encounters.filter(item => item.snapshot.role !== 'general' && issue(item))) {
      const teaching = projection.encounters.filter(item => item.snapshot.role !== 'general' && item.wordId === encounter.wordId);
      cases.push(createCase(learnerId,completionId,'teaching_review',`encounter/${encounter.encounterId}`,
        encounter.wordId,encounter.snapshot.contentId,teaching,at));
    }
    return cases;
  });
}

type JobRow = { job_id: string; case_id: string; kind: VocabularyReflectionJob['kind']; status: string; attempt_number: number;
  lease_token: string | null; lease_expires_at: string | null; result_json: string | null; second_opinion_json?: string | null; reassessment_source_job_id?: string | null; reassessment_source_json?: string | null };
function job(id: string): JobRow {
  const row = getDb().prepare('SELECT * FROM vocabulary_reflection_jobs WHERE job_id=?').get(id) as JobRow | undefined;
  if (!row) throw new Error('Unknown vocabulary reflection job'); return row;
}
function leased(jobId: string, leaseToken: string, at: string): JobRow {
  const row = job(jobId);
  if (row.status !== 'running' || row.lease_token !== leaseToken || row.lease_expires_at === null || row.lease_expires_at <= at) {
    throw new VocabularyReflectionConflict('Reflection lease is stale or expired');
  }
  return row;
}
export function recoverVocabularyReflectionJobs(at = timestamp()): number {
  timestamp(at);
  return Number(getDb().prepare(`UPDATE vocabulary_reflection_jobs SET status='failed',lease_token=NULL,lease_expires_at=NULL,
    next_attempt_at=?,last_error='provider_outcome_unknown' WHERE status='running' AND lease_expires_at<=?`).run(at,at).changes);
}
export function claimVocabularyReflectionJob(input: { kind?: VocabularyReflectionJob['kind']; now?: string; leaseMs?: number } = {}): VocabularyReflectionJob | null {
  return atomic(() => {
    const at = timestamp(input.now), leaseMs = input.leaseMs ?? 15 * 60 * 1000;
    if (!Number.isFinite(leaseMs) || leaseMs <= 0) throw new Error('Expected positive reflection lease duration');
    recoverVocabularyReflectionJobs(at);
    const row = getDb().prepare(`SELECT j.* FROM vocabulary_reflection_jobs j JOIN reflection_cases c ON c.case_id=j.case_id
      JOIN learners l ON l.learner_id=c.learner_id WHERE j.status='queued' AND j.next_attempt_at<=?
      AND (? IS NULL OR j.kind=?) AND l.disabled_at IS NULL ORDER BY j.created_at,j.job_id LIMIT 1`)
      .get(at,input.kind ?? null,input.kind ?? null) as JobRow | undefined;
    if (!row) return null;
    const token = randomUUID(), expires = new Date(Date.parse(at)+leaseMs).toISOString();
    getDb().prepare(`UPDATE vocabulary_reflection_jobs SET status='running',lease_token=?,lease_expires_at=?,
      attempt_number=attempt_number+1,last_error=NULL WHERE job_id=?`).run(token,expires,row.job_id);
    const evidence = getVocabularyReflectionCase(row.case_id);
    return { jobId: row.job_id,caseId: row.case_id,learnerId: evidence.learnerId,kind: row.kind,
      attemptNumber: row.attempt_number+1,leaseToken: token,leaseExpiresAt: expires,evidence,
      ...(row.reassessment_source_json ? { reassessmentSource: JSON.parse(row.reassessment_source_json) as VocabularyContent } : {}),
      ...(row.reassessment_source_job_id ? { reassessmentSourceJobId: row.reassessment_source_job_id } : {}),
      ...(row.second_opinion_json ? { secondOpinion: JSON.parse(row.second_opinion_json) as VocabularyReflectionJob['secondOpinion'] } : {}) };
  });
}
function completedRetry(jobId: string, token: string, input: unknown): { output: unknown } | null {
  const row = job(jobId);
  if (row.status !== 'succeeded') return null;
  const result = JSON.parse(row.result_json!) as { input: unknown; output: unknown };
  if (row.lease_token !== token || encode(result.input) !== encode(input)) throw new VocabularyReflectionConflict('Completed reflection result differs from retry');
  return { output: result.output };
}
function finish(jobId: string, token: string, input: unknown, output: unknown, at: string): void {
  leased(jobId,token,at);
  getDb().prepare(`UPDATE vocabulary_reflection_jobs SET status='succeeded',lease_expires_at=NULL,result_json=? WHERE job_id=?`)
    .run(encode({ input,output }),jobId);
  getDb().prepare("UPDATE reflection_cases SET status='completed' WHERE case_id=?").run(job(jobId).case_id);
}
/** A successful job must commit its typed judgment/output in the same transaction. */
export function finishVocabularyReflectionJob(jobId: string, token: string, result: VocabularyReflectionResult, at = timestamp()):
  { judgmentId: string; messageId: string | null } | { judgmentId: string; proposalId: string | null } {
  return result.kind === 'learner_feedback' ? recordVocabularyFeedbackJudgment(jobId,token,result.judgment,at)
    : recordVocabularyImprovementResult(jobId,token,result.result,at);
}
export function failVocabularyReflectionJob(jobId: string, token: string, failureCode: string, retryAt: string, at = timestamp()): void {
  nonempty(failureCode); timestamp(retryAt); timestamp(at);
  atomic(() => {
    leased(jobId,token,at);
    getDb().prepare(`UPDATE vocabulary_reflection_jobs SET status='failed',last_error=?,next_attempt_at=?,lease_token=NULL,
      lease_expires_at=NULL WHERE job_id=?`).run(failureCode,retryAt,jobId);
  });
}
/** Persist backoff and provider transition under the same lease as the failed call. */
export function failVocabularySenseMappingCall(jobId: string, token: string, at = timestamp()): void {
  timestamp(at);
  atomic(() => {
    leased(jobId,token,at);
    const row = getDb().prepare('SELECT sense_mapping_availability_failures AS failures FROM vocabulary_reflection_jobs WHERE job_id=?')
      .get(jobId) as {failures:number};
    if (row.failures >= 6) throw new Error('Sense mapping retry budget is already exhausted');
    const failures = row.failures + 1;
    // Switch to ZAI immediately after Luna's third failure. Each provider's
    // remaining attempts use the same 30/60-second backoff.
    const delay = failures === 3 || failures === 6 ? 0 : failures % 3 === 1 ? 30_000 : 60_000;
    getDb().prepare(`UPDATE vocabulary_reflection_jobs SET sense_mapping_availability_failures=?,status=?,last_error=?,
      next_attempt_at=?,lease_token=NULL,lease_expires_at=NULL WHERE job_id=?`)
      .run(failures,failures < 6 ? 'queued' : 'failed',failures < 6 ? null : 'sense_mapping_unavailable',
        new Date(Date.parse(at)+delay).toISOString(),jobId);
  });
}
/** Recover a crashed sense prerequisite without retrying an unrelated reflection provider call. */
export function recoverVocabularySenseDependencies(at=timestamp()):number {
  timestamp(at);
  return atomic(()=>{
    let recovered=0;
    for(const kind of ['sense','selection'] as const){
      const table=kind==='sense'?'vocabulary_sense_readiness':'vocabulary_default_selection_readiness';
      // A completed/failed prerequisite is not proof that a live content call depends on it.
      // Recover its caller only after the caller lease expires; a running prerequisite's
      // own expired lease remains sufficient evidence of an interrupted dependency.
      const rows=getDb().prepare(`SELECT j.job_id,s.word_id,s.status,s.active_token FROM vocabulary_reflection_jobs j JOIN ${table} s ON s.workflow_id=j.job_id WHERE j.status='running' AND ((s.status='running' AND s.expires_at<=?) OR (j.lease_expires_at<=? AND s.status IN ('queued','failed')))`).all(at,at) as {job_id:string;word_id:string;status:string;active_token:string|null}[];
      for(const row of rows){
        if(row.status==='running')failPreparationAttempt(kind,row.word_id,row.active_token!,at,'interrupted_unknown_outcome',{interrupted:true});
        const state=getDb().prepare(`SELECT status,next_attempt_at FROM ${table} WHERE word_id=?`).get(row.word_id) as {status:string;next_attempt_at:string};
        // Selector attention is finalized as needs_coverage by the normal admission path.
        const resume=state.status==='queued'||kind==='selection';
        getDb().prepare("UPDATE vocabulary_reflection_jobs SET status=?,next_attempt_at=?,last_error=?,lease_token=NULL,lease_expires_at=NULL WHERE job_id=? AND status='running'").run(resume?'queued':'failed',state.next_attempt_at,resume?null:'sense_preparation_failed',row.job_id);
      }
      recovered+=rows.length;
    }
    return recovered;
  });
}
/** Sense preparation owns its retry budget. Defer the dependent reflection without a provider failure. */
export function deferVocabularyReflectionForSense(jobId:string,token:string,retryAt:string,at=timestamp()):void {
  timestamp(retryAt);timestamp(at);
  atomic(()=>{
    leased(jobId,token,at);
    getDb().prepare(`UPDATE vocabulary_reflection_jobs SET status='queued',next_attempt_at=?,last_error=NULL,
      lease_token=NULL,lease_expires_at=NULL WHERE job_id=?`).run(retryAt,jobId);
  });
}
function compensate(evidence: VocabularyReflectionCase, judgmentId: string, input: VocabularyFeedbackJudgmentInput, at: string): void {
  const unfair = new Set(input.unfairEncounterIds);
  if ([...unfair].some(id => !evidence.evidence.some(encounter => encounter.encounterId === id))) throw new Error('Unfair judgment references unknown encounter');
  const pure = evidence.wordId === null;
  // V1 compensates production only. Recognition and contrast remain lesson evidence,
  // but their independent schedules must neither trigger nor veto this adjustment.
  const effectiveRejected = evidence.evidence.filter(encounter =>
    encounter.snapshot.role === 'general' && encounter.snapshot.kind === 'production'
    && (pure ? encounter.snapshot.schedulingScope === 'pure_cue' : encounter.snapshot.schedulingScope !== 'pure_cue')
    && (pure ? encounter.snapshot.contentId === evidence.contentId : encounter.wordId === evidence.wordId)
    && encounter.effectiveResponses.some(response => response.payload.outcome === 'rejected'));
  // Mixed genuine/unfair failures retain the conservative current schedule.
  if (effectiveRejected.length === 0 || effectiveRejected.some(encounter => !unfair.has(encounter.encounterId))) return;
  if (!pure) {
    const completion = getDb().prepare(`SELECT report_json FROM vocabulary_session_completions
      WHERE completion_id=? AND learner_id=? AND status='closed'`)
      .get(evidence.completionId,evidence.learnerId) as { report_json: string } | undefined;
    if (!completion) throw new Error('Feedback compensation requires its original closed completion');
    const word = (JSON.parse(completion.report_json) as VocabularySessionProjection).words[evidence.wordId!];
    if (!word) throw new Error('Feedback word is missing from its original completion');
    // Later study must not make unfinished work in this session eligible for compensation.
    if (!word.covered) return;
  }
  const table = pure ? 'learner_pure_cue_schedules' : 'learner_word_schedules';
  const column = pure ? 'content_id' : 'word_id';
  const subject = pure ? evidence.contentId! : evidence.wordId!;
  const row = getDb().prepare(`SELECT next_eligible_at,state_version,scheduler_state_json FROM ${table} WHERE learner_id=? AND ${column}=?`)
    .get(evidence.learnerId,subject) as { next_eligible_at: string | null; state_version: number; scheduler_state_json:string } | undefined;
  if (!row) throw new Error('Feedback compensation requires an existing subject schedule');
  if (!pure) {
    const refresh = getDb().prepare('SELECT refresh_until FROM learner_word_schedules WHERE learner_id=? AND word_id=?')
      .get(evidence.learnerId,subject) as { refresh_until: string | null };
    // The existing durable request event distinguishes an explicit refresh from the
    // automatic refresh that the unfair lapse itself may have caused at closure.
    if (refresh.refresh_until !== null && refresh.refresh_until > at
      && getDb().prepare(`SELECT 1 FROM backend_events WHERE name='vocabulary.refresh.requested'
        AND learner_id=? AND entity_kind='word' AND entity_id=? AND json_extract(data_json,'$.until')=? LIMIT 1`)
        .get(evidence.learnerId,subject,refresh.refresh_until)) return;
  }
  const key = `${VOCABULARY_COMPENSATION_POLICY.version}/${evidence.completionId}/${pure ? 'pure' : 'word'}/${subject}`;
  if (getDb().prepare('SELECT 1 FROM learner_state_effects WHERE effect_key=?').get(key)) return;
  const before = row.next_eligible_at;
  const after = before === null ? null
    : new Date(Date.parse(before)+VOCABULARY_COMPENSATION_POLICY.maximumDelayMs).toISOString();
  const scheduler=JSON.parse(row.scheduler_state_json) as Record<string,VocabularyJson>;
  const adjusted=pure&&after!==null?{...scheduler,resetUntil:typeof scheduler.resetUntil==='string'&&scheduler.resetUntil>after?scheduler.resetUntil:after}:scheduler;
  if (before !== after || encode(scheduler)!==encode(adjusted)) getDb().prepare(`UPDATE ${table} SET next_eligible_at=?,scheduler_state_json=?,state_version=state_version+1 WHERE learner_id=? AND ${column}=?`)
    .run(after,encode(adjusted),evidence.learnerId,subject);
  getDb().prepare(`INSERT INTO learner_state_effects(effect_id,learner_id,word_id,pure_cue_content_id,completion_id,judgment_id,
    effect_key,kind,before_json,after_json,applied_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(randomUUID(),evidence.learnerId,
      evidence.wordId,pure ? evidence.contentId : null,evidence.completionId,judgmentId,key,'unfair_feedback_compensation',
      encode({ nextEligibleAt: before,...(pure?{schedulerState:scheduler}:{}),policy: VOCABULARY_COMPENSATION_POLICY.version }),encode({ nextEligibleAt: after,...(pure?{schedulerState:adjusted}:{}) }),at);
  event('vocabulary.reflection.compensation_applied',judgmentId,{ effectKey: key, before, after });
}
export function recordVocabularyFeedbackJudgment(jobId: string, token: string, input: VocabularyFeedbackJudgmentInput, at = timestamp()): { judgmentId: string; messageId: string | null } {
  return atomic(() => {
    timestamp(at);
    const previous = completedRetry(jobId,token,input);
    if (previous !== null) return previous.output as { judgmentId: string; messageId: string | null };
    const row = leased(jobId,token,at), evidence = getVocabularyReflectionCase(row.case_id);
    if (row.kind !== 'learner_feedback') throw new Error('Only feedback judgment owns compensation');
    const judgmentId = randomUUID(), messageId = input.message === null ? null : randomUUID();
    getDb().prepare('INSERT INTO teacher_judgments VALUES (?,?,?,?,?,?)').run(judgmentId,row.case_id,jobId,input.invocationId ?? null,encode(input.diagnosis),at);
    if (messageId !== null) getDb().prepare(`INSERT INTO learner_messages(message_id,learner_id,case_id,judgment_id,source_key,body_json,created_at)
      VALUES (?,?,?,?,?,?,?)`).run(messageId,evidence.learnerId,evidence.caseId,judgmentId,`feedback/${jobId}`,encode(input.message),at);
    compensate(evidence,judgmentId,input,at);
    const output = { judgmentId,messageId }; finish(jobId,token,input,output,at);
    event('vocabulary.reflection.feedback_recorded',judgmentId,{ caseId: evidence.caseId,messageId }); return output;
  });
}
type FeedbackSubjectRow = { word_id: string | null; hanzi: string | null; evidence_snapshot_json: string };
function feedbackSubjectLabel(row: FeedbackSubjectRow): string {
  if (row.word_id !== null) {
    if (!row.hanzi) throw new Error('Feedback word is missing its written form');
    return row.hanzi;
  }
  const evidence = JSON.parse(row.evidence_snapshot_json) as VocabularyEncounterEvidence[];
  return evidence[0]?.snapshot.body.prompt.trim() || 'Shared expression';
}
export function listOwnVocabularyMessages(): { messageId: string; caseId: string; subjectLabel: string; body: VocabularyJson; createdAt: string; seenAt: string | null; dismissedAt: string | null }[] {
  return (getDb().prepare(`SELECT m.*,c.word_id,c.evidence_snapshot_json,w.hanzi FROM learner_messages m
    JOIN reflection_cases c ON c.case_id=m.case_id AND c.learner_id=m.learner_id
    LEFT JOIN lexical_words w ON w.id=c.word_id WHERE m.learner_id=? ORDER BY m.created_at,m.message_id`).all(requireLearnerId()) as (FeedbackSubjectRow & {
    message_id: string; case_id: string; body_json: string; created_at: string; seen_at: string | null; dismissed_at: string | null })[])
    .map(row => ({ messageId: row.message_id,caseId: row.case_id,subjectLabel: feedbackSubjectLabel(row),body: JSON.parse(row.body_json) as VocabularyJson,createdAt: row.created_at,seenAt: row.seen_at,dismissedAt: row.dismissed_at }));
}
export function listOwnVocabularyFeedbackJobs(): { jobId: string; caseId: string; subjectLabel: string; status: 'queued' | 'running' | 'failed'; createdAt: string; error: string | null }[] {
  return (getDb().prepare(`SELECT j.job_id,j.case_id,j.status,j.created_at,j.last_error,c.word_id,c.evidence_snapshot_json,w.hanzi
    FROM vocabulary_reflection_jobs j JOIN reflection_cases c ON c.case_id=j.case_id
    LEFT JOIN lexical_words w ON w.id=c.word_id
    WHERE c.learner_id=? AND j.kind='learner_feedback' AND j.status IN ('queued','running','failed') ORDER BY j.created_at,j.job_id`)
    .all(requireLearnerId()) as (FeedbackSubjectRow & { job_id: string; case_id: string; status: 'queued' | 'running' | 'failed'; created_at: string; last_error: string | null })[])
    .map(row => ({ jobId: row.job_id,caseId: row.case_id,subjectLabel: feedbackSubjectLabel(row),status: row.status,createdAt: row.created_at,
      error: row.status === 'failed' ? feedbackFailureMessage(row.last_error) : null }));
}
export function markOwnVocabularyMessageSeen(messageId: string, at = timestamp()): void {
  const learnerId = requireLearnerId(); timestamp(at);
  const result = getDb().prepare('UPDATE learner_messages SET seen_at=COALESCE(seen_at,?) WHERE message_id=? AND learner_id=?').run(at,messageId,learnerId);
  if (result.changes !== 1) throw new Error('Message does not belong to current learner');
}

export function dismissOwnVocabularyMessage(messageId: string, at = timestamp()): void {
  const learnerId = requireLearnerId(); timestamp(at);
  const result = getDb().prepare('UPDATE learner_messages SET dismissed_at=COALESCE(dismissed_at,?) WHERE message_id=? AND learner_id=?').run(at,messageId,learnerId);
  if (result.changes !== 1) throw new Error('Message does not belong to current learner');
}
export function restoreOwnVocabularyMessage(messageId: string): void {
  const result = getDb().prepare('UPDATE learner_messages SET dismissed_at=NULL WHERE message_id=? AND learner_id=?').run(messageId,requireLearnerId());
  if (result.changes !== 1) throw new Error('Message does not belong to current learner');
}

type ProposalRow = { proposal_id: string; case_id: string | null; version: number; status: VocabularyContentProposal['status'];
  operations_json: string; rationale: string; author_kind: 'operator' | 'service'; author_id: string; invocation_id: string | null };
function proposal(proposalId: string): VocabularyContentProposal {
  const row = getDb().prepare('SELECT * FROM content_proposals WHERE proposal_id=?').get(proposalId) as ProposalRow | undefined;
  if (!row) throw new Error('Unknown vocabulary content proposal');
  const bases = getDb().prepare(`SELECT content_id AS contentId,expected_content_version AS expectedVersion
    FROM proposal_content_bases WHERE proposal_id=? ORDER BY content_id`).all(proposalId) as VocabularyContentProposal['bases'];
  return { proposalId: row.proposal_id,caseId: row.case_id,version: row.version,status: row.status,
    operations: JSON.parse(row.operations_json) as VocabularyProposalOperation[],rationale: row.rationale,
    authorKind: row.author_kind,authorId: row.author_id,invocationId: row.invocation_id,bases };
}
function withProposalResolution(value: VocabularyContentProposal): VocabularyContentProposal {
  let resolvedAt: string | null = null;
  if (value.status === 'applied') {
    const row = getDb().prepare('SELECT applied_at FROM proposal_applications WHERE proposal_id=? AND proposal_version=?')
      .get(value.proposalId,value.version) as { applied_at: string } | undefined;
    resolvedAt = row?.applied_at ?? null;
  } else if (value.status === 'closed') resolvedAt = latestClosureTime(value.proposalId,['vocabulary.reflection.proposal_closed']);
  return { ...value,resolvedAt };
}
export function getVocabularyProposal(proposalId: string, actorId: string): VocabularyContentProposal { operator(actorId); return withProposalResolution(proposal(proposalId)); }
function validateNonreplacementSource(operation:VocabularyProposalOperation,source:VocabularyContent):void {
  if(operation.strategy!=='retire')return;
  if(source.kind!=='exercise'||source.exerciseRole!=='general'||source.skill!=='production'||source.availability!=='active')throw new Error('Drop actions require an active general production exercise');
}
function baseVersions(draft: VocabularyProposalDraft): VocabularyContentProposal['bases'] {
  const bases = new Map<string,number>(), keys = new Set<string>(), produced = new Map<string,number>();
  const add = (id: string,version: number) => {
    nonempty(id);
    if (!Number.isSafeInteger(version) || version < 1) throw new Error('Expected positive proposal base version');
    if (bases.has(id) && bases.get(id) !== version) throw new Error('Conflicting proposal base versions');
    bases.set(id,version);
  };
  nonempty(draft.rationale);
  if (!draft.operations.length) throw new Error('Proposal requires at least one operation');
  const sources = new Set<string>();
  for (const operation of draft.operations) {
    nonempty(operation.operationKey); nonempty(operation.rationale);
    if (keys.has(operation.operationKey)) throw new Error('Duplicate proposal operation key'); keys.add(operation.operationKey);
    const content = operation.content;
    if(operation.strategy!=='retire'){const clozeError=vocabularyPhraseClozeError(content.body);if(clozeError)throw new Error(clozeError);}
    if (operation.scope.kind === 'shared') {
      if (content.accessScope !== 'shared' || content.ownerLearnerId != null) throw new Error('Shared scope must match authored content');
    } else if (operation.scope.kind === 'learner') {
      nonempty(operation.scope.learnerId);
      if (content.accessScope !== 'private' || content.ownerLearnerId !== operation.scope.learnerId) throw new Error('Learner scope must preserve private ownership');
    } else throw new Error('Unknown proposal effect scope');
    if (operation.strategy !== 'create') {
      if (!['update_existing','replace','retire'].includes(operation.strategy)) throw new Error('Unknown proposal strategy');
      if (sources.has(operation.sourceContentId)) throw new Error('Proposal cannot write a source twice'); sources.add(operation.sourceContentId);
      add(operation.sourceContentId,operation.expectedVersion);
      const source = getVocabularyContentForMaintenance(operation.sourceContentId);
      if (!source || source.accessScope !== content.accessScope || (source.ownerLearnerId ?? null) !== (content.ownerLearnerId ?? null)) {
        throw new Error('Repair cannot broaden or transfer content ownership');
      }
      validateNonreplacementSource(operation,source);

    }
    if (operation.strategy!=='retire'&&content.kind === 'introduction') for (const binding of content.teachingExercises) {
      // Only an explicitly named version produced by an earlier ordered operation
      // can satisfy a future teaching binding. Its pre-state source remains a base.
      if(produced.get(binding.exerciseId)!==binding.exerciseVersion)add(binding.exerciseId,binding.exerciseVersion);
    }
    if(operation.strategy!=='create')produced.set(operation.sourceContentId,operation.expectedVersion+1);
    if((operation.strategy==='create'||operation.strategy==='replace')&&content.contentId)produced.set(content.contentId,1);
  }
  for (const base of draft.bases ?? [])if(produced.get(base.contentId)!==base.expectedVersion)add(base.contentId,base.expectedVersion);
  return [...bases].map(([contentId,expectedVersion]) => ({ contentId,expectedVersion })).sort((a,b) => a.contentId.localeCompare(b.contentId));
}
function persistProposal(value: VocabularyContentProposal, actor: VocabularyActor, at: string): VocabularyContentProposal {
  const db = getDb();
  db.prepare(`INSERT INTO content_proposals(proposal_id,case_id,version,status,operations_json,rationale,author_kind,author_id,invocation_id,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(proposal_id) DO UPDATE SET version=excluded.version,status=excluded.status,
    operations_json=excluded.operations_json,rationale=excluded.rationale,updated_at=excluded.updated_at`)
    .run(value.proposalId,value.caseId,value.version,value.status,encode(value.operations),value.rationale,value.authorKind,value.authorId,value.invocationId,at,at);
  db.prepare('DELETE FROM proposal_content_bases WHERE proposal_id=?').run(value.proposalId);
  for (const base of value.bases) db.prepare('INSERT INTO proposal_content_bases VALUES (?,?,?)').run(value.proposalId,base.contentId,base.expectedVersion);
  db.prepare('INSERT INTO proposal_revision_history VALUES (?,?,?,?,?,?)').run(value.proposalId,value.version,encode(value),actor.kind,actor.id,at);
  return value;
}
function createProposal(draft: VocabularyProposalDraft, actor: VocabularyActor, at: string): VocabularyContentProposal {
  if (draft.caseId) {
    const evidence = getVocabularyReflectionCase(draft.caseId);
    if (evidence.kind === 'learner_feedback') throw new Error('Feedback cases do not create content proposals');
  }
  return persistProposal({ proposalId: randomUUID(),caseId: draft.caseId ?? null,version: 1,status: 'awaiting_review',
    operations: draft.operations,rationale: draft.rationale,bases: baseVersions(draft),invocationId: draft.invocationId ?? null,
    authorKind: actor.kind,authorId: actor.id },actor,at);
}
/** Operator/manual authoring uses the same proposal and approval machinery as generated repairs. */
export function createVocabularyProposal(draft: VocabularyProposalDraft, actorId: string): VocabularyContentProposal {
  const actor = operator(actorId); return atomic(() => createProposal(draft,actor,timestamp()));
}
export function recordVocabularyImprovementResult(jobId: string, token: string, input: VocabularyImprovementResultInput, at = timestamp()): { judgmentId: string; proposalId: string | null } {
  return atomic(() => {
    timestamp(at);
    const previous = completedRetry(jobId,token,input);
    if (previous !== null) return previous.output as { judgmentId: string; proposalId: string | null };
    const row = leased(jobId,token,at);
    if (row.kind !== 'exercise_improvement') throw new Error('Improvement result requires improvement job');
    if (row.second_opinion_json) {
      if (!input.secondOpinion || !['support','revise','reject'].includes(input.secondOpinion.verdict)
        || !input.secondOpinion.rationale.trim() || input.proposal !== null) throw new Error('Second opinion requires an advisory verdict only');
    } else if (input.secondOpinion) throw new Error('Second opinion requires a requested review job');
    const pinned=row.reassessment_source_json ? JSON.parse(row.reassessment_source_json) as VocabularyContent : null;
    if(row.reassessment_source_job_id||pinned) {
      const current=pinned?getVocabularyContentForMaintenance(pinned.contentId):null;
      if(!pinned||!current||current.version!==pinned.version||current.availability!=='active')throw new VocabularyReflectionConflict('Reassessment source version changed before publication');
    }
    const needsAttention = input.admission?.outcome === 'unmappable' || input.admission?.outcome === 'inventory_gap' || input.admission?.outcome === 'needs_coverage';
    if (input.admission) {
      const evidence = getVocabularyReflectionCase(row.case_id), admission = input.admission;
      if (admission.wordId !== evidence.wordId || !(pinned ? pinned.contentId===admission.sourceContentId && pinned.version===admission.sourceContentVersion : evidence.evidence.some(item => {
        if (item.snapshot.contentId !== admission.sourceContentId) return false;
        if (item.snapshot.contentVersion === admission.sourceContentVersion) return true;
        const historical = getDb().prepare('SELECT snapshot_json FROM content_revision_history WHERE content_id=? AND version=?')
          .get(item.snapshot.contentId,item.snapshot.contentVersion) as {snapshot_json:string}|undefined;
        if (!historical) return false;
        const content = JSON.parse(historical.snapshot_json) as VocabularyContent;
        if (content.accessScope === 'private' && content.ownerLearnerId !== evidence.learnerId) return false;
        const resolved = resolveSharedDictionaryBaselineRevision(getDb(),content);
        return resolved.contentId === admission.sourceContentId && resolved.version === admission.sourceContentVersion;
      }))) {
        throw new Error('Improvement admission must describe the source encounter');
      }
      if (needsAttention && input.proposal !== null) throw new Error('Unresolved sense admission cannot propose automatic repairs');
    }
    const judgmentId = randomUUID();
    getDb().prepare('INSERT INTO teacher_judgments VALUES (?,?,?,?,?,?)').run(judgmentId,row.case_id,jobId,input.invocationId ?? null,encode(input.diagnosis),at);
    const created = input.proposal === null ? null : createProposal({ ...input.proposal,caseId: row.case_id,
      invocationId: input.proposal.invocationId ?? input.invocationId },{ kind: 'service',id: 'vocabulary-reflection' },at);
    const output = { judgmentId,proposalId: created?.proposalId ?? null };
    finish(jobId,token,input,output,at);
    if (needsAttention || input.pureCuePromotion?.outcome === 'needs_operator') getDb().prepare("UPDATE reflection_cases SET status='open' WHERE case_id=?").run(row.case_id);
    return output;
  });
}
function expectedProposal(id: string, version: number): VocabularyContentProposal {
  const value = proposal(id);
  if (value.version !== version) throw new VocabularyReflectionConflict('Proposal version changed; review the current preview');
  return value;
}
export function saveVocabularyProposal(proposalId: string, expectedVersion: number, draft: VocabularyProposalDraft, actorId: string): VocabularyContentProposal {
  const actor = operator(actorId);
  return atomic(() => {
    const value = expectedProposal(proposalId,expectedVersion);
    if (value.status === 'applied' || value.status === 'closed') throw new VocabularyReflectionConflict('Resolved proposals cannot be edited');
    if ((draft.caseId ?? value.caseId) !== value.caseId) throw new Error('Proposal evidence origin is immutable');
    return persistProposal({ ...value,version: value.version+1,status: 'awaiting_review',operations: draft.operations,
      rationale: draft.rationale,bases: baseVersions({...draft,caseId:value.caseId??undefined}) },actor,timestamp());
  });
}
/** Read-only freshness for queue display; validation remains authoritative at approval/application. */
export function vocabularyProposalCoverageChanged(value:VocabularyContentProposal):boolean {
  if(value.bases.some(base=>getVocabularyContentForMaintenance(base.contentId)?.version!==base.expectedVersion))return true;
  const admission=value.authorKind==='service'&&value.caseId?caseAdmission(value.caseId):undefined;
  if(!admission)return false;
  const source=getVocabularyContentForMaintenance(admission.sourceContentId);
  const mapping=source?.words.find(word=>word.wordId===admission.wordId);
  // Serving policy edits do not alter the assessment's captured generation scope.
  return getVocabularySenseCatalog(admission.wordId).version!==admission.catalogVersion
    ||!source||!mapping
    ||!!(admission.sourceMapping&&((mapping.senseId??null)!==admission.sourceMapping.senseId
      ||(mapping.senseMappingEstablishedAt??null)!==admission.sourceMapping.establishedAt));
}
function currentBases(value: VocabularyContentProposal): void {
  for (const base of value.bases) {
    const content = getVocabularyContentForMaintenance(base.contentId);
    if (!content || content.version !== base.expectedVersion) throw new VocabularyReflectionConflict('Proposal content base changed; revise and review again');
  }
  const admission=value.authorKind==='service'&&value.caseId?caseAdmission(value.caseId):undefined;
  if(admission) {
    const source=getVocabularyContentForMaintenance(admission.sourceContentId);
    const mapping=source?.words.find(word=>word.wordId===admission.wordId);
    // A generation's sense IDs are immutable inputs. Serving defaults may
    // change independently; historical coverage fingerprints are audit only.
    if(getVocabularySenseCatalog(admission.wordId).version!==admission.catalogVersion
      ||!mapping||(admission.sourceMapping&&((mapping.senseId??null)!==admission.sourceMapping.senseId
        ||(mapping.senseMappingEstablishedAt??null)!==admission.sourceMapping.establishedAt))) {
      throw new VocabularyReflectionConflict('Proposal sense evidence changed; close this proposal and reassess the current source');
    }
  }
}
type OperationPreview={operationKey:string;source:VocabularyContent|null;result:VocabularyContent};
/** Preview and application execute the same domain transition; preview owns a rollback savepoint. */
function executeOperation(operation:VocabularyProposalOperation,actor:VocabularyActor):OperationPreview {
  const source=operation.strategy==='create'?null:getVocabularyContentForMaintenance(operation.sourceContentId);
  if(operation.strategy!=='create'&&!source)throw new Error('Unknown vocabulary content');
  if(operation.strategy!=='create'&&source!.version!==operation.expectedVersion)throw new VocabularyReflectionConflict('Proposal content base changed; revise and review again');
  if(source)validateNonreplacementSource(operation,source);
  const result=operation.strategy==='create'?createVocabularyContent(operation.content,actor)
    :operation.strategy==='update_existing'?updateVocabularyContent(operation.sourceContentId,operation.expectedVersion,operation.content,actor)
    :operation.strategy==='retire'?updateVocabularyContent(operation.sourceContentId,operation.expectedVersion,{...source!,availability:'retired'},actor)
    :replaceVocabularyContent(operation.sourceContentId,operation.expectedVersion,operation.content,actor).replacement;
  return {operationKey:operation.operationKey,source,result};
}
function executeOperations(value:VocabularyContentProposal,actorFor:(operation:VocabularyProposalOperation)=>VocabularyActor):OperationPreview[] {
  return value.operations.map(operation=>executeOperation(operation,actorFor(operation)));
}
function previewWrites(value:VocabularyContentProposal,actor:VocabularyActor):OperationPreview[] {
  const db=getDb(),point=`preview_${randomUUID().replaceAll('-','')}`;db.exec(`SAVEPOINT ${point}`);
  try {
    const previews=executeOperations(value,()=>actor);
    if(db.prepare('PRAGMA foreign_key_check').all().length)throw new Error('Proposed content has invalid relationships');
    return previews;
  }finally{db.exec(`ROLLBACK TO ${point}`);db.exec(`RELEASE ${point}`);}
}
export function previewVocabularyProposal(proposalId: string, expectedVersion: number, actorId: string): {
  proposal: VocabularyContentProposal; previews:OperationPreview[]; operations: { operationKey: string; strategy: VocabularyProposalOperation['strategy'];
    scope: VocabularyProposalOperation['scope']; schedulesRemainOnSource: number; deactivationsRemainOnSource: number;
    teachingBindingsRemainOnSource: number; sourceSenseMappings: number; sourceCurations: number;
    sourceIntroductionExercises: number; transfersRelationships: false }[];
} {
  operator(actorId);
  const value = expectedProposal(proposalId,expectedVersion); currentBases(value);
  const count = (table: string,column: string,id: string) => Number(getDb().prepare(`SELECT count(*) n FROM ${table} WHERE ${column}=?`).get(id)!.n);
  const previews=previewWrites(value,operator(actorId));
  return { proposal: value,previews,operations: value.operations.map(operation => ({ operationKey: operation.operationKey,strategy: operation.strategy,
    scope: operation.scope,schedulesRemainOnSource: operation.strategy === 'create' ? 0 : count('learner_pure_cue_schedules','content_id',operation.sourceContentId),
    deactivationsRemainOnSource: operation.strategy === 'create' ? 0 : count('learner_content_deactivations','content_id',operation.sourceContentId),
    teachingBindingsRemainOnSource: operation.strategy === 'create' ? 0 : count('introduction_exercises','exercise_id',operation.sourceContentId),
    sourceSenseMappings: operation.strategy === 'create' ? 0 : count('content_words','content_id',operation.sourceContentId),
    sourceCurations: operation.strategy === 'create' ? 0 : count('content_mode_suitability','content_id',operation.sourceContentId),
    sourceIntroductionExercises: operation.strategy === 'create' ? 0 : count('introduction_exercises','introduction_id',operation.sourceContentId),transfersRelationships: false })) };
}
export function approveVocabularyProposal(proposalId: string, expectedVersion: number, actorId: string, notes: VocabularyJson = null): string {
  const actor = operator(actorId);
  return atomic(() => {
    const value = expectedProposal(proposalId,expectedVersion);
    if (!['draft','awaiting_review','approved'].includes(value.status)) throw new VocabularyReflectionConflict('Proposal cannot be approved');
    currentBases(value);previewWrites(value,actor);
    const id = randomUUID();
    getDb().prepare('INSERT INTO proposal_reviews VALUES (?,?,?,?,?,?,?)').run(id,proposalId,expectedVersion,actorId,'approved',encode(notes),timestamp());
    getDb().prepare("UPDATE content_proposals SET status='approved' WHERE proposal_id=?").run(proposalId);
    event('vocabulary.reflection.proposal_approved',proposalId,{ version: expectedVersion, reviewId: id },actor); return id;
  });
}
export function closeVocabularyProposal(proposalId: string, expectedVersion: number, actorId: string, reason = ''): void {
  const actor = operator(actorId);
  if (typeof reason !== 'string') throw new TypeError('Expected text reason');
  atomic(() => {
    const value = expectedProposal(proposalId,expectedVersion);
    if (value.status === 'applied' || value.status === 'closed') throw new VocabularyReflectionConflict('Proposal is already resolved');
    getDb().prepare('INSERT INTO proposal_reviews VALUES (?,?,?,?,?,?,?)').run(randomUUID(),proposalId,expectedVersion,actorId,'rejected',encode({ reason }),timestamp());
    getDb().prepare("UPDATE content_proposals SET status='closed' WHERE proposal_id=?").run(proposalId);
    event('vocabulary.reflection.proposal_closed',proposalId,{ version: expectedVersion,reason },actor);
  });
}
export function applyVocabularyProposal(proposalId: string, expectedVersion: number, reviewId: string, idempotencyKey: string, actorId: string): VocabularyProposalApplication {
  const actor = operator(actorId); nonempty(idempotencyKey);
  return atomic(() => {
    const value = expectedProposal(proposalId,expectedVersion);
    type ApplicationRow = { idempotency_key: string; proposal_id: string; proposal_version: number; authorized_review_id: string; effects_json: string };
    const keyed = getDb().prepare('SELECT * FROM proposal_applications WHERE idempotency_key=?').get(idempotencyKey) as ApplicationRow | undefined;
    if (keyed && (keyed.proposal_id !== proposalId || keyed.proposal_version !== expectedVersion)) {
      throw new VocabularyReflectionConflict('Application key belongs to another operation');
    }
    const existing = keyed ?? getDb().prepare('SELECT * FROM proposal_applications WHERE proposal_id=? AND proposal_version=?')
      .get(proposalId,expectedVersion) as ApplicationRow | undefined;
    if (existing) {
      if (existing.proposal_id !== proposalId || existing.proposal_version !== expectedVersion || existing.authorized_review_id !== reviewId) {
        throw new VocabularyReflectionConflict('Application key or approval belongs to another operation');
      }
      return JSON.parse(existing.effects_json) as VocabularyProposalApplication;
    }
    if (value.status !== 'approved') throw new VocabularyReflectionConflict('Exact proposal version requires manual approval');
    const review = getDb().prepare(`SELECT 1 FROM proposal_reviews WHERE review_id=? AND proposal_id=? AND proposal_version=? AND disposition='approved'`)
      .get(reviewId,proposalId,expectedVersion);
    if (!review) throw new VocabularyReflectionConflict('Approval does not authorize this exact proposal version');
    currentBases(value);
    const applicationId = randomUUID(), changes: VocabularyProposalApplication['changes'] = [];
    const executed=executeOperations(value,operation=>({...actor,reason:{proposalId,version:expectedVersion,operationKey:operation.operationKey,rationale:operation.rationale}}));
    for (const [index,operation] of value.operations.entries()) {
      const {result}=executed[index]!;
      changes.push({ operationKey: operation.operationKey,strategy: operation.strategy,
        sourceContentId: operation.strategy === 'create' ? null : operation.sourceContentId,
        sourceVersion: operation.strategy === 'create' ? null : operation.expectedVersion,
        resultContentId: result.contentId,resultVersion: result.version });
    }
    const receipt = { applicationId,proposalId,proposalVersion: expectedVersion,reviewId,changes };
    getDb().prepare('INSERT INTO proposal_applications VALUES (?,?,?,?,?,?,?)').run(applicationId,proposalId,expectedVersion,reviewId,idempotencyKey,encode(receipt),timestamp());
    for (const change of changes) {
      const history = change.sourceContentId === null ? null : getDb().prepare('SELECT change_id FROM content_revision_history WHERE content_id=? AND version=?')
        .get(change.sourceContentId,change.strategy === 'update_existing'||change.strategy==='retire' ? change.resultVersion : change.sourceVersion!+1) as { change_id: string } | undefined;
      getDb().prepare('INSERT INTO application_content_changes VALUES (?,?,?,?,?,?,?,?)').run(applicationId,change.operationKey,change.strategy,
        change.sourceContentId,change.sourceVersion,change.resultContentId,change.resultVersion,history?.change_id ?? null);
    }
    getDb().prepare("UPDATE content_proposals SET status='applied' WHERE proposal_id=?").run(proposalId);
    event('vocabulary.reflection.proposal_applied',proposalId,{ applicationId,version: expectedVersion },actor); return receipt;
  });
}

/** Queue replay uses the committed receipt before attempting validation again. */
export function completeVocabularyApprovalRequest(input: {
  requestId: string; proposalId: string; expectedVersion: number; actorId: string; notes: VocabularyJson;
}): VocabularyProposalApplication {
  operator(input.actorId);
  return atomic(() => {
    const key = `approval-request:${input.requestId}`;
    const previous = getDb().prepare(`SELECT a.proposal_id,a.proposal_version,a.effects_json,r.operator_id,r.notes_json
      FROM proposal_applications a JOIN proposal_reviews r ON r.review_id=a.authorized_review_id
      WHERE a.idempotency_key=?`).get(key) as {
        proposal_id:string;proposal_version:number;effects_json:string;operator_id:string;notes_json:string
      } | undefined;
    if (previous) {
      if (previous.proposal_id !== input.proposalId || previous.proposal_version !== input.expectedVersion
        || previous.operator_id !== input.actorId || previous.notes_json !== encode(input.notes)) {
        throw new VocabularyReflectionConflict('Approval request identity belongs to another authorization');
      }
      return JSON.parse(previous.effects_json) as VocabularyProposalApplication;
    }
    // The review and application commit together; a crash cannot leave an orphan authorization.
    const reviewId = approveVocabularyProposal(input.proposalId,input.expectedVersion,input.actorId,input.notes);
    return applyVocabularyProposal(input.proposalId,input.expectedVersion,reviewId,key,input.actorId);
  });
}
export function closeVocabularyTeachingCase(caseId: string, actorId: string, reason: string): void {
  const actor = operator(actorId); nonempty(reason);
  atomic(() => {
    if (getVocabularyReflectionCase(caseId).kind !== 'teaching_review') throw new Error('Expected a teaching case');
    getDb().prepare("UPDATE reflection_cases SET status='closed' WHERE case_id=?").run(caseId);
    event('vocabulary.reflection.teaching_case_closed',caseId,{ reason },actor);
  });
}

function caseImprovementResult(caseId: string): VocabularyImprovementResultInput | undefined {
  const row = getDb().prepare(`SELECT result_json FROM vocabulary_reflection_jobs
    WHERE case_id=? AND kind='exercise_improvement' AND status='succeeded' AND second_opinion_json IS NULL`).get(caseId) as { result_json: string } | undefined;
  return row ? (JSON.parse(row.result_json) as { input: VocabularyImprovementResultInput }).input : undefined;
}
function caseAdmission(caseId: string): VocabularyImprovementAdmission | undefined { return caseImprovementResult(caseId)?.admission; }
export function closeVocabularyCase(caseId: string, actorId: string, reason = ''): void {
  const actor = operator(actorId);
  if (typeof reason !== 'string') throw new TypeError('Expected text reason');
  atomic(() => {
    const evidence = getVocabularyReflectionCase(caseId);
    if (evidence.kind === 'teaching_review') { closeVocabularyTeachingCase(caseId,actorId,reason); return; }
    const improvement = caseImprovementResult(caseId);
    const admission = improvement?.admission;
    const noProposal = improvement?.proposal === null;
    const unresolved = (admission !== undefined && ['unmappable','inventory_gap','needs_coverage'].includes(admission.outcome))
      || improvement?.pureCuePromotion?.outcome === 'needs_operator';
    if (evidence.kind !== 'exercise_improvement' || (!noProposal && !unresolved)) {
      throw new VocabularyReflectionConflict('Only manual teaching or unresolved assessment cases can be closed');
    }
    if (!(evidence.status === 'completed' && noProposal && !unresolved)) nonempty(reason);
    getDb().prepare("UPDATE reflection_cases SET status='closed' WHERE case_id=?").run(caseId);
    event('vocabulary.reflection.admission_case_closed',caseId,{ reason,outcome: admission?.outcome??null },actor);
  });
}

function feedbackFailureMessage(error: string | null): string {
  return error === 'provider_outcome_unknown'
    ? 'Feedback was interrupted; its provider outcome is unknown. An explicit retry may make another call.'
    : 'Feedback could not finish. You can retry.';
}
/** Safe queue metadata only; learner reads expose neither private cases nor proposal controls. */
export function listOwnVocabularyFeedbackFailures(): { jobId: string; subject: { wordId: string | null; contentId: string | null }; error: string }[] {
  return (getDb().prepare(`SELECT j.job_id,c.word_id,c.content_id,j.last_error FROM vocabulary_reflection_jobs j
    JOIN reflection_cases c ON c.case_id=j.case_id WHERE c.learner_id=? AND j.kind='learner_feedback' AND j.status='failed' ORDER BY j.created_at`)
    .all(requireLearnerId()) as { job_id: string;word_id: string|null;content_id: string|null;last_error: string }[])
    .map(row => ({ jobId: row.job_id,subject: { wordId: row.word_id,contentId: row.content_id },error: feedbackFailureMessage(row.last_error) }));
}
function retryJob(jobId: string, learnerId: string | null, at: string): void {
  const row = job(jobId), evidence = getVocabularyReflectionCase(row.case_id);
  if (learnerId !== null && (row.kind !== 'learner_feedback' || evidence.learnerId !== learnerId)) throw new Error('Reflection job does not belong to current learner');
  if (row.status !== 'failed') throw new VocabularyReflectionConflict('Only failed reflection jobs can be retried');
  if(row.reassessment_source_job_id && getDb().prepare("SELECT 1 FROM vocabulary_reflection_jobs WHERE reassessment_source_job_id=? AND status IN ('queued','running') AND job_id<>?").get(row.reassessment_source_job_id,jobId))
    throw new VocabularyReflectionConflict('A reassessment is already in progress');
  getDb().prepare(`UPDATE vocabulary_reflection_jobs SET status='queued',next_attempt_at=?,last_error=NULL,lease_token=NULL,lease_expires_at=NULL WHERE job_id=?`)
    .run(timestamp(at),jobId);
  // A manual restart gets a fresh cycle unless a successful mapping must retain
  // its fallback route/cache identity while a later stage is retried.
  getDb().prepare(`UPDATE vocabulary_reflection_jobs SET sense_mapping_availability_failures=0 WHERE job_id=?
    AND (sense_mapping_availability_failures=6 OR NOT EXISTS (SELECT 1 FROM vocabulary_improvement_stages s
      WHERE s.job_id=vocabulary_reflection_jobs.job_id AND s.stage='sense_mapping'))`).run(jobId);
  event('vocabulary.reflection.retry_requested',jobId,{ explicitRetry: true });
}
export function retryOwnVocabularyFeedback(jobId: string, at = timestamp()): void { atomic(() => retryJob(jobId,requireLearnerId(),at)); }
export function retryVocabularyReflectionJob(jobId: string, actorId: string, at = timestamp()): void {
  operator(actorId); atomic(() => {
    retryJob(jobId,null,at);
  });
}
export function listVocabularyProposals(actorId: string, status?: VocabularyContentProposal['status']): VocabularyContentProposal[] {
  operator(actorId);
  return (getDb().prepare(`SELECT proposal_id FROM content_proposals WHERE (? IS NULL OR status=?) ORDER BY updated_at DESC,proposal_id`)
    .all(status ?? null,status ?? null) as { proposal_id:string }[]).map(row => withProposalResolution(proposal(row.proposal_id)));
}
/** Read-only review data. This is a display projection, not approval validation. */
type ReassessmentSource = { contentId:string; assessedVersion:number; currentVersion:number };
type ReassessmentSummary = { eligible: boolean; unavailableReason: string | null; source: ReassessmentSource | null; latest: {caseId:string;jobId:string;status:string;error:string|null} | null };
function reassessmentSource(evidence: VocabularyReflectionCase): ReassessmentSource | null {
  const pinned=getDb().prepare('SELECT reassessment_source_json FROM vocabulary_reflection_jobs WHERE case_id=? AND second_opinion_json IS NULL').get(evidence.caseId) as {reassessment_source_json:string|null}|undefined;
  const previous=pinned?.reassessment_source_json ? JSON.parse(pinned.reassessment_source_json) as VocabularyContent : null;
  const encounter=evidence.evidence[0];
  const contentId=previous?.contentId??encounter?.snapshot.contentId;
  if(!contentId)return null;
  const current=getVocabularyContentForMaintenance(contentId);
  if(!current||current.kind!=='exercise'||current.exerciseRole!=='general'||current.skill!=='production'||current.availability!=='active'
    ||(current.accessScope==='private'&&current.ownerLearnerId!==evidence.learnerId))return null;
  const admission=caseAdmission(evidence.caseId);
  return {contentId,assessedVersion:previous?.version??(admission?.sourceContentId===contentId?admission.sourceContentVersion:encounter!.snapshot.contentVersion),currentVersion:current.version};
}
function reassessmentSummary(evidence: VocabularyReflectionCase): ReassessmentSummary {
  const db=getDb();
  const source=evidence.kind==='exercise_improvement'&&(evidence.status==='completed'||evidence.status==='open')
    ? db.prepare("SELECT job_id FROM vocabulary_reflection_jobs WHERE case_id=? AND status='succeeded' AND second_opinion_json IS NULL").get(evidence.caseId) as {job_id:string}|undefined : undefined;
  if(!source) return {eligible:false,unavailableReason:evidence.kind!=='exercise_improvement'?'Only exercise improvement assessments can be reassessed.':evidence.status==='closed'?'This assessment is closed.':'A successful assessment is required before reassessment.',source:null,latest:null};
  const latest=db.prepare(`SELECT case_id AS caseId,job_id AS jobId,status,last_error AS error FROM vocabulary_reflection_jobs
    WHERE reassessment_source_job_id=? ORDER BY CASE WHEN status IN ('queued','running') THEN 0 ELSE 1 END,created_at DESC,job_id DESC LIMIT 1`).get(source.job_id) as ReassessmentSummary['latest'] | undefined;
  const current=reassessmentSource(evidence);
  return {eligible:current!==null,unavailableReason:current?null:'The current source is unavailable or is not an active general production exercise.',source:current,latest:latest??null};
}
function assessmentReview(caseId:string, fallbackInvocationId?:string|null):VocabularyAssessmentReview {
  const row=getDb().prepare("SELECT job_id,result_json,reassessment_source_job_id FROM vocabulary_reflection_jobs WHERE case_id=? AND kind='exercise_improvement' AND status='succeeded' AND second_opinion_json IS NULL").get(caseId) as {job_id:string;result_json:string;reassessment_source_job_id:string|null}|undefined;
  const result=row?(JSON.parse(row.result_json) as {input:VocabularyImprovementResultInput}).input:undefined;
  const resolution=row?getPureCueResolution(row.job_id):null;
  const parent=resolution?getDb().prepare('SELECT result_json FROM vocabulary_reflection_jobs WHERE job_id=?').get(resolution.sourceJobId) as {result_json:string}|undefined:undefined;
  const retained=parent?(JSON.parse(parent.result_json) as {input:VocabularyImprovementResultInput}).input:undefined;
  const ids=[...new Set([result?.admission?.invocationId,retained?.invocationId,retained?.proposal?.invocationId,result?.invocationId,result?.proposal?.invocationId,result?.pureCuePromotion?.invocationId,fallbackInvocationId].filter((id):id is string=>!!id))];
  const models=ids.flatMap(id=>{
    const model=getDb().prepare('SELECT id AS invocationId,step_name AS stage,provider,model,resolved_model AS resolvedModel FROM model_invocations WHERE id=?').get(id) as VocabularyAssessmentReview['models'][number]|undefined;
    return model?[{...model,stage:model.stage??'exercise_improvement'}]:[];
  });
  return {origin:resolution?'identity_resolution':row?.reassessment_source_job_id?'reassessment':row?'automatic':'unavailable',models,...(result?.admission?{admission:result.admission}:{})};
}
/** Display metadata only: never establishes an inventory or its useful selection. */
function senseLabels(wordIds:Iterable<string>,cache=new Map<string,VocabularySenseLabel[]>()):VocabularySenseLabel[] {
  return [...new Set(wordIds)].flatMap(wordId=>{
    if(cache.has(wordId))return cache.get(wordId)!;
    const labels=getVocabularySenses(wordId).map(sense=>{
      const description=sense.description;
      const label=typeof description==='string'?description:description&&typeof description==='object'&&!Array.isArray(description)&&typeof description.label==='string'?description.label:'Sense label unavailable';
      return {senseId:sense.senseId,wordId,label};
    });cache.set(wordId,labels);return labels;
  });
}
export function listVocabularyProposalReviewBatch(actorId: string, input: { limit?: number; startProposalId?: string; maxBytes?: number } = {}): {
  items: {currentSources:VocabularyContent[];assessment:VocabularyAssessmentReview|null;coverageChanged:boolean;senseLabels:VocabularySenseLabel[];defaultSelectionFinding:import('../../src/domain/vocabulary-sense-coverage.ts').VocabularyDefaultSelectionFinding|null; proposal: VocabularyContentProposal; case: VocabularyReflectionCase | null; reassessment: ReassessmentSummary | null;
    previews: { operationKey: string; source: VocabularyContent | null; result: VocabularyProposalOperation['content'] }[] }[];
  nextProposalId: string | null;
} {
  operator(actorId);
  const limit = input.limit ?? 20, maxBytes = input.maxBytes ?? 4 * 1024 * 1024;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50 || !Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error('Invalid review batch limit');
  const db = getDb();
  const start = input.startProposalId === undefined ? null : db.prepare(`SELECT updated_at,proposal_id FROM content_proposals
    WHERE proposal_id=? AND status IN ('draft','awaiting_review','approved')`).get(input.startProposalId) as {updated_at:string;proposal_id:string}|undefined;
  if (input.startProposalId !== undefined && !start) throw new VocabularyReflectionConflict('Starting proposal is no longer open');
  // Scan each status through the existing (status, updated_at) index. Sorting
  // the small merge avoids sorting the entire open queue for an IN query.
  const scan = start
    ? db.prepare(`SELECT proposal_id,updated_at FROM content_proposals
        WHERE status=? AND updated_at<=? AND (updated_at<? OR proposal_id>=?)
        ORDER BY updated_at DESC,proposal_id ASC LIMIT ?`)
    : db.prepare(`SELECT proposal_id,updated_at FROM content_proposals
        WHERE status=? ORDER BY updated_at DESC,proposal_id ASC LIMIT ?`);
  const rows = (['draft','awaiting_review','approved'] as const).flatMap(status =>
    (start ? scan.all(status,start.updated_at,start.updated_at,start.proposal_id,limit+1)
      : scan.all(status,limit+1)) as {proposal_id:string;updated_at:string}[])
    .sort((a,b)=>a.updated_at===b.updated_at ? (a.proposal_id < b.proposal_id ? -1 : a.proposal_id > b.proposal_id ? 1 : 0)
      : (a.updated_at > b.updated_at ? -1 : 1)).slice(0,limit+1);
  const items: {currentSources:VocabularyContent[];assessment:VocabularyAssessmentReview|null;coverageChanged:boolean;senseLabels:VocabularySenseLabel[];defaultSelectionFinding:import('../../src/domain/vocabulary-sense-coverage.ts').VocabularyDefaultSelectionFinding|null; proposal: VocabularyContentProposal; case: VocabularyReflectionCase | null; reassessment: ReassessmentSummary | null;
    previews: { operationKey: string; source: VocabularyContent | null; result: VocabularyProposalOperation['content'] }[] }[] = [];
  const cases = new Map<string,VocabularyReflectionCase>();
  const reassessments = new Map<string,ReassessmentSummary>();
  const sources = new Map<string,VocabularyContent|null>();
  const labelsByWord=new Map<string,VocabularySenseLabel[]>();
  for (const [index,row] of rows.slice(0,limit).entries()) {
    const value = withProposalResolution(proposal(row.proposal_id));
    let caseValue: VocabularyReflectionCase | null = null;
    if (value.caseId) {
      caseValue = cases.get(value.caseId) ?? getVocabularyReflectionCase(value.caseId);
      cases.set(value.caseId,caseValue);
    }
    const previews = value.operations.map(operation => {
      let source: VocabularyContent | null = null;
      if (operation.strategy !== 'create') {
        if (!sources.has(operation.sourceContentId)) sources.set(operation.sourceContentId,getVocabularyContentForMaintenance(operation.sourceContentId));
        source = sources.get(operation.sourceContentId)!;
      }
      return { operationKey: operation.operationKey, source, result: source&&operation.strategy==='retire'?{...source,availability:'retired' as const}:source
        ? {...operation.content,body:vocabularyAuthoredPromptBody(source.body,operation.content.body)} : operation.content };
    });
    if (caseValue && !reassessments.has(caseValue.caseId)) reassessments.set(caseValue.caseId,reassessmentSummary(caseValue));
    const currentSources=value.bases.flatMap(base=>{
      if(!sources.has(base.contentId))sources.set(base.contentId,getVocabularyContentForMaintenance(base.contentId));
      const source=sources.get(base.contentId);return source?[source]:[];
    });
    const item = {currentSources,assessment:caseValue?assessmentReview(caseValue.caseId,value.invocationId):null,coverageChanged:vocabularyProposalCoverageChanged(value),senseLabels:senseLabels([...(caseValue?.wordId?[caseValue.wordId]:[]),...value.operations.flatMap(operation=>operation.content.words.map(word=>word.wordId))],labelsByWord),defaultSelectionFinding:caseValue?.wordId?getVocabularyDefaultSelectionFinding(caseValue.wordId):null,proposal:value,case:caseValue,reassessment:caseValue?reassessments.get(caseValue.caseId)!:null,previews};
    const nextProposalId = rows[index+1]?.proposal_id ?? null;
    const bytes = Buffer.byteLength(JSON.stringify({items:[...items,item],nextProposalId}),'utf8');
    if (items.length > 0 && bytes > maxBytes) return {items,nextProposalId:row.proposal_id};
    items.push(item);
  }
  return {items,nextProposalId:rows[limit]?.proposal_id ?? null};
}
export function getVocabularyCaseWorkspace(caseId: string, actorId: string): {assessment:VocabularyAssessmentReview;reassessmentUnavailableReason:string|null;senseLabels:VocabularySenseLabel[];defaultSelectionFinding:import('../../src/domain/vocabulary-sense-coverage.ts').VocabularyDefaultSelectionFinding|null; case: VocabularyReflectionCase;
  jobs: { jobId: string;kind:string;status:string;attemptNumber:number;error:string|null;secondOpinion: boolean;result: VocabularySecondOpinion['result'] }[]; proposals: VocabularyContentProposal[];sources:VocabularyContent[];
  reassessmentSource: ReassessmentSource | null;
  reassessment: {caseId:string;jobId:string;status:string;error:string|null} | null;
  pureCueIdentityOptions?:ReturnType<typeof pureCueIdentityOptions>; diagnosis?: VocabularyJson; admission?: VocabularyImprovementAdmission; pureCueReferral?: VocabularyPureCueReferral | null; pureCuePromotion?: VocabularyPureCuePromotion } {
  operator(actorId);
  const evidence=getVocabularyReflectionCase(caseId);
  const jobRows=getDb().prepare(`SELECT job_id AS jobId,kind,status,attempt_number AS attemptNumber,last_error AS error,second_opinion_json,result_json FROM vocabulary_reflection_jobs WHERE case_id=? OR json_extract(second_opinion_json,'$.parentCaseId')=? ORDER BY created_at,job_id`).all(caseId,caseId) as { jobId:string;kind:string;status:string;attemptNumber:number;error:string|null;second_opinion_json:string|null;result_json:string|null }[];
  const jobs=jobRows.map(({second_opinion_json,result_json,...row})=>({...row,secondOpinion:!!second_opinion_json,result:result_json?(JSON.parse(result_json) as {input:VocabularyImprovementResultInput}).input.secondOpinion??null:null}));
  const ids=new Set(evidence.evidence.map(item=>item.snapshot.contentId));
  for(const id of [...ids]) {
    for(const row of getDb().prepare('SELECT introduction_id FROM introduction_exercises WHERE exercise_id=?').all(id) as {introduction_id:string}[])ids.add(row.introduction_id);
  }
  for(const id of [...ids]) {
    const content=getVocabularyContentForMaintenance(id);
    if(content?.kind==='introduction')for(const binding of content.teachingExercises)ids.add(binding.exerciseId);
  }
  const improvement=caseImprovementResult(caseId);
  if(improvement?.pureCuePromotion?.existingContentId)ids.add(improvement.pureCuePromotion.existingContentId);
  const sources=[...ids].map(id=>getVocabularyContentForMaintenance(id)).filter((value):value is VocabularyContent=>value!==null);
  const admission = caseAdmission(caseId);
  const reassessment=getDb().prepare(`SELECT child.case_id AS caseId,child.job_id AS jobId,child.status,child.last_error AS error
    FROM vocabulary_reflection_jobs child JOIN vocabulary_reflection_jobs source ON source.job_id=child.reassessment_source_job_id
    WHERE source.case_id=? ORDER BY CASE WHEN child.status IN ('queued','running') THEN 0 ELSE 1 END,child.created_at DESC,child.job_id DESC LIMIT 1`).get(caseId) as {caseId:string;jobId:string;status:string;error:string|null}|undefined;
  const proposals=(getDb().prepare('SELECT proposal_id FROM content_proposals WHERE case_id=? ORDER BY updated_at DESC,proposal_id')
    .all(caseId) as {proposal_id:string}[]).map(row=>withProposalResolution(proposal(row.proposal_id)));
  return {assessment:assessmentReview(caseId),reassessmentUnavailableReason:reassessmentSummary(evidence).unavailableReason,...(improvement?.pureCuePromotion?.outcome==='needs_operator'&&improvement.pureCueReferral&&evidence.wordId?{pureCueIdentityOptions:pureCueIdentityOptions(evidence.wordId,improvement.pureCueReferral)}:{}),senseLabels:senseLabels([...(evidence.wordId?[evidence.wordId]:[]),...sources.flatMap(source=>source.words.map(word=>word.wordId))]),defaultSelectionFinding:evidence.wordId?getVocabularyDefaultSelectionFinding(evidence.wordId):null,case:evidence,jobs,reassessmentSource:reassessmentSummary(evidence).source,reassessment:reassessment??null,proposals,sources,...(improvement ? {diagnosis:improvement.diagnosis} : {}),...(admission ? {admission} : {}),...(improvement?.pureCueReferral?{pureCueReferral:improvement.pureCueReferral}:{}),...(improvement?.pureCuePromotion?{pureCuePromotion:improvement.pureCuePromotion}:{})};
}
export function listVocabularyFailedDispatches(actorId:string):{dispatchId:string;learnerId:string;sessionId:string;error:string}[] {
  operator(actorId);
  return (getDb().prepare(`SELECT dispatch_id AS dispatchId,learner_id AS learnerId,session_id AS sessionId,last_error AS error
    FROM vocabulary_post_session_dispatches WHERE status='failed' ORDER BY created_at,dispatch_id`).all() as {
      dispatchId:string;learnerId:string;sessionId:string;error:string}[]).map(row=>({...row}));
}
export function retryVocabularyPostSessionDispatch(dispatchId:string,actorId:string,at=timestamp()):void {
  const actor=operator(actorId);timestamp(at);
  atomic(()=>{
    const row=getDb().prepare('SELECT status FROM vocabulary_post_session_dispatches WHERE dispatch_id=?').get(dispatchId) as {status:string}|undefined;
    if(!row)throw new Error('Unknown vocabulary dispatch');
    if(row.status!=='failed')throw new VocabularyReflectionConflict('Only failed evidence dispatches can be retried');
    getDb().prepare(`UPDATE vocabulary_post_session_dispatches SET status='queued',active_token=NULL,expires_at=NULL,last_error=NULL WHERE dispatch_id=?`).run(dispatchId);
    event('vocabulary.reflection.ingestion_retry_requested',dispatchId,{explicitRetry:true},actor);
  });
}

export function getOwnVocabularyFeedbackAttention():{unseenCount:number;hasFailure:boolean;generating:boolean} {
  const learnerId=requireLearnerId();
  const unseen=getDb().prepare('SELECT count(*) n FROM learner_messages WHERE learner_id=? AND seen_at IS NULL AND dismissed_at IS NULL').get(learnerId)!;
  const work=getDb().prepare(`SELECT j.status FROM vocabulary_reflection_jobs j JOIN reflection_cases c ON c.case_id=j.case_id
    WHERE c.learner_id=? AND j.kind='learner_feedback' AND j.status IN ('failed','running','queued')`).all(learnerId) as {status:string}[];
  const dispatch=getDb().prepare(`SELECT 1 FROM vocabulary_post_session_dispatches WHERE learner_id=? AND status IN ('queued','running') LIMIT 1`).get(learnerId);
  return {unseenCount:Number(unseen.n),hasFailure:work.some(row=>row.status==='failed'),generating:!!dispatch||work.some(row=>row.status==='queued'||row.status==='running')};
}

/** Independent advisory review. Retains the exact proposal version; never changes approval authority. */
export function requestVocabularySecondOpinion(proposalId: string, expectedVersion: number, actorId: string, notes = ''): VocabularySecondOpinion {
  const actor = operator(actorId);
  return atomic(() => {
    const value = expectedProposal(proposalId,expectedVersion);
    if (value.status === 'applied' || value.status === 'closed') throw new VocabularyReflectionConflict('Resolved proposals cannot request a second opinion');
    const existing = listVocabularySecondOpinions(proposalId,actorId).find(item => item.proposalVersion === expectedVersion);
    if (existing) return existing;
    if (!value.caseId) throw new Error('Second opinion requires a retained exercise improvement case');
    const evidence = getVocabularyReflectionCase(value.caseId);
    if (evidence.kind !== 'exercise_improvement') throw new Error('Second opinion requires an exercise improvement case');
    currentBases(value);
    const requestId = randomUUID(), at = timestamp();
    const caseId = createCase(evidence.learnerId,evidence.completionId,'exercise_improvement',`second-opinion/${requestId}`,
      evidence.wordId,evidence.contentId,evidence.evidence,at);
    inheritVocabularyCaseSenseCoverage(evidence.caseId,caseId,actorId);
    const row = getDb().prepare('SELECT job_id FROM vocabulary_reflection_jobs WHERE case_id=?').get(caseId) as { job_id: string };
    getDb().prepare('UPDATE vocabulary_reflection_jobs SET second_opinion_json=?,reassessment_source_json=(SELECT reassessment_source_json FROM vocabulary_reflection_jobs WHERE case_id=? AND second_opinion_json IS NULL) WHERE job_id=?')
      .run(encode({requestId,proposal:value,notes}),evidence.caseId,row.job_id);
    getDb().prepare('INSERT INTO vocabulary_second_opinions VALUES (?,?,?,?,?,?)')
      .run(requestId,proposalId,expectedVersion,row.job_id,actorId,at);
    event('vocabulary.proposal.second_opinion_requested',proposalId,{requestId,proposalVersion:expectedVersion,jobId:row.job_id},actor);
    return listVocabularySecondOpinions(proposalId,actorId).find(item => item.requestId === requestId)!;
  });
}
export function listVocabularySecondOpinions(proposalId: string, actorId: string): VocabularySecondOpinion[] {
  operator(actorId); proposal(proposalId);
  const rows = getDb().prepare(`SELECT s.request_id,s.proposal_id,s.proposal_version,s.requested_at,j.*
    FROM vocabulary_second_opinions s JOIN vocabulary_reflection_jobs j ON j.job_id=s.job_id
    WHERE s.proposal_id=? ORDER BY s.requested_at DESC,s.request_id`).all(proposalId) as (JobRow & {
      request_id: string; proposal_id: string; proposal_version: number; requested_at: string; last_error: string | null;
      status: VocabularySecondOpinion['status'];
    })[];
  return rows.map(row => ({requestId:row.request_id,proposalId:row.proposal_id,proposalVersion:row.proposal_version,
    jobId:row.job_id,status:row.status,attemptNumber:row.attempt_number,error:row.last_error,requestedAt:row.requested_at,
    result:row.result_json ? (JSON.parse(row.result_json) as {input:VocabularyImprovementResultInput}).input.secondOpinion ?? null : null}));
}

export function requestVocabularyCaseSecondOpinion(caseId:string, actorId:string, notes:string): void {
  const actor=operator(actorId);
  atomic(()=>{
    const evidence=getVocabularyReflectionCase(caseId), result=caseImprovementResult(caseId);
    if(evidence.kind!=='exercise_improvement'||evidence.status!=='completed'||!result||result.proposal!==null)
      throw new VocabularyReflectionConflict('A completed no-proposal judgment is required');
    const existing=getDb().prepare("SELECT 1 FROM vocabulary_reflection_jobs WHERE json_extract(second_opinion_json,'$.parentCaseId')=? AND status IN ('queued','running')").get(caseId);
    if(existing)throw new VocabularyReflectionConflict('A second opinion is already in progress');
    const at=timestamp(), requestId=randomUUID();
    const childId=createCase(evidence.learnerId,evidence.completionId,'exercise_improvement',`case-second-opinion/${requestId}`,evidence.wordId,evidence.contentId,evidence.evidence,at);
    inheritVocabularyCaseSenseCoverage(caseId,childId,actorId);
    getDb().prepare('UPDATE vocabulary_reflection_jobs SET second_opinion_json=?,reassessment_source_json=(SELECT reassessment_source_json FROM vocabulary_reflection_jobs WHERE case_id=? AND second_opinion_json IS NULL) WHERE case_id=?')
      .run(encode({requestId,parentCaseId:caseId,proposal:null,notes,diagnosis:result.diagnosis}),caseId,childId);
    event('vocabulary.reflection.case_second_opinion_requested',caseId,{requestId,notes},actor);
  });
}

/** Queue a fresh assessment of the operator-selected current authored version. */
export function requestVocabularyReassessment(caseId:string, actorId:string, modelChoice:ReflectionModelChoice, expectedContentVersion:number): {caseId:string;jobId:string} {
  const actor=operator(actorId);
  if(!isOfferedReflectionModelChoice(modelChoice)) throw new Error('Unsupported assessment model');
  return atomic(()=>{
    const evidence=getVocabularyReflectionCase(caseId);
    if(evidence.kind!=='exercise_improvement'||(evidence.status!=='completed'&&evidence.status!=='open')) throw new VocabularyReflectionConflict('A completed improvement assessment is required');
    const db=getDb();
    const source=db.prepare("SELECT job_id FROM vocabulary_reflection_jobs WHERE case_id=? AND status='succeeded' AND second_opinion_json IS NULL").get(caseId) as {job_id:string}|undefined;
    if(!source) throw new VocabularyReflectionConflict('Completed assessment evidence is unavailable');
    const active=db.prepare("SELECT 1 FROM vocabulary_reflection_jobs WHERE reassessment_source_job_id=? AND status IN ('queued','running')").get(source.job_id);
    if(active) throw new VocabularyReflectionConflict('A reassessment is already in progress');
    const metadata=reassessmentSource(evidence);
    if(!metadata)throw new VocabularyReflectionConflict('Current assessment source is unavailable');
    if(!Number.isSafeInteger(expectedContentVersion)||expectedContentVersion!==metadata.currentVersion)
      throw new VocabularyReflectionConflict('Assessment source version changed; review the current version before reassessing');
    const content=getVocabularyContentForMaintenance(metadata.contentId)!;
    const at=timestamp(), requestId=randomUUID();
    const childId=createCase(evidence.learnerId,evidence.completionId,'exercise_improvement',`reassessment/${requestId}`,evidence.wordId,evidence.contentId,evidence.evidence,at);
    inheritVocabularyCaseSenseCoverage(caseId,childId,actorId);
    const child=db.prepare('SELECT job_id FROM vocabulary_reflection_jobs WHERE case_id=?').get(childId) as {job_id:string};
    db.prepare('UPDATE vocabulary_reflection_jobs SET model_choice=?,reassessment_source_job_id=?,reassessment_source_json=? WHERE job_id=?').run(modelChoice,source.job_id,encode(content),child.job_id);
    event('vocabulary.reflection.reassessment_requested',caseId,{requestId,caseId:childId,jobId:child.job_id,sourceJobId:source.job_id,modelChoice,sourceContentId:content.contentId,sourceContentVersion:content.version},actor);
    return {caseId:childId,jobId:child.job_id};
  });
}

/** An identity choice resumes assessment only; it never approves content. */
export function requestVocabularyPureCueResolution(caseId:string,actorId:string,modelChoice:ReflectionModelChoice,expectedContentVersion:number,selections:Record<string,string>):{caseId:string;jobId:string} {
  const actor=operator(actorId);
  if(!isOfferedReflectionModelChoice(modelChoice))throw new Error('Unsupported assessment model');
  return atomic(()=>{
    const evidence=getVocabularyReflectionCase(caseId),local=caseImprovementResult(caseId);
    if(evidence.status==='closed'||!evidence.wordId||local?.pureCuePromotion?.outcome!=='needs_operator'||!local.pureCueReferral||!local.admission)
      throw new VocabularyReflectionConflict('A pending lexical identity assessment is required');
    const original=getVocabularyContentForMaintenance(local.admission.sourceContentId);
    if(!original||original.availability!=='active'||original.version!==expectedContentVersion||original.version!==local.admission.sourceContentVersion
      ||getVocabularySenseCatalog(evidence.wordId).version!==local.admission.catalogVersion)
      throw new VocabularyReflectionConflict('Assessment source or sense inventory changed; reassess the current source');
    const mapping=original.words.find(word=>word.wordId===evidence.wordId);
    if(!mapping||(mapping.senseId??null)!==local.admission.sourceMapping.senseId||(mapping.senseMappingEstablishedAt??null)!==local.admission.sourceMapping.establishedAt)
      throw new VocabularyReflectionConflict('Assessment source mapping changed; reassess the current source');
    const options=pureCueIdentityOptions(evidence.wordId,local.pureCueReferral);
    if(Object.keys(selections).length!==options.length||options.some(option=>!option.choices.some(word=>word.wordId===selections[option.form])))
      throw new VocabularyReflectionConflict('Choose an exact dictionary identity for every referral word');
    const candidates=options.map(option=>option.choices.find(word=>word.wordId===selections[option.form])!);
    if(new Set(candidates.map(word=>word.wordId)).size<2||!candidates.some(word=>word.wordId===evidence.wordId))
      throw new VocabularyReflectionConflict('Promotion requires the target and another distinct lexical identity');
    const queued=requestVocabularyReassessment(caseId,actorId,modelChoice,expectedContentVersion);
    const child=job(queued.jobId),at=timestamp();
    const resolution:PureCueResolution={actorId,recordedAt:at,sourceJobId:child.reassessment_source_job_id!,original,admission:local.admission,diagnosis:local.diagnosis,referral:local.pureCueReferral,selections,candidates:[...new Map(candidates.map(word=>[word.wordId,word])).values()]};
    getDb().prepare("INSERT INTO vocabulary_improvement_stages(job_id,stage,input_hash,input_json,result_json,invocation_id,recorded_at) VALUES (?,'pure_cue_promotion',?,?,?,NULL,?)")
      .run(queued.jobId,PURE_CUE_RESOLUTION_CONTRACT,encode({contract:PURE_CUE_RESOLUTION_CONTRACT}),encode(resolution),at);
    event('vocabulary.reflection.pure_cue_identities_resolved',queued.caseId,{sourceCaseId:caseId,sourceJobId:resolution.sourceJobId,selections},actor);
    return queued;
  });
}
