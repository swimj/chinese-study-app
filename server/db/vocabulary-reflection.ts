import { failPreparationAttempt } from '../vocabulary/preparation-retry.ts';
import { randomUUID } from 'node:crypto';
import type { VocabularyActor, VocabularyJson, VocabularyContent } from '../../src/domain/vocabulary-content.ts';
import { VOCABULARY_COMPENSATION_POLICY, type VocabularySecondOpinion, type VocabularyReflectionCase, type VocabularyReflectionJob,
  type VocabularyFeedbackJudgmentInput, type VocabularyProposalDraft, type VocabularyContentProposal,
  type VocabularyProposalOperation, type VocabularyProposalApplication, type VocabularyImprovementResultInput, type VocabularyImprovementAdmission, type VocabularyPureCuePromotion, type VocabularyPureCueReferral, type VocabularyReflectionResult } from '../../src/domain/vocabulary-reflection.ts';
import { getEffectiveVocabularyEncounterReactions, type VocabularySessionProjection, type VocabularyEncounterEvidence } from '../../src/domain/vocabulary-session.ts';
import { config, getDb } from './connection.ts';
import { requireLearnerId } from './learner-context.ts';
import { isOperatorSubject, parseOperatorAllowlist } from '../operator-access.ts';
import { isVocabularyProviderEncounter } from '../vocabulary/reflection-eligibility.ts';
import { retryVocabularySenseReadiness } from '../vocabulary/sense-readiness.ts';
import { createVocabularyContent, updateVocabularyContent, replaceVocabularyContent, getVocabularySenseCatalog,
  getVocabularyContentForMaintenance, emitBackendEvent } from './vocabulary-content.ts';

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
type CaseRow = { case_id: string; completion_id: string; learner_id: string; kind: VocabularyReflectionCase['kind'];
  word_id: string | null; content_id: string | null; status: VocabularyReflectionCase['status']; evidence_snapshot_json: string; created_at: string };
/** Internal private evidence reader. HTTP callers must establish operator authority before using it. */
export function getVocabularyReflectionCase(caseId: string): VocabularyReflectionCase {
  const row = getDb().prepare('SELECT * FROM reflection_cases WHERE case_id=?').get(caseId) as CaseRow | undefined;
  if (!row) throw new Error('Unknown vocabulary reflection case');
  return { caseId: row.case_id, completionId: row.completion_id, learnerId: row.learner_id, kind: row.kind,
    wordId: row.word_id, contentId: row.content_id, status: row.status,
    evidence: JSON.parse(row.evidence_snapshot_json) as VocabularyEncounterEvidence[], createdAt: row.created_at };
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
    for (const encounter of general.filter(issue)) cases.push(createCase(learnerId,completionId,'exercise_improvement',
      `encounter/${encounter.encounterId}`,encounter.wordId,encounter.snapshot.contentId,[encounter],at));
    for (const encounter of projection.encounters.filter(item => item.snapshot.role !== 'general' && issue(item))) {
      const teaching = projection.encounters.filter(item => item.snapshot.role !== 'general' && item.wordId === encounter.wordId);
      cases.push(createCase(learnerId,completionId,'teaching_review',`encounter/${encounter.encounterId}`,
        encounter.wordId,encounter.snapshot.contentId,teaching,at));
    }
    return cases;
  });
}

