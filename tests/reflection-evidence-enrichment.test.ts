import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, before, beforeEach, describe, test } from 'node:test';
import {
  buildInitialReflectionBundle,
  ReflectionEvidenceError,
} from '../server/reflection/evidence.ts';
import { setDb } from '../server/db/connection.ts';
import type {
  SessionReflectionEvidenceSupplementV1,
} from '../src/domain/reflection-evidence.ts';

const startedAt = '2026-07-29T08:00:00.000Z';
const completedAt = '2026-07-29T08:20:00.000Z';
const generatedAt = '2026-07-29T08:21:00.000Z';

let tempDir = '';
let sqlite: DatabaseSync;
let previousMode: string | undefined;
let previousDataDir: string | undefined;
let previousStudyProfile: string | undefined;

describe('initial reflection evidence enrichment', { concurrency: false }, () => {
  before(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reflection-evidence-enrichment-'));
    previousMode = process.env.APP_MODE;
    previousDataDir = process.env.APP_DATA_DIR;
    previousStudyProfile = process.env.APP_STUDY_PROFILE;
    process.env.APP_MODE = 'study';
    process.env.APP_DATA_DIR = tempDir;
    process.env.APP_STUDY_PROFILE = 'mandarin';

    sqlite = new DatabaseSync(':memory:');
    sqlite.exec('PRAGMA foreign_keys = ON;');
    createSchema();
    setDb(sqlite);
  });

  beforeEach(() => {
    sqlite.exec(`
      DELETE FROM study_content_feedback;
      DELETE FROM word_skill_relevance;
      DELETE FROM contrast_prompts;
      DELETE FROM contrast_cluster_members;
      DELETE FROM contrast_clusters;
      DELETE FROM study_events;
      DELETE FROM study_attempt_events;
      DELETE FROM review_session_summaries;
      DELETE FROM study_sessions;
      DELETE FROM word_meanings;
      DELETE FROM words;
    `);
    insertCompleteSession();
  });

  after(() => {
    sqlite.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
    restoreEnv('APP_MODE', previousMode);
    restoreEnv('APP_DATA_DIR', previousDataDir);
    restoreEnv('APP_STUDY_PROFILE', previousStudyProfile);
  });

  test('builds a deterministic known-word bundle from complete accepted evidence without writes', () => {
    sqlite.exec(`
      INSERT INTO word_skill_relevance
        (word_id, skill_id, relevance_state, updated_at, source_event_id)
      VALUES ('target', 'production', 'suppressed', '${completedAt}', NULL);
      INSERT INTO study_content_feedback
        (id, created_at, target_type, target_id, target_word_id, action_kind,
         feedback_type, feedback_action, source_event_id, note)
      VALUES
        ('feedback-1', '${completedAt}', 'generated_prompt',
         'definition_based_production', 'target', 'production',
         'bad_prompt', 'reported', NULL, 'The gloss is too broad.');
      INSERT INTO contrast_clusters (id, title, note)
      VALUES ('cluster-1', '目标 / 替代', 'Near-synonyms');
      INSERT INTO contrast_cluster_members
        (cluster_id, word_id, nuance_note, display_order)
      VALUES
        ('cluster-1', 'target', 'goal nuance', 0),
        ('cluster-1', 'alternate', 'substitute nuance', 1);
      INSERT INTO contrast_prompts
        (id, cluster_id, target_word_id, prompt_text, explanation)
      VALUES ('prompt-1', 'cluster-1', 'target', 'Choose goal', '');
    `);

    const changesBefore = totalChanges();
    const bundle = buildInitialReflectionBundle('session-1', supplement('替代'), generatedAt);

    assert.equal(totalChanges(), changesBefore);
    assert.deepEqual(bundle.session, {
      sessionId: 'session-1',
      startedAt,
      endedAt: completedAt,
      studyProfile: 'mandarin',
    });
    assert.equal(bundle.items.length, 1);
    const item = bundle.items[0];
    assert(item?.source === 'production_mistake');
    assert.equal(item.responseKind, 'matched_known_word');
    assert.equal(item.submittedWord?.wordId, 'alternate');
    assert.deepEqual(item.targetWord.meanings, ['goal', 'objective']);
    assert.equal(Object.hasOwn(item.targetWord, 'production'), false);
    assert.equal(Object.hasOwn(item, 'attempts'), false);
    assert.equal(Object.hasOwn(item, 'attemptShape'), false);
    assert.deepEqual(item.existingContent, {
      contrastClusters: [{
        clusterId: 'cluster-1',
        title: '目标 / 替代',
        memberWordIds: ['target', 'alternate'],
        promptCount: 1,
        notes: ['Near-synonyms', 'goal nuance', 'substitute nuance'],
      }],
      knownAcceptedAlternates: [],
    });
  });

  test('keeps an exact unmatched typed response without inventing a word snapshot', () => {
    sqlite.prepare(`
      UPDATE study_attempt_events
      SET response = '不存在'
      WHERE id = 'attempt-1'
    `).run();

    const bundle = buildInitialReflectionBundle('session-1', supplement('不存在'), generatedAt);
    const item = bundle.items[0];
    assert(item?.source === 'production_mistake');
    assert.equal(item.rawResponse, '不存在');
    assert.equal(item.responseKind, 'unmatched_text');
    assert.equal(item.submittedWord, null);
  });

  test('preserves raw response evidence while matching a trimmed exact known word', () => {
    sqlite.prepare(`
      UPDATE study_attempt_events
      SET response = '  替代  '
      WHERE id = 'attempt-1'
    `).run();

    const bundle = buildInitialReflectionBundle('session-1', supplement('  替代  '), generatedAt);
    const item = bundle.items[0];
    assert(item?.source === 'production_mistake');
    assert.equal(item.rawResponse, '  替代  ');
    assert.equal(item.responseKind, 'matched_known_word');
    assert.equal(item.submittedWord?.wordId, 'alternate');
  });

  test('excludes actions with an explicit same-session management judgment', () => {
    const eventTypes = [
      'bad_prompt_reported',
      'skill_relevance_changed',
      'skill_relevance_changed_with_contrast_candidate',
    ];

    for (const [index, eventType] of eventTypes.entries()) {
      sqlite.exec('DELETE FROM study_events;');
      sqlite.prepare(`
        INSERT INTO study_events (
          id, occurred_at, session_id, session_action_id,
          session_event_sequence, event_type, projected_at
        ) VALUES (?, ?, 'session-1', 'action-1', ?, ?, ?)
      `).run(
        `management-${index}`,
        completedAt,
        index + 1,
        eventType,
        completedAt,
      );

      assertEvidenceError(
        () => buildInitialReflectionBundle('session-1', supplement('替代'), generatedAt),
        'no_qualifying_evidence',
        400,
        eventType,
      );
    }
  });

  test('rejects structurally invalid or empty supplements safely', () => {
    assertEvidenceError(
      () => buildInitialReflectionBundle('session-1', {
        ...supplement('替代'),
        unexpected: true,
      }, generatedAt),
      'invalid_supplement',
      400,
    );
    assertEvidenceError(
      () => buildInitialReflectionBundle('session-1', {
        schemaVersion: 'session_reflection_evidence_supplement.v1',
        items: [],
      }, generatedAt),
      'no_qualifying_evidence',
      400,
    );
  });

  test('distinguishes a missing route session from an incomplete session', () => {
    assertEvidenceError(
      () => buildInitialReflectionBundle('missing-session', supplement('替代'), generatedAt),
      'session_not_found',
      404,
    );

    sqlite.prepare(`
      DELETE FROM review_session_summaries
      WHERE session_id = 'session-1'
    `).run();
    assertEvidenceError(
      () => buildInitialReflectionBundle('session-1', supplement('替代'), generatedAt),
      'session_not_completed',
      400,
    );
  });

  test('rejects missing, incomplete, wrong-action, wrong-target, and unprojected references', () => {
    const cases: Array<{
      name: string;
      arrange?: () => void;
      value: SessionReflectionEvidenceSupplementV1;
    }> = [
      {
        name: 'missing attempt',
        value: withAttemptIds(supplement('替代'), ['missing-attempt']),
      },
      {
        name: 'incomplete batch',
        value: withAttemptIds(supplement('替代'), ['attempt-1']),
      },
      {
        name: 'wrong action',
        value: withItem(supplement('替代'), { sessionActionId: 'other-action' }),
      },
      {
        name: 'wrong target',
        value: withItem(supplement('替代'), { targetWordId: 'alternate' }),
      },
      {
        name: 'unprojected attempt',
        arrange: () => {
          sqlite.prepare(`
            UPDATE study_attempt_events
            SET projected_at = NULL
            WHERE id = 'attempt-1'
          `).run();
        },
        value: supplement('替代'),
      },
      {
        name: 'non-production action',
        arrange: () => {
          sqlite.prepare(`
            UPDATE study_attempt_events
            SET action_kind = 'recognition',
                sampled_skill_ids_json = '["recognition"]'
          `).run();
        },
        value: supplement('替代'),
      },
    ];

    for (const entry of cases) {
      insertCompleteSession();
      entry.arrange?.();
      assertEvidenceError(
        () => buildInitialReflectionBundle('session-1', entry.value, generatedAt),
        entry.name === 'missing attempt' ? 'referenced_entity_not_found' : 'invalid_reference',
        entry.name === 'missing attempt' ? 404 : 400,
        entry.name,
      );
    }
  });

  test('rejects attempts from another session and a raw response not grounded in the first attempt', () => {
    sqlite.exec(`
      INSERT INTO study_sessions
        (id, started_at, ended_at, processing_state, processed_at)
      VALUES ('session-2', '${startedAt}', '${completedAt}', 'processed', '${completedAt}');
      UPDATE study_attempt_events
      SET session_id = 'session-2'
      WHERE id = 'attempt-1';
    `);
    assertEvidenceError(
      () => buildInitialReflectionBundle('session-1', supplement('替代'), generatedAt),
      'invalid_reference',
      400,
    );

    insertCompleteSession();
    assertEvidenceError(
      () => buildInitialReflectionBundle('session-1', supplement('other text'), generatedAt),
      'invalid_reference',
      400,
    );
  });
});

