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

type ReviewAttemptInput = {
  rating: 'forgot' | 'hard' | 'good' | 'easy';
  outcome: 'correct' | 'incorrect';
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
      DELETE FROM study_attempt_events;
      DELETE FROM study_sessions;
      DELETE FROM daily_new_word_intake;
      DELETE FROM review_session_summaries;
      DELETE FROM word_skill_state;
      DELETE FROM word_study_admission_state;
      DELETE FROM words;
    `);
  });

  after(() => {
    sqlite.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  test('recording an accepted review attempt batch projects scheduler state', () => {
    insertReviewWordWithItem({
      wordId: 'hard-word',
      sessionActionId: 'hard-word-forward',
      direction: 'forward',
      intervalHours: 10,
      easeFactor: 2.5,
      nextDueAt: isoHoursAgo(1),
    });
    insertWordStudyAdmissionState('hard-word', null);
    insertWordSkillState('hard-word', 'recognition', {
      intervalHours: 10,
      lastStudiedAt: isoHoursAgo(48),
      nextDueAt: isoHoursAgo(1),
      easeFactor: 2.5,
    });

    const { state: updatedState } = recordAcceptedReviewBatch({
      sessionActionId: 'hard-word-forward',
      wordId: 'hard-word',
      actionKind: 'recognition',
      skillId: 'recognition',
      rating: 'hard',
      outcome: 'correct',
      failureCount: 0,
      terminalRating: 'hard',
    });
    assert.equal(updatedState.intervalHours, 15); // 15 = 10 * 1.5 (hard pass multiplier)
    assert.equal(updatedState.easeFactor, 2.35); // 2.35 = 2.5 - 0.15 (hard pass easeFactor penalty)
    // We only care that completion writes a real UTC timestamp, not the exact wall-clock instant.
    assert.match(updatedState.lastStudiedAt, isoUtcTimestampPattern);
    assert.equal(
      updatedState.nextDueAt,
      addHours(updatedState.lastStudiedAt, updatedState.intervalHours),
    );

    assert.deepEqual(fetchWordSkillState('hard-word', 'recognition'), {
      wordId: 'hard-word',
      skillId: 'recognition',
      enabled: true,
      intervalHours: updatedState.intervalHours,
      lastStudiedAt: updatedState.lastStudiedAt,
      nextDueAt: updatedState.nextDueAt,
      easeFactor: updatedState.easeFactor,
    });
    assert.equal(fetchAdmissionState('hard-word')?.earliestNextStudyAt, addHours(
      updatedState.lastStudiedAt,
      6,
    ));
    assert.equal(fetchAttemptProjectedAt('review/hard-word/recognition-attempt-1'), updatedState.lastStudiedAt);
  });

  test('recording an accepted review attempt batch does not require a backing review action row', () => {
    insertWord({
      id: 'action-only-word',
      hanzi: '行',
      pinyin: 'xing',
      meaning: 'OK',
      examples: ['这样也行。'],
      status: 'review',
      priority: 100,
      createdAt: isoHoursAgo(72),
    });
    insertWordStudyAdmissionState('action-only-word', null);
    insertWordSkillState('action-only-word', 'recognition', {
      intervalHours: 10,
      lastStudiedAt: isoHoursAgo(48),
      nextDueAt: isoHoursAgo(1),
      easeFactor: 2.5,
    });

    const { state: updatedState } = recordAcceptedReviewBatch({
      sessionActionId: 'action-only-word-forward',
      wordId: 'action-only-word',
      actionKind: 'recognition',
      skillId: 'recognition',
      rating: 'good',
      outcome: 'correct',
      failureCount: 0,
      terminalRating: 'good',
    });

    assert.equal(updatedState.intervalHours, 25);
    assert.equal(updatedState.easeFactor, 2.5);
    assert.equal(updatedState.nextDueAt, addHours(updatedState.lastStudiedAt, 25));
  });

  test('accepted review attempt batch rejects commit intents that do not match events', () => {
    insertReviewWordWithItem({
      wordId: 'mismatch-word',
      sessionActionId: 'mismatch-word-forward',
      direction: 'forward',
      intervalHours: 10,
      easeFactor: 2.5,
      nextDueAt: isoHoursAgo(1),
    });
    insertWordStudyAdmissionState('mismatch-word', null);
    insertWordSkillState('mismatch-word', 'recognition', {
      intervalHours: 10,
      lastStudiedAt: isoHoursAgo(48),
      nextDueAt: isoHoursAgo(1),
      easeFactor: 2.5,
    });

    assert.throws(
      () =>
        recordAcceptedReviewBatch({
          sessionActionId: 'mismatch-word-forward',
          wordId: 'mismatch-word',
          actionKind: 'recognition',
          skillId: 'recognition',
          rating: 'good',
          outcome: 'correct',
          failureCount: 1, // nonzero failure count cannot be considered a correct outcome
          terminalRating: null,
        }),
      /do not match supplied review commit intent/,
    );

    assert.equal(dbModule.getStudyAttemptEventsForSession('mismatch-word-forward-session').length, 0);
  });

  test('accepted review attempt batch rejects action intents that do not match event target skill', () => {
    insertReviewWordWithItem({
      wordId: 'skill-mismatch-word',
      sessionActionId: 'skill-mismatch-word-reverse',
      direction: 'reverse',
      intervalHours: 10,
      easeFactor: 2.5,
      nextDueAt: isoHoursAgo(1),
    });
    insertWordStudyAdmissionState('skill-mismatch-word', null);
    insertWordSkillState('skill-mismatch-word', 'recognition', {
      intervalHours: 10,
      lastStudiedAt: isoHoursAgo(48),
      nextDueAt: isoHoursAgo(1),
      easeFactor: 2.5,
    });

    assert.throws(
      () =>
        dbModule.recordAcceptedReviewAttemptBatch({
          sessionId: 'skill-mismatch-word-session',
          events: [
            {
              id: 'skill-mismatch-word-attempt-1',
              occurredAt: '2026-05-10T00:00:00.000Z',
              sessionId: 'skill-mismatch-word-session',
              sessionActionId: 'review/skill-mismatch-word/recognition',
              sessionEventSequence: 1,
              actionAttemptSequence: 1,
              actionKind: 'recognition',
              targetWordId: 'skill-mismatch-word',
              sampledSkillIds: ['recognition'],
              response: null,
              outcome: 'correct',
              rating: 'good',
              contentRef: null,
              metadata: {},
            },
          ],
          commitIntent: {
            type: 'commit-review-action-session',
            sessionActionId: 'review/skill-mismatch-word/production',
            targetWordId: 'skill-mismatch-word',
            actionKind: 'production',
            sampledSkillIds: ['production'],
            failureCount: 0,
            terminalRating: 'good',
          },
        }),
      /do not match supplied review action intent/,
    );

    assert.equal(dbModule.getStudyAttemptEventsForSession('skill-mismatch-word-session').length, 0);
  });

  test('recording a clean good review attempt batch multiplies by ease and projects scheduler state', () => {
    insertReviewWordWithItem({
      wordId: 'good-word',
      sessionActionId: 'good-word-forward',
      direction: 'forward',
      intervalHours: 21,
      easeFactor: 2.5,
      nextDueAt: isoHoursAgo(1),
    });
    insertWordStudyAdmissionState('good-word', null);
    insertWordSkillState('good-word', 'recognition', {
      intervalHours: 21,
      lastStudiedAt: isoHoursAgo(48),
      nextDueAt: isoHoursAgo(1),
      easeFactor: 2.5,
    });

    const { state: updatedState } = recordAcceptedReviewBatch({
      sessionActionId: 'good-word-forward',
      wordId: 'good-word',
      actionKind: 'recognition',
      skillId: 'recognition',
      rating: 'good',
      outcome: 'correct',
      failureCount: 0,
      terminalRating: 'good',
    });

    assert.equal(updatedState.intervalHours, 53); // ceil(21 * 2.5) = ceil(52.5) = 53
    assert.equal(updatedState.easeFactor, 2.5);
    assert.equal(
      updatedState.nextDueAt,
      addHours(updatedState.lastStudiedAt, 53),
    );
    assertProjectedReviewState('good-word', 'recognition', updatedState);
  });

  test('recording a reverse review attempt batch projects production skill state', () => {
    insertReviewWordWithItem({
      wordId: 'production-word',
      sessionActionId: 'production-word-reverse',
      direction: 'reverse',
      intervalHours: 12,
      easeFactor: 2.5,
      nextDueAt: isoHoursAgo(1),
    });
    insertWordStudyAdmissionState('production-word', null);
    insertWordSkillState('production-word', 'production', {
      intervalHours: 12,
      lastStudiedAt: isoHoursAgo(48),
      nextDueAt: isoHoursAgo(1),
      easeFactor: 2.5,
    });

    const { state: updatedState } = recordAcceptedReviewBatch({
      sessionActionId: 'production-word-reverse',
      wordId: 'production-word',
      actionKind: 'production',
      skillId: 'production',
      rating: 'good',
      outcome: 'correct',
      failureCount: 0,
      terminalRating: 'good',
    });

    assert.deepEqual(fetchWordSkillState('production-word', 'production'), {
      wordId: 'production-word',
      skillId: 'production',
      enabled: true,
      intervalHours: updatedState.intervalHours,
      lastStudiedAt: updatedState.lastStudiedAt,
      nextDueAt: updatedState.nextDueAt,
      easeFactor: updatedState.easeFactor,
    });
    assert.equal(fetchWordSkillState('production-word', 'recognition'), undefined);
  });

  test('recording a clean easy review attempt batch uses the easy bonus and projects scheduler state', () => {
    insertReviewWordWithItem({
      wordId: 'easy-word',
      sessionActionId: 'easy-word-forward',
      direction: 'forward',
      intervalHours: 20,
      easeFactor: 2.5,
      nextDueAt: isoHoursAgo(1),
    });
    insertWordStudyAdmissionState('easy-word', null);
    insertWordSkillState('easy-word', 'recognition', {
      intervalHours: 20,
      lastStudiedAt: isoHoursAgo(48),
      nextDueAt: isoHoursAgo(1),
      easeFactor: 2.5,
    });

    const { state: updatedState } = recordAcceptedReviewBatch({
      sessionActionId: 'easy-word-forward',
      wordId: 'easy-word',
      actionKind: 'recognition',
      skillId: 'recognition',
      rating: 'easy',
      outcome: 'correct',
      failureCount: 0,
      terminalRating: 'easy',
    });

    assert.equal(updatedState.intervalHours, 57); // ceil(20 * (2.5 + 0.35)) = ceil(57) = 57
    assert.equal(updatedState.easeFactor, 2.65);
    assert.equal(
      updatedState.nextDueAt,
      addHours(updatedState.lastStudiedAt, 57),
    );
    assertProjectedReviewState('easy-word', 'recognition', updatedState);
  });

  test('recording a lapsed review attempt batch resets the interval, penalizes ease, and projects scheduler state', () => {
    insertReviewWordWithItem({
      wordId: 'lapsed-word',
      sessionActionId: 'lapsed-word-forward',
      direction: 'forward',
      intervalHours: 40,
      easeFactor: 2.5,
      nextDueAt: isoHoursAgo(1),
    });
    insertWordStudyAdmissionState('lapsed-word', null);
    insertWordSkillState('lapsed-word', 'recognition', {
      intervalHours: 40,
      lastStudiedAt: isoHoursAgo(48),
      nextDueAt: isoHoursAgo(1),
      easeFactor: 2.5,
    });

    const { state: updatedState } = recordAcceptedReviewBatch({
      sessionActionId: 'lapsed-word-forward',
      wordId: 'lapsed-word',
      actionKind: 'recognition',
      skillId: 'recognition',
      failureCount: 2,
      terminalRating: null,
      attempts: [
        { rating: 'forgot', outcome: 'incorrect' },
        { rating: 'good', outcome: 'correct' },
        { rating: 'forgot', outcome: 'incorrect' },
        { rating: 'hard', outcome: 'correct' },
        { rating: 'good', outcome: 'correct' },
        { rating: 'easy', outcome: 'correct' },
      ],
    });

    assert.equal(updatedState.intervalHours, 6);
    assert.equal(updatedState.easeFactor, 2.2); // 2.2 = 2.5 - (2 * 0.15)
    assert.equal(
      updatedState.nextDueAt,
      addHours(updatedState.lastStudiedAt, 6),
    );
    assertProjectedReviewState('lapsed-word', 'recognition', updatedState);
    for (let index = 1; index <= 6; index += 1) {
      assert.equal(fetchAttemptProjectedAt(`review/lapsed-word/recognition-attempt-${index}`), updatedState.lastStudiedAt);
    }
  });

  test('projected review lapse penalties respect the minimum ease floor', () => {
    insertReviewWordWithItem({
      wordId: 'penalty-floor-word',
      sessionActionId: 'penalty-floor-word-forward',
      direction: 'forward',
      intervalHours: 40,
      easeFactor: 1.9,
      nextDueAt: isoHoursAgo(1),
    });
    insertWordStudyAdmissionState('penalty-floor-word', null);
    insertWordSkillState('penalty-floor-word', 'recognition', {
      intervalHours: 40,
      lastStudiedAt: isoHoursAgo(48),
      nextDueAt: isoHoursAgo(1),
      easeFactor: 1.9,
    });

    const { state: updatedState } = recordAcceptedReviewBatch({
      sessionActionId: 'penalty-floor-word-forward',
      wordId: 'penalty-floor-word',
      actionKind: 'recognition',
      skillId: 'recognition',
      failureCount: 5,
      terminalRating: null,
      attempts: [
        { rating: 'forgot', outcome: 'incorrect' },
        { rating: 'forgot', outcome: 'incorrect' },
        { rating: 'forgot', outcome: 'incorrect' },
        { rating: 'forgot', outcome: 'incorrect' },
        { rating: 'forgot', outcome: 'incorrect' },
        { rating: 'hard', outcome: 'correct' },
        { rating: 'good', outcome: 'correct' },
        { rating: 'easy', outcome: 'correct' },
      ],
    });

    assert.equal(updatedState.intervalHours, 6);
    assert.equal(updatedState.easeFactor, 1.8); // without the floor, this would be 1.15 = 1.9 - (5 * 0.15).
    assertProjectedReviewState('penalty-floor-word', 'recognition', updatedState);
  });

  test('accepted review attempt batch rejects a clean pass intent without a terminal rating', () => {
    insertReviewWordWithItem({
      wordId: 'missing-rating-word',
      sessionActionId: 'missing-rating-word-forward',
      direction: 'forward',
      intervalHours: 10,
      easeFactor: 2.5,
      nextDueAt: isoHoursAgo(1),
    });
    insertWordStudyAdmissionState('missing-rating-word', null);
    insertWordSkillState('missing-rating-word', 'recognition', {
      intervalHours: 10,
      lastStudiedAt: isoHoursAgo(48),
      nextDueAt: isoHoursAgo(1),
      easeFactor: 2.5,
    });

    assert.throws(
      () =>
        recordAcceptedReviewBatch({
          sessionActionId: 'missing-rating-word-forward',
          wordId: 'missing-rating-word',
          actionKind: 'recognition',
          skillId: 'recognition',
          rating: 'good',
          outcome: 'correct',
          failureCount: 0,
          terminalRating: null,
        }),
      /do not match supplied review commit intent/,
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

    const skillStates = dbModule.getWordSkillStates().filter((state) => state.wordId === 'graduating-word');
    assert.deepEqual(
      skillStates.map((state) => [state.skillId, state.intervalHours, state.easeFactor]),
      [
        ['production', 24, 2.5],
        ['recognition', 24, 2.5],
      ],
    );
    for (const state of skillStates) {
      assert.match(state.lastStudiedAt, isoUtcTimestampPattern);
      assert.match(state.nextDueAt ?? '', isoUtcTimestampPattern);

      const reviewedAt = new Date(state.lastStudiedAt);
      const nextDueAt = new Date(state.nextDueAt ?? fail('missing nextDueAt'));
      assert.ok(reviewedAt >= beforeCompletion);
      assert.ok(reviewedAt <= afterCompletion);
      assert.equal(nextDueAt.getTime() - reviewedAt.getTime(), 24 * 60 * 60 * 1000);
    }
  });

  test('learning completion rejects unknown words', () => {
    assert.throws(
      () => dbModule.completeLearningWordSession('missing-word', true),
      /Word not found/,
    );
  });

  test('review failure rates aggregate session summaries and expose rolling rates', () => {
    insertReviewSessionSummary({
      sessionId: 'old-session',
      dayKey: addDays(studyDayKey, -2),
      failed: true,
    });

    dbModule.recordReviewSessionSummary({
      sessionId: 'session-a',
      completedAt: `${studyDayKey}T12:00:00.000Z`,
      completedReviewActionCount: 2,
      failedReviewActionCount: 1,
    });
    dbModule.recordReviewSessionSummary({
      sessionId: 'session-b',
      completedAt: `${studyDayKey}T13:00:00.000Z`,
      completedReviewActionCount: 1,
      failedReviewActionCount: 1,
    });

    const days = dbModule.getReviewFailureRateDays();
    assert.equal(days.length, 2);
    assert.deepEqual(days.map((day) => day.dayKey), [addDays(studyDayKey, -2), studyDayKey]);

    const todayRates = days[1];
    assert.equal(todayRates.completedReviewActionSessions, 3);
    assert.equal(todayRates.failedReviewActionSessions, 2);
    assert.equal(todayRates.failureRate, 2 / 3);
    assert.equal(todayRates.rolling3DayFailureRate, 3 / 4);
    assert.equal(todayRates.rolling7DayFailureRate, 3 / 4);
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

    const updatedWord = dbModule.completeUnstudiedWordSession('unstudied-transition-word', studyDayKey);
    assert.equal(updatedWord.status, 'learning');
    assert.equal(updatedWord.learningStreak, 0);
    assert.equal(updatedWord.lastLearningSuccessOn, null);
    assert.equal(updatedWord.lastLearningCoveredOn, today);
    assert.deepEqual(dbModule.getWordSkillStates().filter((state) => state.wordId === 'unstudied-transition-word'), []);
    assert.equal(fetchAdmissionState('unstudied-transition-word'), undefined);
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
  sessionActionId: string;
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

}

function fetchWord(wordId: string) {
  return dbModule.getWords().find((word) => word.id === wordId) ?? fail(`Missing word ${wordId}`);
}

function fetchWordSkillState(wordId: string, skillId: StudySkillId) {
  return dbModule.getWordSkillStates().find((state) => state.wordId === wordId && state.skillId === skillId);
}

function fetchAdmissionState(wordId: string) {
  return dbModule.getWordStudyAdmissionStates().find((state) => state.wordId === wordId);
}

function fetchAttemptProjectedAt(eventId: string) {
  const row = sqlite
    .prepare(`
      SELECT projected_at
      FROM study_attempt_events
      WHERE id = ?
    `)
    .get(eventId) as { projected_at: string | null } | undefined;

  return row?.projected_at ?? null;
}

function assertProjectedReviewState(
  wordId: string,
  skillId: StudySkillId,
  updatedState: NonNullable<ReturnType<typeof fetchWordSkillState>>,
) {
  assert.deepEqual(fetchWordSkillState(wordId, skillId), {
    wordId,
    skillId,
    enabled: true,
    intervalHours: updatedState.intervalHours,
    lastStudiedAt: updatedState.lastStudiedAt,
    nextDueAt: updatedState.nextDueAt,
    easeFactor: updatedState.easeFactor,
  });
  assert.equal(fetchAdmissionState(wordId)?.earliestNextStudyAt, addHours(
    updatedState.lastStudiedAt,
    6,
  ));
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

// recall: batch consists of both list of events along with the v1 commit intent metadata
function recordAcceptedReviewBatch({
  sessionActionId,
  wordId,
  actionKind,
  skillId,
  rating,
  outcome,
  failureCount,
  terminalRating,
  attempts,
}: {
  sessionActionId: string;
  wordId: string;
  actionKind: 'recognition' | 'production';
  skillId: StudySkillId;
  rating?: 'forgot' | 'hard' | 'good' | 'easy';
  outcome?: 'correct' | 'incorrect';
  failureCount: number;
  terminalRating: 'hard' | 'good' | 'easy' | null;
  attempts?: ReviewAttemptInput[];
}) {
  const computedSessionActionId = `review/${wordId}/${skillId}`;
  const attemptInputs = attempts ?? [
    {
      rating: rating ?? fail('Expected rating when attempts are omitted'),
      outcome: outcome ?? fail('Expected outcome when attempts are omitted'),
    },
  ];

  const result = dbModule.recordAcceptedReviewAttemptBatch({
    sessionId: `${computedSessionActionId}-session`,
    events: attemptInputs.map((attempt, index) => {
      const sequence = index + 1;

      return {
        id: `${computedSessionActionId}-attempt-${sequence}`,
        occurredAt: '2026-05-10T00:00:00.000Z',
        sessionId: `${computedSessionActionId}-session`,
        sessionActionId: computedSessionActionId,
        sessionEventSequence: sequence,
        actionAttemptSequence: sequence,
        actionKind,
        targetWordId: wordId,
        sampledSkillIds: [skillId],
        response: null,
        outcome: attempt.outcome,
        rating: attempt.rating,
        contentRef: null,
        metadata: {},
      };
    }),
    commitIntent: {
      type: 'commit-review-action-session',
      sessionActionId: computedSessionActionId,
      targetWordId: wordId,
      actionKind,
      sampledSkillIds: [skillId],
      failureCount,
      terminalRating,
    },
  });

  return {
    ...result,
    state: fetchWordSkillState(wordId, skillId) ?? fail(`Missing projected skill state ${wordId}/${skillId}`),
  };
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

function insertWordStudyAdmissionState(wordId: string, earliestNextStudyAt: string | null) {
  sqlite.prepare(`
    INSERT INTO word_study_admission_state (
      word_id,
      study_phase,
      earliest_next_study_at
    ) VALUES (?, ?, ?)
  `).run(wordId, 'review', earliestNextStudyAt);
}

function insertWordSkillState(
  wordId: string,
  skillId: StudySkillId,
  options?: {
    intervalHours?: number;
    lastStudiedAt?: string;
    nextDueAt?: string | null;
    easeFactor?: number;
  },
) {
  sqlite.prepare(`
    INSERT INTO word_skill_state (
      word_id,
      skill_id,
      enabled,
      interval_hours,
      last_studied_at,
      next_due_at,
      ease_factor
    ) VALUES (?, ?, 1, ?, ?, ?, ?)
  `).run(
    wordId,
    skillId,
    options?.intervalHours ?? 24,
    options?.lastStudiedAt ?? isoHoursAgo(25),
    options?.nextDueAt ?? isoHoursAgo(1),
    options?.easeFactor ?? 2.5,
  );
}

function insertReviewSessionSummary({
  sessionId,
  dayKey,
  failed,
}: {
  sessionId: string;
  dayKey: string;
  failed: boolean;
}) {
  sqlite.prepare(`
    INSERT INTO review_session_summaries (
      session_id,
      completed_at,
      day_key,
      completed_count,
      failed_count
    ) VALUES (?, ?, ?, ?, ?)
  `).run(
    sessionId,
    `${dayKey}T12:00:00.000Z`,
    dayKey,
    1,
    failed ? 1 : 0,
  );
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
