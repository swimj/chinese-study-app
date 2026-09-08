import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { assertSchemaCurrent, migrateDatabase, schemaMigrations } from '../server/db/migrations.ts';
import { createDeployedSchemaFixture } from './helpers/deployed-schema.ts';
import { createBaselineFixture } from './helpers/baseline-database.ts';

const time = '2026-09-08T00:00:00.000Z';
const firstMigration = schemaMigrations[0]!;
const rebuild = schemaMigrations[1]!;

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

function insertArtifact(db: DatabaseSync, learnerId: string, artifactId: string): void {
  db.prepare(`
    INSERT INTO learner_owned_reflection_artifacts (
      learner_id, artifact_id, reflection_flow_version, generated_at, provider, model,
      prompt_version, bundle_schema_version, result_schema_version, evidence_bundle_json, result_json
    ) VALUES (?, ?, 'initial_post_session_reflection.v2', ?, 'provider', 'model', 'prompt', 'bundle', 'result', '{}', '{}')
  `).run(learnerId, artifactId, time);
}

function insertReview(
  db: DatabaseSync,
  input: {
    learnerId: string;
    proposalId: string;
    artifactId: string;
    itemId: string;
    disposition: string;
    dismissalReason?: string | null;
    acceptanceMode?: string | null;
    acceptedInvocationId?: string | null;
  },
): void {
  db.prepare(`
    INSERT INTO learner_owned_reflection_proposal_reviews (
      learner_id, proposal_id, artifact_id, item_id, proposal_index, disposition, updated_at,
      dismissal_reason, acceptance_mode, accepted_invocation_id
    ) VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?)
  `).run(
    input.learnerId,
    input.proposalId,
    input.artifactId,
    input.itemId,
    input.disposition,
    time,
    input.dismissalReason ?? null,
    input.acceptanceMode ?? null,
    input.acceptedInvocationId ?? null,
  );
}

