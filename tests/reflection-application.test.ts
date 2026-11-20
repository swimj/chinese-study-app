import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, before, describe, test } from 'node:test';
import { pathToFileURL } from 'node:url';

const createdAt = '2026-07-29T12:00:00.000Z';
const appliedAt = '2026-07-29T12:01:00.000Z';
let dataDir = '';
let sqlite: DatabaseSync;

describe('production cue schema guards', { concurrency: false }, () => {
  before(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chinese-study-app-reflection-application-'));
    const previousMode = process.env.APP_MODE;
    const previousDataDir = process.env.APP_DATA_DIR;
    try {
      process.env.APP_MODE = 'study';
      process.env.APP_DATA_DIR = dataDir;
      await import(`${pathToFileURL(path.resolve('server/db.ts')).href}?test=${Date.now()}`);
    } finally {
      if (previousMode === undefined) delete process.env.APP_MODE;
      else process.env.APP_MODE = previousMode;
      if (previousDataDir === undefined) delete process.env.APP_DATA_DIR;
      else process.env.APP_DATA_DIR = previousDataDir;
    }
    sqlite = new DatabaseSync(path.join(dataDir, 'app.db'));
    sqlite.function('current_learner_id', () => 'test-learner');
    sqlite.exec('PRAGMA foreign_keys = ON;');
    insertWord('target', '目标');
    insertWord('alternate', '替代');
  });

  after(() => {
    sqlite.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  test('creates default production tasks for new words through the insert trigger', () => {
    insertWord('future', '未来');
    assert.deepEqual(
      { ...sqlite.prepare(`
        SELECT task_id AS taskId, word_id AS wordId, task_kind AS kind, created_at AS createdAt
        FROM production_tasks WHERE word_id = 'future'
      `).get() },
      {
        taskId: 'production-task:future:default_production',
        wordId: 'future',
        kind: 'default_production',
        createdAt,
      },
    );
  });

  test('prevents destructive deletion of immutable cue facts', () => {
    const cueId = 'cue-delete-guard';
    const taskId = 'production-task:target:default_production';
    sqlite.prepare(`
      INSERT INTO production_cues (cue_id, task_id, cue_type, cue_text, created_at, origin_kind)
      VALUES (?, ?, 'definition_gloss', 'target', ?, 'manual')
    `).run(cueId, taskId, appliedAt);
    sqlite.prepare(`
      INSERT INTO production_cue_accepted_words (cue_id, word_id, position) VALUES (?, 'target', 0)
    `).run(cueId);
    sqlite.prepare(`
      INSERT INTO production_cue_lifecycle_events (event_id, cue_id, task_id, lifecycle_kind, occurred_at)
      VALUES ('delete-guard-activation', ?, ?, 'activated', ?)
    `).run(cueId, taskId, appliedAt);
    insertStudyAttempt('attempt-delete-guard', cueId);
    sqlite.prepare(`
      INSERT INTO production_cue_evidence_records (
        evidence_id, occurred_at, record_kind, task_id, cue_id, source_attempt_id,
        attempt_result, submitted_word_id
      ) VALUES ('delete-guard-evidence', ?, 'attempt', ?, ?, 'attempt-delete-guard', 'rejected', 'alternate')
    `).run(appliedAt, taskId, cueId);

    assert.throws(
      () => sqlite.prepare(`DELETE FROM production_cue_accepted_words WHERE cue_id = ?`).run(cueId),
      /accepted words cannot be deleted/,
    );
    assert.throws(
      () => sqlite.prepare(`DELETE FROM production_cue_lifecycle_events WHERE cue_id = ?`).run(cueId),
      /lifecycle events cannot be deleted/,
    );
    assert.throws(
      () => sqlite.prepare(`DELETE FROM production_cue_evidence_records WHERE cue_id = ?`).run(cueId),
      /evidence cannot be deleted/,
    );
    assert.throws(
      () => sqlite.prepare(`DELETE FROM production_cues WHERE cue_id = ?`).run(cueId),
      /production cues cannot be deleted/,
    );
  });
});

function insertWord(wordId: string, hanzi: string): void {
  sqlite.prepare(`
    INSERT INTO words (
      id, hanzi, pinyin, meaning, meanings_json, personal_notes, examples_json, status, priority,
      created_at, learning_streak, last_learning_success_on, last_learning_covered_on
    ) VALUES (?, ?, 'pin1yin1', 'meaning', '["meaning"]', '', '[]', 'review', 1, ?, 0, NULL, NULL)
  `).run(wordId, hanzi, createdAt);
}

function insertStudyAttempt(attemptId: string, cueId: string): void {
  const taskId = 'production-task:target:default_production';
  sqlite.prepare(`
    INSERT OR IGNORE INTO study_sessions (id, started_at, ended_at, processing_state, processed_at)
    VALUES (?, ?, ?, 'processed', ?)
  `).run(`cue-evidence-session:${attemptId}`, createdAt, appliedAt, appliedAt);
  sqlite.prepare(`
    INSERT INTO study_attempt_events (
      id, occurred_at, session_id, session_action_id, session_event_sequence, action_attempt_sequence,
      action_kind, target_word_id, sampled_skill_ids_json, response, outcome, rating,
      content_ref_json, metadata_json, projected_at
    ) VALUES (?, ?, ?, ?, 1, 1, 'production', 'target',
      '["production"]', '替代', 'incorrect', 'forgot', ?, ?, ?)
  `).run(
    attemptId,
    appliedAt,
    `cue-evidence-session:${attemptId}`,
    `cue-action:${attemptId}`,
    JSON.stringify({ type: 'production_cue', taskId, cueId }),
    JSON.stringify({
      production: {
        taskId, cueId, cueType: 'definition_gloss', text: 'target', acceptedWordIds: ['target'],
        anchorWordId: 'target', submittedText: '替代', submittedWordId: 'alternate', result: 'rejected',
      },
    }),
    appliedAt,
  );
}
