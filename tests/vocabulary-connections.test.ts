import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { before,after,test } from 'node:test';
import { getDb } from '../server/db/connection.ts';
import { runWithLearnerId } from '../server/db/learner-context.ts';
import { createVocabularyContent } from '../server/db/vocabulary-content.ts';
import { createVocabularySession,appendVocabularySessionActions,stageVocabularySessionCompletion,closeVocabularySessionCompletion } from '../server/db/vocabulary-sessions.ts';
import { vocabularyConnectionsInventory } from '../server/vocabulary/connections.ts';
import { getSessionDebrief,setDebriefInterests,claimSessionDebrief } from '../server/db/session-debrief.ts';
import { createSessionDebriefWorker } from '../server/session-debrief/worker.ts';
import { DEBRIEF_PRICING } from '../server/session-debrief/provider.ts';
import type { VocabularySessionAction,VocabularySessionProjection } from '../src/domain/vocabulary-session.ts';
let directory:string;
const at='2026-10-17T10:00:00.000Z',closed='2026-10-17T10:00:16.000Z';
const owner=<T>(work:()=>T)=>runWithLearnerId('connections-owner',work);
before(async()=>{
  directory=fs.mkdtempSync(path.join(os.tmpdir(),'vocabulary-connections-'));
  Object.assign(process.env,{APP_MODE:'study',APP_AUTH_MODE:'clerk',APP_DATA_DIR:directory});
  const app=await import('../server/db.ts');app.bootstrapLearner({learnerId:'connections-owner'});app.bootstrapLearner({learnerId:'connections-other'});
  for(const[id,hanzi]of [['connections-word','报备'],['connections-alternate','报告']])getDb().prepare(`INSERT INTO lexical_words(id,hanzi,pinyin,meaning,meanings_json,examples_json,priority,created_at)
    VALUES (?,?,'bào bèi','report in advance','[]','[]',10,?)`).run(id,hanzi,at);
  getDb().prepare(`INSERT INTO learner_words(learner_id,word_id,in_stash,added_at,mode,mode_changed_at) VALUES ('connections-owner','connections-word',1,?,'practice',?)`).run(at,at);
  getDb().prepare(`INSERT INTO learner_word_schedules(learner_id,word_id,next_eligible_at,policy_version,scheduler_state_json)
    VALUES ('connections-owner','connections-word',?,'fixture','{"intervalHours":24,"easeFactor":2.5,"enabled":1,"cleanCoveredSessions":0}')`).run(at);
  createVocabularyContent({contentId:'connections-cue',kind:'exercise',payloadVersion:1,body:{prompt:'Report a plan in advance'},exerciseType:'definition',skill:'production',exerciseRole:'general',assessment:{match:'exact'},
    accessScope:'shared',availability:'active',originKind:'human',words:[{wordId:'connections-word',relation:'target'}],answers:[{wordId:'connections-word',acceptedForms:['报备']}]},{kind:'operator',id:'test'});
  createVocabularyContent({contentId:'connections-pure',kind:'exercise',payloadVersion:1,body:{prompt:'Report a plan'},exerciseType:'pure_cue',skill:'production',exerciseRole:'general',assessment:{match:'exact'},
    accessScope:'shared',availability:'active',originKind:'human',words:[{wordId:'connections-word',relation:'target'},{wordId:'connections-alternate',relation:'target'}],
    answers:[{wordId:'connections-word',acceptedForms:['报备']},{wordId:'connections-alternate',acceptedForms:['报告']}]},{kind:'operator',id:'test'});
});
after(()=>{getDb().close();fs.rmSync(directory,{recursive:true,force:true});});
function stage(id:string,count=15){return owner(()=>{
  createVocabularySession({sessionId:id,words:[{wordId:'connections-word',mode:'practice'}]},at);
  const inputs:({kind:string;payload:unknown})[]=Array.from({length:count},(_,index)=>({kind:'presentation',payload:{encounterId:`${id}-e-${index}`,wordId:'connections-word',
    snapshot:{contentId:'connections-cue',contentVersion:1,kind:'production',role:'general',body:{prompt:'Report a plan in advance',material:{prompt:'Report a plan in advance'}},assessment:{acceptedAnswers:['报备'],criteria:{match:'exact'}}}}}));
  inputs.push({kind:'finish_for_now',payload:{}},{kind:'finish_immediately',payload:{}});
  const actions=inputs.map((input,index)=>({...input,protocolVersion:1,actionId:`${id}-a-${index}`,clientActionId:`${id}-c-${index}`,sequence:index+1,occurredAt:at})) as VocabularySessionAction[];
  appendVocabularySessionActions(id,actions,at);return stageVocabularySessionCompletion(id,actions.length,at);
});}

