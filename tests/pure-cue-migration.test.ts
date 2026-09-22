import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { assertSchemaCurrent, migrateDatabase, schemaMigrations } from '../server/db/migrations.ts';
import { createBaselineFixture } from './helpers/baseline-database.ts';

const time = '2026-09-20T00:00:00.000Z';
const pureCueMigrationIndex = schemaMigrations.findIndex((migration) => (
  migration.id === 'app_schema:0009_pure_cues'
));
const migrationsThroughPureCues = schemaMigrations.slice(0, pureCueMigrationIndex + 1);

function create0008Database() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pure-cue-migration-'));
  createBaselineFixture(directory);
  const database = new DatabaseSync(path.join(directory, 'app.db'));
  let currentLearnerId = 'learner-a';
  database.function('current_learner_id', () => currentLearnerId);
  database.exec('PRAGMA foreign_keys=ON');
  migrateDatabase(database, schemaMigrations.slice(0, pureCueMigrationIndex));

  return {
    database,
    setCurrentLearnerId(learnerId: string) {
      currentLearnerId = learnerId;
    },
    close() {
      database.close();
      fs.rmSync(directory, { recursive: true, force: true });
    },
  };
}

function insertLearners(database: DatabaseSync): void {
  for (const [learnerId, displayName] of [['learner-a', 'Learner A'], ['learner-b', 'Learner B']]) {
    database.prepare('INSERT INTO learners (learner_id, display_name, created_at) VALUES (?, ?, ?)')
      .run(learnerId, displayName, time);
  }
}

function insertWords(database: DatabaseSync): void {
  for (const [id, hanzi] of [['word-a', '甲'], ['word-b', '乙']]) {
    database.prepare(`INSERT INTO lexical_words
      (id, hanzi, pinyin, meaning, meanings_json, examples_json, priority, created_at)
      VALUES (?, ?, 'pinyin', 'meaning', '[]', '[]', 0, ?)`)
      .run(id, hanzi, time);
  }
}

function insertInvocation(database: DatabaseSync, invocationId: string): void {
  database.prepare(`INSERT INTO learner_owned_reflection_operation_invocations (
    learner_id, invocation_id, created_at, origin_kind, origin_proposal_id,
    origin_superseded_proposal_id, operation_kind, operation_version, operation_json,
    application_state, application_updated_at
  ) VALUES (?, ?, ?, 'manual', NULL, NULL, 'repair_production_cue', 2, '{}', 'pending', ?)`) 
    .run('learner-a', invocationId, time, time);
}

function insertPublishedProductionCue(database: DatabaseSync, input: {
  cueId: string;
  invocationId: string;
  publicationId: string;
  eventId: string;
}): void {
  const task = database.prepare("SELECT task_id FROM production_tasks WHERE word_id = 'word-a'")
    .get() as { task_id: string };
  insertInvocation(database, input.invocationId);
  database.prepare(`INSERT INTO scoped_production_cues
    (cue_id, task_id, cue_type, cue_text, created_at, origin_kind, origin_invocation_id,
     content_scope, owner_learner_id)
    VALUES (?, ?, 'definition_gloss', 'shared cue', ?, 'reflection', ?, 'learner', 'learner-a')`)
    .run(input.cueId, task.task_id, time, input.invocationId);
  database.prepare(`INSERT INTO shared_content_publications
    (publication_id, content_kind, content_id, learning_purpose_key,
     publication_status, published_at, status_updated_at)
    VALUES (?, 'production_cue', ?, 'production:word-a', 'shared_trial', ?, ?)`) 
    .run(input.publicationId, input.cueId, time, time);
  database.prepare(`INSERT INTO shared_content_publication_events
    (event_id, publication_id, from_status, to_status, actor_kind, actor_id, reason, occurred_at)
    VALUES (?, ?, NULL, 'shared_trial', 'source_authorization', 'learner-a', 'fixture publication', ?)`)
    .run(input.eventId, input.publicationId, time);
  database.prepare(`INSERT INTO learner_owned_shared_content_publication_provenance
    (learner_id, publication_id, source_content_id, source_invocation_id, authorized_at)
    VALUES ('learner-a', ?, ?, ?, ?)`)
    .run(input.publicationId, input.cueId, input.invocationId, time);
}

