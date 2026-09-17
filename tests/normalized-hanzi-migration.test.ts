import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { normalizeMandarinHanziLookup } from '../server/db/hanzi-lookup.ts';
import { assertSchemaCurrent, migrateDatabase, schemaMigrations } from '../server/db/migrations.ts';
import { createBaselineFixture } from './helpers/baseline-database.ts';
import { createDeployedSchemaFixture } from './helpers/deployed-schema.ts';

const time = '2026-09-17T00:00:00.000Z';
const saying = '吃一堑，长一智';
const strippedSaying = '吃一堑长一智';

function schema(db: DatabaseSync) {
  const objects = db.prepare('SELECT type, name, sql FROM sqlite_schema ORDER BY type, name').all() as Array<{
    type: string;
    name: string;
    sql: string | null;
  }>;
  const names = new Set(objects.map((object) => object.name));
  return objects.map((object) => ({
    ...object,
    sql: object.sql?.replace(/"([A-Za-z_][A-Za-z_0-9]*)"/g, (quoted, name: string) => (
      names.has(name) ? name : quoted
    )) ?? null,
  }));
}

function insertSaying(db: DatabaseSync): void {
  db.prepare(`
    INSERT INTO lexical_words (
      id, hanzi, traditional, pinyin, meaning, meanings_json, examples_json, priority, created_at
    ) VALUES (?, ?, ?, 'chī yī qiàn , zhǎng yī zhì', 'learn from a setback', '[]', '[]', 50, ?)
  `).run('saying', saying, saying, time);
}

for (const variant of ['fresh', 'fly'] as const) {
  test(`normalized hanzi migration preserves display form and backfills lookup keys from ${variant} baseline`, () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'normalized-hanzi-migration-'));
    const baselineDir = path.join(root, 'baseline');
    createBaselineFixture(baselineDir);
    const db = new DatabaseSync(path.join(variant === 'fresh' ? baselineDir : root, 'app.db'));
    db.function('current_learner_id', () => 'learner-a');
    db.exec('PRAGMA foreign_keys=ON');
    try {
      if (variant === 'fly') {
        const source = new DatabaseSync(path.join(baselineDir, 'app.db'));
        try {
          createDeployedSchemaFixture(source, db);
        } finally {
          source.close();
        }
      }

      insertSaying(db);
      const columnsBefore = db.prepare('PRAGMA table_info(lexical_words)').all() as Array<{ name: string }>;
      assert.equal(columnsBefore.some((column) => column.name === 'normalized_hanzi'), false);

      migrateDatabase(db);
      assertSchemaCurrent(db);

      const row = db.prepare(`
        SELECT hanzi, normalized_hanzi
        FROM lexical_words
        WHERE id = 'saying'
      `).get() as { hanzi: string; normalized_hanzi: string };
      assert.equal(row.hanzi, saying);
      assert.equal(row.normalized_hanzi, strippedSaying);
      assert.equal(row.normalized_hanzi, normalizeMandarinHanziLookup(saying));

      const after = schema(db);
      assert.deepEqual(migrateDatabase(db), []);
      assert.deepEqual(schema(db), after);
      assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
    } finally {
      db.close();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
}

test('fresh installation applies the same normalized hanzi objects as an upgraded baseline', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'normalized-hanzi-fresh-'));
  const baselineDir = path.join(root, 'baseline');
  const upgradedDir = path.join(root, 'upgraded');
  createBaselineFixture(baselineDir);
  fs.mkdirSync(upgradedDir);
  fs.copyFileSync(path.join(baselineDir, 'app.db'), path.join(upgradedDir, 'app.db'));

  const upgraded = new DatabaseSync(path.join(upgradedDir, 'app.db'));
  upgraded.function('current_learner_id', () => 'learner-a');
  upgraded.exec('PRAGMA foreign_keys=ON');
  const fresh = new DatabaseSync(path.join(baselineDir, 'app.db'));
  fresh.function('current_learner_id', () => 'learner-a');
  fresh.exec('PRAGMA foreign_keys=ON');
  try {
    migrateDatabase(upgraded);
    migrateDatabase(fresh);
    assert.deepEqual(schema(upgraded), schema(fresh));
    const index = upgraded.prepare(`
      SELECT sql FROM sqlite_schema
      WHERE name = 'idx_lexical_words_normalized_hanzi'
    `).get() as { sql: string };
    assert.match(index.sql, /normalized_hanzi/);
  } finally {
    upgraded.close();
    fresh.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