function createSchema() {
  sqlite.exec(`
    CREATE TABLE words (
      id TEXT PRIMARY KEY,
      hanzi TEXT NOT NULL,
      traditional TEXT,
      pinyin TEXT NOT NULL,
      meaning TEXT NOT NULL,
      meanings_json TEXT NOT NULL
    );
    CREATE TABLE word_meanings (
      id TEXT PRIMARY KEY,
      word_id TEXT NOT NULL REFERENCES words(id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      text TEXT NOT NULL
    );
    CREATE TABLE study_sessions (
      id TEXT PRIMARY KEY,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      processing_state TEXT NOT NULL,
      processed_at TEXT
    );
    CREATE TABLE review_session_summaries (
      session_id TEXT PRIMARY KEY,
      completed_at TEXT NOT NULL
    );
    CREATE TABLE study_attempt_events (
      id TEXT PRIMARY KEY,
      occurred_at TEXT NOT NULL,
      session_id TEXT NOT NULL REFERENCES study_sessions(id) ON DELETE CASCADE,
      session_action_id TEXT NOT NULL,
      session_event_sequence INTEGER NOT NULL,
      action_attempt_sequence INTEGER NOT NULL,
      action_kind TEXT NOT NULL,
      target_word_id TEXT NOT NULL REFERENCES words(id),
      sampled_skill_ids_json TEXT NOT NULL,
      response TEXT,
      outcome TEXT NOT NULL,
      rating TEXT,
      projected_at TEXT
    );
    CREATE TABLE study_events (
      id TEXT PRIMARY KEY,
      occurred_at TEXT NOT NULL,
      session_id TEXT,
      session_action_id TEXT,
      session_event_sequence INTEGER,
      event_type TEXT NOT NULL,
      projected_at TEXT
    );
    CREATE TABLE word_skill_relevance (
      word_id TEXT NOT NULL,
      skill_id TEXT NOT NULL,
      relevance_state TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      source_event_id TEXT,
      PRIMARY KEY (word_id, skill_id)
    );
    CREATE TABLE study_content_feedback (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      target_word_id TEXT NOT NULL,
      action_kind TEXT NOT NULL,
      feedback_type TEXT NOT NULL,
      feedback_action TEXT NOT NULL,
      source_event_id TEXT,
      note TEXT NOT NULL
    );
    CREATE TABLE contrast_clusters (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      note TEXT NOT NULL
    );
    CREATE TABLE contrast_cluster_members (
      cluster_id TEXT NOT NULL,
      word_id TEXT NOT NULL,
      nuance_note TEXT NOT NULL,
      display_order INTEGER,
      PRIMARY KEY (cluster_id, word_id)
    );
    CREATE TABLE contrast_prompts (
      id TEXT PRIMARY KEY,
      cluster_id TEXT NOT NULL,
      target_word_id TEXT NOT NULL,
      prompt_text TEXT NOT NULL,
      explanation TEXT NOT NULL
    );
  `);
}