function publishCueViaExistingTransition(database: DatabaseSync, cueId: string): void {
  database.prepare(`UPDATE scoped_production_cues
    SET origin_kind = 'manual', origin_invocation_id = NULL,
        content_scope = 'shared', owner_learner_id = NULL
    WHERE cue_id = ?`).run(cueId);
}

test('0009 preserves shared publications and their dependent production publication guards', () => {
  const fixture = create0008Database();
  const { database } = fixture;
  try {
    insertLearners(database);
    insertWords(database);
    insertPublishedProductionCue(database, {
      cueId: 'existing-cue', invocationId: 'existing-invocation',
      publicationId: 'existing-publication', eventId: 'existing-publication-event',
    });
    publishCueViaExistingTransition(database, 'existing-cue');

    const rowsBefore = {
      publications: database.prepare('SELECT * FROM shared_content_publications ORDER BY publication_id').all(),
      events: database.prepare('SELECT * FROM shared_content_publication_events ORDER BY event_id').all(),
      provenance: database.prepare(`SELECT * FROM learner_owned_shared_content_publication_provenance
        ORDER BY publication_id`).all(),
      cues: database.prepare('SELECT * FROM scoped_production_cues ORDER BY cue_id').all(),
    };

    assert.deepEqual(migrateDatabase(database, migrationsThroughPureCues), ['app_schema:0009_pure_cues']);
    assertSchemaCurrent(database, migrationsThroughPureCues);
    assert.deepEqual({
      publications: database.prepare('SELECT * FROM shared_content_publications ORDER BY publication_id').all(),
      events: database.prepare('SELECT * FROM shared_content_publication_events ORDER BY event_id').all(),
      provenance: database.prepare(`SELECT * FROM learner_owned_shared_content_publication_provenance
        ORDER BY publication_id`).all(),
      cues: database.prepare('SELECT * FROM scoped_production_cues ORDER BY cue_id').all(),
    }, rowsBefore);

    assert.throws(() => database.prepare(`UPDATE shared_content_publications
      SET publication_status = 'available', status_updated_at = '2026-09-20T00:01:00.000Z'
      WHERE publication_id = 'existing-publication'`).run(), /status changes require an attributable publication event/);
    assert.throws(() => database.prepare(`DELETE FROM shared_content_publications
      WHERE publication_id = 'existing-publication'`).run(), /shared content publications cannot be deleted/);

    database.prepare(`INSERT INTO shared_content_publication_events
      (event_id, publication_id, from_status, to_status, actor_kind, actor_id, reason, occurred_at)
      VALUES ('existing-publication-available', 'existing-publication', 'shared_trial', 'available',
        'operator', 'operator-a', 'fixture promotion', '2026-09-20T00:01:00.000Z')`).run();
    database.prepare(`UPDATE shared_content_publications
      SET publication_status = 'available', status_updated_at = '2026-09-20T00:01:00.000Z'
      WHERE publication_id = 'existing-publication'`).run();

    insertPublishedProductionCue(database, {
      cueId: 'post-migration-cue', invocationId: 'post-migration-invocation',
      publicationId: 'post-migration-publication', eventId: 'post-migration-publication-event',
    });
    publishCueViaExistingTransition(database, 'post-migration-cue');
    assert.deepEqual({ ...database.prepare(`SELECT origin_kind, origin_invocation_id, content_scope, owner_learner_id
      FROM scoped_production_cues WHERE cue_id = 'post-migration-cue'`).get() as object }, {
      origin_kind: 'manual', origin_invocation_id: null, content_scope: 'shared', owner_learner_id: null,
    });
    assert.deepEqual(database.prepare('PRAGMA foreign_key_check').all(), []);
    assert.deepEqual(migrateDatabase(database, migrationsThroughPureCues), []);
  } finally {
    fixture.close();
  }
});

