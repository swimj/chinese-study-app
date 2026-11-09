import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, test } from 'node:test';
import { bulkRepertoireBlockers, selectBulkRepertoireWords } from '../server/db/bulk-repertoire-selection.ts';
let db:DatabaseSync;
const now='2026-11-09T00:00:00.000Z';
beforeEach(()=>{
  db=new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE learners(learner_id TEXT PRIMARY KEY,disabled_at TEXT);
    CREATE TABLE learner_words(learner_id TEXT,word_id TEXT,mode TEXT,in_stash INTEGER,dismissed_at TEXT);
    CREATE TABLE learner_word_schedules(learner_id TEXT,word_id TEXT,next_eligible_at TEXT);
    CREATE TABLE content_items(content_id TEXT PRIMARY KEY,kind TEXT,exercise_role TEXT,skill TEXT,exercise_type TEXT,assessment_json TEXT,body_json TEXT,availability TEXT,access_scope TEXT);
    CREATE TABLE content_words(content_id TEXT,word_id TEXT,relation TEXT);
    CREATE TABLE exercise_answer_words(exercise_id TEXT,word_id TEXT);
    CREATE TABLE reflection_cases(case_id TEXT PRIMARY KEY,word_id TEXT,content_id TEXT);
    CREATE TABLE content_proposals(proposal_id TEXT PRIMARY KEY,case_id TEXT,status TEXT,operations_json TEXT);
    CREATE TABLE proposal_content_bases(proposal_id TEXT,content_id TEXT);
    CREATE TABLE vocabulary_reflection_jobs(job_id TEXT,case_id TEXT,status TEXT);
    CREATE TABLE sense_content_reconciliations(resolution_id TEXT,word_id TEXT,status TEXT,completed_at TEXT);
    CREATE TABLE vocabulary_sense_readiness(word_id TEXT,status TEXT);
    CREATE TABLE vocabulary_default_selection_readiness(word_id TEXT,status TEXT);
    CREATE TABLE vocabulary_practice_preparation(word_id TEXT,status TEXT);
    INSERT INTO learners VALUES ('alice',NULL),('bob',NULL),('disabled','2026-01-01');`);
});
afterEach(()=>db.close());
function track(learner:string,word:string,due:string|null,mode='practice',stash=0,dismissed:string|null=null){
  db.prepare('INSERT INTO learner_words VALUES (?,?,?,?,?)').run(learner,word,mode,stash,dismissed);
  db.prepare('INSERT INTO learner_word_schedules VALUES (?,?,?)').run(learner,word,due);
}
function content(id:string,word:string,source:unknown,options:{role?:string;availability?:string;scope?:string;type?:string;responseMode?:string}={}){
  db.prepare('INSERT INTO content_items VALUES (?,?,?,?,?,?,?,?,?)').run(id,'exercise',options.role??'general','production',options.type??'definition_gloss',JSON.stringify({responseMode:options.responseMode??'hanzi_entry'}),JSON.stringify({source}),options.availability??'active',options.scope??'shared');
  db.prepare('INSERT INTO content_words VALUES (?,?,?)').run(id,word,'target');
  db.prepare('INSERT INTO exercise_answer_words VALUES (?,?)').run(id,word);
}
function proposal(id:string,status:string,operations:unknown=[],caseId:string|null=null){db.prepare('INSERT INTO content_proposals VALUES (?,?,?,?)').run(id,caseId,status,JSON.stringify(operations));}

test('all tracked words include pre-teaching review and stash, exclude dismissed/disabled/untracked',()=>{
  track('alice','legacy','2026-11-01'); track('alice','stash',null,'unstudied',1);
  track('alice','not-tracked',null,'unstudied'); track('alice','dismissed',null,'practice',0,now); track('disabled','disabled-only',null);
  assert.deepEqual(selectBulkRepertoireWords(db,10,now).words.map(w=>w.wordId),['legacy','stash']);
  assert.deepEqual(bulkRepertoireBlockers(db,'disabled-only'),['not_tracked']);
});
test('round robin deduplicates shared words without charging a duplicate turn and redistributes exhausted quota',()=>{
  track('alice','shared','2026-11-01'); track('alice','a','2026-11-03');
  track('bob','shared','2026-11-01'); track('bob','b','2026-11-02'); track('bob','c','2026-11-04'); track('bob','d','2026-11-05');
  const result=selectBulkRepertoireWords(db,5,now);
  assert.deepEqual(result.words.map(w=>[w.wordId,w.selectedForLearnerId]),[['shared','alice'],['b','bob'],['a','alice'],['c','bob'],['d','bob']]);
  assert.deepEqual(result.words[0]!.beneficiaryLearnerIds,['alice','bob']);
  assert.deepEqual(result.learnerAllocations.map(r=>r.selectedWordCount),[2,3]);
  assert.equal(result.eligibleWordCount,5);
});
test('date order is stable; studied null means now and unstudied null follows dated demand',()=>{
  track('alice','unstudied',null,'unstudied',1); track('alice','now',null);
  track('alice','future','2026-11-10');track('alice','b','2026-11-01');track('alice','a','2026-11-01');
  assert.deepEqual(selectBulkRepertoireWords(db,10,now).words.map(w=>w.wordId),['a','b','now','future','unstudied']);
});
test('authored general repertoire blocks even private or retired; fallback and teaching do not',()=>{
  for(const word of ['private','retired','baseline','supplement','teaching','contrast','choice','authored'])track('alice',word,null);
  content('private','private',{kind:'vocabulary_repertoire'},{scope:'private'});
  content('retired','retired',{kind:'general_exercises'},{availability:'retired'});
  content('baseline','baseline',{kind:'dictionary_baseline'});
  content('supplement','supplement',{kind:'production_cue_supplement',cueId:null});
  content('teaching','teaching',{kind:'general_exercises'},{role:'teaching'});
  content('contrast','contrast',{kind:'contrast'},{type:'contrast'});
  content('choice','choice',{kind:'choice'},{responseMode:'word_choice'});
  content('authored','authored',{kind:'authored_prompt'});
  assert.deepEqual(selectBulkRepertoireWords(db,10,now).words.map(w=>w.wordId),['baseline','choice','contrast','supplement','teaching']);
  assert.deepEqual(bulkRepertoireBlockers(db,'retired'),['authored_repertoire']);
});
test('outstanding proposals block via case word, case content, bases, source and proposed target JSON',()=>{
  for(const word of ['case','case-content','base','source','new','closed','applied','context'])track('alice',word,null);
  for(const word of ['case-content','base','source'])content(word,word,{kind:'dictionary_baseline'});
  db.exec("INSERT INTO reflection_cases VALUES ('case-id','case',NULL),('content-case',NULL,'case-content')");
  proposal('case','draft',[],'case-id'); proposal('case-content','awaiting_review',[],'content-case');
  proposal('base','approved');db.exec("INSERT INTO proposal_content_bases VALUES ('base','base')");
  proposal('source','draft',[{sourceContentId:'source'}]);
  proposal('new','awaiting_review',[{content:{words:[{wordId:'new',relation:'target'},{wordId:'context',relation:'context'}]}}]);
  proposal('closed','closed',[{content:{words:[{wordId:'closed',relation:'target'}]}}]);
  proposal('applied','applied',[{content:{words:[{wordId:'applied',relation:'target'}]}}]);
  assert.deepEqual(selectBulkRepertoireWords(db,10,now).words.map(w=>w.wordId),['applied','closed','context']);
  assert.deepEqual(bulkRepertoireBlockers(db,'new'),['outstanding_proposal']);
  // A new pending proposal after planning must prevent later application.
  proposal('late','awaiting_review',[{content:{words:[{wordId:'closed',relation:'target'}]}}]);
  assert.deepEqual(bulkRepertoireBlockers(db,'closed'),['outstanding_proposal']);
});
test('queued/running jobs block direct and content targets, while finished jobs do not',()=>{
  for(const word of ['queued','running','succeeded'])track('alice',word,null);
  content('running-source','running',{kind:'dictionary_baseline'});
  db.exec("INSERT INTO reflection_cases VALUES ('q','queued',NULL),('r',NULL,'running-source'),('s','succeeded',NULL); INSERT INTO vocabulary_reflection_jobs VALUES ('q','q','queued'),('r','r','running'),('s','s','succeeded')");
  assert.deepEqual(selectBulkRepertoireWords(db,10,now).words.map(w=>w.wordId),['succeeded']);
  assert.deepEqual(bulkRepertoireBlockers(db,'running'),['active_reflection_job']);
});


test('pending reconciliation and running prerequisite work exclude words while completed historical work does not',()=>{
  for(const word of ['draft','resolved','incomplete','completed','superseded','sense','selection','practice','queued'])track('alice',word,null);
  db.exec("INSERT INTO sense_content_reconciliations VALUES ('d','draft','draft',NULL),('r','resolved','resolved',NULL),('i','incomplete','applied',NULL),('c','completed','applied','2026-01-01'),('old','superseded','applied',NULL),('new','superseded','applied','2026-01-02'); INSERT INTO vocabulary_sense_readiness VALUES ('sense','running'),('queued','queued'); INSERT INTO vocabulary_default_selection_readiness VALUES ('selection','running'); INSERT INTO vocabulary_practice_preparation VALUES ('practice','running')");
  assert.deepEqual(selectBulkRepertoireWords(db,20,now).words.map(w=>w.wordId),['completed','queued','superseded']);
  assert.deepEqual(bulkRepertoireBlockers(db,'draft'),['pending_reconciliation']);
  assert.deepEqual(bulkRepertoireBlockers(db,'sense'),['active_preparation']);
  db.exec("UPDATE vocabulary_sense_readiness SET status='ready' WHERE word_id='sense'");
  assert.deepEqual(bulkRepertoireBlockers(db,'sense'),[]);
});