type JobRow = { job_id: string; case_id: string; kind: VocabularyReflectionJob['kind']; status: string; attempt_number: number;
  lease_token: string | null; lease_expires_at: string | null; result_json: string | null; second_opinion_json?: string | null };
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
/** Recover a crashed sense prerequisite without retrying an unrelated reflection provider call. */
export function recoverVocabularySenseDependencies(at=timestamp()):number {
  timestamp(at);
  return atomic(()=>{
    const rows=getDb().prepare(`SELECT j.job_id,s.word_id,s.status,s.active_token FROM vocabulary_reflection_jobs j
      JOIN vocabulary_sense_readiness s ON s.workflow_id=j.job_id WHERE j.status='running'
      AND (s.status IN ('queued','failed') OR (s.status='running' AND s.expires_at<=?))`).all(at) as Array<{job_id:string;word_id:string;status:string;active_token:string|null}>;
    for(const row of rows){
      if(row.status==='running')failPreparationAttempt('sense',row.word_id,row.active_token!,at,'interrupted_unknown_outcome',{interrupted:true});
      const sense=getDb().prepare('SELECT status,next_attempt_at FROM vocabulary_sense_readiness WHERE word_id=?').get(row.word_id) as {status:string;next_attempt_at:string};
      getDb().prepare(`UPDATE vocabulary_reflection_jobs SET status=?,next_attempt_at=?,last_error=?,lease_token=NULL,lease_expires_at=NULL WHERE job_id=? AND status='running'`)
        .run(sense.status==='queued'?'queued':'failed',sense.next_attempt_at,sense.status==='queued'?null:'sense_preparation_failed',row.job_id);
    }
    return rows.length;
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
export function getVocabularyProposal(proposalId: string, actorId: string): VocabularyContentProposal { operator(actorId); return proposal(proposalId); }
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
    if (operation.scope.kind === 'shared') {
      if (content.accessScope !== 'shared' || content.ownerLearnerId != null) throw new Error('Shared scope must match authored content');
    } else if (operation.scope.kind === 'learner') {
      nonempty(operation.scope.learnerId);
      if (content.accessScope !== 'private' || content.ownerLearnerId !== operation.scope.learnerId) throw new Error('Learner scope must preserve private ownership');
    } else throw new Error('Unknown proposal effect scope');
    if (operation.strategy !== 'create') {
      if (operation.strategy !== 'update_existing' && operation.strategy !== 'replace') throw new Error('Unknown proposal strategy');
      if (sources.has(operation.sourceContentId)) throw new Error('Proposal cannot write a source twice'); sources.add(operation.sourceContentId);
      add(operation.sourceContentId,operation.expectedVersion);
      const source = getVocabularyContentForMaintenance(operation.sourceContentId);
      if (!source || source.accessScope !== content.accessScope || (source.ownerLearnerId ?? null) !== (content.ownerLearnerId ?? null)) {
        throw new Error('Repair cannot broaden or transfer content ownership');
      }
    }
    if (content.kind === 'introduction') for (const binding of content.teachingExercises) {
      // Only an explicitly named version produced by an earlier ordered operation
      // can satisfy a future teaching binding. Its pre-state source remains a base.
      if(produced.get(binding.exerciseId)!==binding.exerciseVersion)add(binding.exerciseId,binding.exerciseVersion);
    }
    if(operation.strategy!=='create')produced.set(operation.sourceContentId,operation.expectedVersion+1);
    if(operation.strategy!=='update_existing'&&content.contentId)produced.set(content.contentId,1);
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
    const needsAttention = input.admission?.outcome === 'unmappable' || input.admission?.outcome === 'inventory_gap';
    if (input.admission) {
      const evidence = getVocabularyReflectionCase(row.case_id), admission = input.admission;
      if (admission.wordId !== evidence.wordId || !evidence.evidence.some(item =>
        item.snapshot.contentId === admission.sourceContentId && item.snapshot.contentVersion === admission.sourceContentVersion)) {
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
      rationale: draft.rationale,bases: baseVersions(draft) },actor,timestamp());
  });
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
    if(getVocabularySenseCatalog(admission.wordId).version!==admission.catalogVersion
      ||!mapping||(admission.sourceMapping&&((mapping.senseId??null)!==admission.sourceMapping.senseId
        ||(mapping.senseMappingEstablishedAt??null)!==admission.sourceMapping.establishedAt))) {
      throw new VocabularyReflectionConflict('Proposal sense evidence changed; close this proposal and reassess the current source');
    }
  }
}
function previewWrites(value:VocabularyContentProposal,actor:VocabularyActor):{operationKey:string;source:VocabularyContent|null;result:VocabularyContent}[] {
  const db=getDb(),point=`preview_${randomUUID().replaceAll('-','')}`;db.exec(`SAVEPOINT ${point}`);
  try {
    const previews=value.operations.map(operation=>{
      const source=operation.strategy==='create'?null:getVocabularyContentForMaintenance(operation.sourceContentId);
      const result=operation.strategy==='create'?createVocabularyContent(operation.content,actor)
        :operation.strategy==='update_existing'?updateVocabularyContent(operation.sourceContentId,operation.expectedVersion,operation.content,actor)
        :replaceVocabularyContent(operation.sourceContentId,operation.expectedVersion,operation.content,actor).replacement;
      return {operationKey:operation.operationKey,source,result};
    });
    if(db.prepare('PRAGMA foreign_key_check').all().length)throw new Error('Proposed content has invalid relationships');
    return previews;
  }finally{db.exec(`ROLLBACK TO ${point}`);db.exec(`RELEASE ${point}`);}
}
export function previewVocabularyProposal(proposalId: string, expectedVersion: number, actorId: string): {
  proposal: VocabularyContentProposal; previews:{operationKey:string;source:VocabularyContent|null;result:VocabularyContent}[]; operations: { operationKey: string; strategy: VocabularyProposalOperation['strategy'];
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
export function closeVocabularyProposal(proposalId: string, expectedVersion: number, actorId: string, reason: string): void {
  const actor = operator(actorId); nonempty(reason);
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
    for (const operation of value.operations) {
      const reasonedActor = { ...actor,reason: { proposalId,version: expectedVersion,operationKey: operation.operationKey,rationale: operation.rationale } };
      const result = operation.strategy === 'create' ? createVocabularyContent(operation.content,reasonedActor)
        : operation.strategy === 'update_existing' ? updateVocabularyContent(operation.sourceContentId,operation.expectedVersion,operation.content,reasonedActor)
        : replaceVocabularyContent(operation.sourceContentId,operation.expectedVersion,operation.content,reasonedActor).replacement;
      changes.push({ operationKey: operation.operationKey,strategy: operation.strategy,
        sourceContentId: operation.strategy === 'create' ? null : operation.sourceContentId,
        sourceVersion: operation.strategy === 'create' ? null : operation.expectedVersion,
        resultContentId: result.contentId,resultVersion: result.version });
    }
    const receipt = { applicationId,proposalId,proposalVersion: expectedVersion,reviewId,changes };
    getDb().prepare('INSERT INTO proposal_applications VALUES (?,?,?,?,?,?,?)').run(applicationId,proposalId,expectedVersion,reviewId,idempotencyKey,encode(receipt),timestamp());
    for (const change of changes) {
      const history = change.sourceContentId === null ? null : getDb().prepare('SELECT change_id FROM content_revision_history WHERE content_id=? AND version=?')
        .get(change.sourceContentId,change.strategy === 'update_existing' ? change.resultVersion : change.sourceVersion!+1) as { change_id: string } | undefined;
      getDb().prepare('INSERT INTO application_content_changes VALUES (?,?,?,?,?,?,?,?)').run(applicationId,change.operationKey,change.strategy,
        change.sourceContentId,change.sourceVersion,change.resultContentId,change.resultVersion,history?.change_id ?? null);
    }
    getDb().prepare("UPDATE content_proposals SET status='applied' WHERE proposal_id=?").run(proposalId);
    event('vocabulary.reflection.proposal_applied',proposalId,{ applicationId,version: expectedVersion },actor); return receipt;
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
export function closeVocabularyCase(caseId: string, actorId: string, reason: string): void {
  const actor = operator(actorId); nonempty(reason);
  atomic(() => {
    const evidence = getVocabularyReflectionCase(caseId);
    if (evidence.kind === 'teaching_review') { closeVocabularyTeachingCase(caseId,actorId,reason); return; }
    const admission = caseAdmission(caseId);
    const noProposal = caseImprovementResult(caseId)?.proposal === null;
    if (evidence.kind !== 'exercise_improvement' || (!noProposal && !(admission && ['unmappable','inventory_gap'].includes(admission.outcome)) && caseImprovementResult(caseId)?.pureCuePromotion?.outcome !== 'needs_operator')) {
      throw new VocabularyReflectionConflict('Only manual teaching or unresolved assessment cases can be closed');
    }
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
  getDb().prepare(`UPDATE vocabulary_reflection_jobs SET status='queued',next_attempt_at=?,last_error=NULL,lease_token=NULL,lease_expires_at=NULL WHERE job_id=?`)
    .run(timestamp(at),jobId);
  event('vocabulary.reflection.retry_requested',jobId,{ explicitRetry: true });
}
export function retryOwnVocabularyFeedback(jobId: string, at = timestamp()): void { atomic(() => retryJob(jobId,requireLearnerId(),at)); }
export function retryVocabularyReflectionJob(jobId: string, actorId: string, at = timestamp()): void {
  operator(actorId); atomic(() => {
    const work=job(jobId),evidence=getVocabularyReflectionCase(work.case_id);
    retryJob(jobId,null,at);
    if(work.kind==='exercise_improvement'&&evidence.wordId!==null) {
      const readiness=getDb().prepare('SELECT status FROM vocabulary_sense_readiness WHERE word_id=?').get(evidence.wordId) as {status:string}|undefined;
      if(readiness?.status==='failed')retryVocabularySenseReadiness(evidence.wordId,actorId);
    }
  });
}
export function listVocabularyProposals(actorId: string, status?: VocabularyContentProposal['status']): VocabularyContentProposal[] {
  operator(actorId);
  return (getDb().prepare(`SELECT proposal_id FROM content_proposals WHERE (? IS NULL OR status=?) ORDER BY updated_at DESC,proposal_id`)
    .all(status ?? null,status ?? null) as { proposal_id:string }[]).map(row => proposal(row.proposal_id));
}
export function getVocabularyCaseWorkspace(caseId: string, actorId: string): { case: VocabularyReflectionCase;
  jobs: { jobId: string;kind:string;status:string;attemptNumber:number;error:string|null;secondOpinion: boolean;result: VocabularySecondOpinion['result'] }[]; proposals: VocabularyContentProposal[];sources:VocabularyContent[];
  diagnosis?: VocabularyJson; admission?: VocabularyImprovementAdmission; pureCueReferral?: VocabularyPureCueReferral | null; pureCuePromotion?: VocabularyPureCuePromotion } {
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
  return {case:evidence,jobs,proposals:listVocabularyProposals(actorId).filter(value=>value.caseId===caseId),sources,...(improvement ? {diagnosis:improvement.diagnosis} : {}),...(admission ? {admission} : {}),...(improvement?.pureCueReferral?{pureCueReferral:improvement.pureCueReferral}:{}),...(improvement?.pureCuePromotion?{pureCuePromotion:improvement.pureCuePromotion}:{})};
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
    const row = getDb().prepare('SELECT job_id FROM vocabulary_reflection_jobs WHERE case_id=?').get(caseId) as { job_id: string };
    getDb().prepare('UPDATE vocabulary_reflection_jobs SET second_opinion_json=? WHERE job_id=?')
      .run(encode({requestId,proposal:value,notes}),row.job_id);
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
    getDb().prepare('UPDATE vocabulary_reflection_jobs SET second_opinion_json=? WHERE case_id=?')
      .run(encode({requestId,parentCaseId:caseId,proposal:null,notes,diagnosis:result.diagnosis}),childId);
    event('vocabulary.reflection.case_second_opinion_requested',caseId,{requestId,notes},actor);
  });
}