function insertCompleteSession() {
  sqlite.exec(`
    INSERT OR IGNORE INTO words (id, hanzi, traditional, pinyin, meaning, meanings_json)
    VALUES
      ('target', '目标', '目標', 'mùbiāo', 'goal', '["goal","objective"]'),
      ('alternate', '替代', NULL, 'tìdài', 'substitute', '["substitute"]');
    INSERT OR IGNORE INTO word_meanings (id, word_id, position, text)
    VALUES
      ('target-1', 'target', 0, 'goal'),
      ('target-2', 'target', 1, 'objective'),
      ('alternate-1', 'alternate', 0, 'substitute');
    INSERT OR IGNORE INTO study_sessions
      (id, started_at, ended_at, processing_state, processed_at)
    VALUES ('session-1', '${startedAt}', NULL, 'processed', '${completedAt}');
    INSERT OR IGNORE INTO review_session_summaries (session_id, completed_at)
    VALUES ('session-1', '${completedAt}');
    INSERT OR IGNORE INTO study_attempt_events (
      id, occurred_at, session_id, session_action_id, session_event_sequence,
      action_attempt_sequence, action_kind, target_word_id,
      sampled_skill_ids_json, response, outcome, rating, projected_at
    ) VALUES
      (
        'attempt-1', '2026-07-29T08:05:00.000Z', 'session-1', 'action-1', 1,
        1, 'production', 'target', '["production"]', '替代', 'incorrect', 'forgot',
        '2026-07-29T08:10:00.000Z'
      ),
      (
        'attempt-2', '2026-07-29T08:06:00.000Z', 'session-1', 'action-1', 2,
        2, 'production', 'target', '["production"]', '目标', 'correct', 'good',
        '2026-07-29T08:10:00.000Z'
      );
  `);
}

