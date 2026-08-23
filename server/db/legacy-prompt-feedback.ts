import type { DatabaseSync } from 'node:sqlite';

export const LEGACY_BAD_PROMPT_MIGRATION_ID = 'swi_47_legacy_bad_prompt_exclusions_v1';

type LegacyFeedbackRow = {
  id: string;
  created_at: string;
  target_type: string;
  target_id: string;
  target_word_id: string;
  action_kind: string;
  feedback_type: string;
  feedback_action: string;
  note: string;
};

export type LegacyPromptExclusionCandidate = {
  targetId: string;
  targetWordId: string;
  sourceFeedbackIds: string[];
  createdAt: string;
  note: string;
};

export type LegacyPromptFeedbackReport = {
  migrationId: typeof LEGACY_BAD_PROMPT_MIGRATION_ID;
  totalFeedbackRows: number;
  ignoredFeedbackRows: number;
  resolvedTargetCount: number;
  definitionExclusions: LegacyPromptExclusionCandidate[];
  contrastPromptExclusions: LegacyPromptExclusionCandidate[];
  invalidActiveTargets: Array<{ feedbackId: string; reason: string }>;
};

export function inspectLegacyPromptFeedback(db: DatabaseSync): LegacyPromptFeedbackReport {
  if (!tableExists(db, 'study_content_feedback')) {
    return {
      migrationId: LEGACY_BAD_PROMPT_MIGRATION_ID,
      totalFeedbackRows: 0,
      ignoredFeedbackRows: 0,
      resolvedTargetCount: 0,
      definitionExclusions: [],
      contrastPromptExclusions: [],
      invalidActiveTargets: [],
    };
  }

  const rows = db.prepare(`
    SELECT id, created_at, target_type, target_id, target_word_id, action_kind,
      feedback_type, feedback_action, note
    FROM study_content_feedback
    ORDER BY created_at, rowid
  `).all() as LegacyFeedbackRow[];
  const activeByTarget = new Map<string, LegacyFeedbackRow[]>();
  const resolvedTargets = new Set<string>();
  let ignoredFeedbackRows = 0;

  for (const row of rows) {
    const kind = classifyFeedback(row);
    if (kind === null) {
      ignoredFeedbackRows += 1;
      continue;
    }
    const key = `${kind}:${row.target_id}:${row.target_word_id}`;
    if (row.feedback_action === 'resolved') {
      activeByTarget.delete(key);
      resolvedTargets.add(key);
      continue;
    }
    if (row.feedback_action !== 'reported') {
      ignoredFeedbackRows += 1;
      continue;
    }
    activeByTarget.set(key, [...(activeByTarget.get(key) ?? []), row]);
  }

  const definitionExclusions: LegacyPromptExclusionCandidate[] = [];
  const contrastPromptExclusions: LegacyPromptExclusionCandidate[] = [];
  const invalidActiveTargets: Array<{ feedbackId: string; reason: string }> = [];

  for (const activeRows of activeByTarget.values()) {
    const latest = activeRows.at(-1);
    if (!latest) continue;
    const kind = classifyFeedback(latest);
    if (!wordExists(db, latest.target_word_id)) {
      invalidActiveTargets.push({ feedbackId: latest.id, reason: `word ${latest.target_word_id} does not exist` });
      continue;
    }
    const candidate: LegacyPromptExclusionCandidate = {
      targetId: latest.target_id,
      targetWordId: latest.target_word_id,
      sourceFeedbackIds: activeRows.map((row) => row.id),
      createdAt: latest.created_at,
      note: latest.note,
    };
    if (kind === 'definition') {
      definitionExclusions.push(candidate);
      continue;
    }
    if (!contrastPromptMatches(db, latest.target_id, latest.target_word_id)) {
      invalidActiveTargets.push({
        feedbackId: latest.id,
        reason: `contrast prompt ${latest.target_id} does not exist for word ${latest.target_word_id}`,
      });
      continue;
    }
    contrastPromptExclusions.push(candidate);
  }

  return {
    migrationId: LEGACY_BAD_PROMPT_MIGRATION_ID,
    totalFeedbackRows: rows.length,
    ignoredFeedbackRows,
    resolvedTargetCount: resolvedTargets.size,
    definitionExclusions: definitionExclusions.sort(byTarget),
    contrastPromptExclusions: contrastPromptExclusions.sort(byTarget),
    invalidActiveTargets,
  };
}