test('debrief migration preserves legacy jobs, attempts and immutability while admitting exact new sources',()=>{
  const sql=new DatabaseSync(':memory:');try{
    sql.exec(`PRAGMA foreign_keys=ON;CREATE TABLE learners(learner_id TEXT PRIMARY KEY);INSERT INTO learners VALUES ('a');
      CREATE TABLE learner_owned_review_session_summaries(learner_id TEXT,session_id TEXT,PRIMARY KEY(learner_id,session_id));
      INSERT INTO learner_owned_review_session_summaries VALUES ('a','legacy');
      CREATE TABLE vocabulary_session_completions(learner_id TEXT,session_id TEXT,completion_id TEXT PRIMARY KEY);`);
    sql.exec(fs.readFileSync(new URL('../server/db/migrations/0023_session_debrief.sql',import.meta.url),'utf8'));
    sql.prepare(`INSERT INTO learner_session_debrief_jobs(learner_id,session_id,completed_at,exercise_count,input_json,status,result_json,updated_at)
      VALUES ('a','legacy',?,0,'{"items":[]}','ready','{"notes":[]}',?)`).run(at,at);
    sql.prepare(`INSERT INTO learner_session_debrief_attempts(learner_id,attempt_id,session_id,started_at,completed_at,outcome,provider,model,reasoning_effort,prompt_version)
      VALUES ('a','attempt','legacy',?,?,'ready','openai','model','low','old')`).run(at,at);
    const original={...sql.prepare('SELECT * FROM learner_session_debrief_jobs').get()},attempt={...sql.prepare('SELECT * FROM learner_session_debrief_attempts').get()};
    sql.exec('PRAGMA foreign_keys=OFF;BEGIN');sql.exec(fs.readFileSync(new URL('../server/db/migrations/0048_vocabulary_connections.sql',import.meta.url),'utf8'));
    assert.deepEqual(sql.prepare('PRAGMA foreign_key_check').all(),[]);sql.exec('COMMIT;PRAGMA foreign_keys=ON');
    const result=sql.prepare('SELECT * FROM learner_session_debrief_jobs').get()!;
    for(const[key,value]of Object.entries(original))assert.equal(result[key],value);
    assert.equal(result.source_kind,'legacy');assert.equal(result.legacy_session_id,'legacy');assert.equal(result.vocabulary_completion_id,null);
    assert.deepEqual({...sql.prepare('SELECT * FROM learner_session_debrief_attempts').get()},attempt);
    assert.throws(()=>sql.exec("UPDATE learner_session_debrief_jobs SET input_json='{}'"),/immutable/);
    assert.throws(()=>sql.exec("UPDATE learner_session_debrief_attempts SET model='changed'"),/immutable/);
  }finally{sql.close();}
});

