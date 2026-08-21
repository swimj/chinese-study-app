import { getDb } from './connection.ts';
import { requireLearnerId } from './learner-context.ts';

export type PromptExclusionOrigin = 'legacy_bad_prompt_migration' | 'intentional_repair';

export type DefinitionFallbackExclusion = {
  learnerId: string;
  wordId: string;
  origin: PromptExclusionOrigin;
  sourceFeedbackIds: string[];
  migrationId: string | null;
  createdAt: string;
  note: string;
};

export type ContrastPromptExclusion = {
  learnerId: string;
  promptId: string;
  targetWordId: string;
  origin: PromptExclusionOrigin;
  sourceFeedbackIds: string[];
  migrationId: string | null;
  createdAt: string;
  note: string;
};

export function ensurePromptExclusionSchema(): void {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS definition_fallback_exclusions (
      learner_id TEXT NOT NULL REFERENCES learners(learner_id) ON DELETE CASCADE,
      word_id TEXT NOT NULL REFERENCES lexical_words(id) ON DELETE CASCADE,
      origin TEXT NOT NULL,
      source_feedback_ids_json TEXT NOT NULL DEFAULT '[]',
      migration_id TEXT REFERENCES schema_migrations(migration_id),
      created_at TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (learner_id, word_id)
    );

    CREATE TABLE IF NOT EXISTS contrast_prompt_exclusions (
      learner_id TEXT NOT NULL REFERENCES learners(learner_id) ON DELETE CASCADE,
      prompt_id TEXT NOT NULL REFERENCES contrast_prompts(id) ON DELETE CASCADE,
      target_word_id TEXT NOT NULL REFERENCES lexical_words(id) ON DELETE CASCADE,
      origin TEXT NOT NULL,
      source_feedback_ids_json TEXT NOT NULL DEFAULT '[]',
      migration_id TEXT REFERENCES schema_migrations(migration_id),
      created_at TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (learner_id, prompt_id)
    );

    CREATE INDEX IF NOT EXISTS idx_definition_fallback_exclusions_word
      ON definition_fallback_exclusions(learner_id, word_id);
    CREATE INDEX IF NOT EXISTS idx_contrast_prompt_exclusions_prompt
      ON contrast_prompt_exclusions(learner_id, prompt_id);
  `);
}

export function getDefinitionFallbackExclusions(): DefinitionFallbackExclusion[] {
  return (getDb().prepare(`
    SELECT learner_id, word_id, origin, source_feedback_ids_json, migration_id, created_at, note
    FROM definition_fallback_exclusions
    WHERE learner_id = ?
    ORDER BY created_at, word_id
  `).all(requireLearnerId()) as ExclusionRow[]).map(mapDefinitionRow);
}

export function getContrastPromptExclusions(): ContrastPromptExclusion[] {
  return (getDb().prepare(`
    SELECT learner_id, prompt_id, target_word_id, origin, source_feedback_ids_json,
      migration_id, created_at, note
    FROM contrast_prompt_exclusions
    WHERE learner_id = ?
    ORDER BY created_at, prompt_id
  `).all(requireLearnerId()) as ContrastExclusionRow[]).map(mapContrastRow);
}

type ExclusionRow = {
  learner_id: string;
  word_id: string;
  origin: PromptExclusionOrigin;
  source_feedback_ids_json: string;
  migration_id: string | null;
  created_at: string;
  note: string;
};

type ContrastExclusionRow = Omit<ExclusionRow, 'word_id'> & {
  prompt_id: string;
  target_word_id: string;
};

function mapDefinitionRow(row: ExclusionRow): DefinitionFallbackExclusion {
  return {
    learnerId: row.learner_id,
    wordId: row.word_id,
    origin: row.origin,
    sourceFeedbackIds: parseStringArray(row.source_feedback_ids_json),
    migrationId: row.migration_id,
    createdAt: row.created_at,
    note: row.note,
  };
}

function mapContrastRow(row: ContrastExclusionRow): ContrastPromptExclusion {
  return {
    learnerId: row.learner_id,
    promptId: row.prompt_id,
    targetWordId: row.target_word_id,
    origin: row.origin,
    sourceFeedbackIds: parseStringArray(row.source_feedback_ids_json),
    migrationId: row.migration_id,
    createdAt: row.created_at,
    note: row.note,
  };
}

function parseStringArray(value: string): string[] {
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed) || parsed.some((entry) => typeof entry !== 'string')) {
    throw new Error('Invalid prompt exclusion source feedback ids');
  }
  return parsed;
}
