import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { assertSchemaCurrent, migrateDatabase, schemaMigrations } from '../server/db/migrations.ts';
import { createBaselineFixture } from './helpers/baseline-database.ts';

const migrationIndex = schemaMigrations.findIndex((migration) => migration.id === 'app_schema:0020_rehearsal_presentation');
const throughCleanup = schemaMigrations.slice(0, migrationIndex + 1);
const preamble = 'Recall the expression you just met. Enter only that expression in Chinese characters, not the whole sentence.';

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rehearsal-presentation-migration-'));
  createBaselineFixture(dir);
  const db = new DatabaseSync(path.join(dir, 'app.db'));
  db.function('current_learner_id', () => 'learner');
  db.exec('PRAGMA foreign_keys=ON');
  migrateDatabase(db, schemaMigrations.slice(0, migrationIndex));
  db.exec(`
    INSERT INTO learners (learner_id, display_name, created_at) VALUES ('learner', 'Learner', 'now');
    INSERT INTO lexical_words
      (id, hanzi, traditional, normalized_hanzi, pinyin, meaning, meanings_json, examples_json, priority, created_at)
      VALUES ('word', '报备', '報備', '报备', 'bào bèi', 'report', '[]', '[]', 50, 'now');
    INSERT INTO shared_content_publications VALUES ('content-publication', 'word_content', 'content', 'word', 'available', 'now', 'now');
    INSERT INTO word_content_documents VALUES ('content', 'word', '{"history":"unchanged"}', 'model', 'now', 'content-publication');
  `);
  function addPackage(id: string, json: string, status = 'available') {
    db.prepare('INSERT INTO shared_content_publications VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(`${id}-publication`, 'teaching_package', id, 'word', status, 'now', 'now');
    db.prepare('INSERT INTO word_teaching_packages VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, 'word', 'content', json, 'model', 'now', `${id}-publication`);
  }
  return { db, addPackage, close() { db.close(); fs.rmSync(dir, { recursive: true, force: true }); } };
}

const rehearsal = (instruction: string) => ({
  id: 'exercise', instruction, stimulus: { text: '他____。', note: preamble },
  contract: { kind: 'target_rehearsal', acceptedAnswers: ['报备', '報備'] },
});

function snapshot(db: DatabaseSync, table: string) {
  return db.prepare(`SELECT * FROM ${table}`).all();
}

test('cleanup removes exact rehearsal boilerplate only and preserves package identity, custom content, and learner history', () => {
  const { db, addPackage, close } = fixture();
  try {
    const original = { id: 'package', beats: [{ text: preamble }], rehearsals: [
      rehearsal(preamble), rehearsal('Recall this particular expression.'), rehearsal(preamble),
      rehearsal(`${preamble} Extra guidance.`), rehearsal(''),
    ] };
    for (const status of ['available', 'shared_trial', 'quarantined', 'retired']) {
      addPackage(status, JSON.stringify(original, null, 2), status);
    }
    const untouched = [
      '{ "rehearsals": [] }',
      JSON.stringify({ rehearsals: [rehearsal(` ${preamble}`)] }, null, 2),
      JSON.stringify({ rehearsals: [rehearsal(preamble.replace('Chinese', 'French'))] }, null, 2),
      '{ "other": "content" }',
      '{ malformed legacy content',
    ];
    untouched.forEach((json, index) => addPackage(`untouched-${index}`, json));
    db.exec(`INSERT INTO learner_word_introduction_events
      (event_id, learner_id, word_id, package_id, event_kind, occurred_at)
      VALUES ('opened', 'learner', 'word', 'available', 'opened', 'now');`);
    const history = snapshot(db, 'learner_word_introduction_events');
    const publications = snapshot(db, 'shared_content_publications');
    const documents = snapshot(db, 'word_content_documents');
    const identities = db.prepare('SELECT package_id, word_id, content_id, model, created_at, publication_id FROM word_teaching_packages').all();
    const schemaBefore = db.prepare("SELECT type, name, sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name").all();
    migrateDatabase(db, throughCleanup);
    assertSchemaCurrent(db, throughCleanup);
    const expected = structuredClone(original);
    expected.rehearsals[0]!.instruction = '';
    expected.rehearsals[2]!.instruction = '';
    for (const status of ['available', 'shared_trial', 'quarantined', 'retired']) {
      const row = db.prepare('SELECT package_json FROM word_teaching_packages WHERE package_id = ?').get(status)!;
      assert.deepEqual(JSON.parse(String(row.package_json)), expected);
    }
    untouched.forEach((json, index) => {
      assert.equal(db.prepare('SELECT package_json FROM word_teaching_packages WHERE package_id = ?').get(`untouched-${index}`)!.package_json, json);
    });
    assert.deepEqual(snapshot(db, 'learner_word_introduction_events'), history);
    assert.deepEqual(snapshot(db, 'shared_content_publications'), publications);
    assert.deepEqual(snapshot(db, 'word_content_documents'), documents);
    assert.deepEqual(db.prepare('SELECT package_id, word_id, content_id, model, created_at, publication_id FROM word_teaching_packages').all(), identities);
    assert.deepEqual(db.prepare("SELECT type, name, sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name").all(), schemaBefore);
    assert.throws(() => db.exec("UPDATE word_teaching_packages SET package_json = '{}'"), /immutable/);
    assert.throws(() => db.exec('DELETE FROM word_teaching_packages'), /cannot be deleted/);
    const packagesAfter = snapshot(db, 'word_teaching_packages');
    migrateDatabase(db, throughCleanup);
    assert.deepEqual(snapshot(db, 'word_teaching_packages'), packagesAfter);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  } finally { close(); }
});

test('failed cleanup rolls back content, immutability, and migration ledger together', () => {
  const { db, addPackage, close } = fixture();
  try {
    const json = JSON.stringify({ rehearsals: [rehearsal(preamble)] });
    addPackage('package', json);
    const migration = schemaMigrations[migrationIndex]!;
    assert.throws(() => migrateDatabase(db, [
      ...schemaMigrations.slice(0, migrationIndex),
      { ...migration, sql: `${migration.sql}\nINSERT INTO missing_table VALUES (1);` },
    ]), /missing_table/);
    assert.equal(db.prepare('SELECT package_json FROM word_teaching_packages').get()!.package_json, json);
    assert.throws(() => db.exec("UPDATE word_teaching_packages SET package_json = '{}'"), /immutable/);
    assert.equal(db.prepare('SELECT migration_id FROM schema_migrations WHERE migration_id = ?').get(migration.id), undefined);
    migrateDatabase(db, throughCleanup);
    assertSchemaCurrent(db, throughCleanup);
  } finally { close(); }
});
