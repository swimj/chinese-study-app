import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {afterEach,beforeEach,test} from 'node:test';
import {setDb} from '../server/db/connection.ts';
import {runWithLearnerId} from '../server/db/learner-context.ts';
import {computeUsagePulseDay} from '../server/db/usage-pulse.ts';
import {getVocabularyCompletionUsage,getVocabularyStatistics} from '../server/db/vocabulary-statistics.ts';
let db:DatabaseSync;let auth:string|undefined;let mode:string|undefined;let dataDir:string|undefined;
beforeEach(()=>{
 mode=process.env.APP_MODE;dataDir=process.env.APP_DATA_DIR;process.env.APP_MODE='study';process.env.APP_DATA_DIR='/tmp/vocabulary-statistics';auth=process.env.APP_AUTH_MODE;process.env.APP_AUTH_MODE='clerk';db=new DatabaseSync(':memory:');setDb(db);
 db.exec(`CREATE TABLE vocabulary_session_completions(completion_id TEXT,learner_id TEXT,session_id TEXT,status TEXT,closed_at TEXT,input_json TEXT,report_json TEXT);
 CREATE TABLE vocabulary_sessions(learner_id TEXT,session_id TEXT,started_at TEXT);
 CREATE TABLE teaching_completions(learner_id TEXT,completion_id TEXT,source_kind TEXT);
 CREATE TABLE learners(learner_id TEXT);INSERT INTO learners VALUES ('a'),('b');
 CREATE TABLE learner_words(learner_id TEXT,word_id TEXT,mode TEXT,in_stash INTEGER DEFAULT 0,dismissed_at TEXT);
 CREATE TABLE learner_owned_daily_new_word_intake(day_key TEXT,new_study_count INTEGER);
 CREATE TABLE learner_owned_reflection_operation_invocations(origin_kind TEXT,created_at TEXT);
 CREATE TABLE learner_owned_user_word_priority(learner_id TEXT,word_id TEXT,priority_tier INTEGER);
 CREATE TABLE learner_word_state(learner_id TEXT,word_id TEXT,status TEXT);
 CREATE TABLE learner_owned_study_sessions(learner_id TEXT,id TEXT,started_at TEXT);
 CREATE TABLE learner_owned_reflection_generation_runs(learner_id TEXT,estimated_cost_usd REAL,completed_at TEXT);
 CREATE TABLE learner_owned_reflection_proposal_reviews(learner_id TEXT,disposition TEXT,updated_at TEXT);
 CREATE TABLE learner_owned_review_session_summaries(learner_id TEXT,session_id TEXT,day_key TEXT,completed_count INTEGER,failed_count INTEGER,active_duration_ms INTEGER,learning_completed_count INTEGER DEFAULT 0);`);
});
afterEach(()=>{db.close();if(mode===undefined)delete process.env.APP_MODE;else process.env.APP_MODE=mode;if(dataDir===undefined)delete process.env.APP_DATA_DIR;else process.env.APP_DATA_DIR=dataDir;if(auth===undefined)delete process.env.APP_AUTH_MODE;else process.env.APP_AUTH_MODE=auth;});
function completion(id:string,learner='a',closed='2026-10-17T00:00:01.000Z',duration:number|null=1200,status='closed'){
 const accepted={payload:{outcome:'accepted'}},rejected={payload:{outcome:'rejected'}};
 const report={coveredWordIds:['taught','practised'],words:{taught:{covered:true,teachingCompleted:true},practised:{covered:true,teachingCompleted:false},skipped:{covered:false,teachingCompleted:false}},
 encounters:[{presentationUndone:false,responses:[accepted,rejected],effectiveResponses:[accepted]},
 {presentationUndone:false,responses:[rejected],effectiveResponses:[rejected]},
 {presentationUndone:true,responses:[accepted],effectiveResponses:[accepted]}]};
 db.prepare('INSERT INTO vocabulary_session_completions VALUES (?,?,?,?,?,?,?)').run(id,learner,id,status,closed,JSON.stringify({activeDurationMs:duration}),JSON.stringify(report));
 db.prepare("INSERT INTO teaching_completions VALUES (?,?,'session')").run(learner,id);
}
test('closed effective reports count Undo once, teaching separately, and retain unknown active time',()=>{
 completion('known');completion('unknown','a','2026-10-17T23:59:59.000Z',null);completion('pending','a','2026-10-17T12:00:00.000Z',50,'pending');
 db.prepare("INSERT INTO teaching_completions VALUES ('a','known','legacy_import')").run();
 const result=getVocabularyCompletionUsage('2026-10-17','a');
 assert.deepEqual(result,{dayKey:'2026-10-17',sessions:2,coveredWords:4,unknownCoverageSessions:0,acceptedResponses:2,rejectedResponses:2,activeDurationMs:1200,unknownDurationSessions:1,learnerIds:['a'],newWords:2,practiceCompleted:2});
});
test('learner statistics union historical summaries and new closures by UTC without duplicate session identities',()=>{
 completion('new');completion('other','b');completion('yesterday','a','2026-10-16T23:59:59.000Z',0);
 db.exec("INSERT INTO learner_owned_review_session_summaries(learner_id,session_id,day_key,completed_count,failed_count,active_duration_ms) VALUES ('a','old','2026-10-17',3,1,2000),('a','new','2026-10-17',99,0,99000),('b','old-b','2026-10-17',50,0,50000)");
 db.exec("INSERT INTO learner_words(learner_id,mode) VALUES ('a','unstudied'),('a','practice'),('a','practice'),('b','maintain')");
 db.exec("INSERT INTO learner_words(learner_id,mode,dismissed_at) VALUES ('a','unstudied','2026-10-17T00:00:00.000Z')");
 const stats=runWithLearnerId('a',()=>getVocabularyStatistics(new Date('2026-10-17T00:00:00.000Z')));
 assert.equal(stats.days.length,14);assert.equal(stats.days[0]!.dayKey,'2026-10-04');
 assert.deepEqual(stats.days.at(-1),{dayKey:'2026-10-17',sessions:2,coveredWords:2,unknownCoverageSessions:1,acceptedResponses:3,rejectedResponses:2,activeDurationMs:3200,unknownDurationSessions:0});
 assert.equal(stats.days.at(-2)!.sessions,1);assert.equal(stats.days.at(-2)!.activeDurationMs,0);
 assert.deepEqual(stats.modes,{unstudied:1,solidify:0,practice:2,maintain:0});
 assert.equal(getVocabularyCompletionUsage('2026-10-17').sessions,2);
 assert.throws(()=>getVocabularyStatistics(),/Learner context/);
});


