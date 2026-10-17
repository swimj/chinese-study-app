import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { before,after,beforeEach,afterEach,test } from 'node:test';
import { createBaselineFixture } from './helpers/baseline-database.ts';
import { migrateDatabase } from '../server/db/migrations.ts';
import { setDb } from '../server/db/connection.ts';
import { runWithLearnerId } from '../server/db/learner-context.ts';
import { addVocabularyStashByHanzi,updateVocabularyStashPriority } from '../server/db/vocabulary-stash.ts';
import { addVocabularyWord,changeVocabularyMode,dismissVocabularyWord,getVocabularyLearnerWord } from '../server/db/vocabulary-learners.ts';
import { listUnstudiedPriorityMatchesByTarget,getPrioritizedUnstudiedWords } from '../server/db/persistence.ts';
let root:string,baseline:string,db:DatabaseSync;const old:Record<string,string|undefined>={};
const owner=<T>(fn:()=>T)=>runWithLearnerId('a',fn);
before(()=>{
  root=fs.mkdtempSync(path.join(os.tmpdir(),'vocabulary-stash-'));const source=path.join(root,'source');createBaselineFixture(source);baseline=path.join(source,'app.db');
  for(const key of ['APP_MODE','APP_DATA_DIR','APP_AUTH_MODE','VITE_STUDY_PROFILE'])old[key]=process.env[key];
  process.env.APP_MODE='study';process.env.APP_DATA_DIR=root;process.env.APP_AUTH_MODE='clerk';
});
after(()=>{for(const[key,value]of Object.entries(old)){if(value===undefined)delete process.env[key];else process.env[key]=value;}fs.rmSync(root,{recursive:true,force:true});});
beforeEach(()=>{
  const file=path.join(root,`${Math.random()}.db`);fs.copyFileSync(baseline,file);db=new DatabaseSync(file);db.exec('PRAGMA foreign_keys=ON');db.function('current_learner_id',()=> 'a');migrateDatabase(db);setDb(db);
  db.exec("INSERT INTO learners(learner_id,display_name,created_at) VALUES ('a','A','2026-10-17'),('b','B','2026-10-17')");
  for(const[wordId,hanzi]of [['one','甲'],['two','乙']])db.prepare(`INSERT INTO lexical_words(id,hanzi,traditional,pinyin,meaning,meanings_json,examples_json,priority,created_at,normalized_hanzi)
    VALUES (?,?,NULL,'jiǎ','first','["first"]','[]',1,'2026-10-17',?)`).run(wordId,hanzi,hanzi);
});
afterEach(()=>db.close());

test('stash addition rolls back priority and membership together if new-state evidence cannot be saved',()=>owner(()=>{
  db.exec("CREATE TRIGGER fail_stash_evidence BEFORE INSERT ON backend_events WHEN NEW.name='vocabulary.word.added' BEGIN SELECT RAISE(ABORT,'evidence unavailable'); END");
  assert.throws(()=>addVocabularyStashByHanzi('甲'),/evidence unavailable/);
  assert.equal(db.prepare('SELECT count(*) AS n FROM learner_owned_user_word_priority').get()!.n,0);
  assert.equal(db.prepare('SELECT count(*) AS n FROM learner_words').get()!.n,0);
  assert.equal(db.prepare('SELECT count(*) AS n FROM learner_word_schedules').get()!.n,0);
}));

test('reset rollback preserves both priority and membership; a successful reset preserves mode and schedule',()=>owner(()=>{
  const added=addVocabularyStashByHanzi('甲');assert.equal(added[0]!.word.id,'one');
  assert.equal(getVocabularyLearnerWord('one')!.inStash,true);
  db.exec("CREATE TRIGGER fail_membership_evidence BEFORE INSERT ON backend_events WHEN NEW.name='vocabulary.stash.membership_changed' BEGIN SELECT RAISE(ABORT,'membership evidence unavailable'); END");
  assert.throws(()=>updateVocabularyStashPriority('one',{reset:true}),/membership evidence unavailable/);
  assert.equal(db.prepare('SELECT count(*) AS n FROM learner_owned_user_word_priority').get()!.n,1);
  assert.equal(getVocabularyLearnerWord('one')!.inStash,true);
  db.exec('DROP TRIGGER fail_membership_evidence');const schedule=db.prepare('SELECT * FROM learner_word_schedules').get();
  updateVocabularyStashPriority('one',{reset:true});assert.equal(getVocabularyLearnerWord('one')!.inStash,false);
  assert.equal(getVocabularyLearnerWord('one')!.mode,'unstudied');assert.equal(getVocabularyLearnerWord('one')!.dismissedAt,null);
  assert.deepEqual(db.prepare('SELECT * FROM learner_word_schedules').get(),schedule);
}));

test('stash matching follows new modes, while explicit re-add finds dismissed words despite stale legacy learning status',()=>owner(()=>{
  const enrolled=addVocabularyWord('one');changeVocabularyMode('one','practice',enrolled.stateVersion);
  assert.equal(listUnstudiedPriorityMatchesByTarget('甲').length,0);
  assert.throws(()=>addVocabularyStashByHanzi('甲'),/No matching unstudied/);
  assert.throws(()=>updateVocabularyStashPriority('one',{forceTop:true}),/Expected unstudied/);
  dismissVocabularyWord('one');db.prepare("INSERT INTO learner_word_state(learner_id,word_id,status) VALUES ('a','one','review') ON CONFLICT(learner_id,word_id) DO UPDATE SET status='review'").run();
  assert.equal(listUnstudiedPriorityMatchesByTarget('甲')[0]!.status,'unstudied');
  addVocabularyStashByHanzi('甲');assert.equal(getVocabularyLearnerWord('one')!.dismissedAt,null);assert.equal(getVocabularyLearnerWord('one')!.inStash,true);
  assert.equal(getPrioritizedUnstudiedWords().words[0]!.word.id,'one');
  dismissVocabularyWord('one');assert.equal(getPrioritizedUnstudiedWords().words.length,0);
}));

test('priority updates do not enroll a different learner or corpus word',()=>owner(()=>{
  updateVocabularyStashPriority('one',{forceTop:true});assert.equal(getVocabularyLearnerWord('one')!.inStash,true);
  assert.equal(getVocabularyLearnerWord('two'),null);
  runWithLearnerId('b',()=>assert.equal(getVocabularyLearnerWord('one'),null));
}));
