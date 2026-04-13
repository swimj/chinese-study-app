import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, before, beforeEach, describe, test } from 'node:test';
import { pathToFileURL } from 'node:url';

type WordStatus = 'unstudied' | 'learning' | 'review';
type Direction = 'forward' | 'reverse';

type WordRecord = {
  id: string;
  hanzi: string;
  pinyin: string;
  meaning: string;
  examples: string[];
  status: WordStatus;
  priority: number;
  createdAt: string;
  learningStreak?: number;
  lastLearningSuccessOn?: string | null;
  lastLearningCoveredOn?: string | null;
};

type ReviewItemRecord = {
  id: string;
  wordId: string;
  direction: Direction;
  intervalHours: number;
  lastReviewedAt?: string | null;
  nextDueAt?: string | null;
  easeFactor?: number;
};

type DbModule = typeof import('../server/db.ts');

const today = new Date().toISOString().slice(0, 10);
const yesterday = addDays(today, -1);

let dataDir = '';
let dbPath = '';
let sqlite: DatabaseSync;
let dbModule: DbModule;

describe('session composition', { concurrency: false }, () => {
  before(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chinese-study-app-tests-'));
    dbPath = path.join(dataDir, 'app.db');

    const previousMode = process.env.APP_MODE;
    const previousDataDir = process.env.APP_DATA_DIR;

    process.env.APP_MODE = 'study';
    process.env.APP_DATA_DIR = dataDir;

    const moduleUrl = `${pathToFileURL(path.resolve('server/db.ts')).href}?test=${Date.now()}`;
    dbModule = await import(moduleUrl);

    if (previousMode === undefined) {
      delete process.env.APP_MODE;
    } else {
      process.env.APP_MODE = previousMode;
    }

    if (previousDataDir === undefined) {
      delete process.env.APP_DATA_DIR;
    } else {
      process.env.APP_DATA_DIR = previousDataDir;
    }

    sqlite = new DatabaseSync(dbPath);
    sqlite.exec('PRAGMA foreign_keys = ON;');
  });

  beforeEach(() => {
    sqlite.exec(`
      DELETE FROM review_items;
      DELETE FROM words;
    `);
  });

  after(() => {
    sqlite.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  test('includes only due review directions for review words', () => {
    insertWord({
      id: 'review-word',
      hanzi: '你好',
      pinyin: 'ni hao',
      meaning: 'hello',
      examples: ['你好！'],
      status: 'review',
      priority: 100,
      createdAt: isoHoursAgo(48),
    });

    insertReviewItem({
      id: 'review-word-forward',
      wordId: 'review-word',
      direction: 'forward',
      intervalHours: 48,
      // Make only one direction due so the session includes just that review obligation.
      nextDueAt: isoHoursAgo(2),
    });
    insertReviewItem({
      id: 'review-word-reverse',
      wordId: 'review-word',
      direction: 'reverse',
      intervalHours: 48,
      // Keep the opposite direction in the future to verify it stays out of the session.
      nextDueAt: isoHoursFromNow(2),
    });

    const sessionIds = dbModule.getSessionItems().map((item) => item.id);
    assert.deepEqual(sessionIds, ['review-word-forward']);
  });

  test('home overview reports due review, uncovered learning, and limited new-word intake counts', () => {
    insertWord({
      id: 'overview-review-word',
      hanzi: '听',
      pinyin: 'ting',
      meaning: 'listen',
      examples: ['我听音乐。'],
      status: 'review',
      priority: 100,
      createdAt: isoHoursAgo(48),
    });
    insertReviewItem({
      id: 'overview-review-word-forward',
      wordId: 'overview-review-word',
      direction: 'forward',
      intervalHours: 24,
      nextDueAt: isoHoursAgo(2),
    });
    insertReviewItem({
      id: 'overview-review-word-reverse',
      wordId: 'overview-review-word',
      direction: 'reverse',
      intervalHours: 24,
      nextDueAt: isoHoursFromNow(4),
    });

    insertWord({
      id: 'overview-learning-open',
      hanzi: '写',
      pinyin: 'xie',
      meaning: 'write',
      examples: ['我写汉字。'],
      status: 'learning',
      priority: 90,
      createdAt: isoHoursAgo(24),
      lastLearningCoveredOn: yesterday,
    });
    insertReviewItem({
      id: 'overview-learning-open-forward',
      wordId: 'overview-learning-open',
      direction: 'forward',
      intervalHours: 6,
      nextDueAt: null,
    });
    insertReviewItem({
      id: 'overview-learning-open-reverse',
      wordId: 'overview-learning-open',
      direction: 'reverse',
      intervalHours: 6,
      nextDueAt: null,
    });

    insertWord({
      id: 'overview-learning-covered',
      hanzi: '读',
      pinyin: 'du',
      meaning: 'read',
      examples: ['我读书。'],
      status: 'learning',
      priority: 80,
      createdAt: isoHoursAgo(24),
      lastLearningCoveredOn: today,
    });
    insertReviewItem({
      id: 'overview-learning-covered-forward',
      wordId: 'overview-learning-covered',
      direction: 'forward',
      intervalHours: 6,
      nextDueAt: null,
    });
    insertReviewItem({
      id: 'overview-learning-covered-reverse',
      wordId: 'overview-learning-covered',
      direction: 'reverse',
      intervalHours: 6,
      nextDueAt: null,
    });

    insertUnstudiedWordPair('overview-new-a', 70, '2026-01-01T00:00:00.000Z');
    insertUnstudiedWordPair('overview-new-b', 60, '2026-01-02T00:00:00.000Z');
    insertUnstudiedWordPair('overview-new-c', 50, '2026-01-03T00:00:00.000Z');

    assert.deepEqual(dbModule.getHomeOverview(), {
      dueReviewItemCount: 1,
      pendingLearningWordCount: 1,
      newWordIntroCount: 2,
      hasSessionWork: true,
    });
  });

  test('orders due review items with all reverse directions before all forward directions', () => {
    insertWord({
      id: 'review-word-a',
      hanzi: '说',
      pinyin: 'shuo',
      meaning: 'speak',
      examples: ['你会说中文吗？'],
      status: 'review',
      priority: 100,
      createdAt: isoHoursAgo(72),
    });
    insertWord({
      id: 'review-word-b',
      hanzi: '看',
      pinyin: 'kan',
      meaning: 'look',
      examples: ['我看书。'],
      status: 'review',
      priority: 90,
      createdAt: isoHoursAgo(48),
    });

    insertReviewItem({
      id: 'review-word-a-forward',
      wordId: 'review-word-a',
      direction: 'forward',
      intervalHours: 24,
      nextDueAt: isoHoursAgo(3),
    });
    insertReviewItem({
      id: 'review-word-a-reverse',
      wordId: 'review-word-a',
      direction: 'reverse',
      intervalHours: 24,
      nextDueAt: isoHoursAgo(1),
    });
    insertReviewItem({
      id: 'review-word-b-forward',
      wordId: 'review-word-b',
      direction: 'forward',
      intervalHours: 24,
      nextDueAt: isoHoursAgo(4),
    });
    insertReviewItem({
      id: 'review-word-b-reverse',
      wordId: 'review-word-b',
      direction: 'reverse',
      intervalHours: 24,
      nextDueAt: isoHoursAgo(2),
    });

    const sessionIds = dbModule.getSessionItems().map((item) => item.id);
    assert.deepEqual(sessionIds, [
      'review-word-b-reverse',
      'review-word-a-reverse',
      'review-word-b-forward',
      'review-word-a-forward',
    ]);
  });

  test('includes uncovered learning words based on coverage day, not review scheduling fields', () => {
    insertWord({
      id: 'learning-word',
      hanzi: '学习',
      pinyin: 'xue xi',
      meaning: 'study',
      examples: ['我学习汉语。'],
      status: 'learning',
      priority: 90,
      createdAt: isoHoursAgo(24),
      lastLearningCoveredOn: null,
    });

    insertReviewItem({
      id: 'learning-word-forward',
      wordId: 'learning-word',
      direction: 'forward',
      intervalHours: 6,
      // Learning inclusion should ignore review scheduling metadata entirely.
      nextDueAt: isoHoursFromNow(48),
    });
    insertReviewItem({
      id: 'learning-word-reverse',
      wordId: 'learning-word',
      direction: 'reverse',
      intervalHours: 6,
      nextDueAt: null,
    });

    const sessionIds = dbModule.getSessionItems().map((item) => item.id);
    assert.deepEqual(sessionIds, ['learning-word-reverse', 'learning-word-forward']);
  });

  test('excludes learning words already covered on the current UTC day', () => {
    insertWord({
      id: 'covered-learning-word',
      hanzi: '谢谢',
      pinyin: 'xie xie',
      meaning: 'thank you',
      examples: ['谢谢你。'],
      status: 'learning',
      priority: 80,
      createdAt: isoHoursAgo(24),
      lastLearningCoveredOn: today,
    });

    insertReviewItem({
      id: 'covered-learning-word-forward',
      wordId: 'covered-learning-word',
      direction: 'forward',
      intervalHours: 6,
      nextDueAt: isoHoursAgo(1),
    });
    insertReviewItem({
      id: 'covered-learning-word-reverse',
      wordId: 'covered-learning-word',
      direction: 'reverse',
      intervalHours: 6,
      nextDueAt: isoHoursAgo(1),
    });

    const sessionIds = dbModule.getSessionItems().map((item) => item.id);
    assert.deepEqual(sessionIds, []);
  });

  test('caps unstudied intake and orders it by priority then creation time', () => {
    insertWord({
      id: 'unstudied-old-high',
      hanzi: '朋友',
      pinyin: 'peng you',
      meaning: 'friend',
      examples: ['他是我的朋友。'],
      status: 'unstudied',
      priority: 50,
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    insertWord({
      id: 'unstudied-new-high',
      hanzi: '老师',
      pinyin: 'lao shi',
      meaning: 'teacher',
      examples: ['她是老师。'],
      status: 'unstudied',
      priority: 50,
      createdAt: '2026-01-02T00:00:00.000Z',
    });
    insertWord({
      id: 'unstudied-lower',
      hanzi: '学生',
      pinyin: 'xue sheng',
      meaning: 'student',
      examples: ['我是学生。'],
      status: 'unstudied',
      priority: 40,
      createdAt: '2026-01-01T00:00:00.000Z',
    });

    for (const wordId of ['unstudied-old-high', 'unstudied-new-high', 'unstudied-lower']) {
      insertReviewItem({
        id: `${wordId}-forward`,
        wordId,
        direction: 'forward',
        intervalHours: 6,
        nextDueAt: null,
      });
      insertReviewItem({
        id: `${wordId}-reverse`,
        wordId,
        direction: 'reverse',
        intervalHours: 6,
        nextDueAt: null,
      });
    }

    const sessionIds = dbModule.getSessionItems().map((item) => item.id);
    assert.deepEqual(sessionIds, [
      'unstudied-old-high-forward',
      'unstudied-old-high-reverse',
      'unstudied-new-high-forward',
      'unstudied-new-high-reverse',
    ]);
  });

  test('session payload bundles only the words referenced by current session items', () => {
    insertWord({
      id: 'payload-review-word',
      hanzi: '走',
      pinyin: 'zou',
      meaning: 'walk',
      examples: ['我走路去。'],
      status: 'review',
      priority: 100,
      createdAt: isoHoursAgo(48),
    });
    insertReviewItem({
      id: 'payload-review-word-forward',
      wordId: 'payload-review-word',
      direction: 'forward',
      intervalHours: 24,
      nextDueAt: isoHoursAgo(3),
    });
    insertReviewItem({
      id: 'payload-review-word-reverse',
      wordId: 'payload-review-word',
      direction: 'reverse',
      intervalHours: 24,
      nextDueAt: isoHoursFromNow(3),
    });

    insertWord({
      id: 'payload-learning-word',
      hanzi: '跑',
      pinyin: 'pao',
      meaning: 'run',
      examples: ['他跑得很快。'],
      status: 'learning',
      priority: 90,
      createdAt: isoHoursAgo(24),
      lastLearningCoveredOn: yesterday,
    });
    insertReviewItem({
      id: 'payload-learning-word-forward',
      wordId: 'payload-learning-word',
      direction: 'forward',
      intervalHours: 6,
      nextDueAt: null,
    });
    insertReviewItem({
      id: 'payload-learning-word-reverse',
      wordId: 'payload-learning-word',
      direction: 'reverse',
      intervalHours: 6,
      nextDueAt: null,
    });

    insertWord({
      id: 'payload-excluded-word',
      hanzi: '坐',
      pinyin: 'zuo',
      meaning: 'sit',
      examples: ['请坐。'],
      status: 'learning',
      priority: 80,
      createdAt: isoHoursAgo(24),
      lastLearningCoveredOn: today,
    });
    insertReviewItem({
      id: 'payload-excluded-word-forward',
      wordId: 'payload-excluded-word',
      direction: 'forward',
      intervalHours: 6,
      nextDueAt: null,
    });
    insertReviewItem({
      id: 'payload-excluded-word-reverse',
      wordId: 'payload-excluded-word',
      direction: 'reverse',
      intervalHours: 6,
      nextDueAt: null,
    });

    const payload = dbModule.getSessionPayload();

    assert.deepEqual(payload.items.map((item) => item.id), [
      'payload-review-word-forward',
      'payload-learning-word-reverse',
      'payload-learning-word-forward',
    ]);
    assert.deepEqual(payload.words.map((word) => word.id), [
      'payload-review-word',
      'payload-learning-word',
    ]);
  });

  test('merges session categories as review items first, then learning words, then unstudied intake', () => {
    insertWord({
      id: 'review-word',
      hanzi: '说',
      pinyin: 'shuo',
      meaning: 'speak',
      examples: ['你会说中文吗？'],
      status: 'review',
      priority: 100,
      createdAt: isoHoursAgo(72),
    });
    insertWord({
      id: 'learning-word',
      hanzi: '看',
      pinyin: 'kan',
      meaning: 'look',
      examples: ['我看书。'],
      status: 'learning',
      priority: 90,
      createdAt: isoHoursAgo(48),
      lastLearningCoveredOn: null,
    });
    insertWord({
      id: 'unstudied-word',
      hanzi: '听',
      pinyin: 'ting',
      meaning: 'listen',
      examples: ['我听音乐。'],
      status: 'unstudied',
      priority: 80,
      createdAt: isoHoursAgo(24),
    });

    insertReviewItem({
      id: 'review-word-forward',
      wordId: 'review-word',
      direction: 'forward',
      intervalHours: 24,
      nextDueAt: isoHoursAgo(2),
    });
    insertReviewItem({
      id: 'learning-word-forward',
      wordId: 'learning-word',
      direction: 'forward',
      intervalHours: 6,
      nextDueAt: isoHoursFromNow(12),
    });
    insertReviewItem({
      id: 'learning-word-reverse',
      wordId: 'learning-word',
      direction: 'reverse',
      intervalHours: 6,
      nextDueAt: isoHoursAgo(12),
    });
    insertReviewItem({
      id: 'unstudied-word-forward',
      wordId: 'unstudied-word',
      direction: 'forward',
      intervalHours: 6,
      nextDueAt: null,
    });
    insertReviewItem({
      id: 'unstudied-word-reverse',
      wordId: 'unstudied-word',
      direction: 'reverse',
      intervalHours: 6,
      nextDueAt: null,
    });

    const sessionIds = dbModule.getSessionItems().map((item) => item.id);
    assert.deepEqual(sessionIds, [
      'review-word-forward',
      'learning-word-reverse',
      'learning-word-forward',
      'unstudied-word-forward',
      'unstudied-word-reverse',
    ]);
  });

  test('an unstudied word becomes a same-day non-obligation and a next-day learning obligation after completion', () => {
    insertWord({
      id: 'new-word',
      hanzi: '写',
      pinyin: 'xie',
      meaning: 'write',
      examples: ['我写汉字。'],
      status: 'unstudied',
      priority: 70,
      createdAt: isoHoursAgo(12),
    });
    insertReviewItem({
      id: 'new-word-forward',
      wordId: 'new-word',
      direction: 'forward',
      intervalHours: 6,
      nextDueAt: null,
    });
    insertReviewItem({
      id: 'new-word-reverse',
      wordId: 'new-word',
      direction: 'reverse',
      intervalHours: 6,
      nextDueAt: null,
    });

    assert.deepEqual(dbModule.getSessionItems().map((item) => item.id), [
      'new-word-forward',
      'new-word-reverse',
    ]);

    const updatedWord = dbModule.completeUnstudiedWordSession('new-word');
    assert.equal(updatedWord.status, 'learning');
    assert.equal(updatedWord.lastLearningCoveredOn, today);
    assert.deepEqual(dbModule.getSessionItems().map((item) => item.id), []);

    // Simulate the next UTC day by moving the persisted coverage marker back one day.
    // This is standing in for clock control until we introduce an explicit backend clock seam.
    sqlite.prepare(`
      UPDATE words
      SET last_learning_covered_on = ?
      WHERE id = 'new-word'
    `).run(yesterday);

    assert.deepEqual(dbModule.getSessionItems().map((item) => item.id), [
      'new-word-reverse',
      'new-word-forward',
    ]);
  });

  test.todo('keeps UTC date-key and ISO timestamp handling consistent across session composition boundaries');
});

function insertWord(record: WordRecord) {
  sqlite.prepare(`
    INSERT INTO words (
      id,
      hanzi,
      pinyin,
      meaning,
      examples_json,
      status,
      priority,
      created_at,
      learning_streak,
      last_learning_success_on,
      last_learning_covered_on
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    record.id,
    record.hanzi,
    record.pinyin,
    record.meaning,
    JSON.stringify(record.examples),
    record.status,
    record.priority,
    record.createdAt,
    record.learningStreak ?? 0,
    record.lastLearningSuccessOn ?? null,
    record.lastLearningCoveredOn ?? null,
  );
}

function insertReviewItem(record: ReviewItemRecord) {
  sqlite.prepare(`
    INSERT INTO review_items (
      id,
      word_id,
      direction,
      interval_hours,
      last_reviewed_at,
      next_due_at,
      ease_factor
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    record.id,
    record.wordId,
    record.direction,
    record.intervalHours,
    record.lastReviewedAt ?? null,
    record.nextDueAt ?? null,
    record.easeFactor ?? 2.5,
  );
}

function insertUnstudiedWordPair(id: string, priority: number, createdAt: string) {
  insertWord({
    id,
    hanzi: `${id}-hanzi`,
    pinyin: `${id}-pinyin`,
    meaning: `${id}-meaning`,
    examples: [`${id}-example`],
    status: 'unstudied',
    priority,
    createdAt,
  });

  insertReviewItem({
    id: `${id}-forward`,
    wordId: id,
    direction: 'forward',
    intervalHours: 6,
    nextDueAt: null,
  });
  insertReviewItem({
    id: `${id}-reverse`,
    wordId: id,
    direction: 'reverse',
    intervalHours: 6,
    nextDueAt: null,
  });
}

function isoHoursAgo(hours: number) {
  return shiftHours(new Date().toISOString(), -hours);
}

function isoHoursFromNow(hours: number) {
  return shiftHours(new Date().toISOString(), hours);
}

function shiftHours(isoTimestamp: string, hours: number) {
  const date = new Date(isoTimestamp);
  date.setUTCHours(date.getUTCHours() + hours);
  return date.toISOString();
}

function addDays(dateKey: string, days: number) {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