test('operator usage unions new activity, disposition-aware stash and abandonment without fabricated summaries',()=>{
 completion('new');
 db.exec("INSERT INTO vocabulary_sessions VALUES ('a','new','2026-10-17T00:00:00.000Z'),('b','abandoned','2026-10-17T00:00:00.000Z')");
 db.exec("INSERT INTO learner_words VALUES ('a','w1','unstudied',1,NULL),('a','w2','practice',1,NULL),('b','w3','unstudied',0,'2026-10-17T00:00:00.000Z')");
 const pulse=computeUsagePulseDay({dayKey:'2026-10-17',studyCommitFailures:[],smokeClerkUserId:null});
 assert.equal(pulse.dau,1);assert.equal(pulse.sessionsCompleted,1);assert.equal(pulse.newWords,1);
 assert.equal(pulse.practiceCompleted,1);assert.equal(pulse.reviewCorrect,1);assert.equal(pulse.reviewWrong,1);
 assert.equal(pulse.sessionActiveMs,1200);assert.equal(pulse.learnersInactive7d,1);assert.equal(pulse.sessionsAbandoned,1);
 assert.equal(pulse.meanStashSize,0.5);assert.equal(pulse.proposalsAccepted,0);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM learner_owned_review_session_summaries').get()!.n,0);
});
