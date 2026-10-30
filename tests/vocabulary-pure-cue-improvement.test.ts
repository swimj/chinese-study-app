import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { beforeEach, afterEach, test } from 'node:test';
import { setDb } from '../server/db/connection.ts';
import { createVocabularyContent, getVocabularyContentForMaintenance, updateVocabularyContent } from '../server/db/vocabulary-content.ts';
import { prepareVocabularyPureCueImprovement } from '../server/vocabulary/pure-cue-improvement.ts';
import type { VocabularyContent } from '../src/domain/vocabulary-content.ts';
import type { VocabularyReflectionJob, VocabularyReflectionResult } from '../src/domain/vocabulary-reflection.ts';
import type { VocabularySessionAction } from '../src/domain/vocabulary-session.ts';

let db: DatabaseSync;
let original: VocabularyContent;
let individual: VocabularyContent;
const actor = { kind: 'service' as const, id: 'fixture' };
const at = '2026-10-23T12:00:00.000Z';
const teachingNote = 'Use 放大, 增加 or 扩大 to describe increasing size or extent when the object permits it.';
beforeEach(() => {
  db = new DatabaseSync(':memory:'); setDb(db);
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE learners(learner_id TEXT PRIMARY KEY); INSERT INTO learners VALUES ('alice'),('bob');
    CREATE TABLE lexical_words(id TEXT PRIMARY KEY,hanzi TEXT,traditional TEXT,pinyin TEXT,meaning TEXT);
    INSERT INTO lexical_words VALUES ('target','放大',NULL,'fang4 da4','enlarge'),('other','扩大','擴大','kuo4 da4','expand'),('retained','增加',NULL,'zeng1 jia1','increase');`);
  db.exec(readFileSync(new URL('../server/db/migrations/0039_vocabulary_content.sql', import.meta.url), 'utf8'));
  db.exec(readFileSync(new URL('../server/db/migrations/0062_vocabulary_sense_coverage.sql', import.meta.url), 'utf8'));
  db.exec(readFileSync(new URL('../server/db/migrations/0064_vocabulary_default_useful_senses.sql', import.meta.url), 'utf8'));
  original = createVocabularyContent({ contentId: 'cue', kind: 'exercise', payloadVersion: 1,
    body: { prompt: 'Increase the size or extent.', instruction: 'Keep this instruction.', stimulus: { kind: 'direct_text', text: 'Increase the size or extent.' },
      reveal: { axisNote: 'Size or extent', teachingNote: 'Increasing size or extent.', example: 'Keep this example.' } },
    exerciseType: 'pure_cue', skill: 'production', exerciseRole: 'general', assessment: { match: 'exact' },
    answers: [{ wordId: 'target', acceptedForms: ['放大', '放大一点'] }, { wordId: 'retained', acceptedForms: ['增加'] }],
    words: [{ wordId: 'target', relation: 'target' }, { wordId: 'retained', relation: 'target' }], accessScope: 'shared', availability: 'active', originKind: 'human' }, actor);
  individual = createVocabularyContent({ ...original, contentId: 'individual', exerciseType: 'word', body: { prompt: 'Make the picture larger.' } }, actor);
});
afterEach(() => db.close());
function response(raw: string | null = '擴大', outcome: 'accepted' | 'rejected' = 'rejected'): Extract<VocabularySessionAction, { kind: 'response' }> {
  return { protocolVersion: 1, actionId: 'response', clientActionId: 'response', sequence: 1, occurredAt: at, kind: 'response', payload: { encounterId: 'encounter', response: raw, outcome } };
}
function job(raw: string | null = '擴大'): VocabularyReflectionJob {
  const submitted = response(raw);
  return { jobId: 'job', caseId: 'case', learnerId: 'alice', kind: 'exercise_improvement', attemptNumber: 1,
    leaseToken: 'lease', leaseExpiresAt: at, evidence: { caseId: 'case', completionId: 'completion', learnerId: 'alice',
      kind: 'exercise_improvement', wordId: null, contentId: 'cue', status: 'open', createdAt: at,
      evidence: [{ encounterId: 'encounter', wordId: null, workNumber: 1, presentedActionId: 'presented', presentedAt: at,
        mode: 'practice', snapshot: { contentId: 'cue', contentVersion: 1, kind: 'production', role: 'general',
          body: original.body, assessment: { acceptedAnswers: ['放大', '增加'] } },
        responses: [submitted], effectiveResponses: [submitted], feedback: [], effectiveFeedback: [], skipped: false, presentationUndone: false }] } };
}
function decision(overrides: Record<string, unknown> = {}) {
  return { diagnosis: 'The submitted word fits the shared size or extent task.', decision: 'extend', reason: null,
    addedWordIds: ['other'], prompt: null, teachingNote, ...overrides };
}
function improvement(value: VocabularyReflectionResult) {
  if (value.kind !== 'exercise_improvement') assert.fail('Expected exercise improvement');
  return value.result;
}

test('extends only the reviewed cue, preserving members, axis and stimulus with integrated reveal teaching', () => {
  const prepared = prepareVocabularyPureCueImprovement(job(), original);
  assert.deepEqual(prepared.input.responseCandidates.map(item => ({ raw: item.rawResponse, ids: item.words.map(word => word.wordId) })), [{ raw: '擴大', ids: ['other'] }]);
  const result = improvement(prepared.normalize(decision(), 'invocation'));
  assert.equal(result.invocationId, 'invocation');
  assert.equal(result.proposal?.invocationId, 'invocation');
  assert.deepEqual(result.proposal?.bases, [{ contentId: 'cue', expectedVersion: 1 }]);
  assert.equal(result.proposal?.operations.length, 1);
  const operation = result.proposal!.operations[0]!;
  assert.equal(operation.strategy, 'update_existing');
  assert.equal(operation.sourceContentId, 'cue'); assert.equal(operation.expectedVersion, 1);
  assert.deepEqual(operation.scope, { kind: 'shared' });
  if (operation.content.kind !== 'exercise' || original.kind !== 'exercise') assert.fail('Expected exercises');
  assert.deepEqual(operation.content.answers, [...original.answers, { wordId: 'other', acceptedForms: ['扩大', '擴大'] }]);
  assert.deepEqual(operation.content.words, [...original.words, { wordId: 'other', relation: 'target' }]);
  assert.deepEqual(operation.content.body, { ...(original.body as object), reveal: { axisNote: 'Size or extent', teachingNote, example: 'Keep this example.' } });
  assert.deepEqual(getVocabularyContentForMaintenance('cue'), original);
  assert.deepEqual(getVocabularyContentForMaintenance('individual'), individual);
});

test('repair changes only the stimulus and retains every answer and reveal field', () => {
  const result = improvement(prepareVocabularyPureCueImprovement(job(), original).normalize(decision({ decision: 'repair', addedWordIds: [], prompt: 'Make the size or extent greater.', teachingNote: null })));
  const content = result.proposal!.operations[0]!.content;
  assert.deepEqual(content, { ...Object.fromEntries(Object.entries(original).filter(([key]) => !['version', 'createdAt', 'updatedAt'].includes(key))),
    body: { ...(original.body as object), prompt: 'Make the size or extent greater.', stimulus: { kind: 'direct_text', text: 'Make the size or extent greater.' } } });
  assert.throws(() => prepareVocabularyPureCueImprovement(job(), original).normalize(decision({ decision: 'repair', addedWordIds: [], prompt: 'Use 放大.', teachingNote: null })), /stimulus repair must preserve|exposes an accepted answer/);
  for (const overrides of [{ addedWordIds: ['other'] }, { teachingNote: 'A replacement lesson' }]) {
    assert.throws(() => prepareVocabularyPureCueImprovement(job(), original).normalize(decision({ decision: 'repair', addedWordIds: [], prompt: 'Make it larger.', teachingNote: null, ...overrides })), /stimulus repair must preserve membership and teaching/);
  }
});

test('explanation-only has a diagnosis and no draft, and rejects draft-bearing output', () => {
  const prepared = prepareVocabularyPureCueImprovement(job(), original);
  const explanation = decision({ decision: 'explanation_only', reason: 'uncertain', addedWordIds: [], teachingNote: null });
  assert.deepEqual(improvement(prepared.normalize(explanation)), { diagnosis: { decision: 'explanation_only', reason: 'uncertain', assessment: explanation.diagnosis }, proposal: null });
  for (const overrides of [{ reason: null }, { addedWordIds: ['other'] }, { prompt: 'A draft' }, { teachingNote: 'A draft' }]) {
    assert.throws(() => prepared.normalize({ ...explanation, ...overrides }), /cannot carry a draft/);
  }
});

test('unknown and ambiguous response text stays available for judgment without becoming eligible membership', () => {
  db.exec("INSERT INTO lexical_words VALUES ('homograph','扩大',NULL,'another reading','another meaning')");
  for (const raw of ['unknown response', '扩大', '扩大 the image']) {
    const prepared = prepareVocabularyPureCueImprovement(job(raw), original);
    assert.equal(prepared.input.responseCandidates[0]!.rawResponse, raw);
    assert.equal(prepared.input.responseCandidates[0]!.words.length, raw === '扩大' ? 2 : 0);
    assert.throws(() => prepared.normalize(decision()), /requires new unambiguous submitted words/);
  }
});

test('lexical lookup trims surrounding whitespace while preserving the actual submitted evidence', () => {
  const prepared=prepareVocabularyPureCueImprovement(job('  擴大  '),original);
  assert.equal(prepared.input.responseCandidates[0]!.rawResponse,'  擴大  ');
  assert.deepEqual(prepared.input.responseCandidates[0]!.words.map(word=>word.wordId),['other']);
  assert.equal(improvement(prepared.normalize(decision())).proposal!.operations.length,1);
});

test('accepted, undone, ineffective and empty responses cannot authorize extension', () => {
  for (const condition of ['accepted', 'undone', 'ineffective', 'empty'] as const) {
    const input = job(condition === 'empty' ? null : '扩大');
    const encounter = input.evidence.evidence[0]!;
    if (condition === 'accepted') encounter.effectiveResponses = [response('扩大', 'accepted')];
    if (condition === 'undone') encounter.presentationUndone = true;
    if (condition === 'ineffective') encounter.effectiveResponses = [];
    const prepared = prepareVocabularyPureCueImprovement(input, original);
    assert.deepEqual(prepared.input.responseCandidates, []);
    assert.throws(() => prepared.normalize(decision()), /requires new unambiguous submitted words/);
    assert.equal(encounter.responses.length, 1);
  }
});

test('extension requires a new submitted member and a nonempty note, and cannot edit stimulus', () => {
  const prepared = prepareVocabularyPureCueImprovement(job(), original);
  for (const overrides of [{ addedWordIds: [] }, { addedWordIds: ['target'] }, { addedWordIds: ['invented'] }, { addedWordIds: ['other', 'other'] }, { teachingNote: null }, { teachingNote: '   ' }, { prompt: 'A new prompt' }]) {
    assert.throws(() => prepared.normalize(decision(overrides)), /requires new unambiguous submitted words|duplicate members/);
  }
});

test('strict schema excludes word exercise reconciliation and other authored fields', () => {
  const prepared = prepareVocabularyPureCueImprovement(job(), original);
  for (const extra of [{ wordReconciliation: [] }, { operations: [] }, { semanticAxis: 'A replacement axis' }, { memberWordIds: ['other'] }]) {
    assert.throws(() => prepared.normalize(decision(extra)), /strict output schema/);
  }
});

test('shared authored text cannot copy private learner evidence', () => {
  const input = job();
  input.evidence.evidence[0]!.feedback = [{ protocolVersion: 1, actionId: 'reaction', clientActionId: 'reaction', sequence: 2, occurredAt: at, kind: 'feedback', payload: { encounterId: 'encounter', feedback: 'comment', comment: 'My private learner experience' } }];
  const prepared = prepareVocabularyPureCueImprovement(input, original);
  assert.throws(() => prepared.normalize(decision({ teachingNote: 'My private learner experience' })), /cannot copy private learner evidence/);
  assert.throws(() => prepared.normalize(decision({ decision: 'repair', addedWordIds: [], teachingNote: null, prompt: 'My private learner experience' })), /cannot copy private learner evidence/);
});

test('private scope remains owned by the source learner and rejects a different learner', () => {
  const privateCue = createVocabularyContent({ ...original, contentId: 'private-cue', accessScope: 'private', ownerLearnerId: 'alice' }, actor);
  const operation = improvement(prepareVocabularyPureCueImprovement(job(), privateCue).normalize(decision())).proposal!.operations[0]!;
  assert.deepEqual(operation.scope, { kind: 'learner', learnerId: 'alice' });
  assert.equal(operation.content.accessScope, 'private'); assert.equal(operation.content.ownerLearnerId, 'alice');
  assert.throws(() => prepareVocabularyPureCueImprovement({ ...job(), learnerId: 'bob' }, privateCue), /source access mismatch/);
});

test('fence rejects changes to the cue, accepted member identities and submitted lexical resolution', () => {
  const prepared = prepareVocabularyPureCueImprovement(job(), original);
  prepared.fence();
  db.prepare("UPDATE lexical_words SET pinyin='changed' WHERE id='target'").run();
  assert.throws(prepared.fence, /lexical evidence changed/);
  db.prepare("UPDATE lexical_words SET pinyin='fang4 da4' WHERE id='target'").run();
  prepared.fence();
  db.exec("INSERT INTO lexical_words VALUES ('homograph','擴大',NULL,'another reading','another meaning')");
  assert.throws(prepared.fence, /lexical evidence changed/);
  db.prepare("DELETE FROM lexical_words WHERE id='homograph'").run();
  prepared.fence();
  updateVocabularyContent('cue', original.version, { ...original, body: { prompt: 'A revised stimulus.' } }, actor);
  assert.throws(prepared.fence, /source changed/);
});

test('repair preserves banked no-op and surrounding-whitespace rejection cases', () => {
  const normalize = (prompt: string) => prepareVocabularyPureCueImprovement(job(), original).normalize(
    decision({ decision: 'repair', addedWordIds: [], prompt, teachingNote: null }));
  assert.throws(() => normalize('Increase the size or extent.'), /stimulus must change/);
  for (const prompt of [' Make it larger.', 'Make it larger. ', '\nMake it larger.']) {
    assert.throws(() => normalize(prompt), /trim surrounding whitespace/);
  }
});

test('operator reassessment excludes historical candidate responses and fences by source version',()=>{
  const prepared=prepareVocabularyPureCueImprovement({...job(),reassessmentSourceJobId:'previous',reassessmentSource:original},original);
  assert.deepEqual(prepared.input.responseCandidates,[]);
  prepared.fence();
  updateVocabularyContent('cue',original.version,{...original,body:{prompt:'Updated task.'}},actor);
  assert.throws(()=>prepared.fence(),error=>error instanceof Error&&error.constructor.name==='VocabularyReflectionConflict');
});
