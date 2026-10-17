import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, test } from 'node:test';
import type { VocabularyActor, VocabularyContentDraft } from '../src/domain/vocabulary-content.ts';
import { setDb } from '../server/db/connection.ts';
import { runWithLearnerId } from '../server/db/learner-context.ts';
import { createVocabularyContent, updateVocabularyContent, replaceVocabularyContent, getVocabularyContent,
  getVocabularyContentForMaintenance, getVocabularyContentVersion, listVocabularyExercises,
  getVocabularyTeachingExercises, createVocabularySense, updateVocabularySense, getVocabularySenses,
  getVocabularySenseCatalog, establishVocabularySenseCatalog, mapVocabularyContentSense, curateVocabularyContent,
  emitBackendEvent } from '../server/db/vocabulary-content.ts';

const actor: VocabularyActor = { kind: 'operator', id: 'editor', reason: { text: 'reviewed correction' } };
let db: DatabaseSync;
let previousAuth: string | undefined;
let previousMode: string | undefined;
let previousDataDir: string | undefined;
beforeEach(() => {
  previousAuth = process.env.APP_AUTH_MODE;
  previousMode = process.env.APP_MODE;
  previousDataDir = process.env.APP_DATA_DIR;
  process.env.APP_DATA_DIR = '/tmp/vocabulary-content-test';
  process.env.APP_MODE = 'study';
  process.env.APP_AUTH_MODE = 'clerk';
  db = new DatabaseSync(':memory:');
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE learners(learner_id TEXT PRIMARY KEY);
    CREATE TABLE lexical_words(id TEXT PRIMARY KEY);
    INSERT INTO learners VALUES ('a'),('b');
    INSERT INTO lexical_words VALUES ('w1'),('w2'),('w3');`);
  db.exec(fs.readFileSync(new URL('../server/db/migrations/0037_vocabulary_content.sql', import.meta.url),'utf8'));
  setDb(db);
});
afterEach(() => {
  db.close();
  if (previousDataDir === undefined) delete process.env.APP_DATA_DIR; else process.env.APP_DATA_DIR = previousDataDir;
  if (previousMode === undefined) delete process.env.APP_MODE; else process.env.APP_MODE = previousMode;
  if (previousAuth === undefined) delete process.env.APP_AUTH_MODE; else process.env.APP_AUTH_MODE = previousAuth;
});
function draft(contentId = 'exercise', overrides: Partial<VocabularyContentDraft> = {}): VocabularyContentDraft {
  return { contentId, kind: 'exercise', payloadVersion: 1, body: { prompt: 'A greeting', reveal: '你好' },
    exerciseType: 'definition', skill: 'production', exerciseRole: 'general', assessment: { responseMode: 'hanzi_entry' },
    accessScope: 'shared', availability: 'active', originKind: 'human', authorKind: 'operator', authorId: 'editor',
    words: [{ wordId: 'w1', relation: 'target' }], answers: [{ wordId: 'w1', acceptedForms: ['你好'] }], ...overrides } as VocabularyContentDraft;
}
function eventCount(): number { return (db.prepare('SELECT COUNT(*) AS n FROM backend_events').get() as { n: number }).n; }
function asA<T>(fn: () => T): T { return runWithLearnerId('a',fn); }

test('complete current and initial history agree; updates preserve identity and exact old answers', () => {
  const created = createVocabularyContent(draft(),actor);
  const snapshot = JSON.parse((db.prepare('SELECT snapshot_json FROM content_revision_history').get() as { snapshot_json: string }).snapshot_json);
  assert.deepEqual(snapshot,created);
  const updated = updateVocabularyContent(created.contentId,1,draft('exercise',{ body: { prompt: 'Hello' },
    answers: [{ wordId: 'w1', acceptedForms: ['您好'] }] }),actor);
  assert.equal(updated.version,2); assert.equal(updated.contentId,created.contentId);
  assert.deepEqual(asA(() => getVocabularyContentVersion('exercise',1))?.answers,[{ wordId: 'w1',acceptedForms: ['你好'] }]);
  assert.deepEqual(asA(() => getVocabularyContentVersion('exercise',2)),updated);
  assert.equal(updated.createdAt,created.createdAt);
  assert.throws(() => db.exec("UPDATE content_revision_history SET snapshot_json='{}'"),/immutable/);
  assert.throws(() => db.exec('DELETE FROM content_revision_history'),/retained/);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
});

test('stale writes and invalid relationship changes roll back authored state, history and events', () => {
  const initial = createVocabularyContent(draft(),actor);
  const count = eventCount();
  assert.throws(() => updateVocabularyContent('exercise',2,draft('exercise',{ body: 'stale' }),actor),/changed/);
  assert.throws(() => updateVocabularyContent('exercise',1,draft('exercise',{ words: [{ wordId: 'missing',relation: 'target' }],
    answers: [{ wordId: 'missing',acceptedForms: ['x'] }] }),actor),/FOREIGN KEY/);
  assert.deepEqual(getVocabularyContentForMaintenance('exercise'),initial);
  assert.equal(eventCount(),count);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM content_revision_history').get() as { n: number }).n,1);
  // A failed nested writer restores its savepoint while preserving the caller's transaction.
  db.exec('BEGIN');
  emitBackendEvent({ name: 'test.before',data: {} });
  assert.throws(() => updateVocabularyContent('exercise',1,draft('exercise',{ words: [{ wordId: 'missing',relation: 'target' }],
    answers: [{ wordId: 'missing',acceptedForms: ['x'] }] }),actor),/FOREIGN KEY/);
  assert.equal(db.isTransaction,true); db.exec('COMMIT');
  assert.equal(eventCount(),count+1);
});

test('replacement retires old identity and retains both histories; invalid replacement has no partial effect', () => {
  const initial = createVocabularyContent(draft(),actor);
  assert.throws(() => replaceVocabularyContent('exercise',1,draft('exercise'),actor),/new content identity/);
  assert.throws(() => replaceVocabularyContent('exercise',1,draft('private',{ accessScope: 'private',ownerLearnerId: 'a' }),actor),/ownership/);
  assert.equal(getVocabularyContentForMaintenance('private'),null);
  const result = replaceVocabularyContent('exercise',1,draft('successor',{ body: 'replacement' }),actor);
  assert.equal(result.previous.contentId,initial.contentId); assert.equal(result.previous.availability,'retired');
  assert.equal(result.previous.version,2); assert.equal(result.replacement.version,1);
  assert.equal(asA(() => getVocabularyContentVersion('exercise',1))?.availability,'active');
  assert.deepEqual(asA(() => listVocabularyExercises({ wordId: 'w1',mode: 'practice' })).map((item) => item.contentId),['successor']);
  assert.throws(() => replaceVocabularyContent('exercise',1,draft('third'),actor),/changed/);
  assert.equal(getVocabularyContentForMaintenance('third'),null);
});

test('learner reads require context and isolate private bodies, history and selection', () => {
  createVocabularyContent(draft('shared'),actor);
  createVocabularyContent(draft('private',{ accessScope: 'private',ownerLearnerId: 'a' }),actor);
  createVocabularyContent(draft('quarantined',{ availability: 'quarantined' }),actor);
  assert.throws(() => getVocabularyContent('private'),/Learner context/);
  assert.equal(asA(() => getVocabularyContent('private'))?.contentId,'private');
  assert.equal(runWithLearnerId('b',() => getVocabularyContent('private')),null);
  assert.equal(runWithLearnerId('b',() => getVocabularyContentVersion('private',1)),null);
  assert.deepEqual(runWithLearnerId('b',() => listVocabularyExercises({ wordId: 'w1',mode: 'practice' })).map((item) => item.contentId),['shared']);
  assert.throws(() => createVocabularyContent(draft('bad',{ accessScope: 'shared',ownerLearnerId: 'a' }),actor),/owner/);
});

test('sense mapping is a lasting independent relation with conflict checks and same-word SQL guards', () => {
  createVocabularyContent(draft(),actor);
  const sense = createVocabularySense({ senseId: 's1',wordId: 'w1',description: { label: 'greet' } },actor);
  createVocabularySense({ senseId: 's2',wordId: 'w2',description: 'other' },actor);
  assert.deepEqual(getVocabularySenseCatalog('w1'),{ wordId: 'w1',version: 1,establishedAt: null });
  const established = establishVocabularySenseCatalog('w1',1,actor);
  assert.ok(established.establishedAt); assert.equal(established.version,2);
  const mapping = { contentId: 'exercise',wordId: 'w1',expectedContentVersion: 1,
    expectedMapping: { senseId: null,establishedAt: null },senseId: 's1',establishedAt: '2026-10-17T00:00:00.000Z' };
  mapVocabularyContentSense(mapping,actor);
  const mapped = getVocabularyContentForMaintenance('exercise')!;
  assert.equal(mapped.version,1); assert.equal(mapped.words[0]!.senseId,'s1');
  assert.equal(asA(() => getVocabularyContentVersion('exercise',1))?.words[0]!.senseId,null);
  assert.throws(() => mapVocabularyContentSense(mapping,actor),/mapping changed/);
  const revisedSense = updateVocabularySense('s1',1,{ description: 'same sense, revised wording',status: 'active' },actor);
  assert.equal(revisedSense.version,2); assert.equal(getVocabularySenses('w1')[0]!.description,'same sense, revised wording');
  const updated = updateVocabularyContent('exercise',1,draft('exercise',{ body: 'edited prompt' }),actor);
  assert.equal(updated.words[0]!.senseId,sense.senseId);
  assert.throws(() => db.prepare('UPDATE content_words SET sense_id=? WHERE content_id=?').run('s2','exercise'),/FOREIGN KEY/);
  assert.throws(() => db.exec("UPDATE content_words SET sense_mapping_established_at=NULL WHERE sense_id IS NOT NULL"),/CHECK/);
  mapVocabularyContentSense({ ...mapping,expectedContentVersion: 2,
    expectedMapping: { senseId: 's1',establishedAt: mapping.establishedAt },senseId: null },actor);
  const noSingleSense = getVocabularyContentForMaintenance('exercise')!.words[0]!;
  assert.equal(noSingleSense.senseId,null); assert.ok(noSingleSense.senseMappingEstablishedAt);
  assert.equal(asA(() => listVocabularyExercises({ wordId: 'w1',mode: 'practice' })).length,1);
  assert.throws(() => db.exec('DELETE FROM sense_revision_history'),/retained/);
});

test('teaching is excluded from general selection; exact bindings survive edits and obey current eligibility', () => {
  const teaching = createVocabularyContent(draft('teaching',{ exerciseRole: 'teaching' }),actor);
  createVocabularyContent({ contentId: 'intro',kind: 'introduction',payloadVersion: 1,body: { explanation: 'hello' },
    accessScope: 'shared',availability: 'active',originKind: 'human',words: [{ wordId: 'w1',relation: 'target' }],
    teachingExercises: [{ exerciseId: teaching.contentId,exerciseVersion: 1 }] },actor);
  assert.deepEqual(asA(() => listVocabularyExercises({ wordId: 'w1',mode: 'solidify' })),[]);
  assert.throws(() => curateVocabularyContent({ contentId: 'teaching',expectedVersion: 1,mode: 'maintain',suitability: 'curated' },actor),/general exercise/);
  updateVocabularyContent('teaching',1,draft('teaching',{ exerciseRole: 'teaching',body: 'new text' }),actor);
  assert.equal(asA(() => getVocabularyTeachingExercises('intro'))[0]!.version,1);
  createVocabularySense({senseId: 'teaching-sense',wordId: 'w1',description: 'greeting'},actor);
  mapVocabularyContentSense({contentId: 'teaching',wordId: 'w1',expectedContentVersion: 2,
    expectedMapping: {senseId: null,establishedAt: null},senseId: 'teaching-sense'},actor);
  const fresh = asA(() => getVocabularyTeachingExercises('intro'))[0]!;
  assert.equal(fresh.version,1);assert.deepEqual(fresh.body,teaching.body);
  assert.equal(fresh.words[0]!.senseId,'teaching-sense');
  assert.equal(asA(() => getVocabularyContentVersion('teaching',1))!.words[0]!.senseId,null);

  updateVocabularyContent('teaching',2,draft('teaching',{ exerciseRole: 'teaching',availability: 'quarantined' }),actor);
  assert.deepEqual(asA(() => getVocabularyTeachingExercises('intro')),[]);
  assert.throws(() => updateVocabularyContent('teaching',3,draft('teaching'),actor),/serving role/);
});

test('maintain curation is version-specific and cannot silently survive authored changes', () => {
  createVocabularyContent(draft(),actor);
  assert.equal(asA(() => listVocabularyExercises({ wordId: 'w1',mode: 'maintain' })).length,0);
  curateVocabularyContent({ contentId: 'exercise',expectedVersion: 1,mode: 'maintain',suitability: 'curated' },actor);
  assert.equal(getVocabularyContentForMaintenance('exercise')!.version,1);
  curateVocabularyContent({ contentId: 'exercise',expectedVersion: 1,mode: 'maintain',suitability: 'candidate' },actor);
  assert.equal(asA(() => listVocabularyExercises({ wordId: 'w1',mode: 'maintain' })).length,0);
  curateVocabularyContent({ contentId: 'exercise',expectedVersion: 1,mode: 'maintain',suitability: 'curated' },actor);
  assert.equal(asA(() => listVocabularyExercises({ wordId: 'w1',mode: 'maintain' })).length,1);
  updateVocabularyContent('exercise',1,draft('exercise',{ body: 'edited' }),actor);
  assert.equal(asA(() => listVocabularyExercises({ wordId: 'w1',mode: 'maintain' })).length,0);
  assert.throws(() => curateVocabularyContent({ contentId: 'exercise',expectedVersion: 1,mode: 'maintain',suitability: 'curated' },actor),/changed/);
});

test('pure cues preserve multiple accepted targets independent of selection origin and context distractors', () => {
  const pure = createVocabularyContent(draft('pure',{ exerciseType: 'pure_cue',
    words: [{ wordId: 'w1',relation: 'target' },{ wordId: 'w2',relation: 'target' },{ wordId: 'w3',relation: 'context' }],
    answers: [{ wordId: 'w1',acceptedForms: ['你好'] },{ wordId: 'w2',acceptedForms: ['您好'] }] }),actor);
  const selected = asA(() => listVocabularyExercises({ wordId: 'w1',mode: 'practice' }))[0]!;
  assert.deepEqual(selected.answers,pure.answers);
  assert.deepEqual(asA(() => listVocabularyExercises({ wordId: 'w3',mode: 'practice' })),[]);
  assert.equal(asA(() => listVocabularyExercises({ wordId: 'w2',mode: 'practice' }))[0]!.contentId,pure.contentId);
  assert.throws(() => createVocabularyContent(draft('bad',{ answers: [{ wordId: 'w3',acceptedForms: ['x'] }] }),actor),/relationships/);
});

test('SQL subtype/access guards reject general or other-owner teaching bindings and introduction answers', () => {
  createVocabularyContent(draft('general'),actor);
  createVocabularyContent(draft('private-teaching',{ exerciseRole: 'teaching',accessScope: 'private',ownerLearnerId: 'a' }),actor);
  const intro = { contentId: 'intro',kind: 'introduction' as const,payloadVersion: 1,body: 'teaching',
    accessScope: 'shared' as const,availability: 'active' as const,originKind: 'human' as const,
    words: [{ wordId: 'w1',relation: 'target' as const }],teachingExercises: [] };
  createVocabularyContent(intro,actor);
  const count = eventCount();
  for (const id of ['general','private-teaching']) assert.throws(() => db.prepare(`INSERT INTO introduction_exercises
    VALUES ('intro',0,?,1)`).run(id),/accessible teaching/);
  assert.throws(() => db.prepare(`INSERT INTO exercise_answer_words VALUES ('intro','w1','["x"]')`).run(),/require an exercise/);
  assert.equal(eventCount(),count);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
});

test('durable mapping evidence failure rolls back the association; curation evidence is equally atomic', () => {
  createVocabularyContent(draft(),actor);
  createVocabularySense({ senseId: 'sense',wordId: 'w1',description: 'greeting' },actor);
  const before = getVocabularyContentForMaintenance('exercise');
  db.exec(`CREATE TRIGGER reject_vocabulary_event BEFORE INSERT ON backend_events
    WHEN NEW.name IN ('vocabulary.sense_mapping.established','vocabulary.content.curated')
    BEGIN SELECT RAISE(ABORT,'event storage unavailable'); END;`);
  assert.throws(() => mapVocabularyContentSense({ contentId: 'exercise',wordId: 'w1',expectedContentVersion: 1,
    expectedMapping: { senseId: null,establishedAt: null },senseId: 'sense' },actor),/event storage unavailable/);
  assert.deepEqual(getVocabularyContentForMaintenance('exercise'),before);
  assert.throws(() => curateVocabularyContent({ contentId: 'exercise',expectedVersion: 1,mode: 'maintain',suitability: 'curated' },actor),/event storage unavailable/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM content_mode_suitability').get()!.n,0);
});

test('catalog changes fence asynchronous mapping without invalidating lasting mapped identities', () => {
  createVocabularyContent(draft(),actor);
  const sense = createVocabularySense({ senseId: 'sense',wordId: 'w1',description: 'greeting' },actor);
  const capturedCatalog = getVocabularySenseCatalog('w1');
  updateVocabularySense(sense.senseId,1,{ description: 'revised greeting',status: 'active' },actor);
  assert.throws(() => mapVocabularyContentSense({ contentId: 'exercise',wordId: 'w1',expectedContentVersion: 1,
    expectedCatalogVersion: capturedCatalog.version,expectedMapping: { senseId: null,establishedAt: null },senseId: sense.senseId },actor),/catalog changed/);
  assert.equal(getVocabularyContentForMaintenance('exercise')!.words[0]!.senseId,null);
  assert.throws(() => updateVocabularyContent('exercise',1,draft('exercise',{ words: [{ wordId: 'w1',relation: 'target',senseId: 'sense',
    senseMappingEstablishedAt: '2026-10-17T00:00:00.000Z' }] }),actor),/explicit sense-mapping/);
});

test('history version chains and current version references fail closed beneath the writer', () => {
  createVocabularyContent(draft(),actor);
  assert.throws(() => db.prepare(`INSERT INTO content_revision_history(change_id,content_id,version,previous_version,snapshot_json,
    change_kind,write_strategy,actor_kind,actor_id,recorded_at) VALUES ('bad','exercise',3,NULL,'{}','updated','update_existing','operator','editor','now')`).run(),/CHECK/);
  db.exec('BEGIN');
  db.exec("UPDATE content_items SET version=2 WHERE content_id='exercise'");
  assert.throws(() => db.exec('COMMIT'),/FOREIGN KEY/);
  db.exec('ROLLBACK');
  assert.equal(getVocabularyContentForMaintenance('exercise')!.version,1);
});

test('contrast authoring validates choice identities and the single correct target atomically', () => {
  const contrast = draft('contrast', { exerciseType: 'contrast',skill: 'contextual_selection',
    body: { prompt: 'Choose',choices: [{ wordId: 'w1' },{ wordId: 'w2' }],reveal: { correctWordId: 'w1' } },
    assessment: { responseMode: 'word_choice',correctWordId: 'w1' },
    words: [{ wordId: 'w1',relation: 'target' },{ wordId: 'w2',relation: 'context' }] });
  const initial = createVocabularyContent(contrast,actor);
  assert.throws(() => createVocabularyContent({ ...contrast,contentId: 'bad-choice',body: { choices: [{ wordId: 'w1' },{ wordId: 'w3' }] } },actor),/relationships/);
  assert.throws(() => createVocabularyContent({ ...contrast,contentId: 'duplicate',body: { choices: [{ wordId: 'w1' },{ wordId: 'w1' }] } },actor),/distinct/);
  assert.throws(() => createVocabularyContent({ ...contrast,contentId: 'wrong-target',assessment: { responseMode: 'word_choice',correctWordId: 'w2' } },actor),/correct answer/);
  const events = eventCount();
  assert.throws(() => updateVocabularyContent('contrast',1,{ ...contrast,body: { choices: [{ wordId: 'w1' },{ wordId: 'w2' }],reveal: { correctWordId: 'w2' } } },actor),/reveal/);
  assert.deepEqual(getVocabularyContentForMaintenance('contrast'),initial);
  assert.equal(eventCount(),events);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM content_items').get() as {n:number}).n,1);
});
