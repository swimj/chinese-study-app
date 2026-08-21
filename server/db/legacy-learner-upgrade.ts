import type { DatabaseSync } from 'node:sqlite';
import {
  LEGACY_BAD_PROMPT_MIGRATION_ID,
  type LegacyPromptFeedbackReport,
} from './legacy-prompt-feedback.ts';
import { LEARNER_OWNERSHIP_MIGRATION_ID } from './identity.ts';
export { LEARNER_OWNERSHIP_MIGRATION_ID } from './identity.ts';

export type LegacyLearnerUpgradeReport = {
  migrationId: typeof LEARNER_OWNERSHIP_MIGRATION_ID;
  legacyTableCounts: Record<string, number>;
  promptFeedback: LegacyPromptFeedbackReport;
};

const sharedCopies = [
  ['word_lookup_aliases', 'word_lookup_aliases'],
  ['production_tasks', 'production_tasks'],
] as const;

const learnerOwnedCopies = [
  ['user_word_priority', 'learner_owned_user_word_priority'],
  ['word_study_admission_state', 'learner_owned_word_study_admission_state'],
  ['word_skill_state', 'learner_owned_word_skill_state'],
  ['daily_new_word_intake', 'learner_owned_daily_new_word_intake'],
  ['study_sessions', 'learner_owned_study_sessions'],
  ['study_attempt_events', 'learner_owned_study_attempt_events'],
  ['study_events', 'learner_owned_study_events'],
  ['review_session_summaries', 'learner_owned_review_session_summaries'],
  ['word_skill_relevance', 'learner_owned_word_skill_relevance'],
  ['reflection_generation_runs', 'learner_owned_reflection_generation_runs'],
  ['reflection_artifacts', 'learner_owned_reflection_artifacts'],
  ['reflection_proposal_reviews', 'learner_owned_reflection_proposal_reviews'],
  ['reflection_operation_invocations', 'learner_owned_reflection_operation_invocations'],
  ['reflection_quality_annotations', 'learner_owned_reflection_quality_annotations'],
  ['reflection_help_inbox', 'learner_owned_reflection_help_inbox'],
  ['production_cue_lifecycle_events', 'learner_owned_production_cue_lifecycle_events'],
  ['production_cue_activation_state', 'learner_owned_production_cue_activation_state'],
  ['production_cue_evidence_records', 'learner_owned_production_cue_evidence_records'],
  ['production_cue_evidence_projection', 'learner_owned_production_cue_evidence_projection'],
  ['production_recheck_demands', 'learner_owned_production_recheck_demands'],
  ['intake_triage_runs', 'learner_owned_intake_triage_runs'],
  ['intake_triage_assessments', 'learner_owned_intake_triage_assessments'],
  ['intake_triage_assessment_dispositions', 'learner_owned_intake_triage_assessment_dispositions'],
] as const;

const retainedLegacyTables = [
  'words',
  'word_meanings',
  ...sharedCopies.map(([source]) => source),
  ...learnerOwnedCopies.map(([source]) => source),
  'contrast_clusters',
  'contrast_cluster_members',
  'contrast_prompts',
  'production_cues',
  'production_cue_supplements',
  'production_cue_accepted_words',
] as const;

export function inspectLegacyLearnerUpgrade(
  legacyDb: DatabaseSync,
  promptFeedback: LegacyPromptFeedbackReport,
): LegacyLearnerUpgradeReport {
  const legacyTableCounts: Record<string, number> = {};
  for (const table of retainedLegacyTables) {
    if (tableExists(legacyDb, 'main', table)) {
      legacyTableCounts[table] = rowCount(legacyDb, 'main', table);
    }
  }
  return {
    migrationId: LEARNER_OWNERSHIP_MIGRATION_ID,
    legacyTableCounts,
    promptFeedback,
  };
}

