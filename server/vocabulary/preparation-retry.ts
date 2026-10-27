import { randomUUID } from 'node:crypto';
import { getDb } from '../db/connection.ts';

type Kind = 'practice' | 'sense';
const target = (kind:Kind) => kind==='practice'
  ? {table:'vocabulary_practice_preparation',key:'work_id'} : {table:'vocabulary_sense_readiness',key:'word_id'};
export function recordPreparationAttempt(kind:Kind,id:string,token:string,at:string):void {
  const {table,key}=target(kind);
  getDb().prepare(`INSERT INTO vocabulary_preparation_attempts
    (attempt_id,preparation_kind,work_id,attempt_number,cycle_attempt,started_at)
    SELECT ?,?,?,total_attempt_count,attempt_count,? FROM ${table} WHERE ${key}=? AND active_token=?`)
    .run(token,kind,id,at,id,token);
}
export function linkPreparationInvocation(token:string,invocationId:string):void {
  getDb().prepare('UPDATE vocabulary_preparation_attempts SET invocation_id=? WHERE attempt_id=? AND outcome IS NULL').run(invocationId,token);
}
export function completePreparationAttempt(token:string,at:string):void {
  getDb().prepare("UPDATE vocabulary_preparation_attempts SET finished_at=?,outcome='ready' WHERE attempt_id=? AND outcome IS NULL").run(at,token);
}
/** A bounded cycle is independent of the lifetime invocation/attempt history. Expired tokens are fenced before retry. */
export function failPreparationAttempt(kind:Kind,id:string,token:string,at:string,code:string,options:{interrupted?:boolean;retryable?:boolean}={}):string|null {
  const db=getDb(),{table,key}=target(kind),savepoint=`retry_${randomUUID().replaceAll('-','')}`;
  db.exec(`SAVEPOINT ${savepoint}`);
  try {
    const row=db.prepare(`SELECT attempt_count,expires_at FROM ${table} WHERE ${key}=? AND status='running' AND active_token=?`).get(id,token) as {attempt_count:number;expires_at:string}|undefined;
    if(!row){db.exec(`RELEASE ${savepoint}`);return null;}
    const interrupted=options.interrupted===true||row.expires_at<=at;
    const retry=(interrupted||options.retryable!==false)&&row.attempt_count<3;
    const next=new Date(Date.parse(at)+30_000*2**(row.attempt_count-1)).toISOString();
    db.prepare(`UPDATE vocabulary_preparation_attempts SET finished_at=?,outcome=?,diagnostic=? WHERE attempt_id=? AND outcome IS NULL`)
      .run(at,interrupted?'interrupted':'failed',code,token);
    db.prepare(`UPDATE ${table} SET status=?,active_token=NULL,expires_at=NULL,last_error=?,updated_at=?,next_attempt_at=? WHERE ${key}=? AND active_token=?`)
      .run(retry?'queued':'failed',code,at,next,id,token);
    db.exec(`RELEASE ${savepoint}`);return retry?next:null;
  }catch(error){db.exec(`ROLLBACK TO ${savepoint}`);db.exec(`RELEASE ${savepoint}`);throw error;}
}
