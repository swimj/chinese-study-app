import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {beforeEach,afterEach,test} from 'node:test';
import {setDb} from '../server/db/connection.ts';
import {runWithLearnerId} from '../server/db/learner-context.ts';
import {addVocabularyWord,changeVocabularyMode,dismissVocabularyWord} from '../server/db/vocabulary-learners.ts';
import {createVocabularyContent} from '../server/db/vocabulary-content.ts';
import {composeVocabularyStudy,remainingVocabularyNewWordQuota} from '../server/vocabulary/composition.ts';
import type {DeckManifest} from '../server/decks/manifest.ts';
let db:DatabaseSync;let ready:Set<string>;let requested:string[];
const now='2026-10-17T10:00:00.000Z';const owner=<T>(fn:()=>T)=>runWithLearnerId('alice',fn);
beforeEach(()=>{
  db=new DatabaseSync(':memory:');setDb(db);db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE learners(learner_id TEXT PRIMARY KEY);
    CREATE TABLE lexical_words(id TEXT PRIMARY KEY,hanzi TEXT,pinyin TEXT,priority INTEGER,created_at TEXT);
    CREATE TABLE learner_word_state(learner_id TEXT,word_id TEXT,status TEXT,learning_streak INTEGER,last_learning_covered_on TEXT);
    CREATE TABLE learner_owned_user_word_priority(learner_id TEXT,word_id TEXT,priority_tier INTEGER,updated_at TEXT);
    CREATE TABLE learner_owned_word_skill_state(learner_id TEXT,word_id TEXT,skill_id TEXT,interval_hours REAL,ease_factor REAL,enabled INTEGER,next_due_at TEXT,last_studied_at TEXT);
    CREATE TABLE learner_owned_word_study_admission_state(learner_id TEXT,word_id TEXT,earliest_next_study_at TEXT);
    CREATE TABLE learner_settings(learner_id TEXT,setting_key TEXT,value_json TEXT,updated_at TEXT,PRIMARY KEY(learner_id,setting_key));
    CREATE TABLE learner_owned_daily_new_word_intake(learner_id TEXT,day_key TEXT,new_study_count INTEGER);
    CREATE TABLE teaching_completions(learner_id TEXT,source_kind TEXT,completed_at TEXT);
    INSERT INTO learners VALUES('alice'),('bob');
  `);
  for(const file of ['0037_vocabulary_content.sql','0039_vocabulary_learner_state.sql','0045_vocabulary_dismissal.sql'])db.exec(fs.readFileSync(new URL(`../server/db/migrations/${file}`,import.meta.url),'utf8'));
  ready=new Set();requested=[];
});
afterEach(()=>db.close());
function settings(name:string,value:unknown){db.prepare("INSERT OR REPLACE INTO learner_settings VALUES('alice',?,?,?)").run(name,JSON.stringify(value),now);}
function lexical(id:string,priority=0){db.prepare('INSERT INTO lexical_words VALUES(?,?,?,?,?)').run(id,id,'a',priority,now);}
function prepared(id:string){ready.add(id);createVocabularyContent({contentId:`intro-${id}`,kind:'introduction',payloadVersion:1,body:{text:id},
  accessScope:'shared',availability:'active',originKind:'human',words:[{wordId:id,relation:'target'}],teachingExercises:[]},{kind:'operator',id:'test'});}
function compose(manifest:DeckManifest|null=null){return composeVocabularyStudy({now,manifest,teachingReady:(id)=>ready.has(id),requestTeaching:(id)=>{requested.push(id);}});}

test('daily UTC quota combines retained historical intake and new completed teaching, not admission',()=>owner(()=>{
  settings('daily_new_word_limit',5);
  db.prepare("INSERT INTO learner_owned_daily_new_word_intake VALUES('alice','2026-10-17',2),('bob','2026-10-17',50)").run();
  db.prepare("INSERT INTO teaching_completions VALUES('alice','session','2026-10-17T01:00:00.000Z'),('alice','legacy_import','2026-10-17T02:00:00.000Z'),('alice','session','2026-10-16T23:59:59.000Z')").run();
  assert.equal(remainingVocabularyNewWordQuota(now),2);
  for(let i=0;i<5;i++){lexical(`new-${i}`);prepared(`new-${i}`);}
  assert.equal(compose().newWordIds.length,2);assert.equal(remainingVocabularyNewWordQuota(now),2);
}));

test('ready new words receive capacity even behind many due Solidify words',()=>owner(()=>{
  for(let i=0;i<20;i++){const id=`due-${i}`;lexical(id);addVocabularyWord(id);changeVocabularyMode(id,'solidify',1);}
  for(let i=0;i<3;i++){const id=`new-${i}`;lexical(id);prepared(id);}
  const plan=compose();assert.equal(plan.newWordIds.length,3);assert.equal(plan.dueWordIds.length,9);
  assert.equal(plan.newWordIds.length+plan.dueWordIds.length,12);
  assert.equal(db.prepare("SELECT count(*) AS n FROM learner_words WHERE word_id LIKE 'new-%'").get()?.n,0);
}));

test('stash-only admission honors top priority and does not consume ready corpus material',()=>owner(()=>{
  settings('daily_new_word_limit',1);settings('unstudied_admission_source','stash_only');
  for(const id of ['regular','top','corpus']){lexical(id);prepared(id);}
  addVocabularyWord('regular');addVocabularyWord('top');
  db.prepare("INSERT INTO learner_owned_user_word_priority VALUES('alice','top',1,?)").run(now);
  assert.deepEqual(compose().newWordIds,['top']);
}));

test('weighted deck choice uses lexical membership while lifecycle eligibility uses only new learner state',()=>owner(()=>{
  settings('daily_new_word_limit',2);settings('stash_diet_split',0);
  const manifest:DeckManifest={meta:{manifestVersion:1},decks:[{id:'easy',order:0,hsk:{version:'2.0',level:1},stratum:null,size:1},{id:'hard',order:1,hsk:{version:'2.0',level:6},stratum:null,size:1},{id:'tail',order:2,hsk:null,stratum:null,size:0}],assignments:{'easy|a':'easy','hard|a':'hard'}};
  settings('diet_profile',{version:1,weights:{easy:1},provenance:[],updatedAt:now});
  for(const id of ['easy','hard']){lexical(id);prepared(id);}
  const plan=compose(manifest);assert.equal(plan.newWordIds[0],'easy');assert.deepEqual(plan.newWordIds,['easy','hard']);
}));

test('unready teaching queues bounded demand without enrollment and dismissed words remain excluded',()=>owner(()=>{
  settings('daily_new_word_limit',2);settings('unstudied_admission_source','stash_only');
  for(const id of ['pending','dismissed'])lexical(id);
  addVocabularyWord('pending');addVocabularyWord('dismissed');dismissVocabularyWord('dismissed');prepared('dismissed');
  const before=db.prepare('SELECT count(*) AS n FROM learner_words').get()?.n;
  const plan=compose();assert.deepEqual(plan.newWordIds,[]);assert.deepEqual(requested,['pending']);
  assert.equal(db.prepare('SELECT count(*) AS n FROM learner_words').get()?.n,before);
}));

test('unstudied non-stash diet enrollment remains selectable until explicitly dismissed',()=>owner(()=>{
  settings('stash_diet_split',0);lexical('diet');prepared('diet');
  db.prepare("INSERT INTO learner_words(learner_id,word_id,in_stash,added_at,mode,mode_changed_at) VALUES('alice','diet',0,?,'unstudied',?)").run(now,now);
  db.prepare("INSERT INTO learner_word_schedules(learner_id,word_id,policy_version,scheduler_state_json) VALUES('alice','diet','test','{\"enabled\":1}')").run();
  assert.deepEqual(compose().newWordIds,['diet']);dismissVocabularyWord('diet');assert.deepEqual(compose().newWordIds,[]);
}));
