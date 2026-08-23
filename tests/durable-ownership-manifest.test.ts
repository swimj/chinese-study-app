import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { learnerScopedCompatibilityTables } from '../server/db/learner-scoped-tables.ts';
import { durableOwnershipManifest } from '../server/db/ownership-manifest.ts';

test('classifies every steady-state application table exactly once', async () => {
  const manifestNames = durableOwnershipManifest.map((entry) => entry.table);
  assert.equal(new Set(manifestNames).size, manifestNames.length, 'ownership manifest contains duplicate tables');
  assert.equal(durableOwnershipManifest.length, 46);
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

      for (const entry of durableOwnershipManifest.filter((item) => item.ownershipClass === 'learner_private')) {
        const columns = database.prepare(`PRAGMA table_info(${entry.table})`).all() as Array<{
          name: string;
          notnull: number;
        }>;
        assert.equal(
          columns.find((column) => column.name === 'learner_id')?.notnull,
          1,
          `${entry.table} must carry a required learner_id`,
        );
      }

      assert.deepEqual(
        learnerScopedCompatibilityTables.map((name) => `learner_owned_${name}`).sort(),
        durableOwnershipManifest
          .filter((entry) => entry.ownershipClass === 'learner_private' && entry.table.startsWith('learner_owned_'))
          .map((entry) => entry.table)
          .sort(),
      );
      for (const logicalName of learnerScopedCompatibilityTables) {
        assertViewUsesLearnerContext(database, logicalName);
      }
      for (const entry of durableOwnershipManifest.filter(
        (item) => item.ownershipClass === 'mixed_requires_separation',
      )) {
        assertViewUsesLearnerContext(database, entry.table.replace(/^scoped_/, ''));
      }
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

function assertViewUsesLearnerContext(database: DatabaseSync, viewName: string): void {
  const row = database.prepare(`
    SELECT sql FROM sqlite_master WHERE type = 'view' AND name = ?
  `).get(viewName) as { sql: string } | undefined;
  assert.match(row?.sql ?? '', /current_learner_id\(\)/, `${viewName} must filter using learner context`);
}
