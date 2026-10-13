import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, before, test } from 'node:test';
import { pathToFileURL } from 'node:url';
import type { WordContentDocument } from '../src/domain/word-content/types.ts';

let dataDir: string;
let sqlite: DatabaseSync;
let db: typeof import('../server/db.ts');
let introductions: typeof import('../server/db/word-introductions.ts');
const now = new Date().toISOString();
const past = new Date(Date.now() - 48 * 3_600_000).toISOString();

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bootstrap-reveal-serving-'));
  const previous = { APP_MODE: process.env.APP_MODE, APP_DATA_DIR: process.env.APP_DATA_DIR };
  process.env.APP_MODE = 'study';
  process.env.APP_DATA_DIR = dataDir;
  try {
    db = await import(`${pathToFileURL(path.resolve('server/db.ts')).href}?bootstrap-reveal=${Date.now()}`);
    introductions = await import('../server/db/word-introductions.ts');
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
  sqlite = new DatabaseSync(path.join(dataDir, 'app.db'));
  sqlite.function('current_learner_id', () => 'test-learner');
  sqlite.exec('PRAGMA foreign_keys = ON');
});

after(() => {
  sqlite?.close();
  if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
});

function createWord(wordId: string, cueType?: 'definition_gloss' | 'minimal_context' | 'circumstance') {
  sqlite.prepare(`INSERT INTO words
    (id, hanzi, pinyin, meaning, examples_json, status, priority, created_at)
    VALUES (?, '包庇', 'bāo bì', 'to shield; to harbor', '[]', 'review', 100, ?)`)
    .run(wordId, past);
  sqlite.prepare(`INSERT INTO learner_owned_word_study_admission_state
    (word_id, study_phase, earliest_next_study_at) VALUES (?, 'review', NULL)`).run(wordId);
  setSkill(wordId, 'production');
  if (cueType) {
    const cueId = `${wordId}:cue`;
    const taskId = `production-task:${wordId}:default_production`;
    sqlite.prepare(`INSERT INTO production_cues
      (cue_id, task_id, cue_type, cue_text, created_at, origin_kind, origin_invocation_id)
      VALUES (?, ?, ?, 'to shield; to harbor', ?, 'manual', NULL)`).run(cueId, taskId, cueType, past);
    sqlite.prepare(`INSERT INTO production_cue_accepted_words (cue_id, word_id, position)
      VALUES (?, ?, 0)`).run(cueId, wordId);
    sqlite.prepare(`INSERT INTO production_cue_lifecycle_events
      (event_id, cue_id, task_id, lifecycle_kind, occurred_at, invocation_id)
      VALUES (?, ?, ?, 'activated', ?, NULL)`).run(`${cueId}:activated`, cueId, taskId, past);
    sqlite.prepare(`INSERT INTO production_cue_activation_state
      (cue_id, active, latest_lifecycle_event_id, updated_at) VALUES (?, 1, ?, ?)`)
      .run(cueId, `${cueId}:activated`, past);
  }
}

function setSkill(wordId: string, skill: 'production' | 'recognition') {
  sqlite.prepare('DELETE FROM learner_owned_word_skill_state WHERE word_id = ?').run(wordId);
  sqlite.prepare(`INSERT INTO learner_owned_word_skill_state
    (word_id, skill_id, enabled, interval_hours, last_studied_at, next_due_at, ease_factor)
    VALUES (?, ?, 1, 24, ?, ?, 2.5)`).run(wordId, skill, past, past);
}

function bootstrap(wordId: string) {
  const content: WordContentDocument = {
    schemaVersion: 1, id: `${wordId}:content`,
    word: { wordId, hanzi: '包庇', traditional: null, pinyin: 'bāo bì' },
    uses: [{ id: 'shield', label: 'Shield someone from responsibility', notes: [], exampleIds: ['shield-example'] }],
    examples: [{ id: 'shield-example', text: '他包庇了犯错的朋友。',
      translation: 'He shielded his friend who had done wrong.', pronunciation: 'tā bāo bì le fàn cuò de péng you' }],
  };
  assert.equal(introductions.claimSharedWordIntroductionStage(wordId, 'bootstrap', wordId, now,
    new Date(Date.now() + 60_000).toISOString()), 'claimed');
  introductions.finishSharedWordIntroductionBootstrap(wordId, wordId, content, 'test-bootstrap-worker');
  return content;
}

function serve(wordId: string) {
  const item = db.getSessionPayload(now.slice(0, 10), { random: () => 0 }).buckets.review
    .find((candidate) => candidate.targetWordId === wordId);
  assert.ok(item, `Expected due review item for ${wordId}`);
  return item;
}

