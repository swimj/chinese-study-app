import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, before, beforeEach, describe, test } from 'node:test';
import { pathToFileURL } from 'node:url';

type WordStatus = 'unstudied' | 'learning' | 'review';

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

type DbModule = typeof import('../server/db.ts');

const studyDayKey = new Date().toISOString().slice(0, 10);

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
    sqlite.function('current_learner_id', () => 'test-learner');
    sqlite.exec('PRAGMA foreign_keys = ON;');
  });

  beforeEach(() => {
    sqlite.exec('DELETE FROM review_session_summaries;');
  });

  after(() => {
    sqlite.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
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
      activeDurationMs: 90_000,
    });
    dbModule.recordReviewSessionSummary({
      sessionId: 'session-b',
      completedAt: `${studyDayKey}T13:00:00.000Z`,
      completedReviewActionCount: 1,
      failedReviewActionCount: 1,
      activeDurationMs: 30_000,
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

  test('active session time metrics use completed-session days and fixed calendar-day divisors', () => {
    dbModule.recordReviewSessionSummary({
      sessionId: 'seven-days-ago',
      completedAt: `${addDays(studyDayKey, -7)}T12:00:00.000Z`,
      completedReviewActionCount: 0,
      failedReviewActionCount: 0,
      activeDurationMs: 999_000,
    });
    dbModule.recordReviewSessionSummary({
      sessionId: 'two-days-ago',
      completedAt: `${addDays(studyDayKey, -2)}T12:00:00.000Z`,
      completedReviewActionCount: 0,
      failedReviewActionCount: 0,
      activeDurationMs: 60_000,
    });
    dbModule.recordReviewSessionSummary({
      sessionId: 'today',
      completedAt: `${studyDayKey}T12:00:00.000Z`,
      completedReviewActionCount: 0,
      failedReviewActionCount: 0,
      activeDurationMs: 120_000,
    });

    assert.deepEqual(dbModule.getSessionActiveTimeMetrics(studyDayKey), {
      todayActiveDurationMs: 120_000,
      rolling3DayAverageActiveDurationMs: 60_000,
      rolling7DayAverageActiveDurationMs: 180_000 / 7,
    });
  });

  test('active session time metrics aggregate multiple sessions within each day', () => {
    const sessionsByDay = [
      { dayKey: studyDayKey, durations: [30_000, 90_000] },
      { dayKey: addDays(studyDayKey, -1), durations: [60_000, 120_000] },
      { dayKey: addDays(studyDayKey, -2), durations: [180_000, 240_000] },
    ];

    for (const { dayKey, durations } of sessionsByDay) {
      durations.forEach((activeDurationMs, index) => {
        dbModule.recordReviewSessionSummary({
          sessionId: `${dayKey}-session-${index + 1}`,
          completedAt: `${dayKey}T${String(12 + index).padStart(2, '0')}:00:00.000Z`,
          completedReviewActionCount: 0,
          failedReviewActionCount: 0,
          activeDurationMs,
        });
      });
    }

    assert.deepEqual(dbModule.getSessionActiveTimeMetrics(studyDayKey), {
      todayActiveDurationMs: 120_000,
      rolling3DayAverageActiveDurationMs: 240_000,
      rolling7DayAverageActiveDurationMs: 720_000 / 7,
    });
  });

  test('active duration validation rejects negative values and summary upserts replace the duration', () => {
    assert.throws(
      () => dbModule.recordReviewSessionSummary({
        sessionId: 'invalid-duration',
        completedAt: `${studyDayKey}T12:00:00.000Z`,
        completedReviewActionCount: 0,
        failedReviewActionCount: 0,
        activeDurationMs: -1,
      }),
      /Expected non-negative integer activeDurationMs/,
    );

    dbModule.recordReviewSessionSummary({
      sessionId: 'upsert-duration',
      completedAt: `${studyDayKey}T12:00:00.000Z`,
      completedReviewActionCount: 0,
      failedReviewActionCount: 0,
      activeDurationMs: 1_000,
    });
    dbModule.recordReviewSessionSummary({
      sessionId: 'upsert-duration',
      completedAt: `${studyDayKey}T12:00:00.000Z`,
      completedReviewActionCount: 0,
      failedReviewActionCount: 0,
      activeDurationMs: 2_000,
    });

    assert.equal(
      sqlite.prepare('SELECT active_duration_ms FROM review_session_summaries WHERE session_id = ?').get('upsert-duration')?.active_duration_ms,
      2_000,
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
});

function fetchWord(wordId: string) {
  return dbModule.getWords().find((word) => word.id === wordId) ?? fail(`Missing word ${wordId}`);
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
