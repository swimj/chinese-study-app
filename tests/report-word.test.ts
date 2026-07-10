import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { findWordReports, formatWordReport } from '../scripts/report-word.ts';

test('word report reads durable word and scheduler projections through a read-only database', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chinese-study-app-word-report-'));
  const dbPath = path.join(dataDir, 'app.db');
  const writableDb = new DatabaseSync(dbPath);

  try {
    writableDb.exec(`
      CREATE TABLE words (
        id TEXT PRIMARY KEY,
        hanzi TEXT NOT NULL,
        traditional TEXT,
        pinyin TEXT NOT NULL,
        meaning TEXT NOT NULL,
        meanings_json TEXT NOT NULL,
        personal_notes TEXT NOT NULL,
        status TEXT NOT NULL,
        priority INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        learning_streak INTEGER NOT NULL,
        last_learning_success_on TEXT,
        last_learning_covered_on TEXT
      );
      CREATE TABLE word_study_admission_state (
        word_id TEXT PRIMARY KEY,
        study_phase TEXT NOT NULL,
        earliest_next_study_at TEXT
      );
      CREATE TABLE word_skill_state (
        word_id TEXT NOT NULL,
        skill_id TEXT NOT NULL,
        enabled INTEGER NOT NULL,
        interval_hours INTEGER NOT NULL,
        last_studied_at TEXT NOT NULL,
        next_due_at TEXT,
        ease_factor REAL NOT NULL
      );
      INSERT INTO words VALUES
        ('review-1', '测试', NULL, 'cèshì', 'test', '["test"]', 'note', 'review', 8, '2026-01-01T00:00:00.000Z', 3, NULL, NULL),
        ('review-2', '测试', '測試', 'cèshì', 'test duplicate', '[]', '', 'unstudied', 2, '2026-02-01T00:00:00.000Z', 0, NULL, NULL);
      INSERT INTO word_study_admission_state VALUES ('review-1', 'review', '2026-07-11T00:00:00.000Z');
      INSERT INTO word_skill_state VALUES ('review-1', 'recognition', 1, 48, '2026-07-09T00:00:00.000Z', '2026-07-11T00:00:00.000Z', 2.5);
    `);
  } finally {
    writableDb.close();
  }

  const readOnlyDb = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const reports = findWordReports(readOnlyDb, '测试');
    assert.equal(reports.length, 2);
    assert.equal(reports[0]?.status, 'review');
    assert.equal(reports[0]?.admission?.earliestNextStudyAt, '2026-07-11T00:00:00.000Z');
    assert.equal(reports[0]?.skills[0]?.nextDueAt, '2026-07-11T00:00:00.000Z');
    assert.match(formatWordReport(reports[0]!), /status: review/);
    assert.match(formatWordReport(reports[0]!), /next due 2026-07-11T00:00:00.000Z/);
    assert.throws(() => readOnlyDb.prepare('DELETE FROM words').run(), /readonly|read-only/i);
  } finally {
    readOnlyDb.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
