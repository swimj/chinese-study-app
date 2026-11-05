import { randomUUID } from 'node:crypto';
import { config, getDb } from './connection.ts';
import { isOperatorSubject, parseOperatorAllowlist } from '../operator-access.ts';
import { getVocabularySenses, emitBackendEvent } from './vocabulary-content.ts';
import { assertVocabularyCaseEditable, canonicalVocabularyCaseId, getVocabularyCaseReview, touchVocabularyCaseReview, VocabularyReflectionConflict } from './vocabulary-case-reviews.ts';
import type { VocabularyImprovementAdmission, VocabularyRepairTarget, VocabularyRepairTargetWorkspace } from '../../src/domain/vocabulary-reflection.ts';

type TargetRow = {version:number;pending_sense_id:string|null;accepted_sense_id:string|null;accepted_version:number|null};
function target(caseId:string):TargetRow|undefined {
  return getDb().prepare('SELECT version,pending_sense_id,accepted_sense_id,accepted_version FROM vocabulary_case_repair_targets WHERE case_id=?').get(canonicalVocabularyCaseId(caseId)) as TargetRow|undefined;
}
function authorize(actorId:string):void {
  if(!isOperatorSubject(actorId,parseOperatorAllowlist(),config.authMode))throw new Error('Operator access required');
}
function currentAdmission(caseId:string):VocabularyImprovementAdmission|undefined {
  const row=getDb().prepare('SELECT j.result_json FROM vocabulary_case_reviews r JOIN vocabulary_reflection_jobs j ON j.job_id=r.current_job_id WHERE r.case_id=?').get(caseId) as {result_json:string|null}|undefined;
  return row?.result_json?(JSON.parse(row.result_json) as {input:{admission?:VocabularyImprovementAdmission}}).input.admission:undefined;
}
export function getVocabularyRepairTarget(caseId:string,actorId:string):VocabularyRepairTargetWorkspace {
  authorize(actorId);caseId=canonicalVocabularyCaseId(caseId);
  const review=getVocabularyCaseReview(caseId);
  const evidence=getDb().prepare('SELECT kind,word_id FROM reflection_cases WHERE case_id=?').get(caseId) as {kind:string;word_id:string|null}|undefined;
  if(!review||!evidence?.word_id)throw new Error('Unknown vocabulary word review');
  const row=target(caseId),admission=currentAdmission(caseId);
  const available=evidence.kind==='exercise_improvement'&&!!admission&&['single_sense','unmappable','inventory_gap'].includes(admission.outcome);
  return {caseId,wordId:evidence.word_id,version:row?.version??0,currentSenseId:row?.accepted_sense_id??(admission?.outcome==='single_sense'?admission.senseIds[0]??null:null),
    pendingSenseId:row?.pending_sense_id??null,available,blocked:!!row?.pending_sense_id,
    editable:available&&review.state==='open'&&!review.activeJob&&review.approvalState!=='pending',
    senses:getVocabularySenses(evidence.word_id).filter(sense=>sense.status==='active').map(sense=>({senseId:sense.senseId,label:typeof sense.description==='string'?sense.description:sense.description&&typeof sense.description==='object'&&!Array.isArray(sense.description)&&typeof sense.description.label==='string'?sense.description.label:JSON.stringify(sense.description)}))};
}
/** Save/reset pending intent only. The authored source and accepted assessment remain unchanged. */
export function setVocabularyRepairTarget(caseId:string,expectedVersion:number,senseId:string|null,actorId:string):VocabularyRepairTargetWorkspace {
  authorize(actorId);caseId=canonicalVocabularyCaseId(caseId);
  const db=getDb(),point=`repair_target_${randomUUID().replaceAll('-','')}`;db.exec(`SAVEPOINT ${point}`);
  try {
    const workspace=getVocabularyRepairTarget(caseId,actorId);
    if(workspace.version!==expectedVersion)throw new VocabularyReflectionConflict('Repair target changed; reload before saving');
    assertVocabularyCaseEditable(caseId);
    if(!workspace.editable)throw new VocabularyReflectionConflict('This assessment cannot change its repair target');
    if(senseId!==null&&!workspace.senses.some(sense=>sense.senseId===senseId))throw new Error('Expected an active sense belonging to the reviewed word');
    const at=new Date().toISOString();
    db.prepare(`INSERT INTO vocabulary_case_repair_targets(case_id,version,pending_sense_id,updated_at) VALUES (?,?,?,?)
      ON CONFLICT(case_id) DO UPDATE SET version=excluded.version,pending_sense_id=excluded.pending_sense_id,updated_at=excluded.updated_at`).run(caseId,workspace.version+1,senseId,at);
    touchVocabularyCaseReview(caseId);
    emitBackendEvent({name:'vocabulary.repair_target.updated',entityKind:'vocabulary_reflection_case',entityId:caseId,actorKind:'operator',actorId,data:{version:workspace.version+1,senseId},occurredAt:at});
    const result=getVocabularyRepairTarget(caseId,actorId);db.exec(`RELEASE ${point}`);return result;
  } catch(error){db.exec(`ROLLBACK TO ${point}; RELEASE ${point}`);throw error;}
}
/** Capture at queue time: later retries use exactly the same operator instruction. */
export function captureVocabularyRepairTarget(caseId:string):VocabularyRepairTarget|undefined {
  const row=target(caseId);
  if(row?.pending_sense_id)return {senseId:row.pending_sense_id,version:row.version};
  if(row?.accepted_sense_id&&row.accepted_version)return {senseId:row.accepted_sense_id,version:row.accepted_version};
  return undefined;
}
/** Called within successful result publication, including a successful no-repair judgment. */
export function acceptVocabularyRepairTarget(caseId:string,captured:VocabularyRepairTarget|undefined,at:string):void {
  const row=target(caseId);
  if(!captured){if(row?.pending_sense_id)throw new VocabularyReflectionConflict('Repair target changed during assessment');return;}
  if(!row||!(row.pending_sense_id===captured.senseId&&row.version===captured.version||!row.pending_sense_id&&row.accepted_sense_id===captured.senseId&&row.accepted_version===captured.version))
    throw new VocabularyReflectionConflict('Repair target changed during assessment');
  getDb().prepare('UPDATE vocabulary_case_repair_targets SET pending_sense_id=NULL,accepted_sense_id=?,accepted_version=?,updated_at=? WHERE case_id=?').run(captured.senseId,captured.version,at,canonicalVocabularyCaseId(caseId));
}
/** Read-only reason shared by review projections and authoritative application checks. */
export function vocabularyRepairTargetConflict(caseId:string|null,admission:VocabularyImprovementAdmission|undefined):'pending'|'superseded'|null {
  if(!caseId)return null;const row=target(caseId);
  if(row?.pending_sense_id)return 'pending';
  if(row?.accepted_version!==null&&row?.accepted_version!==undefined&&admission?.repairTargetVersion!==row.accepted_version)return 'superseded';
  return null;
}
/** A pending override requires reassessment; an accepted override fences older alternatives. */
export function assertVocabularyRepairTargetApplicable(caseId:string|null,admission:VocabularyImprovementAdmission|undefined):void {
  const conflict=vocabularyRepairTargetConflict(caseId,admission);
  if(conflict==='pending')throw new VocabularyReflectionConflict('Repair target changed; reassess or reset before editing or applying');
  if(conflict==='superseded')throw new VocabularyReflectionConflict('Proposal predates the accepted repair target; reassess before editing or applying');
}