function addLegacySupplement(wordId: string, cueId: string | null) {
  const operation = {
    kind: 'add_production_cue_supplement' as const, version: 1 as const, wordId,
    taskId: `production-task:${wordId}:default_production`, cueId,
    englishFrame: 'Legacy frame', exampleSentence: '他包庇了朋友。', exampleTranslation: 'He shielded a friend.',
  };
  const invocationId = `${wordId}:legacy`;
  sqlite.prepare(`INSERT INTO reflection_operation_invocations
    (invocation_id, created_at, origin_kind, operation_kind, operation_version, operation_json,
     application_state, application_updated_at, effect_refs_json, satisfying_effect_refs_json)
    VALUES (?, ?, 'manual', ?, 1, ?, 'pending', ?, '[]', '[]')`)
    .run(invocationId, now, operation.kind, JSON.stringify(operation), now);
  const applied = db.applyProductionCueSupplementWithoutTransaction(operation, invocationId, now);
  assert.equal(applied.kind, 'applied');
  return operation;
}

for (const cueType of [undefined, 'definition_gloss'] as const) {
  test(`bootstrap alone gives ${cueType ?? 'fallback'} production the same revealed content as recognition`, () => {
    const wordId = `uniform-${cueType ?? 'fallback'}`;
    createWord(wordId, cueType);
    const content = bootstrap(wordId);
    const production = serve(wordId);
    assert.equal(production.actionKind, 'production');
    assert.equal(production.production?.cueType, 'definition_gloss');
    assert.deepEqual(production.wordContent, content);
    assert.deepEqual(production.bootstrapReveal, {
      contentId: content.id, useId: 'shield', exampleId: 'shield-example',
      englishFrame: content.uses[0].label,
      exampleSentence: content.examples[0].text, exampleTranslation: content.examples[0].translation,
    });
    assert.deepEqual(production.production?.bootstrapReveal, production.bootstrapReveal);
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM word_teaching_packages').get()?.count, 0);
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM reflection_operation_invocations').get()?.count, 0);
    setSkill(wordId, 'recognition');
    const recognition = serve(wordId);
    assert.equal(recognition.actionKind, 'recognition');
    assert.deepEqual(recognition.bootstrapReveal, production.bootstrapReveal);
    assert.deepEqual(recognition.wordContent, production.wordContent);
  });
}

for (const cueType of ['minimal_context', 'circumstance'] as const) {
  test(`${cueType} production does not gain a bootstrap reveal`, () => {
    const wordId = `excluded-${cueType}`;
    createWord(wordId, cueType);
    bootstrap(wordId);
    const item = serve(wordId);
    assert.equal(item.production?.cueType, cueType);
    assert.equal(item.bootstrapReveal, undefined);
    assert.equal(item.production?.bootstrapReveal, undefined);
    assert.equal(item.wordContent, undefined);
  });
}

test('bootstrap takes precedence over legacy supplements; quarantined content restores the legacy fallback', () => {
  const wordId = 'legacy-fallback';
  createWord(wordId, 'definition_gloss');
  const legacy = addLegacySupplement(wordId, `${wordId}:cue`);
  assert.equal(serve(wordId).production?.supplement?.englishFrame, legacy.englishFrame);
  const content = bootstrap(wordId);
  const production = serve(wordId);
  assert.equal(production.bootstrapReveal?.contentId, content.id);
  assert.equal(production.production?.supplement, null);
  assert.doesNotThrow(() => introductions.assertBootstrapRevealSource(wordId, production.bootstrapReveal));
  assert.throws(() => introductions.assertBootstrapRevealSource('different-word', production.bootstrapReveal),
    /does not belong to the target word/);
  for (const [field, value] of Object.entries({
    useId: 'different-use', exampleId: 'different-example', englishFrame: 'Changed frame',
    exampleSentence: 'Changed sentence', exampleTranslation: 'Changed translation',
  })) {
    assert.throws(() => introductions.assertBootstrapRevealSource(wordId,
      { ...production.bootstrapReveal, [field]: value }), /differs from its immutable source/, field);
  }
  setSkill(wordId, 'recognition');
  const recognition = serve(wordId);
  assert.deepEqual(recognition.bootstrapReveal, production.bootstrapReveal);
  assert.equal(recognition.recognitionSupplement, undefined);

  const publication = db.getSharedContentPublicationForContent('word_content', content.id);
  assert.ok(publication);
  db.quarantineSharedContentPublication({ publicationId: publication.publicationId,
    operatorId: 'test-operator', reason: 'Example needs correction' });
  assert.doesNotThrow(() => introductions.assertBootstrapRevealSource(wordId, production.bootstrapReveal),
    'Historical evidence remains valid after the source stops being served');
  const recognitionFallback = serve(wordId);
  assert.equal(recognitionFallback.bootstrapReveal, undefined);
  assert.equal(recognitionFallback.wordContent, undefined);
  assert.equal(recognitionFallback.recognitionSupplement?.englishFrame, legacy.englishFrame);
  setSkill(wordId, 'production');
  const productionFallback = serve(wordId);
  assert.equal(productionFallback.bootstrapReveal, undefined);
  assert.equal(productionFallback.production?.supplement?.englishFrame, legacy.englishFrame);
  assert.equal(production.bootstrapReveal?.contentId, content.id, 'Previously served content remains an exact snapshot');
});