export function copyLegacyDatabaseIntoFreshTarget({
  targetDb,
  legacyDbPath,
  learnerId,
  report,
}: {
  targetDb: DatabaseSync;
  legacyDbPath: string;
  learnerId: string;
  report: LegacyLearnerUpgradeReport;
}): void {
  if (learnerId.trim().length === 0) throw new Error('Expected non-empty learner id');
  if (report.promptFeedback.invalidActiveTargets.length > 0) {
    throw new Error('Cannot upgrade while active legacy bad-prompt targets are invalid');
  }

  targetDb.function('current_learner_id', () => learnerId);
  targetDb.prepare('ATTACH DATABASE ? AS legacy').run(legacyDbPath);
  targetDb.exec('PRAGMA foreign_keys = OFF; BEGIN IMMEDIATE;');
  try {
    dropOwnershipValidationTriggers(targetDb);
    copyLexicalContent(targetDb, learnerId);
    for (const [source, target] of sharedCopies) copyCommonColumns(targetDb, source, target, null, true);
    for (const [source, target] of learnerOwnedCopies) copyCommonColumns(targetDb, source, target, learnerId);
    copyScopedContent(targetDb, learnerId);
    copyLegacyPromptExclusions(targetDb, learnerId, report.promptFeedback);
    copyLegacyMetadata(targetDb, learnerId);

    const appliedAt = new Date().toISOString();
    targetDb.prepare(`
      INSERT OR REPLACE INTO schema_migrations (migration_id, applied_at, details_json)
      VALUES (?, ?, ?)
    `).run(LEGACY_BAD_PROMPT_MIGRATION_ID, appliedAt, JSON.stringify(report.promptFeedback));
    targetDb.prepare(`
      INSERT OR REPLACE INTO schema_migrations (migration_id, applied_at, details_json)
      VALUES (?, ?, ?)
    `).run(LEARNER_OWNERSHIP_MIGRATION_ID, appliedAt, JSON.stringify(report));

    assertCopiedCounts(targetDb, report);
    targetDb.exec('COMMIT; PRAGMA foreign_keys = ON;');
    const foreignKeyProblems = targetDb.prepare('PRAGMA foreign_key_check').all();
    if (foreignKeyProblems.length > 0) {
      throw new Error(`Upgraded database has ${foreignKeyProblems.length} foreign-key violation(s)`);
    }
  } catch (error) {
    if (targetDb.isTransaction) targetDb.exec('ROLLBACK');
    throw error;
  } finally {
    targetDb.exec('DETACH DATABASE legacy');
  }
}

function copyLexicalContent(db: DatabaseSync, learnerId: string): void {
  copyCommonColumns(db, 'words', 'lexical_words', null);
  db.prepare(`
    INSERT INTO learner_word_state (
      learner_id, word_id, personal_notes, status, learning_streak,
      last_learning_success_on, last_learning_covered_on
    )
    SELECT ?, id, personal_notes, status, learning_streak,
      last_learning_success_on, last_learning_covered_on
    FROM legacy.words
  `).run(learnerId);

  if (tableExists(db, 'legacy', 'word_meanings')) {
    copyCommonColumns(db, 'word_meanings', 'lexical_word_meanings', null);
    db.prepare(`
      INSERT INTO learner_word_meaning_preferences (
        learner_id, meaning_id, show_on_production_prompt, updated_at
      )
      SELECT ?, id, show_on_production_prompt, updated_at
      FROM legacy.word_meanings
    `).run(learnerId);
  }

  const wordsWithoutMeanings = db.prepare(`
    SELECT id, meaning, meanings_json, created_at
    FROM legacy.words
    WHERE NOT EXISTS (
      SELECT 1
      FROM lexical_word_meanings
      WHERE lexical_word_meanings.word_id = legacy.words.id
    )
    ORDER BY id ASC
  `).all() as Array<{
    id: string;
    meaning: string;
    meanings_json: string;
    created_at: string;
  }>;
  const insertMeaning = db.prepare(`
    INSERT INTO lexical_word_meanings (
      id, word_id, position, text, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?)
  `);
  for (const word of wordsWithoutMeanings) {
    for (const [position, text] of parseLegacyMeanings(word.meanings_json, word.meaning).entries()) {
      insertMeaning.run(
        `${word.id}-meaning-${position + 1}`,
        word.id,
        position,
        text,
        word.created_at,
        word.created_at,
      );
    }
  }
}

