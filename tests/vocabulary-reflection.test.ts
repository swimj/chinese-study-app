import { getVocabularyOriginalModelProposal } from '../server/db/vocabulary-reflection.ts';
import { getVocabularyCaseCard } from '../server/db/vocabulary-case-queue.ts';
import { getVocabularyRepertoireSelection } from '../server/db/vocabulary-repertoire-selection.ts';
import { getVocabularyRepairTarget, setVocabularyRepairTarget } from '../server/db/vocabulary-repair-target.ts';
import { saveRepertoireWordDefaults, saveRepertoireWordDefaultsAndReassess } from '../server/db/vocabulary-repertoire-revision.ts';
import { getVocabularyCaseReview } from '../server/db/vocabulary-case-reviews.ts';
import { installCaseReviewSchema } from './helpers/case-review-schema.ts';
import { getVocabularySenseCoverageWorkspace,writeVocabularyDefaultUsefulSenses,resolveVocabularySenseCoverage,writeVocabularyWordSenseCoverage } from '../server/db/vocabulary-sense-coverage.ts';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync, backup } from 'node:sqlite';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, afterEach, test } from 'node:test';
import { setDb } from '../server/db/connection.ts';
import { runWithLearnerId } from '../server/db/learner-context.ts';
import { selectVocabularyReviewSkills } from '../server/vocabulary/review-selection.ts';
import { selectVocabularyPureCueCandidates } from '../server/vocabulary/pure-cue-serving.ts';
import { requestVocabularyRefresh } from '../server/db/vocabulary-learners.ts';
import { createVocabularyContent, emitBackendEvent, getVocabularyContentForMaintenance, listVocabularyExercises, updateVocabularyContent,createVocabularySense,getVocabularySenseCatalog,getVocabularySenses,establishVocabularySenseCatalog,mapVocabularyContentSense,updateVocabularySense } from '../server/db/vocabulary-content.ts';
import { migrateSharedDictionaryBaselines } from '../server/db/dictionary-baseline-sharing.ts';
import { createVocabularyApprovalRequests } from '../server/vocabulary/approval-requests.ts';
import { completeVocabularyApprovalRequest, recordVocabularyApprovalIntent } from '../server/db/vocabulary-reflection.ts';
import { createVocabularyReflectionProvider, normalizeVocabularyReflectionOutput, projectVocabularyReflectionInput } from '../server/vocabulary/reflection-provider.ts';
import { vocabularyReflectionModelChoice } from '../server/db/vocabulary-reflection-routing.ts';
import type { ProviderAdapter } from '../server/llm/types.ts';
import { createVocabularySession, appendVocabularySessionActions, stageVocabularySessionCompletion, closeVocabularySessionCompletion } from '../server/db/vocabulary-sessions.ts';
import { ingestVocabularySessionEvidence, getVocabularyReflectionCase, listVocabularyReflectionCases,
  claimVocabularyReflectionJob, recoverVocabularyReflectionJobs, failVocabularyReflectionJob, retryOwnVocabularyFeedback,
  recordVocabularyFeedbackJudgment, recordVocabularyImprovementResult, listOwnVocabularyMessages, markOwnVocabularyMessageSeen, dismissOwnVocabularyMessage, restoreOwnVocabularyMessage, getOwnVocabularyFeedbackAttention,
  requestVocabularyPureCueResolution, requestVocabularyReassessment, requestVocabularySecondOpinion, listVocabularySecondOpinions, listVocabularyNoProposalCases, requestVocabularyCaseSecondOpinion, retryVocabularyReflectionJob, createVocabularyProposal, saveVocabularyProposal, approveVocabularyProposal, applyVocabularyProposal,
  previewVocabularyProposal, getVocabularyProposal, listVocabularyProposals, listVocabularyProposalReviewBatch, closeVocabularyProposal, closeVocabularyTeachingCase, closeVocabularyCase, getVocabularyCaseWorkspace } from '../server/db/vocabulary-reflection.ts';