function supplement(rawResponse: string): SessionReflectionEvidenceSupplementV1 {
  return {
    schemaVersion: 'session_reflection_evidence_supplement.v1',
    items: [{
      itemId: 'production-mistake:action-1',
      sessionActionId: 'action-1',
      targetWordId: 'target',
      cuesAsShown: [{
        cueId: null,
        cueType: 'definition_gloss',
        displayOrder: 0,
        text: 'goal; objective',
        displayedMeanings: ['goal', 'objective'],
      }],
      rawResponse,
      attemptIds: ['attempt-1', 'attempt-2'],
    }],
  };
}

function withAttemptIds(
  value: SessionReflectionEvidenceSupplementV1,
  attemptIds: string[],
): SessionReflectionEvidenceSupplementV1 {
  return withItem(value, { attemptIds });
}

function withItem(
  value: SessionReflectionEvidenceSupplementV1,
  patch: Partial<SessionReflectionEvidenceSupplementV1['items'][number]>,
): SessionReflectionEvidenceSupplementV1 {
  return {
    ...value,
    items: [{ ...value.items[0]!, ...patch }],
  };
}

function assertEvidenceError(
  run: () => unknown,
  code: ReflectionEvidenceError['code'],
  httpStatus: ReflectionEvidenceError['httpStatus'],
  label?: string,
) {
  assert.throws(run, (error: unknown) => {
    assert(error instanceof ReflectionEvidenceError, label);
    assert.equal(error.code, code, label);
    assert.equal(error.httpStatus, httpStatus, label);
    return true;
  });
}

function totalChanges(): number {
  return (sqlite.prepare('SELECT total_changes() AS count').get() as { count: number }).count;
}

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
