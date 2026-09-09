import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, before, beforeEach, describe, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * End-to-end deck-aware diet admission (SPECS/diet-deck-distribution.md §2.4)
 * against the synthetic fixture manifest. The fixture decks:
 *   hsk2-l1: 我 你 是 的 也 在 他 她 · hsk2-l2: 猫 狗 鸟 鱼 · hsk2-l3-s1: 抽象 · beyond-hsk: (tail)
 */

type DbModule = typeof import('../server/db.ts');

const FIXTURE_MANIFEST_PATH = fileURLToPath(new URL('./fixtures/mandarin-decks-v1.fixture.json', import.meta.url));
const MISSING_MANIFEST_PATH = path.join(os.tmpdir(), 'no-such-deck-manifest-for-legacy-mode.json');

const L1 = ['wo', 'ni', 'shi', 'de', 'ye', 'zai', 'ta', 'ta-female'];
const L2 = ['mao', 'gou', 'niao', 'yu'];

const studyDayKey = new Date().toISOString().slice(0, 10);

let dataDir = '';
let sqlite: DatabaseSync;
let dbModule: DbModule;

describe('deck-aware diet admission', { concurrency: false }, () => {
  before(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chinese-study-app-deck-admission-'));

    const previousMode = process.env.APP_MODE;
    const previousDataDir = process.env.APP_DATA_DIR;
    const previousManifestPath = process.env.APP_DECK_MANIFEST_PATH;

    process.env.APP_MODE = 'study';
    process.env.APP_DATA_DIR = dataDir;
    process.env.APP_DECK_MANIFEST_PATH = FIXTURE_MANIFEST_PATH;

    const moduleUrl = `${pathToFileURL(path.resolve('server/db.ts')).href}?test=${Date.now()}`;
    dbModule = await import(moduleUrl);

    restoreEnv('APP_MODE', previousMode);
    restoreEnv('APP_DATA_DIR', previousDataDir);
    restoreEnv('APP_DECK_MANIFEST_PATH', previousManifestPath);

    sqlite = new DatabaseSync(path.join(dataDir, 'app.db'));
    sqlite.function('current_learner_id', () => 'test-learner');
    sqlite.exec('PRAGMA foreign_keys = ON;');
  });

  after(() => {
    sqlite.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    sqlite.exec(`
      DELETE FROM study_events;
      DELETE FROM study_attempt_events;
      DELETE FROM study_sessions;
      DELETE FROM daily_new_word_intake;
      DELETE FROM user_word_priority;
      DELETE FROM learner_settings;
      DELETE FROM word_skill_state;
      DELETE FROM words;
    `);
    sqlite.prepare(`
      INSERT INTO learner_settings (learner_id, setting_key, value_json, updated_at)
      VALUES ('test-learner', 'daily_new_word_limit', '10', '2026-01-01T00:00:00.000Z')
    `).run();
    process.env.APP_DECK_MANIFEST_PATH = FIXTURE_MANIFEST_PATH;
  });

  test('the default profile draws diet words from the first deck only', () => {
    insertCorpusWords();
    dbModule.setDailyNewWordLimit(4);
    const admitted = admittedUnstudiedIds();
    assert.equal(admitted.length, 4);
    for (const id of admitted) {
      assert.ok(L1.includes(id), `expected a first-deck word, got ${id}`);
    }
  });

  test('an operator jump moves the diet to the chosen deck', () => {
    insertCorpusWords();
    dbModule.setOperatorDietDeck('hsk2-l2');
    dbModule.setDailyNewWordLimit(4);
    const admitted = admittedUnstudiedIds();
    assert.equal(admitted.length, 4);
    for (const id of admitted) {
      assert.ok(L2.includes(id), `expected a second-deck word, got ${id}`);
    }
  });

  test('deck weights split the diet draw across decks', () => {
    insertCorpusWords();
    dbModule.setOperatorDietDeck('hsk2-l1');
    dbModule.nudgeDietProfile('harder');
    dbModule.nudgeDietProfile('harder'); // { l1: 0.8, l2: 0.2 }
    dbModule.setDailyNewWordLimit(5);
    const admitted = admittedUnstudiedIds();
    assert.equal(admitted.length, 5);
    assert.equal(admitted.filter((id) => L1.includes(id)).length, 4);
    assert.equal(admitted.filter((id) => L2.includes(id)).length, 1);
  });

  test('apportions the actual diet demand after a full stash contribution', () => {
    insertCorpusWords();
    dbModule.setOperatorDietDeck('hsk2-l1');
    for (let index = 0; index < 5; index += 1) {
      dbModule.nudgeDietProfile('harder');
    }
    for (const id of ['tail-high', 'tail-low', 'stash-tail-1', 'stash-tail-2', 'stash-tail-3']) {
      dbModule.updateWordUserPriority(id, { bumpDelta: 1 });
    }
    dbModule.setDailyNewWordLimit(10);

    const admitted = admittedUnstudiedIds();
    assert.equal(admitted.filter((id) => id.startsWith('stash-') || id.startsWith('tail-')).length, 5);
    assert.equal(admitted.filter((id) => L1.includes(id)).length, 3);
    assert.equal(admitted.filter((id) => L2.includes(id)).length, 2);
  });

  test('apportions an unequal distribution after stash underfill', () => {
    insertCorpusWords();
    dbModule.setOperatorDietDeck('hsk2-l1');
    dbModule.nudgeDietProfile('harder');
    dbModule.nudgeDietProfile('harder'); // { l1: 0.8, l2: 0.2 }
    for (const id of ['stash-tail-1', 'stash-tail-2']) {
      dbModule.updateWordUserPriority(id, { bumpDelta: 1 });
    }
    sqlite.prepare(`
      INSERT INTO learner_settings (learner_id, setting_key, value_json, updated_at)
      VALUES ('test-learner', 'stash_diet_split', '0.7', '2026-01-01T00:00:00.000Z')
    `).run();
    dbModule.setDailyNewWordLimit(10);

    const admitted = admittedUnstudiedIds();
    assert.equal(admitted.filter((id) => id.startsWith('stash-')).length, 2);
    assert.equal(admitted.filter((id) => L1.includes(id)).length, 6);
    assert.equal(admitted.filter((id) => L2.includes(id)).length, 2);
  });

  test('exhausting the weighted decks spills into successors without mutating the profile', () => {
    insertCorpusWords();
    dbModule.setOperatorDietDeck('hsk2-l2');
    dbModule.setDailyNewWordLimit(6);
    const admitted = admittedUnstudiedIds();
    // All four l2 words, then spill into l3-s1, then tail fallback by priority.
    assert.equal(admitted.length, 6);
    for (const id of L2) {
      assert.ok(admitted.includes(id), `expected ${id} from the jumped deck`);
    }
    assert.ok(admitted.includes('abstract'), 'expected spill into the successor deck');
    assert.ok(admitted.includes('wo'), 'expected tail fallback in corpus-priority order');
    assert.deepEqual(dbModule.getStoredDietProfile()?.weights, { 'hsk2-l2': 1 });
  });

  test('the beyond-hsk tail keeps legacy corpus-priority order when decks run out', () => {
    insertCorpusWords();
    dbModule.setOperatorDietDeck('hsk2-l3-s1');
    dbModule.setDailyNewWordLimit(4);
    const admitted = admittedUnstudiedIds();
    assert.deepEqual(admitted, ['abstract', 'wo', 'ni', 'shi']);
  });

  test('without a manifest the legacy corpus-priority fill applies unchanged', () => {
    process.env.APP_DECK_MANIFEST_PATH = MISSING_MANIFEST_PATH;
    insertCorpusWords();
    dbModule.setDailyNewWordLimit(2);
    assert.deepEqual(admittedUnstudiedIds(), ['wo', 'ni']);
  });

  test('a stored stash ratio reshapes the dual-pool split', () => {
    insertCorpusWords();
    const stashIds = ['tail-low', 'tail-high', 'mao', 'gou'];
    for (const id of stashIds) {
      dbModule.updateWordUserPriority(id, { bumpDelta: 1 });
    }
    dbModule.setDailyNewWordLimit(4);

    // Default ratio 0.5: two stash, two diet.
    const balanced = admittedUnstudiedIds();
    assert.equal(balanced.length, 4);
    assert.equal(balanced.filter((id) => stashIds.includes(id)).length, 2);
    assert.equal(balanced.filter((id) => L1.includes(id)).length, 2);

    // ratio 0.75: three stash, one diet (unfilled stash slots would backfill
    // to diet, but stash is plentiful here).
    sqlite.prepare(`
      INSERT INTO learner_settings (learner_id, setting_key, value_json, updated_at)
      VALUES ('test-learner', 'stash_diet_split', '0.75', '2026-01-01T00:00:00.000Z')
      ON CONFLICT(learner_id, setting_key) DO UPDATE SET value_json = excluded.value_json
    `).run();
    const skewed = admittedUnstudiedIds();
    assert.equal(skewed.length, 4);
    assert.equal(skewed.filter((id) => stashIds.includes(id)).length, 3);
    assert.equal(skewed.filter((id) => L1.includes(id)).length, 1);
  });

  function admittedUnstudiedIds(): string[] {
    return dbModule.getSessionPayload(studyDayKey).buckets.unstudied.map((word) => word.id);
  }

  function insertCorpusWords(): void {
    const words = [
      { id: 'wo', hanzi: '我', pinyin: 'wǒ', priority: 100 },
      { id: 'ni', hanzi: '你', pinyin: 'nǐ', priority: 99 },
      { id: 'shi', hanzi: '是', pinyin: 'shì', priority: 98 },
      { id: 'de', hanzi: '的', pinyin: 'de', priority: 97 },
      { id: 'ye', hanzi: '也', pinyin: 'yě', priority: 96 },
      { id: 'zai', hanzi: '在', pinyin: 'zài', priority: 95 },
      { id: 'ta', hanzi: '他', pinyin: 'tā', priority: 94 },
      { id: 'ta-female', hanzi: '她', pinyin: 'tā', priority: 93 },
      { id: 'mao', hanzi: '猫', pinyin: 'māo', priority: 50 },
      { id: 'gou', hanzi: '狗', pinyin: 'gǒu', priority: 49 },
      { id: 'niao', hanzi: '鸟', pinyin: 'niǎo', priority: 48 },
      { id: 'yu', hanzi: '鱼', pinyin: 'yú', priority: 47 },
      { id: 'abstract', hanzi: '抽象', pinyin: 'chōu xiàng', priority: 10 },
      { id: 'tail-high', hanzi: '犇', pinyin: 'bēn', priority: 5 },
      { id: 'tail-low', hanzi: '骉', pinyin: 'biāo', priority: 1 },
      { id: 'stash-tail-1', hanzi: '甲', pinyin: 'jiǎ', priority: 1 },
      { id: 'stash-tail-2', hanzi: '乙', pinyin: 'yǐ', priority: 1 },
      { id: 'stash-tail-3', hanzi: '丙', pinyin: 'bǐng', priority: 1 },
    ];
    for (const word of words) {
      sqlite.prepare(`
        INSERT INTO words (
          id, hanzi, traditional, pinyin, meaning, examples_json, status,
          priority, created_at, learning_streak, last_learning_success_on, last_learning_covered_on
        ) VALUES (?, ?, NULL, ?, '', '[]', 'unstudied', ?, '2026-01-01T00:00:00.000Z', 0, NULL, NULL)
      `).run(word.id, word.hanzi, word.pinyin, word.priority);
    }
  }
});

function restoreEnv(key: string, previous: string | undefined): void {
  if (previous === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = previous;
  }
}
