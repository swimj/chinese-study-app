import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { beforeEach, afterEach, test } from 'node:test';
import { setDb } from '../server/db/connection.ts';
import { createVocabularyContent, getVocabularyContentForMaintenance, updateVocabularyContent } from '../server/db/vocabulary-content.ts';
import { prepareVocabularyPureCuePromotion } from '../server/vocabulary/pure-cue-promotion.ts';
import type { VocabularyContent, VocabularyContentDraft } from '../src/domain/vocabulary-content.ts';
import type { VocabularyReflectionJob } from '../src/domain/vocabulary-reflection.ts';

let db: DatabaseSync;
let original: VocabularyContent;
const actor = { kind: 'service' as const, id: 'fixture' };
const at = '2026-10-23T12:00:00.000Z';
const referral = { candidateWords: ['放大', '扩大'], sharedPurpose: 'Increase size or extent', rationale: 'These share a useful semantic axis.' };
beforeEach(() => {
  db = new DatabaseSync(':memory:'); setDb(db);
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE learners(learner_id TEXT PRIMARY KEY); INSERT INTO learners VALUES ('alice'),('bob');
    CREATE TABLE lexical_words(id TEXT PRIMARY KEY,hanzi TEXT,traditional TEXT,pinyin TEXT,meaning TEXT);
    INSERT INTO lexical_words VALUES ('target','放大',NULL,'fang4 da4','enlarge'),('other','扩大','擴大','kuo4 da4','expand'),('retained','增加',NULL,'zeng1 jia1','increase'),('outside','缩小',NULL,'suo1 xiao3','shrink');`);
  db.exec(readFileSync(new URL('../server/db/migrations/0039_vocabulary_content.sql', import.meta.url), 'utf8'));
  db.exec(readFileSync(new URL('../server/db/migrations/0062_vocabulary_sense_coverage.sql', import.meta.url), 'utf8'));
  db.exec(readFileSync(new URL('../server/db/migrations/0064_vocabulary_default_useful_senses.sql', import.meta.url), 'utf8'));
  original = createVocabularyContent({ contentId: 'source', kind: 'exercise', payloadVersion: 1,
    body: { prompt: 'Make this image larger.' }, exerciseType: 'word', skill: 'production', exerciseRole: 'general',
    assessment: { match: 'exact' }, answers: [{ wordId: 'target', acceptedForms: ['放大'] }],
    words: [{ wordId: 'target', relation: 'target' }], accessScope: 'shared', availability: 'active', originKind: 'human' }, actor);
});
afterEach(() => db.close());
function job(): VocabularyReflectionJob {
  return { jobId: 'job', caseId: 'case', learnerId: 'alice', kind: 'exercise_improvement', attemptNumber: 1,
    leaseToken: 'lease', leaseExpiresAt: at, evidence: { caseId: 'case', completionId: 'completion', learnerId: 'alice',
      kind: 'exercise_improvement', wordId: 'target', contentId: 'source', status: 'open', createdAt: at,
      evidence: [{ encounterId: 'encounter', wordId: 'target', workNumber: 1, presentedActionId: 'presented', presentedAt: at,
        mode: 'practice', snapshot: { contentId: 'source', contentVersion: 1, kind: 'production', role: 'general',
          body: { prompt: 'Make this image larger.' }, assessment: { acceptedAnswers: ['放大'] } },
        responses: [], effectiveResponses: [], feedback: [], effectiveFeedback: [], skipped: false, presentationUndone: false }] } };
}
function cue(contentId = 'cue', overrides: Partial<VocabularyContentDraft> = {}) {
  return createVocabularyContent({ ...original, contentId, exerciseType: 'pure_cue',
    body: { prompt: 'Increase the size or extent.', instruction: 'Keep this instruction.', stimulus: { kind: 'direct_text', text: 'Increase the size or extent.' }, reveal: { axisNote: 'Size or extent', teachingNote: 'Retain this.', example: 'Keep this example.' } },
    answers: [{ wordId: 'target', acceptedForms: ['放大', '放大一点'] }, { wordId: 'retained', acceptedForms: ['增加'] }],
    words: [{ wordId: 'target', relation: 'target' }, { wordId: 'retained', relation: 'target' }], ...overrides } as VocabularyContentDraft, actor);
}
function decision(overrides: Record<string, unknown> = {}) {
  return { decision: 'create', rationale: 'A useful common meaning.', existingContentId: null,
    prompt: 'Increase the size or extent.', semanticAxis: 'Size or extent', teachingNote: '放大 and 扩大 express making something larger; use the word that fits the object.', memberWordIds: ['target', 'other'], ...overrides };
}

test('create proposes a shared pure cue with exact lexical answers and provenance without writing content', () => {
  const prepared = prepareVocabularyPureCuePromotion(job(), original, referral);
  assert.equal(prepared.attention, null);
  const result = prepared.normalize(decision(), 'invocation');
  assert.equal(result.assessment.outcome, 'create'); assert.equal(result.assessment.invocationId, 'invocation');
  assert.deepEqual(result.bases, []);
  const operation = result.operations[0]!;
  assert.equal(operation.strategy, 'create'); assert.deepEqual(operation.scope, { kind: 'shared' });
  assert.equal(operation.content.accessScope, 'shared'); assert.equal(operation.content.exerciseType, 'pure_cue');
  if (operation.content.kind !== 'exercise') assert.fail('Expected exercise');
  assert.deepEqual(operation.content.answers, [{ wordId: 'target', acceptedForms: ['放大'] }, { wordId: 'other', acceptedForms: ['扩大', '擴大'] }]);
  assert.deepEqual((operation.content.body as { source: unknown }).source, { kind: 'vocabulary_pure_cue_promotion', assessedContentId: 'source', invocationId: 'invocation' });
  assert.deepEqual((operation.content.body as { reveal: unknown }).reveal, { axisNote: 'Size or extent', teachingNote: decision().teachingNote });
  assert.equal(db.prepare('SELECT count(*) n FROM content_items').get()!.n, 1);
});

test('reject records the assessment without operations and refuses a draft', () => {
  const prepared = prepareVocabularyPureCuePromotion(job(), original, referral);
  const rejected = decision({ decision: 'reject', prompt: null, semanticAxis: null, teachingNote: null, memberWordIds: [] });
  assert.deepEqual(prepared.normalize(rejected).operations, []);
  assert.equal(prepared.normalize(rejected).assessment.outcome, 'reject');
  assert.throws(() => prepared.normalize({ ...rejected, prompt: 'A draft' }), /rejection must not carry a draft/);
  assert.throws(() => prepared.normalize({ ...rejected, teachingNote: 'A draft' }), /rejection must not carry a draft/);
});

test('reuse references a matching existing cue with version basis and cannot add members or author text', () => {
  const existing = cue('matching', { answers: [{ wordId: 'target', acceptedForms: ['放大'] }, { wordId: 'other', acceptedForms: ['扩大'] }], words: [{ wordId: 'target', relation: 'target' }, { wordId: 'other', relation: 'target' }] });
  const prepared = prepareVocabularyPureCuePromotion(job(), original, referral);
  const reuse = decision({ decision: 'reuse', existingContentId: existing.contentId, prompt: null, semanticAxis: null, teachingNote: null });
  const result = prepared.normalize(reuse);
  assert.deepEqual(result.operations, []); assert.deepEqual(result.bases, [{ contentId: 'matching', expectedVersion: 1 }]);
  assert.throws(() => prepared.normalize({ ...reuse, prompt: 'Changed stimulus' }), /reuse cannot author text/);
  assert.throws(() => prepared.normalize({ ...reuse, teachingNote: 'A draft' }), /reuse cannot author text/);
  assert.throws(() => prepared.normalize({ ...reuse, memberWordIds: ['target', 'other', 'retained'] }), /members must include|reuse cannot/);
});

test('extension retains stimulus, axis, other reveal fields, membership and forms while updating teaching', () => {
  const existing = cue();
  const prepared = prepareVocabularyPureCuePromotion(job(), original, referral);
  const extend = decision({ decision: 'extend', existingContentId: 'cue', prompt: null, semanticAxis: null, teachingNote: 'Retain this. 放大, 增加 and 扩大 can express an increase; choose the word that fits the object.', memberWordIds: ['target', 'retained', 'other'] });
  const result = prepared.normalize(extend);
  const operation = result.operations[0]!;
  assert.equal(operation.strategy, 'update_existing'); assert.equal(operation.sourceContentId, 'cue'); assert.equal(operation.expectedVersion, 1);
  assert.deepEqual(operation.content.body, { ...(existing.body as object), reveal: { axisNote: 'Size or extent', teachingNote: extend.teachingNote, example: 'Keep this example.' } });
  if (operation.content.kind !== 'exercise' || existing.kind !== 'exercise') assert.fail('Expected exercises');
  for (const answer of existing.answers) assert.deepEqual(operation.content.answers.find(item => item.wordId === answer.wordId), answer);
  assert.deepEqual(operation.content.words.slice(0, 2), existing.words);
  assert.deepEqual(operation.content.answers[2], { wordId: 'other', acceptedForms: ['扩大', '擴大'] });
  assert.deepEqual(result.bases, [{ contentId: 'cue', expectedVersion: 1 }]);
  assert.deepEqual(getVocabularyContentForMaintenance('cue'), existing);
  assert.throws(() => prepared.normalize({ ...extend, memberWordIds: ['target', 'other'] }), /extension must preserve/);
  assert.throws(() => prepared.normalize({ ...extend, semanticAxis: 'A replacement axis' }), /extension must preserve/);
});

test('reuse cannot add a newly resolved referral member', () => {
  cue(); const prepared = prepareVocabularyPureCuePromotion(job(), original, referral);
  assert.throws(() => prepared.normalize(decision({ decision: 'reuse', existingContentId: 'cue', prompt: null, semanticAxis: null, teachingNote: null })), /reuse cannot author text or add members/);
});

for (const form of ['missing', '扩大']) test(`unresolved candidate ${form} requests operator attention`, () => {
  if (form === '扩大') db.exec("INSERT INTO lexical_words VALUES ('homograph','扩大',NULL,'another reading','another meaning')");
  const prepared = prepareVocabularyPureCuePromotion(job(), original, { ...referral, candidateWords: ['放大', form] });
  assert.equal(prepared.attention?.assessment.outcome, 'needs_operator');
  assert.deepEqual(prepared.attention?.operations, []); assert.deepEqual(prepared.input.existingCues, []);
});

test('source disambiguates its own exact identity and traditional referral forms resolve lexical IDs', () => {
  db.exec("INSERT INTO lexical_words VALUES ('target-homograph','放大',NULL,'another reading','another meaning')");
  const prepared = prepareVocabularyPureCuePromotion(job(), original, { ...referral, candidateWords: ['放大', '擴大'] });
  assert.equal(prepared.attention, null);
  assert.deepEqual(prepared.input.candidates.map(word => word.wordId), ['target', 'other']);
});

test('candidate lookup respects scope, owner, active availability and production general pure-cue type', () => {
  cue('shared'); cue('alice', { accessScope: 'private', ownerLearnerId: 'alice' }); cue('bob', { accessScope: 'private', ownerLearnerId: 'bob' });
  cue('retired', { availability: 'retired' }); cue('recognition', { skill: 'recognition' }); cue('word', { exerciseType: 'word' });
  assert.deepEqual(prepareVocabularyPureCuePromotion(job(), original, referral).contents.map(item => item.contentId), ['shared']);
  const privateSource = { ...original, accessScope: 'private' as const, ownerLearnerId: 'alice' };
  assert.deepEqual(prepareVocabularyPureCuePromotion(job(), privateSource, referral).contents.map(item => item.contentId), ['alice']);
  const result = prepareVocabularyPureCuePromotion(job(), privateSource, referral).normalize(decision());
  assert.equal(result.operations[0]!.content.accessScope, 'private'); assert.equal(result.operations[0]!.content.ownerLearnerId, 'alice');
  assert.deepEqual(result.operations[0]!.scope, { kind: 'learner', learnerId: 'alice' });
});

test('arbitrary content and member IDs, omitted target and duplicated members are blocked', () => {
  const prepared = prepareVocabularyPureCuePromotion(job(), original, referral);
  for (const overrides of [
    { memberWordIds: ['target', 'outside'] }, { memberWordIds: ['target', 'other', 'invented'] },
    { memberWordIds: ['other', 'retained'] }, { memberWordIds: ['target', 'other', 'other'] },
    { existingContentId: 'invented' }, { decision: 'reuse', existingContentId: 'source', prompt: null, semanticAxis: null },
  ]) assert.throws(() => prepared.normalize(decision(overrides)), /Invalid pure-cue promotion/);
  const input = job(); input.evidence.wordId = null;
  assert.throws(() => prepareVocabularyPureCuePromotion(input, original, referral), /requires a word target/);
});

test('create rejects accepted-answer leaks and copies of private learner reactions', () => {
  const input = job();
  input.evidence.evidence[0]!.feedback = [{ protocolVersion: 1, actionId: 'reaction', clientActionId: 'reaction', sequence: 1,
    occurredAt: at, kind: 'feedback', payload: { encounterId: 'encounter', feedback: 'comment', comment: 'My private learner experience' } }];
  const prepared = prepareVocabularyPureCuePromotion(input, original, referral);
  assert.throws(() => prepared.normalize(decision({ prompt: 'Use 擴大 in a sentence.' })), /exposes an accepted answer/);
  assert.throws(() => prepared.normalize(decision({ prompt: 'My private learner experience' })), /copies private learner evidence/);
  assert.throws(() => prepared.normalize(decision({ semanticAxis: 'My private learner experience' })), /copies private learner evidence/);
  assert.throws(() => prepared.normalize(decision({ teachingNote: 'My private learner experience' })), /copies private learner evidence/);
  cue();
  assert.throws(() => prepareVocabularyPureCuePromotion(input, original, referral).normalize(decision({ decision: 'extend', existingContentId: 'cue', prompt: null, semanticAxis: null, teachingNote: 'My private learner experience', memberWordIds: ['target', 'retained', 'other'] })), /copies private learner evidence/);
});

test('fence rejects existing candidate edits before publication', () => {
  const existing = cue(); const prepared = prepareVocabularyPureCuePromotion(job(), original, referral);
  prepared.fence();
  updateVocabularyContent('cue', existing.version, { ...existing, body: { prompt: 'A revised stimulus' } }, actor);
  assert.throws(() => prepared.fence(), /candidate changed during promotion/);
});

test('fence rejects changed lexical candidate identity', () => {
  const prepared = prepareVocabularyPureCuePromotion(job(), original, referral);
  db.prepare("UPDATE lexical_words SET pinyin='new reading' WHERE id='other'").run();
  assert.throws(() => prepared.fence(), /lexical identities changed/);
});

test('fence rejects changed source target lexical identity', () => {
  const prepared = prepareVocabularyPureCuePromotion(job(), original, referral);
  db.prepare("UPDATE lexical_words SET pinyin='new target reading' WHERE id='target'").run();
  assert.throws(() => prepared.fence(), /lexical identities changed/);
});

for (const teachingNote of [null, '', '   ', undefined]) test(`create and extend require nonempty teaching notes (${String(teachingNote)})`, () => {
  cue();
  const prepared = prepareVocabularyPureCuePromotion(job(), original, referral);
  assert.throws(() => prepared.normalize(decision({ teachingNote })), /require a teaching note/);
  assert.throws(() => prepared.normalize(decision({ decision: 'extend', existingContentId: 'cue', prompt: null, semanticAxis: null, teachingNote, memberWordIds: ['target', 'retained', 'other'] })), /require a teaching note/);
});
