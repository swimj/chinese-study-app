import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, before, describe, test } from 'node:test';
import { pathToFileURL } from 'node:url';

type DbModule = typeof import('../server/db.ts');

let dataDir = '';
let dbModule: DbModule;
let artifact: unknown;

describe('hosted shared Mandarin bootstrap', { concurrency: false }, () => {
  before(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chinese-study-app-hosted-bootstrap-'));
    artifact = JSON.parse(fs.readFileSync('server/bootstrap/mandarin-hosted-v1.json', 'utf8'));
    const previousMode = process.env.APP_MODE;
    const previousAuthMode = process.env.APP_AUTH_MODE;
    const previousProfile = process.env.APP_STUDY_PROFILE;
    const previousDataDir = process.env.APP_DATA_DIR;
    try {
      process.env.APP_MODE = 'study';
      process.env.APP_AUTH_MODE = 'clerk';
      process.env.APP_STUDY_PROFILE = 'mandarin';
      process.env.APP_DATA_DIR = dataDir;
      dbModule = await import(`${pathToFileURL(path.resolve('server/db.ts')).href}?hosted-bootstrap=${Date.now()}`);
    } finally {
      restoreEnv('APP_MODE', previousMode);
      restoreEnv('APP_AUTH_MODE', previousAuthMode);
      restoreEnv('APP_STUDY_PROFILE', previousProfile);
      restoreEnv('APP_DATA_DIR', previousDataDir);
    }
  });

  after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

  test('imports only shared lexical content and records exact provenance', () => {
    const result = dbModule.importSharedMandarinBootstrap(artifact, {
      importedAt: '2026-08-31T08:30:00.000Z',
    });
    assert.deepEqual(result, {
      importId: 'mandarin-hosted-bootstrap-v1',
      checksum: 'd31a7dff1993f757ce2d99a4bf4eb50ddcbeda3bbc4803548fd99bfd8ffec04c',
      status: 'imported',
      wordCount: 8,
      meaningCount: 8,
    });

    const database = new DatabaseSync(path.join(dataDir, 'app.db'), { readOnly: true });
    try {
      assert.equal(readCount(database, 'lexical_words'), 8);
      assert.equal(readCount(database, 'lexical_word_meanings'), 8);
      assert.equal(readCount(database, 'content_imports'), 1);
      assert.equal(readCount(database, 'learners'), 0);
      assert.equal(readCount(database, 'learner_word_state'), 0);
      assert.equal(readCount(database, 'learner_owned_word_skill_state'), 0);
      const ledger = database.prepare(`
        SELECT content_kind, source_ref, imported_at, details_json
        FROM content_imports
        WHERE import_id = 'mandarin-hosted-bootstrap-v1'
      `).get() as {
        content_kind: string;
        source_ref: string;
        imported_at: string;
        details_json: string;
      };
      assert.equal(ledger.content_kind, 'shared_mandarin_lexicon');
      assert.equal(ledger.source_ref, 'server/bootstrap/mandarin-hosted-v1.json');
      assert.equal(ledger.imported_at, '2026-08-31T08:30:00.000Z');
      assert.deepEqual(JSON.parse(ledger.details_json), {
        schemaVersion: 1,
        checksum: result.checksum,
        wordCount: 8,
        meaningCount: 8,
      });
    } finally {
      database.close();
    }
  });

  test('is idempotent only while the ledger and imported content still match', () => {
    assert.equal(dbModule.importSharedMandarinBootstrap(artifact).status, 'already_imported');

    const tampered = structuredClone(artifact) as {
      words: Array<{ pinyin: string }>;
    };
    tampered.words[0]!.pinyin = 'tampered';
    assert.throws(
      () => dbModule.importSharedMandarinBootstrap(tampered),
      /checksum mismatch/,
    );
    const database = new DatabaseSync(path.join(dataDir, 'app.db'), { readOnly: true });
    try {
      assert.equal(readCount(database, 'lexical_words'), 8);
      assert.equal(readCount(database, 'content_imports'), 1);
    } finally {
      database.close();
    }
  });
});

function readCount(database: DatabaseSync, table: string): number {
  return (database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count;
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
