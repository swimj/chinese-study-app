import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { inspectLegacyPromptFeedback } from './legacy-prompt-feedback.ts';

type ComparableRow = Record<string, unknown>;

export type LegacyUpgradeValidationCheck = {
  surface: string;
  rowCount: number;
  sha256: string;
};

export type LegacyUpgradeValidationReport = {
  ok: true;
  learnerId: string;
  checks: LegacyUpgradeValidationCheck[];
};

export function validateLegacyLearnerUpgrade({
  legacyDb,
  upgradedDb,
  learnerId,
}: {
  legacyDb: DatabaseSync;
  upgradedDb: DatabaseSync;
  learnerId: string;
}): LegacyUpgradeValidationReport {
  if (learnerId.trim().length === 0) throw new Error('Expected non-empty learner id');

  const promptFeedback = inspectLegacyPromptFeedback(legacyDb);
  if (promptFeedback.invalidActiveTargets.length > 0) {
    throw new Error('Cannot validate upgrade while active legacy bad-prompt targets are invalid');
  }

  const checks = [
    comparePreservedRows(
      'scheduler.word_skill_state',
      readOptionalRows(legacyDb, 'word_skill_state', `
        SELECT word_id, skill_id, enabled, interval_hours, last_studied_at, next_due_at, ease_factor
        FROM word_skill_state ORDER BY word_id, skill_id
      `),
      readRows(upgradedDb, `
        SELECT word_id, skill_id, enabled, interval_hours, last_studied_at, next_due_at, ease_factor
        FROM learner_owned_word_skill_state
        WHERE learner_id = ? ORDER BY word_id, skill_id
      `, learnerId),
      ['word_id', 'skill_id'],
    ),
    comparePreservedRows(
      'scheduler.word_study_admission_state',
      readOptionalRows(legacyDb, 'word_study_admission_state', `
        SELECT word_id, study_phase, earliest_next_study_at
        FROM word_study_admission_state ORDER BY word_id
      `),
      readRows(upgradedDb, `
        SELECT word_id, study_phase, earliest_next_study_at
        FROM learner_owned_word_study_admission_state
        WHERE learner_id = ? ORDER BY word_id
      `, learnerId),
      ['word_id'],
    ),
    compareRows(
      'priority.corpus',
      readOptionalRows(legacyDb, 'words', 'SELECT id, priority FROM words ORDER BY id'),
      readRows(upgradedDb, 'SELECT id, priority FROM lexical_words ORDER BY id'),
    ),
    compareRows(
      'priority.learner_overrides',
      readOptionalRows(legacyDb, 'user_word_priority', `
        SELECT word_id, bump_count, force_top, priority_tier, required_for_next_session, updated_at
        FROM user_word_priority ORDER BY word_id
      `),
      readRows(upgradedDb, `
        SELECT word_id, bump_count, force_top, priority_tier, required_for_next_session, updated_at
        FROM learner_owned_user_word_priority
        WHERE learner_id = ? ORDER BY word_id
      `, learnerId),
    ),
    compareRows(
      'learner.word_state',
      readOptionalRows(legacyDb, 'words', `
        SELECT id AS word_id, personal_notes, status, learning_streak,
          last_learning_success_on, last_learning_covered_on
        FROM words ORDER BY id
      `),
      readRows(upgradedDb, `
        SELECT word_id, personal_notes, status, learning_streak,
          last_learning_success_on, last_learning_covered_on
        FROM learner_word_state
        WHERE learner_id = ? ORDER BY word_id
      `, learnerId),
    ),
    compareRows(
      'suppression.skill_relevance',
      readOptionalRows(legacyDb, 'word_skill_relevance', `
        SELECT word_id, skill_id, relevance_state, updated_at, source_event_id
        FROM word_skill_relevance
        WHERE relevance_state = 'suppressed'
        ORDER BY word_id, skill_id
      `),
      readRows(upgradedDb, `
        SELECT word_id, skill_id, relevance_state, updated_at, source_event_id
        FROM learner_owned_word_skill_relevance
        WHERE learner_id = ? AND relevance_state = 'suppressed'
        ORDER BY word_id, skill_id
      `, learnerId),
    ),
    compareRows(
      'suppression.meaning_visibility',
      readOptionalRows(legacyDb, 'word_meanings', `
        SELECT id AS meaning_id, show_on_production_prompt
        FROM word_meanings ORDER BY id
      `),
      readRows(upgradedDb, `
        SELECT meaning_id, show_on_production_prompt
        FROM learner_word_meaning_preferences
        WHERE learner_id = ? ORDER BY meaning_id
      `, learnerId),
    ),
    compareRows(
      'suppression.definition_bad_prompts',
      promptFeedback.definitionExclusions.map((row) => ({
        word_id: row.targetWordId,
        source_feedback_ids_json: JSON.stringify(row.sourceFeedbackIds),
      })),
      readRows(upgradedDb, `
        SELECT word_id, source_feedback_ids_json
        FROM definition_fallback_exclusions
        WHERE learner_id = ? AND origin = 'legacy_bad_prompt_migration'
        ORDER BY word_id
      `, learnerId),
    ),
    compareRows(
      'suppression.contrast_bad_prompts',
      promptFeedback.contrastPromptExclusions.map((row) => ({
        prompt_id: row.targetId,
        target_word_id: row.targetWordId,
        source_feedback_ids_json: JSON.stringify(row.sourceFeedbackIds),
      })),
      readRows(upgradedDb, `
        SELECT prompt_id, target_word_id, source_feedback_ids_json
        FROM contrast_prompt_exclusions
        WHERE learner_id = ? AND origin = 'legacy_bad_prompt_migration'
        ORDER BY prompt_id
      `, learnerId),
    ),
  ];

  return { ok: true, learnerId, checks };
}

