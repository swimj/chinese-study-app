import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { getDb, closeDbConnection } from '../server/db/connection.ts';

test('fresh schema constructors reject existing objects without changing the database', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'strict-schema-setup-'));
  const previous = { mode: process.env.APP_MODE, auth: process.env.APP_AUTH_MODE, dir: process.env.APP_DATA_DIR };
  try {
    process.env.APP_MODE = 'study';
    process.env.APP_AUTH_MODE = 'clerk';
    process.env.APP_DATA_DIR = dataDir;
    const schema = await import(`${pathToFileURL(path.resolve('server/db.ts')).href}?strict-setup=${Date.now()}`) as typeof import('../server/db.ts');
    const db = getDb();
    const before = db.prepare('SELECT type, name, sql FROM sqlite_schema ORDER BY type, name').all();
    const version = db.prepare('PRAGMA schema_version').get();
    const constructors = [
      schema.createIdentitySchema,
      schema.createHostedOperationsSchema,
      schema.createReflectionSchema,
      schema.createReflectionQualitySchema,
      schema.createReflectionHelpInboxSchema,
      schema.createProductionCueSchema,
      schema.createSharedContentSchema,
      schema.createIntakeTriageSchema,
      schema.createReflectionIndexes,
      schema.createProductionCueIndexes,
      schema.createIntakeTriageIndexes,
      schema.createLearnerScopedCompatibilityViews,
      schema.createScopedContentCompatibilityViews,
      schema.createLearnerOwnershipGuards,
    ];
    for (const create of constructors) {
      assert.throws(create, /already exists|already another table|may not be altered|Expected scoped content table/, create.name);
      assert.deepEqual(db.prepare('SELECT type, name, sql FROM sqlite_schema ORDER BY type, name').all(), before, create.name);
      assert.deepEqual(db.prepare('PRAGMA schema_version').get(), version, create.name);
    }
  } finally {
    closeDbConnection();
    for (const [key, value] of Object.entries({ APP_MODE: previous.mode, APP_AUTH_MODE: previous.auth, APP_DATA_DIR: previous.dir })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
