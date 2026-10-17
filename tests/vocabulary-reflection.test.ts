import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { beforeEach, afterEach, test } from 'node:test';
import { setDb } from '../server/db/connection.ts';
import { runWithLearnerId } from '../server/db/learner-context.ts';
import { requestVocabularyRefresh } from '../server/db/vocabulary-learners.ts';
import { createVocabularyContent, getVocabularyContentForMaintenance, updateVocabularyContent } from '../server/db/vocabulary-content.ts';
import { createVocabularySession, appendVocabularySessionActions, stageVocabularySessionCompletion, closeVocabularySessionCompletion } from '../server/db/vocabulary-sessions.ts';
import { ingestVocabularySessionEvidence, getVocabularyReflectionCase, listVocabularyReflectionCases,
  claimVocabularyReflectionJob, recoverVocabularyReflectionJobs, failVocabularyReflectionJob, retryOwnVocabularyFeedback,
  recordVocabularyFeedbackJudgment, recordVocabularyImprovementResult, listOwnVocabularyMessages, markOwnVocabularyMessageSeen,
  createVocabularyProposal, saveVocabularyProposal, approveVocabularyProposal, applyVocabularyProposal,
  previewVocabularyProposal, getVocabularyProposal, closeVocabularyTeachingCase } from '../server/db/vocabulary-reflection.ts';
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
    CREATE TABLE lexical_words(id TEXT PRIMARY KEY); CREATE TABLE model_invocations(id TEXT PRIMARY KEY);
    INSERT INTO learners VALUES ('alice',NULL),('bob',NULL); INSERT INTO lexical_words VALUES ('a'),('b'),('new');`);
  sql.exec(fs.readFileSync(new URL('../server/db/migrations/0037_vocabulary_content.sql',import.meta.url),'utf8'));
  sql.exec(fs.readFileSync(new URL('../server/db/migrations/0039_vocabulary_learner_state.sql',import.meta.url),'utf8').split('-- Do not use the words view')[0]!);
  sql.exec(fs.readFileSync(new URL('../server/db/migrations/0045_vocabulary_dismissal.sql',import.meta.url),'utf8'));
  sql.exec(`CREATE TABLE learner_settings(learner_id TEXT,setting_key TEXT,value_json TEXT,updated_at TEXT,PRIMARY KEY(learner_id,setting_key));
    CREATE TABLE learner_owned_word_skill_state(learner_id TEXT,word_id TEXT,skill_id TEXT,enabled INTEGER,
      interval_hours REAL,last_studied_at TEXT,next_due_at TEXT,ease_factor REAL,PRIMARY KEY(learner_id,word_id,skill_id));
    CREATE TABLE learner_owned_review_session_summaries(learner_id TEXT,session_id TEXT,PRIMARY KEY(learner_id,session_id));`);
  sql.exec("ALTER TABLE lexical_words ADD COLUMN hanzi TEXT NOT NULL DEFAULT '字';ALTER TABLE lexical_words ADD COLUMN pinyin TEXT NOT NULL DEFAULT 'zì';");

  sql.exec(fs.readFileSync(new URL('../server/db/migrations/0040_vocabulary_sessions.sql',import.meta.url),'utf8'));
  sql.exec(fs.readFileSync(new URL('../server/db/migrations/0042_vocabulary_reflection.sql',import.meta.url),'utf8'));
  sql.exec(`INSERT INTO learner_words(learner_id,word_id,in_stash,added_at,mode,mode_changed_at) VALUES
    ('alice','a',1,'2026-01-01','practice','2026-01-01'),('alice','b',1,'2026-01-01','practice','2026-01-01'),
    ('alice','new',1,'2026-01-01','unstudied','2026-01-01');
    INSERT INTO learner_word_schedules(learner_id,word_id,next_eligible_at,policy_version,scheduler_state_json)
    SELECT learner_id,word_id,'2026-10-20T10:00:00.000Z','test','{"intervalHours":24,"easeFactor":2.5,"enabled":1,"cleanCoveredSessions":0}' FROM learner_words;`);
  for(const name of ['0023_session_debrief.sql','0046_vocabulary_connections.sql'])sql.exec(fs.readFileSync(new URL(`../server/db/migrations/${name}`,import.meta.url),'utf8'));
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
    { kind: 'mode_change',payload: { wordId: 'a',mode: 'maintain' } }]);
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

test('pure cue feedback has no invented word target and compensates only its independent schedule', () => {
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
  closeVocabularyTeachingCase(teaching.caseId,'editor','Reviewed alongside exact introduction');
  assert.equal(listVocabularyReflectionCases('teaching_review','editor').length,0);
  const privateContent = createVocabularyContent({ ...draft('private'),accessScope: 'private',ownerLearnerId: 'alice' },actor);
  assert.throws(() => createVocabularyProposal({ operations: [{ ...op('replace',privateContent.contentId,'leak'),content: draft('leak') }],rationale: 'Wrong scope' },'editor'),/ownership/);

});

test('mixed true and unfair rejections keep current conservative schedule and explicit refresh', () => {
  ingest([present('one'),response('one'),present('two'),response('two')]);
  const feedback=claimVocabularyReflectionJob({kind:'learner_feedback',now:judgedAt})!;
  sql.prepare("UPDATE learner_word_schedules SET next_eligible_at='2026-10-20T10:00:00.000Z',refresh_requested_at=?,refresh_until='2026-10-20T10:00:00.000Z' WHERE word_id='a'").run(judgedAt);
  const before=sql.prepare("SELECT * FROM learner_word_schedules WHERE word_id='a'").get();
  recordVocabularyFeedbackJudgment(feedback.jobId,feedback.leaseToken,{diagnosis:'One real lapse remains',message:'One alternate fit, the other did not.',unfairEncounterIds:['one']},judgedAt);
  assert.deepEqual(sql.prepare("SELECT * FROM learner_word_schedules WHERE word_id='a'").get(),before);
  assert.equal(Number(sql.prepare('SELECT count(*) n FROM learner_state_effects WHERE judgment_id IS NOT NULL').get()!.n),0);
});

for (const skill of ['recognition','contextual_selection'] as const) {
  test(`unfair ${skill} feedback cannot change production eligibility`, () => {
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
    ingest([present(skill),rejected]);
    const productionBefore = sql.prepare("SELECT * FROM learner_word_schedules WHERE learner_id='alice' AND word_id='a'").get();
    const skillBefore = sql.prepare('SELECT * FROM learner_owned_word_skill_state WHERE learner_id=? AND word_id=? AND skill_id=?').get('alice','a',skill);
    assert.ok(skillBefore);
    const feedback = claimVocabularyReflectionJob({ kind: 'learner_feedback',now: judgedAt })!;
    recordVocabularyFeedbackJudgment(feedback.jobId,feedback.leaseToken,{ diagnosis: 'Unfair assessment',message: 'Retained lesson',unfairEncounterIds: [skill] },judgedAt);
    assert.deepEqual(sql.prepare("SELECT * FROM learner_word_schedules WHERE learner_id='alice' AND word_id='a'").get(),productionBefore);
    assert.deepEqual(sql.prepare('SELECT * FROM learner_owned_word_skill_state WHERE learner_id=? AND word_id=? AND skill_id=?').get('alice','a',skill),skillBefore);
    assert.equal(sql.prepare('SELECT count(*) n FROM learner_state_effects WHERE judgment_id IS NOT NULL').get()!.n,0);
    assert.equal(alice(listOwnVocabularyMessages).length,1);
  });
}

test('a genuine recognition lapse does not veto compensation for an unfair production rejection', () => {
  const base = draft('recognition');
  if (base.kind !== 'exercise') throw new Error('Expected exercise fixture');
  contents.recognition = createVocabularyContent({ ...base,skill: 'recognition',exerciseType: 'recognition',
    assessment: { responseMode: 'self_assessment' } },actor);
  ingest([present('one'),response('one'),present('recognition'),
    { kind: 'response',payload: { encounterId: 'recognition',response: null,outcome: 'rejected',selfAssessment: 'rejected' } }]);
  const recognitionBefore = sql.prepare("SELECT * FROM learner_owned_word_skill_state WHERE skill_id='recognition'").get();
  const feedback = claimVocabularyReflectionJob({ kind: 'learner_feedback',now: judgedAt })!;
  recordVocabularyFeedbackJudgment(feedback.jobId,feedback.leaseToken,{ diagnosis: 'The cue was unfair; pronunciation needs work',
    message: 'Separate learning signals',unfairEncounterIds: ['one'] },judgedAt);
  assert.equal(sql.prepare("SELECT next_eligible_at FROM learner_word_schedules WHERE word_id='a'").get()!.next_eligible_at,'2026-10-21T10:00:00.000Z');
  assert.deepEqual(sql.prepare("SELECT * FROM learner_owned_word_skill_state WHERE skill_id='recognition'").get(),recognitionBefore);
});

test('a delayed unfair judgment preserves an explicitly requested active refresh', () => {
  ingest([present('one'),response('one'),{ kind: 'mode_change',payload: { wordId: 'a',mode: 'maintain' } }]);
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
