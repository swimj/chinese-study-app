import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, before, test } from 'node:test';
import { pathToFileURL } from 'node:url';
import type { TeachingPackage, WordContentDocument } from '../src/domain/word-content/types.ts';
let db: typeof import('../server/db.ts');
let sql: DatabaseSync;
let dir: string;
const content: WordContentDocument = {
  schemaVersion: 1,
  id: 'quality-source',
  word: {
    wordId: 'quality-word',
    hanzi: '你好',
    traditional: null,
    pinyin: 'nǐ hǎo'
  },
  uses: [{
      id: 'u',
      label: 'hello',
      notes: ['Say hello'],
      exampleIds: ['e']
    }],
  examples: [{
      id: 'e',
      text: '你好！',
      translation: 'Hello!',
      pronunciation: 'nǐ hǎo'
    }]
};

const teaching: TeachingPackage = {
  schemaVersion: 1,
  id: 'quality-package',
  wordContentId: content.id,
  beats: [{ id: 'b', parts: [{ kind: 'text', text: 'Say hello' }] }],
  rehearsals: [{
      id: 'r',
      responseMode: 'hanzi_entry',
      contract: { kind: 'target_rehearsal', wordId: 'quality-word' },
      instruction: 'Greeting',
      stimulus: { kind: 'direct_text', text: 'Hello' },
      acceptedAnswers: [{
          wordId: 'quality-word',
          hanzi: '你好',
          traditional: null
        }]
    }]
};

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quality-'));
  const previous = { ...process.env };
  process.env.APP_MODE = 'study';
  process.env.APP_AUTH_MODE = 'clerk';
  process.env.APP_DATA_DIR = dir;
  try {
    db = await import(`${pathToFileURL(path.resolve('server/db.ts')).href}?quality=${Date.now()}`);
  } finally {
    for (const key of ['APP_MODE', 'APP_AUTH_MODE', 'APP_DATA_DIR']) {
      if (previous[key] === undefined) {
        delete process.env[key];
      }
      else {
        process.env[key] = previous[key];
      }
    }
  }
  db.bootstrapLearner({ learnerId: 'qa' });
  db.bootstrapLearner({ learnerId: 'qb' });
  sql = new DatabaseSync(path.join(dir, 'app.db'));
  sql.function('current_learner_id', () => 'qa');
  sql.exec('PRAGMA foreign_keys=ON');
  sql.prepare(`INSERT INTO lexical_words (id,hanzi,traditional,pinyin,meaning,meanings_json,examples_json,priority,created_at) VALUES ('quality-word','你好',NULL,'nǐ hǎo','hello','["hello"]','[]',10,?)`).run(new Date().toISOString());
  sql.prepare(`INSERT INTO lexical_words (id,hanzi,traditional,pinyin,meaning,meanings_json,examples_json,priority,created_at) VALUES ('quality-word-2','您好',NULL,'nín hǎo','hello','["hello"]','[]',10,?)`).run(new Date().toISOString());
  sql.prepare(`INSERT INTO lexical_word_meanings (id,word_id,position,text,created_at,updated_at) VALUES ('qm','quality-word',0,'hello',?,?)`).run(new Date().toISOString(), new Date().toISOString());
  db.runWithLearnerId('qa', () => {
    db.saveWordContentDocument(content, 'test-model');
    db.saveWordTeachingPackage(teaching, 'test-model');
  });
});
after(() => {
  sql?.close();
  if (dir) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
const target = { kind: 'teaching_package', packageId: 'quality-package' } as const;
test('standing votes persist across idempotent encounters and stay learner scoped', () => {
  assert.throws(() => db.recordContentQualityEncounter(target, 'e'), /Learner context/);
  const state = db.runWithLearnerId('qa', () => db.recordContentQualityEncounter(target, 'a1'));
  db.runWithLearnerId('qa', () => db.recordContentQualityEncounter(target, 'a1'));
  db.runWithLearnerId('qa', () => db.setContentQualityRating(state.contentKey, 'up'));
  assert.equal(db.runWithLearnerId('qa', () => db.recordContentQualityEncounter(target, 'a2')).rating, 'up');
  assert.throws(() => db.runWithLearnerId('qb', () => db.setContentQualityRating(state.contentKey, 'down')), /not been encountered/);
  assert.equal(db.runWithLearnerId('qb', () => db.recordContentQualityEncounter(target, 'b1')).rating, null);
  db.runWithLearnerId('qb', () => db.setContentQualityRating(state.contentKey, 'down'));
  let stats = db.getContentQualityAnalytics();
  assert.deepEqual(stats.totals, {
    exposures: 3,
    learnerContentPairs: 2,
    up: 1,
    down: 1,
    ratedLearners: 2,
    coverage: 1
  });
  db.runWithLearnerId('qa', () => db.setContentQualityRating(state.contentKey, 'down'));
  assert.equal(db.getContentQualityAnalytics().totals.down, 2);
  db.runWithLearnerId('qa', () => db.setContentQualityRating(state.contentKey, null));
  stats = db.getContentQualityAnalytics();
  assert.equal(stats.totals.coverage, 0.5);
  assert.equal(stats.totals.down, 1);
  assert.equal(stats.items[0].provenance.model, 'test-model');
  assert.deepEqual(stats.breakdowns, [{
    kind: 'teaching_package', source: 'teaching package', model: 'test-model', totals: stats.totals,
  }]);
  assert.equal(JSON.stringify(stats).includes('learner_id'), false);
});
test('rehearsals resolve exact authored material and filters preserve global totals', () => {
  db.runWithLearnerId('qa', () => db.recordContentQualityEncounter({
    kind: 'rehearsal',
    packageId: 'quality-package',
    rehearsalId: 'r'
  }, 'r1'));
  assert.throws(() => db.runWithLearnerId('qa', () => db.recordContentQualityEncounter({
    kind: 'rehearsal',
    packageId: 'quality-package',
    rehearsalId: 'missing'
  }, 'r2')), /not available/);
  const page = db.getContentQualityAnalytics({ limit: 1, offset: 1 });
  assert.equal(page.totalItems, 2);
  assert.equal(page.items.length, 1);
  assert.equal(page.totals.exposures, 4);
  assert.deepEqual(page.breakdowns, db.getContentQualityAnalytics().breakdowns);
  assert.equal(page.breakdowns.length, 2);
  const teaching = page.breakdowns.find(group => group.kind === 'teaching_package')!;
  assert.deepEqual(teaching.totals, {
    exposures: 3, learnerContentPairs: 2, up: 0, down: 1, ratedLearners: 1, coverage: 0.5,
  });
  assert.equal(db.getContentQualityAnalytics({ kind: 'rehearsal' }).breakdowns.length, 1);
  assert.equal(db.getContentQualityAnalytics({ kind: 'rehearsal' }).totals.exposures, 1);
  assert.equal(db.getContentQualityAnalytics({ until: '2000-01-01' }).totalItems, 0);
  assert.throws(() => db.getContentQualityAnalytics({ since: '2026-02-31' }), /Invalid/);
  assert.throws(() => db.getContentQualityAnalytics({ since: '2026-02-01', until: '2026-01-01' }), /Invalid/);
});
test('pure snapshots isolate revisions, reject other learner snapshots and exclude encounter metadata', () => {
  const now = new Date().toISOString();
  db.runWithLearnerId('qa', () => db.createPureCueWithoutTransaction({
    id: 'quality-pure',
    stimulus: 'Hello',
    acceptedWordIds: ['quality-word', 'quality-word-2'],
    createdAt: now
  }));
  const insert = sql.prepare(`INSERT INTO pure_cue_served_snapshots (learner_id,snapshot_id,pure_cue_id,served_at,stimulus,axis_note,teaching_note,accepted_answers_json) VALUES ('qa',?,'quality-pure',?,?, '', '', '[]')`);
  insert.run('p1', now, 'Hello');
  insert.run('p2', now, 'Hello');
  insert.run('p3', now, 'Greeting');
  const a = db.runWithLearnerId('qa', () => db.recordContentQualityEncounter({ kind: 'pure_cue', snapshotId: 'p1' }, 'p1'));
  db.runWithLearnerId('qa', () => db.setContentQualityRating(a.contentKey, 'down'));
  const b = db.runWithLearnerId('qa', () => db.recordContentQualityEncounter({ kind: 'pure_cue', snapshotId: 'p2' }, 'p2'));
  assert.deepEqual(a.contentKey, b.contentKey);
  assert.equal(b.rating, 'down');
  const c = db.runWithLearnerId('qa', () => db.recordContentQualityEncounter({ kind: 'pure_cue', snapshotId: 'p3' }, 'p3'));
  assert.notEqual(a.contentKey, c.contentKey);
  assert.equal(c.rating, null);
  assert.throws(() => db.runWithLearnerId('qb', () => db.recordContentQualityEncounter({ kind: 'pure_cue', snapshotId: 'p1' }, 'x')), /not available/);
  assert.equal(db.getContentQualityAnalytics({ kind: 'pure_cue' }).totalItems, 2);
});
test('production, supplements and contrast resolve accessible content, not client authored text', () => {
  const now = new Date().toISOString();
  sql.prepare(`INSERT INTO scoped_production_cues (cue_id,task_id,cue_type,cue_text,created_at,origin_kind,origin_invocation_id,content_scope,owner_learner_id) VALUES ('quality-cue','production-task:quality-word:default_production','definition_gloss','A greeting',?,'manual',NULL,'learner','qa')`).run(now);
  sql.prepare(`INSERT INTO scoped_production_cue_accepted_words (cue_id,word_id,position) VALUES ('quality-cue','quality-word',0)`).run();
  sql.prepare(`INSERT INTO scoped_production_cue_supplements (supplement_id,task_id,cue_id,english_frame,example_sentence,example_translation,created_at,origin_invocation_id,content_scope,owner_learner_id) VALUES ('quality-supplement','production-task:quality-word:default_production',NULL,'Say hello','你好！','Hello!',?,NULL,'shared',NULL)`).run(now);
  sql.exec(`INSERT INTO contrast_clusters(id,title,note) VALUES ('quality-cluster','Greetings',''); INSERT INTO contrast_cluster_members(cluster_id,word_id,nuance_note) VALUES ('quality-cluster','quality-word',''); INSERT INTO contrast_prompts(id,cluster_id,target_word_id,prompt_text,explanation) VALUES ('quality-prompt','quality-cluster','quality-word','Greet a friend','Use a friendly greeting');`);
  for (const [kind, id] of [['production_cue', 'quality-cue'], ['supplement', 'quality-supplement'], ['contrast_prompt', 'quality-prompt']] as const) {
    const result = db.runWithLearnerId('qa', () => db.recordContentQualityEncounter(
      kind === 'contrast_prompt' ? { kind, id, expected: { promptText: 'Greet a friend', explanation: 'Use a friendly greeting', targetWordId: 'quality-word' } } : { kind, id }, id));
    assert.ok(result.contentKey);
    assert.equal(db.getContentQualityAnalytics({ kind }).totalItems, 1);
  }
  for (const [kind, id] of [['production_cue', 'quality-cue'], ['contrast_prompt', 'quality-prompt']] as const)
    assert.throws(() => db.runWithLearnerId('qb', () => db.recordContentQualityEncounter(
      kind === 'contrast_prompt' ? { kind, id, expected: { promptText: 'Greet a friend', explanation: 'Use a friendly greeting', targetWordId: 'quality-word' } } : { kind, id }, 'forbidden')), /not available/);
  assert.throws(() => sql.exec(`UPDATE learner_content_quality_ratings SET learner_id='qb' WHERE learner_id='qa'`), /identity is immutable/);
  assert.throws(() => sql.exec(`UPDATE learner_content_quality_encounters SET encounter_id='rewrite'`), /immutable/);
});

test('contrast content changed after serving is rejected instead of misattributing a vote', () => {
  const target = {
    kind: 'contrast_prompt', id: 'quality-prompt',
    expected: { promptText: 'Greet a friend', explanation: 'Use a friendly greeting', targetWordId: 'quality-word' },
  } as const;
  sql.exec(`UPDATE contrast_prompts SET prompt_text = 'New unseen prompt' WHERE id = 'quality-prompt'`);
  assert.throws(() => db.runWithLearnerId('qa', () => db.recordContentQualityEncounter(target, 'stale')),
    /Content changed/);
  assert.equal(db.getContentQualityAnalytics({ kind: 'contrast_prompt' }).totals.exposures, 1);
  const production = db.getContentQualityAnalytics({ kind: 'production_cue' }).items[0];
  assert.match(JSON.stringify(production.content), /你好/);
});

test('prepared canonical review retains model attribution despite the manual compatibility origin', () => {
  db.runWithLearnerId('qa', () => {
    db.appendCanonicalReviewExercise({
      kind: 'production_cue', contentId: 'quality-cue', model: 'review-model',
      exercise: {
        id: 'quality-cue', responseMode: 'hanzi_entry',
        contract: { kind: 'targeted_review', wordId: 'quality-word' },
        instruction: '', stimulus: { kind: 'direct_text', text: 'A greeting' },
        acceptedAnswers: [{ wordId: 'quality-word', hanzi: '你好', traditional: null }],
      },
      contents: [],
    });
    const state = db.recordContentQualityEncounter({ kind: 'production_cue', id: 'quality-cue' }, 'canonical');
    const item = db.getContentQualityAnalytics({ kind: 'production_cue' }).items.find(row => row.contentKey === state.contentKey)!;
    assert.deepEqual(item.provenance, { source: 'prepared review', model: 'review-model' });
    assert.match(JSON.stringify(item.content), /你好/);
    assert.equal((item.content as { exerciseId: string }).exerciseId, 'quality-cue');
  });
});

test('definition fallback ratings preserve exact shown content, learner selection and historical snapshots', () => {
  const target = { kind: 'definition_fallback' as const, wordId: 'quality-word',
    expected: { promptText: 'hello', displayedMeanings: [] as string[] } };
  const first = db.runWithLearnerId('qa', () => db.recordContentQualityEncounter(target, 'fallback-1'));
  db.runWithLearnerId('qa', () => db.setContentQualityRating(first.contentKey, 'down'));
  assert.equal(db.runWithLearnerId('qa', () => db.recordContentQualityEncounter(target, 'fallback-2')).rating, 'down');
  assert.equal(db.runWithLearnerId('qb', () => db.recordContentQualityEncounter(target, 'fallback-other')).rating, null);
  assert.throws(() => db.runWithLearnerId('qa', () => db.recordContentQualityEncounter({ ...target,
    expected: { promptText: 'arbitrary supplied text', displayedMeanings: [] } }, 'fallback-invalid')), /Content changed/);
  assert.throws(() => db.runWithLearnerId('qa', () => db.recordContentQualityEncounter({ ...target,
    wordId: 'missing' }, 'fallback-missing')), /not available/);
  sql.exec(`UPDATE lexical_word_meanings SET text='greeting' WHERE id='qm'`);
  assert.throws(() => db.runWithLearnerId('qa', () => db.recordContentQualityEncounter(target, 'fallback-stale')), /Content changed/);
  const updated = db.runWithLearnerId('qa', () => db.recordContentQualityEncounter({ ...target,
    expected: { promptText: 'greeting', displayedMeanings: [] } }, 'fallback-new'));
  assert.notEqual(updated.contentKey, first.contentKey);
  assert.equal(updated.rating, null);
  // Once encountered, the immutable older snapshot remains rateable after definitions change.
  db.runWithLearnerId('qa', () => db.setContentQualityRating(first.contentKey, 'up'));
  const stats = db.getContentQualityAnalytics({ kind: 'definition_fallback' });
  const original = stats.items.find(item => item.contentKey === first.contentKey)!;
  assert.deepEqual(original.content, { wordId: 'quality-word', promptText: 'hello', displayedMeanings: [] });
  assert.deepEqual(original.provenance, { source: 'definition fallback', model: null });
  assert.equal(original.up, 1);
  sql.exec(`INSERT INTO learner_word_meaning_preferences(learner_id,meaning_id,show_on_production_prompt,updated_at)
    VALUES ('qa','qm',0,'2026-10-10T00:00:00.000Z')`);
  assert.throws(() => db.runWithLearnerId('qa', () => db.recordContentQualityEncounter({ ...target,
    expected: { promptText: 'greeting', displayedMeanings: [] } }, 'hidden-invalid')), /Content changed/);
  assert.ok(db.runWithLearnerId('qa', () => db.recordContentQualityEncounter({ ...target,
    expected: { promptText: '', displayedMeanings: [] } }, 'hidden-list')).contentKey);
  assert.ok(db.runWithLearnerId('qb', () => db.recordContentQualityEncounter({ ...target,
    expected: { promptText: 'greeting', displayedMeanings: ['greeting'] } }, 'visible-list')).contentKey);
});