function compareRows(
  surface: string,
  legacyRows: ComparableRow[],
  upgradedRows: ComparableRow[],
): LegacyUpgradeValidationCheck {
  const legacyJson = JSON.stringify(legacyRows);
  const upgradedJson = JSON.stringify(upgradedRows);
  const legacyHash = sha256(legacyJson);
  const upgradedHash = sha256(upgradedJson);
  if (legacyJson !== upgradedJson) {
    const firstDifference = firstDifferenceAt(legacyRows, upgradedRows);
    throw new Error(
      `${surface} mismatch: legacy=${legacyRows.length}/${legacyHash}, `
        + `upgraded=${upgradedRows.length}/${upgradedHash}, first_difference=${firstDifference}`,
    );
  }
  return { surface, rowCount: legacyRows.length, sha256: legacyHash };
}

function comparePreservedRows(
  surface: string,
  legacyRows: ComparableRow[],
  upgradedRows: ComparableRow[],
  keyColumns: string[],
): LegacyUpgradeValidationCheck {
  const upgradedByKey = new Map(upgradedRows.map((row) => [rowKey(row, keyColumns), row]));
  const preservedRows = legacyRows.map((row) => upgradedByKey.get(rowKey(row, keyColumns)) ?? { missing: true });
  return compareRows(surface, legacyRows, preservedRows);
}

function readOptionalRows(db: DatabaseSync, table: string, sql: string): ComparableRow[] {
  if (!tableExists(db, table)) return [];
  return readRows(db, sql);
}

function readRows(db: DatabaseSync, sql: string, ...params: Array<string | number | null>): ComparableRow[] {
  return db.prepare(sql).all(...params).map((row) => ({ ...row }));
}

function tableExists(db: DatabaseSync, table: string): boolean {
  return Boolean(db.prepare(`
    SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?
  `).get(table));
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function rowKey(row: ComparableRow, keyColumns: string[]): string {
  return JSON.stringify(keyColumns.map((column) => row[column]));
}

function firstDifferenceAt(legacyRows: ComparableRow[], upgradedRows: ComparableRow[]): string {
  const length = Math.max(legacyRows.length, upgradedRows.length);
  for (let index = 0; index < length; index += 1) {
    const legacy = JSON.stringify(legacyRows[index] ?? null);
    const upgraded = JSON.stringify(upgradedRows[index] ?? null);
    if (legacy !== upgraded) return `${index} legacy=${legacy} upgraded=${upgraded}`;
  }
  return 'unknown';
}