test('0009 creates global pure content with learner-private state and isolated snapshots', () => {
  const fixture = create0008Database();
  const { database } = fixture;
  try {
    insertLearners(database);
    insertWords(database);
    migrateDatabase(database, migrationsThroughPureCues);

    database.prepare(`INSERT INTO pure_cues (id, stimulus, axis_note, created_at)
      VALUES ('pure-cue', 'choose the ordinary word', 'register', ?)`).run(time);
    for (const [wordId, position] of [['word-a', 0], ['word-b', 1]]) {
      database.prepare('INSERT INTO pure_cue_accepted_words (pure_cue_id, word_id, position) VALUES (?, ?, ?)')
        .run('pure-cue', wordId, position);
    }
    database.prepare(`INSERT INTO shared_content_publications
      (publication_id, content_kind, content_id, learning_purpose_key,
       publication_status, published_at, status_updated_at)
      VALUES ('pure-cue-publication', 'pure_cue', 'pure-cue', 'pure:ordinary-word', 'shared_trial', ?, ?)`).run(time, time);
    database.prepare(`INSERT INTO shared_content_publication_events
      (event_id, publication_id, from_status, to_status, actor_kind, actor_id, reason, occurred_at)
      VALUES ('pure-cue-publication-event', 'pure-cue-publication', NULL, 'shared_trial',
        'operator', 'operator-a', 'fixture pure cue publication', ?)`).run(time);

    for (const learnerId of ['learner-a', 'learner-b']) {
      database.prepare(`INSERT INTO learner_pure_cue_state
        (learner_id, pure_cue_id, interval_hours, ease_factor, next_due_at, adopted_at)
        VALUES (?, 'pure-cue', 24, 2.5, ?, ?)`).run(learnerId, time, time);
      database.prepare(`INSERT INTO pure_cue_served_snapshots
        (learner_id, snapshot_id, pure_cue_id, served_at, stimulus, axis_note, accepted_answers_json)
        VALUES (?, 'shared-snapshot', 'pure-cue', ?, 'choose the ordinary word', 'register',
          '[{"wordId":"word-a","hanzi":"甲","traditional":null}]')`).run(learnerId, time);
    }
    database.prepare(`INSERT INTO pure_cue_served_snapshots
      (learner_id, snapshot_id, pure_cue_id, served_at, stimulus, axis_note, accepted_answers_json)
      VALUES ('learner-a', 'learner-a-only', 'pure-cue', ?, 'choose the ordinary word', 'register',
        '[{"wordId":"word-a","hanzi":"甲","traditional":null}]')`).run(time);

    for (const learnerId of ['learner-a', 'learner-b']) {
      database.prepare(`INSERT INTO pure_cue_attempts
        (learner_id, attempt_id, pure_cue_id, snapshot_id, session_id, session_action_id,
         committed_at, events_json, failure_count, terminal_rating)
        VALUES (?, ?, 'pure-cue', 'shared-snapshot', ?, 'action', ?, '[]', 0, 'good')`)
        .run(learnerId, `${learnerId}-attempt`, `${learnerId}-session`, time);
    }
    assert.throws(() => database.prepare(`INSERT INTO pure_cue_attempts
      (learner_id, attempt_id, pure_cue_id, snapshot_id, session_id, session_action_id,
       committed_at, events_json, failure_count, terminal_rating)
      VALUES ('learner-b', 'cross-learner-attempt', 'pure-cue', 'learner-a-only',
        'learner-b-session-2', 'action', ?, '[]', 0, 'good')`).run(time), /FOREIGN KEY constraint failed/);

    assert.deepEqual(database.prepare(`SELECT learner_id, snapshot_id FROM pure_cue_served_snapshots
      WHERE snapshot_id = 'shared-snapshot' ORDER BY learner_id`).all().map((row) => ({ ...row })), [
      { learner_id: 'learner-a', snapshot_id: 'shared-snapshot' },
      { learner_id: 'learner-b', snapshot_id: 'shared-snapshot' },
    ]);
    assert.deepEqual(database.prepare(`SELECT learner_id, pure_cue_id FROM learner_pure_cue_state
      ORDER BY learner_id`).all().map((row) => ({ ...row })), [
      { learner_id: 'learner-a', pure_cue_id: 'pure-cue' },
      { learner_id: 'learner-b', pure_cue_id: 'pure-cue' },
    ]);
    assert.deepEqual(database.prepare('PRAGMA foreign_key_check').all(), []);
  } finally {
    fixture.close();
  }
});
