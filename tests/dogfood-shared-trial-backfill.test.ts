import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, before, describe, test } from 'node:test';
import { pathToFileURL } from 'node:url';
import {
  DOGFOOD_SHARED_TRIAL_BACKFILL_REASON,
} from '../server/db/shared-content.ts';

type DbModule = typeof import('../server/db.ts');

const learnerId = 'dogfood-local';
const publishedAt = '2026-08-30T04:00:00.000Z';
let dataDir = '';
let sqlite: DatabaseSync;
let dbModule: DbModule;

describe('dogfood shared-trial backfill', { concurrency: false }, () => {
  before(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chinese-study-app-shared-trial-backfill-'));
    const previousMode = process.env.APP_MODE;
    const previousDataDir = process.env.APP_DATA_DIR;
    const previousLearnerId = process.env.APP_LEARNER_ID;
    process.env.APP_MODE = 'study';
    process.env.APP_DATA_DIR = dataDir;
    process.env.APP_LEARNER_ID = learnerId;
    try {
      dbModule = await import(
        `${pathToFileURL(path.resolve('server/db.ts')).href}?shared-trial-backfill=${Date.now()}`,
      );
    } finally {
      restoreEnv('APP_MODE', previousMode);
      restoreEnv('APP_DATA_DIR', previousDataDir);
      restoreEnv('APP_LEARNER_ID', previousLearnerId);
    }

    sqlite = new DatabaseSync(path.join(dataDir, 'app.db'));
    sqlite.function('current_learner_id', () => learnerId);
    sqlite.exec('PRAGMA foreign_keys = ON;');
    insertDogfoodContent(sqlite);
  });

  after(() => {
    sqlite.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  test('publishes all active reusable dogfood content once and leaves inactive cues private', () => {
    const inspection = dbModule.runWithLearnerId(learnerId, () => (
      dbModule.inspectDogfoodSharedTrialBackfill({ publishedAt })
    ));
    assert.deepEqual(inspection, {
      learnerId,
      publishedAt,
      contrastClusterIds: ['dogfood-cluster'],
      productionCueIds: ['active-cue'],
      productionCueSupplementIds: ['active-supplement'],
    });

    const applied = dbModule.runWithLearnerId(learnerId, () => (
      dbModule.backfillDogfoodSharedTrialContent({ publishedAt })
    ));
    assert.deepEqual(applied, inspection);

    assert.deepEqual(
      sqlite.prepare(`
        SELECT content_kind, content_id, learning_purpose_key, publication_status
        FROM shared_content_publications
        ORDER BY content_kind, content_id
      `).all().map(asPlainRow),
      [
        {
          content_kind: 'contrast_cluster',
          content_id: 'dogfood-cluster',
          learning_purpose_key: 'contrast-cluster:dogfood-cluster',
          publication_status: 'shared_trial',
        },
        {
          content_kind: 'production_cue',
          content_id: 'active-cue',
          learning_purpose_key: 'production-task:shared-word:default_production',
          publication_status: 'shared_trial',
        },
        {
          content_kind: 'production_cue_supplement',
          content_id: 'active-supplement',
          learning_purpose_key: 'production-task:shared-word:default_production',
          publication_status: 'shared_trial',
        },
      ],
    );
    assert.equal(
      sqlite.prepare(`
        SELECT COUNT(*) AS count
        FROM shared_content_publication_events
        WHERE reason = ? AND actor_id = ?
      `).get(DOGFOOD_SHARED_TRIAL_BACKFILL_REASON, learnerId)?.count,
      3,
    );
    assert.deepEqual(
      sqlite.prepare(`
        SELECT id, content_scope, owner_learner_id
        FROM scoped_contrast_clusters
        ORDER BY id
      `).all().map(asPlainRow),
      [{ id: 'dogfood-cluster', content_scope: 'shared', owner_learner_id: null }],
    );
    assert.deepEqual(
      sqlite.prepare(`
        SELECT cue_id, content_scope, owner_learner_id, origin_kind, origin_invocation_id
        FROM scoped_production_cues
        ORDER BY cue_id
      `).all().map(asPlainRow),
      [
        {
          cue_id: 'active-cue',
          content_scope: 'shared',
          owner_learner_id: null,
          origin_kind: 'manual',
          origin_invocation_id: null,
        },
        {
          cue_id: 'inactive-cue',
          content_scope: 'learner',
          owner_learner_id: learnerId,
          origin_kind: 'manual',
          origin_invocation_id: null,
        },
      ],
    );
    assert.deepEqual(
      sqlite.prepare(`
        SELECT supplement_id, content_scope, owner_learner_id, origin_invocation_id
        FROM scoped_production_cue_supplements
      `).all().map(asPlainRow),
      [{
        supplement_id: 'active-supplement',
        content_scope: 'shared',
        owner_learner_id: null,
        origin_invocation_id: null,
      }],
    );
    assert.equal(
      dbModule.getSharedContentPublicationForContent('production_cue', 'inactive-cue'),
      null,
    );

    assert.deepEqual(
      dbModule.runWithLearnerId(learnerId, () => (
        dbModule.inspectDogfoodSharedTrialBackfill({ publishedAt })
      )),
      {
        learnerId,
        publishedAt,
        contrastClusterIds: [],
        productionCueIds: [],
        productionCueSupplementIds: [],
      },
    );
  });
});

function insertDogfoodContent(database: DatabaseSync): void {
  database.prepare(`
    INSERT INTO words (
      id, hanzi, traditional, pinyin, meaning, meanings_json, personal_notes,
      examples_json, status, priority, created_at, learning_streak,
      last_learning_success_on, last_learning_covered_on
    ) VALUES (?, ?, NULL, ?, ?, ?, '', '[]', 'unstudied', 10, ?, 0, NULL, NULL)
  `).run('shared-word', '共享', 'gòngxiǎng', 'shared', '["shared"]', '2026-08-30T00:00:00.000Z');
  database.prepare(`
    INSERT INTO scoped_contrast_clusters (id, title, note, content_scope, owner_learner_id)
    VALUES ('dogfood-cluster', 'Dogfood contrast', '', 'learner', ?)
  `).run(learnerId);
  database.prepare(`
    INSERT INTO scoped_contrast_cluster_members (cluster_id, word_id, nuance_note, display_order)
    VALUES ('dogfood-cluster', 'shared-word', '', 0)
  `).run();
  database.prepare(`
    INSERT INTO scoped_contrast_prompts (id, cluster_id, target_word_id, prompt_text, explanation)
    VALUES ('dogfood-prompt', 'dogfood-cluster', 'shared-word', 'Choose 共享', '')
  `).run();

  insertProductionCue(database, 'active-cue', 1, 'active-event');
  insertProductionCue(database, 'inactive-cue', 0, 'inactive-event');
  database.prepare(`
    INSERT INTO scoped_production_cue_supplements (
      supplement_id, task_id, cue_id, english_frame, example_sentence,
      example_translation, created_at, origin_invocation_id, content_scope, owner_learner_id
    ) VALUES (?, ?, ?, 'share something with someone', '我们共享这个。', 'We share this.', ?, NULL, 'learner', ?)
  `).run(
    'active-supplement',
    'production-task:shared-word:default_production',
    'active-cue',
    '2026-08-30T00:02:00.000Z',
    learnerId,
  );
}

function insertProductionCue(
  database: DatabaseSync,
  cueId: string,
  active: 0 | 1,
  eventId: string,
): void {
  const taskId = 'production-task:shared-word:default_production';
  database.prepare(`
    INSERT INTO scoped_production_cues (
      cue_id, task_id, cue_type, cue_text, created_at, origin_kind, origin_invocation_id,
      content_scope, owner_learner_id
    ) VALUES (?, ?, 'definition_gloss', ?, ?, 'manual', NULL, 'learner', ?)
  `).run(cueId, taskId, `cue ${cueId}`, '2026-08-30T00:01:00.000Z', learnerId);
  database.prepare(`
    INSERT INTO scoped_production_cue_accepted_words (cue_id, word_id, position)
    VALUES (?, 'shared-word', 0)
  `).run(cueId);
  database.prepare(`
    INSERT INTO learner_owned_production_cue_lifecycle_events (
      learner_id, event_id, cue_id, task_id, lifecycle_kind, occurred_at, invocation_id
    ) VALUES (?, ?, ?, ?, ?, '2026-08-30T00:01:00.000Z', NULL)
  `).run(learnerId, eventId, cueId, taskId, active === 1 ? 'activated' : 'deactivated');
  database.prepare(`
    INSERT INTO learner_owned_production_cue_activation_state (
      learner_id, cue_id, active, latest_lifecycle_event_id, updated_at
    ) VALUES (?, ?, ?, ?, '2026-08-30T00:01:00.000Z')
  `).run(learnerId, cueId, active, eventId);
}

function restoreEnv(name: string, previousValue: string | undefined): void {
  if (previousValue === undefined) delete process.env[name];
  else process.env[name] = previousValue;
}

function asPlainRow(row: object): Record<string, unknown> {
  return { ...row };
}
