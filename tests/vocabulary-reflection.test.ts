import { resolveVocabularySenseCoverage,writeVocabularyWordSenseCoverage,writeVocabularyCaseSenseCoverage } from '../server/db/vocabulary-sense-coverage.ts';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync, backup } from 'node:sqlite';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, afterEach, test } from 'node:test';
import { setDb } from '../server/db/connection.ts';
import { runWithLearnerId } from '../server/db/learner-context.ts';
import { requestVocabularyRefresh } from '../server/db/vocabulary-learners.ts';
import { createVocabularyContent, emitBackendEvent, getVocabularyContentForMaintenance, listVocabularyExercises, updateVocabularyContent,createVocabularySense,getVocabularySenseCatalog,getVocabularySenses,establishVocabularySenseCatalog,mapVocabularyContentSense,updateVocabularySense } from '../server/db/vocabulary-content.ts';
import { migrateSharedDictionaryBaselines } from '../server/db/dictionary-baseline-sharing.ts';
import { createVocabularyApprovalRequests } from '../server/vocabulary/approval-requests.ts';
import { completeVocabularyApprovalRequest } from '../server/db/vocabulary-reflection.ts';
import { createVocabularyReflectionProvider, projectVocabularyReflectionInput } from '../server/vocabulary/reflection-provider.ts';
import type { ProviderAdapter } from '../server/llm/types.ts';
import { createVocabularySession, appendVocabularySessionActions, stageVocabularySessionCompletion, closeVocabularySessionCompletion } from '../server/db/vocabulary-sessions.ts';
import { ingestVocabularySessionEvidence, getVocabularyReflectionCase, listVocabularyReflectionCases,
  claimVocabularyReflectionJob, recoverVocabularyReflectionJobs, failVocabularyReflectionJob, retryOwnVocabularyFeedback,
  recordVocabularyFeedbackJudgment, recordVocabularyImprovementResult, listOwnVocabularyMessages, markOwnVocabularyMessageSeen, dismissOwnVocabularyMessage, restoreOwnVocabularyMessage, getOwnVocabularyFeedbackAttention,
  requestVocabularyReassessment, requestVocabularySecondOpinion, listVocabularySecondOpinions, listVocabularyNoProposalCases, requestVocabularyCaseSecondOpinion, retryVocabularyReflectionJob, createVocabularyProposal, saveVocabularyProposal, approveVocabularyProposal, applyVocabularyProposal,
  previewVocabularyProposal, getVocabularyProposal, listVocabularyProposals, listVocabularyProposalReviewBatch, closeVocabularyProposal, closeVocabularyTeachingCase, closeVocabularyCase, getVocabularyCaseWorkspace } from '../server/db/vocabulary-reflection.ts';
