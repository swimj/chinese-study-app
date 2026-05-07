import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, before, beforeEach, describe, test } from 'node:test';
import { pathToFileURL } from 'node:url';

type WordStatus = 'unstudied' | 'learning' | 'review';
type Direction = 'forward' | 'reverse';
type StudySkillId = 'recognition' | 'production' | 'contextual_selection';

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
const studyDayKey = today;

let dataDir = '';
let dbPath = '';
let sqlite: DatabaseSync;
let dbModule: DbModule;

describe('session completion', { concurrency: false }, () => {
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
      DELETE FROM daily_new_word_intake;
      DELETE FROM word_skill_state;
      DELETE FROM word_study_admission_state;
      DELETE FROM review_items;
      DELETE FROM words;
    `);
  });

  after(() => {
    sqlite.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  test('completing a review item with a clean hard pass updates interval, due date, and ease', () => {
    insertReviewWordWithItem({
      wordId: 'hard-word',
      reviewItemId: 'hard-word-forward',
      direction: 'forward',
      intervalHours: 10,
      easeFactor: 2.5,
      nextDueAt: isoHoursAgo(1),
    });

    const updatedItem = dbModule.completeReviewItemSession('hard-word-forward', 0, 'hard');
    assert.equal(updatedItem.intervalHours, 15); // 15 = 10 * 1.5 (hard pass multiplier)
    assert.equal(updatedItem.easeFactor, 2.35); // 2.35 = 2.5 - 0.15 (hard pass easeFactor penalty)
    // We only care that completion writes a real UTC timestamp, not the exact wall-clock instant.
    assert.match(updatedItem.lastReviewedAt ?? '', isoUtcTimestampPattern);
    assert.equal(
      updatedItem.nextDueAt,
      addHours(updatedItem.lastReviewedAt ?? fail('missing lastReviewedAt'), updatedItem.intervalHours),
    );

    assert.deepEqual(fetchReviewItem('hard-word-forward'), updatedItem);
    assert.deepEqual(fetchWordSkillState('hard-word', 'recognition'), {
      wordId: 'hard-word',
      skillId: 'recognition',
      enabled: true,
      intervalHours: updatedItem.intervalHours,
      lastStudiedAt: updatedItem.lastReviewedAt,
      nextDueAt: updatedItem.nextDueAt,
      easeFactor: updatedItem.easeFactor,
    });
    assert.equal(fetchAdmissionState('hard-word')?.earliestNextStudyAt, addHours(
      updatedItem.lastReviewedAt ?? fail('missing lastReviewedAt'),
      6,
    ));
    assert.deepEqual(dbModule.validateReviewItemStudySchedulerShadow(), []);
  });

  test('completing a review item with a clean good pass multiplies by ease and rounds up to the next hour', () => {
    insertReviewWordWithItem({
      wordId: 'good-word',
      reviewItemId: 'good-word-forward',
      direction: 'forward',
      intervalHours: 21,
      easeFactor: 2.5,
      nextDueAt: isoHoursAgo(1),
    });

    const updatedItem = dbModule.completeReviewItemSession('good-word-forward', 0, 'good');
    assert.equal(updatedItem.intervalHours, 53); // ceil(21 * 2.5) = ceil(52.5) = 53
    assert.equal(updatedItem.easeFactor, 2.5);
    assert.equal(
      updatedItem.nextDueAt,
      addHours(updatedItem.lastReviewedAt ?? fail('missing lastReviewedAt'), 53),
    );
  });

  test('completing a reverse review item mirrors production skill state', () => {
    insertReviewWordWithItem({
      wordId: 'production-word',
      reviewItemId: 'production-word-reverse',
      direction: 'reverse',
      intervalHours: 12,
      easeFactor: 2.5,
      nextDueAt: isoHoursAgo(1),
    });

    const updatedItem = dbModule.completeReviewItemSession('production-word-reverse', 0, 'good');

    assert.equal(updatedItem.direction, 'reverse');
    assert.deepEqual(fetchWordSkillState('production-word', 'production'), {
      wordId: 'production-word',
      skillId: 'production',
      enabled: true,
      intervalHours: updatedItem.intervalHours,
      lastStudiedAt: updatedItem.lastReviewedAt,
      nextDueAt: updatedItem.nextDueAt,
      easeFactor: updatedItem.easeFactor,
    });
    assert.equal(fetchWordSkillState('production-word', 'recognition'), undefined);
    assert.deepEqual(dbModule.validateReviewItemStudySchedulerShadow(), []);
  });

  test('completing a review item with a clean easy pass uses ease plus the easy bonus and rounds up to the next hour', () => {
    insertReviewWordWithItem({
      wordId: 'easy-word',
      reviewItemId: 'easy-word-forward',
      direction: 'forward',
      intervalHours: 20,
      easeFactor: 2.5,
      nextDueAt: isoHoursAgo(1),
    });

    const updatedItem = dbModule.completeReviewItemSession('easy-word-forward', 0, 'easy');
    assert.equal(updatedItem.intervalHours, 57); // ceil(20 * (2.5 + 0.35)) = ceil(57) = 57
    assert.equal(updatedItem.easeFactor, 2.65);
    assert.equal(
      updatedItem.nextDueAt,
      addHours(updatedItem.lastReviewedAt ?? fail('missing lastReviewedAt'), 57),
    );
  });

  test('completing a lapsed review item resets the interval and penalizes ease', () => {
    insertReviewWordWithItem({
      wordId: 'lapsed-word',
      reviewItemId: 'lapsed-word-forward',
      direction: 'forward',
      intervalHours: 40,
      easeFactor: 2.5,
      nextDueAt: isoHoursAgo(1),
    });

    const updatedItem = dbModule.completeReviewItemSession('lapsed-word-forward', 2, null);
    assert.equal(updatedItem.intervalHours, 6);
    assert.equal(updatedItem.easeFactor, 2.2); // 2.2 = 2.5 - (2 * 0.15)
    assert.equal(
      updatedItem.nextDueAt,
      addHours(updatedItem.lastReviewedAt ?? fail('missing lastReviewedAt'), 6),
    );
    assert.deepEqual(fetchReviewItem('lapsed-word-forward'), updatedItem);
  });

  test('review lapse penalties respect the minimum ease floor', () => {
    insertReviewWordWithItem({
      wordId: 'penalty-floor-word',
      reviewItemId: 'penalty-floor-word-forward',
      direction: 'forward',
      intervalHours: 40,
      easeFactor: 1.9,
      nextDueAt: isoHoursAgo(1),
    });

    const updatedItem = dbModule.completeReviewItemSession('penalty-floor-word-forward', 5, null);
    assert.equal(updatedItem.intervalHours, 6);
    assert.equal(updatedItem.easeFactor, 1.8); // without the floor, this would be 1.15 = 1.9 - (5 * 0.15).
  });

  test('review completion rejects a clean pass without a terminal rating', () => {
    insertReviewWordWithItem({
      wordId: 'missing-rating-word',
      reviewItemId: 'missing-rating-word-forward',
      direction: 'forward',
      intervalHours: 10,
      easeFactor: 2.5,
      nextDueAt: isoHoursAgo(1),
    });

    assert.throws(
      () => dbModule.completeReviewItemSession('missing-rating-word-forward', 0, null),
      /Expected terminal review rating/,
    );
  });

  test('successful learning completion increments the streak and updates success and coverage dates', () => {
    // mock an initial state where, yesterday, the user successfully learned this word
    insertLearningWordWithItems({
      wordId: 'learning-success-word',
      learningStreak: 1,
      lastLearningSuccessOn: addDays(today, -1),
      lastLearningCoveredOn: null,
    });

    const updatedWord = dbModule.completeLearningWordSession('learning-success-word', true);
    assert.equal(updatedWord.status, 'learning');
    assert.equal(updatedWord.learningStreak, 2);
    assert.equal(updatedWord.lastLearningSuccessOn, today);
    assert.equal(updatedWord.lastLearningCoveredOn, today);
    assert.deepEqual(fetchWord('learning-success-word'), updatedWord);
  });

  test('failed learning completion resets the streak but preserves the last success date', () => {
    insertLearningWordWithItems({
      wordId: 'learning-failure-word',
      learningStreak: 2,
      lastLearningSuccessOn: addDays(today, -2),
      lastLearningCoveredOn: null,
    });

    const updatedWord = dbModule.completeLearningWordSession('learning-failure-word', false);
    assert.equal(updatedWord.status, 'learning');
    assert.equal(updatedWord.learningStreak, 0);
    assert.equal(updatedWord.lastLearningSuccessOn, addDays(today, -2));
    assert.equal(updatedWord.lastLearningCoveredOn, today);
  });

  test('the third consecutive successful learning session graduates a word to review and resets review scheduling', () => {
    insertLearningWordWithItems({
      wordId: 'graduating-word',
      learningStreak: 2,
      lastLearningSuccessOn: addDays(today, -1),
      lastLearningCoveredOn: null,
      intervalHours: 6,
      easeFactor: 2.5,
      nextDueAt: isoHoursAgo(1),
      lastReviewedAt: isoHoursAgo(12),
    });

    const beforeCompletion = new Date();
    const updatedWord = dbModule.completeLearningWordSession('graduating-word', true);
    const afterCompletion = new Date();

    assert.equal(updatedWord.status, 'review');
    assert.equal(updatedWord.learningStreak, 3);
    assert.equal(updatedWord.lastLearningSuccessOn, today);
    assert.equal(updatedWord.lastLearningCoveredOn, today);

    const forwardItem = fetchReviewItem('graduating-word-forward');
    const reverseItem = fetchReviewItem('graduating-word-reverse');

    for (const item of [forwardItem, reverseItem]) {
      assert.equal(item.intervalHours, 24);
      assert.equal(item.easeFactor, 2.5);
      assert.match(item.lastReviewedAt ?? '', isoUtcTimestampPattern);
      assert.match(item.nextDueAt ?? '', isoUtcTimestampPattern);

      // Bound the rewritten timestamps to the completion window so we can verify the reset
      // behavior without hard-coding a fragile exact timestamp.
      const reviewedAt = new Date(item.lastReviewedAt ?? fail('missing lastReviewedAt'));
      const nextDueAt = new Date(item.nextDueAt ?? fail('missing nextDueAt'));
      assert.ok(reviewedAt >= beforeCompletion);
      assert.ok(reviewedAt <= afterCompletion);
      assert.equal(nextDueAt.getTime() - reviewedAt.getTime(), 24 * 60 * 60 * 1000);
    }

    const skillStates = dbModule.getWordSkillStates().filter((state) => state.wordId === 'graduating-word');
    assert.deepEqual(
      skillStates.map((state) => [state.skillId, state.intervalHours, state.easeFactor]),
      [
        ['production', 24, 2.5],
        ['recognition', 24, 2.5],
      ],
    );
    assert(skillStates.every((state) => state.lastStudiedAt !== null && state.nextDueAt !== null));
    assert.deepEqual(dbModule.validateReviewItemStudySchedulerShadow(), []);
  });

  test('learning completion rejects unknown words', () => {
    assert.throws(
      () => dbModule.completeLearningWordSession('missing-word', true),
      /Word not found/,
    );
  });

  test('review completion rejects unknown review items', () => {
    assert.throws(
      () => dbModule.completeReviewItemSession('missing-review-item', 0, 'good'),
      /Review item not found/,
    );
  });

  test('updating word personal notes persists the new notes and returns the updated word', () => {
    insertWord({
      id: 'personal-notes-update-word',
      hanzi: '改',
      pinyin: 'gai',
      meaning: 'old definition',
      examples: ['我改了定义。'],
      status: 'learning',
      priority: 55,
      createdAt: isoHoursAgo(2),
    });

    const updatedWord = dbModule.updateWordPersonalNotes('personal-notes-update-word', 'Remember this collocation.');
    assert.equal(updatedWord.personalNotes, 'Remember this collocation.');
    assert.equal(fetchWord('personal-notes-update-word').personalNotes, 'Remember this collocation.');
    assert.equal(fetchWord('personal-notes-update-word').meaning, 'old definition');
  });

  test('updating word personal notes rejects unknown words', () => {
    assert.throws(
      () => dbModule.updateWordPersonalNotes('missing-word', 'new notes'),
      /Word not found/,
    );
  });

  test('unstudied completion transitions the word into learning', () => {
    insertWord({
      id: 'unstudied-transition-word',
      hanzi: '写',
      pinyin: 'xie',
      meaning: 'write',
      examples: ['我写字。'],
      status: 'unstudied',
      priority: 50,
      createdAt: isoHoursAgo(8),
    });

    insertReviewItem({
      id: 'unstudied-transition-word-forward',
      wordId: 'unstudied-transition-word',
      direction: 'forward',
      intervalHours: 6,
      nextDueAt: null,
    });
    insertReviewItem({
      id: 'unstudied-transition-word-reverse',
      wordId: 'unstudied-transition-word',
      direction: 'reverse',
      intervalHours: 6,
      nextDueAt: null,
    });

    const updatedWord = dbModule.completeUnstudiedWordSession('unstudied-transition-word', studyDayKey);
    assert.equal(updatedWord.status, 'learning');
    assert.equal(updatedWord.learningStreak, 0);
    assert.equal(updatedWord.lastLearningSuccessOn, null);
    assert.equal(updatedWord.lastLearningCoveredOn, today);
    assert.deepEqual(dbModule.getWordSkillStates().filter((state) => state.wordId === 'unstudied-transition-word'), []);
    assert.equal(fetchAdmissionState('unstudied-transition-word'), undefined);
    assert.deepEqual(dbModule.validateReviewItemStudySchedulerShadow(), []);
  });

  test('unstudied completion rejects words with unexpected learning progress already attached', () => {
    insertWord({
      id: 'invalid-unstudied-word',
      hanzi: '写',
      pinyin: 'xie',
      meaning: 'write',
      examples: ['我写字。'],
      status: 'unstudied',
      priority: 50,
      createdAt: isoHoursAgo(8),
      learningStreak: 1,
      lastLearningSuccessOn: addDays(today, -1),
    });

    insertReviewItem({
      id: 'invalid-unstudied-word-forward',
      wordId: 'invalid-unstudied-word',
      direction: 'forward',
      intervalHours: 6,
      nextDueAt: null,
    });
    insertReviewItem({
      id: 'invalid-unstudied-word-reverse',
      wordId: 'invalid-unstudied-word',
      direction: 'reverse',
      intervalHours: 6,
      nextDueAt: null,
    });

    assert.throws(
      () => dbModule.completeUnstudiedWordSession('invalid-unstudied-word', studyDayKey),
      /Unstudied word has unexpected learning progress/,
    );
  });

  test('unstudied completion rejects unknown words', () => {
    assert.throws(
      () => dbModule.completeUnstudiedWordSession('missing-word', studyDayKey),
      /Word not found/,
    );
  });

  test('dismissing an unstudied word keeps it unstudied and persists sunk priority tier', () => {
    insertWord({
      id: 'dismiss-unstudied-word',
      hanzi: '略',
      pinyin: 'lue',
      meaning: 'omit',
      examples: ['先略过。'],
      status: 'unstudied',
      priority: 45,
      createdAt: isoHoursAgo(2),
    });

    dbModule.dismissWordFromStudy('dismiss-unstudied-word');

    const word = fetchWord('dismiss-unstudied-word');
    assert.equal(word.status, 'unstudied');
    assert.equal(word.learningStreak, 0);
    assert.equal(word.lastLearningSuccessOn, null);
    assert.equal(word.lastLearningCoveredOn, null);

    const priorityRow = fetchUserPriorityRow('dismiss-unstudied-word');
    assert.equal(priorityRow?.bump_count, 0);
    assert.equal(priorityRow?.force_top, 0);
    assert.equal(priorityRow?.priority_tier, -1);
  });

  test('dismissing a learning word returns it to unstudied and sinks priority', () => {
    insertLearningWordWithItems({
      wordId: 'dismiss-learning-word',
      learningStreak: 2,
      lastLearningSuccessOn: addDays(today, -1),
      lastLearningCoveredOn: today,
      intervalHours: 24,
      nextDueAt: isoHoursAgo(1),
    });
    insertWordStudyAdmissionState('dismiss-learning-word', isoHoursAgo(1));
    insertWordSkillState('dismiss-learning-word', 'recognition');

    dbModule.dismissWordFromStudy('dismiss-learning-word');

    const word = fetchWord('dismiss-learning-word');
    assert.equal(word.status, 'unstudied');
    assert.equal(word.learningStreak, 0);
    assert.equal(word.lastLearningSuccessOn, null);
    assert.equal(word.lastLearningCoveredOn, null);
    assert.equal(fetchUserPriorityRow('dismiss-learning-word')?.priority_tier, -1);
    assert.equal(fetchAdmissionState('dismiss-learning-word'), undefined);
    assert.equal(fetchWordSkillState('dismiss-learning-word', 'recognition'), undefined);
  });

  test('dismissing rejects unknown words', () => {
    assert.throws(
      () => dbModule.dismissWordFromStudy('missing-word'),
      /Word not found/,
    );
  });
});

function insertReviewWordWithItem(options: {
  wordId: string;
  reviewItemId: string;
  direction: Direction;
  intervalHours: number;
  easeFactor: number;
  nextDueAt: string;
}) {
  insertWord({
    id: options.wordId,
    hanzi: '词',
    pinyin: 'ci',
    meaning: 'word',
    examples: ['例句'],
    status: 'review',
    priority: 100,
    createdAt: isoHoursAgo(72),
  });

  insertReviewItem({
    id: options.reviewItemId,
    wordId: options.wordId,
    direction: options.direction,
    intervalHours: options.intervalHours,
    easeFactor: options.easeFactor,
    nextDueAt: options.nextDueAt,
  });
}

function insertLearningWordWithItems(options: {
  wordId: string;
  learningStreak: number;
  lastLearningSuccessOn: string | null;
  lastLearningCoveredOn: string | null;
  intervalHours?: number;
  easeFactor?: number;
  nextDueAt?: string | null;
  lastReviewedAt?: string | null;
}) {
  insertWord({
    id: options.wordId,
    hanzi: '学',
    pinyin: 'xue',
    meaning: 'learn',
    examples: ['学习'],
    status: 'learning',
    priority: 90,
    createdAt: isoHoursAgo(48),
    learningStreak: options.learningStreak,
    lastLearningSuccessOn: options.lastLearningSuccessOn,
    lastLearningCoveredOn: options.lastLearningCoveredOn,
  });

  insertReviewItem({
    id: `${options.wordId}-forward`,
    wordId: options.wordId,
    direction: 'forward',
    intervalHours: options.intervalHours ?? 6,
    easeFactor: options.easeFactor ?? 2.5,
    nextDueAt: options.nextDueAt ?? null,
    lastReviewedAt: options.lastReviewedAt ?? null,
  });
  insertReviewItem({
    id: `${options.wordId}-reverse`,
    wordId: options.wordId,
    direction: 'reverse',
    intervalHours: options.intervalHours ?? 6,
    easeFactor: options.easeFactor ?? 2.5,
    nextDueAt: options.nextDueAt ?? null,
    lastReviewedAt: options.lastReviewedAt ?? null,
  });
}

function fetchWord(wordId: string) {
  return dbModule.getWords().find((word) => word.id === wordId) ?? fail(`Missing word ${wordId}`);
}

function fetchReviewItem(reviewItemId: string) {
  return dbModule.getReviewItems().find((item) => item.id === reviewItemId) ?? fail(`Missing review item ${reviewItemId}`);
}

function fetchWordSkillState(wordId: string, skillId: StudySkillId) {
  return dbModule.getWordSkillStates().find((state) => state.wordId === wordId && state.skillId === skillId);
}

function fetchAdmissionState(wordId: string) {
  return dbModule.getWordStudyAdmissionStates().find((state) => state.wordId === wordId);
}

function fetchUserPriorityRow(wordId: string) {
  return sqlite
    .prepare(`
      SELECT
        bump_count,
        force_top,
        priority_tier
      FROM user_word_priority
      WHERE word_id = ?
    `)
    .get(wordId) as { bump_count: number; force_top: number; priority_tier: number } | undefined;
}

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

function insertWordStudyAdmissionState(wordId: string, earliestNextStudyAt: string | null) {
  sqlite.prepare(`
    INSERT INTO word_study_admission_state (
      word_id,
      study_phase,
      earliest_next_study_at
    ) VALUES (?, ?, ?)
  `).run(wordId, 'review', earliestNextStudyAt);
}

function insertWordSkillState(wordId: string, skillId: StudySkillId) {
  sqlite.prepare(`
    INSERT INTO word_skill_state (
      word_id,
      skill_id,
      enabled,
      interval_hours,
      last_studied_at,
      next_due_at,
      ease_factor
    ) VALUES (?, ?, 1, 24, ?, ?, 2.5)
  `).run(wordId, skillId, isoHoursAgo(25), isoHoursAgo(1));
}

function isoHoursAgo(hours: number) {
  return addHours(new Date().toISOString(), -hours);
}

function addHours(isoTimestamp: string, hours: number) {
  const date = new Date(isoTimestamp);
  date.setUTCHours(date.getUTCHours() + hours);
  return date.toISOString();
}

function addDays(dateKey: string, days: number) {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function fail(message: string): never {
  throw new Error(message);
}

const isoUtcTimestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
