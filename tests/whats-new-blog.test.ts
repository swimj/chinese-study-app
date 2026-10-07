import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { createBaselineFixture } from './helpers/baseline-database.ts';
import { migrateDatabase, schemaMigrations } from '../server/db/migrations.ts';
import { setDb } from '../server/db/connection.ts';
import { listWhatsNewPosts, saveWhatsNewPost, WhatsNewConflictError } from '../server/db/whats-new.ts';
import { parseWhatsNewWriteRequest, WhatsNewInputError } from '../src/domain/whats-new.ts';
import { runWithLearnerId } from '../server/db/learner-context.ts';
import { getWhatsNewSeenThroughSequence, updateWhatsNewSeenThroughSequence } from '../server/db/attention.ts';
const request = { id: 'new-post', expectedRevision: null, date: '2026-10-07', title: 'Hello', summary: 'A short welcome.', paragraphs: ['你好'], status: 'draft' as const, sourceFrom: null, sourceThrough: null };

test('blog migration preserves history and learners, repeats safely, and matches fresh schema', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blog-migration-'));
  const otherDir = fs.mkdtempSync(path.join(os.tmpdir(), 'blog-fresh-'));
  createBaselineFixture(dir); createBaselineFixture(otherDir);
  const db = new DatabaseSync(path.join(dir, 'app.db'));
  const other = new DatabaseSync(path.join(otherDir, 'app.db'));
  try {
    db.function('current_learner_id', () => 'reader'); other.function('current_learner_id', () => 'reader');
    const index = schemaMigrations.findIndex(m => m.id === 'app_schema:0028_whats_new_blog');
    migrateDatabase(db, schemaMigrations.slice(0, index));
    db.exec("INSERT INTO learners (learner_id,display_name,created_at) VALUES ('reader','Preserved','now')");
    const learner = db.prepare('SELECT * FROM learners').all();
    migrateDatabase(db); migrateDatabase(other);
    assert.deepEqual(db.prepare('SELECT * FROM learners').all(), learner);
    assert.equal(db.prepare('SELECT count(*) n FROM whats_new_posts').get()!.n, 12);
    const currentPosts = (connection: DatabaseSync) => connection.prepare('SELECT * FROM whats_new_posts ORDER BY post_id').all().map(({ updated_at: _at, ...post }) => post);
    assert.deepEqual(currentPosts(db), currentPosts(other));
    const revisions = (connection: DatabaseSync) => connection.prepare('SELECT * FROM whats_new_post_revisions ORDER BY post_id, revision').all().map(({ saved_at: _at, post_json, ...row }) => {
      const { updatedAt: _updatedAt, ...post } = JSON.parse(post_json as string);
      return { ...row, post };
    });
    assert.deepEqual(revisions(db), revisions(other));
    const history = db.prepare('SELECT * FROM schema_migrations').all();
    assert.deepEqual(migrateDatabase(db), []); assert.deepEqual(db.prepare('SELECT * FROM schema_migrations').all(), history);
    setDb(db);
    const latest = listWhatsNewPosts()[0];
    assert.equal(latest.date, '2026-10-06'); assert.equal(latest.paragraphs.length, 5);
    assert.equal(latest.paragraphs[3], 'Missed a review and don’t want the extra practice that follows? Skip reinforcement finishes that item for the session. The miss still counts in the moment, and compensation is determined on a slightly slower cadence.');
    const draft = saveWhatsNewPost(request, 'operator'); assert.equal(draft.publicationSequence, null);
    assert.equal(listWhatsNewPosts().length, 12); assert.equal(listWhatsNewPosts({ includeDrafts: true }).length, 13);
    const published = saveWhatsNewPost({ ...request, expectedRevision: 1, status: 'published' }, 'operator');
    assert.equal(published.publicationSequence, 13);
    assert.throws(() => saveWhatsNewPost({ ...request, expectedRevision: 1 }, 'operator'), WhatsNewConflictError);
    const hidden = saveWhatsNewPost({ ...request, expectedRevision: 2 }, 'operator');
    const restored = saveWhatsNewPost({ ...request, expectedRevision: 3, status: 'published' }, 'operator');
    assert.equal(hidden.publicationSequence, 13); assert.equal(restored.publicationSequence, 13);
    assert.equal(db.prepare("SELECT count(*) n FROM whats_new_post_revisions WHERE post_id='new-post'").get()!.n, 4);
    assert.throws(() => db.exec("UPDATE whats_new_post_revisions SET actor_id='forged'"), /immutable/);
    // A separate process sees and changes the live WAL-backed file without restarting the reader.
    const write = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', `
      const { DatabaseSync } = await import('node:sqlite');
      const { setDb } = await import('./server/db/connection.ts');
      const { saveWhatsNewPost } = await import('./server/db/whats-new.ts');
      const db = new DatabaseSync(${JSON.stringify(path.join(dir, 'app.db'))});
      setDb(db); saveWhatsNewPost(${JSON.stringify({ ...request, expectedRevision: 4, title: 'Changed live', status: 'published' })}, 'other-operator'); db.close();
    `], { encoding: 'utf8' });
    assert.equal(write.status, 0, write.stderr); assert.equal(listWhatsNewPosts()[0].title, 'Changed live');
    db.prepare('INSERT INTO learner_params (learner_id,param_key,value_json,updated_at) VALUES (?,?,?,?)').run('reader', 'whats_new_seen_through_date', JSON.stringify('2026-09-16'), 'now');
    runWithLearnerId('reader', () => {
      assert.equal(getWhatsNewSeenThroughSequence(), 5);
      const seeded = listWhatsNewPosts().find(p => p.id === 'update-2026-09-16')!;
      const { revision, publicationSequence: _sequence, updatedAt: _updatedAt, ...seedInput } = seeded;
      saveWhatsNewPost({ ...seedInput, expectedRevision: revision, date: '2026-10-07' }, 'operator');
      assert.equal(getWhatsNewSeenThroughSequence(), 5, 'editing historical dates preserves old read state');
      saveWhatsNewPost({ ...request, id: 'backdated', date: '2026-09-01', status: 'published' }, 'operator');
      assert.equal(getWhatsNewSeenThroughSequence(), 5, 'new backdated publication is not grandfathered');
      assert.equal(updateWhatsNewSeenThroughSequence(14, 'ensure'), 5);
      assert.equal(updateWhatsNewSeenThroughSequence(14, 'seen'), 14);
      assert.equal(updateWhatsNewSeenThroughSequence(0, 'seen'), 14);
      assert.throws(() => updateWhatsNewSeenThroughSequence(15, 'seen'), WhatsNewInputError);
    });
  } finally { db.close(); other.close(); fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(otherDir, { recursive: true, force: true }); }
});

test('blog validation rejects malformed dates, stale shapes and oversized content', () => {
  for (const bad of [{ date: '2026-99-01' }, { date: '2026-02-30' }, { id: '../bad' }, { unexpected: true }, { expectedRevision: 0 }, { paragraphs: [] }, { paragraphs: ['x'.repeat(10001)] }, { paragraphs: Array(11).fill('x'.repeat(10000)) }, { sourceFrom: 'short' }, { status: 'deleted' }, { summary: '' }, { summary: '   ' }, { summary: 'x'.repeat(301) }, { summary: undefined }]) {
    assert.throws(() => parseWhatsNewWriteRequest({ ...request, ...bad }), WhatsNewInputError);
  }
});


test('preview migration preserves old revisions and custom content, appends audit records, and rolls back safely', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blog-preview-migration-'));
  createBaselineFixture(dir);
  const db = new DatabaseSync(path.join(dir, 'app.db'));
  try {
    db.function('current_learner_id', () => 'reader');
    const index = schemaMigrations.findIndex(m => m.id === 'app_schema:0030_whats_new_previews');
    const previous = schemaMigrations.slice(0, index);
    migrateDatabase(db, previous);
    db.prepare(`INSERT INTO whats_new_posts
      (post_id, revision, date, title, paragraphs_json, status, publication_sequence, source_from, source_through, updated_at)
      VALUES (?, 1, ?, ?, ?, 'draft', NULL, ?, ?, ?)`)
      .run('custom-draft', '2026-10-08', 'An operator’s draft', JSON.stringify(['Keep this exact custom paragraph.']), 'a'.repeat(40), 'b'.repeat(40), '2026-10-08T01:00:00.000Z');
    db.exec(`UPDATE whats_new_posts SET revision=2, title='A custom correction',
      paragraphs_json='["Changed historical content."]', status='draft'
      WHERE post_id='update-2026-09-09'`);
    // Represent the pre-upgrade operator saves with the old payload shape.
    db.exec(`INSERT INTO whats_new_post_revisions
      SELECT post_id, revision, 'operator:before-upgrade', updated_at,
        json_object('id',post_id,'revision',revision,'date',date,'title',title,
          'paragraphs',json(paragraphs_json),'status',status,'publicationSequence',publication_sequence,
          'sourceFrom',source_from,'sourceThrough',source_through,'updatedAt',updated_at)
      FROM whats_new_posts WHERE post_id IN ('custom-draft','update-2026-09-09')`);
    const before = db.prepare('SELECT * FROM whats_new_posts ORDER BY post_id').all();
    const history = db.prepare('SELECT * FROM whats_new_post_revisions ORDER BY post_id, revision').all();
    const migration = schemaMigrations[index];
    assert.throws(() => migrateDatabase(db, [...previous, { ...migration, sql: migration.sql + '\nINSERT INTO missing_table VALUES (1);' }]), /missing_table/);
    assert.deepEqual(db.prepare('SELECT * FROM whats_new_posts ORDER BY post_id').all(), before);
    assert.deepEqual(db.prepare('SELECT * FROM whats_new_post_revisions ORDER BY post_id, revision').all(), history);
    migrateDatabase(db);
    const after = db.prepare('SELECT * FROM whats_new_posts ORDER BY post_id').all();
    for (const [index, oldPost] of before.entries()) {
      const { revision, updated_at: _oldAt, ...oldContent } = oldPost;
      const { revision: newRevision, updated_at: newAt, summary, ...newContent } = after[index];
      assert.deepEqual(newContent, oldContent);
      assert.equal(newRevision, Number(revision) + 1);
      assert.ok(typeof summary === 'string' && summary.trim().length > 0 && summary.length <= 300);
      const audit = db.prepare('SELECT * FROM whats_new_post_revisions WHERE post_id=? AND revision=?').get(oldPost.post_id, newRevision)!;
      assert.equal(audit.actor_id, 'migration:0030');
      assert.equal(audit.saved_at, newAt);
      assert.equal(JSON.parse(audit.post_json as string).summary, summary);
    }
    for (const oldRevision of history) {
      assert.deepEqual(db.prepare('SELECT * FROM whats_new_post_revisions WHERE post_id=? AND revision=?').get(oldRevision.post_id, oldRevision.revision), oldRevision);
    }
    assert.equal(after.find(post => post.post_id === 'custom-draft')!.summary, 'Read “An operator’s draft” for the full update.');
    assert.equal(after.find(post => post.post_id === 'update-2026-09-09')!.summary, 'Read “A custom correction” for the full update.');
    assert.equal(after.find(post => post.post_id === 'update-2026-10-06')!.summary, 'Connections brings studied words to life with notes about culture, language, and your interests after a session.');
    const allHistory = db.prepare('SELECT * FROM whats_new_post_revisions ORDER BY post_id, revision').all();
    assert.deepEqual(migrateDatabase(db), []);
    assert.deepEqual(db.prepare('SELECT * FROM whats_new_posts ORDER BY post_id').all(), after);
    assert.deepEqual(db.prepare('SELECT * FROM whats_new_post_revisions ORDER BY post_id, revision').all(), allHistory);
    assert.throws(() => db.exec("UPDATE whats_new_post_revisions SET actor_id='forged'"), /immutable/);
    assert.throws(() => db.exec('DELETE FROM whats_new_post_revisions'), /immutable/);
  } finally { db.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
