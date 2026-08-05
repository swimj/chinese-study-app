import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, before, beforeEach, describe, test } from 'node:test';
import { pathToFileURL } from 'node:url';
import type { StudyAttemptEvent } from '../src/domain/study-actions.ts';

type DbModule = typeof import('../server/db.ts');

let dataDir = '';
let dbPath = '';
let sqlite: DatabaseSync;
let dbModule: DbModule;

describe('study attempt event storage', { concurrency: false }, () => {
  before(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chinese-study-app-attempt-events-'));
    dbPath = path.join(dataDir, 'app.db');

    const previousMode = process.env.APP_MODE;
    const previousDataDir = process.env.APP_DATA_DIR;

    process.env.APP_MODE = 'study';
    process.env.APP_DATA_DIR = dataDir;

    const moduleUrl = `${pathToFileURL(path.resolve('server/db.ts')).href}?test=${Date.now()}`;
    dbModule = await import(moduleUrl);

    if (previousMode === undefined) {
      delete process.env.APP_MODE;
    } else {
      process.env.APP_MODE = previousMode;
    }

    if (previousDataDir === undefined) {
      delete process.env.APP_DATA_DIR;
    } else {
      process.env.APP_DATA_DIR = previousDataDir;
    }

    sqlite = new DatabaseSync(dbPath);
    sqlite.exec('PRAGMA foreign_keys = ON;');
  });

  beforeEach(() => {
    sqlite.exec(`
      DELETE FROM study_attempt_events;
      DELETE FROM study_sessions;
      DELETE FROM words;
    `);
  });

  after(() => {
    sqlite.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  test('creates durable study session and attempt event tables', () => {
    assertTableHasColumns('study_sessions', [
      'id',
      'started_at',
      'ended_at',
      'processing_state',
      'processed_at',
    ]);

    assertTableHasColumns('study_attempt_events', [
      'id',
      'occurred_at',
      'session_id',
      'session_action_id',
      'session_event_sequence',
      'action_attempt_sequence',
      'action_kind',
      'target_word_id',
      'sampled_skill_ids_json',
      'response',
      'outcome',
      'rating',
      'content_ref_json',
      'metadata_json',
      'projected_at',
    ]);
  });

  test('upserts and fetches a durable study session record', () => {
    const session = dbModule.upsertStudySessionRecord({
      id: 'session-1',
      startedAt: '2026-05-10T01:00:00.000Z',
      endedAt: null,
      processingState: 'open',
      processedAt: null,
    });

    assert.deepEqual(session, {
      id: 'session-1',
      startedAt: '2026-05-10T01:00:00.000Z',
      endedAt: null,
      processingState: 'open',
      processedAt: null,
    });

    assert.deepEqual(dbModule.getStudySessionRecord('session-1'), session);

    assert.deepEqual(
      dbModule.upsertStudySessionRecord({
        ...session,
        endedAt: '2026-05-10T01:30:00.000Z',
        processingState: 'ready_to_process',
      }),
      {
        ...session,
        endedAt: '2026-05-10T01:30:00.000Z',
        processingState: 'ready_to_process',
      },
    );
  });

  test('stores accepted attempt events with stable ids and JSON fields', () => {
    insertReviewWord('target-word');
    dbModule.upsertStudySessionRecord(createSessionRecord('session-1'));

    const events = dbModule.insertStudyAttemptEvents([
      createAttemptEvent({
        id: 'attempt-2',
        sessionEventSequence: 2,
        actionAttemptSequence: 2,
        response: '考察',
        outcome: 'correct',
        rating: 'good',
        contentRef: {
          type: 'production_cue',
          taskId: 'production-task:target-word:default_production',
          cueId: 'cue-1',
        },
        metadata: { source: 'test', accepted: true },
      }),
      createAttemptEvent({
        id: 'attempt-1',
        sessionEventSequence: 1,
        actionAttemptSequence: 1,
        response: '考查',
        outcome: 'incorrect',
        rating: 'forgot',
        contentRef: { type: 'example_sentence', id: 'example-1' },
      }),
    ]);

    assert.deepEqual(events.map((event) => event.id), ['attempt-1', 'attempt-2']);
    assert.deepEqual(events[0], {
      id: 'attempt-1',
      occurredAt: '2026-05-10T01:05:00.000Z',
      sessionId: 'session-1',
      sessionActionId: 'session-1/action-1',
      sessionEventSequence: 1,
      actionAttemptSequence: 1,
      actionKind: 'production',
      targetWordId: 'target-word',
      sampledSkillIds: ['production'],
      response: '考查',
      outcome: 'incorrect',
      rating: 'forgot',
      contentRef: { type: 'example_sentence', id: 'example-1' },
      metadata: {},
    });
    assert.deepEqual(events[1]?.contentRef, {
      type: 'production_cue',
      taskId: 'production-task:target-word:default_production',
      cueId: 'cue-1',
    });
    assert.deepEqual(events[1]?.metadata, { source: 'test', accepted: true });

    const rawRow = sqlite
      .prepare(`
        SELECT projected_at
        FROM study_attempt_events
        WHERE id = ?
      `)
      .get('attempt-1') as { projected_at: string | null };
    assert.equal(rawRow.projected_at, null);
  });

  test('rejects duplicate attempt event ids through the storage constraint', () => {
    insertReviewWord('target-word');
    dbModule.upsertStudySessionRecord(createSessionRecord('session-1'));
    const event = createAttemptEvent({ id: 'duplicate-attempt' });

    dbModule.insertStudyAttemptEvents([event]);

    assert.throws(
      () => dbModule.insertStudyAttemptEvents([event]),
      /UNIQUE constraint failed: study_attempt_events\.id/,
    );
  });

  test('rejects invalid attempt event batches before persistence', () => {
    insertReviewWord('target-word');
    dbModule.upsertStudySessionRecord(createSessionRecord('session-1'));

    assert.throws(
      () =>
        dbModule.insertStudyAttemptEvents([
          {
            ...createAttemptEvent({ id: 'invalid-sequence' }),
            actionAttemptSequence: 0,
          },
        ]),
      /Expected positive integer actionAttemptSequence/,
    );

    assert.equal(dbModule.getStudyAttemptEventsForSession('session-1').length, 0);
  });
});

function assertTableHasColumns(tableName: string, expectedColumns: string[]) {
  const rows = sqlite.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  const actualColumns = new Set(rows.map((row) => row.name));

  for (const column of expectedColumns) {
    assert.equal(actualColumns.has(column), true, `Expected ${tableName}.${column}`);
  }
}

function createSessionRecord(id: string) {
  return {
    id,
    startedAt: '2026-05-10T01:00:00.000Z',
    endedAt: null,
    processingState: 'open' as const,
    processedAt: null,
  };
}

function createAttemptEvent(overrides: Partial<StudyAttemptEvent> & Pick<StudyAttemptEvent, 'id'>): StudyAttemptEvent {
  return {
    id: overrides.id,
    occurredAt: overrides.occurredAt ?? '2026-05-10T01:05:00.000Z',
    sessionId: overrides.sessionId ?? 'session-1',
    sessionActionId: overrides.sessionActionId ?? 'session-1/action-1',
    sessionEventSequence: overrides.sessionEventSequence ?? 1,
    actionAttemptSequence: overrides.actionAttemptSequence ?? 1,
    actionKind: overrides.actionKind ?? 'production',
    targetWordId: overrides.targetWordId ?? 'target-word',
    sampledSkillIds: overrides.sampledSkillIds ?? ['production'],
    response: overrides.response ?? null,
    outcome: overrides.outcome ?? 'correct',
    rating: overrides.rating ?? 'good',
    contentRef: overrides.contentRef ?? null,
    metadata: overrides.metadata ?? {},
  };
}

function insertReviewWord(wordId: string) {
  sqlite.prepare(`
    INSERT INTO words (
      id,
      hanzi,
      traditional,
      pinyin,
      meaning,
      meanings_json,
      personal_notes,
      examples_json,
      status,
      priority,
      created_at,
      learning_streak,
      last_learning_success_on,
      last_learning_covered_on
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    wordId,
    '考察',
    null,
    'kao cha',
    'inspect',
    JSON.stringify(['inspect']),
    '',
    JSON.stringify([]),
    'review',
    100,
    '2026-05-01T00:00:00.000Z',
    0,
    null,
    null,
  );
}
