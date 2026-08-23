import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, test } from 'node:test';
import {
  applyLegacyPromptFeedbackMigration,
  inspectLegacyPromptFeedback,
  LEGACY_BAD_PROMPT_MIGRATION_ID,
} from '../server/db/legacy-prompt-feedback.ts';
import { validateLegacyLearnerUpgrade } from '../server/db/legacy-upgrade-validation.ts';

describe('legacy bad-prompt migration', () => {
  test('reports the active set, preserves provenance, and leaves due dates unchanged', () => {
    const db = createLegacyFixture();
    const report = inspectLegacyPromptFeedback(db);

    assert.equal(report.totalFeedbackRows, 5);
    assert.equal(report.resolvedTargetCount, 1);
    assert.deepEqual(report.definitionExclusions.map((row) => row.targetWordId), ['definition-active']);
    assert.deepEqual(report.definitionExclusions[0]?.sourceFeedbackIds, ['definition-report-1', 'definition-report-2']);
    assert.deepEqual(report.contrastPromptExclusions.map((row) => row.targetId), ['contrast-prompt-active']);
    assert.deepEqual(report.invalidActiveTargets, []);

    const dueBefore = readDueDate(db, 'definition-active');
    applyLegacyPromptFeedbackMigration(db, 'dogfood-owner', report);

    assert.equal(readDueDate(db, 'definition-active'), dueBefore);
    assert.equal(tableExists(db, 'study_content_feedback'), false);
    assert.equal(tableExists(db, 'contrast_candidate_intake'), false);
    assert.deepEqual(
      db.prepare(`
        SELECT learner_id, word_id, origin, source_feedback_ids_json, migration_id, note
        FROM definition_fallback_exclusions
      `).all().map((row) => ({ ...row })),
      [{
        learner_id: 'dogfood-owner',
        word_id: 'definition-active',
        origin: 'legacy_bad_prompt_migration',
        source_feedback_ids_json: '["definition-report-1","definition-report-2"]',
        migration_id: LEGACY_BAD_PROMPT_MIGRATION_ID,
        note: 'Still useful, but needs repair.',
      }],
    );
    assert.equal(
      (db.prepare('SELECT COUNT(*) AS count FROM contrast_prompt_exclusions').get() as { count: number }).count,
      1,
    );
    assert.ok(db.prepare('SELECT 1 FROM schema_migrations WHERE migration_id = ?').get(LEGACY_BAD_PROMPT_MIGRATION_ID));
    db.close();
  });

  test('refuses to apply when an active feedback target is invalid', () => {
    const db = createLegacyFixture();
    insertFeedback(db, {
      id: 'missing-word-feedback', createdAt: '2026-01-06T00:00:00.000Z',
      targetType: 'generated_prompt', targetId: 'definition_based_production',
      targetWordId: 'missing-word', actionKind: 'production', action: 'reported', note: '',
    });
    const report = inspectLegacyPromptFeedback(db);
    assert.equal(report.invalidActiveTargets.length, 1);
    assert.throws(
      () => applyLegacyPromptFeedbackMigration(db, 'dogfood-owner', report),
      /active targets are invalid/,
    );
    assert.equal(tableExists(db, 'study_content_feedback'), true);
    db.close();
  });

  test('upgrades a legacy database through a validated replacement while preserving due dates', () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chinese-study-app-legacy-upgrade-'));
    const dbPath = path.join(dataDir, 'app.db');
    const db = createLegacyFixture(dbPath);
    addNonLatinDefinitionFeedback(db);
    const dueBefore = readDueDate(db, 'definition-active');
    db.close();

    const output = execFileSync(
      process.execPath,
      [
        '--import', 'tsx', 'scripts/upgrade-legacy-db-to-learner.ts',
        `--data-dir=${dataDir}`,
        '--learner-id=dogfood-owner',
        '--apply=true',
      ],
      { cwd: process.cwd(), encoding: 'utf8' },
    );
    assert.match(output, /"applied":true/);
    assert.match(output, /"postUpgradeValidation"/);

    const upgraded = new DatabaseSync(dbPath);
    upgraded.function('current_learner_id', () => 'dogfood-owner');
    assert.equal(
      (upgraded.prepare(`
        SELECT next_due_at FROM learner_owned_word_skill_state
        WHERE learner_id = 'dogfood-owner' AND word_id = 'definition-active'
      `).get() as { next_due_at: string }).next_due_at,
      dueBefore,
    );
    assert.equal(
      (upgraded.prepare('SELECT personal_notes FROM learner_word_state WHERE word_id = ?').get('definition-active') as {
        personal_notes: string;
      }).personal_notes,
      '',
    );
    assert.deepEqual(
      upgraded.prepare(`
        SELECT text, position
        FROM lexical_word_meanings
        WHERE word_id = 'definition-active'
        ORDER BY position ASC
      `).all().map((row) => ({ ...row })),
      [{ text: 'definition', position: 0 }],
    );
    assert(upgraded.prepare(`
      SELECT 1 FROM schema_migrations WHERE migration_id = 'swi_47_learner_ownership_v1'
    `).get());
    assert(upgraded.prepare(`
      SELECT 1 FROM definition_fallback_exclusions
      WHERE learner_id = 'dogfood-owner' AND word_id = 'definition-active'
        AND origin = 'legacy_bad_prompt_migration'
    `).get());
    const backupName = fs.readdirSync(dataDir).find((name) => name.startsWith('app.db.pre-swi-47-'));
    assert(backupName);
    const backupPath = path.join(dataDir, backupName);
    const legacy = new DatabaseSync(backupPath, { readOnly: true });
    const validation = validateLegacyLearnerUpgrade({
      legacyDb: legacy,
      upgradedDb: upgraded,
      learnerId: 'dogfood-owner',
    });
    assert.equal(validation.ok, true);
    assert.deepEqual(
      validation.checks.map((check) => check.surface),
      [
        'scheduler.word_skill_state',
        'scheduler.word_study_admission_state',
        'priority.corpus',
        'priority.learner_overrides',
        'learner.word_state',
        'suppression.skill_relevance',
        'suppression.meaning_visibility',
        'suppression.definition_bad_prompts',
        'suppression.contrast_bad_prompts',
      ],
    );
    const checkerOutput = execFileSync(
      process.execPath,
      [
        '--import', 'tsx', 'scripts/check-legacy-learner-upgrade.ts',
        `--legacy-db=${backupPath}`,
        `--upgraded-db=${dbPath}`,
        '--learner-id=dogfood-owner',
      ],
      { cwd: process.cwd(), encoding: 'utf8' },
    );
    assert.match(checkerOutput, /"ok": true/);

    upgraded.prepare(`
      UPDATE learner_owned_word_skill_state SET interval_hours = 999
      WHERE learner_id = 'dogfood-owner' AND word_id = 'definition-active' AND skill_id = 'production'
    `).run();
    assert.throws(
      () => validateLegacyLearnerUpgrade({ legacyDb: legacy, upgradedDb: upgraded, learnerId: 'dogfood-owner' }),
      /scheduler\.word_skill_state mismatch/,
    );
    upgraded.prepare(`
      UPDATE learner_owned_word_skill_state SET interval_hours = 24
      WHERE learner_id = 'dogfood-owner' AND word_id = 'definition-active' AND skill_id = 'production'
    `).run();

    upgraded.prepare(`
      UPDATE learner_owned_user_word_priority SET priority_tier = -1
      WHERE learner_id = 'dogfood-owner' AND word_id = 'definition-active'
    `).run();
    assert.throws(
      () => validateLegacyLearnerUpgrade({ legacyDb: legacy, upgradedDb: upgraded, learnerId: 'dogfood-owner' }),
      /priority\.learner_overrides mismatch/,
    );
    upgraded.prepare(`
      UPDATE learner_owned_user_word_priority SET priority_tier = 1
      WHERE learner_id = 'dogfood-owner' AND word_id = 'definition-active'
    `).run();

    upgraded.prepare(`
      UPDATE learner_owned_word_skill_relevance SET relevance_state = 'relevant'
      WHERE learner_id = 'dogfood-owner' AND word_id = 'definition-active' AND skill_id = 'production'
    `).run();
    assert.throws(
      () => validateLegacyLearnerUpgrade({ legacyDb: legacy, upgradedDb: upgraded, learnerId: 'dogfood-owner' }),
      /suppression\.skill_relevance mismatch/,
    );

    legacy.close();
    upgraded.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
});

function createLegacyFixture(target = ':memory:'): DatabaseSync {
  const db = new DatabaseSync(target);
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE words (
      id TEXT PRIMARY KEY, hanzi TEXT NOT NULL, traditional TEXT, pinyin TEXT NOT NULL,
      meaning TEXT NOT NULL, meanings_json TEXT NOT NULL, personal_notes TEXT NOT NULL,
      examples_json TEXT NOT NULL, status TEXT NOT NULL, priority INTEGER NOT NULL,
      created_at TEXT NOT NULL, learning_streak INTEGER NOT NULL,
      last_learning_success_on TEXT, last_learning_covered_on TEXT
    );
    CREATE TABLE word_meanings (
      id TEXT PRIMARY KEY, word_id TEXT NOT NULL, position INTEGER NOT NULL, text TEXT NOT NULL,
      show_on_production_prompt INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE user_word_priority (
      word_id TEXT PRIMARY KEY, bump_count INTEGER NOT NULL, force_top INTEGER NOT NULL,
      priority_tier INTEGER NOT NULL, required_for_next_session INTEGER NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE word_study_admission_state (
      word_id TEXT PRIMARY KEY, study_phase TEXT NOT NULL, earliest_next_study_at TEXT
    );
    CREATE TABLE contrast_clusters (id TEXT PRIMARY KEY, title TEXT NOT NULL, note TEXT NOT NULL);
    CREATE TABLE contrast_cluster_members (
      cluster_id TEXT NOT NULL, word_id TEXT NOT NULL, nuance_note TEXT NOT NULL,
      display_order INTEGER, PRIMARY KEY (cluster_id, word_id)
    );
    CREATE TABLE contrast_prompts (
      id TEXT PRIMARY KEY, cluster_id TEXT NOT NULL, target_word_id TEXT NOT NULL,
      prompt_text TEXT NOT NULL, explanation TEXT NOT NULL
    );
    CREATE TABLE word_skill_state (
      word_id TEXT NOT NULL, skill_id TEXT NOT NULL, enabled INTEGER NOT NULL,
      interval_hours INTEGER NOT NULL, last_studied_at TEXT NOT NULL, next_due_at TEXT,
      ease_factor REAL NOT NULL, PRIMARY KEY (word_id, skill_id)
    );
    CREATE TABLE word_skill_relevance (
      word_id TEXT NOT NULL, skill_id TEXT NOT NULL, relevance_state TEXT NOT NULL,
      updated_at TEXT NOT NULL, source_event_id TEXT, PRIMARY KEY (word_id, skill_id)
    );
    CREATE TABLE contrast_candidate_intake (id TEXT PRIMARY KEY);
    CREATE TABLE study_content_feedback (
      id TEXT PRIMARY KEY, created_at TEXT NOT NULL, target_type TEXT NOT NULL,
      target_id TEXT NOT NULL, target_word_id TEXT NOT NULL, action_kind TEXT NOT NULL,
      feedback_type TEXT NOT NULL, feedback_action TEXT NOT NULL, note TEXT NOT NULL
    );
    INSERT INTO words VALUES
      ('definition-active', '定义', NULL, 'dìngyì', 'definition', '["definition"]', '', '[]', 'review', 3, '2026-01-01T00:00:00.000Z', 0, NULL, NULL),
      ('definition-resolved', '解决', NULL, 'jiějué', 'resolve', '["resolve"]', '', '[]', 'unstudied', 2, '2026-01-01T00:00:00.000Z', 0, NULL, NULL),
      ('contrast-word', '对比', NULL, 'duìbǐ', 'contrast', '["contrast"]', '', '[]', 'review', 1, '2026-01-01T00:00:00.000Z', 0, NULL, NULL);
    INSERT INTO word_meanings VALUES
      ('definition-meaning', 'definition-active', 0, 'definition', 0, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
      ('resolved-meaning', 'definition-resolved', 0, 'resolve', 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
      ('contrast-meaning', 'contrast-word', 0, 'contrast', 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
    INSERT INTO user_word_priority VALUES (
      'definition-active', 2, 1, 1, 1, '2026-01-30T00:00:00.000Z'
    );
    INSERT INTO word_study_admission_state VALUES (
      'definition-active', 'review', '2026-02-01T00:00:00.000Z'
    );
    INSERT INTO contrast_clusters VALUES ('legacy-cluster', 'Legacy contrast', '');
    INSERT INTO contrast_cluster_members VALUES ('legacy-cluster', 'contrast-word', '', 1);
    INSERT INTO contrast_prompts VALUES (
      'contrast-prompt-active', 'legacy-cluster', 'contrast-word', 'Choose 对比', ''
    );
    INSERT INTO word_skill_state VALUES (
      'definition-active', 'production', 1, 24, '2026-01-31T00:00:00.000Z',
      '2026-02-01T00:00:00.000Z', 2.5
    );
    INSERT INTO word_skill_relevance VALUES (
      'definition-active', 'production', 'suppressed', '2026-01-30T00:00:00.000Z', NULL
    );
  `);
  insertFeedback(db, {
    id: 'definition-report-1', createdAt: '2026-01-01T00:00:00.000Z',
    targetType: 'generated_prompt', targetId: 'definition_based_production',
    targetWordId: 'definition-active', actionKind: 'production', action: 'reported', note: 'First note.',
  });
  insertFeedback(db, {
    id: 'definition-report-2', createdAt: '2026-01-02T00:00:00.000Z',
    targetType: 'generated_prompt', targetId: 'definition_based_production',
    targetWordId: 'definition-active', actionKind: 'production', action: 'reported',
    note: 'Still useful, but needs repair.',
  });
  insertFeedback(db, {
    id: 'resolved-report', createdAt: '2026-01-01T00:00:00.000Z',
    targetType: 'generated_prompt', targetId: 'definition_based_production',
    targetWordId: 'definition-resolved', actionKind: 'production', action: 'reported', note: '',
  });
  insertFeedback(db, {
    id: 'resolved-action', createdAt: '2026-01-03T00:00:00.000Z',
    targetType: 'generated_prompt', targetId: 'definition_based_production',
    targetWordId: 'definition-resolved', actionKind: 'production', action: 'resolved', note: '',
  });
  insertFeedback(db, {
    id: 'contrast-report', createdAt: '2026-01-04T00:00:00.000Z',
    targetType: 'contrast_prompt', targetId: 'contrast-prompt-active',
    targetWordId: 'contrast-word', actionKind: 'contrast_selection', action: 'reported', note: 'Ambiguous.',
  });
  return db;
}

function insertFeedback(db: DatabaseSync, row: {
  id: string; createdAt: string; targetType: string; targetId: string;
  targetWordId: string; actionKind: string; action: string; note: string;
}) {
  db.prepare(`
    INSERT INTO study_content_feedback (
      id, created_at, target_type, target_id, target_word_id, action_kind,
      feedback_type, feedback_action, note
    ) VALUES (?, ?, ?, ?, ?, ?, 'bad_prompt', ?, ?)
  `).run(
    row.id, row.createdAt, row.targetType, row.targetId, row.targetWordId,
    row.actionKind, row.action, row.note,
  );
}

function addNonLatinDefinitionFeedback(db: DatabaseSync): void {
  db.exec(`
    INSERT INTO words VALUES
      ('cw:讨论:tǎo_lùn', '讨论', NULL, 'tǎo_lùn', 'discuss', '["discuss"]', '', '[]', 'review', 0, '2026-01-01T00:00:00.000Z', 0, NULL, NULL),
      ('cw:譬如:pì_rú', '譬如', NULL, 'pì_rú', 'for example', '["for example"]', '', '[]', 'review', 0, '2026-01-01T00:00:00.000Z', 0, NULL, NULL);
    INSERT INTO word_meanings VALUES
      ('non-latin-discuss-meaning', 'cw:讨论:tǎo_lùn', 0, 'discuss', 0, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
      ('non-latin-for-example-meaning', 'cw:譬如:pì_rú', 0, 'for example', 0, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
  `);
  insertFeedback(db, {
    id: 'non-latin-discuss-report', createdAt: '2026-01-05T00:00:00.000Z',
    targetType: 'generated_prompt', targetId: 'definition_based_production',
    targetWordId: 'cw:讨论:tǎo_lùn', actionKind: 'production', action: 'reported', note: '',
  });
  insertFeedback(db, {
    id: 'non-latin-for-example-report', createdAt: '2026-01-05T00:01:00.000Z',
    targetType: 'generated_prompt', targetId: 'definition_based_production',
    targetWordId: 'cw:譬如:pì_rú', actionKind: 'production', action: 'reported', note: '',
  });
}

function readDueDate(db: DatabaseSync, wordId: string): string | null {
  return (db.prepare('SELECT next_due_at FROM word_skill_state WHERE word_id = ?').get(wordId) as {
    next_due_at: string | null;
  }).next_due_at;
}

function tableExists(db: DatabaseSync, table: string): boolean {
  return Boolean(db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(table));
}
