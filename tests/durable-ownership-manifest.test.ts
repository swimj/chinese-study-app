import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { durableOwnershipManifest } from '../server/db/ownership-manifest.ts';

test('classifies every steady-state application table exactly once', async () => {
  const manifestNames = durableOwnershipManifest.map((entry) => entry.table);
  assert.equal(new Set(manifestNames).size, manifestNames.length, 'ownership manifest contains duplicate tables');
  assert.equal(durableOwnershipManifest.length, 36);
  assert.ok(durableOwnershipManifest.every((entry) => entry.ambiguity === null));

  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chinese-study-app-ownership-manifest-'));
  const previousMode = process.env.APP_MODE;
  const previousDataDir = process.env.APP_DATA_DIR;

  try {
    process.env.APP_MODE = 'study';
    process.env.APP_DATA_DIR = dataDir;
    const moduleUrl = `${pathToFileURL(path.resolve('server/db.ts')).href}?ownership=${Date.now()}`;
    await import(moduleUrl);

    const database = new DatabaseSync(path.join(dataDir, 'app.db'), { readOnly: true });
    try {
      const actualNames = (database.prepare(`
        SELECT name
        FROM sqlite_master
        WHERE type = 'table'
          AND name NOT LIKE 'sqlite_%'
        ORDER BY name
      `).all() as Array<{ name: string }>).map((row) => row.name);

      assert.deepEqual(actualNames, [...manifestNames].sort());
    } finally {
      database.close();
    }
  } finally {
    if (previousMode === undefined) delete process.env.APP_MODE;
    else process.env.APP_MODE = previousMode;

    if (previousDataDir === undefined) delete process.env.APP_DATA_DIR;
    else process.env.APP_DATA_DIR = previousDataDir;

    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
