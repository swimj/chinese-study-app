import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { before, after, test } from 'node:test';
import { invalidateDeckWordIds } from '../server/db/deck-words.ts';
import { getDb,closeDbConnection } from '../server/db/connection.ts';
import { getVocabularyWordsCollection } from '../server/db/vocabulary-words.ts';
import { addVocabularyWord, changeVocabularyMode, dismissVocabularyWord } from '../server/db/vocabulary-learners.ts';
import { runWithLearnerId } from '../server/db/learner-context.ts';
import { projectVocabularySession, type VocabularySessionAction, type VocabularySessionInitialContext } from '../src/domain/vocabulary-session.ts';
import { saveDietProfile } from '../server/db/diet-profile.ts';
let directory:string;
before(async()=>{
  directory=fs.mkdtempSync(path.join(os.tmpdir(),'vocabulary-words-'));
  process.env.APP_MODE='study';process.env.APP_DATA_DIR=directory;process.env.APP_LEARNER_ID='test-learner';
  process.env.APP_DECK_MANIFEST_PATH=path.resolve('tests/fixtures/mandarin-decks-v1.fixture.json');
  const db=await import('../server/db.ts'); db.bootstrapLearner({learnerId:'other'});
});
after(()=>{closeDbConnection();fs.rmSync(directory,{recursive:true,force:true});});
function insert(id:string,mode:'unstudied'|'solidify'|'practice'|'maintain'='unstudied') {
  getDb().prepare(`INSERT INTO words(id,hanzi,pinyin,meaning,meanings_json,examples_json,personal_notes,status,priority,created_at,learning_streak)
    VALUES (?,?,?,?,'[]','[]','','review',1,'2026-01-01T00:00:00.000Z',0)`).run(id,id,id,id);
  addVocabularyWord(id); if(mode!=='unstudied')changeVocabularyMode(id,mode,1);
}
test('new modes are authoritative even when legacy state disagrees; pagination and literal search retain old collection semantics',()=>{
  for(let n=0;n<55;n++)insert(`word-${String(n).padStart(2,'0')}`,'practice');
  getDb().prepare('UPDATE lexical_words SET meaning=? WHERE id=?').run('100% under_score \\ unique','word-54');
  getDb().prepare('UPDATE lexical_words SET meanings_json=? WHERE id=?').run('["secondary gloss"]','word-53');
  const first=getVocabularyWordsCollection();assert.equal(first.words.length,50);assert.equal(first.hasMore,true);assert.equal(first.total,55);
  assert.equal(getVocabularyWordsCollection({offset:50}).words.length,5);
  for(const query of ['unique','%','_','\\'])assert.deepEqual(getVocabularyWordsCollection({query}).words.map(e=>e.word.id),['word-54']);
  assert.deepEqual(getVocabularyWordsCollection({query:'secondary gloss'}).words.map(e=>e.word.id),['word-53']);
  insert('waiting');assert.equal(getVocabularyWordsCollection({query:'waiting'}).total,0);
  assert.equal(getVocabularyWordsCollection({view:'personal',query:'waiting'}).words[0].word.status,'unstudied');
  dismissVocabularyWord('waiting');assert.equal(getVocabularyWordsCollection({view:'personal',query:'waiting'}).total,0);
  assert.equal(runWithLearnerId('other',()=>getVocabularyWordsCollection()).total,0);
});
test('study dates combine retained history and current schedules; modes filter before pagination',()=>{
  insert('learning','solidify');insert('maintained','maintain');
  getDb().prepare('UPDATE learner_word_schedules SET last_practised_at=? WHERE word_id=?').run('2026-10-25T12:00:00.000Z','learning');
  getDb().prepare("UPDATE words SET last_learning_covered_on='2026-09-10' WHERE id='learning'").run();
  const found=getVocabularyWordsCollection({modes:['solidify']});assert.equal(found.total,1);assert.equal(found.words[0].lastStudiedAt,'2026-10-25');
  assert.equal(getVocabularyWordsCollection({modes:['maintain']}).words[0].word.id,'maintained');
  assert.equal(getVocabularyWordsCollection({modes:['unstudied']}).total,57);
});
test('deck uses existing lexical membership and includes unenrolled words without creating learner state',()=>{
  getDb().prepare(`INSERT INTO words(id,hanzi,pinyin,meaning,meanings_json,examples_json,personal_notes,status,priority,created_at,learning_streak)
    VALUES ('deck-only','我','wǒ','I','[]','[]','','unstudied',1,'2026-01-01T00:00:00.000Z',0)`).run();
  assert.equal(getVocabularyWordsCollection({view:'deck'}).currentDeck,null);
  invalidateDeckWordIds();
  saveDietProfile({version:1,weights:{'hsk2-l1':1},provenance:[],updatedAt:'2026-10-27T00:00:00.000Z'});
  const found=getVocabularyWordsCollection({view:'deck'});assert.equal(found.total,1);assert.equal(found.words[0].stateVersion,null);assert.equal(found.words[0].word.status,'unstudied');
  assert.equal(getDb().prepare("SELECT count(*) AS n FROM learner_words WHERE word_id='deck-only'").get()?.n,0);
});

