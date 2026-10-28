import { isVocabularyProductionProxied } from '../server/vocabulary/production-coverage.ts';
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
    CREATE TABLE learner_word_preparation_reserve(learner_id TEXT,word_id TEXT,added_at TEXT,PRIMARY KEY(learner_id,word_id));
    CREATE TABLE learner_word_reserve_requests(learner_id TEXT PRIMARY KEY,requested_at TEXT);
    CREATE TABLE lexical_words(id TEXT PRIMARY KEY,hanzi TEXT,pinyin TEXT,priority INTEGER,created_at TEXT);
    CREATE TABLE learner_word_state(learner_id TEXT,word_id TEXT,status TEXT,learning_streak INTEGER,last_learning_covered_on TEXT);
    CREATE TABLE learner_owned_user_word_priority(learner_id TEXT,word_id TEXT,priority_tier INTEGER,updated_at TEXT);
    CREATE TABLE learner_owned_word_skill_state(learner_id TEXT,word_id TEXT,skill_id TEXT,interval_hours REAL,ease_factor REAL,enabled INTEGER,next_due_at TEXT,last_studied_at TEXT);
    CREATE TABLE learner_owned_word_skill_relevance(learner_id TEXT,word_id TEXT,skill_id TEXT,relevance_state TEXT);
    CREATE TABLE learner_owned_word_study_admission_state(learner_id TEXT,word_id TEXT,earliest_next_study_at TEXT);
    CREATE TABLE learner_settings(learner_id TEXT,setting_key TEXT,value_json TEXT,updated_at TEXT,PRIMARY KEY(learner_id,setting_key));
    CREATE TABLE learner_owned_daily_new_word_intake(learner_id TEXT,day_key TEXT,new_study_count INTEGER);
    CREATE TABLE teaching_completions(learner_id TEXT,source_kind TEXT,completed_at TEXT);
    INSERT INTO learners VALUES('alice'),('bob');
  `);
  for(const file of ['0039_vocabulary_content.sql','0041_vocabulary_learner_state.sql','0047_vocabulary_dismissal.sql','0052_vocabulary_automatic_promotion_pause.sql'])db.exec(fs.readFileSync(new URL(`../server/db/migrations/${file}`,import.meta.url),'utf8'));
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
  const plan=compose();assert.equal(plan.newWordIds.length,3);assert.equal(plan.dueWordIds.length,20);
  assert.equal(plan.newWordIds.length+plan.dueWordIds.length,23);
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

function reviewWord(id:string,elapsedHours:number,intervalHours=24) {
  lexical(id);addVocabularyWord(id);changeVocabularyMode(id,'practice',1);
  const last=new Date(Date.parse(now)-elapsedHours*3_600_000).toISOString();
  const due=new Date(Date.parse(last)+intervalHours*3_600_000).toISOString();
  db.prepare("UPDATE learner_word_schedules SET last_practised_at=?,next_eligible_at=?,scheduler_state_json=? WHERE learner_id='alice' AND word_id=?")
    .run(last,due,JSON.stringify({intervalHours,easeFactor:2.5,enabled:1,cleanCoveredSessions:0}),id);
}
function skill(id:string,kind:'recognition'|'production'|'contextual_selection',elapsedHours:number,intervalHours=24) {
  const last=new Date(Date.parse(now)-elapsedHours*3_600_000).toISOString();
  const due=new Date(Date.parse(last)+intervalHours*3_600_000).toISOString();
  db.prepare("INSERT INTO learner_owned_word_skill_state VALUES('alice',?,?,?,2.5,1,?,?)").run(id,kind,intervalHours,due,last);
}

test('review selects one most urgent objective per word and orders words by that urgency',()=>owner(()=>{
  reviewWord('a',48);skill('a','recognition',96);
  reviewWord('b',72);skill('b','recognition',48);
  // Stale legacy production scheduling must not override the new production schedule.
  skill('b','production',2400);
  const plan=compose();assert.deepEqual(plan.reviewSelections,[{wordId:'a',skillId:'recognition'},{wordId:'b',skillId:'production'}]);
  assert.deepEqual(plan.dueWordIds,['a','b']);
}));

test('review ties use next due time then word and skill identity',()=>owner(()=>{
  reviewWord('a',48,24);skill('a','recognition',96,48);
  reviewWord('b',48,24);skill('b','recognition',48,24);
  assert.deepEqual(compose().reviewSelections,[{wordId:'a',skillId:'recognition'},{wordId:'b',skillId:'production'}]);
}));

test('suppressed or unavailable objectives fall back to eligible recognition without duplicating a word',()=>owner(()=>{
  reviewWord('a',96);skill('a','recognition',48);
  db.prepare("INSERT INTO learner_owned_word_skill_relevance VALUES('alice','a','production','suppressed')").run();
  reviewWord('b',96);skill('b','recognition',48);skill('b','contextual_selection',240);
  const plan=composeVocabularyStudy({now,manifest:null,teachingReady:()=>false,requestTeaching:()=>{},
    canUseSkill:(id,kind)=>kind==='recognition'||(id==='a'&&kind==='contextual_selection')});
  assert.deepEqual(plan.reviewSelections,[{wordId:'a',skillId:'recognition'},{wordId:'b',skillId:'recognition'}]);
}));

test('word recency guard blocks every review skill, and future or disabled objectives are absent',()=>owner(()=>{
  reviewWord('guarded',96);skill('guarded','recognition',240);
  db.prepare("INSERT INTO learner_owned_word_study_admission_state VALUES('alice','guarded','2026-10-18T00:00:00.000Z')").run();
  reviewWord('future',12);skill('future','recognition',12);
  reviewWord('disabled',96);skill('disabled','production',96);
  db.prepare("UPDATE learner_owned_word_skill_state SET enabled=0 WHERE word_id='disabled'").run();
  assert.deepEqual(compose().reviewSelections,[]);
}));

test('contextual review participates in the same one-objective choice when usable',()=>owner(()=>{
  reviewWord('a',48);skill('a','contextual_selection',96);
  const plan=composeVocabularyStudy({now,manifest:null,teachingReady:()=>false,requestTeaching:()=>{},canUseSkill:()=>true});
  assert.deepEqual(plan.reviewSelections,[{wordId:'a',skillId:'contextual_selection'}]);
}));

test('shared session cap redistributes capacity between review and Solidify lanes',()=>owner(()=>{
  for(let index=0;index<600;index++) {
    const id=`solidify-${index}`;lexical(id);addVocabularyWord(id);changeVocabularyMode(id,'solidify',1);
    reviewWord(`practice-${index}`,48);
  }
  const plan=compose();assert.equal(plan.dueWordIds.length,1000);
  assert.equal(plan.reviewSelections.length,600);
  assert.equal(plan.dueWordIds.filter((id)=>id.startsWith('solidify-')).length,400);
  assert.equal(db.prepare('SELECT count(*) AS n FROM learner_words').get()?.n,1200);
}));

test('Solidify admits any word with an enabled recall direction, including recognition behind a disabled production schedule',()=>owner(()=>{
  for(const id of ['recognition-only','production-only','neither']) {
    lexical(id);addVocabularyWord(id);changeVocabularyMode(id,'solidify',1);
  }
  db.prepare("UPDATE learner_word_schedules SET scheduler_state_json=json_set(scheduler_state_json,'$.enabled',0) WHERE word_id='recognition-only'").run();
  const plan=composeVocabularyStudy({now,manifest:null,teachingReady:()=>false,requestTeaching:()=>{},
    canUseSkill:(id,kind)=>(id==='recognition-only'&&kind==='recognition')||(id==='production-only'&&kind==='production')});
  assert.deepEqual(new Set(plan.dueWordIds),new Set(['recognition-only','production-only']));
  assert.deepEqual(plan.reviewSelections,[]);
}));


function coverageExercise(id:string,wordId:string,options:{pure?:boolean;scope?:'shared'|'private';owner?:string;
  availability?:'active'|'quarantined'|'retired';role?:'teaching'|'general';fallback?:boolean}={}) {
  return createVocabularyContent({contentId:id,kind:'exercise',payloadVersion:1,
    body:options.fallback?{prompt:'dictionary gloss',source:{kind:'production_cue_supplement',cueId:null}}:{prompt:'distinctive authored use'},
    exerciseType:options.pure?'pure_cue':'definition_gloss',skill:'production',exerciseRole:options.role??'general',
    accessScope:options.scope??'shared',ownerLearnerId:options.scope==='private'?(options.owner??'alice'):undefined,
    availability:options.availability??'active',originKind:'human',words:[{wordId,relation:'target'}],
    assessment:{match:'prepared'},answers:[{wordId,acceptedForms:[wordId]}]},{kind:'operator',id:'test'});
}

test('shared pure repertoire proxies production before capacity allocation, without requiring cue adoption',()=>owner(()=>{
  reviewWord('proxied',96);reviewWord('ordinary',48);
  coverageExercise('shared-pure','proxied',{pure:true});
  assert.equal(isVocabularyProductionProxied('proxied'),true);
  assert.deepEqual(compose().reviewSelections,[{wordId:'ordinary',skillId:'production'}]);
  assert.equal(db.prepare('SELECT count(*) AS n FROM learner_pure_cue_schedules').get()?.n,0);
  // Recognition remains independently due; proxy does not write suppression.
  skill('proxied','recognition',72);
  assert.deepEqual(compose().reviewSelections,[{wordId:'proxied',skillId:'recognition'},{wordId:'ordinary',skillId:'production'}]);
  assert.equal(db.prepare('SELECT count(*) AS n FROM learner_owned_word_skill_relevance').get()?.n,0);
  db.prepare("UPDATE learner_words SET mode='maintain' WHERE word_id='proxied'").run();
  assert.equal(compose().reviewSelections.find(item=>item.wordId==='proxied')?.skillId,'recognition');
}));

for(const availability of ['quarantined','retired'] as const)test(`${availability} pure content does not proxy production`,()=>owner(()=>{
  reviewWord('word',48);coverageExercise('pure','word',{pure:true,availability});
  assert.equal(isVocabularyProductionProxied('word'),false);
  assert.deepEqual(compose().reviewSelections,[{wordId:'word',skillId:'production'}]);
}));

test('private pure content does not change shared proxy coverage',()=>owner(()=>{
  reviewWord('word',48);coverageExercise('private-pure','word',{pure:true,scope:'private'});
  assert.equal(isVocabularyProductionProxied('word'),false);
  assert.deepEqual(compose().dueWordIds,['word']);
}));

test('only active shared general targeted content removes proxy coverage; fallback supplements do not',()=>owner(()=>{
  reviewWord('word',48);lexical('unrelated');coverageExercise('pure','word',{pure:true});
  coverageExercise('unrelated-targeted','unrelated');
  coverageExercise('teaching','word',{role:'teaching'});
  coverageExercise('retired','word',{availability:'retired'});
  coverageExercise('quarantined','word',{availability:'quarantined'});
  coverageExercise('enriched-fallback','word',{fallback:true});
  assert.equal(isVocabularyProductionProxied('word'),true);
  assert.deepEqual(compose().dueWordIds,[]);
  coverageExercise('targeted','word');
  assert.equal(isVocabularyProductionProxied('word'),false);
  assert.deepEqual(compose().dueWordIds,['word']);
  db.prepare("UPDATE content_items SET availability='retired' WHERE content_id='targeted'").run();
  assert.equal(isVocabularyProductionProxied('word'),true);
  assert.deepEqual(compose().dueWordIds,[]);
}));

test('private targeted exception is learner-scoped, respects deactivation and preserves explicit suppression',()=>owner(()=>{
  reviewWord('word',48);coverageExercise('pure','word',{pure:true});
  coverageExercise('other-owner','word',{scope:'private',owner:'bob'});
  assert.deepEqual(compose().dueWordIds,[]);
  coverageExercise('own','word',{scope:'private'});
  assert.equal(isVocabularyProductionProxied('word'),true);
  assert.deepEqual(compose().dueWordIds,['word']);
  db.prepare("INSERT INTO learner_owned_word_skill_relevance VALUES('alice','word','production','suppressed')").run();
  assert.deepEqual(compose().dueWordIds,[]);
  assert.equal(isVocabularyProductionProxied('word'),true);
  db.prepare("DELETE FROM learner_owned_word_skill_relevance WHERE learner_id='alice'").run();
  db.prepare("INSERT INTO learner_content_deactivations VALUES('alice','own',?)").run(now);
  assert.deepEqual(compose().dueWordIds,[]);
  db.prepare("INSERT INTO learner_content_deactivations VALUES('alice','pure',?)").run(now);
  assert.equal(isVocabularyProductionProxied('word'),true,'learner deactivation does not rewrite shared repertoire coverage');
  assert.deepEqual(compose().dueWordIds,[]);
}));
