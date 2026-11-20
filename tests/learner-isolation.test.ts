import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, before, describe, test } from 'node:test';
import { pathToFileURL } from 'node:url';

type DbModule = typeof import('../server/db.ts');

let dataDir = '';
let sqlite: DatabaseSync;
let dbModule: DbModule;
let rawLearnerId = 'learner-a';

describe('learner isolation', { concurrency: false }, () => {
  before(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chinese-study-app-learner-isolation-'));
    const previousMode = process.env.APP_MODE;
    const previousDataDir = process.env.APP_DATA_DIR;
    process.env.APP_MODE = 'study';
    process.env.APP_DATA_DIR = dataDir;
    try {
      dbModule = await import(
        `${pathToFileURL(path.resolve('server/db.ts')).href}?learner-isolation=${Date.now()}`
      );
    } finally {
      restoreEnv('APP_MODE', previousMode);
      restoreEnv('APP_DATA_DIR', previousDataDir);
    }

    dbModule.bootstrapLearner({ learnerId: 'learner-a', displayName: 'Learner A' });
    dbModule.bootstrapLearner({ learnerId: 'learner-b', displayName: 'Learner B' });


    sqlite = new DatabaseSync(path.join(dataDir, 'app.db'));
    sqlite.function('current_learner_id', () => rawLearnerId);
    sqlite.exec('PRAGMA foreign_keys = ON;');
    sqlite.prepare(`
      INSERT INTO words (
        id, hanzi, traditional, pinyin, meaning, meanings_json, personal_notes,
        examples_json, status, priority, created_at, learning_streak,
        last_learning_success_on, last_learning_covered_on
      ) VALUES (?, ?, NULL, ?, ?, ?, '', '[]', 'unstudied', 10, ?, 0, NULL, NULL)
    `).run('shared-word', '共享', 'gòngxiǎng', 'shared', '["shared"]', '2026-08-21T00:00:00.000Z');
  });

  after(() => {
    sqlite.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  test('new local and external learners use stash only, five words and HSK 6 without resetting preferences', () => {
    const external = dbModule.resolveOrBootstrapExternalLearner({ provider: 'clerk', providerSubject: 'user_defaults_test' });
    for (const learner of ['learner-a', external]) {
      dbModule.runWithLearnerId(learner, () => {
        assert.equal(dbModule.getLearningPolicy('2026-10-07').dailyNewWordLimit, 5);
        assert.equal(dbModule.getLearningPolicy('2026-10-07').unstudiedAdmissionSource, 'stash_only');
        assert.deepEqual(dbModule.getDietProfile()?.weights, { 'hsk2-l6-s1': 1 });
      });
    }
    dbModule.runWithLearnerId(external, () => {
      dbModule.setDailyNewWordLimit(12);
      dbModule.setUnstudiedAdmissionSource('mixed');
      dbModule.setOperatorDietDeck('hsk2-l2');
    });
    assert.equal(dbModule.resolveOrBootstrapExternalLearner({ provider: 'clerk', providerSubject: 'user_defaults_test' }), external);
    dbModule.runWithLearnerId(external, () => {
      assert.equal(dbModule.getLearningPolicy('2026-10-07').dailyNewWordLimit, 12);
      assert.equal(dbModule.getLearningPolicy('2026-10-07').unstudiedAdmissionSource, 'mixed');
      assert.deepEqual(dbModule.getDietProfile()?.weights, { 'hsk2-l2': 1 });
    });
  });

  test('repeated local bootstrap preserves explicit and legacy admission choices', () => {
    dbModule.bootstrapLearner({ learnerId: 'existing-local' });
    dbModule.runWithLearnerId('existing-local', () => dbModule.setUnstudiedAdmissionSource('mixed'));
    dbModule.bootstrapLearner({ learnerId: 'existing-local' });
    assert.equal(dbModule.runWithLearnerId('existing-local', () => dbModule.getLearningPolicy('2026-10-07').unstudiedAdmissionSource), 'mixed');
    sqlite.prepare("DELETE FROM learner_settings WHERE learner_id = ? AND setting_key = 'unstudied_admission_source'").run('existing-local');
    dbModule.bootstrapLearner({ learnerId: 'existing-local' });
    assert.equal(dbModule.runWithLearnerId('existing-local', () => dbModule.getLearningPolicy('2026-10-07').unstudiedAdmissionSource), 'mixed');
  });

  test('shares lexical content while isolating learner overlays', () => {
    dbModule.runWithLearnerId('learner-a', () => {
      dbModule.updateWordPersonalNotes('shared-word', 'A private note');
    });

    const aWord = dbModule.runWithLearnerId(
      'learner-a',
      () => dbModule.getWords().find((word) => word.id === 'shared-word'),
    );
    const bWord = dbModule.runWithLearnerId(
      'learner-b',
      () => dbModule.getWords().find((word) => word.id === 'shared-word'),
    );
    assert.equal(aWord?.personalNotes, 'A private note');
    assert.equal(bWord?.personalNotes, '');
    assert.equal(bWord?.hanzi, '共享');
  });

  test('permits the same private logical id for two learners without overwriting', () => {
    for (const [learnerId, startedAt] of [
      ['learner-a', '2026-08-21T01:00:00.000Z'],
      ['learner-b', '2026-08-21T02:00:00.000Z'],
    ] as const) {
      rawLearnerId = learnerId;
      insertOpenSession('same-session-id', startedAt);
    }

    for (const [learnerId, startedAt] of [
      ['learner-a', '2026-08-21T01:00:00.000Z'],
      ['learner-b', '2026-08-21T02:00:00.000Z'],
    ] as const) {
      rawLearnerId = learnerId;
      assert.equal(
        sqlite.prepare(`SELECT started_at FROM study_sessions WHERE id = 'same-session-id'`).get()?.started_at,
        startedAt,
      );
    }
  });

  test('hides private contrast content and rejects cross-learner session references', () => {
    rawLearnerId = 'learner-a';
    sqlite.prepare(`INSERT INTO contrast_clusters (id, title, note) VALUES ('a-cluster', 'A private cluster', '')`).run();
    insertOpenSession('a-only-session', '2026-08-21T03:00:00.000Z');
    assert.deepEqual(sqlite.prepare('SELECT id FROM contrast_clusters').all().map((row) => row.id), ['a-cluster']);
    rawLearnerId = 'learner-b';
    assert.deepEqual(sqlite.prepare('SELECT id FROM contrast_clusters').all(), []);

    assert.throws(
      () => sqlite.prepare(`
        INSERT INTO study_events (
          id, occurred_at, session_id, session_action_id, session_event_sequence,
          event_type, target_word_id, action_kind, sampled_skill_ids_json,
          content_ref_json, payload_json, projected_at
        ) VALUES (?, ?, ?, NULL, NULL, 'study_management', ?, NULL, '[]', NULL, '{}', NULL)
      `).run(
        'cross-owner-event',
        '2026-08-21T03:01:00.000Z',
        'a-only-session',
        'shared-word',
      ),
      /FOREIGN KEY constraint failed/,
    );
  });

  test('shares cue publications without exposing source provenance or reports, and keeps their audit immutable', () => {
    const taskId = 'production-task:shared-word:default_production';
    const cueId = 'shared-cue';
    const publicationId = 'shared-cue-publication';
    const at = '2026-08-21T04:02:00.000Z';

    // Learner A's authorized invocation published a shared cue; its provenance stays private to A.
    rawLearnerId = 'learner-a';
    sqlite.prepare(`
      INSERT INTO reflection_operation_invocations (
        invocation_id, created_at, origin_kind, operation_kind, operation_version, operation_json,
        application_state, application_updated_at, effect_refs_json, satisfying_effect_refs_json
      ) VALUES ('learner-a-cue-replace', ?, 'manual', 'repair_production_cue', 2, '{}', 'pending', ?, '[]', '[]')
    `).run(at, at);
    sqlite.prepare(`
      INSERT INTO scoped_production_cues (
        cue_id, task_id, cue_type, cue_text, created_at, origin_kind, origin_invocation_id, content_scope, owner_learner_id
      ) VALUES (?, ?, 'definition_gloss', 'something owned or used by more than one person', ?, 'manual', NULL, 'shared', NULL)
    `).run(cueId, taskId, at);
    sqlite.prepare(`INSERT INTO scoped_production_cue_accepted_words (cue_id, word_id, position) VALUES (?, 'shared-word', 0)`)
      .run(cueId);
    sqlite.prepare(`
      INSERT INTO shared_content_publications (
        publication_id, content_kind, content_id, learning_purpose_key, publication_status, published_at, status_updated_at
      ) VALUES (?, 'production_cue', ?, ?, 'shared_trial', ?, ?)
    `).run(publicationId, cueId, taskId, at, at);
    sqlite.prepare(`
      INSERT INTO shared_content_publication_events (
        event_id, publication_id, from_status, to_status, actor_kind, actor_id, reason, occurred_at
      ) VALUES ('shared-cue-published', ?, NULL, 'shared_trial', 'source_authorization', NULL, 'fixture', ?)
    `).run(publicationId, at);
    sqlite.prepare(`
      INSERT INTO shared_content_publication_provenance (publication_id, source_content_id, source_invocation_id, authorized_at)
      VALUES (?, 'learner-a-private-source', 'learner-a-cue-replace', ?)
    `).run(publicationId, at);

    // Learner B reports the shared cue; the report stays private to B.
    rawLearnerId = 'learner-b';
    assert.equal(
      sqlite.prepare('SELECT 1 FROM shared_content_publication_provenance WHERE publication_id = ?').get(publicationId),
      undefined,
    );
    sqlite.prepare(`
      INSERT INTO shared_content_reports (report_id, publication_id, category, note, created_at)
      VALUES ('learner-b-report', ?, 'misleading', 'This cue needs operator review.', '2026-08-21T04:03:00.000Z')
    `).run(publicationId);
    rawLearnerId = 'learner-a';
    assert.equal(sqlite.prepare(`SELECT 1 FROM shared_content_reports WHERE report_id = 'learner-b-report'`).get(), undefined);

    rawLearnerId = 'learner-b';
    assert.throws(
      () => sqlite.prepare(`
        UPDATE shared_content_reports
        SET resolution = 'dismissed',
            resolved_at = '2026-08-21T04:03:20.000Z',
            resolved_by_operator_id = 'forged-operator'
        WHERE report_id = ?
      `).run('learner-b-report'),
      /reports are immutable through learner paths/,
    );
    assert.throws(
      () => sqlite.prepare(`DELETE FROM shared_content_reports WHERE report_id = ?`).run('learner-b-report'),
      /shared content reports cannot be deleted/,
    );
    assert.throws(
      () => sqlite.prepare(`
        DELETE FROM learner_owned_shared_content_publication_provenance
        WHERE publication_id = ?
      `).run(publicationId),
      /publication provenance cannot be deleted/,
    );
    assert.throws(
      () => sqlite.prepare(`
        DELETE FROM learner_owned_reflection_operation_invocations
        WHERE learner_id = 'learner-a' AND invocation_id = 'learner-a-cue-replace'
      `).run(),
      /invocation with shared publication provenance cannot be deleted/,
    );
    assert.throws(
      () => sqlite.prepare(`
        UPDATE shared_content_publications
        SET publication_status = 'available', status_updated_at = '2026-08-21T04:03:30.000Z'
        WHERE publication_id = ?
      `).run(publicationId),
      /status changes require an attributable publication event/,
    );
    assert.throws(
      () => sqlite.prepare(`DELETE FROM shared_content_publications WHERE publication_id = ?`).run(publicationId),
      /shared content publications cannot be deleted/,
    );
  });
});

function insertOpenSession(id: string, startedAt: string): void {
  sqlite.prepare(`
    INSERT INTO study_sessions (id, started_at, ended_at, processing_state, processed_at)
    VALUES (?, ?, NULL, 'open', NULL)
  `).run(id, startedAt);
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
