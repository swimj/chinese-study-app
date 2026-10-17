import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { assertVocabularyCutoverReady } from '../server/db/vocabulary-cutover.ts';
test('learner conversion refuses unfinished legacy effects across learners without changing evidence',()=>{
 const db=new DatabaseSync(':memory:');
 try{
  db.exec(`CREATE TABLE learner_session_completions(learner_id TEXT,status TEXT);CREATE TABLE learner_owned_reflection_operation_invocations(learner_id TEXT,application_state TEXT);`);
  assertVocabularyCutoverReady(db);
  db.exec("INSERT INTO learner_session_completions VALUES('other-learner','failed')");
  assert.throws(()=>assertVocabularyCutoverReady(db),/1 session completions/);
  assert.equal(db.prepare('SELECT status FROM learner_session_completions').get()!.status,'failed');
  db.exec("UPDATE learner_session_completions SET status='closed';INSERT INTO learner_owned_reflection_operation_invocations VALUES('another','pending')");
  assert.throws(()=>assertVocabularyCutoverReady(db),/1 authorized reflection applications/);
  db.exec("UPDATE learner_owned_reflection_operation_invocations SET application_state='authorization_withdrawn'");
  assertVocabularyCutoverReady(db);
 }finally{db.close();}
});