test('recent lapses and dates use closed effective responses, excluding undone misses and independent cues',()=>{
  const today=new Date().toISOString();
  for(const id of ['lapse','undone','independent'])insert(id,'practice');
  for(const [id,undo,pure] of [['lapse',false,false],['undone',true,false],['independent',false,true]] as const){
    const context:VocabularySessionInitialContext={sessionId:id,words:[{wordId:id,mode:'practice'}]};
    const actions:VocabularySessionAction[]=[{protocolVersion:1,actionId:id+'-p',clientActionId:'p',sequence:1,occurredAt:today,kind:'presentation',payload:{encounterId:id,wordId:pure?null:id,snapshot:{contentId:id,contentVersion:1,kind:'production',role:'general',body:{prompt:'x'},assessment:{acceptedAnswers:['x']},...(pure?{schedulingScope:'pure_cue' as const}:{})}}},
      {protocolVersion:1,actionId:id+'-r',clientActionId:'r',sequence:2,occurredAt:today,kind:'response',payload:{encounterId:id,response:null,outcome:'rejected'}}];
    if(undo)actions.push({protocolVersion:1,actionId:id+'-u',clientActionId:'u',sequence:3,occurredAt:today,kind:'undo',payload:{undoesActionId:id+'-r'}});
    const report=projectVocabularySession(context,actions);
    getDb().prepare(`INSERT INTO vocabulary_sessions(session_id,learner_id,protocol_version,context_json,started_at,closed_at,status) VALUES (?,'test-learner',1,?, ?,?,'closed')`).run(id,JSON.stringify(context),today,today);
    getDb().prepare(`INSERT INTO vocabulary_session_completions(completion_id,learner_id,session_id,revision_number,through_sequence,staged_at,close_at,status,input_json,report_json,policy_version,closed_at)
      VALUES (?,'test-learner',?,1,?,?,?,'closed','{}',?,'test',?)`).run(id,id,actions.length,today,today,JSON.stringify(report),today);
  }
  assert.deepEqual(getVocabularyWordsCollection({recentLapses:true}).words.map(e=>e.word.id),['lapse']);
  assert.equal(getVocabularyWordsCollection({query:'lapse'}).words[0].lastStudiedAt,today.slice(0,10));
  assert.equal(getVocabularyWordsCollection({query:'undone'}).words[0].lastStudiedAt,null);
});

test('legacy deck dismissal does not hide a word explicitly added in the new lifecycle',()=>{
  getDb().prepare(`INSERT INTO user_word_priority(word_id,priority_tier,bump_count,force_top,required_for_next_session,updated_at) VALUES ('deck-only',-1,0,0,0,'2026-10-20T00:00:00.000Z')`).run();
  assert.equal(getVocabularyWordsCollection({view:'deck'}).total,0);
  addVocabularyWord('deck-only');
  assert.equal(getVocabularyWordsCollection({view:'deck'}).total,1);
});
test('legacy learning lapses expire and newer clean vocabulary coverage supersedes frozen learning counters',()=>{
  insert('old-learning','solidify');insert('new-clean','solidify');
  getDb().prepare("UPDATE words SET last_learning_success_on='2020-01-01',last_learning_covered_on='2020-01-02' WHERE id='old-learning'").run();
  const today=new Date().toISOString();
  getDb().prepare("UPDATE words SET last_learning_success_on='2020-01-01',last_learning_covered_on=? WHERE id='new-clean'").run(today.slice(0,10));
  assert.equal(getVocabularyWordsCollection({query:'old-learning',recentLapses:true}).total,0);
  assert.equal(getVocabularyWordsCollection({query:'new-clean',recentLapses:true}).total,1);
  const context:VocabularySessionInitialContext={sessionId:'new-clean',words:[{wordId:'new-clean',mode:'practice'}]};
  const actions:VocabularySessionAction[]=[{protocolVersion:1,actionId:'clean-p',clientActionId:'p',sequence:1,occurredAt:today,kind:'presentation',payload:{encounterId:'clean',wordId:'new-clean',snapshot:{contentId:'clean',contentVersion:1,kind:'production',role:'general',body:{prompt:'x'},assessment:{acceptedAnswers:['x']}}}},
    {protocolVersion:1,actionId:'clean-r',clientActionId:'r',sequence:2,occurredAt:today,kind:'response',payload:{encounterId:'clean',response:'x',outcome:'accepted'}}];
  const report=projectVocabularySession(context,actions);
  getDb().prepare(`INSERT INTO vocabulary_sessions(session_id,learner_id,protocol_version,context_json,started_at,closed_at,status) VALUES ('new-clean','test-learner',1,?, ?,?,'closed')`).run(JSON.stringify(context),today,today);
  getDb().prepare(`INSERT INTO vocabulary_session_completions(completion_id,learner_id,session_id,revision_number,through_sequence,staged_at,close_at,status,input_json,report_json,policy_version,closed_at)
    VALUES ('new-clean','test-learner','new-clean',1,2,?,?,'closed','{}',?,'test',?)`).run(today,today,JSON.stringify(report),today);
  assert.equal(getVocabularyWordsCollection({query:'new-clean',recentLapses:true}).total,0);
  assert.equal(runWithLearnerId('other',()=>getVocabularyWordsCollection({recentLapses:true})).total,0);
});