function parseLegacyMeanings(meaningsJson: string, fallback: string): string[] {
  try {
    const parsed = JSON.parse(meaningsJson) as unknown;
    if (Array.isArray(parsed)) {
      const meanings = parsed.filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
      if (meanings.length > 0) return meanings;
    }
  } catch {
    // Fall through to the legacy primary meaning.
  }
  return [fallback];
}

function copyScopedContent(db: DatabaseSync, learnerId: string): void {
  if (tableExists(db, 'legacy', 'contrast_clusters')) {
    const columns = commonColumns(db, 'contrast_clusters', 'scoped_contrast_clusters');
    db.prepare(`
      INSERT INTO scoped_contrast_clusters (${columns.join(', ')}, content_scope, owner_learner_id)
      SELECT ${columns.join(', ')}, 'learner', ? FROM legacy.contrast_clusters
    `).run(learnerId);
    copyCommonColumns(db, 'contrast_cluster_members', 'scoped_contrast_cluster_members', null);
    copyCommonColumns(db, 'contrast_prompts', 'scoped_contrast_prompts', null);
  }
  if (tableExists(db, 'legacy', 'production_cues')) {
    copyScopedRoot(db, 'production_cues', 'scoped_production_cues', learnerId);
    copyScopedRoot(db, 'production_cue_supplements', 'scoped_production_cue_supplements', learnerId);
    copyCommonColumns(db, 'production_cue_accepted_words', 'scoped_production_cue_accepted_words', null);
  }
}

function copyScopedRoot(db: DatabaseSync, source: string, target: string, learnerId: string): void {
  if (!tableExists(db, 'legacy', source)) return;
  const columns = commonColumns(db, source, target);
  db.prepare(`
    INSERT INTO ${target} (${columns.join(', ')}, content_scope, owner_learner_id)
    SELECT ${columns.join(', ')}, 'learner', ? FROM legacy.${source}
  `).run(learnerId);
}

function copyLegacyPromptExclusions(
  db: DatabaseSync,
  learnerId: string,
  report: LegacyPromptFeedbackReport,
): void {
  const insertDefinition = db.prepare(`
    INSERT INTO definition_fallback_exclusions (
      learner_id, word_id, origin, source_feedback_ids_json, migration_id, created_at, note
    ) VALUES (?, ?, 'legacy_bad_prompt_migration', ?, NULL, ?, ?)
  `);
  for (const item of report.definitionExclusions) {
    insertDefinition.run(learnerId, item.targetWordId, JSON.stringify(item.sourceFeedbackIds), item.createdAt, item.note);
  }
  const insertContrast = db.prepare(`
    INSERT INTO contrast_prompt_exclusions (
      learner_id, prompt_id, target_word_id, origin, source_feedback_ids_json,
      migration_id, created_at, note
    ) VALUES (?, ?, ?, 'legacy_bad_prompt_migration', ?, NULL, ?, ?)
  `);
  for (const item of report.contrastPromptExclusions) {
    insertContrast.run(
      learnerId,
      item.targetId,
      item.targetWordId,
      JSON.stringify(item.sourceFeedbackIds),
      item.createdAt,
      item.note,
    );
  }
}