export function applyLegacyPromptFeedbackMigration(
  db: DatabaseSync,
  learnerId: string,
  report = inspectLegacyPromptFeedback(db),
): LegacyPromptFeedbackReport {
  if (learnerId.trim().length === 0) throw new Error('Expected non-empty learner id');
  if (report.invalidActiveTargets.length > 0) {
    throw new Error('Cannot migrate legacy bad prompts while active targets are invalid');
  }

  const now = new Date().toISOString();
  db.exec('BEGIN');
  try {
    ensureMigrationTables(db);
    db.prepare(`
      INSERT INTO learners (learner_id, display_name, created_at, disabled_at)
      VALUES (?, ?, ?, NULL)
      ON CONFLICT(learner_id) DO NOTHING
    `).run(learnerId, learnerId, now);
    db.prepare(`
      INSERT INTO learner_auth_mappings (provider, provider_subject, learner_id, created_at)
      VALUES ('trusted_local', ?, ?, ?)
      ON CONFLICT(provider, provider_subject) DO UPDATE SET learner_id = excluded.learner_id
    `).run(learnerId, learnerId, now);
    db.prepare(`
      INSERT INTO schema_migrations (migration_id, applied_at, details_json)
      VALUES (?, ?, ?)
      ON CONFLICT(migration_id) DO UPDATE SET
        applied_at = excluded.applied_at,
        details_json = excluded.details_json
    `).run(LEGACY_BAD_PROMPT_MIGRATION_ID, now, JSON.stringify(report));

    const insertDefinition = db.prepare(`
      INSERT INTO definition_fallback_exclusions (
        learner_id, word_id, origin, source_feedback_ids_json, migration_id, created_at, note
      ) VALUES (?, ?, 'legacy_bad_prompt_migration', ?, ?, ?, ?)
      ON CONFLICT(learner_id, word_id) DO NOTHING
    `);
    for (const exclusion of report.definitionExclusions) {
      insertDefinition.run(
        learnerId,
        exclusion.targetWordId,
        JSON.stringify(exclusion.sourceFeedbackIds),
        LEGACY_BAD_PROMPT_MIGRATION_ID,
        exclusion.createdAt,
        exclusion.note,
      );
    }

    const insertContrast = db.prepare(`
      INSERT INTO contrast_prompt_exclusions (
        learner_id, prompt_id, target_word_id, origin, source_feedback_ids_json,
        migration_id, created_at, note
      ) VALUES (?, ?, ?, 'legacy_bad_prompt_migration', ?, ?, ?, ?)
      ON CONFLICT(learner_id, prompt_id) DO NOTHING
    `);
    for (const exclusion of report.contrastPromptExclusions) {
      insertContrast.run(
        learnerId,
        exclusion.targetId,
        exclusion.targetWordId,
        JSON.stringify(exclusion.sourceFeedbackIds),
        LEGACY_BAD_PROMPT_MIGRATION_ID,
        exclusion.createdAt,
        exclusion.note,
      );
    }

    db.exec('DROP TABLE IF EXISTS study_content_feedback; DROP TABLE IF EXISTS contrast_candidate_intake;');
    db.exec('COMMIT');
    return report;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function ensureMigrationTables(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS learners (
      learner_id TEXT PRIMARY KEY, display_name TEXT NOT NULL, created_at TEXT NOT NULL, disabled_at TEXT
    );
    CREATE TABLE IF NOT EXISTS learner_auth_mappings (
      provider TEXT NOT NULL, provider_subject TEXT NOT NULL,
      learner_id TEXT NOT NULL REFERENCES learners(learner_id) ON DELETE CASCADE,
      created_at TEXT NOT NULL, PRIMARY KEY (provider, provider_subject), UNIQUE (provider, learner_id)
    );
    CREATE TABLE IF NOT EXISTS learner_settings (
      learner_id TEXT NOT NULL REFERENCES learners(learner_id) ON DELETE CASCADE,
      setting_key TEXT NOT NULL, value_json TEXT NOT NULL, updated_at TEXT NOT NULL,
      PRIMARY KEY (learner_id, setting_key)
    );
    CREATE TABLE IF NOT EXISTS schema_migrations (
      migration_id TEXT PRIMARY KEY, applied_at TEXT NOT NULL, details_json TEXT NOT NULL DEFAULT '{}'
    );
    CREATE TABLE IF NOT EXISTS content_imports (
      import_id TEXT PRIMARY KEY, content_kind TEXT NOT NULL, source_ref TEXT NOT NULL,
      imported_at TEXT NOT NULL, details_json TEXT NOT NULL DEFAULT '{}'
    );
    CREATE TABLE IF NOT EXISTS definition_fallback_exclusions (
      learner_id TEXT NOT NULL REFERENCES learners(learner_id) ON DELETE CASCADE,
      word_id TEXT NOT NULL REFERENCES words(id) ON DELETE CASCADE,
      origin TEXT NOT NULL, source_feedback_ids_json TEXT NOT NULL DEFAULT '[]',
      migration_id TEXT REFERENCES schema_migrations(migration_id), created_at TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '', PRIMARY KEY (learner_id, word_id)
    );
    CREATE TABLE IF NOT EXISTS contrast_prompt_exclusions (
      learner_id TEXT NOT NULL REFERENCES learners(learner_id) ON DELETE CASCADE,
      prompt_id TEXT NOT NULL REFERENCES contrast_prompts(id) ON DELETE CASCADE,
      target_word_id TEXT NOT NULL REFERENCES words(id) ON DELETE CASCADE,
      origin TEXT NOT NULL, source_feedback_ids_json TEXT NOT NULL DEFAULT '[]',
      migration_id TEXT REFERENCES schema_migrations(migration_id), created_at TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '', PRIMARY KEY (learner_id, prompt_id)
    );
  `);
}

function classifyFeedback(row: LegacyFeedbackRow): 'definition' | 'contrast' | null {
  if (row.feedback_type !== 'bad_prompt') return null;
  if (
    row.target_type === 'generated_prompt'
    && row.target_id === 'definition_based_production'
    && row.action_kind === 'production'
  ) return 'definition';
  if (row.target_type === 'contrast_prompt' && row.action_kind === 'contrast_selection') return 'contrast';
  return null;
}

function tableExists(db: DatabaseSync, table: string): boolean {
  return Boolean(db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(table));
}

function wordExists(db: DatabaseSync, wordId: string): boolean {
  return Boolean(db.prepare('SELECT 1 FROM words WHERE id = ?').get(wordId));
}

function contrastPromptMatches(db: DatabaseSync, promptId: string, wordId: string): boolean {
  return Boolean(db.prepare('SELECT 1 FROM contrast_prompts WHERE id = ? AND target_word_id = ?').get(promptId, wordId));
}

function byTarget(left: LegacyPromptExclusionCandidate, right: LegacyPromptExclusionCandidate): number {
  return binaryCompare(left.targetId, right.targetId) || binaryCompare(left.targetWordId, right.targetWordId);
}

function binaryCompare(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}