import type { VocabularyContentDraft, VocabularyContent } from '../src/domain/vocabulary-content.ts';
import type { VocabularySessionAction, VocabularyEncounterSnapshot } from '../src/domain/vocabulary-session.ts';
import type { VocabularyProposalOperation, VocabularyReflectionResult } from '../src/domain/vocabulary-reflection.ts';
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
    CREATE TABLE lexical_words(id TEXT PRIMARY KEY); CREATE TABLE model_invocations(id TEXT PRIMARY KEY,step_name TEXT,provider TEXT,model TEXT,resolved_model TEXT);
    INSERT INTO learners VALUES ('alice',NULL),('bob',NULL); INSERT INTO lexical_words VALUES ('a'),('b'),('new');`);
  sql.exec(fs.readFileSync(new URL('../server/db/migrations/0039_vocabulary_content.sql',import.meta.url),'utf8'));
  sql.exec(fs.readFileSync(new URL('../server/db/migrations/0062_vocabulary_sense_coverage.sql',import.meta.url),'utf8'));
  sql.exec(fs.readFileSync(new URL('../server/db/migrations/0064_vocabulary_default_useful_senses.sql',import.meta.url),'utf8'));
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
  sql.exec("ALTER TABLE lexical_words ADD COLUMN hanzi TEXT NOT NULL DEFAULT '字';ALTER TABLE lexical_words ADD COLUMN pinyin TEXT NOT NULL DEFAULT 'zì';ALTER TABLE lexical_words ADD COLUMN traditional TEXT;ALTER TABLE lexical_words ADD COLUMN meaning TEXT NOT NULL DEFAULT 'character';");

  sql.exec(fs.readFileSync(new URL('../server/db/migrations/0042_vocabulary_sessions.sql',import.meta.url),'utf8'));
  sql.exec(fs.readFileSync(new URL('../server/db/migrations/0044_vocabulary_reflection.sql',import.meta.url),'utf8'));
  sql.exec(fs.readFileSync(new URL('../server/db/migrations/0061_vocabulary_sense_mapping_retries.sql',import.meta.url),'utf8'));
  sql.exec(fs.readFileSync(new URL('../server/db/migrations/0063_vocabulary_proposal_drop_actions.sql',import.meta.url),'utf8'));
  sql.exec(fs.readFileSync(new URL('../server/db/migrations/0059_vocabulary_reassessment.sql',import.meta.url),'utf8'));
  sql.exec(fs.readFileSync(new URL('../server/db/migrations/0060_vocabulary_reassessment_source.sql',import.meta.url),'utf8'));
  sql.exec(fs.readFileSync(new URL('../server/db/migrations/0055_vocabulary_feedback_dismissal.sql',import.meta.url),'utf8'));
  sql.exec(`INSERT INTO learner_words(learner_id,word_id,in_stash,added_at,mode,mode_changed_at) VALUES
    ('alice','a',1,'2026-01-01','practice','2026-01-01'),('alice','b',1,'2026-01-01','practice','2026-01-01'),
    ('alice','new',1,'2026-01-01','unstudied','2026-01-01');
    INSERT INTO learner_word_schedules(learner_id,word_id,next_eligible_at,policy_version,scheduler_state_json)
    SELECT learner_id,word_id,'2026-10-20T10:00:00.000Z','test','{"intervalHours":24,"easeFactor":2.5,"enabled":1,"cleanCoveredSessions":0}' FROM learner_words;`);
  for(const name of ['0023_session_debrief.sql','0048_vocabulary_connections.sql','0049_vocabulary_sense_readiness.sql','0050_vocabulary_improvement_admission.sql','0051_vocabulary_pure_cue_promotion.sql','0053_vocabulary_second_opinions.sql'])sql.exec(fs.readFileSync(new URL(`../server/db/migrations/${name}`,import.meta.url),'utf8'));
  installCaseReviewSchema(sql);
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
function typed(encounterId: string,text: string,outcome: 'accepted'|'rejected'): Input { return { kind: 'response',payload: { encounterId,response: text,outcome } }; }
function wrap(): Input { return { kind: 'word_wrap',payload: { wordId: 'a',reason: 'enough' } }; }
function play(inputs: Input[],sessionId: string, startedAt = at) {
  return alice(() => {
    createVocabularySession({ sessionId,words: [{ wordId: 'a',mode: 'practice' },{ wordId: 'b',mode: 'practice' },{ wordId: 'new',mode: 'unstudied',
      teachingRequirements: { introductionContentId: 'intro',requiredExerciseContentIds: ['teach'],minimumRecognitionResponses: 0,minimumProductionResponses: 1 } }] },startedAt);
    const actions = [...inputs,{ kind: 'finish_for_now',payload: {} }] as Input[];
    const mapped = actions.map((input,index) => ({ ...input,protocolVersion: 1 as const,actionId: `${sessionId}-${index}`,
      clientActionId: `${sessionId}-client-${index}`,sequence: index+1,occurredAt: startedAt }));
    const persisted = appendVocabularySessionActions(sessionId,mapped,startedAt);
    if (persisted.projection.phase !== 'completed') {
      const index = mapped.length;
      appendVocabularySessionActions(sessionId,[{ protocolVersion: 1,actionId: `${sessionId}-${index}`,clientActionId: `${sessionId}-client-${index}`,
        sequence: index+1,occurredAt: startedAt,kind: 'finish_immediately',payload: {} }],startedAt);
      actions.push({ kind: 'finish_immediately',payload: {} });
    }
    return actions.length;
  });
}
function close(inputs: Input[],sessionId='session', startedAt = at, finalizedAt = closedAt) {
  const throughSequence = play(inputs,sessionId,startedAt);
  const staged = alice(() => stageVocabularySessionCompletion(sessionId,throughSequence,startedAt));
  return alice(() => closeVocabularySessionCompletion(sessionId,staged.completionId,finalizedAt));
}
function ingest(inputs: Input[]) {
  const completion = close(inputs); const ids = ingestVocabularySessionEvidence('alice',completion.completionId,completion.report,closedAt);
  return { completion,ids,cases: ids.map(id => getVocabularyReflectionCase(id)) };
}
function op(strategy: 'create'|'update_existing'|'replace'|'retire'='update_existing',source='one',next='one'): VocabularyProposalOperation {
  return { operationKey: 'repair',scope: { kind: 'shared' },rationale: 'Improve this exact cue',content: draft(next),
    ...(strategy === 'create' ? { strategy } : { strategy,sourceContentId: source,expectedVersion: 1 }) };
}

function historicalDictionaryBaselineJob(migrate=true) {
  // This fixture models first repertoire bootstrap; unrelated authored cues for
  // the same word would correctly suppress another bootstrap.
  for(const id of ['one','two'])updateVocabularyContent(id,1,{...contents[id]!,availability:'retired'},actor);
  sql.exec("UPDATE lexical_words SET meaning='written character; writing system'; ");
  const id='vocabulary:baseline:v1:alice:production:general:a';
  contents[id]=createVocabularyContent({contentId:id,kind:'exercise',payloadVersion:1,
    body:{prompt:'written character; writing system',instruction:'Give the Mandarin word.',source:{kind:'dictionary_baseline',wordId:'a'}},
    accessScope:'private',ownerLearnerId:'alice',availability:'active',originKind:'human',authorKind:'service',authorId:'vocabulary-dictionary-baseline-v1',
    exerciseType:'definition',skill:'production',exerciseRole:'general',assessment:{match:'prepared_answer_membership'},
    words:[{wordId:'a',relation:'target'}],answers:[{wordId:'a',acceptedForms:['字']}]},actor);
  for(const senseId of ['character','script'])createVocabularySense({senseId,wordId:'a',description:{label:senseId}},actor);
  establishVocabularySenseCatalog('a',getVocabularySenseCatalog('a').version,actor);
  writeVocabularyDefaultUsefulSenses('a',0,['character','script'],actor);
  ingest([present(id),response(id)]);
  const work=claimVocabularyReflectionJob({kind:'exercise_improvement',now:judgedAt})!;
  if(migrate)migrateDictionaryBaselines();
  sql.prepare("UPDATE vocabulary_reflection_jobs SET model_choice='openai:gpt-5.6-luna-high' WHERE job_id=?").run(work.jobId);
  return {id,work};
}

test('saved Luna routing upgrades without rerolling or changing the retained route', () => {
  const { work } = historicalDictionaryBaselineJob(false);
  assert.equal(vocabularyReflectionModelChoice(work.jobId, () => assert.fail('must retain the saved route')), 'openai:gpt-6-luna-high');
  assert.equal(sql.prepare('SELECT model_choice FROM vocabulary_reflection_jobs WHERE job_id=?').get(work.jobId)!.model_choice, 'openai:gpt-5.6-luna-high');
});

function migrateDictionaryBaselines() {
  sql.exec('BEGIN IMMEDIATE');
  try { migrateSharedDictionaryBaselines(sql);sql.exec('COMMIT'); }
  catch(error) { sql.exec('ROLLBACK');throw error; }
}
function dictionaryRepertoireProvider(accessScope:'shared'|'private',version:number) {
  const current=getVocabularyContentForMaintenance('vocabulary:baseline:v1:alice:production:general:a')!;
  assert.equal(current.accessScope,accessScope);assert.equal(current.version,version);
  let calls=0;
  const adapter:ProviderAdapter={id:'fake',defaultBaseUrl:'https://unused.invalid',apiKeyEnvironmentVariable:'KEY',structuredOutputMode:'json_schema',async run(request){
    calls++;
    const input=JSON.parse(request.userPrompt) as {sourceContent:VocabularyContent;content:{uses:Array<{id:string;label:string}>}};
    assert.equal(request.provenance!.stepName,'repertoire');
    const value={exercises:[{id:'character',sourceUseId:input.content.uses.find(use=>use.label==='character')!.id,stimulus:{kind:'direct_text',text:'A single written unit in a text.'},teachingNote:'Written unit.'},
        {id:'script',sourceUseId:input.content.uses.find(use=>use.label==='script')!.id,stimulus:{kind:'direct_text',text:'A system of signs used for writing.'},teachingNote:'Writing system.'}]};
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
  assert.equal(trial.calls,1);assert.equal(result.result.admission?.sourceContentVersion,2);
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
  assert.equal(listVocabularyProposalReviewBatch('editor',{startProposalId:migrated.proposalId}).items[0]!.coverageChanged,false);
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
  assert.throws(()=>recordVocabularyImprovementResult(work.jobId,work.leaseToken,{diagnosis:'Review',proposal:null,admission},judgedAt),/source version changed before publication/);
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

function lessonResponses(caseId: string): { actionId: string; response: string | null; outcome: string }[] {
  const evidence = getVocabularyReflectionCase(caseId).evidence;
  return evidence.flatMap(encounter => encounter.responses.map(action => ({ actionId: action.actionId, response: action.payload.response, outcome: action.payload.outcome })));
}
test('a matching written answer marked wrong lapses scheduling without opening feedback, unlike a typed miss', () => {
  const marked = { kind: 'response' as const, payload: { encounterId: 'said', response: '字', outcome: 'rejected' as const, selfAssessment: 'rejected' as const } };
  const { ids, completion } = ingest([present('one','a','said'), marked, wrap()]);
  assert.deepEqual(ids, []);
  assert.equal(completion.report.words.a!.covered, true);
  assert.equal(completion.report.words.a!.hasRejectedResponse, true);
  assert.equal(completion.report.words.a!.successfulRecall, false);
  assert.equal(completion.report.encounters[0]?.effectiveResponses[0]?.payload.response, '字');
  const schedule = JSON.parse(String(sql.prepare("SELECT scheduler_state_json FROM learner_word_schedules WHERE word_id='a'").get()!.scheduler_state_json)) as { intervalHours: number; easeFactor: number };
  assert.equal(schedule.intervalHours, 6);
  assert.equal(schedule.easeFactor, 2.35);
  assert.throws(() => close([present('one','a','bad'), { kind: 'response', payload: { encounterId: 'bad', response: '别', outcome: 'rejected', selfAssessment: 'rejected' } }], 'bad-mark'), /accepted written answer/);
  const typedMiss = close([present('one','a','miss'), typed('miss','别字','rejected'), wrap()], 'typed-miss');
  const typedKinds = ingestVocabularySessionEvidence('alice', typedMiss.completionId, typedMiss.report, closedAt).map(id => getVocabularyReflectionCase(id).kind);
  assert.ok(typedKinds.includes('learner_feedback'));
  assert.ok(typedKinds.includes('exercise_improvement'));
  assert.equal(typedMiss.report.encounters[0]?.effectiveResponses[0]?.payload.selfAssessment, undefined);
});

for (const contentId of ['one', 'cue', 'teach']) test(`pronunciation encounters with comments and negative reactions do not open cases: ${contentId}`, () => {
  const wordId = contentId === 'cue' ? null : contentId === 'teach' ? 'new' : 'a';
  const { ids, completion } = ingest([...(contentId === 'teach' ? [present('intro', 'new')] : []), present(contentId, wordId, 'said'),
    { kind: 'response', payload: { encounterId: 'said', response: '字', outcome: 'rejected', selfAssessment: 'rejected' } },
    { kind: 'feedback', payload: { encounterId: 'said', feedback: 'negative' } },
    { kind: 'feedback', payload: { encounterId: 'said', feedback: 'comment', comment: 'I said it wrong.' } }]);
  assert.deepEqual(ids, []);
  const encounter = completion.report.encounters.find(item => item.encounterId === 'said')!;
  assert.equal(encounter.effectiveResponses[0]!.payload.selfAssessment, 'rejected');
  assert.equal(encounter.feedback.length, 2);
});

test('mixed cases retain pronunciation lapses internally but omit their entire encounters from model input and compensation', () => {
  const { ids } = ingest([present('one','a','said'),
    { kind: 'response', payload: { encounterId: 'said', response: '字', outcome: 'rejected', selfAssessment: 'rejected' } },
    { kind: 'feedback', payload: { encounterId: 'said', feedback: 'comment', comment: 'pronunciation-private-marker' } },
    present('one','a','written'), typed('written','别字','rejected'), wrap()]);
  assert.deepEqual(ids.map(id => getVocabularyReflectionCase(id).kind).sort(), ['exercise_improvement','learner_feedback']);
  for (const id of ids) assert.deepEqual(getVocabularyReflectionCase(id).evidence.map(item => item.encounterId), ['said','written']);
  const before = sql.prepare("SELECT next_eligible_at, scheduler_state_json FROM learner_word_schedules WHERE word_id='a'").get()!;
  const feedback = claimVocabularyReflectionJob({ kind: 'learner_feedback', now: judgedAt })!;
  const projected = JSON.stringify(projectVocabularyReflectionInput(feedback));
  assert.equal(projected.includes('pronunciation-private-marker'), false);
  assert.equal(projected.includes('"encounterId":"said"'), false);
  assert.equal(projected.includes('"encounterId":"written"'), true);
  assert.throws(() => normalizeVocabularyReflectionOutput(feedback, { diagnosis: 'Unfair', lesson: 'Lesson', unfairEncounterIds: ['said'] }), /supplied rejected/);
  // Only the supplied written rejection is excused; the hidden genuine lapse still blocks compensation.
  recordVocabularyFeedbackJudgment(feedback.jobId, feedback.leaseToken, { diagnosis: 'Unfair written cue', message: 'Lesson', unfairEncounterIds: ['written'] }, judgedAt);
  const after = sql.prepare("SELECT next_eligible_at, scheduler_state_json FROM learner_word_schedules WHERE word_id='a'").get()!;
  assert.deepEqual(after, before);
});

test('undoing a pronunciation report before close leaves an ordinary success', () => {
  const completion = close([
    present('one','a','said'),
    { kind: 'response', payload: { encounterId: 'said', response: '字', outcome: 'rejected', selfAssessment: 'rejected' } },
    { kind: 'undo', payload: { undoesActionId: 'withdrawn-1' } },
    typed('said','字','accepted'), wrap(),
  ], 'withdrawn');
  const ids = ingestVocabularySessionEvidence('alice', completion.completionId, completion.report, closedAt);
  assert.deepEqual(ids, []);
  assert.equal(completion.report.words.a!.hasRejectedResponse, false);
  assert.equal(completion.report.words.a!.successfulRecall, true);
  const schedule = JSON.parse(String(sql.prepare("SELECT scheduler_state_json FROM learner_word_schedules WHERE word_id='a'").get()!.scheduler_state_json)) as { easeFactor: number };
  assert.equal(schedule.easeFactor, 2.5);
});

test('an undone production submission does not create a lesson or improvement case or change the retained correction schedule', () => {
  const completion = close([
    present('one','a','clean-one'), typed('clean-one','accidental','rejected'),
    { kind: 'undo', payload: { undoesActionId: 'clean-1' } }, response('clean-one','accepted'),
  ], 'clean');
  const ids = ingestVocabularySessionEvidence('alice', completion.completionId, completion.report, closedAt);
  assert.deepEqual(ids.map(id => getVocabularyReflectionCase(id).kind), []);
  const encounter = completion.report.encounters[0]!;
  assert.equal(encounter.responses[0]?.payload.response, 'accidental');
  assert.deepEqual(encounter.effectiveResponses.map(action => action.payload.response), ['字']);
  assert.equal(completion.report.words.a!.hasRejectedResponse, false);
  assert.equal(completion.report.words.a!.covered, true);
  const schedule = JSON.parse(String(sql.prepare("SELECT scheduler_state_json FROM learner_word_schedules WHERE word_id='a'").get()!.scheduler_state_json)) as { intervalHours: number; easeFactor: number };
  assert.equal(schedule.easeFactor, 2.5);
  assert.notEqual(schedule.intervalHours, 6);
  assert.equal(alice(listOwnVocabularyMessages).length, 0);
});

test('undo without a replacement response supplies no learner lesson or improvement case', () => {
  const completion = close([
    present('one','a','abandoned-one'), typed('abandoned-one','accidental','rejected'),
    { kind: 'undo', payload: { undoesActionId: 'abandoned-1' } },
  ], 'abandoned');
  assert.equal(completion.report.encounters[0]?.effectiveResponses.length, 0);
  assert.equal(completion.report.encounters[0]?.responses.length, 1);
  const ids = ingestVocabularySessionEvidence('alice', completion.completionId, completion.report, closedAt);
  assert.deepEqual(ids.map(id => getVocabularyReflectionCase(id).kind), []);
  assert.equal(claimVocabularyReflectionJob({ kind: 'learner_feedback', now: judgedAt }), null);
  assert.equal(claimVocabularyReflectionJob({ kind: 'exercise_improvement', now: judgedAt }), null);
});

test('a retained production rejection reaches feedback and improvement while the undone response and a recognition lapse do not', () => {
  const base = draft('recognition');
  if (base.kind !== 'exercise') throw new Error('Expected exercise fixture');
  contents.recognition = createVocabularyContent({ ...base, skill: 'recognition', exerciseType: 'recognition',
    assessment: { responseMode: 'self_assessment' } }, actor);
  const completion = close([
    present('one','a','kept-one'), typed('kept-one','accidental','rejected'),
    { kind: 'undo', payload: { undoesActionId: 'kept-1' } }, typed('kept-one','kept-miss','rejected'),
    present('two','a','kept-two'), typed('kept-two','ordinary-miss','rejected'),
    present('recognition','a','kept-recognition'),
    { kind: 'response', payload: { encounterId: 'kept-recognition', response: null, outcome: 'rejected', selfAssessment: 'rejected' } },
    present('cue', null, 'kept-cue'), typed('kept-cue','pure-miss','rejected'),
    wrap(),
  ], 'kept');
  const ids = ingestVocabularySessionEvidence('alice', completion.completionId, completion.report, closedAt);
  assert.deepEqual(new Set(ingestVocabularySessionEvidence('alice', completion.completionId, completion.report, closedAt)), new Set(ids));
  const cases = ids.map(id => getVocabularyReflectionCase(id));
  const lessons = cases.filter(item => item.kind === 'learner_feedback');
  const improvements = cases.filter(item => item.kind === 'exercise_improvement');
  const word = lessons.find(item => item.wordId === 'a');
  const pure = lessons.find(item => item.contentId === 'cue');
  if (!word || !pure) assert.fail('Expected separate word and pure-cue lessons');
  assert.deepEqual(lessonResponses(word.caseId).map(item => item.response), ['kept-miss','ordinary-miss']);
  assert.equal(JSON.stringify(word.evidence).includes('accidental'), false);
  assert.deepEqual(word.evidence.map(encounter => encounter.encounterId), ['kept-one','kept-two']);
  assert.deepEqual(lessonResponses(pure.caseId).map(item => item.response), ['pure-miss']);
  assert.equal(completion.report.encounters.find(encounter => encounter.encounterId === 'kept-one')?.responses[0]?.payload.response, 'accidental');
  assert.deepEqual(new Set(improvements.flatMap(item => item.evidence.map(encounter => encounter.encounterId))), new Set(['kept-one','kept-two','kept-cue']));
  assert.equal(JSON.stringify(improvements.map(item => item.evidence)).includes('accidental'), false);
  assert.deepEqual(lessonResponses(improvements.find(item => item.evidence[0]?.encounterId === 'kept-one')!.caseId).map(item => item.response), ['kept-miss']);
  const feedback = claimVocabularyReflectionJob({ kind: 'learner_feedback', now: judgedAt })!;
  const projected = JSON.stringify(projectVocabularyReflectionInput(feedback));
  assert.equal(projected.includes('accidental'), false);
  assert.equal(projected.includes('kept-miss') || projected.includes('pure-miss'), true);
  const schedule = JSON.parse(String(sql.prepare("SELECT scheduler_state_json FROM learner_word_schedules WHERE word_id='a'").get()!.scheduler_state_json)) as { easeFactor: number };
  assert.equal(schedule.easeFactor, 2.2);
});

test('an effective comment still creates a lesson and improvement after the rejected submission was undone', () => {
  const completion = close([
    present('one','a','noted-one'), typed('noted-one','accidental','rejected'),
    { kind: 'feedback', payload: { encounterId: 'noted-one', feedback: 'comment', comment: 'The cue was unclear.' } },
    { kind: 'undo', payload: { undoesActionId: 'noted-1' } }, response('noted-one','accepted'),
  ], 'noted');
  const ids = ingestVocabularySessionEvidence('alice', completion.completionId, completion.report, closedAt);
  const lesson = ids.map(id => getVocabularyReflectionCase(id)).find(item => item.kind === 'learner_feedback');
  const improvement = ids.map(id => getVocabularyReflectionCase(id)).find(item => item.kind === 'exercise_improvement');
  if (!lesson) assert.fail('Expected a comment lesson');
  if (!improvement) assert.fail('Expected a comment improvement case');
  assert.deepEqual(lessonResponses(lesson.caseId), [{ actionId: 'noted-4', response: '字', outcome: 'accepted' }]);
  assert.deepEqual(lessonResponses(improvement.caseId), [{ actionId: 'noted-4', response: '字', outcome: 'accepted' }]);
  assert.equal(lesson.evidence[0]?.effectiveFeedback.some(action => action.payload.comment === 'The cue was unclear.'), true);
  assert.equal(JSON.stringify(lesson.evidence).includes('accidental'), false);
  assert.equal(JSON.stringify(improvement.evidence).includes('accidental'), false);
  const before = wordSchedule();
  const feedback = claimVocabularyReflectionJob({kind:'learner_feedback',now:judgedAt})!;
  recordVocabularyFeedbackJudgment(feedback.jobId,feedback.leaseToken,{diagnosis:'The cue could be clearer',message:null,unfairEncounterIds:[]},judgedAt);
  assert.deepEqual(wordSchedule(),before);
});

test('a presentation-undone production encounter does not enter exercise improvement while a retained sibling encounter still does', () => {
  const completion = close([
    present('one','a','kept-one'), typed('kept-one','kept-miss','rejected'),
    { kind: 'exercise_skip', payload: { encounterId: 'kept-one' }, transitionId: 'retry' } as Input & { transitionId: string },
    { kind: 'exercise_exclude', payload: { encounterId: 'kept-one' }, transitionId: 'retry' } as Input & { transitionId: string },
    { ...present('one','a','gone-one'), transitionId: 'retry' } as Input & { transitionId: string },
    { kind: 'undo', payload: { undoesActionId: 'presentation-undone-3' } },
    wrap(),
  ], 'presentation-undone');
  assert.equal(completion.report.encounters.find(item => item.encounterId === 'kept-one')?.presentationUndone, false);
  assert.equal(completion.report.encounters.find(item => item.encounterId === 'gone-one')?.presentationUndone, true);
  const ids = ingestVocabularySessionEvidence('alice', completion.completionId, completion.report, closedAt);
  const improvements = ids.map(id => getVocabularyReflectionCase(id)).filter(item => item.kind === 'exercise_improvement');
  assert.equal(improvements.length, 1);
  assert.deepEqual(improvements[0]!.evidence.map(item => item.encounterId), ['kept-one']);
  assert.deepEqual(lessonResponses(improvements[0]!.caseId).map(item => item.response), ['kept-miss']);
  assert.equal(JSON.stringify(improvements[0]!.evidence).includes('gone-one'), false);
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
  const beforeJudgment = sql.prepare("SELECT * FROM learner_word_schedules WHERE word_id='a'").get();
  sql.exec("CREATE TRIGGER fail_compensation_receipt BEFORE INSERT ON learner_state_effects WHEN NEW.judgment_id IS NOT NULL BEGIN SELECT RAISE(ABORT,'receipt failed'); END");
  assert.throws(() => recordVocabularyFeedbackJudgment(feedback.jobId,feedback.leaseToken,input,judgedAt),/receipt failed/);
  assert.deepEqual(sql.prepare("SELECT * FROM learner_word_schedules WHERE word_id='a'").get(),beforeJudgment);
  assert.equal(sql.prepare('SELECT count(*) n FROM teacher_judgments').get()!.n,0);
  assert.equal(alice(listOwnVocabularyMessages).length,0);
  sql.exec('DROP TRIGGER fail_compensation_receipt');
  const result = recordVocabularyFeedbackJudgment(feedback.jobId,feedback.leaseToken,input,judgedAt);
  assert.deepEqual(recordVocabularyFeedbackJudgment(feedback.jobId,feedback.leaseToken,input,judgedAt),result);
  assert.equal(wordSchedule().next_eligible_at,'2026-10-20T10:00:00.000Z');
  assert.equal(sql.prepare("SELECT mode FROM learner_words WHERE word_id='a'").get()!.mode,'maintain');
  assert.equal(wordSchedule().refresh_until,null,'the lapse-triggered automatic refresh was reversed');
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
  assert.throws(()=>closeVocabularyCase(work.caseId,'editor',null as unknown as string),/Expected text reason/);
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

const cueSchedule = () => sql.prepare("SELECT * FROM learner_pure_cue_schedules WHERE learner_id='alice' AND content_id='cue'").get()!;
const wordSchedule = (wordId = 'a', learnerId = 'alice') =>
  sql.prepare("SELECT * FROM learner_word_schedules WHERE learner_id=? AND word_id=?").get(learnerId,wordId)!;
const scheduler = (row: ReturnType<typeof wordSchedule>) => JSON.parse(String(row.scheduler_state_json));
const coveredCueLapse = () => [false,true,true,true].flatMap((accepted,index) =>
  [present('cue',null,`cue-${index}`),response(`cue-${index}`,accepted ? 'accepted' : 'rejected')]);

test('unfinished pure-cue feedback leaves the schedule alone because closure wrote no lapse', () => {
  sql.prepare(`INSERT INTO learner_pure_cue_schedules(learner_id,content_id,next_eligible_at,policy_version,scheduler_state_json)
    VALUES ('alice','cue','2026-10-20T10:00:00.000Z','test','{"intervalHours":24,"easeFactor":2.5}')`).run();
  const before = cueSchedule();
  const { cases, completion } = ingest([present('cue',null),response('cue')]);
  const feedbackCase = cases.find(item => item.kind === 'learner_feedback')!;
  assert.equal(feedbackCase.wordId,null);
  assert.equal(feedbackCase.contentId,'cue');
  assert.equal(completion.report.pureCueOutcomes[0]?.covered,false);
  const feedback = claimVocabularyReflectionJob({ kind: 'learner_feedback',now: judgedAt })!;
  recordVocabularyFeedbackJudgment(feedback.jobId,feedback.leaseToken,{ diagnosis: 'Unfair',message: null,unfairEncounterIds: ['cue'] },judgedAt);
  assert.deepEqual(cueSchedule(),before);
  assert.equal(sql.prepare('SELECT count(*) n FROM learner_state_effects WHERE judgment_id IS NOT NULL').get()!.n,0);
});

for (const strong of [false,true]) test(`a covered pure-cue lapse restores ${strong ? 'strong progress and blocks maintenance' : 'fragile scheduling'}`, () => {
  sql.exec(`CREATE TABLE learner_owned_word_skill_relevance(learner_id TEXT,word_id TEXT,skill_id TEXT,relevance_state TEXT)`);
  sql.exec(fs.readFileSync(new URL('../server/db/migrations/0069_sense_content_reconciliation.sql',import.meta.url),'utf8').split('-- Preserve existing teaching-source jobs')[0]!);
  const state = { intervalHours: 1234,easeFactor: 2.65,enabled: 1,cleanCoveredSessions: 6,
    strongSince: strong ? '2026-09-01T00:00:00.000Z' : null,strongSuccesses: strong ? 4 : 0,maintenanceIdentity: 'old-cue-872' };
  sql.prepare(`INSERT INTO learner_pure_cue_schedules(learner_id,content_id,next_eligible_at,last_practised_at,policy_version,scheduler_state_json)
    VALUES ('alice','cue',?,'2026-10-01T00:00:00.000Z','test',?),('bob','cue',NULL,NULL,'test',?)`)
    .run(strong ? '2027-01-01T00:00:00.000Z' : '2026-10-01T00:00:00.000Z',JSON.stringify(state),JSON.stringify(state));
  const bobSchedule = () => sql.prepare("SELECT * FROM learner_pure_cue_schedules WHERE learner_id='bob'").get();
  const bobBefore = bobSchedule();
  const wordBefore = wordSchedule('b');
  const { completion } = ingest(coveredCueLapse());
  assert.equal(completion.report.pureCueOutcomes[0]?.covered,true);
  const lapsed = cueSchedule();
  assert.equal(scheduler(lapsed).intervalHours,6);
  assert.equal(scheduler(lapsed).strongSince,null);
  const delayed = '2026-11-01T00:00:00.000Z', breakUntil = '2026-11-02T00:00:00.000Z';
  const laterReset = '2026-11-03T00:00:00.000Z';
  if (!strong) sql.prepare("UPDATE learner_pure_cue_schedules SET scheduler_state_json=json_set(scheduler_state_json,'$.resetUntil',?) WHERE learner_id='alice'").run(laterReset);
  const feedback = claimVocabularyReflectionJob({ kind: 'learner_feedback',now: delayed })!;
  const input = { diagnosis: 'An accepted member can fit',message: null,unfairEncounterIds: ['cue-0'] };
  const result = recordVocabularyFeedbackJudgment(feedback.jobId,feedback.leaseToken,input,delayed);
  const restored = cueSchedule();
  const dueAt = strong ? breakUntil : laterReset;
  assert.deepEqual(scheduler(restored),{ ...state,resetUntil: dueAt,postCompensationEarliestCheckAt: dueAt });
  assert.equal(restored.next_eligible_at,dueAt);
  assert.equal(restored.last_practised_at,'2026-10-01T00:00:00.000Z');
  const selection = (now: string) => alice(() => selectVocabularyPureCueCandidates({ordinaryReviewCount:0,sessionSeed:'compensation',now,adopt:false}));
  assert.deepEqual(selection('2026-11-01T23:59:59.999Z'),[]);
  if (!strong) assert.deepEqual(selection(breakUntil),[]);
  assert.deepEqual(selection(dueAt).map(cue => cue.contentId),['cue']);
  assert.deepEqual(recordVocabularyFeedbackJudgment(feedback.jobId,feedback.leaseToken,input,breakUntil),result);
  assert.deepEqual(cueSchedule(),restored);
  const doneAt = new Date(Date.parse(dueAt)+16_000).toISOString();
  close([present('cue',null,'rechecked-cue'),response('rechecked-cue','accepted')],'fresh-cue',dueAt,doneAt);
  const rechecked = scheduler(cueSchedule());
  assert.equal(rechecked.postCompensationEarliestCheckAt,undefined);
  if (strong) assert.equal(rechecked.strongSuccesses,state.strongSuccesses+1);
  assert.deepEqual(selection(doneAt),[]);
  assert.deepEqual(wordSchedule('b'),wordBefore);
  assert.deepEqual(bobSchedule(),bobBefore);
});

for (const evidence of ['missing receipt','null pre-lapse schedule'] as const) {
  test(`pending judgments persist unavailable compensation with ${evidence}`, () => {
    const pure = evidence === 'null pre-lapse schedule';
    const { completion } = ingest(pure ? coveredCueLapse() : [present('one'),response('one'),wrap()]);
    if (!pure) {
      // Simulate a retained completion from before its schedule receipt was captured.
      sql.exec('DROP TRIGGER vocabulary_effect_retained');
      sql.prepare("DELETE FROM learner_state_effects WHERE completion_id=? AND kind='production_schedule_applied'").run(completion.completionId);
    }
    const read = pure ? cueSchedule : wordSchedule;
    const before = read();
    const feedback = claimVocabularyReflectionJob({ kind:'learner_feedback',now:judgedAt })!;
    const input = { diagnosis:'Unfair',message:'Your answer fit.',unfairEncounterIds:[pure ? 'cue-0' : 'one'] };
    const result = recordVocabularyFeedbackJudgment(feedback.jobId,feedback.leaseToken,input,judgedAt);
    assert.deepEqual(read(),before);
    const receipt = sql.prepare('SELECT * FROM learner_state_effects WHERE judgment_id=?').get(result.judgmentId)!;
    assert.deepEqual(JSON.parse(String(receipt.before_json)),{ ...before });
    const after = JSON.parse(String(receipt.after_json));
    assert.deepEqual(after.schedule,{ ...before });
    assert.equal(after.outcome,'unavailable');
    assert.equal(after.reason,pure ? 'missing_or_invalid_schedule_snapshot' : 'missing_lapse_receipt');
    assert.deepEqual(recordVocabularyFeedbackJudgment(feedback.jobId,feedback.leaseToken,input,judgedAt),result);
  });
}

for (const recall of ['correct','fair miss','unfair again'] as const) test(
  `production resumes normal scheduling after the compensation break (${recall})`, () => {
  sql.exec(`CREATE TABLE learner_owned_word_skill_relevance(learner_id TEXT,word_id TEXT,skill_id TEXT,relevance_state TEXT);
    UPDATE learner_word_schedules SET scheduler_state_json=json_set(scheduler_state_json,'$.intervalHours',720,'$.easeFactor',2.8),
    last_practised_at='2026-09-17T09:00:00.000Z',next_eligible_at='2026-10-17T09:00:00.000Z' WHERE word_id='a';`);
  const due = (now: string) => alice(() => selectVocabularyReviewSkills({now,canUseSkill:word => word === 'a'}));
  assert.deepEqual(due(at),[{wordId:'a',skillId:'production'}]);
  const prior = wordSchedule();
  const { completion } = ingest([present('two','a','undone'),response('undone'),{kind:'undo',payload:{undoesActionId:'session-1'}},
    present('one'),response('one'),present('two'),response('two'),wrap()]);
  assert.equal(completion.report.encounters[0]?.effectiveResponses.length,0);
  assert.equal(completion.report.encounters[0]?.responses.length,1);
  assert.equal(scheduler(wordSchedule()).intervalHours,6);
  sql.exec(`INSERT INTO learner_owned_word_skill_state
    (learner_id,word_id,skill_id,enabled,interval_hours,ease_factor,last_studied_at,next_due_at)
    VALUES ('alice','a','recognition',1,24,2.5,'2026-10-17T10:30:00.000Z','2026-10-18T10:30:00.000Z');`);
  const breakUntil = '2026-10-18T11:00:00.000Z';
  const feedback = claimVocabularyReflectionJob({kind:'learner_feedback',now:judgedAt})!;
  recordVocabularyFeedbackJudgment(feedback.jobId,feedback.leaseToken,{diagnosis:'Unfair',message:null,unfairEncounterIds:['one','two']},judgedAt);
  const restored = wordSchedule();
  assert.equal(restored.last_practised_at,prior.last_practised_at);
  assert.equal(restored.next_eligible_at,breakUntil);
  assert.deepEqual(scheduler(restored),{...scheduler(prior),resetUntil:breakUntil,postCompensationEarliestCheckAt:breakUntil});
  assert.deepEqual(due('2026-10-18T10:59:59.999Z'),[{wordId:'a',skillId:'recognition'}]);
  assert.deepEqual(due(breakUntil),[{wordId:'a',skillId:'production'}]);

  contents.fresh = createVocabularyContent(draft('fresh'),actor);
  const nextClosedAt = '2026-10-18T11:00:16.000Z';
  const next = close([present('fresh'),response('fresh',recall === 'correct' ? 'accepted' : 'rejected'),wrap()],
    'fresh-check',breakUntil,nextClosedAt);
  const nextSchedule = wordSchedule();
  assert.equal(nextSchedule.last_practised_at,breakUntil);
  assert.equal(scheduler(nextSchedule).postCompensationEarliestCheckAt,undefined);
  if (recall === 'correct') {
    const elapsedHours = (Date.parse(breakUntil) - Date.parse(String(prior.last_practised_at))) / 3_600_000;
    const grown = Math.ceil((720 + Math.max(0,elapsedHours - 720) / 2) * 2.8);
    assert.ok(Math.abs(scheduler(nextSchedule).intervalHours - grown) <= 1);
    assert.equal(scheduler(nextSchedule).easeFactor,2.8);
    return;
  }
  assert.equal(scheduler(nextSchedule).intervalHours,6);
  assert.equal(nextSchedule.next_eligible_at,'2026-10-18T17:00:16.000Z');
  ingestVocabularySessionEvidence('alice',next.completionId,next.report,nextClosedAt);
  const nextJudgedAt = '2026-10-18T12:00:00.000Z';
  const nextFeedback = claimVocabularyReflectionJob({kind:'learner_feedback',now:nextJudgedAt})!;
  recordVocabularyFeedbackJudgment(nextFeedback.jobId,nextFeedback.leaseToken,{diagnosis:recall,message:null,
    unfairEncounterIds:recall === 'unfair again' ? ['fresh'] : []},nextJudgedAt);
  if (recall === 'fair miss') {
    assert.deepEqual(wordSchedule(),nextSchedule);
  } else {
    assert.equal(scheduler(wordSchedule()).intervalHours,720);
    assert.equal(scheduler(wordSchedule()).easeFactor,2.8);
    assert.equal(wordSchedule().last_practised_at,prior.last_practised_at);
    assert.equal(wordSchedule().next_eligible_at,'2026-10-19T12:00:00.000Z');
  }
});

test('compensation preserves the later due date captured when overlapping sessions close out of order', () => {
  sql.exec(`INSERT INTO learner_words(learner_id,word_id,in_stash,added_at,mode,mode_changed_at)
    VALUES ('bob','a',0,'2026-01-01','practice','2026-01-01');
    INSERT INTO learner_word_schedules(learner_id,word_id,policy_version,scheduler_state_json)
    VALUES ('bob','a','test','{"intervalHours":48,"easeFactor":2.2}');
    UPDATE learner_word_schedules SET scheduler_state_json=json_set(scheduler_state_json,'$.intervalHours',96),
      last_practised_at='2026-10-13T09:00:00.000Z',next_eligible_at='2026-10-17T09:00:00.000Z'
      WHERE learner_id='alice' AND word_id='a';`);
  const otherLearner = wordSchedule('a','bob'), otherWord = wordSchedule('b');
  const earlierSequence = play([present('one'),response('one'),wrap()],'earlier');
  close([present('two'),response('two','accepted'),wrap()],'newer','2026-10-18T10:00:00.000Z','2026-10-18T10:00:16.000Z');
  const atLapse = wordSchedule();
  assert.ok(scheduler(atLapse).intervalHours > 96);
  const staged = alice(() => stageVocabularySessionCompletion('earlier',earlierSequence,'2026-10-19T10:00:00.000Z'));
  const finalized = '2026-10-19T10:00:16.000Z';
  const completion = alice(() => closeVocabularySessionCompletion('earlier',staged.completionId,finalized));
  ingestVocabularySessionEvidence('alice',completion.completionId,completion.report,finalized);
  assert.equal(scheduler(wordSchedule()).intervalHours,6);
  const subsequent = close([present('two','a','subsequent-two'),response('subsequent-two','accepted'),wrap()],'subsequent','2026-10-20T10:00:00.000Z','2026-10-20T10:00:16.000Z');
  assert.equal(subsequent.report.words.a?.successfulRecall,true);
  const before = wordSchedule();
  assert.notEqual(scheduler(before).intervalHours,scheduler(atLapse).intervalHours);
  const history = () => sql.prepare('SELECT * FROM session_actions ORDER BY session_id,sequence_number').all();
  const reports = () => sql.prepare('SELECT report_json FROM vocabulary_session_completions ORDER BY session_id').all();
  const attempts = history(), completedReports = reports();
  const delayed = '2026-10-22T11:00:00.000Z';
  const postCompensationEarliestCheckAt = '2026-10-23T11:00:00.000Z';
  // The newer session's clean recall advanced the due date before the earlier lapse closed.
  assert.ok(String(atLapse.next_eligible_at) > postCompensationEarliestCheckAt);
  const feedback = claimVocabularyReflectionJob({kind:'learner_feedback',now:delayed})!;
  const result = recordVocabularyFeedbackJudgment(feedback.jobId,feedback.leaseToken,{diagnosis:'Unfair',message:null,unfairEncounterIds:['one']},delayed);
  const restored = wordSchedule();
  assert.equal(scheduler(restored).intervalHours,scheduler(atLapse).intervalHours);
  assert.equal(scheduler(restored).easeFactor,scheduler(atLapse).easeFactor);
  assert.equal(restored.last_practised_at,atLapse.last_practised_at);
  assert.equal(restored.next_eligible_at,atLapse.next_eligible_at);
  assert.equal(scheduler(restored).postCompensationEarliestCheckAt,postCompensationEarliestCheckAt);
  assert.deepEqual(history(),attempts);
  assert.deepEqual(reports(),completedReports);
  assert.deepEqual(wordSchedule('a','bob'),otherLearner);
  assert.deepEqual(wordSchedule('b'),otherWord);
  const receipt = sql.prepare('SELECT before_json,after_json FROM learner_state_effects WHERE judgment_id=?').get(result.judgmentId)!;
  assert.deepEqual(JSON.parse(String(receipt.before_json)),{...before});
  assert.deepEqual(JSON.parse(String(receipt.after_json)).schedule,{...restored});
});

test('completed historical feedback replay leaves the current schedule alone', () => {
  const { completion } = ingest([present('one'),response('one'),wrap()]);
  const feedback = claimVocabularyReflectionJob({kind:'learner_feedback',now:judgedAt})!;
  const input = {diagnosis:'Unfair',message:'Your answer fit.',unfairEncounterIds:['one']};
  const result = recordVocabularyFeedbackJudgment(feedback.jobId,feedback.leaseToken,input,judgedAt);
  // Represent a completed v1 judgment with its old delayed-lapse schedule.
  sql.exec('DROP TRIGGER vocabulary_effect_immutable');
  sql.prepare("UPDATE learner_state_effects SET effect_key=replace(effect_key,'feedback.v2','feedback.v1') WHERE judgment_id=?").run(result.judgmentId);
  sql.exec(`UPDATE learner_word_schedules SET next_eligible_at='2026-10-18T16:00:16.000Z',last_practised_at='2026-10-17T10:00:00.000Z',
    scheduler_state_json='{"intervalHours":6,"easeFactor":2.35,"enabled":1,"cleanCoveredSessions":0}' WHERE word_id='a';`);
  const before = wordSchedule();
  ingestVocabularySessionEvidence('alice',completion.completionId,completion.report,judgedAt);
  assert.equal(claimVocabularyReflectionJob({kind:'learner_feedback',now:judgedAt}),null);
  assert.deepEqual(recordVocabularyFeedbackJudgment(feedback.jobId,feedback.leaseToken,input,judgedAt),result);
  assert.deepEqual(wordSchedule(),before);
  assert.equal(sql.prepare("SELECT count(*) n FROM learner_state_effects WHERE judgment_id IS NOT NULL").get()!.n,1);
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

for(const drift of ['source','mapping','catalog','word coverage'] as const)test(`sense-admitted content distinguishes canonical evidence from serving policy (${drift})`,()=>{
  const sense=createVocabularySense({wordId:'a',description:'A written character'},actor);
  mapVocabularyContentSense({contentId:'one',wordId:'a',expectedContentVersion:1,expectedMapping:{senseId:null,establishedAt:null},senseId:sense.senseId,establishedAt:at},actor);
  ingest([present('one'),response('one')]);
  const work=claimVocabularyReflectionJob({kind:'exercise_improvement',now:judgedAt})!;
  const admission={outcome:'single_sense' as const,rationale:'Identifiable use',wordId:'a',sourceContentId:'one',sourceContentVersion:1,
    catalogVersion:getVocabularySenseCatalog('a').version,senseIds:[sense.senseId],sourceMapping:{senseId:sense.senseId,establishedAt:at}};
  const repair=op('replace','one','fresh');repair.content.words=[{wordId:'a',relation:'target',senseId:sense.senseId,senseMappingEstablishedAt:judgedAt}];
  const result=recordVocabularyImprovementResult(work.jobId,work.leaseToken,{diagnosis:'Repair',proposal:{operations:[repair],rationale:'Useful repair'},admission},judgedAt);
  assert.equal(listVocabularyProposalReviewBatch('editor',{startProposalId:result.proposalId!}).items[0]!.coverageChanged,false);
  const review=approveVocabularyProposal(result.proposalId!,1,'editor');
  if(drift==='source')updateVocabularyContent('one',1,{...getVocabularyContentForMaintenance('one')!,body:{prompt:'An independently revised cue'}},actor);
  else if(drift==='mapping')mapVocabularyContentSense({contentId:'one',wordId:'a',expectedContentVersion:1,expectedMapping:admission.sourceMapping,senseId:null,establishedAt:judgedAt},actor);
  else if(drift==='catalog')updateVocabularySense(sense.senseId,sense.version,{description:sense.description,status:'retired'},actor);
  else if(drift==='word coverage')writeVocabularyWordSenseCoverage('a',0,[sense.senseId],actor);
  const changesBefore=sql.prepare('SELECT total_changes() n').get()!.n;
  assert.equal(listVocabularyProposalReviewBatch('editor',{startProposalId:result.proposalId!}).items[0]!.coverageChanged,drift==='source'||drift==='mapping'||drift==='catalog');
  assert.equal(sql.prepare('SELECT total_changes() n').get()!.n,changesBefore);
  if(drift==='source'||drift==='mapping'||drift==='catalog') {
    assert.throws(()=>applyVocabularyProposal(result.proposalId!,1,review,`stale-${drift}`,'editor'),/content base changed|sense evidence changed/);
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
  ingest([present('one'),response('one'),wrap()]);
  const lapsed = wordSchedule();
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
  assert.deepEqual(wordSchedule(),lapsed);
});

test('real provider content edits remain applicable while serving selection changes independently',async()=>{
  sql.exec("UPDATE lexical_words SET meaning='written character'; ");
  const sense=createVocabularySense({senseId:'selected-sense',wordId:'a',description:{label:'written character'}},actor);
  establishVocabularySenseCatalog('a',getVocabularySenseCatalog('a').version,actor);
  writeVocabularyWordSenseCoverage('a',0,[sense.senseId],actor);
  ingest([present('one'),response('one')]);
  const work=claimVocabularyReflectionJob({kind:'exercise_improvement',now:judgedAt})!;
  let calls=0;
  const adapter:ProviderAdapter={id:'fake',defaultBaseUrl:'https://unused.invalid',apiKeyEnvironmentVariable:'KEY',structuredOutputMode:'json_schema',async run(request){
    calls++;assert.equal(Object.hasOwn(JSON.parse(request.userPrompt),'coverage'),false);
    const value=calls===1?{outcome:'single_sense',rationale:'The authored task names a written character.',senseIds:[JSON.parse(request.userPrompt).senses[0].senseId]}:
      {summary:'Improve this exact exercise.',source:{decision:'revise',prompt:'A written character.'},additionalExercises:[],sharedExercise:null};
    if(calls===2)writeVocabularyWordSenseCoverage('a',1,[],actor);
    return {provider:'fake',model:'fake',responseId:null,structuredOutputMode:'json_schema',rawText:JSON.stringify(value),finishReason:'stop',rawResponse:null,
      usage:{inputTokens:null,cachedInputTokens:null,cacheWriteInputTokens:null,outputTokens:null,reasoningTokens:null,totalTokens:null},invocationId:null};
  }};
  const provider=createVocabularyReflectionProvider({random:()=>0,environment:{OPENAI_API_KEY:'fake'},adapter,
    ensureSenses:async()=>({catalog:getVocabularySenseCatalog('a'),senses:getVocabularySenses('a'),source:'existing'})});
  const sourceBeforeAssessment=getVocabularyContentForMaintenance('one');
  const assessed=await provider.run(work);if(assessed.kind!=='exercise_improvement')assert.fail('Expected improvement');
  assert.deepEqual(getVocabularyContentForMaintenance('one'),sourceBeforeAssessment);
  assert.equal(calls,2);assert.deepEqual(assessed.result.admission?.generationScope,{selectionEstablished:true,senseIds:[sense.senseId],source:{kind:'mapped_source'}});
  const recorded=recordVocabularyImprovementResult(work.jobId,work.leaseToken,assessed.result,judgedAt);
  writeVocabularyWordSenseCoverage('a',2,[sense.senseId],actor);
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

test('applying a source revision resolves only matching idle attention cases and retains their jobs', () => {
  const {cases}=ingest([present('one'),response('one'),present('two'),response('two')]);
  const improvements=cases.filter(item=>item.kind==='exercise_improvement');
  assert.equal(improvements.length,2);
  for(let i=0;i<2;i++){
    const job=claimVocabularyReflectionJob({kind:'exercise_improvement',now:judgedAt})!;
    failVocabularyReflectionJob(job.jobId,job.leaseToken,'provider_failed',judgedAt,judgedAt);
  }
  const target=improvements.find(item=>item.contentId==='one')!,other=improvements.find(item=>item.contentId==='two')!;
  assert.equal(getVocabularyCaseReview(target.caseId)!.state,'open');
  const proposal=createVocabularyProposal({operations:[op('update_existing','one','one')],rationale:'Repair source'},'editor');
  const review=approveVocabularyProposal(proposal.proposalId,1,'editor');
  applyVocabularyProposal(proposal.proposalId,1,review,'supersede-attention','editor');
  assert.equal(getVocabularyCaseReview(target.caseId)!.state,'resolved');
  assert.equal(getVocabularyCaseReview(other.caseId)!.state,'open');
  assert.equal(sql.prepare("SELECT count(*) n FROM vocabulary_reflection_jobs WHERE case_id=? AND status='failed'").get(target.caseId)!.n,1);
  assert.equal(sql.prepare("SELECT count(*) n FROM backend_events WHERE entity_id=? AND name='vocabulary.reflection.case_source_superseded'").get(target.caseId)!.n,1);
});

test('applying a source revision leaves an active matching assessment to finish under its lease', () => {
  const {cases}=ingest([present('one'),response('one')]);
  const item=cases.find(value=>value.kind==='exercise_improvement')!;
  const job=claimVocabularyReflectionJob({kind:'exercise_improvement',now:judgedAt})!;
  const proposal=createVocabularyProposal({operations:[op('update_existing','one','one')],rationale:'Repair source'},'editor');
  const review=approveVocabularyProposal(proposal.proposalId,1,'editor');
  applyVocabularyProposal(proposal.proposalId,1,review,'active-attention','editor');
  assert.equal(getVocabularyCaseReview(item.caseId)!.state,'open');
  assert.equal(sql.prepare('SELECT status FROM vocabulary_reflection_jobs WHERE job_id=?').get(job.jobId)!.status,'running');
});

test('content drift rejects applications; teaching cases use manual proposals only; scope cannot broaden', () => {
  const { cases } = ingest([present('intro','new'),present('teach','new'),{ kind: 'feedback',payload: { encounterId: 'teach',feedback: 'negative' } }]);
  assert.equal(claimVocabularyReflectionJob({ now: judgedAt }),null);
  const teaching = cases[0]!;
  const proposal = createVocabularyProposal({ caseId: teaching.caseId,operations: [{ ...op('update_existing','teach','teach'),content: draft('teach','new','teaching') }],rationale: 'Manual teaching repair' },'editor');
  const review = approveVocabularyProposal(proposal.proposalId,1,'editor');
  updateVocabularyContent('teach',1,{ ...draft('teach','new','teaching'),body: 'Intervening repair' },actor);
  assert.throws(() => applyVocabularyProposal(proposal.proposalId,1,review,'stale-source','editor'),/base changed/);
  assert.throws(()=>closeVocabularyCase(teaching.caseId,'editor',null as unknown as string),/Expected text reason/);
  assert.equal(getVocabularyReflectionCase(teaching.caseId).status,'open');
  closeVocabularyTeachingCase(teaching.caseId,'editor','');
  const closure=sql.prepare("SELECT data_json FROM backend_events WHERE entity_id=? AND name='vocabulary.reflection.teaching_case_closed'").get(teaching.caseId)!;
  assert.equal(JSON.parse(closure.data_json as string).reason,'');
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
  const feedback = claimVocabularyReflectionJob({ kind: 'learner_feedback',now: judgedAt })!;
  assert.deepEqual(feedback.evidence.evidence.map(encounter=>encounter.encounterId),['one']);
  recordVocabularyFeedbackJudgment(feedback.jobId,feedback.leaseToken,{ diagnosis: 'The cue was unfair; pronunciation needs work',
    message: 'Separate learning signals',unfairEncounterIds: ['one'] },judgedAt);
  assert.equal(sql.prepare("SELECT next_eligible_at FROM learner_word_schedules WHERE word_id='a'").get()!.next_eligible_at,
    '2026-10-20T10:00:00.000Z');
  assert.deepEqual(sql.prepare("SELECT * FROM learner_owned_word_skill_state WHERE skill_id='recognition'").get(),recognitionBefore);
});

test('a delayed unfair judgment preserves an explicitly requested active refresh', () => {
  sql.exec("UPDATE learner_word_schedules SET next_eligible_at=NULL WHERE word_id='a'");
  ingest([present('one'),response('one'),{ kind: 'mode_change',payload: { wordId: 'a',mode: 'maintain' } },wrap()]);
  alice(() => requestVocabularyRefresh('a',judgedAt));
  const laterSequence = play([present('two','a','retained-lapse'),response('retained-lapse'),wrap()],'retained',judgedAt);
  const before = sql.prepare("SELECT * FROM learner_word_schedules WHERE learner_id='alice' AND word_id='a'").get();
  assert.equal(before!.next_eligible_at,judgedAt);
  const feedback = claimVocabularyReflectionJob({ kind: 'learner_feedback',now: judgedAt })!;
  const input = { diagnosis: 'Unfair cue',message: 'Your answer made sense',unfairEncounterIds: ['one'] };
  const result = recordVocabularyFeedbackJudgment(feedback.jobId,feedback.leaseToken,input,judgedAt);
  assert.deepEqual(recordVocabularyFeedbackJudgment(feedback.jobId,feedback.leaseToken,input,judgedAt),result);
  const restored = wordSchedule();
  assert.equal(restored.refresh_requested_at,before!.refresh_requested_at);
  assert.equal(restored.refresh_until,before!.refresh_until);
  assert.equal(restored.next_eligible_at,'2026-10-18T11:00:00.000Z');
  assert.equal(scheduler(restored).intervalHours,24);
  assert.equal(scheduler(restored).easeFactor,2.5);
  assert.equal(sql.prepare("SELECT mode FROM learner_words WHERE word_id='a'").get()!.mode,'maintain');
  const afterRefresh = alice(() => requestVocabularyRefresh('a','2026-10-17T12:00:00.000Z'));
  assert.equal(afterRefresh.nextEligibleAt,'2026-10-18T11:00:00.000Z');
  const subsequent = alice(() => stageVocabularySessionCompletion('retained',laterSequence,'2026-10-17T12:00:00.000Z'));
  alice(() => closeVocabularySessionCompletion('retained',subsequent.completionId,'2026-10-17T12:00:16.000Z'));
  assert.equal(wordSchedule().next_eligible_at,'2026-10-18T11:00:00.000Z');
  assert.equal(wordSchedule().refresh_requested_at,'2026-10-17T12:00:00.000Z');
  assert.deepEqual(scheduler(wordSchedule()),afterRefresh.schedulerState);
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
  assert.throws(()=>closeVocabularyCase(work.caseId,'editor',null as unknown as string),/Expected text reason/);
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
  assert.throws(()=>requestVocabularyCaseSecondOpinion(caseId,'editor','Again'),/already (?:in progress|queued or running)/);
  assert.equal(listVocabularyReflectionCases('exercise_improvement','editor').length,0);
  const now=new Date(Date.now()+1000).toISOString();
  const review=claimVocabularyReflectionJob({kind:'exercise_improvement',now})!;
  assert.equal(review.caseId,caseId);
  assert.equal(review.caseSequence,2);
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

for(const kind of ['no-change','teaching'] as const)test(`${kind} case resolution persists authoritative closure time independently of later audit events`,()=>{
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
  assert.equal(getVocabularyCaseWorkspace(evidence.caseId,'editor').case.resolvedAt,resolvedAt);
  if(kind==='no-change')assert.equal(listVocabularyNoProposalCases('editor','closed')[0]!.resolvedAt,resolvedAt);
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

  const {cases}=ingest([present('cue',null),response('cue')]);
  const caseId=cases.find(item=>item.kind==='exercise_improvement')!.caseId;
  const initial=claimVocabularyReflectionJob({kind:'exercise_improvement',now:judgedAt})!;
  recordVocabularyImprovementResult(initial.jobId,initial.leaseToken,{diagnosis:'Original judgment',proposal:null},judgedAt);
  const proposal=createVocabularyProposal({caseId,operations:[op()],rationale:'Review'},'editor');
  const batch=()=>listVocabularyProposalReviewBatch('editor',{startProposalId:proposal.proposalId}).items[0].reassessment;
  const before=sql.prepare('SELECT total_changes() AS count').get()!.count;
  assert.deepEqual(batch(),{eligible:true,unavailableReason:null,source:{contentId:initial.evidence.evidence[0]!.snapshot.contentId,assessedVersion:1,currentVersion:1},latest:null});
  assert.equal(sql.prepare('SELECT total_changes() AS count').get()!.count,before);
  const request=requestVocabularyReassessment(caseId,'editor','openai:gpt-6-sol-high',1);
  assert.equal(batch()?.latest?.jobId,request.jobId);
  assert.equal(batch()?.latest?.status,'queued');
  assert.equal(request.caseId,caseId);
  assert.equal(getVocabularyCaseWorkspace(caseId,'editor').reassessment?.jobId,request.jobId);
  assert.throws(()=>requestVocabularyReassessment(caseId,'editor','openai:gpt-6-sol-high',1),/already (?:in progress|queued or running)/);
  const now=new Date(Date.now()+1000).toISOString();
  const child=claimVocabularyReflectionJob({kind:'exercise_improvement',now})!;
  assert.equal(child.jobId,request.jobId);
  assert.equal(child.reassessmentSourceJobId,initial.jobId);
  assert.equal(sql.prepare('SELECT model_choice FROM vocabulary_reflection_jobs WHERE job_id=?').get(child.jobId)!.model_choice,'openai:gpt-6-sol-high');
  failVocabularyReflectionJob(child.jobId,child.leaseToken,'failed',now,now);
  assert.equal(batch()?.latest?.status,'failed');
  const another=requestVocabularyReassessment(caseId,'editor','openai:gpt-6-luna-high',1);
  assert.throws(()=>retryVocabularyReflectionJob(child.jobId,'editor',now),/already (?:in progress|queued or running)/);
  sql.prepare("UPDATE vocabulary_reflection_jobs SET created_at='2000-01-01T00:00:00.000Z' WHERE job_id=?").run(another.jobId);
  assert.equal(getVocabularyCaseWorkspace(caseId,'editor').reassessment?.jobId,another.jobId);
  sql.prepare("UPDATE vocabulary_reflection_jobs SET status='succeeded',created_at='9999-01-01T00:00:00.000Z' WHERE job_id=?").run(another.jobId);
  assert.equal(batch()?.latest?.status,'succeeded');
});

test('reassessment pins the confirmed current version, retains history, and fences publication and application',()=>{

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
  assert.deepEqual(nextJob.evidence.evidence,initial.evidence.evidence);
  updateVocabularyContent('one',3,{...draft('one'),body:{prompt:'Raced source'}},actor);
  assert.throws(()=>recordVocabularyImprovementResult(nextJob.jobId,nextJob.leaseToken,{diagnosis:'No change',proposal:null},now),/source version changed before publication/);
});

test('advisory review of reassessment keeps the pinned source and retains historical encounters',()=>{


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
  assert.equal(input.encounters.length,1);
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


for(const route of ['reassessment','proposal opinion','case opinion'] as const)for(const selection of ['set','none','inherit'] as const)test(`historical case scope remains unchanged and does not override word defaults via ${route} (${selection})`,()=>{
  const sense=createVocabularySense({wordId:'a',description:'written character'},actor);
  ingest([present('one'),response('one')]);
  const work=claimVocabularyReflectionJob({kind:'exercise_improvement',now:judgedAt})!;
  writeVocabularyDefaultUsefulSenses('a',0,[sense.senseId],actor);
  sql.prepare('INSERT INTO vocabulary_case_sense_coverage(case_id,version,included_sense_ids_json,updated_at) VALUES (?,1,?,?)')
    .run(work.caseId,selection==='inherit'?null:JSON.stringify(selection==='none'?[]:[sense.senseId]),at);
  const historical=sql.prepare('SELECT * FROM vocabulary_case_sense_coverage').all();
  const result=recordVocabularyImprovementResult(work.jobId,work.leaseToken,{diagnosis:'Review',proposal:route==='proposal opinion'?{operations:[op()],rationale:'Repair'}:null},judgedAt);
  if(route==='reassessment')requestVocabularyReassessment(work.caseId,'editor','openai:gpt-6-sol-high',1);
  else if(route==='proposal opinion')requestVocabularySecondOpinion(result.proposalId!,1,'editor');
  else requestVocabularyCaseSecondOpinion(work.caseId,'editor','Try another view');
  assert.deepEqual(sql.prepare('SELECT * FROM vocabulary_case_sense_coverage').all(),historical);
  assert.deepEqual(resolveVocabularySenseCoverage('a').includedSenseIds,[sense.senseId]);
  assert.equal(resolveVocabularySenseCoverage('a').review,null);
});


test('reviewed retirement dry-runs without effects, preserves relationships and replays its exact receipt',()=>{
  sql.prepare("INSERT INTO learner_content_deactivations VALUES ('alice','one',?)").run(at);
  const before=sql.prepare('SELECT count(*) n FROM content_revision_history').get()!.n;
  const proposed=createVocabularyProposal({operations:[op('retire')],rationale:'No faithful repair'},'editor');
  const preview=previewVocabularyProposal(proposed.proposalId,1,'editor');
  assert.equal(preview.previews[0]!.result.availability,'retired');assert.equal(preview.previews[0]!.result.contentId,'one');
  assert.equal(preview.operations[0]!.deactivationsRemainOnSource,1);assert.equal(preview.operations[0]!.transfersRelationships,false);
  assert.equal(getVocabularyContentForMaintenance('one')!.availability,'active');assert.equal(sql.prepare('SELECT count(*) n FROM content_revision_history').get()!.n,before);
  const input={requestId:'retirement-request',proposalId:proposed.proposalId,expectedVersion:1,actorId:'editor',notes:'Reviewed retirement'};
  const receipt=completeVocabularyApprovalRequest(input);assert.deepEqual(completeVocabularyApprovalRequest(input),receipt);
  assert.equal(receipt.changes[0]!.strategy,'retire');assert.equal(receipt.changes[0]!.resultContentId,'one');assert.equal(receipt.changes[0]!.resultVersion,2);
  assert.equal(getVocabularyContentForMaintenance('one')!.availability,'retired');assert.equal(sql.prepare('SELECT content_id FROM learner_content_deactivations').get()!.content_id,'one');
  assert.equal(sql.prepare('SELECT count(*) n FROM content_revision_history').get()!.n,Number(before)+1);
  assert.equal(sql.prepare("SELECT write_strategy FROM content_revision_history WHERE content_id='one' AND version=2").get()!.write_strategy,'update_existing');
  assert.ok(sql.prepare('SELECT source_history_change_id FROM application_content_changes').get()!.source_history_change_id);
  assert.deepEqual(sql.prepare('PRAGMA foreign_key_check').all(),[]);
});

test('retirement enforces general production and ownership; late failure rolls back retirement and review atomically',()=>{
  const create=(operations:VocabularyProposalOperation[])=>createVocabularyProposal({operations,rationale:'Review removal'},'editor');
  assert.throws(()=>create([{...op('retire','teach'),content:draft('teach','new','teaching')}]),/general production/);
  const recognition=draft('recognize');if(recognition.kind!=='exercise')assert.fail('Exercise fixture required');
  createVocabularyContent({...recognition,skill:'recognition'},actor);
  assert.throws(()=>create([{...op('retire','recognize'),content:{...recognition,skill:'recognition'}}]),/general production/);
  const privateSource=createVocabularyContent({...draft('private-drop'),accessScope:'private',ownerLearnerId:'alice'},actor);
  assert.throws(()=>create([{...op('retire','private-drop'),content:draft('private-drop')}]),/ownership/);
  const privateProposal=create([{...op('retire','private-drop'),scope:{kind:'learner',learnerId:'alice'},content:{...privateSource}}]);
  assert.equal(previewVocabularyProposal(privateProposal.proposalId,1,'editor').previews[0]!.result.accessScope,'private');
  const failed=create([op('retire'),{...op('create','one','collision'),operationKey:'new'}]);
  const approved=approveVocabularyProposal(failed.proposalId,1,'editor');createVocabularyContent(draft('collision'),actor);
  assert.throws(()=>applyVocabularyProposal(failed.proposalId,1,approved,'failed-retire','editor'),/UNIQUE/);
  assert.equal(getVocabularyContentForMaintenance('one')!.availability,'active');assert.equal(getVocabularyContentForMaintenance('one')!.version,1);
  assert.equal(sql.prepare('SELECT count(*) n FROM proposal_applications WHERE proposal_id=?').get(failed.proposalId)!.n,0);
});


test('unknown useful selection remains an actionable attention case and can reassess after correction',()=>{

  const sense=createVocabularySense({wordId:'a',description:{label:'character',notes:[]}},actor);
  ingest([present('one'),response('one')]);const work=claimVocabularyReflectionJob({kind:'exercise_improvement',now:judgedAt})!;
  recordVocabularyImprovementResult(work.jobId,work.leaseToken,{diagnosis:'Choose useful senses',proposal:null,admission:{outcome:'needs_coverage',rationale:'Selection is unknown',wordId:'a',sourceContentId:'one',sourceContentVersion:1,catalogVersion:getVocabularySenseCatalog('a').version,senseIds:[],sourceMapping:{senseId:null,establishedAt:null}}},judgedAt);
  assert.equal(getVocabularyReflectionCase(work.caseId).status,'open');
  writeVocabularyDefaultUsefulSenses('a',0,[sense.senseId],actor);
  const next=requestVocabularyReassessment(work.caseId,'editor','openai:gpt-6-sol-high',1);
  assert.equal(next.caseId,work.caseId);assert.deepEqual(resolveVocabularySenseCoverage('a').includedSenseIds,[sense.senseId]);
  assert.deepEqual(getVocabularyReflectionCase(work.caseId).evidence,work.evidence.evidence);
});




test('excluded source operations retain explicit assessment evidence as an approval dependency',()=>{
  const replacement={...op('replace','one','new-one'),operationKey:'omitted'};
  assert.notEqual(replacement.strategy,'create');if(replacement.strategy==='create')throw new Error('Expected source operation fixture');
  const independent={...op('create','one','additional'),operationKey:'included'};
  const proposal=createVocabularyProposal({operations:[independent],bases:[{contentId:replacement.sourceContentId,expectedVersion:1}],rationale:'Source remains assessment evidence'},'editor');
  const approved=approveVocabularyProposal(proposal.proposalId,1,'editor');
  updateVocabularyContent('one',1,draft('one'),actor);
  assert.throws(()=>applyVocabularyProposal(proposal.proposalId,1,approved,'evidence-drift','editor'),/content base changed/);
  assert.equal(getVocabularyContentForMaintenance('additional'),null);
});

test('retirement can remove a historically malformed cloze without authoring a repair',()=>{
  const body={prompt:'A malformed historical cloze',stimulus:{kind:'phrase_cloze',frame:'A letter',text:'没有空格'}};
  sql.prepare('UPDATE content_items SET body_json=? WHERE content_id=?').run(JSON.stringify(body),'one');
  const proposed=createVocabularyProposal({operations:[op('retire')],rationale:'Retire the malformed exercise'},'editor');
  assert.deepEqual(previewVocabularyProposal(proposed.proposalId,1,'editor').previews[0]!.result.body,body);
  const approved=approveVocabularyProposal(proposed.proposalId,1,'editor');applyVocabularyProposal(proposed.proposalId,1,approved,'malformed-retire','editor');
  assert.equal(getVocabularyContentForMaintenance('one')!.availability,'retired');assert.deepEqual(getVocabularyContentForMaintenance('one')!.body,body);
});

test('operator-authored create-only proposals report actual assessment evidence drift before approval',()=>{
 const proposed=createVocabularyProposal({operations:[op('create','one','additional')],bases:[{contentId:'one',expectedVersion:1}],rationale:'Source assessment evidence'},'editor');
 assert.equal(listVocabularyProposalReviewBatch('editor',{startProposalId:proposed.proposalId}).items[0]!.coverageChanged,false);
 updateVocabularyContent('one',1,draft('one'),actor);
 const snapshot=listVocabularyProposalReviewBatch('editor',{startProposalId:proposed.proposalId}).items[0]!;
 assert.equal(snapshot.coverageChanged,true);
 assert.equal(snapshot.previews[0]!.source,null);
 assert.deepEqual(snapshot.currentSources.map(source=>[source.contentId,source.version]),[['one',2]]);
 assert.throws(()=>approveVocabularyProposal(proposed.proposalId,1,'editor'),/content base changed/);
});

 test('improvement groups repeated attempts at an exercise and retains successful encounters',()=>{
  const {cases}=ingest([present('one','a','first'),response('first'),present('one','a','second'),response('second'),present('one','a','third'),response('third','accepted'),present('two','a','other'),response('other')]);
  const improvements=cases.filter(item=>item.kind==='exercise_improvement');
  assert.equal(improvements.length,2);
  assert.deepEqual(improvements.find(item=>item.contentId==='one')!.evidence.map(item=>item.encounterId),['first','second','third']);
 });

function unresolvedPromotion(){
  sql.exec("UPDATE lexical_words SET hanzi=CASE id WHEN 'a' THEN '他' ELSE '别' END;");
  createVocabularySense({senseId:'other',wordId:'a',description:'other people'},actor);
  establishVocabularySenseCatalog('a',getVocabularySenseCatalog('a').version,actor);
  ingest([present('one'),response('one')]);
  const work=claimVocabularyReflectionJob({kind:'exercise_improvement',now:judgedAt})!;
  recordVocabularyImprovementResult(work.jobId,work.leaseToken,{diagnosis:'Local repair is independent.',proposal:{operations:[op()],rationale:'Local repair'},
    admission:{outcome:'single_sense',rationale:'Other people',wordId:'a',sourceContentId:'one',sourceContentVersion:1,catalogVersion:getVocabularySenseCatalog('a').version,senseIds:['other'],sourceMapping:{senseId:null,establishedAt:null}},
    pureCueReferral:{candidateWords:['他','别'],sharedPurpose:'Other people',rationale:'Consider register'},
    pureCuePromotion:{outcome:'needs_operator',rationale:'Ambiguous pronunciation',candidateWordIds:['a'],existingContentId:null}},judgedAt);
  return work;
}
test('operator identity selection persists immutable choices and queues independent assessment without publishing',()=>{
  const work=unresolvedPromotion();
  assert.equal(getVocabularyCaseWorkspace(work.caseId,'editor').pureCueIdentityOptions![1]!.choices.length,2);
  assert.throws(()=>requestVocabularyPureCueResolution(work.caseId,'editor','openai:gpt-6-sol-high',1,{'他':'a','别':'a'}),/exact dictionary/);
  const selected=requestVocabularyPureCueResolution(work.caseId,'editor','openai:gpt-6-sol-high',1,{'他':'a','别':'b'});
  const row=sql.prepare("SELECT result_json FROM vocabulary_improvement_stages WHERE job_id=? AND input_hash='operator-pure-cue-resolution-v1'").get(selected.jobId)!;
  const saved=JSON.parse(String(row.result_json));
  assert.deepEqual(saved.selections,{'他':'a','别':'b'});assert.equal(saved.actorId,'editor');assert.equal(saved.sourceJobId,work.jobId);
  assert.equal(getVocabularyCaseWorkspace(selected.caseId,'editor').proposals.length,1);
  assert.equal(getVocabularyContentForMaintenance('one')!.version,1);
  assert.throws(()=>requestVocabularyPureCueResolution(work.caseId,'editor','openai:gpt-6-sol-high',1,{'他':'a','别':'b'}),/already (?:in progress|queued or running)/);
  assert.throws(()=>sql.prepare('DELETE FROM vocabulary_improvement_stages WHERE job_id=?').run(selected.jobId),/retained/);
});
test('identity selection rejects changed source and missing lexical matches before queueing',()=>{
  const work=unresolvedPromotion();
  sql.prepare("UPDATE lexical_words SET hanzi='different' WHERE id IN ('b','new')").run();
  assert.throws(()=>requestVocabularyPureCueResolution(work.caseId,'editor','openai:gpt-6-sol-high',1,{'他':'a','别':'b'}),/exact dictionary/);
  updateVocabularyContent('one',1,{...draft('one'),body:{prompt:'New authored source'}},actor);
  assert.throws(()=>requestVocabularyPureCueResolution(work.caseId,'editor','openai:gpt-6-sol-high',2,{'他':'a','别':'b'}),/source or sense inventory changed/);
});

test('successful open needs-operator assessment can use ordinary reassessment with original evidence',()=>{
  const work=unresolvedPromotion();
  assert.equal(getVocabularyReflectionCase(work.caseId).status,'open');
  const next=requestVocabularyReassessment(work.caseId,'editor','openai:gpt-6-sol-high',1);
  const child=claimVocabularyReflectionJob({kind:'exercise_improvement',now:new Date(Date.now()+1000).toISOString()})!;
  assert.equal(child.jobId,next.jobId);assert.deepEqual(child.evidence.evidence,work.evidence.evidence);
});
test('identity selection refuses a changed mapping even when the authored source version is unchanged',()=>{
  const work=unresolvedPromotion();
  mapVocabularyContentSense({contentId:'one',wordId:'a',expectedContentVersion:1,expectedCatalogVersion:getVocabularySenseCatalog('a').version,
    expectedMapping:{senseId:null,establishedAt:null},senseId:'other',establishedAt:judgedAt},actor);
  assert.throws(()=>requestVocabularyPureCueResolution(work.caseId,'editor','openai:gpt-6-sol-high',1,{'他':'a','别':'b'}),/source mapping changed/);
});

test('review metadata attributes finalized stage models, excludes abandoned attempts, and identifies reassessment',()=>{

  ingest([present('one'),response('one')]);
  const work=claimVocabularyReflectionJob({kind:'exercise_improvement',now:judgedAt})!;
  for(const [id,stage,provider,model] of [['mapping','sense_mapping','openai','mapping-model'],['local','single_improvement','zai','local-model'],['promotion','pure_cue_promotion','openai','promotion-model'],['abandoned','single_improvement','openai','unused-model']])
    sql.prepare('INSERT INTO model_invocations(id,step_name,provider,model) VALUES (?,?,?,?)').run(id!,stage!,provider!,model!);
  const admission={outcome:'single_sense' as const,rationale:'One intended use',wordId:'a',sourceContentId:'one',sourceContentVersion:1,catalogVersion:getVocabularySenseCatalog('a').version,senseIds:[],sourceMapping:{senseId:null,establishedAt:null},invocationId:'mapping'};
  const result=recordVocabularyImprovementResult(work.jobId,work.leaseToken,{diagnosis:'Repair',invocationId:'local',admission,pureCuePromotion:{outcome:'reject',rationale:'No shared task',candidateWordIds:['a'],existingContentId:null,invocationId:'promotion'},proposal:{operations:[op()],rationale:'Repair'}},judgedAt);
  const metadata=listVocabularyProposalReviewBatch('editor',{startProposalId:result.proposalId!}).items[0]!.assessment!;
  assert.equal(metadata.origin,'automatic');assert.deepEqual(metadata.models.map(model=>model.model),['mapping-model','local-model','promotion-model']);assert.equal(metadata.admission?.rationale,'One intended use');
  assert.deepEqual(getVocabularyCaseWorkspace(work.caseId,'editor').assessment,metadata);
  const next=requestVocabularyReassessment(work.caseId,'editor','openai:gpt-6-sol-high',1);
  const child=claimVocabularyReflectionJob({kind:'exercise_improvement',now:new Date(Date.now()+1000).toISOString()})!;
  recordVocabularyImprovementResult(child.jobId,child.leaseToken,{diagnosis:'No change',proposal:null},new Date(Date.now()+1100).toISOString());
  assert.equal(getVocabularyCaseWorkspace(next.caseId,'editor').assessment.origin,'reassessment');
});

test('stale review remains stale after inspection and a separate current-source correction retains its own fence',()=>{
  ingest([present('one'),response('one')]);const work=claimVocabularyReflectionJob({kind:'exercise_improvement',now:judgedAt})!;
  const result=recordVocabularyImprovementResult(work.jobId,work.leaseToken,{diagnosis:'Repair',proposal:{operations:[op()],rationale:'Repair'}},judgedAt);
  updateVocabularyContent('one',1,{...draft('one'),body:{prompt:'Current wording'}},actor);
  const stale=listVocabularyProposalReviewBatch('editor',{startProposalId:result.proposalId!}).items[0]!;
  assert.equal(stale.coverageChanged,true);assert.equal(stale.previews[0]!.source!.version,2);assert.equal(stale.proposal.bases[0]!.expectedVersion,1);
  const correction=createVocabularyProposal({caseId:work.caseId,operations:[{...op(),expectedVersion:2}],rationale:'Explicit correction'},'editor');
  assert.equal(correction.authorKind,'operator');assert.equal(correction.caseId,work.caseId);assert.equal(getVocabularyProposal(result.proposalId!,'editor').bases[0]!.expectedVersion,1);
  updateVocabularyContent('one',2,{...draft('one'),body:{prompt:'Concurrent wording'}},actor);
  assert.throws(()=>approveVocabularyProposal(correction.proposalId,1,'editor'),/base changed/);
  assert.equal(getVocabularyCaseWorkspace(work.caseId,'editor').reassessmentUnavailableReason,null);
});

test('same exercise served at different versions retains separate improvement units',()=>{
  const newer=present('one','a','newer');
  if(newer.kind!=='presentation')throw new Error('Expected presentation');
  const current=updateVocabularyContent('one',1,{...draft('one'),body:{prompt:'Version two'}},actor);
  newer.payload.snapshot={...newer.payload.snapshot,contentVersion:2,body:{prompt:'Version two',material:current.body}};
  const {cases}=ingest([present('one','a','older'),response('older'),newer,response('newer')]);
  const units=cases.filter(item=>item.kind==='exercise_improvement');
  assert.equal(units.length,2);assert.deepEqual(units.map(item=>item.evidence.map(encounter=>encounter.snapshot.contentVersion)).sort(),[[1],[2]]);
});

test('review eligibility reports unavailable reasons and never invents model provenance',()=>{
  ingest([present('one'),response('one')]);
  const work=claimVocabularyReflectionJob({kind:'exercise_improvement',now:judgedAt})!;
  const pending=getVocabularyCaseWorkspace(work.caseId,'editor');
  assert.equal(pending.assessment.origin,'unavailable');assert.equal(pending.assessment.models.length,0);assert.match(pending.reassessmentUnavailableReason!,/successful assessment/);
  recordVocabularyImprovementResult(work.jobId,work.leaseToken,{diagnosis:'No change',proposal:null},judgedAt);
  updateVocabularyContent('one',1,{...draft('one'),availability:'retired'},actor);
  assert.match(getVocabularyCaseWorkspace(work.caseId,'editor').reassessmentUnavailableReason!,/not an active/);
});

for(const drift of ['none','before_queue','during_integration'] as const)test(`operator identity resolution resumes a historical complete plan with response drift=${drift}`,async()=>{
  sql.exec("UPDATE lexical_words SET hanzi=CASE id WHEN 'a' THEN '甲' WHEN 'b' THEN '乙' ELSE '丙' END;INSERT INTO lexical_words(id,hanzi,pinyin,meaning) VALUES ('homograph','乙','yi4','another identity');");
  createVocabularySense({senseId:'intended',wordId:'a',description:'the intended use'},actor);
  establishVocabularySenseCatalog('a',getVocabularySenseCatalog('a').version,actor);
  ingest([present('one'),{kind:'response',payload:{encounterId:'one',response:'丙',outcome:'rejected'}},present('one','a','second'),{kind:'response',payload:{encounterId:'second',response:'乙',outcome:'rejected'}}]);
  const work=claimVocabularyReflectionJob({kind:'exercise_improvement',now:judgedAt})!;
  const referral={candidateWords:['甲','乙'],sharedPurpose:'A shared expressive purpose.',rationale:'Both fit this task.',
    draft:{prompt:'Express the shared purpose.',teachingNote:'甲 and 乙 both fulfil this task.'}};
  const steps:string[]=[];
  const adapter:ProviderAdapter={id:'fake',defaultBaseUrl:'https://unused.invalid',apiKeyEnvironmentVariable:'KEY',structuredOutputMode:'json_schema',async run(request){
    const step=request.provenance!.stepName;steps.push(step!);
    const input=JSON.parse(request.userPrompt);
    assert.equal(step,'pure_cue_promotion');assert.deepEqual(input.localPlan.operations.map((operation:{strategy:string})=>operation.strategy),['retire','create']);
    assert.deepEqual(input.referral.draft,referral.draft);
    if(drift==='during_integration')sql.prepare("UPDATE lexical_words SET hanzi='丁',meaning='changed identity' WHERE id='new'").run();
    const value={decision:'create',rationale:'Create the authored shared task.',existingContentId:null,prompt:referral.draft.prompt,semanticAxis:'The shared purpose.',teachingNote:referral.draft.teachingNote};
    return {provider:'fake',model:'fake',responseId:null,structuredOutputMode:'json_schema',rawText:JSON.stringify(value),finishReason:'stop',rawResponse:null,
      usage:{inputTokens:null,cachedInputTokens:null,cacheWriteInputTokens:null,outputTokens:null,reasoningTokens:null,totalTokens:null},invocationId:null};
  }};
  const provider=createVocabularyReflectionProvider({random:()=>0,environment:{OPENAI_API_KEY:'fake'},adapter,
    ensureSenses:async()=>({catalog:getVocabularySenseCatalog('a'),senses:getVocabularySenses('a'),source:'existing'})});
  // Persist the pre-eligibility contract directly: current authoring cannot emit
  // unresolved shared answers, but retained complete plans must still resume.
  const pending:Extract<VocabularyReflectionResult,{kind:'exercise_improvement'}>={kind:'exercise_improvement',result:{
    diagnosis:'Retire the source and provide response and shared practice.',proposal:null,
    admission:{outcome:'single_sense',rationale:'One intended use.',wordId:'a',sourceContentId:'one',sourceContentVersion:1,
      catalogVersion:getVocabularySenseCatalog('a').version,senseIds:['intended'],sourceMapping:{senseId:null,establishedAt:null}},
    pureCueReferral:referral,
    pureCuePromotion:{outcome:'needs_operator',rationale:'Shared response has multiple dictionary identities.',candidateWordIds:['a'],existingContentId:null},
    pendingPlan:{rationale:'Retire the source and provide response and shared practice.',bases:[{contentId:'one',expectedVersion:1}],operations:[
      {...op('retire'),learningRole:'source_repair'},
      {operationKey:'response-1',strategy:'create',learningRole:'refinement',scope:{kind:'shared'},rationale:'Useful response-specific practice.',
        content:{...draft('historical-response','new'),body:{prompt:'Express this distinct response purpose.'},answers:[{wordId:'new',acceptedForms:['丙']}]}}
    ]},
    responseCandidateSnapshots:[{wordId:'new',hanzi:'丙',traditional:null,pinyin:'zì',meaning:'character'}],
  }};
  assert.equal(pending.result.proposal,null);assert.equal(pending.result.pureCuePromotion!.outcome,'needs_operator');
  assert.deepEqual(pending.result.pendingPlan!.operations.map(operation=>operation.strategy),['retire','create']);
  const recorded=recordVocabularyImprovementResult(work.jobId,work.leaseToken,pending.result,judgedAt);
  assert.equal(recorded.proposalId,null);assert.equal(getVocabularyCaseWorkspace(work.caseId,'editor').proposals.length,0);
  assert.equal(getVocabularyContentForMaintenance('one')!.availability,'active');
  assert.deepEqual(pending.result.responseCandidateSnapshots,[{wordId:'new',hanzi:'丙',traditional:null,pinyin:'zì',meaning:'character'}]);
  if(drift==='before_queue'){
    sql.prepare("UPDATE lexical_words SET hanzi='丁',meaning='changed identity' WHERE id='new'").run();
    assert.throws(()=>requestVocabularyPureCueResolution(work.caseId,'editor','openai:gpt-6-sol-high',1,{'甲':'a','乙':'b'}),/Response lexical identities changed/);
    assert.equal(sql.prepare("SELECT count(*) n FROM vocabulary_improvement_stages WHERE input_hash='operator-pure-cue-resolution-v1'").get()!.n,0);
    assert.deepEqual(steps,[]);
    assert.equal(getVocabularyCaseWorkspace(work.caseId,'editor').proposals.length,0);
    return;
  }
  const selected=requestVocabularyPureCueResolution(work.caseId,'editor','openai:gpt-6-sol-high',1,{'甲':'a','乙':'b'});
  const retained=JSON.parse(String(sql.prepare("SELECT result_json FROM vocabulary_improvement_stages WHERE job_id=? AND input_hash='operator-pure-cue-resolution-v1'").get(selected.jobId)!.result_json));
  assert.deepEqual(retained.localPlan,pending.result.pendingPlan);assert.deepEqual(retained.responseCandidateSnapshots,pending.result.responseCandidateSnapshots);
  const child=claimVocabularyReflectionJob({kind:'exercise_improvement',now:new Date(Date.now()+1000).toISOString()})!;
  assert.equal(child.jobId,selected.jobId);assert.deepEqual(child.evidence.evidence,work.evidence.evidence);
  if(drift==='during_integration'){
    await assert.rejects(()=>provider.run(child),/Response lexical identities changed/);
    assert.equal(getVocabularyCaseWorkspace(selected.caseId,'editor').proposals.length,0);
    assert.equal(getVocabularyContentForMaintenance('one')!.availability,'active');
    assert.equal(sql.prepare('SELECT count(*) n FROM content_proposals').get()!.n,0);
    return;
  }
  const completed=await provider.run(child);if(completed.kind!=='exercise_improvement')assert.fail('Expected improvement');
  assert.deepEqual(steps,['pure_cue_promotion']);
  assert.deepEqual(completed.result.proposal!.operations.map(operation=>operation.strategy),['retire','create','create']);
  assert.deepEqual(completed.result.proposal!.operations.slice(0,2),pending.result.pendingPlan!.operations);
  const complete=recordVocabularyImprovementResult(child.jobId,child.leaseToken,completed.result,new Date().toISOString());
  const proposal=getVocabularyProposal(complete.proposalId!,'editor');
  assert.equal(getVocabularyCaseWorkspace(work.caseId,'editor').proposals.length,1);
  assert.deepEqual(proposal.bases.map(base=>({...base})),[{contentId:'one',expectedVersion:1}]);
  const approval=approveVocabularyProposal(proposal.proposalId,proposal.version,'editor');
  applyVocabularyProposal(proposal.proposalId,proposal.version,approval,'apply-stitched-plan','editor');
  assert.equal(getVocabularyContentForMaintenance('one')!.availability,'retired');
  const responseContent=getVocabularyContentForMaintenance(proposal.operations[1]!.content.contentId!)!;
  assert.deepEqual(responseContent.words.map(word=>[word.wordId,word.relation]),[['new','target']]);
  const shared=getVocabularyContentForMaintenance(proposal.operations[2]!.content.contentId!)!;
  assert.equal(shared.kind==='exercise'&&shared.exerciseType,'pure_cue');
  assert.deepEqual(shared.words.map(word=>word.wordId),['a','b']);assert.equal((shared.body as {prompt:string}).prompt,referral.draft.prompt);
  assert.deepEqual(sql.prepare('PRAGMA foreign_key_check').all(),[]);
});

for (const outcome of ['proposal','no_change','attention'] as const) test(`successful reassessment replaces only its originating proposal with ${outcome}`,()=>{

  const {cases}=ingest([present('one'),response('one')]);
  const caseId=cases.find(item=>item.kind==='exercise_improvement')!.caseId;
  const initial=claimVocabularyReflectionJob({kind:'exercise_improvement',now:judgedAt})!;
  const originalInput={diagnosis:'Original judgment',proposal:{operations:[op()],rationale:'Original'}};
  const original=recordVocabularyImprovementResult(initial.jobId,initial.leaseToken,originalInput,judgedAt);
  const sibling=createVocabularyProposal({caseId,operations:[op()],rationale:'Independent editorial work'},'editor');
  const request=requestVocabularyReassessment(caseId,'editor','openai:gpt-6-sol-high',1,{kind:'proposal',proposalId:original.proposalId!,expectedVersion:1});
  assert.equal(getVocabularyProposal(original.proposalId!,'editor').status,'awaiting_review');
  const now=new Date(Date.now()+1000).toISOString();
  const child=claimVocabularyReflectionJob({kind:'exercise_improvement',now})!;
  assert.equal(child.jobId,request.jobId);
  const input={diagnosis:'Fresh judgment',proposal:outcome==='proposal'?{operations:[op()],rationale:'Fresh'}:null,
    ...(outcome==='attention'?{pureCuePromotion:{outcome:'needs_operator' as const,rationale:'Choose identity',candidateWordIds:['a'],existingContentId:null}}:{})};
  const result=recordVocabularyImprovementResult(child.jobId,child.leaseToken,input,now);
  const closed=getVocabularyProposal(original.proposalId!,'editor');
  assert.equal(closed.status,'closed');assert.ok(closed.resolvedAt);
  assert.equal(getVocabularyProposal(sibling.proposalId,'editor').status,'awaiting_review');
  assert.deepEqual(getVocabularyReflectionCase(caseId).evidence,initial.evidence.evidence);
  assert.equal(getVocabularyReflectionCase(request.caseId).status,outcome==='attention'?'open':'completed');
  if(result.proposalId)assert.equal(getVocabularyProposal(result.proposalId,'editor').status,'awaiting_review');
  const closure=sql.prepare("SELECT actor_kind,data_json FROM backend_events WHERE entity_id=? AND name='vocabulary.reflection.proposal_closed'").get(original.proposalId!)!;
  assert.equal(closure.actor_kind,'service');assert.equal(JSON.parse(String(closure.data_json)).successorJobId,child.jobId);
  assert.equal(sql.prepare('SELECT count(*) AS n FROM proposal_reviews WHERE proposal_id=?').get(original.proposalId!)!.n,0);
  assert.deepEqual(recordVocabularyImprovementResult(child.jobId,child.leaseToken,input,now),result);
  assert.equal(sql.prepare("SELECT count(*) AS n FROM backend_events WHERE entity_id=? AND name='vocabulary.reflection.proposal_closed'").get(original.proposalId!)!.n,1);
});

for(const originKind of ['case','proposal'] as const)test(`successful ${originKind} reassessment supersedes an approved but unapplied proposal`,()=>{
  ingest([present('one'),response('one')]);
  const initial=claimVocabularyReflectionJob({kind:'exercise_improvement',now:judgedAt})!;
  const original=recordVocabularyImprovementResult(initial.jobId,initial.leaseToken,{diagnosis:'Original',proposal:{operations:[op()],rationale:'Original'}},judgedAt);
  const proposalId=original.proposalId!,reviewId=approveVocabularyProposal(proposalId,1,'editor');
  requestVocabularyReassessment(initial.caseId,'editor','openai:gpt-6-sol-high',1,originKind==='case'?{kind:'case'}:{kind:'proposal',proposalId,expectedVersion:1});
  assert.equal(getVocabularyProposal(proposalId,'editor').status,'approved');
  const now=new Date(Date.now()+1000).toISOString(),next=claimVocabularyReflectionJob({kind:'exercise_improvement',now})!;
  recordVocabularyImprovementResult(next.jobId,next.leaseToken,{diagnosis:'No change needed',proposal:null},now);
  assert.equal(getVocabularyProposal(proposalId,'editor').status,'closed');
  assert.equal(getVocabularyCaseReview(initial.caseId)?.currentProposalId,null);
  assert.equal(getVocabularyCaseReview(initial.caseId)?.state,'open');
  assert.throws(()=>applyVocabularyProposal(proposalId,1,reviewId,'superseded-approval','editor'),/Exact proposal version requires manual approval/);
  assert.equal(sql.prepare("SELECT count(*) AS n FROM backend_events WHERE entity_id=? AND name='vocabulary.reflection.proposal_closed'").get(proposalId)!.n,1);
});

for(const change of ['edit','approve','fail','stale'] as const)test(`reassessment preserves its origin after ${change}`,()=>{

  const {cases}=ingest([present('one'),response('one')]);
  const caseId=cases.find(item=>item.kind==='exercise_improvement')!.caseId;
  const initial=claimVocabularyReflectionJob({kind:'exercise_improvement',now:judgedAt})!;
  const original=recordVocabularyImprovementResult(initial.jobId,initial.leaseToken,{diagnosis:'Original',proposal:{operations:[op()],rationale:'Original'}},judgedAt);
  requestVocabularyReassessment(caseId,'editor','openai:gpt-6-sol-high',1,{kind:'proposal',proposalId:original.proposalId!,expectedVersion:1});
  const now=new Date(Date.now()+1000).toISOString(),child=claimVocabularyReflectionJob({kind:'exercise_improvement',now})!;
  if(change==='edit')assert.throws(()=>saveVocabularyProposal(original.proposalId!,1,{operations:[op()],rationale:'Operator revision'},'editor'),/frozen/);
  if(change==='approve')assert.throws(()=>approveVocabularyProposal(original.proposalId!,1,'editor'),/frozen/);
  if(change==='fail')failVocabularyReflectionJob(child.jobId,child.leaseToken,'provider failure',now,now);
  else if(change==='stale'){
    updateVocabularyContent('one',1,{...draft('one'),body:{prompt:'Changed source'}},actor);
    assert.throws(()=>recordVocabularyImprovementResult(child.jobId,child.leaseToken,{diagnosis:'Fresh',proposal:null},now),/source version changed/);
  }else recordVocabularyImprovementResult(child.jobId,child.leaseToken,{diagnosis:'Fresh',proposal:null},now);
  const current=getVocabularyProposal(original.proposalId!,'editor');
  assert.equal(current.status,change==='approve'||change==='edit'?'closed':'awaiting_review');
  assert.equal(current.version,1);
});

for(const attention of [false,true])test(`successful reassessment replaces current ${attention?'attention':'no-change'} assessment in the same case`,()=>{

  const {cases}=ingest([present('one'),response('one')]);
  const caseId=cases.find(item=>item.kind==='exercise_improvement')!.caseId;
  const initial=claimVocabularyReflectionJob({kind:'exercise_improvement',now:judgedAt})!;
  const input={diagnosis:'Judgment',proposal:null,...(attention?{pureCuePromotion:{outcome:'needs_operator' as const,rationale:'Choose identity',candidateWordIds:['a'],existingContentId:null}}:{})};
  recordVocabularyImprovementResult(initial.jobId,initial.leaseToken,input,judgedAt);
  const next=requestVocabularyReassessment(caseId,'editor','openai:gpt-6-sol-high',1);
  const now=new Date(Date.now()+1000).toISOString(),child=claimVocabularyReflectionJob({kind:'exercise_improvement',now})!;
  recordVocabularyImprovementResult(child.jobId,child.leaseToken,input,now);
  assert.equal(next.caseId,caseId);assert.equal(getVocabularyCaseReview(caseId)?.state,'open');
  assert.equal(getVocabularyCaseReview(caseId)?.currentJobId,child.jobId);
  assert.equal(getVocabularyReflectionCase(caseId).resolvedAt,null);
  assert.ok(!listVocabularyNoProposalCases('editor','closed').some(item=>item.caseId===caseId));
  assert.equal(getVocabularyReflectionCase(next.caseId).status,attention?'open':'completed');
});

test('reassessment freezes journal approval and failure restores the previous proposal',()=>{

  ingest([present('one'),response('one')]);
  const initial=claimVocabularyReflectionJob({kind:'exercise_improvement',now:judgedAt})!;
  const original=recordVocabularyImprovementResult(initial.jobId,initial.leaseToken,{diagnosis:'Original',proposal:{operations:[op()],rationale:'Original'}},judgedAt);
  requestVocabularyReassessment(initial.caseId,'editor','openai:gpt-6-sol-high',1,{kind:'proposal',proposalId:original.proposalId!,expectedVersion:1});
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'reassessment-approval-'));
  try {
    const queue=createVocabularyApprovalRequests({filePath:path.join(folder,'requests.jsonl'),controls:()=>({maintenanceMode:false})});
    const authorization={requestId:'approval-during-reassessment',proposalId:original.proposalId!,expectedVersion:1,actorId:'editor',notes:null};
    assert.throws(()=>queue.enqueue(authorization),/frozen/);
    const now=new Date(Date.now()+1000).toISOString(),child=claimVocabularyReflectionJob({kind:'exercise_improvement',now})!;
    failVocabularyReflectionJob(child.jobId,child.leaseToken,'failed',now,now);
    assert.equal(getVocabularyProposal(original.proposalId!,'editor').status,'awaiting_review');
    queue.enqueue(authorization);
    assert.throws(()=>requestVocabularyReassessment(initial.caseId,'editor','openai:gpt-6-sol-high',1),/approval is queued/);
    assert.equal(queue.step(),true);assert.equal(queue.list()[0]!.status,'succeeded');
    assert.equal(getVocabularyProposal(original.proposalId!,'editor').status,'applied');
  }finally{fs.rmSync(folder,{recursive:true,force:true});}
});

test('case attempts are sequential, reassessment freezes all review mutations, timeout restores the previous state',()=>{
  ingest([present('one'),response('one')]);
  const original=claimVocabularyReflectionJob({kind:'exercise_improvement',now:judgedAt})!;
  assert.equal(original.caseSequence,1);
  const made=recordVocabularyImprovementResult(original.jobId,original.leaseToken,{diagnosis:'Original',proposal:{operations:[op()],rationale:'Original'}},judgedAt);
  const originalReview=getVocabularyCaseReview(original.caseId)!;
  const queued=requestVocabularyReassessment(original.caseId,'editor','openai:gpt-6-sol-high',1);
  const frozen=getVocabularyCaseReview(original.caseId)!;
  assert.equal(queued.caseId,original.caseId);assert.equal(frozen.activeJob?.sequence,2);assert.equal(frozen.frozen,true);
  assert.equal(frozen.currentJobId,original.jobId);assert.equal(frozen.currentProposalId,made.proposalId);assert.ok(frozen.version>originalReview.version);
  assert.throws(()=>createVocabularyProposal({caseId:original.caseId,operations:[op()],rationale:'Correction'},'editor'),/frozen/);
  assert.throws(()=>closeVocabularyProposal(made.proposalId!,1,'editor'),/frozen/);
  assert.throws(()=>closeVocabularyCase(original.caseId,'editor','Done'),/frozen/);
  assert.throws(()=>requestVocabularySecondOpinion(made.proposalId!,1,'editor'),/frozen/);
  const now=new Date(Date.now()+1000).toISOString(),running=claimVocabularyReflectionJob({kind:'exercise_improvement',now,leaseMs:10})!;
  assert.equal(running.caseSequence,2);assert.equal(running.attemptNumber,1);
  const runningVersion=getVocabularyCaseReview(original.caseId)!.version;
  recoverVocabularyReflectionJobs(new Date(Date.parse(now)+11).toISOString());
  const unfrozen=getVocabularyCaseReview(original.caseId)!;
  assert.equal(unfrozen.frozen,false);assert.equal(unfrozen.activeJob,null);assert.equal(unfrozen.currentJobId,original.jobId);assert.equal(unfrozen.currentProposalId,made.proposalId);assert.ok(unfrozen.version>runningVersion);
  const next=requestVocabularyReassessment(original.caseId,'editor','openai:gpt-6-sol-high',1);
  assert.equal(getVocabularyCaseReview(original.caseId)?.activeJob?.sequence,3);
  const third=claimVocabularyReflectionJob({kind:'exercise_improvement',now:new Date(Date.now()+2000).toISOString()})!;
  assert.equal(third.jobId,next.jobId);recordVocabularyImprovementResult(third.jobId,third.leaseToken,{diagnosis:'No change',proposal:null},new Date(Date.now()+2001).toISOString());
  assert.throws(()=>retryVocabularyReflectionJob(running.jobId,'editor'),/latest failed/);
  assert.equal(getVocabularyCaseReview(original.caseId)?.currentJobId,third.jobId);
  assert.equal(getVocabularyReflectionCase(original.caseId).createdAt,original.evidence.createdAt);
});

test('failed initial job retries within its sequence and an advisory job cannot change current assessment',()=>{
  ingest([present('one'),response('one')]);
  const initial=claimVocabularyReflectionJob({kind:'exercise_improvement',now:judgedAt})!;
  failVocabularyReflectionJob(initial.jobId,initial.leaseToken,'provider_failed',judgedAt,judgedAt);
  assert.equal(getVocabularyCaseReview(initial.caseId)?.currentJobId,null);
  retryVocabularyReflectionJob(initial.jobId,'editor',judgedAt);
  const retried=claimVocabularyReflectionJob({kind:'exercise_improvement',now:judgedAt})!;
  assert.equal(retried.caseSequence,1);assert.equal(retried.attemptNumber,2);
  const output=recordVocabularyImprovementResult(retried.jobId,retried.leaseToken,{diagnosis:'Original',proposal:{operations:[op()],rationale:'Original'}},judgedAt);
  const opinion=requestVocabularySecondOpinion(output.proposalId!,1,'editor');
  assert.equal(getVocabularyCaseReview(initial.caseId)?.frozen,false);
  assert.throws(()=>requestVocabularyReassessment(initial.caseId,'editor','openai:gpt-6-sol-high',1),/already queued/);
  const revised=saveVocabularyProposal(output.proposalId!,1,{operations:[op()],rationale:'Editorial revision'},'editor');
  const now=new Date(Date.now()+1000).toISOString(),review=claimVocabularyReflectionJob({kind:'exercise_improvement',now})!;
  assert.equal(review.caseSequence,2);assert.equal(review.jobId,opinion.jobId);assert.equal(review.secondOpinion?.proposal?.version,1);
  recordVocabularyImprovementResult(review.jobId,review.leaseToken,{diagnosis:'Advisory',proposal:null,secondOpinion:{verdict:'support',rationale:'Sound'}},now);
  assert.equal(getVocabularyCaseReview(initial.caseId)?.currentJobId,initial.jobId);assert.equal(getVocabularyProposal(output.proposalId!,'editor').version,revised.version);
});

test('approval journal reconciles orphan locks, retains attention, and reconstructs pending authority after restart',()=>{
  ingest([present('one'),response('one')]);
  const work=claimVocabularyReflectionJob({kind:'exercise_improvement',now:judgedAt})!;
  const output=recordVocabularyImprovementResult(work.jobId,work.leaseToken,{diagnosis:'Original',proposal:{operations:[op()],rationale:'Original'}},judgedAt);
  const authorization={requestId:'case-approval',proposalId:output.proposalId!,expectedVersion:1,actorId:'editor',notes:null};
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'case-approval-replay-')),filePath=path.join(directory,'requests.jsonl');
  try{
    recordVocabularyApprovalIntent({...authorization,requestId:'orphan-before-journal-append'});
    assert.equal(getVocabularyCaseReview(work.caseId)?.approvalState,'pending');
    const failing=createVocabularyApprovalRequests({filePath,controls:()=>({maintenanceMode:false}),complete:()=>{throw new TypeError('Synthetic invalid approval');}});
    assert.deepEqual(failing.list(),[]);assert.equal(getVocabularyCaseReview(work.caseId)?.approvalState,null);
    failing.enqueue(authorization);assert.equal(getVocabularyCaseReview(work.caseId)?.approvalState,'pending');
    assert.throws(()=>saveVocabularyProposal(output.proposalId!,1,{operations:[op()],rationale:'Race'},'editor'),/approval is queued/);
    failing.step();assert.equal(getVocabularyCaseReview(work.caseId)?.approvalState,'attention');
    const updated=saveVocabularyProposal(output.proposalId!,1,{operations:[op()],rationale:'Fixed revision'},'editor');
    assert.equal(getVocabularyCaseReview(work.caseId)?.approvalState,null);
    const replay=createVocabularyApprovalRequests({filePath,controls:()=>({maintenanceMode:false})});replay.list();
    assert.equal(getVocabularyCaseReview(work.caseId)?.approvalState,null,'obsolete attention does not hide a newer revision');
    replay.enqueue({...authorization,requestId:'revision-two',expectedVersion:updated.version});
    sql.prepare('UPDATE vocabulary_case_reviews SET approval_request_id=NULL,approval_state=NULL WHERE case_id=?').run(work.caseId);
    const restarted=createVocabularyApprovalRequests({filePath,controls:()=>({maintenanceMode:false})});restarted.list();
    assert.equal(getVocabularyCaseReview(work.caseId)?.approvalState,'pending');
    assert.throws(()=>requestVocabularyReassessment(work.caseId,'editor','openai:gpt-6-sol-high',1),/approval is queued/);
    restarted.step();const done=getVocabularyCaseReview(work.caseId)!;
    assert.equal(done.state,'resolved');assert.equal(done.approvalState,null);assert.equal(done.currentProposalId,output.proposalId);
  }finally{fs.rmSync(directory,{recursive:true,force:true});}
});


test('historical scope aliases retain evidence while the word workspace exposes shared defaults only',()=>{
  const sense=createVocabularySense({wordId:'a',description:'written character'},actor);
  ingest([present('one'),response('one')]);
  const work=claimVocabularyReflectionJob({kind:'exercise_improvement',now:judgedAt})!;
  recordVocabularyImprovementResult(work.jobId,work.leaseToken,{diagnosis:'Reviewed',proposal:null},judgedAt);
  const alias='legacy-reassessment-child';
  sql.prepare(`INSERT INTO reflection_cases(case_id,completion_id,learner_id,kind,subject_key,word_id,content_id,status,evidence_snapshot_json,created_at)
    SELECT ?,completion_id,learner_id,kind,subject_key||':legacy-child',word_id,content_id,status,evidence_snapshot_json,created_at FROM reflection_cases WHERE case_id=?`).run(alias,work.caseId);
  sql.prepare('INSERT INTO vocabulary_case_lineage(member_case_id,case_id) VALUES (?,?)').run(alias,work.caseId);
  sql.prepare('INSERT INTO vocabulary_case_sense_coverage(case_id,version,included_sense_ids_json,updated_at) VALUES (?,?,?,?)').run(alias,7,JSON.stringify([sense.senseId]),at);
  const historical=sql.prepare('SELECT * FROM vocabulary_case_sense_coverage').all();
  writeVocabularyDefaultUsefulSenses('a',0,[],actor);
  const opened=getVocabularySenseCoverageWorkspace('word','a','editor');
  assert.equal(opened.review,null);assert.deepEqual(opened.includedSenseIds,[]);
  assert.deepEqual(sql.prepare('SELECT * FROM vocabulary_case_sense_coverage').all(),historical);
});

test('pending approval excludes direct approval and application, allowing only its exact journal request and proposal',()=>{
  ingest([present('one'),response('one')]);
  const work=claimVocabularyReflectionJob({kind:'exercise_improvement',now:judgedAt})!;
  const output=recordVocabularyImprovementResult(work.jobId,work.leaseToken,{diagnosis:'Original',proposal:{operations:[op()],rationale:'Original'}},judgedAt);
  const sibling=createVocabularyProposal({caseId:work.caseId,operations:[op('update_existing','two','two')],rationale:'Alternative'},'editor');
  const siblingReview=approveVocabularyProposal(sibling.proposalId,1,'editor');
  const authorization={requestId:'exact-case-approval',proposalId:output.proposalId!,expectedVersion:1,actorId:'editor',notes:null};
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'case-approval-exclusion-'));
  try{
    const queue=createVocabularyApprovalRequests({filePath:path.join(directory,'requests.jsonl'),controls:()=>({maintenanceMode:false})});
    queue.enqueue(authorization);
    assert.throws(()=>approveVocabularyProposal(sibling.proposalId,1,'editor'),/approval is queued/);
    assert.throws(()=>approveVocabularyProposal(output.proposalId!,1,'editor'),/approval is queued/);
    assert.throws(()=>applyVocabularyProposal(sibling.proposalId,1,siblingReview,'sibling-direct-apply','editor'),/approval is queued/);
    assert.throws(()=>completeVocabularyApprovalRequest({...authorization,requestId:'wrong-request'}),/approval is queued/);
    assert.throws(()=>completeVocabularyApprovalRequest({...authorization,proposalId:sibling.proposalId}),/approval is queued/);
    assert.equal(getVocabularyCaseReview(work.caseId)?.approvalRequestId,authorization.requestId);
    assert.equal(getVocabularyContentForMaintenance('one')!.version,1);assert.equal(getVocabularyContentForMaintenance('two')!.version,1);
    queue.step();assert.equal(queue.list()[0]!.status,'succeeded');
    assert.equal(getVocabularyProposal(output.proposalId!,'editor').status,'applied');
    assert.equal(getVocabularyProposal(sibling.proposalId,'editor').status,'approved');
    assert.equal(getVocabularyCaseReview(work.caseId)?.approvalState,null);
    assert.equal(getVocabularyCaseReview(work.caseId)?.currentProposalId,sibling.proposalId);
    assert.equal(getVocabularyContentForMaintenance('one')!.version,2);assert.equal(getVocabularyContentForMaintenance('two')!.version,1);
  }finally{fs.rmSync(directory,{recursive:true,force:true});}
});

function repairTargetFixture() {
  const original=createVocabularySense({wordId:'a',description:'written character'},actor);
  const alternative=createVocabularySense({wordId:'a',description:'writing style'},actor);
  ingest([present('one'),response('one')]);
  const work=claimVocabularyReflectionJob({kind:'exercise_improvement',now:judgedAt})!;
  const admission={outcome:'single_sense' as const,rationale:'Mapped target',wordId:'a',sourceContentId:'one',sourceContentVersion:1,
    catalogVersion:getVocabularySenseCatalog('a').version,senseIds:[original.senseId],sourceMapping:{senseId:null,establishedAt:null}};
  const operation=op();operation.content.words=[{wordId:'a',relation:'target',senseId:original.senseId,senseMappingEstablishedAt:judgedAt}];
  const result=recordVocabularyImprovementResult(work.jobId,work.leaseToken,{diagnosis:'Repair',proposal:{operations:[operation],rationale:'Repair'},admission},judgedAt);
  return {work,admission,operation,proposalId:result.proposalId!,original,alternative};
}

for(const same of [true,false])test(`pending target blocks editing/application without mutating source; reset restores the assessed target (same=${same})`,()=>{
  const f=repairTargetFixture(),before=getVocabularyContentForMaintenance('one');
  const approval=approveVocabularyProposal(f.proposalId,1,'editor');
  const desired=same?f.original.senseId:f.alternative.senseId;
  const saved=setVocabularyRepairTarget(f.work.caseId,0,desired,'editor');
  assert.equal(saved.pendingSenseId,desired);assert.equal(saved.currentSenseId,f.original.senseId);assert.equal(saved.blocked,true);
  assert.deepEqual(getVocabularyContentForMaintenance('one'),before);
  assert.throws(()=>saveVocabularyProposal(f.proposalId,1,{operations:[f.operation],rationale:'Manual tweak'},'editor'),/reassess or reset/);
  assert.throws(()=>applyVocabularyProposal(f.proposalId,1,approval,'pending-target','editor'),/reassess or reset/);
  assert.throws(()=>recordVocabularyApprovalIntent({requestId:'blocked-intent',proposalId:f.proposalId,expectedVersion:1,actorId:'editor'}),/reassess or reset/);
  assert.equal(getVocabularyCaseReview(f.work.caseId)!.approvalState,null);
  assert.throws(()=>setVocabularyRepairTarget(f.work.caseId,0,null,'editor'),/changed/);
  const reset=setVocabularyRepairTarget(f.work.caseId,saved.version,null,'editor');
  assert.equal(reset.blocked,false);assert.equal(reset.pendingSenseId,null);assert.equal(reset.currentSenseId,f.original.senseId);
  assert.deepEqual(getVocabularyContentForMaintenance('one'),before);
  const reviewed=approveVocabularyProposal(f.proposalId,1,'editor');
  applyVocabularyProposal(f.proposalId,1,reviewed,'reset-target','editor');
  assert.equal(getVocabularyContentForMaintenance('one')!.words[0]!.senseId,f.original.senseId);
});

test('failed target reassessment leaves intent pending and reset does not erase independent source staleness',()=>{
  const f=repairTargetFixture(),pending=setVocabularyRepairTarget(f.work.caseId,0,f.alternative.senseId,'editor');
  requestVocabularyReassessment(f.work.caseId,'editor','openai:gpt-6-sol-high',1);
  assert.throws(()=>setVocabularyRepairTarget(f.work.caseId,pending.version,null,'editor'),/frozen/);
  const now=new Date(Date.now()+1000).toISOString(),job=claimVocabularyReflectionJob({kind:'exercise_improvement',now})!;
  assert.deepEqual(job.repairTarget,{senseId:f.alternative.senseId,version:pending.version});
  failVocabularyReflectionJob(job.jobId,job.leaseToken,'Provider unavailable',now,now);
  assert.equal(getVocabularyRepairTarget(f.work.caseId,'editor').blocked,true);
  assert.throws(()=>approveVocabularyProposal(f.proposalId,1,'editor'),/reassess or reset/);
  updateVocabularyContent('one',1,{...getVocabularyContentForMaintenance('one')!,body:{prompt:'Changed elsewhere'}},actor);
  setVocabularyRepairTarget(f.work.caseId,pending.version,null,'editor');
  assert.throws(()=>retryVocabularyReflectionJob(job.jobId,'editor'),/target.*changed|target.*stale|fresh reassessment|reassess/i);
  assert.throws(()=>approveVocabularyProposal(f.proposalId,1,'editor'),/content base changed|sense evidence changed/);
});

for(const producesRepair of [true,false])test(`matching target reassessment consumes pending intent and keeps older proposals ineligible (repair=${producesRepair})`,()=>{
  const f=repairTargetFixture(),before=getVocabularyContentForMaintenance('one');
  const oldAlternative=createVocabularyProposal({caseId:f.work.caseId,operations:[f.operation],rationale:'Another repair of the original sense'},'editor');
  const pending=setVocabularyRepairTarget(f.work.caseId,0,f.alternative.senseId,'editor');
  requestVocabularyReassessment(f.work.caseId,'editor','openai:gpt-6-sol-high',1);
  const now=new Date(Date.now()+1000).toISOString(),job=claimVocabularyReflectionJob({kind:'exercise_improvement',now})!;
  const replacement=op();replacement.content.words=[{wordId:'a',relation:'target',senseId:f.alternative.senseId,senseMappingEstablishedAt:now}];
  const result=recordVocabularyImprovementResult(job.jobId,job.leaseToken,{diagnosis:'Operator-directed assessment',proposal:producesRepair?{operations:[replacement],rationale:'Repair this use'}:null,
    admission:{...f.admission,senseIds:[f.alternative.senseId],repairTargetVersion:pending.version}},now);
  const current=getVocabularyRepairTarget(f.work.caseId,'editor');
  assert.equal(current.blocked,false);assert.equal(current.pendingSenseId,null);assert.equal(current.currentSenseId,f.alternative.senseId);
  assert.deepEqual(getVocabularyContentForMaintenance('one'),before);
  assert.throws(()=>approveVocabularyProposal(f.proposalId,1,'editor'),/cannot be approved|closed|resolved|predates/);
  assert.throws(()=>approveVocabularyProposal(oldAlternative.proposalId,1,'editor'),/cannot be approved|closed|resolved|predates/);
  if(producesRepair){
    const reviewed=approveVocabularyProposal(result.proposalId!,1,'editor');
    applyVocabularyProposal(result.proposalId!,1,reviewed,'new-target','editor');
    assert.equal(getVocabularyContentForMaintenance('one')!.words[0]!.senseId,f.alternative.senseId);
  }
});

function repertoireSelectionFixture(omittedSelectedSense=false){
  const first=createVocabularySense({wordId:'a',description:'written character'},actor);
  const second=createVocabularySense({wordId:'a',description:'writing style'},actor);
  const third=createVocabularySense({wordId:'a',description:'a name'},actor);
  const selected=[first.senseId,second.senseId,...(omittedSelectedSense?[third.senseId]:[])];
  writeVocabularyDefaultUsefulSenses('a',0,selected,actor);
  ingest([present('one'),response('one')]);const work=claimVocabularyReflectionJob({kind:'exercise_improvement',now:judgedAt})!;
  const operations=[op('replace','one','first-item'),{...op('create','one','second-item'),operationKey:'second'}];
  operations.forEach((operation,index)=>{operation.content.words=[{wordId:'a',relation:'target',senseId:[first.senseId,second.senseId][index]!,senseMappingEstablishedAt:judgedAt}];});
  const result=recordVocabularyImprovementResult(work.jobId,work.leaseToken,{diagnosis:'Repertoire',proposal:{operations,rationale:'Useful repertoire'},admission:{outcome:'repertoire_bootstrap',rationale:'First repertoire',wordId:'a',sourceContentId:'one',sourceContentVersion:1,
    catalogVersion:getVocabularySenseCatalog('a').version,senseIds:[],sourceMapping:{senseId:null,establishedAt:null},generationScope:{selectionEstablished:true,senseIds:selected,source:{kind:'word_defaults',wordId:'a',capturedVersion:1}}}},judgedAt);
  return {first,second,third,proposalId:result.proposalId!,operations};
}
test('repertoire selection saves defaults atomically and restores retained exercises without a model call',()=>{
  const f=repertoireSelectionFixture();
  const before=getVocabularyContentForMaintenance('one'),jobs=sql.prepare('SELECT * FROM vocabulary_reflection_jobs').all();
  const narrowed=saveRepertoireWordDefaults(f.proposalId,1,1,[f.second.senseId],'editor');
  assert.equal(narrowed.proposal.version,2);assert.equal(narrowed.proposal.operations.length,1);
  assert.equal(narrowed.proposal.operations[0]!.strategy,'replace');
  assert.equal(narrowed.proposal.operations[0]!.content.words[0]!.senseId,f.second.senseId);
  assert.deepEqual(narrowed.coverage.includedSenseIds,[f.second.senseId]);
  const restored=saveRepertoireWordDefaults(f.proposalId,2,2,[f.first.senseId,f.second.senseId],'editor');
  assert.deepEqual(restored.proposal.operations,f.operations);
  assert.deepEqual(getVocabularyContentForMaintenance('one'),before);assert.deepEqual(sql.prepare('SELECT * FROM vocabulary_reflection_jobs').all(),jobs);
  assert.equal(sql.prepare('SELECT count(*) AS count FROM vocabulary_repertoire_revisions').get()!.count,2);
});
test('repertoire selection preserves manual edits while restoring hidden items',()=>{
  const f=repertoireSelectionFixture();
  const narrowed=saveRepertoireWordDefaults(f.proposalId,1,1,[f.second.senseId],'editor').proposal;
  const edited=structuredClone(narrowed.operations);edited[0]!.content.body={prompt:'Manually improved retained exercise'};
  saveVocabularyProposal(f.proposalId,2,{operations:edited,rationale:narrowed.rationale},'editor');
  const restored=saveRepertoireWordDefaults(f.proposalId,3,2,[f.first.senseId,f.second.senseId],'editor').proposal;
  assert.deepEqual(restored.operations[0],f.operations[0]);
  assert.equal(restored.operations[1]!.strategy,'create');
  assert.deepEqual(restored.operations[1]!.content.body,{prompt:'Manually improved retained exercise'});
});
test('repertoire Apply writes only selected exercises and preserves the hidden source version in history',()=>{
  const f=repertoireSelectionFixture();
  const narrowed=saveRepertoireWordDefaults(f.proposalId,1,1,[f.second.senseId],'editor').proposal;
  const approval=approveVocabularyProposal(f.proposalId,narrowed.version,'editor');
  applyVocabularyProposal(f.proposalId,narrowed.version,approval,'selected-only','editor');
  assert.equal(getVocabularyContentForMaintenance('first-item'),null);
  assert.equal(getVocabularyContentForMaintenance('second-item')!.words[0]!.senseId,f.second.senseId);
  assert.equal(getVocabularyContentForMaintenance('one')!.availability,'retired');
  const original=JSON.parse((sql.prepare('SELECT snapshot_json FROM proposal_revision_history WHERE proposal_id=? AND version=1').get(f.proposalId) as {snapshot_json:string}).snapshot_json);
  assert.deepEqual(original.operations,f.operations);
});
test('an already-selected sense omitted by generation does not prevent saving other selection changes',()=>{
  const f=repertoireSelectionFixture(true);
  const result=saveRepertoireWordDefaults(f.proposalId,1,1,[f.second.senseId,f.third.senseId],'editor');
  assert.deepEqual(result.coverage.includedSenseIds,[f.second.senseId,f.third.senseId].sort());
  assert.equal(result.proposal.operations.length,1);
  saveRepertoireWordDefaults(f.proposalId,2,2,[f.second.senseId],'editor');
  assert.throws(()=>saveRepertoireWordDefaults(f.proposalId,3,3,[f.second.senseId,f.third.senseId],'editor'),/no retained exercises/);
});
test('repertoire selection rolls back both defaults and proposal on conflicts or missing generated exercises',()=>{
  const f=repertoireSelectionFixture();
  const before=resolveVocabularySenseCoverage('a'),history=sql.prepare('SELECT * FROM vocabulary_sense_coverage_history').all();
  for(const work of [
    ()=>saveRepertoireWordDefaults(f.proposalId,2,1,[f.second.senseId],'editor'),
    ()=>saveRepertoireWordDefaults(f.proposalId,1,0,[f.second.senseId],'editor'),
    ()=>saveRepertoireWordDefaults(f.proposalId,1,1,[f.third.senseId],'editor'),
    ()=>saveRepertoireWordDefaults(f.proposalId,1,1,[],'editor'),
  ]){
    assert.throws(work);assert.deepEqual(resolveVocabularySenseCoverage('a'),before);
    assert.deepEqual(sql.prepare('SELECT * FROM vocabulary_sense_coverage_history').all(),history);
    assert.equal(getVocabularyProposal(f.proposalId,'editor').version,1);
  }
  updateVocabularyContent('one',1,{...getVocabularyContentForMaintenance('one')!,body:{prompt:'Source changed'}},actor);
  assert.throws(()=>saveRepertoireWordDefaults(f.proposalId,1,1,[f.second.senseId],'editor'),/Source or inventory changed/);
  assert.deepEqual(resolveVocabularySenseCoverage('a'),before);
});



test('successful publication must honor the captured sense as well as its intent version',()=>{
  const f=repairTargetFixture(),pending=setVocabularyRepairTarget(f.work.caseId,0,f.alternative.senseId,'editor');
  requestVocabularyReassessment(f.work.caseId,'editor','openai:gpt-6-sol-high',1);
  const now=new Date(Date.now()+1000).toISOString(),job=claimVocabularyReflectionJob({kind:'exercise_improvement',now})!;
  const before=getVocabularyContentForMaintenance('one');
  assert.throws(()=>recordVocabularyImprovementResult(job.jobId,job.leaseToken,{diagnosis:'Wrong target',proposal:null,
    admission:{...f.admission,repairTargetVersion:pending.version}},now),/captured repair target/);
  assert.equal(getVocabularyRepairTarget(f.work.caseId,'editor').pendingSenseId,f.alternative.senseId);
  assert.equal(getVocabularyProposal(f.proposalId,'editor').status,'awaiting_review');
  assert.equal(sql.prepare('SELECT status FROM vocabulary_reflection_jobs WHERE job_id=?').get(job.jobId)!.status,'running');
  assert.deepEqual(getVocabularyContentForMaintenance('one'),before);
});

function repertoireReassessmentInput(f:ReturnType<typeof repertoireSelectionFixture>){
  const proposal=getVocabularyProposal(f.proposalId,'editor'),card=getVocabularyCaseCard(proposal.caseId!,'editor');
  return {expectedVersion:proposal.version,expectedWordVersion:1,expectedCaseVersion:card.version,expectedContentVersion:1,
    includedSenseIds:[f.first.senseId,f.third.senseId],modelChoice:'openai:gpt-6-sol-high' as const};
}
test('save selection and reassess captures exact defaults, keeps the proposal and preserves selection after generation failure',()=>{
  const f=repertoireSelectionFixture(),input=repertoireReassessmentInput(f),before=getVocabularyProposal(f.proposalId,'editor');
  const queued=saveRepertoireWordDefaultsAndReassess(f.proposalId,input,'editor');
  assert.equal(queued.coverage.word.version,2);assert.deepEqual(queued.coverage.includedSenseIds,[...input.includedSenseIds].sort());
  assert.deepEqual(getVocabularyProposal(f.proposalId,'editor'),before);assert.equal(queued.item.frozen,true);
  const capture=getVocabularyRepertoireSelection(queued.jobId)!;
  assert.deepEqual(capture.generationScope,{selectionEstablished:true,senseIds:[...input.includedSenseIds].sort(),source:{kind:'word_defaults',wordId:'a',capturedVersion:2}});
  writeVocabularyDefaultUsefulSenses('a',2,[f.second.senseId],actor);
  assert.deepEqual(getVocabularyRepertoireSelection(queued.jobId),capture);
  const job=claimVocabularyReflectionJob({kind:'exercise_improvement',now:new Date(Date.now()+1000).toISOString()})!;
  assert.equal(job.jobId,queued.jobId);
  failVocabularyReflectionJob(job.jobId,job.leaseToken,'Provider failed',new Date(Date.now()+2000).toISOString());
  assert.equal(getVocabularyCaseCard(queued.caseId,'editor').frozen,false);
  assert.equal(getVocabularyProposal(f.proposalId,'editor').status,before.status);
  assert.deepEqual(resolveVocabularySenseCoverage('a').includedSenseIds,[f.second.senseId]);
  retryVocabularyReflectionJob(job.jobId,'editor');
  assert.deepEqual(getVocabularyRepertoireSelection(job.jobId),capture);
});
test('save selection and reassess rolls back policy and jobs for invalid versions, scopes and queue admission',()=>{
  const f=repertoireSelectionFixture(),input=repertoireReassessmentInput(f),before=resolveVocabularySenseCoverage('a');
  const history=sql.prepare('SELECT * FROM vocabulary_sense_coverage_history').all(),jobs=sql.prepare('SELECT job_id FROM vocabulary_reflection_jobs').all();
  for(const invalid of [
    {...input,expectedVersion:2},{...input,expectedWordVersion:0},{...input,expectedCaseVersion:input.expectedCaseVersion+1},
    {...input,expectedContentVersion:2},{...input,includedSenseIds:[]},{...input,includedSenseIds:['foreign']},
  ]){
    assert.throws(()=>saveRepertoireWordDefaultsAndReassess(f.proposalId,invalid,'editor'));
    assert.deepEqual(resolveVocabularySenseCoverage('a'),before);assert.deepEqual(sql.prepare('SELECT * FROM vocabulary_sense_coverage_history').all(),history);
    assert.deepEqual(sql.prepare('SELECT job_id FROM vocabulary_reflection_jobs').all(),jobs);
  }
  const queued=saveRepertoireWordDefaultsAndReassess(f.proposalId,input,'editor');
  const saved=resolveVocabularySenseCoverage('a');
  assert.throws(()=>saveRepertoireWordDefaultsAndReassess(f.proposalId,{...input,expectedWordVersion:2,expectedCaseVersion:queued.item.version},'editor'),/frozen|progress|active|queued/i);
  assert.deepEqual(resolveVocabularySenseCoverage('a'),saved);
});
test('repertoire result must honor captured scope and only successful reassessment replaces the original proposal',()=>{
  const f=repertoireSelectionFixture(),input=repertoireReassessmentInput(f);
  const queued=saveRepertoireWordDefaultsAndReassess(f.proposalId,input,'editor');
  const now=new Date(Date.now()+1000).toISOString(),job=claimVocabularyReflectionJob({kind:'exercise_improvement',now})!;
  const captured=getVocabularyRepertoireSelection(job.jobId)!;
  const admission={outcome:'repertoire_bootstrap' as const,rationale:'Selected repertoire',wordId:'a',sourceContentId:'one',sourceContentVersion:1,
    catalogVersion:captured.catalogVersion,senseIds:[],sourceMapping:{senseId:null,establishedAt:null},generationScope:captured.generationScope};
  const result={diagnosis:'Expanded repertoire',proposal:{operations:[f.operations[0]!],rationale:'Selected uses'},admission};
  assert.throws(()=>recordVocabularyImprovementResult(job.jobId,job.leaseToken,{...result,admission:{...admission,generationScope:{...admission.generationScope,senseIds:[f.second.senseId]}}},now),/captured repertoire selection/);
  assert.notEqual(getVocabularyProposal(f.proposalId,'editor').status,'closed');
  const completed=recordVocabularyImprovementResult(job.jobId,job.leaseToken,result,now);
  assert.ok(completed.proposalId);assert.equal(getVocabularyProposal(f.proposalId,'editor').status,'closed');
  assert.equal(getVocabularyCaseCard(queued.caseId,'editor').currentProposalId,completed.proposalId);
});

test('original model proposal remains immutable across saved edits and manual drafts have no model baseline',()=>{
  ingest([present('one'),response('one')]);
  const work=claimVocabularyReflectionJob({kind:'exercise_improvement',now:judgedAt})!;
  const result=recordVocabularyImprovementResult(work.jobId,work.leaseToken,{diagnosis:'Repair',proposal:{operations:[op()],rationale:'Original model rationale'}},judgedAt);
  const original=getVocabularyOriginalModelProposal(result.proposalId!,'editor')!;
  assert.equal(original.version,1);
  const edited=op();edited.content={...edited.content,body:{prompt:'Operator edited wording'}};
  saveVocabularyProposal(result.proposalId!,1,{operations:[edited],rationale:'Edited'},'editor');
  assert.deepEqual(getVocabularyOriginalModelProposal(result.proposalId!,'editor'),original);
  assert.throws(()=>getVocabularyOriginalModelProposal(result.proposalId!,'alice'),/Operator/);
  const manual=createVocabularyProposal({operations:[op()],rationale:'Manual'},'editor');
  assert.equal(getVocabularyOriginalModelProposal(manual.proposalId,'editor'),null);
});

test('maintenance applies a reviewed cue edit and complete split atomically, without transferring schedules', async () => {
  const { maintainPureCues } = await import('../server/db/pure-cue-maintenance.ts');
  const { createHostedOperationsSchema } = await import('../server/db/hosted-operations.ts');
  createHostedOperationsSchema();
  const base = draft('maintenance-shared', 'a', 'general', 'pure_cue');
  const body = { prompt: 'Original cue', stimulus: { kind: 'direct_text', text: 'Original cue' },
    reveal: { axisNote: 'Old axis', teachingNote: 'Keep this note' } };
  const shared = createVocabularyContent({ ...base, body, words: [{ wordId: 'a', relation: 'target' }, { wordId: 'b', relation: 'target' }],
    answers: [{ wordId: 'a', acceptedForms: ['甲'] }, { wordId: 'b', acceptedForms: ['乙'] }] }, actor);
  const edit = createVocabularyContent({ ...base, contentId: 'maintenance-edit', body }, actor);
  const sense = createVocabularySense({ wordId: 'b', description: { label: 'Sense B' } }, actor);
  sql.prepare(`INSERT INTO learner_pure_cue_schedules(learner_id,content_id,next_eligible_at,policy_version,scheduler_state_json)
    VALUES ('alice',?,?,'test','{}')`).run(shared.contentId, at);
  const schedule = sql.prepare('SELECT * FROM learner_pure_cue_schedules WHERE content_id=?').get(shared.contentId);
  const manifest = { rationale: 'Reviewed cue maintenance', changes: [
    { contentId: edit.contentId, expectedVersion: 1, rationale: 'Tighten axis', edit: { axis: 'New axis' } },
    { contentId: shared.contentId, expectedVersion: 1, rationale: 'Separate distinct uses', split: [
      { wordId: 'a', stimulus: 'A separate cue for the first use', teachingNote: 'Explain the first use' },
      { wordId: 'b', senseId: sense.senseId, stimulus: 'A separate cue for the second use', teachingNote: 'Explain the second use' },
    ] },
  ] };
  const preview = maintainPureCues(manifest, actor.id);
  assert.equal(preview.status, 'preview');
  assert.equal(sql.prepare('SELECT COUNT(*) n FROM content_proposals').get()?.n, 0);
  assert.throws(() => maintainPureCues(manifest, actor.id, preview.digest), /maintenance mode/);
  sql.exec("UPDATE service_controls SET enabled=(control_key='maintenance_mode')");
  assert.throws(() => maintainPureCues({ ...manifest, rationale: 'Changed' }, actor.id, preview.digest), /plan changed/);

  const pending = createVocabularyProposal({ rationale: 'Pending work', operations: [{
    strategy: 'update_existing', operationKey: 'pending', scope: { kind: 'shared' }, rationale: 'Another edit',
    sourceContentId: edit.contentId, expectedVersion: 1, content: edit,
  }] }, actor.id);
  assert.throws(() => maintainPureCues(manifest, actor.id, preview.digest), /plan changed/);
  approveVocabularyProposal(pending.proposalId, pending.version, actor.id);
  assert.throws(() => maintainPureCues(manifest, actor.id), /Approval already recorded/);
  closeVocabularyProposal(pending.proposalId, pending.version, actor.id);
  const overlapping = createVocabularyProposal({ rationale: pending.rationale, operations: pending.operations }, actor.id);
  const refreshed = maintainPureCues(manifest, actor.id);
  if (refreshed.status !== 'preview') assert.fail('Expected preview');
  assert.equal(refreshed.overlaps[0]?.proposalId, overlapping.proposalId);

  // Fail a late write, after the cue update, retirement and new exercise have executed.
  sql.exec("CREATE TRIGGER refuse_receipt BEFORE INSERT ON proposal_applications BEGIN SELECT RAISE(ABORT,'receipt failed'); END");
  assert.throws(() => maintainPureCues(manifest, actor.id, refreshed.digest), /receipt failed/);
  assert.deepEqual(getVocabularyContentForMaintenance(edit.contentId), edit);
  assert.deepEqual(getVocabularyContentForMaintenance(shared.contentId), shared);
  assert.equal(sql.prepare('SELECT COUNT(*) n FROM content_proposals').get()?.n, 2);
  sql.exec('DROP TRIGGER refuse_receipt');

  const result = maintainPureCues(manifest, actor.id, refreshed.digest);
  if (result.status !== 'applied') assert.fail('Expected receipt');
  assert.deepEqual(result.receipt.changes.map(change => change.strategy), ['update_existing', 'retire', 'create', 'create']);
  const updated = getVocabularyContentForMaintenance(edit.contentId)!;
  assert.deepEqual(updated.body, { ...body, reveal: { ...body.reveal, axisNote: 'New axis' } });
  const retired = getVocabularyContentForMaintenance(shared.contentId)!;
  assert.equal(retired.availability, 'retired');
  assert.deepEqual(retired.body, shared.body);
  assert.deepEqual(sql.prepare('SELECT * FROM learner_pure_cue_schedules WHERE content_id=?').get(shared.contentId), schedule);
  const created = getVocabularyContentForMaintenance(result.receipt.changes[3]!.resultContentId);
  assert.equal(created?.words[0]?.senseId, sense.senseId);
  assert.equal(created?.kind, 'exercise');
  assert.deepEqual(created.answers, [{ wordId: 'b', acceptedForms: ['乙'] }]);
  assert.equal(getVocabularyProposal(overlapping.proposalId, actor.id).status, 'awaiting_review');
  assert.throws(() => previewVocabularyProposal(overlapping.proposalId, overlapping.version, actor.id), /base changed/);
  assert.throws(() => maintainPureCues(manifest, actor.id, refreshed.digest), /already applied/);
  assert.deepEqual(sql.prepare('PRAGMA foreign_key_check').all(), []);
});
