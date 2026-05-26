import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, before, beforeEach, describe, test } from 'node:test';
import { pathToFileURL } from 'node:url';

type WordStatus = 'unstudied' | 'learning' | 'review';
type DbModule = typeof import('../server/db.ts');

let dataDir = '';
let dbPath = '';
let sqlite: DatabaseSync;
let dbModule: DbModule;

describe('study management relevance events', { concurrency: false }, () => {
  before(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chinese-study-app-study-management-'));
    dbPath = path.join(dataDir, 'app.db');

    const previousMode = process.env.APP_MODE;
    const previousDataDir = process.env.APP_DATA_DIR;

    process.env.APP_MODE = 'study';
    process.env.APP_DATA_DIR = dataDir;

    const moduleUrl = `${pathToFileURL(path.resolve('server/db.ts')).href}?test=study-management-${Date.now()}`;
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
      DELETE FROM study_content_feedback;
      DELETE FROM contrast_candidate_intake;
      DELETE FROM word_skill_relevance;
      DELETE FROM study_events;
      DELETE FROM study_attempt_events;
      DELETE FROM study_sessions;
      DELETE FROM word_skill_state;
      DELETE FROM word_study_admission_state;
      DELETE FROM words;
    `);
  });

  after(() => {
    sqlite.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  test('creates generic study-event, skill relevance, and contrast intake tables', () => {
    assertTableHasColumns('study_events', [
      'id',
      'occurred_at',
      'session_id',
      'session_action_id',
      'session_event_sequence',
      'event_type',
      'target_word_id',
      'action_kind',
      'sampled_skill_ids_json',
      'content_ref_json',
      'payload_json',
      'projected_at',
    ]);

    assertTableHasColumns('word_skill_relevance', [
      'word_id',
      'skill_id',
      'relevance_state',
      'updated_at',
      'source_event_id',
    ]);

    assertTableHasColumns('contrast_candidate_intake', [
      'id',
      'created_at',
      'target_word_id',
      'source_event_id',
      'source_action_kind',
      'source_content_ref_json',
      'candidate_text',
      'matched_word_id',
      'note',
      'status',
    ]);

    assertTableHasColumns('study_content_feedback', [
      'id',
      'created_at',
      'target_type',
      'target_id',
      'target_word_id',
      'action_kind',
      'feedback_type',
      'source_event_id',
      'note',
    ]);
  });

  test('records suppress plus contrast candidate as one event with current-state projections', () => {
    insertWord({ id: 'target-word', hanzi: '考察', status: 'review' });
    insertWord({ id: 'matched-word', hanzi: '考查', status: 'review' });

    const event = dbModule.recordStudyManagementAction({
      sessionId: 'session-1',
      sessionActionId: 'review/target-word/production',
      targetWordId: 'target-word',
      actionKind: 'production',
      sampledSkillIds: ['production'],
      contentRef: null,
      managementAction: 'suppress_skill_and_add_contrast_candidate',
      note: 'Confusing production prompt.',
      candidateText: '考查',
    });

    assert.equal(event.eventType, 'skill_relevance_changed_with_contrast_candidate');
    assert.equal(event.sessionEventSequence, 1);
    assert.equal(event.projectedAt, event.occurredAt);
    assert.deepEqual(dbModule.getStudyEventsForSession('session-1'), [event]);

    assert.deepEqual(dbModule.getWordSkillRelevance('target-word', 'production'), {
      wordId: 'target-word',
      skillId: 'production',
      relevanceState: 'suppressed',
      updatedAt: event.occurredAt,
      sourceEventId: event.id,
    });

    assert.deepEqual(dbModule.getWordSkillRelevance('target-word', 'contextual_selection'), {
      wordId: 'target-word',
      skillId: 'contextual_selection',
      relevanceState: 'normal',
      updatedAt: event.occurredAt,
      sourceEventId: event.id,
    });
    assert.deepEqual(dbModule.getWordSkillRelevanceRows(), [
      {
        wordId: 'target-word',
        skillId: 'contextual_selection',
        relevanceState: 'normal',
        updatedAt: event.occurredAt,
        sourceEventId: event.id,
      },
      {
        wordId: 'target-word',
        skillId: 'production',
        relevanceState: 'suppressed',
        updatedAt: event.occurredAt,
        sourceEventId: event.id,
      },
    ]);

    const intakeRows = dbModule.getContrastCandidateIntake();
    assert.equal(intakeRows.length, 1);
    assert.equal(intakeRows[0]?.targetWordId, 'target-word');
    assert.equal(intakeRows[0]?.sourceEventId, event.id);
    assert.equal(intakeRows[0]?.sourceActionKind, 'production');
    assert.equal(intakeRows[0]?.candidateText, '考查');
    assert.equal(intakeRows[0]?.matchedWordId, 'matched-word');
    assert.equal(intakeRows[0]?.note, 'Confusing production prompt.');
    assert.equal(intakeRows[0]?.status, 'open');
  });

  test('records bad prompt feedback without changing skill relevance', () => {
    insertWord({ id: 'target-word', hanzi: '恰当', status: 'review' });

    const event = dbModule.recordStudyManagementAction({
      sessionId: 'session-1',
      sessionActionId: 'review/target-word/production',
      targetWordId: 'target-word',
      actionKind: 'production',
      sampledSkillIds: ['production'],
      contentRef: null,
      managementAction: 'bad_prompt',
      note: 'Definition is too broad.',
    });

    assert.equal(event.eventType, 'bad_prompt_reported');
    assert.equal(dbModule.getWordSkillRelevance('target-word', 'production'), null);
    assert.deepEqual(dbModule.getContrastCandidateIntake(), []);
    const feedbackRows = dbModule.getStudyContentFeedback();
    assert.equal(feedbackRows.length, 1);
    assert.equal(feedbackRows[0]?.targetType, 'generated_prompt');
    assert.equal(feedbackRows[0]?.targetId, 'definition_based_production');
    assert.equal(feedbackRows[0]?.targetWordId, 'target-word');
    assert.equal(feedbackRows[0]?.actionKind, 'production');
    assert.equal(feedbackRows[0]?.feedbackType, 'bad_prompt');
    assert.equal(feedbackRows[0]?.sourceEventId, event.id);
    assert.equal(feedbackRows[0]?.note, 'Definition is too broad.');
    assert.equal(fetchAdmissionState('target-word')?.earliest_next_study_at, addHours(event.occurredAt, 6));
  });

  test('projects bad contrast prompt feedback to a contrast prompt feedback target', () => {
    insertWord({ id: 'target-word', hanzi: '恰当', status: 'review' });

    const event = dbModule.recordStudyManagementAction({
      sessionId: 'session-1',
      sessionActionId: 'review/target-word/contextual-selection',
      targetWordId: 'target-word',
      actionKind: 'contrast_selection',
      sampledSkillIds: ['contextual_selection'],
      contentRef: { type: 'contrast_prompt', id: 'contrast-prompt-1' },
      managementAction: 'bad_prompt',
      note: 'The context admits both answers.',
    });

    const feedbackRows = dbModule.getStudyContentFeedback();
    assert.equal(feedbackRows.length, 1);
    assert.equal(feedbackRows[0]?.targetType, 'contrast_prompt');
    assert.equal(feedbackRows[0]?.targetId, 'contrast-prompt-1');
    assert.equal(feedbackRows[0]?.targetWordId, 'target-word');
    assert.equal(feedbackRows[0]?.actionKind, 'contrast_selection');
    assert.equal(feedbackRows[0]?.sourceEventId, event.id);
    assert.equal(feedbackRows[0]?.note, 'The context admits both answers.');
    assert.equal(fetchAdmissionState('target-word')?.earliest_next_study_at, addHours(event.occurredAt, 6));
  });

  test('initializes contextual selection scheduler state when contrast is enabled', () => {
    insertWord({ id: 'target-word', hanzi: '考察', status: 'review' });
    insertWord({ id: 'matched-word', hanzi: '考查', status: 'review' });

    const event = dbModule.recordStudyManagementAction({
      sessionId: 'session-1',
      sessionActionId: 'review/target-word/production',
      targetWordId: 'target-word',
      actionKind: 'production',
      sampledSkillIds: ['production'],
      contentRef: null,
      managementAction: 'add_contrast_candidate',
      candidateText: '考查',
    });

    const state = fetchWordSkillState('target-word', 'contextual_selection');
    assert.equal(state?.word_id, 'target-word');
    assert.equal(state?.skill_id, 'contextual_selection');
    assert.equal(state?.enabled, 1);
    assert.equal(state?.interval_hours, 6);
    assert.equal(state?.last_studied_at, addHours(event.occurredAt, -6));
    assert.equal(state?.next_due_at, event.occurredAt);
    assert.equal(state?.ease_factor, 2.5);
  });

  test('keeps skill management limited to review words initially', () => {
    insertWord({ id: 'learning-word', hanzi: '测试', status: 'learning' });

    assert.throws(
      () => dbModule.recordStudyManagementAction({
        sessionId: 'session-1',
        sessionActionId: 'learning/learning-word/production',
        targetWordId: 'learning-word',
        actionKind: 'production',
        sampledSkillIds: ['production'],
        contentRef: null,
        managementAction: 'suppress_skill',
      }),
      /Study management actions are currently limited to review words/,
    );
  });
});

function insertWord({
  id,
  hanzi,
  status,
}: {
  id: string;
  hanzi: string;
  status: WordStatus;
}) {
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
    ) VALUES (?, ?, NULL, ?, ?, ?, '', ?, ?, 1, ?, 0, NULL, NULL)
  `).run(
    id,
    hanzi,
    `${hanzi} pinyin`,
    `${hanzi} meaning`,
    JSON.stringify([`${hanzi} meaning`]),
    JSON.stringify([`${hanzi} example`]),
    status,
    '2026-05-10T00:00:00.000Z',
  );
}

function fetchAdmissionState(wordId: string) {
  return sqlite
    .prepare(`
      SELECT
        word_id,
        study_phase,
        earliest_next_study_at
      FROM word_study_admission_state
      WHERE word_id = ?
    `)
    .get(wordId) as { word_id: string; study_phase: string; earliest_next_study_at: string | null } | undefined;
}

function fetchWordSkillState(wordId: string, skillId: string) {
  return sqlite
    .prepare(`
      SELECT
        word_id,
        skill_id,
        enabled,
        interval_hours,
        last_studied_at,
        next_due_at,
        ease_factor
      FROM word_skill_state
      WHERE word_id = ?
        AND skill_id = ?
    `)
    .get(wordId, skillId) as {
      word_id: string;
      skill_id: string;
      enabled: number;
      interval_hours: number;
      last_studied_at: string;
      next_due_at: string | null;
      ease_factor: number;
    } | undefined;
}

function addHours(isoTimestamp: string, hours: number) {
  const date = new Date(isoTimestamp);
  date.setUTCHours(date.getUTCHours() + hours);
  return date.toISOString();
}

function assertTableHasColumns(tableName: string, expectedColumns: string[]) {
  const rows = sqlite.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  const actualColumns = new Set(rows.map((row) => row.name));

  for (const column of expectedColumns) {
    assert.equal(actualColumns.has(column), true, `${tableName} is missing ${column}`);
  }
}
