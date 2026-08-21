import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, before, describe, test } from 'node:test';
import { pathToFileURL } from 'node:url';

type DbModule = typeof import('../server/db.ts');

let dataDir = '';
let sqlite: DatabaseSync;
let dbModule: DbModule;
let rawLearnerId = 'learner-a';

describe('learner isolation', { concurrency: false }, () => {
  before(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chinese-study-app-learner-isolation-'));
    const previousMode = process.env.APP_MODE;
    const previousDataDir = process.env.APP_DATA_DIR;
    process.env.APP_MODE = 'study';
    process.env.APP_DATA_DIR = dataDir;
    try {
      dbModule = await import(
        `${pathToFileURL(path.resolve('server/db.ts')).href}?learner-isolation=${Date.now()}`
      );
    } finally {
      restoreEnv('APP_MODE', previousMode);
      restoreEnv('APP_DATA_DIR', previousDataDir);
    }

    dbModule.bootstrapLearner({ learnerId: 'learner-a', displayName: 'Learner A' });
    dbModule.bootstrapLearner({ learnerId: 'learner-b', displayName: 'Learner B' });

    sqlite = new DatabaseSync(path.join(dataDir, 'app.db'));
    sqlite.function('current_learner_id', () => rawLearnerId);
    sqlite.exec('PRAGMA foreign_keys = ON;');
    sqlite.prepare(`
      INSERT INTO words (
        id, hanzi, traditional, pinyin, meaning, meanings_json, personal_notes,
        examples_json, status, priority, created_at, learning_streak,
        last_learning_success_on, last_learning_covered_on
      ) VALUES (?, ?, NULL, ?, ?, ?, '', '[]', 'unstudied', 10, ?, 0, NULL, NULL)
    `).run('shared-word', '共享', 'gòngxiǎng', 'shared', '["shared"]', '2026-08-21T00:00:00.000Z');
  });

  after(() => {
    sqlite.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  test('shares lexical content while isolating learner overlays', () => {
    dbModule.runWithLearnerId('learner-a', () => {
      dbModule.updateWordPersonalNotes('shared-word', 'A private note');
    });

    const aWord = dbModule.runWithLearnerId(
      'learner-a',
      () => dbModule.getWords().find((word) => word.id === 'shared-word'),
    );
    const bWord = dbModule.runWithLearnerId(
      'learner-b',
      () => dbModule.getWords().find((word) => word.id === 'shared-word'),
    );
    assert.equal(aWord?.personalNotes, 'A private note');
    assert.equal(bWord?.personalNotes, '');
    assert.equal(bWord?.hanzi, '共享');
    assert.equal(bWord?.status, 'unstudied');
  });

  test('permits the same private logical id for two learners without overwriting', () => {
    dbModule.runWithLearnerId('learner-a', () => dbModule.upsertStudySessionRecord({
      id: 'same-session-id',
      startedAt: '2026-08-21T01:00:00.000Z',
      endedAt: null,
      processingState: 'open',
      processedAt: null,
    }));
    dbModule.runWithLearnerId('learner-b', () => dbModule.upsertStudySessionRecord({
      id: 'same-session-id',
      startedAt: '2026-08-21T02:00:00.000Z',
      endedAt: null,
      processingState: 'open',
      processedAt: null,
    }));

    assert.equal(
      dbModule.runWithLearnerId('learner-a', () => dbModule.getStudySessionRecord('same-session-id'))?.startedAt,
      '2026-08-21T01:00:00.000Z',
    );
    assert.equal(
      dbModule.runWithLearnerId('learner-b', () => dbModule.getStudySessionRecord('same-session-id'))?.startedAt,
      '2026-08-21T02:00:00.000Z',
    );
  });

  test('hides private contrast content and rejects cross-learner session references', () => {
    dbModule.runWithLearnerId('learner-a', () => {
      dbModule.createContrastCluster({ id: 'a-cluster', title: 'A private cluster' });
      dbModule.upsertStudySessionRecord({
        id: 'a-only-session',
        startedAt: '2026-08-21T03:00:00.000Z',
        endedAt: null,
        processingState: 'open',
        processedAt: null,
      });
    });
    assert.deepEqual(
      dbModule.runWithLearnerId('learner-b', () => dbModule.getContrastClusters()),
      [],
    );

    rawLearnerId = 'learner-b';
    assert.throws(
      () => sqlite.prepare(`
        INSERT INTO study_events (
          id, occurred_at, session_id, session_action_id, session_event_sequence,
          event_type, target_word_id, action_kind, sampled_skill_ids_json,
          content_ref_json, payload_json, projected_at
        ) VALUES (?, ?, ?, NULL, NULL, 'study_management', ?, NULL, '[]', NULL, '{}', NULL)
      `).run(
        'cross-owner-event',
        '2026-08-21T03:01:00.000Z',
        'a-only-session',
        'shared-word',
      ),
      /FOREIGN KEY constraint failed/,
    );
  });
});

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
