import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, before, beforeEach, describe, test } from 'node:test';
import { pathToFileURL } from 'node:url';

type DbModule = typeof import('../server/db.ts');

const studyDayKey = new Date().toISOString().slice(0, 10);

let dataDir = '';
let dbPath = '';
let sqlite: DatabaseSync;
let dbModule: DbModule;

describe('learning policy settings', { concurrency: false }, () => {
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
    sqlite.exec(`
      DELETE FROM daily_new_word_intake;
      INSERT INTO learner_settings (learner_id, setting_key, value_json, updated_at)
      VALUES ('test-learner', 'daily_new_word_limit', '10', '2026-01-01T00:00:00.000Z')
      ON CONFLICT(learner_id, setting_key) DO UPDATE SET
        value_json = excluded.value_json,
        updated_at = excluded.updated_at;
      DELETE FROM learner_settings
      WHERE learner_id = 'test-learner' AND setting_key = 'unstudied_admission_source';
    `);
  });

  after(() => {
    sqlite.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  test('daily new-word limit defaults to 5 and persists independently from the completed count', () => {
    sqlite.exec("DELETE FROM learner_settings WHERE setting_key = 'daily_new_word_limit'");
    assert.equal(dbModule.getLearningPolicy(studyDayKey).dailyNewWordLimit, 5);
    assert.equal(dbModule.getLearningPolicy(studyDayKey).unstudiedAdmissionSource, 'mixed');
    assert.throws(
      () => dbModule.setDailyNewWordLimit(-1),
      /Expected integer dailyNewWordLimit between 0 and 20/,
    );
    assert.throws(
      () => dbModule.setDailyNewWordLimit(1.5),
      /Expected integer dailyNewWordLimit between 0 and 20/,
    );

    dbModule.setDailyNewWordLimit(3);
    sqlite.prepare('INSERT INTO daily_new_word_intake (day_key, new_study_count) VALUES (?, 1)').run(studyDayKey);
    dbModule.setDailyNewWordLimit(5);

    const settingRow = sqlite
      .prepare(`SELECT value_json FROM learner_settings WHERE learner_id = 'test-learner' AND setting_key = 'daily_new_word_limit'`)
      .get() as { value_json: string } | undefined;
    const intakeRow = sqlite
      .prepare('SELECT new_study_count FROM daily_new_word_intake WHERE day_key = ?')
      .get(studyDayKey) as { new_study_count: number } | undefined;

    assert.equal(settingRow?.value_json, '5');
    assert.equal(intakeRow?.new_study_count, 1);
    assert.equal(dbModule.getLearningPolicy(studyDayKey).dailyNewWordLimit, 5);
  });

  test('unstudied admission source defaults to mixed and persists independently from the daily limit', () => {
    assert.throws(
      () => dbModule.setUnstudiedAdmissionSource('diet_only' as never),
      /Expected unstudiedAdmissionSource to be "mixed" or "stash_only"/,
    );

    dbModule.setDailyNewWordLimit(4);
    const policy = dbModule.setUnstudiedAdmissionSource('stash_only');

    const settingRow = sqlite
      .prepare(`SELECT value_json FROM learner_settings WHERE learner_id = 'test-learner' AND setting_key = 'unstudied_admission_source'`)
      .get() as { value_json: string } | undefined;

    assert.equal(settingRow?.value_json, '"stash_only"');
    assert.equal(policy.unstudiedAdmissionSource, 'stash_only');
    assert.equal(policy.dailyNewWordLimit, 4);
    assert.equal(dbModule.getLearningPolicy(studyDayKey).unstudiedAdmissionSource, 'stash_only');
    assert.equal(dbModule.getLearningPolicy(studyDayKey).dailyNewWordLimit, 4);
  });

  test('character presentation defaults to simplified and persists independently of learning policy', () => {
    assert.equal(dbModule.getCharacterPresentation(), 'simplified');
    assert.throws(
      () => dbModule.setCharacterPresentation('pinyin' as never),
      /Expected characterPresentation to be "simplified", "traditional", or "both"/,
    );

    dbModule.setDailyNewWordLimit(4);
    const saved = dbModule.setCharacterPresentation('both');

    const settingRow = sqlite
      .prepare(`SELECT value_json FROM learner_settings WHERE learner_id = 'test-learner' AND setting_key = 'character_presentation'`)
      .get() as { value_json: string } | undefined;

    assert.equal(settingRow?.value_json, '"both"');
    assert.deepEqual(saved, { characterPresentation: 'both' });
    assert.equal(dbModule.getCharacterPresentation(), 'both');
    assert.equal(dbModule.getLearningPolicy(studyDayKey).dailyNewWordLimit, 4);
    assert.equal(dbModule.getLearningPolicy(studyDayKey).unstudiedAdmissionSource, 'mixed');
  });
});
