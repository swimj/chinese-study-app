import { retryVocabularyReflectionJob } from '../db/vocabulary-reflection.ts';
import { getDb } from '../db/connection.ts';
import { retryWordPreparation } from '../db/preparation-work.ts';
import { retryVocabularySenseReadiness } from '../vocabulary/sense-readiness.ts';
import { retryDefaultUsefulSelection } from '../vocabulary/default-useful-selection.ts';
/** Operator-authorized orchestration, kept above database persistence modules. */
export function retryPreparationWithReadiness(workId:string,actorId:string):void {
  const db=getDb();db.exec('SAVEPOINT retry_preparation_with_readiness');
  try{
    const work=db.prepare("SELECT word_id,stage FROM word_preparation_work WHERE work_id=? AND status='paused'").get(workId) as {word_id:string;stage:string}|undefined;
    if(work?.stage==='bootstrap'){
      if(db.prepare("SELECT 1 FROM vocabulary_sense_readiness WHERE word_id=? AND status='failed'").get(work.word_id))retryVocabularySenseReadiness(work.word_id,actorId);
      if(db.prepare("SELECT 1 FROM vocabulary_default_selection_readiness WHERE word_id=? AND status='failed'").get(work.word_id))retryDefaultUsefulSelection(work.word_id,actorId);
    }
    retryWordPreparation(workId,actorId);db.exec('RELEASE retry_preparation_with_readiness');
  }catch(error){db.exec('ROLLBACK TO retry_preparation_with_readiness; RELEASE retry_preparation_with_readiness');throw error;}
}


export function retryReflectionWithReadiness(jobId:string,actorId:string):void {
  const db=getDb();db.exec('SAVEPOINT retry_reflection_with_readiness');
  try{
    const work=db.prepare("SELECT c.word_id,j.kind FROM vocabulary_reflection_jobs j JOIN reflection_cases c USING(case_id) WHERE j.job_id=? AND j.status='failed'").get(jobId) as {word_id:string|null;kind:string}|undefined;
    retryVocabularyReflectionJob(jobId,actorId);
    if(work?.kind==='exercise_improvement'&&work.word_id){
      if(db.prepare("SELECT 1 FROM vocabulary_sense_readiness WHERE word_id=? AND status='failed'").get(work.word_id))retryVocabularySenseReadiness(work.word_id,actorId);
      if(db.prepare("SELECT 1 FROM vocabulary_default_selection_readiness WHERE word_id=? AND status='failed'").get(work.word_id))retryDefaultUsefulSelection(work.word_id,actorId);
    }
    db.exec('RELEASE retry_reflection_with_readiness');
  }catch(error){db.exec('ROLLBACK TO retry_reflection_with_readiness; RELEASE retry_reflection_with_readiness');throw error;}
}
