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
    sqlite.function('current_learner_id', () => 'test-learner');
    sqlite.exec('PRAGMA foreign_keys = ON;');
  });

  beforeEach(() => {
    sqlite.exec(`
      DELETE FROM contrast_prompt_exclusions;
      DELETE FROM definition_fallback_exclusions;
      DELETE FROM contrast_prompts;
      DELETE FROM contrast_cluster_members;
      DELETE FROM contrast_clusters;
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

  test('creates study-event, skill relevance, and purpose-specific prompt exclusion tables', () => {
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

    assertTableHasColumns('definition_fallback_exclusions', [
      'learner_id',
      'word_id',
      'origin',
      'source_feedback_ids_json',
      'migration_id',
      'created_at',
      'note',
    ]);

    assertTableHasColumns('contrast_prompt_exclusions', [
      'learner_id',
      'prompt_id',
      'target_word_id',
      'origin',
      'source_feedback_ids_json',
      'migration_id',
      'created_at',
      'note',
    ]);
  });

  test('suppresses production outside session without creating study events', () => {
    insertWord({ id: 'target-word', hanzi: '恰当', status: 'review' });
    const relevance = dbModule.suppressProductionForWordOutsideSession({ targetWordId: 'target-word' });

    assert.equal(relevance.wordId, 'target-word');
    assert.equal(relevance.skillId, 'production');
    assert.equal(relevance.relevanceState, 'suppressed');
    assert.equal(relevance.sourceEventId, null);
    assert.equal(dbModule.getWordSkillRelevance('target-word', 'production')?.relevanceState, 'suppressed');
  });

  test('does not overwrite the provenance of production already suppressed elsewhere', () => {
    insertWord({ id: 'target-word', hanzi: '恰当', status: 'review' });
    const original = dbModule.suppressProductionForWordOutsideSession({
      targetWordId: 'target-word',
    });

    dbModule.recordStudyManagementAction({
      sessionId: 'session-1',
      sessionActionId: 'review/target-word/production',
      targetWordId: 'target-word',
      actionKind: 'production',
      sampledSkillIds: ['production'],
      contentRef: null,
      managementAction: 'suppress_skill',
    });

    assert.deepEqual(
      dbModule.getWordSkillRelevance('target-word', 'production'),
      original,
    );
  });

  test('keeps legacy bad-prompt feedback readable without a live write path', () => {
    insertWord({ id: 'target-word', hanzi: '恰当', status: 'review' });
    insertLegacyFeedback({
      id: 'legacy-definition-feedback',
      targetType: 'generated_prompt',
      targetId: 'definition_based_production',
      targetWordId: 'target-word',
      actionKind: 'production',
      note: 'Too broad.',
    });

    const feedback = dbModule.getStudyContentFeedback().at(-1);
    assert.equal(feedback.targetType, 'generated_prompt');
    assert.equal(feedback.targetId, 'definition_based_production');
    assert.equal(feedback.targetWordId, 'target-word');
    assert.equal(feedback.sourceEventId, null);
  });

  test('exposes unresolved bad prompt feedback on contrast cluster content', () => {
    insertWord({ id: 'target-word', hanzi: '恰当', status: 'review' });
    insertWord({ id: 'sibling-word', hanzi: '适当', status: 'review' });
    dbModule.createContrastCluster({ id: 'cluster-1', title: '恰当 / 适当' });
    dbModule.addContrastClusterMember({ clusterId: 'cluster-1', wordId: 'target-word' });
    dbModule.addContrastClusterMember({ clusterId: 'cluster-1', wordId: 'sibling-word' });
    const prompt = dbModule.createContrastPrompt({
      id: 'contrast-prompt-1',
      clusterId: 'cluster-1',
      targetWordId: 'target-word',
      promptText: '这个例子很____。',
    });

    insertLegacyFeedback({
      id: 'legacy-contrast-feedback',
      targetType: 'contrast_prompt',
      targetId: prompt.id,
      targetWordId: 'target-word',
      actionKind: 'contrast_selection',
      note: 'Wrong target.',
    });

    const [cluster] = dbModule.getContrastClusterContent();
    const [promptContent] = cluster?.prompts ?? [];
    assert.equal(promptContent?.id, prompt.id);
    assert.equal(promptContent?.feedback.flagged, true);
    assert.equal(promptContent?.feedback.badPromptCount, 1);
    assert.equal(promptContent?.feedback.notes[0], 'Wrong target.');
    assert.match(promptContent?.feedback.latestBadPromptAt ?? '', /^\d{4}-\d{2}-\d{2}T/);
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

function insertLegacyFeedback({
  id,
  targetType,
  targetId,
  targetWordId,
  actionKind,
  note,
}: {
  id: string;
  targetType: 'generated_prompt' | 'contrast_prompt';
  targetId: string;
  targetWordId: string;
  actionKind: 'production' | 'contrast_selection';
  note: string;
}) {
  if (targetType === 'generated_prompt') {
    assert.equal(targetId, 'definition_based_production');
    assert.equal(actionKind, 'production');
    sqlite.prepare(`
      INSERT INTO definition_fallback_exclusions (
        learner_id, word_id, origin, source_feedback_ids_json, migration_id, created_at, note
      ) VALUES ('test-learner', ?, 'legacy_bad_prompt_migration', ?, NULL, ?, ?)
    `).run(targetWordId, JSON.stringify([id]), '2026-05-10T00:00:00.000Z', note);
    return;
  }

  assert.equal(actionKind, 'contrast_selection');
  sqlite.prepare(`
    INSERT INTO contrast_prompt_exclusions (
      learner_id, prompt_id, target_word_id, origin, source_feedback_ids_json,
      migration_id, created_at, note
    ) VALUES ('test-learner', ?, ?, 'legacy_bad_prompt_migration', ?, NULL, ?, ?)
  `).run(targetId, targetWordId, JSON.stringify([id]), '2026-05-10T00:00:00.000Z', note);
}

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
