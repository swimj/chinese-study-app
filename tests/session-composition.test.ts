import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, before, beforeEach, describe, test } from 'node:test';
import { pathToFileURL } from 'node:url';

type WordStatus = 'unstudied' | 'learning' | 'review';
type Direction = 'forward' | 'reverse';
type StudySkillId = 'recognition' | 'production';

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
const studyDayKey = today;

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
      DELETE FROM study_attempt_events;
      DELETE FROM study_sessions;
      DELETE FROM daily_new_word_intake;
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

    const sessionIds = getSessionItemIds(dbModule);
    assert.deepEqual(sessionIds, ['review-word-forward']);
  });

  test('admits review words from word skill urgency instead of legacy review item due dates', () => {
    insertWord({
      id: 'skill-urgent-word',
      hanzi: '急',
      pinyin: 'ji',
      meaning: 'urgent',
      examples: ['事情很急。'],
      status: 'review',
      priority: 100,
      createdAt: isoHoursAgo(96),
    });

    insertReviewItem({
      id: 'skill-urgent-word-forward',
      wordId: 'skill-urgent-word',
      direction: 'forward',
      intervalHours: 24,
      lastReviewedAt: isoHoursAgo(25),
      nextDueAt: isoHoursFromNow(24),
    });
    insertWordStudyAdmissionState('skill-urgent-word', null);
    insertWordSkillState({
      wordId: 'skill-urgent-word',
      skillId: 'recognition',
      intervalHours: 24,
      lastStudiedAt: isoHoursAgo(25),
      nextDueAt: isoHoursFromNow(24),
    });

    assert.deepEqual(getSessionItemIds(dbModule), ['skill-urgent-word-forward']);
  });

  test('suppresses legacy-due review items when word skill urgency is below threshold', () => {
    insertWord({
      id: 'skill-not-urgent-word',
      hanzi: '缓',
      pinyin: 'huan',
      meaning: 'slow',
      examples: ['动作很缓。'],
      status: 'review',
      priority: 100,
      createdAt: isoHoursAgo(96),
    });

    insertReviewItem({
      id: 'skill-not-urgent-word-forward',
      wordId: 'skill-not-urgent-word',
      direction: 'forward',
      intervalHours: 24,
      lastReviewedAt: isoHoursAgo(2),
      nextDueAt: isoHoursAgo(1),
    });
    insertWordStudyAdmissionState('skill-not-urgent-word', null);
    insertWordSkillState({
      wordId: 'skill-not-urgent-word',
      skillId: 'recognition',
      intervalHours: 24,
      lastStudiedAt: isoHoursAgo(2),
      nextDueAt: isoHoursAgo(1),
    });

    assert.deepEqual(getSessionItemIds(dbModule), []);
  });

  test('admits a review word once when both skills are overdue and chooses the most urgent skill', () => {
    insertWord({
      id: 'both-skills-overdue-word',
      hanzi: '选',
      pinyin: 'xuan',
      meaning: 'choose',
      examples: ['请选择一个。'],
      status: 'review',
      priority: 100,
      createdAt: isoHoursAgo(120),
    });

    insertReviewItem({
      id: 'both-skills-overdue-word-forward',
      wordId: 'both-skills-overdue-word',
      direction: 'forward',
      intervalHours: 24,
      lastReviewedAt: isoHoursAgo(72),
      nextDueAt: isoHoursAgo(48),
    });
    insertReviewItem({
      id: 'both-skills-overdue-word-reverse',
      wordId: 'both-skills-overdue-word',
      direction: 'reverse',
      intervalHours: 24,
      lastReviewedAt: isoHoursAgo(36),
      nextDueAt: isoHoursAgo(12),
    });
    insertWordStudyAdmissionState('both-skills-overdue-word', null);
    insertWordSkillState({
      wordId: 'both-skills-overdue-word',
      skillId: 'recognition',
      intervalHours: 24,
      lastStudiedAt: isoHoursAgo(72),
      nextDueAt: isoHoursAgo(48),
    });
    insertWordSkillState({
      wordId: 'both-skills-overdue-word',
      skillId: 'production',
      intervalHours: 24,
      lastStudiedAt: isoHoursAgo(36),
      nextDueAt: isoHoursAgo(12),
    });

    assert.deepEqual(getSessionItemIds(dbModule), ['both-skills-overdue-word-forward']);
  });

  test('uses next due time as a deterministic tie-breaker when both overdue skills have equal urgency', () => {
    insertWord({
      id: 'equal-urgency-word',
      hanzi: '平',
      pinyin: 'ping',
      meaning: 'level',
      examples: ['路很平。'],
      status: 'review',
      priority: 100,
      createdAt: isoHoursAgo(120),
    });

    insertReviewItem({
      id: 'equal-urgency-word-forward',
      wordId: 'equal-urgency-word',
      direction: 'forward',
      intervalHours: 24,
      lastReviewedAt: isoHoursAgo(48),
      nextDueAt: isoHoursAgo(6),
    });
    insertReviewItem({
      id: 'equal-urgency-word-reverse',
      wordId: 'equal-urgency-word',
      direction: 'reverse',
      intervalHours: 12,
      lastReviewedAt: isoHoursAgo(24),
      nextDueAt: isoHoursAgo(12),
    });
    insertWordStudyAdmissionState('equal-urgency-word', null);
    insertWordSkillState({
      wordId: 'equal-urgency-word',
      skillId: 'recognition',
      intervalHours: 24,
      lastStudiedAt: isoHoursAgo(48),
      nextDueAt: isoHoursAgo(6),
    });
    insertWordSkillState({
      wordId: 'equal-urgency-word',
      skillId: 'production',
      intervalHours: 12,
      lastStudiedAt: isoHoursAgo(24),
      nextDueAt: isoHoursAgo(12),
    });

    assert.deepEqual(getSessionItemIds(dbModule), ['equal-urgency-word-reverse']);
  });

  test('recency guard suppresses the remaining overdue skill after a word-level review admission is completed', () => {
    insertWord({
      id: 'guarded-after-completion-word',
      hanzi: '隔',
      pinyin: 'ge',
      meaning: 'separate',
      examples: ['隔一段时间再看。'],
      status: 'review',
      priority: 100,
      createdAt: isoHoursAgo(120),
    });

    insertReviewItem({
      id: 'guarded-after-completion-word-forward',
      wordId: 'guarded-after-completion-word',
      direction: 'forward',
      intervalHours: 24,
      lastReviewedAt: isoHoursAgo(72),
      nextDueAt: isoHoursAgo(48),
    });
    insertReviewItem({
      id: 'guarded-after-completion-word-reverse',
      wordId: 'guarded-after-completion-word',
      direction: 'reverse',
      intervalHours: 24,
      lastReviewedAt: isoHoursAgo(36),
      nextDueAt: isoHoursAgo(12),
    });
    insertWordStudyAdmissionState('guarded-after-completion-word', null);
    insertWordSkillState({
      wordId: 'guarded-after-completion-word',
      skillId: 'recognition',
      intervalHours: 24,
      lastStudiedAt: isoHoursAgo(72),
      nextDueAt: isoHoursAgo(48),
    });
    insertWordSkillState({
      wordId: 'guarded-after-completion-word',
      skillId: 'production',
      intervalHours: 24,
      lastStudiedAt: isoHoursAgo(36),
      nextDueAt: isoHoursAgo(12),
    });

    assert.deepEqual(getSessionItemIds(dbModule), ['guarded-after-completion-word-forward']);

    dbModule.recordAcceptedReviewAttemptBatch({
      sessionId: 'guarded-after-completion-word-session',
      events: [
        {
          id: 'guarded-after-completion-word-attempt-1',
          occurredAt: '2026-05-10T00:00:00.000Z',
          sessionId: 'guarded-after-completion-word-session',
          sessionActionId: 'guarded-after-completion-word-session/action-1',
          sessionEventSequence: 1,
          actionAttemptSequence: 1,
          actionKind: 'recognition',
          targetWordId: 'guarded-after-completion-word',
          sampledSkillIds: ['recognition'],
          response: null,
          outcome: 'correct',
          rating: 'good',
          contentRef: null,
          metadata: {},
        },
      ],
      commitIntent: {
        type: 'commit-review-item-session',
        reviewItemId: 'guarded-after-completion-word-forward',
        failureCount: 0,
        terminalRating: 'good',
      },
    });

    // guarded-after-completion-word-reverse also meets the urgency threshold, but it is
    // suppressed because completion resets the recency guard for the word.
    assert.deepEqual(getSessionItemIds(dbModule), []);
  });

  test('orders admitted review words by selected skill urgency before legacy direction ordering', () => {
    insertWord({
      id: 'less-urgent-production-word',
      hanzi: '低',
      pinyin: 'di',
      meaning: 'low',
      examples: ['声音很低。'],
      status: 'review',
      priority: 100,
      createdAt: isoHoursAgo(120),
    });
    insertWord({
      id: 'more-urgent-recognition-word',
      hanzi: '高',
      pinyin: 'gao',
      meaning: 'high',
      examples: ['山很高。'],
      status: 'review',
      priority: 100,
      createdAt: isoHoursAgo(120),
    });

    insertReviewItem({
      id: 'less-urgent-production-word-reverse',
      wordId: 'less-urgent-production-word',
      direction: 'reverse',
      intervalHours: 24,
      lastReviewedAt: isoHoursAgo(36),
      nextDueAt: isoHoursAgo(12),
    });
    insertReviewItem({
      id: 'more-urgent-recognition-word-forward',
      wordId: 'more-urgent-recognition-word',
      direction: 'forward',
      intervalHours: 24,
      lastReviewedAt: isoHoursAgo(72),
      nextDueAt: isoHoursAgo(48),
    });
    insertWordStudyAdmissionState('less-urgent-production-word', null);
    insertWordStudyAdmissionState('more-urgent-recognition-word', null);
    insertWordSkillState({
      wordId: 'less-urgent-production-word',
      skillId: 'production',
      intervalHours: 24,
      lastStudiedAt: isoHoursAgo(36),
      nextDueAt: isoHoursAgo(12),
    });
    insertWordSkillState({
      wordId: 'more-urgent-recognition-word',
      skillId: 'recognition',
      intervalHours: 24,
      lastStudiedAt: isoHoursAgo(72),
      nextDueAt: isoHoursAgo(48),
    });

    assert.deepEqual(getSessionItemIds(dbModule), [
      'more-urgent-recognition-word-forward',
      'less-urgent-production-word-reverse',
    ]);
  });

  test('home overview reports due review, uncovered learning, and limited new-word intake counts', () => {
    const { dailyNewWordLimit } = dbModule.getLearningPolicy(studyDayKey);

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

    assert.deepEqual(dbModule.getHomeOverview(studyDayKey), {
      dueReviewItemCount: 1,
      pendingLearningWordCount: 1,
      newWordIntroCount: Math.min(3, dailyNewWordLimit),
      hasSessionWork: true,
    });
  });

  test('orders due review words by selected skill urgency', () => {
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

    const sessionIds = getSessionItemIds(dbModule);
    assert.deepEqual(sessionIds, [
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

    const sessionIds = getSessionItemIds(dbModule);
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

    const sessionIds = getSessionItemIds(dbModule);
    assert.deepEqual(sessionIds, []);
  });

  test('caps unstudied intake without requiring intra-bucket ordering', () => {
    const { dailyNewWordLimit } = dbModule.getLearningPolicy(studyDayKey);
    const totalUnstudiedWords = dailyNewWordLimit + 1;

    const words = Array.from({ length: totalUnstudiedWords }, (_, index) => {
      const isTopPriorityPair = index < 2;
      const day = String(index + 1).padStart(2, '0');
      return {
        id: `unstudied-${index + 1}`,
        hanzi: `词${index + 1}`,
        pinyin: `ci ${index + 1}`,
        meaning: `word ${index + 1}`,
        examples: [`例句 ${index + 1}`],
        status: 'unstudied' as const,
        priority: isTopPriorityPair ? 50 : 40 - index,
        createdAt: `2026-01-${day}T00:00:00.000Z`,
      };
    });

    for (const word of words) {
      insertWord(word);
    }

    for (const { id: wordId } of words) {
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

    const sessionIds = getSessionItemIds(dbModule);
    assert.equal(sessionIds.length, dailyNewWordLimit * 2);

    const sessionIdSet = new Set(sessionIds);
    assert.equal(sessionIdSet.has('unstudied-1-forward'), true);
    assert.equal(sessionIdSet.has('unstudied-1-reverse'), true);
    assert.equal(sessionIdSet.has('unstudied-2-forward'), true);
    assert.equal(sessionIdSet.has('unstudied-2-reverse'), true);

    assert.equal(sessionIds.includes(`unstudied-${totalUnstudiedWords}-forward`), false);
    assert.equal(sessionIds.includes(`unstudied-${totalUnstudiedWords}-reverse`), false);
  });

  test('includes required unstudied words beyond the normal daily cap', () => {
    const { dailyNewWordLimit } = dbModule.getLearningPolicy(studyDayKey);
    const totalUnstudiedWords = dailyNewWordLimit + 2;

    for (let index = 0; index < totalUnstudiedWords; index += 1) {
      const day = String(index + 1).padStart(2, '0');
      insertUnstudiedWordPair(`required-overflow-${index + 1}`, 100 - index, `2026-03-${day}T00:00:00.000Z`);
    }

    const requiredOverflowId = `required-overflow-${totalUnstudiedWords}`;
    dbModule.updateWordUserPriority(requiredOverflowId, { requiredForNextSession: true });

    const sessionIds = getSessionItemIds(dbModule);
    assert.equal(sessionIds.length, (dailyNewWordLimit + 1) * 2);
    const sessionIdSet = new Set(sessionIds);
    assert.equal(sessionIdSet.has(`${requiredOverflowId}-forward`), true);
    assert.equal(sessionIdSet.has(`${requiredOverflowId}-reverse`), true);
  });

  test('does not duplicate required words that are already inside the normal cap', () => {
    const { dailyNewWordLimit } = dbModule.getLearningPolicy(studyDayKey);

    for (let index = 0; index < dailyNewWordLimit + 1; index += 1) {
      const day = String(index + 1).padStart(2, '0');
      insertUnstudiedWordPair(`required-no-dupe-${index + 1}`, 100 - index, `2026-04-${day}T00:00:00.000Z`);
    }

    dbModule.updateWordUserPriority('required-no-dupe-1', { requiredForNextSession: true });

    const sessionIds = getSessionItemIds(dbModule);
    assert.equal(sessionIds.length, dailyNewWordLimit * 2);
    assert.equal(sessionIds.filter((id) => id.startsWith('required-no-dupe-1-')).length, 2);
    assert.equal(sessionIds.includes('required-no-dupe-11-forward'), false);
  });

  test('does not admit dismissed required words as overflow', () => {
    const { dailyNewWordLimit } = dbModule.getLearningPolicy(studyDayKey);

    for (let index = 0; index < dailyNewWordLimit + 1; index += 1) {
      const day = String(index + 1).padStart(2, '0');
      insertUnstudiedWordPair(`required-dismissed-${index + 1}`, 100 - index, `2026-05-${day}T00:00:00.000Z`);
    }

    const dismissedRequiredId = `required-dismissed-${dailyNewWordLimit + 1}`;
    dbModule.updateWordUserPriority(dismissedRequiredId, { requiredForNextSession: true });
    dbModule.dismissWordFromStudy(dismissedRequiredId);

    const sessionIds = getSessionItemIds(dbModule);
    assert.equal(sessionIds.length, dailyNewWordLimit * 2);
    assert.equal(sessionIds.includes(`${dismissedRequiredId}-forward`), false);
    assert.equal(sessionIds.includes(`${dismissedRequiredId}-reverse`), false);
  });

  test('unstudied completion clears required state', () => {
    insertUnstudiedWordPair('required-completed', 100, '2026-06-01T00:00:00.000Z');

    dbModule.updateWordUserPriority('required-completed', { requiredForNextSession: true });
    dbModule.completeUnstudiedWordSession('required-completed', studyDayKey);

    const priorityRow = sqlite
      .prepare('SELECT required_for_next_session FROM user_word_priority WHERE word_id = ?')
      .get('required-completed') as { required_for_next_session: number } | undefined;
    assert.equal(priorityRow?.required_for_next_session, 0);
  });

  test('completing an unstudied word reduces same-day remaining intake across sessions', () => {
    const { dailyNewWordLimit } = dbModule.getLearningPolicy(studyDayKey);

    const words = Array.from({ length: dailyNewWordLimit + 1 }, (_, index) => {
      const day = String(index + 1).padStart(2, '0');
      return {
        id: `cross-session-${index + 1}`,
        hanzi: `跨${index + 1}`,
        pinyin: `kua ${index + 1}`,
        meaning: `cross ${index + 1}`,
        examples: [`cross ${index + 1}`],
        status: 'unstudied' as const,
        priority: 100 - index,
        createdAt: `2026-02-${day}T00:00:00.000Z`,
      };
    });

    for (const word of words) {
      insertWord(word);
      insertReviewItem({
        id: `${word.id}-forward`,
        wordId: word.id,
        direction: 'forward',
        intervalHours: 6,
        nextDueAt: null,
      });
      insertReviewItem({
        id: `${word.id}-reverse`,
        wordId: word.id,
        direction: 'reverse',
        intervalHours: 6,
        nextDueAt: null,
      });
    }

    const beforeCompletionIds = getSessionItemIds(dbModule);
    assert.equal(beforeCompletionIds.length, dailyNewWordLimit * 2);

    dbModule.completeUnstudiedWordSession(words[0].id, studyDayKey);

    const afterCompletionIds = getSessionItemIds(dbModule);
    assert.equal(afterCompletionIds.length, (dailyNewWordLimit - 1) * 2);
    assert.equal(afterCompletionIds.includes(`${words[0].id}-forward`), false);
    assert.equal(afterCompletionIds.includes(`${words[0].id}-reverse`), false);
    assert.equal(afterCompletionIds.includes(`${words[dailyNewWordLimit].id}-forward`), false);
    assert.equal(afterCompletionIds.includes(`${words[dailyNewWordLimit].id}-reverse`), false);
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

    const payload = dbModule.getSessionPayload(studyDayKey);

    const payloadItems = [
      ...payload.buckets.review,
      ...payload.buckets.learning,
      ...payload.buckets.unstudied,
    ];

    assert.deepEqual(payloadItems.map((item) => item.reviewItem.id), [
      'payload-review-word-forward',
      'payload-learning-word-reverse',
      'payload-learning-word-forward',
    ]);
    assert.deepEqual(
      [...new Set(payloadItems.map((item) => item.word.id))],
      [
      'payload-review-word',
      'payload-learning-word',
      ],
    );
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

    const sessionIds = getSessionItemIds(dbModule);
    assert.deepEqual(sessionIds.slice(0, 3), [
       'review-word-forward',
       'learning-word-reverse',
       'learning-word-forward',
    ]);
    assert.deepEqual(new Set(sessionIds.slice(3)), new Set([
      'unstudied-word-forward',
      'unstudied-word-reverse',
    ]));
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

    assert.deepEqual(new Set(getSessionItemIds(dbModule)), new Set([
      'new-word-forward',
      'new-word-reverse',
    ]));

    const updatedWord = dbModule.completeUnstudiedWordSession('new-word', studyDayKey);
    assert.equal(updatedWord.status, 'learning');
    assert.equal(updatedWord.lastLearningCoveredOn, today);
    assert.deepEqual(getSessionItemIds(dbModule), []);

    // Simulate the next UTC day by moving the persisted coverage marker back one day.
    // This is standing in for clock control until we introduce an explicit backend clock seam.
    sqlite.prepare(`
      UPDATE words
      SET last_learning_covered_on = ?
      WHERE id = 'new-word'
    `).run(yesterday);

    assert.deepEqual(new Set(getSessionItemIds(dbModule)), new Set([
      'new-word-reverse',
      'new-word-forward',
    ]));
  });

  test('refuses to compose a session while accepted attempt events remain unprojected', () => {
    insertWord({
      id: 'unprojected-event-word',
      hanzi: '迟',
      pinyin: 'chi',
      meaning: 'late',
      examples: ['他迟到了。'],
      status: 'review',
      priority: 100,
      createdAt: isoHoursAgo(96),
    });
    insertReviewItem({
      id: 'unprojected-event-word-forward',
      wordId: 'unprojected-event-word',
      direction: 'forward',
      intervalHours: 24,
      nextDueAt: isoHoursAgo(1),
    });
    insertUnprojectedAttemptEvent({
      id: 'unprojected-event-word-attempt-1',
      sessionId: 'unprojected-event-session',
      sessionActionId: 'unprojected-event-session/action-1',
      targetWordId: 'unprojected-event-word',
      actionKind: 'recognition',
      sampledSkillIds: ['recognition'],
    });

    assert.throws(
      () => dbModule.getSessionPayload(studyDayKey),
      /Session composition invariant violated: accepted attempt event "unprojected-event-word-attempt-1" from session "unprojected-event-session" has not been projected\./,
    );
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
  const lastReviewedAt = record.lastReviewedAt ?? inferLastReviewedAt(record.nextDueAt ?? null, record.intervalHours);
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
    lastReviewedAt,
    record.nextDueAt ?? null,
    record.easeFactor ?? 2.5,
  );

  const word = sqlite.prepare(`
    SELECT status
    FROM words
    WHERE id = ?
  `).get(record.wordId) as { status: WordStatus } | undefined;

  if (word?.status !== 'review' || lastReviewedAt === null) {
    return;
  }

  insertWordStudyAdmissionState(record.wordId, null);
  insertWordSkillState({
    wordId: record.wordId,
    skillId: record.direction === 'forward' ? 'recognition' : 'production',
    intervalHours: record.intervalHours,
    lastStudiedAt: lastReviewedAt,
    nextDueAt: record.nextDueAt ?? null,
    easeFactor: record.easeFactor ?? 2.5,
  });
}

function insertWordStudyAdmissionState(wordId: string, earliestNextStudyAt: string | null) {
  sqlite.prepare(`
    INSERT INTO word_study_admission_state (
      word_id,
      study_phase,
      earliest_next_study_at
    ) VALUES (?, ?, ?)
    ON CONFLICT(word_id) DO UPDATE SET
      study_phase = excluded.study_phase,
      earliest_next_study_at = excluded.earliest_next_study_at
  `).run(wordId, 'review', earliestNextStudyAt);
}

function insertWordSkillState({
  wordId,
  skillId,
  intervalHours,
  lastStudiedAt,
  nextDueAt,
  enabled = true,
  easeFactor = 2.5,
}: {
  wordId: string;
  skillId: StudySkillId;
  intervalHours: number;
  lastStudiedAt: string;
  nextDueAt: string | null;
  enabled?: boolean;
  easeFactor?: number;
}) {
  sqlite.prepare(`
    INSERT INTO word_skill_state (
      word_id,
      skill_id,
      enabled,
      interval_hours,
      last_studied_at,
      next_due_at,
      ease_factor
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(word_id, skill_id) DO UPDATE SET
      enabled = excluded.enabled,
      interval_hours = excluded.interval_hours,
      last_studied_at = excluded.last_studied_at,
      next_due_at = excluded.next_due_at,
      ease_factor = excluded.ease_factor
  `).run(wordId, skillId, enabled ? 1 : 0, intervalHours, lastStudiedAt, nextDueAt, easeFactor);
}

function insertUnprojectedAttemptEvent({
  id,
  sessionId,
  sessionActionId,
  targetWordId,
  actionKind,
  sampledSkillIds,
}: {
  id: string;
  sessionId: string;
  sessionActionId: string;
  targetWordId: string;
  actionKind: 'recognition' | 'production';
  sampledSkillIds: StudySkillId[];
}) {
  sqlite.prepare(`
    INSERT INTO study_sessions (
      id,
      started_at,
      ended_at,
      processing_state,
      processed_at
    ) VALUES (?, ?, NULL, 'open', NULL)
  `).run(sessionId, '2026-05-10T00:00:00.000Z');

  sqlite.prepare(`
    INSERT INTO study_attempt_events (
      id,
      occurred_at,
      session_id,
      session_action_id,
      session_event_sequence,
      action_attempt_sequence,
      action_kind,
      target_word_id,
      sampled_skill_ids_json,
      response,
      outcome,
      rating,
      content_ref_json,
      metadata_json,
      projected_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
  `).run(
    id,
    '2026-05-10T00:05:00.000Z',
    sessionId,
    sessionActionId,
    1,
    1,
    actionKind,
    targetWordId,
    JSON.stringify(sampledSkillIds),
    null,
    'correct',
    'good',
    null,
    JSON.stringify({}),
  );
}

function inferLastReviewedAt(nextDueAt: string | null, intervalHours: number) {
  return nextDueAt ? shiftHours(nextDueAt, -intervalHours) : null;
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

function getSessionItemIds(db: DbModule): string[] {
  const payload = db.getSessionPayload(studyDayKey);
  return [
    ...payload.buckets.review,
    ...payload.buckets.learning,
    ...payload.buckets.unstudied,
  ].map((item) => item.reviewItem.id);
}