for (const variant of ['fresh', 'fly'] as const) {
  test(`review rebuild maps second-opinion retirement and preserves rows from ${variant} baseline`, () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'review-disposition-migration-'));
    const baselineDir = path.join(root, 'baseline');
    createBaselineFixture(baselineDir);
    const db = new DatabaseSync(path.join(variant === 'fresh' ? baselineDir : root, 'app.db'));
    let learner = 'learner-a';
    db.function('current_learner_id', () => learner);
    db.exec('PRAGMA foreign_keys=ON');
    try {
      if (variant === 'fly') {
        const source = new DatabaseSync(path.join(baselineDir, 'app.db'));
        try { createDeployedSchemaFixture(source, db); } finally { source.close(); }
      }
      db.prepare('INSERT INTO learners VALUES (?, ?, ?, NULL)').run('learner-a', 'A', time);
      db.prepare('INSERT INTO learners VALUES (?, ?, ?, NULL)').run('learner-b', 'B', time);
      const appliedFirst = migrateDatabase(db, [firstMigration]);
      assert.deepEqual(appliedFirst, [
        ...(variant === 'fly' ? ['app_schema:0000_baseline'] : []),
        firstMigration.id,
      ]);

      insertArtifact(db, 'learner-a', 'artifact-a');
      insertArtifact(db, 'learner-b', 'artifact-b');
      insertReview(db, {
        learnerId: 'learner-a',
        proposalId: 'pending-a',
        artifactId: 'artifact-a',
        itemId: 'item-pending',
        disposition: 'pending',
      });
      insertReview(db, {
        learnerId: 'learner-a',
        proposalId: 'dismissed-a',
        artifactId: 'artifact-a',
        itemId: 'item-dismissed',
        disposition: 'dismissed',
        dismissalReason: 'Not useful.',
      });
      insertReview(db, {
        learnerId: 'learner-a',
        proposalId: 'second-opinion-a',
        artifactId: 'artifact-a',
        itemId: 'item-second-opinion',
        disposition: 'dismissed',
        dismissalReason: 'requested_second_opinion',
      });
      insertReview(db, {
        learnerId: 'learner-a',
        proposalId: 'accepted-a',
        artifactId: 'artifact-a',
        itemId: 'item-accepted',
        disposition: 'pending',
      });
      db.prepare(`
        INSERT INTO learner_owned_reflection_operation_invocations (
          learner_id, invocation_id, created_at, origin_kind, origin_proposal_id,
          operation_kind, operation_version, operation_json, application_state, application_updated_at
        ) VALUES ('learner-a', 'invocation-a', ?, 'proposal_acceptance', 'accepted-a',
          'suppress_definition_production', 1, '{}', 'pending', ?)
      `).run(time, time);
      db.prepare(`
        UPDATE learner_owned_reflection_proposal_reviews
        SET disposition = 'accepted', acceptance_mode = 'exact', accepted_invocation_id = 'invocation-a'
        WHERE proposal_id = 'accepted-a'
      `).run();
      insertReview(db, {
        learnerId: 'learner-b',
        proposalId: 'pending-b',
        artifactId: 'artifact-b',
        itemId: 'item-pending',
        disposition: 'pending',
      });

      const before = db.prepare(`
        SELECT proposal_id, learner_id, disposition, dismissal_reason, accepted_invocation_id
        FROM learner_owned_reflection_proposal_reviews
        ORDER BY proposal_id
      `).all();
      assert.throws(
        () => db.exec(`
          UPDATE learner_owned_reflection_proposal_reviews
          SET disposition = 'requested_second_opinion', dismissal_reason = NULL
          WHERE proposal_id = 'second-opinion-a'
        `),
        /CHECK constraint failed/,
      );

      assert.deepEqual(migrateDatabase(db), [rebuild.id]);
      assertSchemaCurrent(db);

      const afterRows = db.prepare(`
        SELECT proposal_id, learner_id, disposition, dismissal_reason, accepted_invocation_id
        FROM learner_owned_reflection_proposal_reviews
        ORDER BY proposal_id
      `).all() as Array<{
        proposal_id: string;
        learner_id: string;
        disposition: string;
        dismissal_reason: string | null;
        accepted_invocation_id: string | null;
      }>;
      assert.deepEqual(afterRows.map((row) => ({ ...row })), before.map((row) => ({
        ...row,
        ...(row.proposal_id === 'second-opinion-a'
          ? { disposition: 'requested_second_opinion', dismissal_reason: null }
          : {}),
      })));
      assert.match(
        String(db.prepare(`
          SELECT sql FROM sqlite_schema
          WHERE type = 'table' AND name = 'learner_owned_reflection_proposal_reviews'
        `).get()?.sql),
        /requested_second_opinion/,
      );
      assert.doesNotMatch(
        String(db.prepare(`
          SELECT sql FROM sqlite_schema
          WHERE type = 'table' AND name = 'learner_owned_reflection_proposal_reviews'
        `).get()?.sql),
        /__new/,
      );

      learner = 'learner-a';
      db.exec(`
        UPDATE reflection_proposal_reviews
        SET disposition = 'pending', dismissal_reason = NULL
        WHERE proposal_id = 'dismissed-a'
      `);
      assert.equal(
        db.prepare(`
          SELECT disposition FROM learner_owned_reflection_proposal_reviews WHERE proposal_id = 'dismissed-a'
        `).get()?.disposition,
        'pending',
      );
      assert.throws(
        () => db.exec(`UPDATE reflection_proposal_reviews SET proposal_id = 'changed' WHERE proposal_id = 'pending-a'`),
        /immutable/,
      );
      learner = 'learner-b';
      assert.equal(
        db.prepare(`SELECT COUNT(*) AS count FROM reflection_proposal_reviews WHERE proposal_id = 'pending-a'`).get()?.count,
        0,
      );
      assert.throws(
        () => insertReview(db, {
          learnerId: 'learner-b',
          proposalId: 'cross-a',
          artifactId: 'artifact-a',
          itemId: 'item-cross',
          disposition: 'pending',
        }),
        /cross-learner private reference/,
      );

      const after = schema(db);
      assert.deepEqual(migrateDatabase(db), []);
      assert.deepEqual(schema(db), after);
      assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
      assert.equal(db.prepare('PRAGMA quick_check').get()?.quick_check, 'ok');

      const freshDir = path.join(root, 'fresh');
      const result = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', 'await import("./server/db.ts")'], {
        encoding: 'utf8',
        env: { ...process.env, APP_MODE: 'study', APP_AUTH_MODE: 'clerk', APP_DATA_DIR: freshDir },
      });
      assert.equal(result.status, 0, result.stderr);
      const fresh = new DatabaseSync(path.join(freshDir, 'app.db'));
      try { assert.deepEqual(schema(fresh), after); } finally { fresh.close(); }
    } finally {
      db.close();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
}