import type { VocabularyContentDraft, VocabularyContent } from '../src/domain/vocabulary-content.ts';
import type { VocabularySessionAction, VocabularyEncounterSnapshot } from '../src/domain/vocabulary-session.ts';
import type { VocabularyProposalOperation } from '../src/domain/vocabulary-reflection.ts';
let sql: DatabaseSync;
const at = '2026-10-17T10:00:00.000Z', closedAt = '2026-10-17T10:00:16.000Z', judgedAt = '2026-10-17T11:00:00.000Z';
const actor = { kind: 'operator' as const,id: 'editor' };
const alice = <T>(work: () => T) => runWithLearnerId('alice',work);
type Input = VocabularySessionAction extends infer A ? A extends VocabularySessionAction ? Pick<A,'kind'|'payload'> : never : never;
let contents: Record<string,VocabularyContent>;
let oldEnv: Record<string,string|undefined>;
beforeEach(() => {
  oldEnv = Object.fromEntries(['APP_MODE','APP_AUTH_MODE','APP_DATA_DIR','APP_OPERATOR_CLERK_USER_IDS'].map(key => [key,process.env[key]]));
  Object.assign(process.env,{ APP_MODE: 'study',APP_AUTH_MODE: 'clerk',APP_DATA_DIR: '/tmp/vocabulary-reflection-test',APP_OPERATOR_CLERK_USER_IDS: 'editor' });
  sql = new DatabaseSync(':memory:'); setDb(sql);
  sql.exec(`PRAGMA foreign_keys=ON; CREATE TABLE learners(learner_id TEXT PRIMARY KEY,disabled_at TEXT);
    CREATE TABLE learner_word_reserve_requests(learner_id TEXT PRIMARY KEY, requested_at TEXT NOT NULL);
    CREATE TABLE lexical_words(id TEXT PRIMARY KEY); CREATE TABLE model_invocations(id TEXT PRIMARY KEY);
    INSERT INTO learners VALUES ('alice',NULL),('bob',NULL); INSERT INTO lexical_words VALUES ('a'),('b'),('new');`);
  sql.exec(fs.readFileSync(new URL('../server/db/migrations/0039_vocabulary_content.sql',import.meta.url),'utf8'));
  sql.exec(fs.readFileSync(new URL('../server/db/migrations/0062_vocabulary_sense_coverage.sql',import.meta.url),'utf8'));
  sql.exec(fs.readFileSync(new URL('../server/db/migrations/0041_vocabulary_learner_state.sql',import.meta.url),'utf8').split('-- Do not use the words view')[0]!);
  sql.exec(fs.readFileSync(new URL('../server/db/migrations/0047_vocabulary_dismissal.sql',import.meta.url),'utf8'));
  sql.exec(fs.readFileSync(new URL('../server/db/migrations/0052_vocabulary_automatic_promotion_pause.sql',import.meta.url),'utf8'));
  sql.exec(`CREATE TABLE learner_settings(learner_id TEXT,setting_key TEXT,value_json TEXT,updated_at TEXT,PRIMARY KEY(learner_id,setting_key));
    CREATE TABLE learner_owned_word_skill_state(learner_id TEXT,word_id TEXT,skill_id TEXT,enabled INTEGER,
      interval_hours REAL,last_studied_at TEXT,next_due_at TEXT,ease_factor REAL,PRIMARY KEY(learner_id,word_id,skill_id));
    CREATE TABLE learner_owned_word_study_admission_state(
      learner_id TEXT NOT NULL REFERENCES learners(learner_id) ON DELETE CASCADE,
      word_id TEXT NOT NULL REFERENCES lexical_words(id) ON DELETE CASCADE,
      study_phase TEXT NOT NULL,earliest_next_study_at TEXT,PRIMARY KEY(learner_id,word_id));
    CREATE TABLE learner_owned_review_session_summaries(learner_id TEXT,session_id TEXT,PRIMARY KEY(learner_id,session_id));`);
  sql.exec("ALTER TABLE lexical_words ADD COLUMN hanzi TEXT NOT NULL DEFAULT '字';ALTER TABLE lexical_words ADD COLUMN pinyin TEXT NOT NULL DEFAULT 'zì';");

  sql.exec(fs.readFileSync(new URL('../server/db/migrations/0042_vocabulary_sessions.sql',import.meta.url),'utf8'));
  sql.exec(fs.readFileSync(new URL('../server/db/migrations/0044_vocabulary_reflection.sql',import.meta.url),'utf8'));
  sql.exec(fs.readFileSync(new URL('../server/db/migrations/0061_vocabulary_sense_mapping_retries.sql',import.meta.url),'utf8'));
  sql.exec(fs.readFileSync(new URL('../server/db/migrations/0059_vocabulary_reassessment.sql',import.meta.url),'utf8'));
  sql.exec(fs.readFileSync(new URL('../server/db/migrations/0060_vocabulary_reassessment_source.sql',import.meta.url),'utf8'));
  sql.exec(fs.readFileSync(new URL('../server/db/migrations/0055_vocabulary_feedback_dismissal.sql',import.meta.url),'utf8'));
  sql.exec(`INSERT INTO learner_words(learner_id,word_id,in_stash,added_at,mode,mode_changed_at) VALUES
    ('alice','a',1,'2026-01-01','practice','2026-01-01'),('alice','b',1,'2026-01-01','practice','2026-01-01'),
    ('alice','new',1,'2026-01-01','unstudied','2026-01-01');
    INSERT INTO learner_word_schedules(learner_id,word_id,next_eligible_at,policy_version,scheduler_state_json)
    SELECT learner_id,word_id,'2026-10-20T10:00:00.000Z','test','{"intervalHours":24,"easeFactor":2.5,"enabled":1,"cleanCoveredSessions":0}' FROM learner_words;`);
  for(const name of ['0023_session_debrief.sql','0048_vocabulary_connections.sql','0049_vocabulary_sense_readiness.sql','0050_vocabulary_improvement_admission.sql','0051_vocabulary_pure_cue_promotion.sql','0053_vocabulary_second_opinions.sql'])sql.exec(fs.readFileSync(new URL(`../server/db/migrations/${name}`,import.meta.url),'utf8'));
  contents = {};
  for (const id of ['one','two','cue','teach']) contents[id] = createVocabularyContent(draft(id,
    id === 'cue' ? 'b' : id === 'teach' ? 'new' : 'a',id === 'teach' ? 'teaching' : 'general',id === 'cue' ? 'pure_cue' : 'word'),actor);
  contents.intro = createVocabularyContent({ contentId: 'intro',kind: 'introduction',payloadVersion: 1,body: 'Exact introduction',
    accessScope: 'shared',availability: 'active',originKind: 'human',words: [{ wordId: 'new',relation: 'target' }],
    teachingExercises: [{ exerciseId: 'teach',exerciseVersion: 1 }] },actor);
});
afterEach(() => { sql.close(); for (const [key,value] of Object.entries(oldEnv)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
function draft(id: string,wordId='a',role: 'teaching'|'general'='general',type='word'): VocabularyContentDraft {
  return { contentId: id,kind: 'exercise',payloadVersion: 1,body: { prompt: `Prompt ${id}` },accessScope: 'shared',availability: 'active',
    originKind: 'human',exerciseType: type,skill: 'production',exerciseRole: role,assessment: { match: 'exact' },
    words: [{ wordId,relation: 'target' }],answers: [{ wordId,acceptedForms: ['字'] }] };
}
function snapshot(id: string): VocabularyEncounterSnapshot {
  const content = contents[id]!;
  return { contentId: id,contentVersion: 1,kind: content.kind === 'introduction' ? 'introduction' : content.skill === 'recognition' ? 'recognition' : content.skill === 'contextual_selection' ? 'contrast' : 'production',
    role: content.kind === 'introduction' ? 'teaching' : content.exerciseRole,body: { prompt: `Prompt ${id}`,material: content.body },
    assessment: content.kind === 'introduction' ? null : { acceptedAnswers: ['字'],criteria: content.assessment },
    ...(id === 'cue' ? { schedulingScope: 'pure_cue' } : {}) };
}
function present(id: string,wordId: string|null='a',encounterId=id): Input { return { kind: 'presentation',payload: { encounterId,wordId,snapshot: snapshot(id) } }; }
function response(encounterId: string,outcome: 'accepted'|'rejected'='rejected'): Input { return { kind: 'response',payload: { encounterId,response: outcome === 'accepted' ? '字' : 'answer',outcome } }; }
function wrap(): Input { return { kind: 'word_wrap',payload: { wordId: 'a',reason: 'enough' } }; }
function close(inputs: Input[],sessionId='session') {
  return alice(() => {
    createVocabularySession({ sessionId,words: [{ wordId: 'a',mode: 'practice' },{ wordId: 'b',mode: 'practice' },{ wordId: 'new',mode: 'unstudied',
      teachingRequirements: { introductionContentId: 'intro',requiredExerciseContentIds: ['teach'],minimumRecognitionResponses: 0,minimumProductionResponses: 1 } }] },at);
    const actions = [...inputs,{ kind: 'finish_for_now',payload: {} }] as Input[];
    const mapped = actions.map((input,index) => ({ ...input,protocolVersion: 1 as const,actionId: `${sessionId}-${index}`,
      clientActionId: `${sessionId}-client-${index}`,sequence: index+1,occurredAt: at }));
    const persisted = appendVocabularySessionActions(sessionId,mapped,at);
    if (persisted.projection.phase !== 'completed') {
      const index = mapped.length;
      appendVocabularySessionActions(sessionId,[{ protocolVersion: 1,actionId: `${sessionId}-${index}`,clientActionId: `${sessionId}-client-${index}`,
        sequence: index+1,occurredAt: at,kind: 'finish_immediately',payload: {} }],at);
      actions.push({ kind: 'finish_immediately',payload: {} });
    }
    const staged = stageVocabularySessionCompletion(sessionId,actions.length,at);
    return closeVocabularySessionCompletion(sessionId,staged.completionId,closedAt);
  });
}
function ingest(inputs: Input[]) {
  const completion = close(inputs); const ids = ingestVocabularySessionEvidence('alice',completion.completionId,completion.report,closedAt);
  return { completion,ids,cases: ids.map(id => getVocabularyReflectionCase(id)) };
}
function op(strategy: VocabularyProposalOperation['strategy']='update_existing',source='one',next='one'): VocabularyProposalOperation {
  return { operationKey: 'repair',scope: { kind: 'shared' },rationale: 'Improve this exact cue',content: draft(next),
    ...(strategy === 'create' ? { strategy } : { strategy,sourceContentId: source,expectedVersion: 1 }) };
}

function historicalDictionaryBaselineJob(migrate=true) {
  sql.exec("ALTER TABLE lexical_words ADD COLUMN traditional TEXT; ALTER TABLE lexical_words ADD COLUMN meaning TEXT NOT NULL DEFAULT 'written character; writing system'; ALTER TABLE vocabulary_reflection_jobs ADD COLUMN model_choice TEXT;");
  const id='vocabulary:baseline:v1:alice:production:general:a';
  contents[id]=createVocabularyContent({contentId:id,kind:'exercise',payloadVersion:1,
    body:{prompt:'written character; writing system',instruction:'Give the Mandarin word.',source:{kind:'dictionary_baseline',wordId:'a'}},
    accessScope:'private',ownerLearnerId:'alice',availability:'active',originKind:'human',authorKind:'service',authorId:'vocabulary-dictionary-baseline-v1',
    exerciseType:'definition',skill:'production',exerciseRole:'general',assessment:{match:'prepared_answer_membership'},
    words:[{wordId:'a',relation:'target'}],answers:[{wordId:'a',acceptedForms:['字']}]},actor);
  for(const senseId of ['character','script'])createVocabularySense({senseId,wordId:'a',description:{label:senseId}},actor);
  establishVocabularySenseCatalog('a',getVocabularySenseCatalog('a').version,actor);
  writeVocabularyWordSenseCoverage('a',0,[],actor);
  ingest([present(id),response(id)]);
  const work=claimVocabularyReflectionJob({kind:'exercise_improvement',now:judgedAt})!;
  if(migrate)migrateDictionaryBaselines();
  sql.prepare("UPDATE vocabulary_reflection_jobs SET model_choice='openai:gpt-5.6-luna-high' WHERE job_id=?").run(work.jobId);
  return {id,work};
}

function migrateDictionaryBaselines() {
  sql.exec('BEGIN IMMEDIATE');
  try { migrateSharedDictionaryBaselines(sql);sql.exec('COMMIT'); }
  catch(error) { sql.exec('ROLLBACK');throw error; }
}
function dictionaryRepertoireProvider(accessScope:'shared'|'private',version:number) {
  let calls=0;
  const adapter:ProviderAdapter={id:'fake',defaultBaseUrl:'https://unused.invalid',apiKeyEnvironmentVariable:'KEY',structuredOutputMode:'json_schema',async run(request){
    calls++;
    const input=JSON.parse(request.userPrompt) as {sourceContent:VocabularyContent};
    if(calls===1){assert.equal(input.sourceContent.accessScope,accessScope);assert.equal(input.sourceContent.version,version);}
    const value=calls===1?{outcome:'laundry_list',rationale:'The corpus gloss bundles useful meanings.',senseIds:[]}
      :{exercises:[{id:'character',sourceUseId:'character',stimulus:{kind:'direct_text',text:'A single written unit in a text.'},teachingNote:'Written unit.'},
        {id:'script',sourceUseId:'script',stimulus:{kind:'direct_text',text:'A system of signs used for writing.'},teachingNote:'Writing system.'}]};
    return {provider:'fake',model:'fake',responseId:null,structuredOutputMode:'json_schema',rawText:JSON.stringify(value),finishReason:'stop',rawResponse:null,
      usage:{inputTokens:null,cachedInputTokens:null,cacheWriteInputTokens:null,outputTokens:null,reasoningTokens:null,totalTokens:null},invocationId:null};
  }};
  const provider=createVocabularyReflectionProvider({random:()=>0,environment:{OPENAI_API_KEY:'fake'},adapter,
    ensureSenses:async()=>({catalog:getVocabularySenseCatalog('a'),senses:getVocabularySenses('a'),source:'existing'})});
  return {provider,get calls(){return calls;}};
}

test('historical private dictionary encounters generate shared repertoires after scope migration and remain applicable',async()=>{
  const {id,work}=historicalDictionaryBaselineJob();
  const evidenceBefore=JSON.stringify(getVocabularyReflectionCase(work.caseId).evidence);
  const projected=projectVocabularyReflectionInput(work) as {sourceContent:VocabularyContent};
  assert.equal(projected.sourceContent.version,2);assert.equal(projected.sourceContent.accessScope,'shared');
  assert.throws(()=>projectVocabularyReflectionInput({...work,learnerId:'bob'}),/source access mismatch/);
  const trial=dictionaryRepertoireProvider('shared',2);
  const result=await trial.provider.run(work);if(result.kind!=='exercise_improvement')assert.fail('Expected improvement');
  assert.equal(trial.calls,2);assert.equal(result.result.admission?.sourceContentVersion,2);
  assert.deepEqual(result.result.proposal!.operations.map(operation=>operation.scope),[{kind:'shared'},{kind:'shared'}]);
  const recorded=recordVocabularyImprovementResult(work.jobId,work.leaseToken,result.result,judgedAt);
  const review=approveVocabularyProposal(recorded.proposalId!,1,'editor');
  applyVocabularyProposal(recorded.proposalId!,1,review,'migrated-repertoire','editor');
  const proposal=getVocabularyProposal(recorded.proposalId!,'editor');
  for(const operation of proposal.operations)assert.equal(getVocabularyContentForMaintenance(operation.content.contentId!)!.accessScope,'shared');
  assert.equal(getVocabularyContentForMaintenance(id)!.availability,'retired');
  assert.equal(JSON.stringify(getVocabularyReflectionCase(work.caseId).evidence),evidenceBefore);
  assert.equal(work.evidence.evidence[0]!.snapshot.contentVersion,1);
  assert.deepEqual(sql.prepare('PRAGMA foreign_key_check').all(),[]);
});

test('scope migration rebases a retained private repertoire and requires approval of its new shared version',async()=>{
  const {id,work}=historicalDictionaryBaselineJob(false);
  const trial=dictionaryRepertoireProvider('private',1);
  const result=await trial.provider.run(work);if(result.kind!=='exercise_improvement')assert.fail('Expected improvement');
  const recorded=recordVocabularyImprovementResult(work.jobId,work.leaseToken,result.result,judgedAt);
  const oldReview=approveVocabularyProposal(recorded.proposalId!,1,'editor');
  const before=getVocabularyProposal(recorded.proposalId!,'editor');
  assert.ok(before.operations.every(operation=>operation.scope.kind==='learner'&&operation.content.accessScope==='private'));
  migrateDictionaryBaselines();
  const migrated=getVocabularyProposal(recorded.proposalId!,'editor');
  assert.equal(migrated.version,2);assert.equal(migrated.status,'awaiting_review');
  assert.deepEqual(migrated.bases.map(base=>({...base})),[{contentId:id,expectedVersion:2}]);
  assert.ok(migrated.operations.every(operation=>operation.scope.kind==='shared'&&operation.content.accessScope==='shared'&&operation.content.ownerLearnerId===null));
  assert.throws(()=>applyVocabularyProposal(migrated.proposalId,2,oldReview,'old-private-approval','editor'),/Exact proposal version requires manual approval/);
  assert.equal(sql.prepare('SELECT count(*) n FROM proposal_applications').get()!.n,0);
  const review=approveVocabularyProposal(migrated.proposalId,2,'editor');
  assert.throws(()=>applyVocabularyProposal(migrated.proposalId,2,oldReview,'old-private-approval','editor'),/Approval does not authorize this exact proposal version/);
  applyVocabularyProposal(migrated.proposalId,2,review,'migrated-existing-repertoire','editor');
  assert.equal(getVocabularyProposal(migrated.proposalId,'editor').status,'applied');
  for(const operation of migrated.operations) {
    const applied=getVocabularyContentForMaintenance(operation.content.contentId!)!;
    assert.equal(applied.accessScope,'shared');assert.equal(applied.ownerLearnerId,null);
    assert.deepEqual(applied.body,operation.content.body);
  }
  const bobExercises=runWithLearnerId('bob',()=>listVocabularyExercises({wordId:'a',mode:'practice'}));
  for(const operation of migrated.operations)assert.ok(bobExercises.some(content=>content.contentId===operation.content.contentId));
  assert.equal(getVocabularyContentForMaintenance(id)!.availability,'retired');
  assert.equal(sql.prepare('SELECT count(*) n FROM proposal_applications').get()!.n,1);
  assert.deepEqual(sql.prepare('PRAGMA foreign_key_check').all(),[]);
});

test('scope migration does not authorize admission against later substantive dictionary edits',async()=>{
  const {id,work}=historicalDictionaryBaselineJob();
  const shared=getVocabularyContentForMaintenance(id)!;
  updateVocabularyContent(id,shared.version,{...shared,body:{...(shared.body as object),prompt:'An operator authored a distinct prompt.'}},actor);
  const projected=projectVocabularyReflectionInput(work) as {sourceContent:VocabularyContent};
  assert.equal(projected.sourceContent.version,1,'historical content cannot resolve through a substantive edit');
  assert.equal(projected.sourceContent.accessScope,'private');
  const adapter:ProviderAdapter={id:'fake',defaultBaseUrl:'https://unused.invalid',apiKeyEnvironmentVariable:'KEY',structuredOutputMode:'json_schema',async run(){
    assert.fail('Substantive source drift must be fenced before a model call');
  }};
  const provider=createVocabularyReflectionProvider({random:()=>0,environment:{OPENAI_API_KEY:'fake'},adapter,
    ensureSenses:async()=>({catalog:getVocabularySenseCatalog('a'),senses:getVocabularySenses('a'),source:'existing'})});
  await assert.rejects(()=>provider.run(work),/source changed before admission/);
  const admission={outcome:'laundry_list' as const,rationale:'Review',wordId:'a',sourceContentId:id,sourceContentVersion:3,
    catalogVersion:getVocabularySenseCatalog('a').version,senseIds:[],sourceMapping:{senseId:null,establishedAt:null}};
  assert.throws(()=>recordVocabularyImprovementResult(work.jobId,work.leaseToken,{diagnosis:'Review',proposal:null,admission},judgedAt),/must describe the source encounter/);
  assert.equal(sql.prepare('SELECT count(*) n FROM teacher_judgments').get()!.n,0);
});

test('ingestion retains uncovered/no-answer/overlapping-word evidence and routes teaching issues separately', () => {
  const { completion,cases } = ingest([present('one'),response('one'),present('two'),{ kind: 'feedback',payload: { encounterId: 'two',feedback: 'comment',comment: 'No answer yet' } },
    { kind: 'exercise_skip',payload: { encounterId: 'two' } },present('intro','new'),present('teach','new'),
    { kind: 'feedback',payload: { encounterId: 'teach',feedback: 'negative' } }]);
  assert.equal(completion.report.words.a!.covered,false);
  const feedback = cases.find(item => item.kind === 'learner_feedback')!;
  assert.equal(feedback.evidence.length,2); assert.equal(feedback.evidence[1]!.responses.length,0);
  assert.equal(cases.filter(item => item.kind === 'exercise_improvement').length,2);
  const teaching = cases.find(item => item.kind === 'teaching_review')!;
  assert.equal(teaching.evidence.length,2); assert.ok(teaching.evidence.some(item => item.snapshot.kind === 'introduction'));
  assert.equal(Number(sql.prepare('SELECT count(*) n FROM vocabulary_reflection_jobs').get()!.n),3);
  assert.deepEqual(new Set(ingestVocabularySessionEvidence('alice',completion.completionId,completion.report)),new Set(cases.map(item => item.caseId)));
  assert.throws(() => ingestVocabularySessionEvidence('bob',completion.completionId,completion.report),/exact closed/);
  assert.throws(() => ingestVocabularySessionEvidence('alice',completion.completionId,{ ...completion.report,encounters: [] }),/exact closed/);
  assert.throws(() => sql.exec("UPDATE reflection_case_evidence SET snapshot_json='{}'"),/immutable/);
  assert.deepEqual(sql.prepare('PRAGMA foreign_key_check').all(),[]);
});

test('word feedback and improvement jobs run independently; automatic compensation and message reads never depend on proposals', () => {
  const { completion } = ingest([present('one'),response('one'),present('two'),response('two','accepted'),
    { kind: 'mode_change',payload: { wordId: 'a',mode: 'maintain' } },wrap()]);
  assert.equal(completion.report.words.a!.covered,true);
  const improvement = claimVocabularyReflectionJob({ kind: 'exercise_improvement',now: judgedAt })!;
  failVocabularyReflectionJob(improvement.jobId,improvement.leaseToken,'provider_unavailable','2026-10-18T00:00:00.000Z',judgedAt);
  const feedback = claimVocabularyReflectionJob({ kind: 'learner_feedback',now: judgedAt })!;
  sql.prepare("UPDATE learner_word_schedules SET next_eligible_at='2026-10-20T10:00:00.000Z' WHERE word_id='a'").run();
  const input = { diagnosis: { unfair: true },message: { lesson: 'The alternate fit the actual cue.' },unfairEncounterIds: ['one'] };
  const result = recordVocabularyFeedbackJudgment(feedback.jobId,feedback.leaseToken,input,judgedAt);
  assert.deepEqual(recordVocabularyFeedbackJudgment(feedback.jobId,feedback.leaseToken,input,judgedAt),result);
  assert.equal(sql.prepare("SELECT next_eligible_at FROM learner_word_schedules WHERE word_id='a'").get()!.next_eligible_at,'2026-10-21T10:00:00.000Z');
  assert.equal(sql.prepare("SELECT mode FROM learner_words WHERE word_id='a'").get()!.mode,'maintain');
  assert.equal(Number(sql.prepare("SELECT count(*) n FROM learner_state_effects WHERE judgment_id IS NOT NULL").get()!.n),1);
  assert.equal(Number(sql.prepare('SELECT count(*) n FROM content_proposals').get()!.n),0);
  assert.equal(runWithLearnerId('bob',listOwnVocabularyMessages).length,0);
  assert.throws(() => sql.exec("UPDATE learner_messages SET body_json='{}'"),/read-only/);
  assert.throws(() => runWithLearnerId('bob',() => markOwnVocabularyMessageSeen(result.messageId!,judgedAt)),/does not belong/);
  alice(() => { assert.equal(listOwnVocabularyMessages().length,1); markOwnVocabularyMessageSeen(result.messageId!,judgedAt); });
  assert.equal(sql.prepare("SELECT count(*) n FROM learner_state_effects WHERE completion_id=? AND judgment_id IS NOT NULL").get(completion.completionId)!.n,1);
  assert.throws(() => recordVocabularyFeedbackJudgment(feedback.jobId,feedback.leaseToken,{ ...input,message: 'Changed retry' },judgedAt),/differs/);
});

for (const outcome of ['inventory_gap','unmappable'] as const) test(`${outcome} stays in operator attention without repairs or repeated generation`, () => {
  ingest([present('one'),response('one')]);
  const work = claimVocabularyReflectionJob({kind:'exercise_improvement',now:judgedAt})!;
  assert.throws(()=>closeVocabularyCase(work.caseId,'editor','Too early'),/Only manual teaching or unresolved/);
    const admission={outcome,rationale:'The intended use needs inspection.',wordId:'a',sourceContentId:'one',sourceContentVersion:1,catalogVersion:1,senseIds:[],sourceMapping:{senseId:null,establishedAt:null}};
  const input={diagnosis:admission.rationale,proposal:null,admission};
  const result=recordVocabularyImprovementResult(work.jobId,work.leaseToken,input,judgedAt);
  assert.equal(result.proposalId,null);
  assert.ok(listVocabularyReflectionCases('exercise_improvement','editor').some(item=>item.caseId===work.caseId));
  assert.deepEqual(getVocabularyCaseWorkspace(work.caseId,'editor').admission,admission);
  assert.equal(claimVocabularyReflectionJob({kind:'exercise_improvement',now:judgedAt}),null);
  assert.ok(claimVocabularyReflectionJob({kind:'learner_feedback',now:judgedAt}));
  assert.throws(()=>closeVocabularyCase(work.caseId,'editor',''),/nonempty/);
  assert.equal(getVocabularyReflectionCase(work.caseId).status,'open');
  closeVocabularyCase(work.caseId,'editor','Recorded for later attention');
  assert.equal(getVocabularyReflectionCase(work.caseId).status,'closed');
  assert.deepEqual(recordVocabularyImprovementResult(work.jobId,work.leaseToken,input,judgedAt),result);
  assert.equal(getVocabularyReflectionCase(work.caseId).status,'closed');
  assert.deepEqual(getVocabularyCaseWorkspace(work.caseId,'editor').admission,admission);
});

for (const coveredLater of [false,true]) test(`uncovered word retains feedback and repair work without compensation (covered later: ${coveredLater})`, () => {
  const { completion,cases } = ingest([present('one'),response('one'),{ kind: 'word_skip',payload: { wordId: 'a' } }]);
  assert.equal(completion.report.words.a!.covered,false);
  assert.equal(cases.filter(item => item.kind === 'exercise_improvement').length,1);
  if (coveredLater) {
    const later = close([present('two','a','later-two'),response('later-two','accepted'),wrap()],'later-session');
    assert.equal(later.report.words.a!.covered,true);
  }
  const before = sql.prepare("SELECT * FROM learner_word_schedules WHERE learner_id='alice' AND word_id='a'").get();
  const feedback = claimVocabularyReflectionJob({ kind: 'learner_feedback',now: judgedAt })!;
  const input = { diagnosis: 'Unfair cue',message: 'Your answer fit the cue.',unfairEncounterIds: ['one'] };
  const result = recordVocabularyFeedbackJudgment(feedback.jobId,feedback.leaseToken,input,judgedAt);
  assert.deepEqual(recordVocabularyFeedbackJudgment(feedback.jobId,feedback.leaseToken,input,judgedAt),result);
  assert.deepEqual(sql.prepare("SELECT * FROM learner_word_schedules WHERE learner_id='alice' AND word_id='a'").get(),before);
  assert.equal(sql.prepare("SELECT count(*) n FROM learner_state_effects WHERE kind='unfair_feedback_compensation'").get()!.n,0);
  assert.equal(JSON.parse(String(sql.prepare('SELECT diagnosis_json FROM teacher_judgments WHERE judgment_id=?').get(result.judgmentId)!.diagnosis_json)),input.diagnosis);
  assert.equal(alice(listOwnVocabularyMessages)[0]!.body,input.message);
  assert.ok(claimVocabularyReflectionJob({ kind: 'exercise_improvement',now: judgedAt }));
});

test('pure cue feedback has no invented word target and compensates only its independent schedule', () => {
  // A lapse alone does not complete pure-cue work; compensation adjusts its existing schedule.
  sql.prepare(`INSERT INTO learner_pure_cue_schedules(learner_id,content_id,next_eligible_at,policy_version,scheduler_state_json)
    VALUES ('alice','cue','2026-10-20T10:00:00.000Z','test',?)`)
    .run(JSON.stringify({intervalHours:24,easeFactor:2.5,enabled:1,cleanCoveredSessions:0}));
  const { cases } = ingest([present('cue',null),response('cue')]);
  const feedbackCase = cases.find(item => item.kind === 'learner_feedback')!;
  assert.equal(feedbackCase.wordId,null); assert.equal(feedbackCase.contentId,'cue');
  sql.prepare("UPDATE learner_pure_cue_schedules SET next_eligible_at='2026-10-20T10:00:00.000Z',scheduler_state_json=json_set(scheduler_state_json,'$.strongSince','2026-10-17T10:30:00.000Z','$.strongSuccesses',4)").run();
  const wordBefore = sql.prepare("SELECT * FROM learner_word_schedules WHERE word_id='b'").get();
  const feedback = claimVocabularyReflectionJob({ kind: 'learner_feedback',now: judgedAt })!;
  recordVocabularyFeedbackJudgment(feedback.jobId,feedback.leaseToken,{ diagnosis: 'An accepted member can fit',message: 'Any accepted member remains valid',unfairEncounterIds: ['cue'] },judgedAt);
  assert.equal(sql.prepare('SELECT next_eligible_at FROM learner_pure_cue_schedules').get()!.next_eligible_at,'2026-10-21T10:00:00.000Z');
  const pureState=JSON.parse(String(sql.prepare('SELECT scheduler_state_json FROM learner_pure_cue_schedules').get()!.scheduler_state_json));
  assert.equal(pureState.resetUntil,'2026-10-21T10:00:00.000Z');assert.equal(pureState.strongSince,'2026-10-17T10:30:00.000Z');assert.equal(pureState.strongSuccesses,4);
  assert.deepEqual(sql.prepare("SELECT * FROM learner_word_schedules WHERE word_id='b'").get(),wordBefore);
});

test('lease expiry and retries fence old workers and retain evidence', () => {
  ingest([present('one'),response('one')]);
  const first = claimVocabularyReflectionJob({ kind: 'learner_feedback',now: judgedAt,leaseMs: 1000 })!;
  assert.equal(recoverVocabularyReflectionJobs('2026-10-17T11:00:01.000Z'),1);
  assert.equal(claimVocabularyReflectionJob({ kind: 'learner_feedback',now: '2026-10-17T11:00:02.000Z' }),null);
  alice(() => retryOwnVocabularyFeedback(first.jobId,'2026-10-17T11:00:02.000Z'));
  const next = claimVocabularyReflectionJob({ kind: 'learner_feedback',now: '2026-10-17T11:00:02.000Z' })!;
  assert.equal(first.jobId,next.jobId); assert.equal(next.attemptNumber,2); assert.notEqual(first.leaseToken,next.leaseToken);
  assert.throws(() => recordVocabularyFeedbackJudgment(first.jobId,first.leaseToken,{ diagnosis: null,message: null,unfairEncounterIds: [] },'2026-10-17T11:00:02.000Z'),/stale/);
  recordVocabularyFeedbackJudgment(next.jobId,next.leaseToken,{ diagnosis: null,message: 'Retained lesson',unfairEncounterIds: [] },'2026-10-17T11:00:02.000Z');
  assert.equal(Number(sql.prepare('SELECT count(*) n FROM teacher_judgments').get()!.n),1);
});

for(const drift of ['mapping','catalog','word coverage','review coverage'] as const)test(`sense-admitted content distinguishes canonical evidence from serving policy (${drift})`,()=>{
  const sense=createVocabularySense({wordId:'a',description:'A written character'},actor);
  mapVocabularyContentSense({contentId:'one',wordId:'a',expectedContentVersion:1,expectedMapping:{senseId:null,establishedAt:null},senseId:sense.senseId,establishedAt:at},actor);
  ingest([present('one'),response('one')]);
  const work=claimVocabularyReflectionJob({kind:'exercise_improvement',now:judgedAt})!;
  const admission={outcome:'single_sense' as const,rationale:'Identifiable use',wordId:'a',sourceContentId:'one',sourceContentVersion:1,
    catalogVersion:getVocabularySenseCatalog('a').version,senseIds:[sense.senseId],sourceMapping:{senseId:sense.senseId,establishedAt:at}};
  const result=recordVocabularyImprovementResult(work.jobId,work.leaseToken,{diagnosis:'Repair',proposal:{operations:[op('replace','one','fresh')],rationale:'Useful repair'},admission},judgedAt);
  const review=approveVocabularyProposal(result.proposalId!,1,'editor');
  if(drift==='mapping')mapVocabularyContentSense({contentId:'one',wordId:'a',expectedContentVersion:1,expectedMapping:admission.sourceMapping,senseId:null,establishedAt:judgedAt},actor);
  else if(drift==='catalog')updateVocabularySense(sense.senseId,sense.version,{description:sense.description,status:'retired'},actor);
  else if(drift==='word coverage')writeVocabularyWordSenseCoverage('a',0,[sense.senseId],actor);
  else writeVocabularyCaseSenseCoverage(work.caseId,0,[],actor);
  if(drift==='mapping'||drift==='catalog') {
    assert.throws(()=>applyVocabularyProposal(result.proposalId!,1,review,`stale-${drift}`,'editor'),/sense evidence changed/);
    assert.equal(getVocabularyContentForMaintenance('one')!.availability,'active');
    assert.equal(sql.prepare('SELECT count(*) n FROM proposal_applications').get()!.n,0);
  }else{
    // Policy changes may neither invalidate content edits nor erase a retained
    // historical admission's source/catalog safeguards.
    const again=approveVocabularyProposal(result.proposalId!,1,'editor');
    applyVocabularyProposal(result.proposalId!,1,again,`policy-${drift}`,'editor');
    assert.equal(getVocabularyContentForMaintenance('fresh')!.availability,'active');
    assert.equal(sql.prepare('SELECT count(*) n FROM proposal_applications').get()!.n,1);
  }
});

test('generated proposals require exact operator review, reject stale approval and keep independent judgment', () => {
  ingest([present('one'),response('one')]);
  const work = claimVocabularyReflectionJob({ kind: 'exercise_improvement',now: judgedAt })!;
  const result = recordVocabularyImprovementResult(work.jobId,work.leaseToken,{ diagnosis: 'Overloaded cue',proposal: { operations: [op()],rationale: 'A faithful revision' } },judgedAt);
  const original = getVocabularyProposal(result.proposalId!,'editor');
  assert.equal(original.authorKind,'service');
  assert.throws(() => getVocabularyProposal(original.proposalId,'alice'),/Operator/);
  const review = approveVocabularyProposal(original.proposalId,1,'editor');
  const revised = saveVocabularyProposal(original.proposalId,1,{ operations: [op()],rationale: 'Refined rationale' },'editor');
  assert.equal(revised.version,2);
  assert.throws(() => applyVocabularyProposal(original.proposalId,1,review,'apply-old','editor'),/version changed/);
  assert.throws(() => applyVocabularyProposal(original.proposalId,2,review,'apply-old','editor'),/manual approval/);
  const reviewedAgain = approveVocabularyProposal(original.proposalId,2,'editor');
  const receipt = applyVocabularyProposal(original.proposalId,2,reviewedAgain,'apply-new','editor');
  assert.equal(receipt.changes[0]!.resultContentId,'one'); assert.equal(receipt.changes[0]!.resultVersion,2);
  assert.deepEqual(applyVocabularyProposal(original.proposalId,2,reviewedAgain,'apply-new','editor'),receipt);
  assert.equal(Number(sql.prepare('SELECT count(*) n FROM proposal_revision_history').get()!.n),2);
  assert.equal(Number(sql.prepare('SELECT count(*) n FROM application_content_changes').get()!.n),1);
  assert.equal(Number(sql.prepare('SELECT count(*) n FROM learner_messages').get()!.n),0);
  assert.equal(Number(sql.prepare('SELECT count(*) n FROM learner_state_effects WHERE judgment_id IS NOT NULL').get()!.n),0);
  assert.deepEqual(sql.prepare('PRAGMA foreign_key_check').all(),[]);
});

test('real provider content edits remain applicable while serving selection changes independently',async()=>{
  sql.exec("ALTER TABLE lexical_words ADD COLUMN traditional TEXT; ALTER TABLE lexical_words ADD COLUMN meaning TEXT NOT NULL DEFAULT 'written character'; ALTER TABLE vocabulary_reflection_jobs ADD COLUMN model_choice TEXT;");
  const sense=createVocabularySense({senseId:'selected-sense',wordId:'a',description:{label:'written character'}},actor);
  establishVocabularySenseCatalog('a',getVocabularySenseCatalog('a').version,actor);
  writeVocabularyWordSenseCoverage('a',0,[sense.senseId],actor);
  ingest([present('one'),response('one')]);
  const work=claimVocabularyReflectionJob({kind:'exercise_improvement',now:judgedAt})!;
  let calls=0;
  const adapter:ProviderAdapter={id:'fake',defaultBaseUrl:'https://unused.invalid',apiKeyEnvironmentVariable:'KEY',structuredOutputMode:'json_schema',async run(request){
    calls++;assert.equal(Object.hasOwn(JSON.parse(request.userPrompt),'coverage'),false);
    const value=calls===1?{outcome:'single_sense',rationale:'The authored task names a written character.',senseIds:[sense.senseId]}:
      {diagnosis:'Improve this exact exercise.',pureCueReferral:null,operations:[{sourceContentId:'one',strategy:'update_existing',rationale:'A direct faithful cue.',prompt:'A written character.',acceptedAnswers:['字']}]};
    if(calls===2)writeVocabularyWordSenseCoverage('a',1,[],actor);
    return {provider:'fake',model:'fake',responseId:null,structuredOutputMode:'json_schema',rawText:JSON.stringify(value),finishReason:'stop',rawResponse:null,
      usage:{inputTokens:null,cachedInputTokens:null,cacheWriteInputTokens:null,outputTokens:null,reasoningTokens:null,totalTokens:null},invocationId:null};
  }};
  const provider=createVocabularyReflectionProvider({random:()=>0,environment:{OPENAI_API_KEY:'fake'},adapter,
    ensureSenses:async()=>({catalog:getVocabularySenseCatalog('a'),senses:getVocabularySenses('a'),source:'existing'})});
  const assessed=await provider.run(work);if(assessed.kind!=='exercise_improvement')assert.fail('Expected improvement');
  assert.equal(calls,2);assert.deepEqual(assessed.result.admission?.generationScope,{selectionEstablished:true,senseIds:[sense.senseId],source:{kind:'mapped_source'}});
  const recorded=recordVocabularyImprovementResult(work.jobId,work.leaseToken,assessed.result,judgedAt);
  writeVocabularyWordSenseCoverage('a',2,[sense.senseId],actor);writeVocabularyCaseSenseCoverage(work.caseId,0,[],actor);
  assert.doesNotThrow(()=>previewVocabularyProposal(recorded.proposalId!,1,'editor'));
  const review=approveVocabularyProposal(recorded.proposalId!,1,'editor');
  applyVocabularyProposal(recorded.proposalId!,1,review,'independent-content-policy','editor');
  const edited=getVocabularyContentForMaintenance('one')!;assert.equal(edited.availability,'active');assert.equal(edited.version,2);
  assert.equal(alice(()=>listVocabularyExercises({wordId:'a',mode:'practice'})).some(item=>item.contentId==='one'),false);
  writeVocabularyWordSenseCoverage('a',3,[],actor);
  assert.equal(alice(()=>listVocabularyExercises({wordId:'a',mode:'practice'})).some(item=>item.contentId==='one'),true);
  assert.equal(getVocabularyContentForMaintenance('one')!.version,edited.version);
});

test('replacement retains source schedules/deactivations and teaching links; failures roll back all changes and receipts', () => {
  sql.prepare("INSERT INTO learner_content_deactivations VALUES ('alice','one',?)").run(at);
  const proposal = createVocabularyProposal({ operations: [op('replace','one','successor')],rationale: 'Choose replacement' },'editor');
  const preview = previewVocabularyProposal(proposal.proposalId,1,'editor');
  assert.equal(preview.operations[0]!.deactivationsRemainOnSource,1); assert.equal(preview.operations[0]!.transfersRelationships,false);
  const review = approveVocabularyProposal(proposal.proposalId,1,'editor');
  const receipt = applyVocabularyProposal(proposal.proposalId,1,review,'replace','editor');
  assert.equal(getVocabularyContentForMaintenance('one')!.availability,'retired'); assert.equal(receipt.changes[0]!.resultContentId,'successor');
  assert.equal(sql.prepare('SELECT content_id FROM learner_content_deactivations').get()!.content_id,'one');
  const broken = createVocabularyProposal({ operations: [op('create','one','created-first'),op('create','one','created-second')].map((operation,index) => ({ ...operation,operationKey: `op-${index}` })),rationale: 'Will fail duplicate identity' },'editor');
  const brokenReview = approveVocabularyProposal(broken.proposalId,1,'editor');
  // Intervening identity collision after a valid preview must still roll back the first operation.
  createVocabularyContent(draft('created-second'),actor);
  assert.throws(() => applyVocabularyProposal(broken.proposalId,1,brokenReview,'broken','editor'),/UNIQUE/);
  assert.equal(getVocabularyContentForMaintenance('created-first'),null);
  assert.equal(sql.prepare('SELECT count(*) n FROM proposal_applications WHERE proposal_id=?').get(broken.proposalId)!.n,0);
});

test('content drift rejects applications; teaching cases use manual proposals only; scope cannot broaden', () => {
  const { cases } = ingest([present('intro','new'),present('teach','new'),{ kind: 'feedback',payload: { encounterId: 'teach',feedback: 'negative' } }]);
  assert.equal(claimVocabularyReflectionJob({ now: judgedAt }),null);
  const teaching = cases[0]!;
  const proposal = createVocabularyProposal({ caseId: teaching.caseId,operations: [{ ...op('update_existing','teach','teach'),content: draft('teach','new','teaching') }],rationale: 'Manual teaching repair' },'editor');
  const review = approveVocabularyProposal(proposal.proposalId,1,'editor');
  updateVocabularyContent('teach',1,{ ...draft('teach','new','teaching'),body: 'Intervening repair' },actor);
  assert.throws(() => applyVocabularyProposal(proposal.proposalId,1,review,'stale-source','editor'),/base changed/);
  assert.throws(()=>closeVocabularyCase(teaching.caseId,'editor',''),/nonempty/);
  assert.equal(getVocabularyReflectionCase(teaching.caseId).status,'open');
  closeVocabularyTeachingCase(teaching.caseId,'editor','Reviewed alongside exact introduction');
  assert.equal(listVocabularyReflectionCases('teaching_review','editor').length,0);
  const privateContent = createVocabularyContent({ ...draft('private'),accessScope: 'private',ownerLearnerId: 'alice' },actor);
  assert.throws(() => createVocabularyProposal({ operations: [{ ...op('replace',privateContent.contentId,'leak'),content: draft('leak') }],rationale: 'Wrong scope' },'editor'),/ownership/);

});

test('mixed true and unfair rejections keep current conservative schedule and explicit refresh', () => {
  ingest([present('one'),response('one'),present('two'),response('two'),wrap()]);
  const feedback=claimVocabularyReflectionJob({kind:'learner_feedback',now:judgedAt})!;
  sql.prepare("UPDATE learner_word_schedules SET next_eligible_at='2026-10-20T10:00:00.000Z',refresh_requested_at=?,refresh_until='2026-10-20T10:00:00.000Z' WHERE word_id='a'").run(judgedAt);
  const before=sql.prepare("SELECT * FROM learner_word_schedules WHERE word_id='a'").get();
  recordVocabularyFeedbackJudgment(feedback.jobId,feedback.leaseToken,{diagnosis:'One real lapse remains',message:'One alternate fit, the other did not.',unfairEncounterIds:['one']},judgedAt);
  assert.deepEqual(sql.prepare("SELECT * FROM learner_word_schedules WHERE word_id='a'").get(),before);
  assert.equal(Number(sql.prepare('SELECT count(*) n FROM learner_state_effects WHERE judgment_id IS NOT NULL').get()!.n),0);
});

for (const skill of ['recognition','contextual_selection'] as const) {
  test(`${skill} evidence is retained without provider work`, () => {
    const base = draft(skill);
    assert.equal(base.kind,'exercise');
    if (base.kind !== 'exercise') throw new Error('Expected exercise fixture');
    contents[skill] = createVocabularyContent({ ...base,skill,
      exerciseType: skill === 'recognition' ? 'recognition' : 'contrast',
      body: skill === 'recognition' ? { prompt: '字' } : { prompt: 'Choose the expression',choices: [{ wordId: 'a' },{ wordId: 'b' }] },
      assessment: skill === 'recognition' ? { responseMode: 'self_assessment' } : { responseMode: 'word_choice',correctWordId: 'a' },
      words: [{ wordId: 'a',relation: 'target' },...(skill === 'contextual_selection' ? [{ wordId: 'b',relation: 'context' as const }] : [])],
    },actor);
    const rejected: Input = { kind: 'response',payload: { encounterId: skill,response: null,outcome: 'rejected',
      ...(skill === 'recognition' ? { selfAssessment: 'rejected' as const } : { selectedWordId: 'b' }) } };
    const {cases,completion}=ingest([present(skill),rejected,wrap()]);
    const productionBefore = sql.prepare("SELECT * FROM learner_word_schedules WHERE learner_id='alice' AND word_id='a'").get();
    const skillBefore = sql.prepare('SELECT * FROM learner_owned_word_skill_state WHERE learner_id=? AND word_id=? AND skill_id=?').get('alice','a',skill);
    assert.ok(skillBefore);
    assert.equal(cases.length,0);
    assert.equal(claimVocabularyReflectionJob({kind:'learner_feedback',now:judgedAt}),null);
    assert.equal(claimVocabularyReflectionJob({kind:'exercise_improvement',now:judgedAt}),null);
    const retained=JSON.parse(String(sql.prepare('SELECT projection_json FROM vocabulary_reflection_session_evidence WHERE completion_id=?').get(completion.completionId)!.projection_json));
    assert.equal(retained.encounters[0].encounterId,skill);
    assert.equal(retained.encounters[0].responses[0].payload.outcome,'rejected');
    assert.deepEqual(sql.prepare("SELECT * FROM learner_word_schedules WHERE learner_id='alice' AND word_id='a'").get(),productionBefore);
    assert.deepEqual(sql.prepare('SELECT * FROM learner_owned_word_skill_state WHERE learner_id=? AND word_id=? AND skill_id=?').get('alice','a',skill),skillBefore);
    assert.equal(sql.prepare('SELECT count(*) n FROM learner_state_effects WHERE judgment_id IS NOT NULL').get()!.n,0);
    assert.equal(alice(listOwnVocabularyMessages).length,0);
  });
}

test('a genuine recognition lapse does not veto compensation for an unfair production rejection', () => {
  const base = draft('recognition');
  if (base.kind !== 'exercise') throw new Error('Expected exercise fixture');
  contents.recognition = createVocabularyContent({ ...base,skill: 'recognition',exerciseType: 'recognition',
    assessment: { responseMode: 'self_assessment' } },actor);
  ingest([present('one'),response('one'),present('recognition'),
    { kind: 'response',payload: { encounterId: 'recognition',response: null,outcome: 'rejected',selfAssessment: 'rejected' } },wrap()]);
  const recognitionBefore = sql.prepare("SELECT * FROM learner_owned_word_skill_state WHERE skill_id='recognition'").get();
  const productionDueBefore = String(sql.prepare("SELECT next_eligible_at FROM learner_word_schedules WHERE word_id='a'").get()!.next_eligible_at);
  const feedback = claimVocabularyReflectionJob({ kind: 'learner_feedback',now: judgedAt })!;
  assert.deepEqual(feedback.evidence.evidence.map(encounter=>encounter.encounterId),['one']);
  recordVocabularyFeedbackJudgment(feedback.jobId,feedback.leaseToken,{ diagnosis: 'The cue was unfair; pronunciation needs work',
    message: 'Separate learning signals',unfairEncounterIds: ['one'] },judgedAt);
  assert.equal(sql.prepare("SELECT next_eligible_at FROM learner_word_schedules WHERE word_id='a'").get()!.next_eligible_at,
    new Date(Date.parse(productionDueBefore)+24*60*60*1000).toISOString());
  assert.deepEqual(sql.prepare("SELECT * FROM learner_owned_word_skill_state WHERE skill_id='recognition'").get(),recognitionBefore);
});

test('a delayed unfair judgment preserves an explicitly requested active refresh', () => {
  ingest([present('one'),response('one'),{ kind: 'mode_change',payload: { wordId: 'a',mode: 'maintain' } },wrap()]);
  alice(() => requestVocabularyRefresh('a',judgedAt));
  const before = sql.prepare("SELECT * FROM learner_word_schedules WHERE learner_id='alice' AND word_id='a'").get();
  assert.equal(before!.next_eligible_at,judgedAt);
  const feedback = claimVocabularyReflectionJob({ kind: 'learner_feedback',now: judgedAt })!;
  const input = { diagnosis: 'Unfair cue',message: 'Your answer made sense',unfairEncounterIds: ['one'] };
  const result = recordVocabularyFeedbackJudgment(feedback.jobId,feedback.leaseToken,input,judgedAt);
  assert.deepEqual(recordVocabularyFeedbackJudgment(feedback.jobId,feedback.leaseToken,input,judgedAt),result);
  assert.deepEqual(sql.prepare("SELECT * FROM learner_word_schedules WHERE learner_id='alice' AND word_id='a'").get(),before);
  assert.equal(sql.prepare('SELECT count(*) n FROM learner_state_effects WHERE judgment_id IS NOT NULL').get()!.n,0);
  assert.equal(alice(listOwnVocabularyMessages).length,1);
});

test('withdrawn negative reactions retain raw audit evidence without creating repair or feedback work',()=>{
  const {cases,completion}=ingest([present('one'),{kind:'feedback',payload:{encounterId:'one',feedback:'negative'}},
    {kind:'feedback',payload:{encounterId:'one',feedback:'withdrawn'}}]);
  assert.equal(cases.length,0);
  const retained=JSON.parse(String(sql.prepare('SELECT projection_json FROM vocabulary_reflection_session_evidence WHERE completion_id=?').get(completion.completionId)!.projection_json));
  assert.equal(retained.encounters[0].feedback.length,2);assert.equal(retained.encounters[0].effectiveFeedback.length,0);
});

test('case workspace returns only its proposals in the same order and detail as the global list',()=>{
  const {cases}=ingest([present('one'),response('one')]);
  const other=close([present('one','a','other-encounter'),response('other-encounter')],'other-session');
  const otherIds=ingestVocabularySessionEvidence('alice',other.completionId,other.report,closedAt);
  const first=cases.find(value=>value.kind==='exercise_improvement')!,second=otherIds.map(id=>getVocabularyReflectionCase(id)).find(value=>value.kind==='exercise_improvement')!;
  assert.ok(first);assert.ok(second);
  const older=createVocabularyProposal({caseId:first.caseId,operations:[op()],rationale:'Older'},'editor');
  const newer=createVocabularyProposal({caseId:first.caseId,operations:[op()],rationale:'Newer'},'editor');
  createVocabularyProposal({caseId:second.caseId,operations:[op()],rationale:'Other case'},'editor');
  createVocabularyProposal({operations:[op()],rationale:'No case'},'editor');
  sql.prepare('UPDATE content_proposals SET updated_at=? WHERE proposal_id=?').run('2026-01-01T00:00:00.000Z',older.proposalId);
  sql.prepare('UPDATE content_proposals SET updated_at=? WHERE proposal_id=?').run('2026-01-02T00:00:00.000Z',newer.proposalId);
  const expected=listVocabularyProposals('editor').filter(value=>value.caseId===first.caseId);
  assert.deepEqual(expected.map(value=>value.proposalId),[newer.proposalId,older.proposalId]);
  assert.deepEqual(getVocabularyCaseWorkspace(first.caseId,'editor').proposals,expected);
});

test('ordered teaching exercise and introduction repair previews and applies atomically against pre-state bases',()=>{
  const intro=getVocabularyContentForMaintenance('intro')!;
  const operations:VocabularyProposalOperation[]=[{operationKey:'exercise',scope:{kind:'shared'},strategy:'update_existing',sourceContentId:'teach',expectedVersion:1,rationale:'Repair this taught cue',
    content:{...draft('teach','new','teaching'),body:'Revised taught cue'}},
    {operationKey:'introduction',scope:{kind:'shared'},strategy:'update_existing',sourceContentId:'intro',expectedVersion:1,rationale:'Keep the introduction paired with its revised exercise',
      content:{...intro,body:'Coherent revised introduction',teachingExercises:[{exerciseId:'teach',exerciseVersion:2}]}}];
  const created=createVocabularyProposal({operations,rationale:'One coherent teaching repair'},'editor');
  assert.deepEqual(created.bases,[{contentId:'intro',expectedVersion:1},{contentId:'teach',expectedVersion:1}]);
  const preview=previewVocabularyProposal(created.proposalId,1,'editor');assert.equal(preview.previews.length,2);
  assert.equal(getVocabularyContentForMaintenance('teach')!.version,1);assert.equal(getVocabularyContentForMaintenance('intro')!.version,1);
  const review=approveVocabularyProposal(created.proposalId,1,'editor');
  applyVocabularyProposal(created.proposalId,1,review,'coherent-teaching','editor');
  assert.equal(getVocabularyContentForMaintenance('teach')!.version,2);assert.equal(getVocabularyContentForMaintenance('intro')!.version,2);
  assert.equal(sql.prepare("SELECT exercise_version FROM introduction_exercises WHERE introduction_id='intro'").get()!.exercise_version,2);
  const old=JSON.parse(String(sql.prepare("SELECT snapshot_json FROM content_revision_history WHERE content_id='intro' AND version=1").get()!.snapshot_json));
  assert.equal(old.teachingExercises[0].exerciseVersion,1);assert.deepEqual(sql.prepare('PRAGMA foreign_key_check').all(),[]);
});

test('ordered teaching output references never waive stale pre-state or forward-order checks',()=>{
  const intro=getVocabularyContentForMaintenance('intro')!;
  const exercise:VocabularyProposalOperation={operationKey:'exercise',scope:{kind:'shared'},strategy:'update_existing',sourceContentId:'teach',expectedVersion:1,rationale:'Revised cue',content:{...draft('teach','new','teaching'),body:'Proposed'}};
  const introduction:VocabularyProposalOperation={operationKey:'introduction',scope:{kind:'shared'},strategy:'update_existing',sourceContentId:'intro',expectedVersion:1,rationale:'Bind exact revised cue',content:{...intro,teachingExercises:[{exerciseId:'teach',exerciseVersion:2}]}};
  assert.throws(()=>createVocabularyProposal({operations:[introduction,exercise],rationale:'Invalid forward order'},'editor'),/base versions|FOREIGN KEY/);
  const created=createVocabularyProposal({operations:[exercise,introduction],rationale:'Ordered teaching repair'},'editor');
  const review=approveVocabularyProposal(created.proposalId,1,'editor');
  updateVocabularyContent('teach',1,{...draft('teach','new','teaching'),body:'Intervening repair'},actor);
  assert.throws(()=>applyVocabularyProposal(created.proposalId,1,review,'stale-coherent-teaching','editor'),/base changed/);
  assert.equal(getVocabularyContentForMaintenance('intro')!.version,1);
  assert.equal(sql.prepare('SELECT count(*) n FROM proposal_applications WHERE proposal_id=?').get(created.proposalId)!.n,0);
});

test('unresolved pure-cue referral stays inspectable alongside a local proposal and can be closed without publishing',()=>{
  ingest([present('one'),response('one')]);
  const work=claimVocabularyReflectionJob({kind:'exercise_improvement',now:judgedAt})!;
  const pureCueReferral={candidateWords:['甲','乙'],sharedPurpose:'A shared task.',rationale:'Consider the alternative.'};
  const pureCuePromotion={outcome:'needs_operator' as const,rationale:'Candidate pronunciation is ambiguous.',candidateWordIds:['a'],existingContentId:null};
  const input={diagnosis:'Local clarification is independently useful.',proposal:{operations:[op()],rationale:'Clarify.'},pureCueReferral,pureCuePromotion};
  const result=recordVocabularyImprovementResult(work.jobId,work.leaseToken,input,judgedAt);
  const workspace=getVocabularyCaseWorkspace(work.caseId,'editor');
  assert.deepEqual(workspace.pureCueReferral,pureCueReferral);assert.deepEqual(workspace.pureCuePromotion,pureCuePromotion);
  assert.equal(workspace.case.status,'open');assert.ok(result.proposalId);assert.equal(getVocabularyContentForMaintenance('one')!.version,1);
  assert.throws(()=>closeVocabularyCase(work.caseId,'editor',''),/nonempty/);
  assert.equal(getVocabularyReflectionCase(work.caseId).status,'open');
  closeVocabularyCase(work.caseId,'editor','Deferred unresolved lexical identity');
  assert.equal(getVocabularyCaseWorkspace(work.caseId,'editor').case.status,'closed');
  assert.deepEqual(recordVocabularyImprovementResult(work.jobId,work.leaseToken,input,judgedAt),result);
});

test('pure-cue membership extension follows exact operator approval and preserves its identity and other word exercises',()=>{
  const pure=createVocabularyContent({...draft('shared-pure'),exerciseType:'pure_cue'},actor);
  if(pure.kind!=='exercise')assert.fail('Expected exercise');
  ingest([present('one'),response('one')]);
  const work=claimVocabularyReflectionJob({kind:'exercise_improvement',now:judgedAt})!;
  const operation:VocabularyProposalOperation={operationKey:'pure-cue-promotion',scope:{kind:'shared'},strategy:'update_existing',sourceContentId:pure.contentId,expectedVersion:1,rationale:'Another member fulfills the same task.',
    content:{...pure,words:[...pure.words,{wordId:'b',relation:'target'}],answers:[...pure.answers,{wordId:'b',acceptedForms:['乙']}]}};
  const result=recordVocabularyImprovementResult(work.jobId,work.leaseToken,{diagnosis:'Shared task.',proposal:{operations:[operation],rationale:'Extend compatible cue.'},
    pureCueReferral:{candidateWords:['甲','乙'],sharedPurpose:'Shared task.',rationale:'Same slot.'},pureCuePromotion:{outcome:'extend',rationale:'Existing cue fits both.',candidateWordIds:['a','b'],existingContentId:pure.contentId}},judgedAt);
  assert.throws(()=>applyVocabularyProposal(result.proposalId!,1,'unknown','early','editor'),/approval/);
  const preview=previewVocabularyProposal(result.proposalId!,1,'editor');assert.equal(preview.previews[0]!.result.version,2);
  assert.equal(getVocabularyContentForMaintenance(pure.contentId)!.version,1);
  const review=approveVocabularyProposal(result.proposalId!,1,'editor');
  applyVocabularyProposal(result.proposalId!,1,review,'publish-pure','editor');
  const updated=getVocabularyContentForMaintenance(pure.contentId)!;if(updated.kind!=='exercise')assert.fail('Expected exercise');
  assert.equal(updated.version,2);assert.equal(updated.exerciseType,'pure_cue');assert.deepEqual(updated.body,pure.body);
  assert.equal(updated.answers.length,2);assert.equal(getVocabularyContentForMaintenance('one')!.version,1);
});

test('second opinion snapshots a proposal version, retries explicitly, and cannot overwrite manual edits', () => {
  const {cases}=ingest([present('one'),response('one'),wrap()]);
  const caseId=cases.find(item=>item.kind==='exercise_improvement')!.caseId;
  const initial=claimVocabularyReflectionJob({kind:'exercise_improvement',now:judgedAt})!;
  recordVocabularyImprovementResult(initial.jobId,initial.leaseToken,{diagnosis:'Repair',proposal:null},judgedAt);
  const value=createVocabularyProposal({caseId,operations:[op()],rationale:'Original proposal'},'editor');
  assert.throws(()=>requestVocabularySecondOpinion(value.proposalId,value.version,'not-editor'),/Operator/);
  assert.throws(()=>requestVocabularySecondOpinion(value.proposalId,value.version+1,'editor'),/version changed/);
  const request=requestVocabularySecondOpinion(value.proposalId,value.version,'editor','Check natural usage');
  assert.equal(request.status,'queued');
  assert.deepEqual(requestVocabularySecondOpinion(value.proposalId,value.version,'editor'),request);
  const now=new Date(Date.now()+1000).toISOString();
  const review=claimVocabularyReflectionJob({kind:'exercise_improvement',now})!;
  assert.equal(review.jobId,request.jobId);
  assert.equal(review.secondOpinion?.proposal.rationale,'Original proposal');
  assert.equal(review.secondOpinion?.notes,'Check natural usage');
  failVocabularyReflectionJob(review.jobId,review.leaseToken,'provider_unavailable',now,now);
  assert.equal(claimVocabularyReflectionJob({kind:'exercise_improvement',now}),null);
  retryVocabularyReflectionJob(review.jobId,'editor');
  const retry=claimVocabularyReflectionJob({kind:'exercise_improvement',now})!;
  assert.equal(retry.attemptNumber,2);
  const edited=saveVocabularyProposal(value.proposalId,value.version,{caseId,operations:[op()],rationale:'Operator revision'},'editor');
  assert.equal(retry.secondOpinion?.proposal.version,1);
  assert.throws(()=>recordVocabularyImprovementResult(retry.jobId,retry.leaseToken,{diagnosis:'Incorrect result shape',proposal:null},now),/advisory verdict/);
  const result={diagnosis:'The cue needs revision',proposal:null,secondOpinion:{verdict:'revise' as const,rationale:'The cue needs revision'}};
  recordVocabularyImprovementResult(retry.jobId,retry.leaseToken,result,now);
  recordVocabularyImprovementResult(retry.jobId,retry.leaseToken,result,now);
  assert.equal(getVocabularyProposal(value.proposalId,'editor').rationale,'Operator revision');
  assert.equal(edited.version,2);
  const [opinion]=listVocabularySecondOpinions(value.proposalId,'editor');
  assert.equal(opinion.proposalVersion,1);
  assert.equal(opinion.status,'succeeded');
  assert.equal(opinion.result?.verdict,'revise');
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM content_proposals').get()!.n,1);
});


test('feedback dismissal is private, idempotent, retained, and independent of read and learning state', () => {
  ingest([present('one'),response('one'),wrap()]);
  const job=claimVocabularyReflectionJob({kind:'learner_feedback',now:judgedAt})!;
  const result=recordVocabularyFeedbackJudgment(job.jobId,job.leaseToken,{diagnosis:'Fair',message:'A retained lesson',unfairEncounterIds:[]},judgedAt);
  const id=result.messageId!;
  const schedules=sql.prepare('SELECT * FROM learner_word_schedules').all();
  const effects=sql.prepare('SELECT * FROM learner_state_effects').all();
  const content=sql.prepare('SELECT * FROM content_proposals').all();
  const read=()=>alice(listOwnVocabularyMessages)[0]!;
  assert.equal(read().dismissedAt,null);
  assert.equal(alice(getOwnVocabularyFeedbackAttention).unseenCount,1);
  for (const action of [dismissOwnVocabularyMessage,restoreOwnVocabularyMessage])
    assert.throws(()=>runWithLearnerId('bob',()=>action(id)),/does not belong/);
  alice(()=>dismissOwnVocabularyMessage(id,judgedAt));
  alice(()=>dismissOwnVocabularyMessage(id,'2026-10-18T11:00:00.000Z'));
  assert.equal(read().dismissedAt,judgedAt);
  assert.equal(read().seenAt,null);
  assert.equal(read().body,'A retained lesson');
  assert.equal(alice(getOwnVocabularyFeedbackAttention).unseenCount,0);
  alice(()=>{restoreOwnVocabularyMessage(id);restoreOwnVocabularyMessage(id);});
  assert.equal(read().dismissedAt,null);
  assert.equal(alice(getOwnVocabularyFeedbackAttention).unseenCount,1);
  alice(()=>{markOwnVocabularyMessageSeen(id,judgedAt);dismissOwnVocabularyMessage(id);restoreOwnVocabularyMessage(id);});
  assert.equal(read().seenAt,judgedAt);
  assert.equal(alice(getOwnVocabularyFeedbackAttention).unseenCount,0);
  assert.deepEqual(sql.prepare('SELECT * FROM learner_word_schedules').all(),schedules);
  assert.deepEqual(sql.prepare('SELECT * FROM learner_state_effects').all(),effects);
  assert.deepEqual(sql.prepare('SELECT * FROM content_proposals').all(),content);
  assert.throws(()=>sql.prepare('DELETE FROM learner_messages WHERE message_id=?').run(id),/retained/);
});

test('feedback dismissal migration preserves existing messages and read state and immutable lesson content', () => {
  sql.exec('ALTER TABLE learner_messages DROP COLUMN dismissed_at');
  ingest([present('one'),response('one'),wrap()]);
  const job=claimVocabularyReflectionJob({kind:'learner_feedback',now:judgedAt})!;
  const result=recordVocabularyFeedbackJudgment(job.jobId,job.leaseToken,{diagnosis:'Fair',message:'Existing lesson',unfairEncounterIds:[]},judgedAt);
  alice(()=>markOwnVocabularyMessageSeen(result.messageId!,judgedAt));
  const before=sql.prepare('SELECT * FROM learner_messages').all();
  sql.exec(fs.readFileSync(new URL('../server/db/migrations/0055_vocabulary_feedback_dismissal.sql',import.meta.url),'utf8'));
  assert.deepEqual(sql.prepare('SELECT * FROM learner_messages').all().map(row=>({...row})),before.map(row=>({...row,dismissed_at:null})));
  assert.throws(()=>sql.exec("UPDATE learner_messages SET body_json='{}'"),/read-only/);
  assert.deepEqual(sql.prepare('PRAGMA foreign_key_check').all(),[]);
});

// Preserve the legacy reflection-store recovery promise on the new proposal model.
test('approved proposal and applied receipt survive database reopen without duplicate content writes',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vocabulary-proposal-reopen-'));
  const file=path.join(dir,'proposal.db');
  try {
    const proposal=createVocabularyProposal({operations:[op()],rationale:'Retained repair'},'editor');
    const review=approveVocabularyProposal(proposal.proposalId,1,'editor');
    await backup(sql,file);
    sql.close();sql=new DatabaseSync(file);sql.exec('PRAGMA foreign_keys=ON');setDb(sql);
    assert.equal(getVocabularyProposal(proposal.proposalId,'editor').version,1);
    const receipt=applyVocabularyProposal(proposal.proposalId,1,review,'reopen-apply','editor');
    const content=getVocabularyContentForMaintenance('one');
    const changeCount=sql.prepare('SELECT count(*) n FROM application_content_changes').get()!.n;
    sql.close();sql=new DatabaseSync(file);sql.exec('PRAGMA foreign_keys=ON');setDb(sql);
    assert.deepEqual(applyVocabularyProposal(proposal.proposalId,1,review,'reopen-apply','editor'),receipt);
    assert.deepEqual(getVocabularyContentForMaintenance('one'),content);
    assert.equal(sql.prepare('SELECT count(*) n FROM application_content_changes').get()!.n,changeCount);
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});


test('historical no-proposal judgments remain reviewable with a separate advisory job', () => {
  const {cases}=ingest([present('one'),response('one'),wrap()]);
  const caseId=cases.find(item=>item.kind==='exercise_improvement')!.caseId;
  const initial=claimVocabularyReflectionJob({kind:'exercise_improvement',now:judgedAt})!;
  recordVocabularyImprovementResult(initial.jobId,initial.leaseToken,{diagnosis:'No change needed',proposal:null},judgedAt);
  assert.deepEqual(listVocabularyNoProposalCases('editor').map(item=>item.caseId),[caseId]);
  requestVocabularyCaseSecondOpinion(caseId,'editor','Consider the answer');
  assert.throws(()=>requestVocabularyCaseSecondOpinion(caseId,'editor','Again'),/already in progress/);
  assert.equal(listVocabularyReflectionCases('exercise_improvement','editor').length,0);
  const now=new Date(Date.now()+1000).toISOString();
  const review=claimVocabularyReflectionJob({kind:'exercise_improvement',now})!;
  assert.notEqual(review.caseId,caseId);
  assert.equal(review.secondOpinion?.proposal,null);
  assert.equal(review.secondOpinion?.diagnosis,'No change needed');
  assert.equal(review.secondOpinion?.notes,'Consider the answer');
  recordVocabularyImprovementResult(review.jobId,review.leaseToken,{diagnosis:'Consider revising',proposal:null,secondOpinion:{verdict:'revise',rationale:'The cue is ambiguous'}},now);
  assert.equal(getVocabularyCaseWorkspace(caseId,'editor').jobs.find(item=>item.secondOpinion)?.result?.verdict,'revise');
  assert.deepEqual(listVocabularyNoProposalCases('editor').map(item=>item.caseId),[caseId]);
  closeVocabularyCase(caseId,'editor');
  assert.equal(listVocabularyNoProposalCases('editor').length,0);
  assert.deepEqual(listVocabularyNoProposalCases('editor','closed').map(item=>item.caseId),[caseId]);
});


test('proposal dismissal without a reason records review and leaves authored content and learner state intact',()=>{
  const created=createVocabularyProposal({operations:[op()],rationale:'Clarify this cue.'},'editor');
  const content=getVocabularyContentForMaintenance('one');
  const schedules=sql.prepare('SELECT * FROM learner_word_schedules ORDER BY learner_id,word_id').all();
  assert.throws(()=>closeVocabularyProposal(created.proposalId,2,'editor'),/version/);
  assert.equal(getVocabularyProposal(created.proposalId,'editor').status,'awaiting_review');
  closeVocabularyProposal(created.proposalId,1,'editor');
  assert.equal(getVocabularyProposal(created.proposalId,'editor').status,'closed');
  const review=sql.prepare('SELECT disposition,notes_json FROM proposal_reviews WHERE proposal_id=?').get(created.proposalId)!;
  assert.equal(review.disposition,'rejected');assert.deepEqual(JSON.parse(String(review.notes_json)),{reason:''});
  const event=sql.prepare("SELECT data_json FROM backend_events WHERE name='vocabulary.reflection.proposal_closed' AND entity_id=?").get(created.proposalId)!;
  assert.deepEqual(JSON.parse(String(event.data_json)),{version:1,reason:''});
  assert.deepEqual(getVocabularyContentForMaintenance('one'),content);
  assert.deepEqual(sql.prepare('SELECT * FROM learner_word_schedules ORDER BY learner_id,word_id').all(),schedules);
  assert.equal(sql.prepare('SELECT count(*) n FROM proposal_applications WHERE proposal_id=?').get(created.proposalId)!.n,0);
  assert.throws(()=>closeVocabularyProposal(created.proposalId,1,'editor'),/already resolved/);
});


test('proposal resolution times come from application receipts and closure events, independently of old draft dates',()=>{
  const applied=createVocabularyProposal({operations:[op()],rationale:'Apply this change'},'editor');
  const dismissed=createVocabularyProposal({operations:[op()],rationale:'Review this change'},'editor');
  const pending=createVocabularyProposal({operations:[op()],rationale:'Keep awaiting review'},'editor');
  sql.prepare("UPDATE content_proposals SET created_at=?,updated_at=?").run(at,at);
  assert.ok(listVocabularyProposals('editor').every(value=>value.resolvedAt===null));
  const review=approveVocabularyProposal(applied.proposalId,1,'editor');
  assert.equal(getVocabularyProposal(applied.proposalId,'editor').resolvedAt,null);
  const receipt=applyVocabularyProposal(applied.proposalId,1,review,'resolve-old-draft','editor');
  const appliedAt=String(sql.prepare('SELECT applied_at FROM proposal_applications WHERE application_id=?').get(receipt.applicationId)!.applied_at);
  assert.notEqual(appliedAt,at);assert.equal(getVocabularyProposal(applied.proposalId,'editor').resolvedAt,appliedAt);
  const late='2099-01-02T00:00:00.000Z',earlier='2099-01-01T00:00:00.000Z';
  closeVocabularyProposal(dismissed.proposalId,1,'editor');
  const closedAt=String(sql.prepare("SELECT occurred_at FROM backend_events WHERE entity_id=? AND name='vocabulary.reflection.proposal_closed'").get(dismissed.proposalId)!.occurred_at);
  assert.notEqual(closedAt,at);assert.equal(getVocabularyProposal(dismissed.proposalId,'editor').resolvedAt,closedAt);
  for(const [entityId,occurredAt,name] of [[dismissed.proposalId,late,'vocabulary.reflection.proposal_closed'],[dismissed.proposalId,earlier,'vocabulary.reflection.proposal_closed'],[dismissed.proposalId,'2099-01-03T00:00:00.000Z','vocabulary.reflection.retry_requested'],[pending.proposalId,late,'vocabulary.reflection.proposal_closed'],[applied.proposalId,late,'vocabulary.reflection.proposal_closed']] as const)
    emitBackendEvent({entityKind:'reflection',entityId,name,occurredAt,data:{version:1}});
  assert.equal(getVocabularyProposal(dismissed.proposalId,'editor').resolvedAt,late);
  assert.equal(getVocabularyProposal(applied.proposalId,'editor').resolvedAt,appliedAt);
  assert.equal(getVocabularyProposal(pending.proposalId,'editor').resolvedAt,null);
  const listed=new Map(listVocabularyProposals('editor').map(value=>[value.proposalId,value.resolvedAt]));
  assert.equal(listed.get(dismissed.proposalId),late);assert.equal(listed.get(applied.proposalId),appliedAt);assert.equal(listed.get(pending.proposalId),null);
  assert.equal(sql.prepare('SELECT updated_at FROM content_proposals WHERE proposal_id=?').get(applied.proposalId)!.updated_at,at);
});

for(const kind of ['no-change','teaching'] as const)test(`${kind} case resolution uses its latest closure event and not case creation time`,()=>{
  const {cases}=ingest(kind==='teaching'?[present('intro','new'),present('teach','new'),{kind:'feedback',payload:{encounterId:'teach',feedback:'negative'}}]:[present('one'),response('one'),wrap()]);
  const evidence=cases.find(value=>value.kind===(kind==='teaching'?'teaching_review':'exercise_improvement'))!;
  if(kind==='no-change') {
    const job=claimVocabularyReflectionJob({kind:'exercise_improvement',now:judgedAt})!;
    recordVocabularyImprovementResult(job.jobId,job.leaseToken,{diagnosis:'No change needed',proposal:null},judgedAt);
  }
  assert.equal(getVocabularyReflectionCase(evidence.caseId).resolvedAt,null);
  closeVocabularyCase(evidence.caseId,'editor',kind==='teaching'?'Reviewed teaching content':'');
  const eventName=kind==='teaching'?'vocabulary.reflection.teaching_case_closed':'vocabulary.reflection.admission_case_closed';
  const resolvedAt=String(sql.prepare('SELECT occurred_at FROM backend_events WHERE entity_id=? AND name=?').get(evidence.caseId,eventName)!.occurred_at);
  assert.notEqual(resolvedAt,evidence.createdAt);assert.equal(getVocabularyReflectionCase(evidence.caseId).resolvedAt,resolvedAt);
  for(const occurredAt of ['2099-01-02T00:00:00.000Z','2099-01-01T00:00:00.000Z'])emitBackendEvent({entityKind:'reflection',entityId:evidence.caseId,name:eventName,occurredAt,data:{reason:'Later closure'}});
  assert.equal(getVocabularyCaseWorkspace(evidence.caseId,'editor').case.resolvedAt,'2099-01-02T00:00:00.000Z');
  if(kind==='no-change')assert.equal(listVocabularyNoProposalCases('editor','closed')[0]!.resolvedAt,'2099-01-02T00:00:00.000Z');
});

test('historical resolved records without authoritative evidence have no fabricated resolution time',()=>{
  const closed=createVocabularyProposal({operations:[op()],rationale:'Legacy closed proposal'},'editor');
  const applied=createVocabularyProposal({operations:[op()],rationale:'Legacy applied proposal'},'editor');
  sql.prepare("UPDATE content_proposals SET status='closed' WHERE proposal_id=?").run(closed.proposalId);
  sql.prepare("UPDATE content_proposals SET status='applied' WHERE proposal_id=?").run(applied.proposalId);
  assert.equal(getVocabularyProposal(closed.proposalId,'editor').resolvedAt,null);
  assert.equal(getVocabularyProposal(applied.proposalId,'editor').resolvedAt,null);
  const {cases}=ingest([present('one'),response('one'),wrap()]);
  const evidence=cases.find(value=>value.kind==='exercise_improvement')!;
  sql.prepare("UPDATE reflection_cases SET status='closed' WHERE case_id=?").run(evidence.caseId);
  assert.equal(getVocabularyReflectionCase(evidence.caseId).resolvedAt,null);
});


test('reassessment queues an independent model-selected job and prevents concurrent retries',()=>{
  sql.exec('ALTER TABLE vocabulary_reflection_jobs ADD COLUMN model_choice TEXT');
  const {cases}=ingest([present('cue',null),response('cue')]);
  const caseId=cases.find(item=>item.kind==='exercise_improvement')!.caseId;
  const initial=claimVocabularyReflectionJob({kind:'exercise_improvement',now:judgedAt})!;
  recordVocabularyImprovementResult(initial.jobId,initial.leaseToken,{diagnosis:'Original judgment',proposal:null},judgedAt);
  const proposal=createVocabularyProposal({caseId,operations:[op()],rationale:'Review'},'editor');
  const batch=()=>listVocabularyProposalReviewBatch('editor',{startProposalId:proposal.proposalId}).items[0].reassessment;
  const before=sql.prepare('SELECT total_changes() AS count').get()!.count;
  assert.deepEqual(batch(),{eligible:true,source:{contentId:initial.evidence.evidence[0]!.snapshot.contentId,assessedVersion:1,currentVersion:1},latest:null});
  assert.equal(sql.prepare('SELECT total_changes() AS count').get()!.count,before);
  const request=requestVocabularyReassessment(caseId,'editor','openai:gpt-6-sol-high',1);
  assert.equal(batch()?.latest?.jobId,request.jobId);
  assert.equal(batch()?.latest?.status,'queued');
  assert.notEqual(request.caseId,caseId);
  assert.equal(getVocabularyCaseWorkspace(caseId,'editor').reassessment?.jobId,request.jobId);
  assert.throws(()=>requestVocabularyReassessment(caseId,'editor','openai:gpt-6-sol-high',1),/already in progress/);
  const now=new Date(Date.now()+1000).toISOString();
  const child=claimVocabularyReflectionJob({kind:'exercise_improvement',now})!;
  assert.equal(child.jobId,request.jobId);
  assert.equal(child.reassessmentSourceJobId,initial.jobId);
  assert.equal(sql.prepare('SELECT model_choice FROM vocabulary_reflection_jobs WHERE job_id=?').get(child.jobId)!.model_choice,'openai:gpt-6-sol-high');
  failVocabularyReflectionJob(child.jobId,child.leaseToken,'failed',now,now);
  assert.equal(batch()?.latest?.status,'failed');
  const another=requestVocabularyReassessment(caseId,'editor','openai:gpt-5.6-luna-high',1);
  assert.throws(()=>retryVocabularyReflectionJob(child.jobId,'editor',now),/already in progress/);
  sql.prepare("UPDATE vocabulary_reflection_jobs SET created_at='2000-01-01T00:00:00.000Z' WHERE job_id=?").run(another.jobId);
  assert.equal(getVocabularyCaseWorkspace(caseId,'editor').reassessment?.jobId,another.jobId);
  sql.prepare("UPDATE vocabulary_reflection_jobs SET status='succeeded',created_at='9999-01-01T00:00:00.000Z' WHERE job_id=?").run(another.jobId);
  assert.equal(batch()?.latest?.status,'succeeded');
});

test('reassessment pins the confirmed current version, retains history, and fences publication and application',()=>{
  sql.exec('ALTER TABLE vocabulary_reflection_jobs ADD COLUMN model_choice TEXT');
  const {cases}=ingest([present('one'),response('one')]);
  const caseId=cases.find(item=>item.kind==='exercise_improvement')!.caseId;
  const initial=claimVocabularyReflectionJob({kind:'exercise_improvement',now:judgedAt})!;
  recordVocabularyImprovementResult(initial.jobId,initial.leaseToken,{diagnosis:'Original',proposal:null},judgedAt);
  updateVocabularyContent('one',1,{...draft('one'),body:{prompt:'Current source'}},actor);
  assert.deepEqual(getVocabularyCaseWorkspace(caseId,'editor').reassessmentSource,{contentId:'one',assessedVersion:1,currentVersion:2});
  assert.throws(()=>requestVocabularyReassessment(caseId,'editor','openai:gpt-6-sol-high',1),/version changed/);
  const request=requestVocabularyReassessment(caseId,'editor','openai:gpt-6-sol-high',2);
  const now=new Date(Date.now()+1000).toISOString();
  const child=claimVocabularyReflectionJob({kind:'exercise_improvement',now})!;
  assert.equal(child.jobId,request.jobId);
  assert.equal(child.reassessmentSource!.version,2);
  assert.deepEqual(child.evidence.evidence,initial.evidence.evidence);
  const operation=op();if(operation.strategy==='create')assert.fail('Expected update');operation.expectedVersion=2;
  const result=recordVocabularyImprovementResult(child.jobId,child.leaseToken,{diagnosis:'Current assessment',proposal:{operations:[operation],rationale:'Current assessment',bases:[{contentId:'one',expectedVersion:2}]}},now);
  updateVocabularyContent('one',2,{...draft('one'),body:{prompt:'Newer source'}},actor);
  assert.throws(()=>approveVocabularyProposal(result.proposalId!,1,'editor'),/version|changed/i);
  assert.deepEqual(getVocabularyCaseWorkspace(request.caseId,'editor').reassessmentSource,{contentId:'one',assessedVersion:2,currentVersion:3});
  const next=requestVocabularyReassessment(request.caseId,'editor','openai:gpt-6-sol-high',3);
  const nextJob=claimVocabularyReflectionJob({kind:'exercise_improvement',now})!;
  assert.equal(nextJob.jobId,next.jobId);
  updateVocabularyContent('one',3,{...draft('one'),body:{prompt:'Raced source'}},actor);
  assert.throws(()=>recordVocabularyImprovementResult(nextJob.jobId,nextJob.leaseToken,{diagnosis:'No change',proposal:null},now),/source version changed before publication/);
});

test('advisory review of reassessment keeps the pinned source and excludes historical encounters',()=>{
  sql.exec("ALTER TABLE lexical_words ADD COLUMN traditional TEXT; ALTER TABLE lexical_words ADD COLUMN meaning TEXT;");
  sql.exec('ALTER TABLE vocabulary_reflection_jobs ADD COLUMN model_choice TEXT');
  const {cases}=ingest([present('one'),response('one')]);
  const caseId=cases.find(item=>item.kind==='exercise_improvement')!.caseId;
  const initial=claimVocabularyReflectionJob({kind:'exercise_improvement',now:judgedAt})!;
  recordVocabularyImprovementResult(initial.jobId,initial.leaseToken,{diagnosis:'Original',proposal:null},judgedAt);
  updateVocabularyContent('one',1,{...draft('one'),body:{prompt:'Current source'}},actor);
  const request=requestVocabularyReassessment(caseId,'editor','openai:gpt-6-sol-high',2);
  const now=new Date(Date.now()+1000).toISOString();
  const child=claimVocabularyReflectionJob({kind:'exercise_improvement',now})!;
  recordVocabularyImprovementResult(child.jobId,child.leaseToken,{diagnosis:'No repair',proposal:null},now);
  requestVocabularyCaseSecondOpinion(request.caseId,'editor','Review this assessment');
  const advisory=claimVocabularyReflectionJob({kind:'exercise_improvement',now})!;
  assert.equal(advisory.reassessmentSource!.version,2);
  const input=projectVocabularyReflectionInput(advisory) as {sourceContent:VocabularyContent;encounters:unknown[]};
  assert.equal(input.sourceContent.version,2);
  assert.deepEqual(input.encounters,[]);
});


function approvalFixture() {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'vocabulary-approval-'));
  const filePath=path.join(directory,'requests.jsonl');
  const proposal=createVocabularyProposal({operations:[op()],rationale:'Operator repair'},'editor');
  const input={requestId:'approval-one',proposalId:proposal.proposalId,expectedVersion:1,actorId:'editor',notes:{reason:'Reviewed'}};
  const queue=createVocabularyApprovalRequests({filePath,controls:()=>({maintenanceMode:false})});
  return {directory,filePath,proposal,input,queue};
}
test('approval admission persists exact operator instruction without preview writes and replay applies it once',()=>{
  const f=approvalFixture();
  try {
    const ack=f.queue.enqueue(f.input);
    assert.equal(ack.status,'queued');assert.equal(getVocabularyContentForMaintenance('one')!.version,1);
    assert.equal(sql.prepare('SELECT count(*) n FROM proposal_reviews').get()!.n,0);
    assert.deepEqual(f.queue.enqueue(f.input),ack);
    assert.throws(()=>f.queue.enqueue({...f.input,notes:'Changed authorization'}),/another approval/);
    assert.throws(()=>f.queue.enqueue({...f.input,requestId:'second'}),/already has a queued approval/);
    const restarted=createVocabularyApprovalRequests({filePath:f.filePath,controls:()=>({maintenanceMode:false})});
    assert.equal(restarted.step(),true);
    const done=restarted.list()[0]!;assert.equal(done.status,'succeeded');assert.ok(done.application);
    assert.ok(done.updatedAt>ack.updatedAt);assert.equal(getVocabularyContentForMaintenance('one')!.version,2);
    assert.deepEqual(completeVocabularyApprovalRequest(f.input),done.application);
    assert.equal(sql.prepare('SELECT count(*) n FROM proposal_reviews').get()!.n,1);
    assert.equal(sql.prepare('SELECT count(*) n FROM proposal_applications').get()!.n,1);
    assert.throws(()=>completeVocabularyApprovalRequest({...f.input,notes:'Different operator decision'}),/another authorization/);
  }finally{fs.rmSync(f.directory,{recursive:true,force:true});}
});
test('approval worker retains stale exact-version validation failures in attention and compacts resolved attention',()=>{
  const f=approvalFixture();
  try {
    f.queue.enqueue(f.input);
    saveVocabularyProposal(f.proposal.proposalId,1,{operations:[op()],rationale:'Changed after submission'},'editor');
    assert.equal(f.queue.step(),true);
    assert.equal(f.queue.list()[0]!.status,'attention');assert.match(f.queue.list()[0]!.error!,/version changed/);
    assert.equal(getVocabularyContentForMaintenance('one')!.version,1);
    assert.equal(sql.prepare('SELECT count(*) n FROM proposal_reviews').get()!.n,0);
    f.queue.compact();assert.deepEqual(f.queue.list(),[]);
  }finally{fs.rmSync(f.directory,{recursive:true,force:true});}
});
test('approval validation and application roll back together on overlapping proposals',()=>{
  const f=approvalFixture();
  try {
    f.queue.enqueue(f.input);
    const second=createVocabularyProposal({operations:[op()],rationale:'Overlapping repair'},'editor');
    f.queue.enqueue({...f.input,requestId:'second',proposalId:second.proposalId});
    f.queue.step();f.queue.step();
    assert.deepEqual(f.queue.list().map(item=>item.status),['succeeded','attention']);
    assert.equal(sql.prepare('SELECT count(*) n FROM proposal_reviews').get()!.n,1);
    assert.equal(getVocabularyContentForMaintenance('one')!.version,2);
  }finally{fs.rmSync(f.directory,{recursive:true,force:true});}
});
test('approval worker pauses in maintenance and bounds infrastructure retries before explicit retry',()=>{
  const f=approvalFixture();let maintenance=true,calls=0;
  const queue=createVocabularyApprovalRequests({filePath:f.filePath,controls:()=>({maintenanceMode:maintenance}),
    complete:()=>{calls++;throw Object.assign(new Error('Storage busy'),{code:'ERR_SQLITE_ERROR',errcode:5});}});
  try {
    queue.enqueue(f.input);assert.equal(queue.step(),false);assert.equal(calls,0);
    maintenance=false;queue.step();queue.step();queue.step();
    assert.equal(calls,3);assert.equal(queue.list()[0]!.status,'attention');
    assert.equal(queue.step(),false);assert.throws(()=>queue.retry(f.input.requestId,'someone-else'),/another operator/);
    const retried=queue.retry(f.input.requestId,'editor');assert.equal(retried.status,'queued');assert.equal(retried.attempts,0);
    queue.stop();assert.equal(queue.step(),false);
  }finally{fs.rmSync(f.directory,{recursive:true,force:true});}
});
test('approval journal discards only a torn final record, retains pending requests through compaction, and rejects malformed committed data',()=>{
  const f=approvalFixture();
  try {
    f.queue.enqueue(f.input);fs.appendFileSync(f.filePath,'{"requestId":"torn');
    const restarted=createVocabularyApprovalRequests({filePath:f.filePath,controls:()=>({maintenanceMode:false})});
    assert.equal(restarted.list().length,1);assert.ok(fs.readFileSync(f.filePath,'utf8').endsWith('\n'));
    restarted.compact();assert.equal(restarted.list()[0]!.status,'queued');
    fs.appendFileSync(f.filePath,'invalid JSON\n');
    const broken=createVocabularyApprovalRequests({filePath:f.filePath});
    assert.throws(()=>broken.list(),/JSON/);
  }finally{fs.rmSync(f.directory,{recursive:true,force:true});}
});
test('crash after SQLite commit but before success journal append reconciles its receipt after restart',t=>{
  const f=approvalFixture();
  try {
    f.queue.enqueue(f.input);
    const original=fs.appendFileSync;
    t.mock.method(fs,'appendFileSync',(...args:Parameters<typeof fs.appendFileSync>)=>{
      if(String(args[1]).includes('"status":"succeeded"'))throw Object.assign(new Error('Disk full'),{code:'ENOSPC'});
      return original(...args);
    });
    assert.throws(()=>f.queue.step(),/Disk full/);
    assert.equal(getVocabularyContentForMaintenance('one')!.version,2);
    assert.equal(f.queue.list()[0]!.status,'running');
    t.mock.restoreAll();
    const restarted=createVocabularyApprovalRequests({filePath:f.filePath,controls:()=>({maintenanceMode:false})});
    restarted.step();assert.equal(restarted.list()[0]!.status,'succeeded');
    assert.equal(getVocabularyContentForMaintenance('one')!.version,2);
    assert.equal(sql.prepare('SELECT count(*) n FROM proposal_reviews').get()!.n,1);
  }finally{t.mock.restoreAll();fs.rmSync(f.directory,{recursive:true,force:true});}
});

test('an application failure after validation rolls back its review, content changes, and application together',()=>{
  const f=approvalFixture();
  try {
    f.queue.enqueue(f.input);
    sql.exec("CREATE TRIGGER fail_application BEFORE INSERT ON proposal_applications BEGIN SELECT RAISE(ABORT,'Application write failed'); END;");
    f.queue.step();assert.equal(f.queue.list()[0]!.status,'attention');
    assert.equal(getVocabularyContentForMaintenance('one')!.version,1);
    assert.equal(getVocabularyProposal(f.proposal.proposalId,'editor').status,'awaiting_review');
    assert.equal(sql.prepare('SELECT count(*) n FROM proposal_reviews').get()!.n,0);
    assert.equal(sql.prepare('SELECT count(*) n FROM proposal_applications').get()!.n,0);
    sql.exec('DROP TRIGGER fail_application');
    f.queue.retry(f.input.requestId,'editor');f.queue.step();
    assert.equal(f.queue.list()[0]!.status,'succeeded');
  }finally{fs.rmSync(f.directory,{recursive:true,force:true});}
});


test('review coverage distinguishes inherit from none and reassessment retains explicit selection',()=>{
  sql.exec('ALTER TABLE vocabulary_reflection_jobs ADD COLUMN model_choice TEXT');
  const sense=createVocabularySense({wordId:'a',description:'written character'},actor);
  ingest([present('one'),response('one')]);
  const work=claimVocabularyReflectionJob({kind:'exercise_improvement',now:judgedAt})!;
  writeVocabularyWordSenseCoverage('a',0,[sense.senseId],actor);
  assert.deepEqual(resolveVocabularySenseCoverage('a',work.caseId).includedSenseIds,[]);
  writeVocabularyCaseSenseCoverage(work.caseId,0,[sense.senseId],actor);
  assert.deepEqual(resolveVocabularySenseCoverage('a',work.caseId).includedSenseIds,[sense.senseId]);
  recordVocabularyImprovementResult(work.jobId,work.leaseToken,{diagnosis:'Review',proposal:null},judgedAt);
  const child=requestVocabularyReassessment(work.caseId,'editor','openai:gpt-6-sol-high',1);
  assert.deepEqual(resolveVocabularySenseCoverage('a',child.caseId).review?.includedSenseIds,[sense.senseId]);
  writeVocabularyCaseSenseCoverage(work.caseId,1,[],actor);
  assert.deepEqual(resolveVocabularySenseCoverage('a',work.caseId).review?.includedSenseIds,[]);
  writeVocabularyCaseSenseCoverage(work.caseId,2,null,actor);
  assert.equal(resolveVocabularySenseCoverage('a',work.caseId).review?.includedSenseIds,null);
  assert.deepEqual(resolveVocabularySenseCoverage('a',work.caseId).includedSenseIds,[]);
});

for(const route of ['reassessment','proposal opinion','case opinion'] as const)for(const selection of ['set','none','inherit'] as const)test(`child coverage inherits ${selection} via ${route}`,()=>{
  sql.exec('ALTER TABLE vocabulary_reflection_jobs ADD COLUMN model_choice TEXT');
  const sense=createVocabularySense({wordId:'a',description:'written character'},actor);
  ingest([present('one'),response('one')]);
  const work=claimVocabularyReflectionJob({kind:'exercise_improvement',now:judgedAt})!;
  writeVocabularyCaseSenseCoverage(work.caseId,0,selection==='inherit'?null:selection==='none'?[]:[sense.senseId],actor);
  const result=recordVocabularyImprovementResult(work.jobId,work.leaseToken,{diagnosis:'Review',proposal:route==='proposal opinion'?{operations:[op()],rationale:'Repair'}:null},judgedAt);
  let childId:string;
  if(route==='reassessment')childId=requestVocabularyReassessment(work.caseId,'editor','openai:gpt-6-sol-high',1).caseId;
  else if(route==='proposal opinion'){const opinion=requestVocabularySecondOpinion(result.proposalId!,1,'editor');childId=(sql.prepare('SELECT case_id FROM vocabulary_reflection_jobs WHERE job_id=?').get(opinion.jobId) as {case_id:string}).case_id;}
  else {requestVocabularyCaseSecondOpinion(work.caseId,'editor','Try another view');childId=(sql.prepare('SELECT case_id FROM vocabulary_reflection_jobs WHERE case_id!=? AND second_opinion_json IS NOT NULL').get(work.caseId) as {case_id:string}).case_id;}
  assert.deepEqual(resolveVocabularySenseCoverage('a',childId).review?.includedSenseIds,selection==='inherit'?null:selection==='none'?[]:[sense.senseId]);
});