function copyLegacyMetadata(db: DatabaseSync, learnerId: string): void {
  if (!tableExists(db, 'legacy', 'app_metadata')) return;
  const rows = db.prepare('SELECT key, value FROM legacy.app_metadata ORDER BY key').all() as Array<{
    key: string;
    value: string;
  }>;
  const dailyLimit = rows.find((row) => row.key === 'daily_new_word_limit');
  if (dailyLimit) {
    const numericLimit = Number.parseInt(dailyLimit.value, 10);
    if (Number.isInteger(numericLimit) && numericLimit >= 0) {
      db.prepare(`
        INSERT OR REPLACE INTO learner_settings (learner_id, setting_key, value_json, updated_at)
        VALUES (?, 'daily_new_word_limit', ?, ?)
      `).run(learnerId, JSON.stringify(numericLimit), new Date().toISOString());
    }
  }
  db.prepare(`
    INSERT OR REPLACE INTO content_imports (
      import_id, content_kind, source_ref, imported_at, details_json
    ) VALUES ('swi-47-legacy-app-metadata', 'legacy_metadata_snapshot', 'legacy:app_metadata', ?, ?)
  `).run(new Date().toISOString(), JSON.stringify(Object.fromEntries(rows.map((row) => [row.key, row.value]))));
}

function copyCommonColumns(
  db: DatabaseSync,
  source: string,
  target: string,
  learnerId: string | null,
  ignoreConflicts = false,
): void {
  if (!tableExists(db, 'legacy', source)) return;
  const columns = commonColumns(db, source, target).filter((column) => column !== 'learner_id');
  if (columns.length === 0) return;
  const insertMode = ignoreConflicts ? 'INSERT OR IGNORE' : 'INSERT';
  if (learnerId === null) {
    db.exec(`${insertMode} INTO ${target} (${columns.join(', ')}) SELECT ${columns.join(', ')} FROM legacy.${source}`);
    return;
  }
  db.prepare(`
    ${insertMode} INTO ${target} (learner_id, ${columns.join(', ')})
    SELECT ?, ${columns.join(', ')} FROM legacy.${source}
  `).run(learnerId);
}

function commonColumns(db: DatabaseSync, source: string, target: string): string[] {
  const sourceColumns = new Set(tableColumns(db, 'legacy', source));
  return tableColumns(db, 'main', target).filter((column) => sourceColumns.has(column));
}

function tableColumns(db: DatabaseSync, schema: 'main' | 'legacy', table: string): string[] {
  return (db.prepare(`PRAGMA ${schema}.table_info(${table})`).all() as Array<{ name: string }>).map((row) => row.name);
}

function dropOwnershipValidationTriggers(db: DatabaseSync): void {
  const triggers = db.prepare(`
    SELECT name FROM sqlite_master
    WHERE type = 'trigger'
      AND (name LIKE '%_same_owner_%' OR name LIKE '%_cue_access_%' OR name LIKE '%_invocation_owner_%')
  `).all() as Array<{ name: string }>;
  for (const { name } of triggers) db.exec(`DROP TRIGGER ${name}`);
}

function assertCopiedCounts(db: DatabaseSync, report: LegacyLearnerUpgradeReport): void {
  const mappings: Record<string, string> = {
    words: 'lexical_words',
    word_meanings: 'lexical_word_meanings',
    contrast_clusters: 'scoped_contrast_clusters',
    contrast_cluster_members: 'scoped_contrast_cluster_members',
    contrast_prompts: 'scoped_contrast_prompts',
    production_cues: 'scoped_production_cues',
    production_cue_supplements: 'scoped_production_cue_supplements',
    production_cue_accepted_words: 'scoped_production_cue_accepted_words',
    ...Object.fromEntries(sharedCopies),
    ...Object.fromEntries(learnerOwnedCopies),
  };
  for (const [source, expected] of Object.entries(report.legacyTableCounts)) {
    const target = mappings[source];
    if (!target) continue;
    const actual = rowCount(db, 'main', target);
    if (actual !== expected) {
      throw new Error(`Row-count mismatch for ${source} -> ${target}: expected ${expected}, got ${actual}`);
    }
  }
}

function tableExists(db: DatabaseSync, schema: 'main' | 'legacy', table: string): boolean {
  return Boolean(db.prepare(`
    SELECT 1 FROM ${schema}.sqlite_master WHERE type = 'table' AND name = ?
  `).get(table));
}

function rowCount(db: DatabaseSync, schema: 'main' | 'legacy', table: string): number {
  return (db.prepare(`SELECT COUNT(*) AS count FROM ${schema}.${table}`).get() as { count: number }).count;
}