test('new closure freezes Connections inventory/interests and reuses the async worker without legacy summaries',async()=>{
  owner(()=>setDebriefInterests('rock climbing'));const completion=stage('new-connections');
  const ended=owner(()=>closeVocabularySessionCompletion('new-connections',completion.completionId,closed));
  assert.equal(ended.report.uncoveredWordIds.includes('connections-word'),true);
  const job=owner(()=>getSessionDebrief('new-connections'))!;assert.equal(job.status,'queued');assert.equal(job.exerciseCount,15);
  const source=getDb().prepare("SELECT source_kind,legacy_session_id,vocabulary_completion_id FROM learner_session_debrief_jobs WHERE session_id='new-connections'").get()!;
  assert.equal(source.source_kind,'vocabulary');assert.equal(source.legacy_session_id,null);assert.equal(source.vocabulary_completion_id,completion.completionId);
  assert.equal(getDb().prepare("SELECT count(*) n FROM learner_owned_review_session_summaries WHERE session_id='new-connections'").get()!.n,0);
  owner(()=>setDebriefInterests('reading'));getDb().prepare("UPDATE lexical_words SET pinyin='changed later' WHERE id='connections-word'").run();
  let calls=0;const worker=createSessionDebriefWorker({controls:()=>({maintenanceMode:false,providerWorkEnabled:true}),providerWork:async work=>work(),now:()=>Date.parse(closed),
    provider:{isConfigured:()=>true,generate:async input=>{calls++;assert.deepEqual(input.interests,['rock climbing']);assert.equal(input.items[0]!.pinyin,'bào bèi');
      return {result:{notes:[{text:'A connection from the encountered word.',refs:['w1'],followUp:null}]},metadata:{responseId:'stub',finishReason:'stop',usage:{inputTokens:1,cachedInputTokens:0,cacheWriteInputTokens:null,outputTokens:1,reasoningTokens:0,totalTokens:2},pricing:DEBRIEF_PRICING,estimatedCostUsd:0}};}}});
  await worker.step();await worker.stop();assert.equal(calls,1);assert.equal(owner(()=>getSessionDebrief('new-connections'))!.status,'ready');
  assert.equal(getDb().prepare("SELECT prompt_version FROM learner_session_debrief_attempts WHERE session_id='new-connections'").get()!.prompt_version,'session-debrief-v7');
  assert.equal(runWithLearnerId('connections-other',()=>getSessionDebrief('new-connections')),null);
  assert.deepEqual(getDb().prepare('PRAGMA foreign_key_check').all(),[]);
});

test('Connections enqueue failure rolls back closure and retries retain exactly one frozen job',()=>{
  const completion=stage('connections-fault',1);const before=getDb().prepare("SELECT * FROM learner_word_schedules WHERE learner_id='connections-owner' AND word_id='connections-word'").get();
  getDb().exec("CREATE TRIGGER fail_connections BEFORE INSERT ON learner_session_debrief_jobs BEGIN SELECT RAISE(ABORT,'fixture failure'); END;");
  assert.throws(()=>owner(()=>closeVocabularySessionCompletion('connections-fault',completion.completionId,closed)),/fixture failure/);
  assert.deepEqual(getDb().prepare("SELECT * FROM learner_word_schedules WHERE learner_id='connections-owner' AND word_id='connections-word'").get(),before);
  assert.equal(getDb().prepare("SELECT count(*) n FROM vocabulary_post_session_dispatches WHERE session_id='connections-fault'").get()!.n,0);
  getDb().exec('DROP TRIGGER fail_connections');owner(()=>closeVocabularySessionCompletion('connections-fault',completion.completionId,closed));
  owner(()=>closeVocabularySessionCompletion('connections-fault',completion.completionId,closed));
  assert.equal(getDb().prepare("SELECT count(*) n FROM learner_session_debrief_jobs WHERE session_id='connections-fault'").get()!.n,1);
  assert.equal(owner(()=>getSessionDebrief('connections-fault'))!.status,'ready');
});

test('pure-cue inventory preserves one alternative set without an invented selected target',()=>{
  const projection={encounters:[{wordId:null,snapshot:{contentId:'connections-pure',contentVersion:1}}]} as unknown as VocabularySessionProjection;
  const inventory=vocabularyConnectionsInventory(projection);assert.equal(inventory.length,1);assert.deepEqual(new Set(inventory[0]!.word.split(' / ')),new Set(['报备','报告']));
});

test('contextual Connections inventory uses the authored correct word, never the selected response or admission word',()=>{
  createVocabularyContent({contentId:'connections-context',kind:'exercise',payloadVersion:1,body:{prompt:'A contextual choice',choices:[{wordId:'connections-alternate'},{wordId:'connections-word'}]},exerciseType:'contrast',skill:'contextual_selection',exerciseRole:'general',
    assessment:{responseMode:'word_choice',correctWordId:'connections-alternate'},accessScope:'shared',availability:'active',originKind:'human',
    words:[{wordId:'connections-alternate',relation:'target'},{wordId:'connections-word',relation:'context'}],answers:[{wordId:'connections-alternate',acceptedForms:['报告']}]},{kind:'operator',id:'test'});
  const projection={encounters:[{wordId:'connections-word',snapshot:{contentId:'connections-context',contentVersion:1,kind:'contrast',assessment:{criteria:{correctWordId:'connections-alternate'}}}}]} as unknown as VocabularySessionProjection;
  assert.equal(vocabularyConnectionsInventory(projection)[0]!.word,'报告');
});
