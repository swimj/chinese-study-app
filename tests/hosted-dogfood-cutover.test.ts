import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, before, describe, test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { closeDbConnection, getDb } from '../server/db/connection.ts';
import {
  createConsistentSqliteSnapshot,
  promotePreparedDogfoodDatabase,
  readDogfoodCutoverManifest,
  sha256File,
} from '../scripts/lib/hosted-dogfood-cutover.ts';

const learnerId = 'dogfood-local';
const clerkSubject = 'user_swi57_dogfood';
const cutoverId = 'swi-57-test-cutover';
let rootDir = '';
let sourceDataDir = '';
let preparedDataDir = '';

describe('hosted dogfood cutover', { concurrency: false }, () => {
  before(async () => {
    rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chinese-study-app-dogfood-cutover-'));
    sourceDataDir = path.join(rootDir, 'source');
    preparedDataDir = path.join(rootDir, 'prepared');
    const previousMode = process.env.APP_MODE;
    const previousAuthMode = process.env.APP_AUTH_MODE;
    const previousDataDir = process.env.APP_DATA_DIR;
    const previousLearnerId = process.env.APP_LEARNER_ID;
    try {
      process.env.APP_MODE = 'study';
      process.env.APP_AUTH_MODE = 'trusted_local';
      process.env.APP_DATA_DIR = sourceDataDir;
      process.env.APP_LEARNER_ID = learnerId;
      const db = await import(
        `${pathToFileURL(path.resolve('server/db.ts')).href}?hosted-dogfood-cutover-source=${Date.now()}`
      );
      getDb().prepare(`
        INSERT INTO lexical_words (
          id, hanzi, traditional, pinyin, meaning, meanings_json, examples_json, priority, created_at
        ) VALUES ('dogfood-word', '迁移', NULL, 'qiānyí', 'migrate', '["migrate"]', '[]', 100, ?)
      `).run('2026-09-01T07:00:00.000Z');
      getDb().prepare(`
        INSERT INTO learner_word_state (
          learner_id, word_id, personal_notes, status, learning_streak,
          last_learning_success_on, last_learning_covered_on
        ) VALUES (?, 'dogfood-word', 'personal dogfood note', 'learning', 2, '2026-08-31', '2026-08-31')
      `).run(learnerId);
      getDb().prepare(`
        INSERT INTO scoped_contrast_clusters (id, title, note, content_scope, owner_learner_id)
        VALUES ('dogfood-cluster', 'Dogfood cluster', '', 'learner', ?)
      `).run(learnerId);
      getDb().prepare(`
        INSERT INTO scoped_contrast_cluster_members (cluster_id, word_id, nuance_note, display_order)
        VALUES ('dogfood-cluster', 'dogfood-word', '', 0)
      `).run();
      getDb().prepare(`
        INSERT INTO scoped_contrast_prompts (id, cluster_id, target_word_id, prompt_text, explanation)
        VALUES ('dogfood-prompt', 'dogfood-cluster', 'dogfood-word', 'Choose 迁移', '')
      `).run();
      db.runWithLearnerId(learnerId, () => db.enableContextualSelectionWithoutTransaction({
        wordId: 'dogfood-word',
        updatedAt: '2026-09-01T07:01:00.000Z',
        sourceEventId: null,
      }));
      db.upsertStudySessionRecord({
        id: 'dogfood-session',
        startedAt: '2026-08-31T08:00:00.000Z',
        endedAt: '2026-08-31T08:05:00.000Z',
        processingState: 'processed',
        processedAt: '2026-08-31T08:05:00.000Z',
      });
    } finally {
      closeDbConnection();
      restoreEnv('APP_MODE', previousMode);
      restoreEnv('APP_AUTH_MODE', previousAuthMode);
      restoreEnv('APP_DATA_DIR', previousDataDir);
      restoreEnv('APP_LEARNER_ID', previousLearnerId);
    }
  });

  after(() => fs.rmSync(rootDir, { recursive: true, force: true }));

  test('includes committed WAL pages in a coherent standalone snapshot', () => {
    const walSourcePath = path.join(rootDir, 'wal-source.db');
    const walSnapshotPath = path.join(rootDir, 'wal-snapshot.db');
    const writer = new DatabaseSync(walSourcePath);
    try {
      writer.exec(`
        PRAGMA journal_mode = WAL;
        PRAGMA wal_autocheckpoint = 0;
        CREATE TABLE committed_rows (value TEXT NOT NULL);
        INSERT INTO committed_rows VALUES ('committed-in-wal');
      `);
      assert.equal(fs.existsSync(`${walSourcePath}-wal`), true);
      createConsistentSqliteSnapshot(walSourcePath, walSnapshotPath);
      const snapshot = new DatabaseSync(walSnapshotPath, { readOnly: true });
      try {
        assert.equal(
          (snapshot.prepare('SELECT value FROM committed_rows').get() as { value: string }).value,
          'committed-in-wal',
        );
        assert.equal(
          (snapshot.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check,
          'ok',
        );
      } finally {
        snapshot.close();
      }
    } finally {
      writer.close();
    }
  });

  test('removes an incomplete preparation package after validation fails', () => {
    const failedOutputDir = path.join(rootDir, 'failed-preparation');
    assert.throws(() => execFileSync(process.execPath, [
      '--import', 'tsx',
      'scripts/prepare-hosted-dogfood-cutover.ts',
      `--source-data-dir=${sourceDataDir}`,
      `--output-data-dir=${failedOutputDir}`,
      `--learner-id=${learnerId}`,
      `--clerk-subject=${clerkSubject}`,
      '--actor-id=swi-57-test-operator',
      '--cutover-id=swi-57-failed-preparation',
      '--prepared-at=not-an-iso-timestamp',
    ], { cwd: path.resolve('.'), encoding: 'utf8', stdio: 'pipe' }));
    assert.equal(fs.existsSync(failedOutputDir), false);
    assert.deepEqual(
      fs.readdirSync(rootDir).filter((entry) => entry.startsWith('failed-preparation.tmp-')),
      [],
    );
  });

  test('prepares a coherent hosted copy without mutating the trusted-local source', () => {
    const sourceDatabasePath = path.join(sourceDataDir, 'app.db');
    const sourceHashBefore = sha256File(sourceDatabasePath);
    const output = execFileSync(process.execPath, [
      '--import', 'tsx',
      'scripts/prepare-hosted-dogfood-cutover.ts',
      `--source-data-dir=${sourceDataDir}`,
      `--output-data-dir=${preparedDataDir}`,
      `--learner-id=${learnerId}`,
      `--clerk-subject=${clerkSubject}`,
      '--actor-id=swi-57-test-operator',
      `--cutover-id=${cutoverId}`,
      '--prepared-at=2026-09-01T09:00:00.000Z',
    ], { cwd: path.resolve('.'), encoding: 'utf8' });
    const report = JSON.parse(output) as {
      status: string;
      manifest: { databaseSha256: string; clerkSubjectSha256: string };
    };
    assert.equal(report.status, 'prepared');
    assert.equal(report.manifest.databaseSha256, sha256File(path.join(preparedDataDir, 'app.db')));
    assert.notEqual(report.manifest.clerkSubjectSha256, clerkSubject);
    assert.equal(sha256File(sourceDatabasePath), sourceHashBefore);

    const source = new DatabaseSync(sourceDatabasePath, { readOnly: true });
    const prepared = new DatabaseSync(path.join(preparedDataDir, 'app.db'), { readOnly: true });
    try {
      assert.equal(readCount(source, 'shared_content_publications'), 0);
      assert.equal(readCount(source, 'learner_auth_mappings'), 1);
      assert.equal(readCount(prepared, 'shared_content_publications'), 1);
      assert.equal(readCount(prepared, 'learner_auth_mappings'), 2);
      assert.equal(
        (prepared.prepare(`
          SELECT learner_id FROM learner_auth_mappings
          WHERE provider = 'clerk' AND provider_subject = ?
        `).get(clerkSubject) as { learner_id: string }).learner_id,
        learnerId,
      );
      assert.equal(
        (prepared.prepare(`SELECT personal_notes FROM learner_word_state WHERE word_id = 'dogfood-word'`).get() as {
          personal_notes: string;
        }).personal_notes,
        'personal dogfood note',
      );
      assert.deepEqual(
        prepared.prepare('PRAGMA foreign_key_check').all(),
        [],
      );
    } finally {
      source.close();
      prepared.close();
    }
    assert.equal(fs.existsSync(path.join(preparedDataDir, 'app.db-wal')), false);
    assert.equal(fs.existsSync(path.join(preparedDataDir, 'app.db-shm')), false);
  });

  test('reports first, then atomically promotes the staged database and retains the fixture rollback', () => {
    const liveDataDir = path.join(rootDir, 'fly-volume');
    const incomingDir = path.join(liveDataDir, 'incoming');
    fs.mkdirSync(incomingDir, { recursive: true });
    const liveDatabasePath = path.join(liveDataDir, 'app.db');
    const incomingDatabasePath = path.join(incomingDir, 'app.db');
    const manifestPath = path.join(incomingDir, 'manifest.json');
    const fixture = new DatabaseSync(liveDatabasePath);
    fixture.exec('CREATE TABLE fixture_marker (value TEXT NOT NULL); INSERT INTO fixture_marker VALUES (\'eight-word-fixture\');');
    fixture.close();
    fs.copyFileSync(path.join(preparedDataDir, 'app.db'), incomingDatabasePath);
    fs.copyFileSync(path.join(preparedDataDir, 'manifest.json'), manifestPath);
    const fixtureHash = sha256File(liveDatabasePath);
    const manifest = readDogfoodCutoverManifest(manifestPath);

    const baseInput = {
      dataDir: liveDataDir,
      incomingDatabasePath,
      manifestPath,
      cutoverId,
      litestreamSocketPath: path.join(liveDataDir, 'litestream.sock'),
      confirmNormalProcessStopped: false,
    };
    const dryRun = promotePreparedDogfoodDatabase({ ...baseInput, apply: false });
    assert.equal(dryRun.mode, 'report_only');
    assert.equal(dryRun.previousDatabaseSha256, null);
    assert.equal(sha256File(liveDatabasePath), fixtureHash);
    assert.throws(
      () => promotePreparedDogfoodDatabase({ ...baseInput, apply: true }),
      /explicit confirmation/,
    );
    assert.equal(sha256File(liveDatabasePath), fixtureHash);

    const applied = promotePreparedDogfoodDatabase({
      ...baseInput,
      apply: true,
      confirmNormalProcessStopped: true,
    });
    assert.equal(applied.mode, 'applied');
    assert.equal(sha256File(liveDatabasePath), manifest.databaseSha256);
    assert.equal(applied.previousDatabaseSha256, fixtureHash);
    assert.ok(applied.previousDatabaseBackupPath);
    const repeatedApply = promotePreparedDogfoodDatabase({
      ...baseInput,
      apply: true,
      confirmNormalProcessStopped: true,
    });
    assert.equal(repeatedApply.mode, 'applied');
    assert.equal(repeatedApply.previousDatabaseSha256, fixtureHash);
    const rollback = new DatabaseSync(applied.previousDatabaseBackupPath!, { readOnly: true });
    const live = new DatabaseSync(liveDatabasePath, { readOnly: true });
    try {
      assert.equal(
        (rollback.prepare('SELECT value FROM fixture_marker').get() as { value: string }).value,
        'eight-word-fixture',
      );
      assert.equal(readCount(live, 'lexical_words'), 1);
      assert.equal(readCount(live, 'learners'), 1);
    } finally {
      rollback.close();
      live.close();
    }
    assert.equal(fs.existsSync(incomingDatabasePath), false);

    const restoreOutput = execFileSync(process.execPath, [
      '--import', 'tsx',
      'scripts/verify-hosted-restore.ts',
      `--data-dir=${liveDataDir}`,
      `--sentinel-id=${cutoverId}`,
      '--minimum-learners=1',
    ], { cwd: path.resolve('.'), encoding: 'utf8' });
    assert.equal((JSON.parse(restoreOutput) as { status: string }).status, 'valid');
  });
});

function readCount(database: DatabaseSync, table: string): number {
  return (database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count;
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
