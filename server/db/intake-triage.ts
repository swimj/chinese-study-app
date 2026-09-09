import { getDb } from './connection.ts';
import { learnerScopedStorageTableName } from './learner-scoped-tables.ts';

// Retired per SPECS/diet-deck-distribution.md §2.7 (2026-09-10): the intake-triage
// advisor loop (runs, assessments, dispositions) no longer reads or writes these
// tables. The schema remains created and validated so existing databases stay
// intact without a destructive migration; the tables are dormant provenance.

export function createIntakeTriageSchema(): void {
  getDb().exec(`
    CREATE TABLE intake_triage_runs (
      run_id TEXT PRIMARY KEY,
      learner_id TEXT NOT NULL DEFAULT (current_learner_id()) REFERENCES learners(learner_id) ON DELETE CASCADE,
      started_at TEXT NOT NULL,
      completed_at TEXT NOT NULL,
      state TEXT NOT NULL CHECK (state IN ('succeeded', 'failed')),
      provider TEXT NOT NULL,
      model_config TEXT NOT NULL,
      provider_model TEXT NOT NULL,
      prompt_version TEXT NOT NULL,
      included_word_count INTEGER NOT NULL CHECK (included_word_count >= 0),
      failure_code TEXT,
      client_request_id TEXT NOT NULL,
      response_id TEXT,
      finish_reason TEXT,
      token_usage_json TEXT NOT NULL,
      pricing_snapshot_id TEXT,
      pricing_as_of TEXT,
      pricing_basis_json TEXT,
      estimated_cost_usd REAL,
      CHECK (
        (state = 'succeeded' AND failure_code IS NULL)
        OR (state = 'failed' AND failure_code IS NOT NULL)
      ),
      CHECK (
        (pricing_snapshot_id IS NULL AND pricing_as_of IS NULL AND pricing_basis_json IS NULL AND estimated_cost_usd IS NULL)
        OR (pricing_snapshot_id IS NOT NULL AND pricing_as_of IS NOT NULL AND pricing_basis_json IS NOT NULL AND estimated_cost_usd IS NOT NULL)
      )
    );

    CREATE TABLE intake_triage_assessments (
      assessment_id TEXT PRIMARY KEY,
      learner_id TEXT NOT NULL DEFAULT (current_learner_id()) REFERENCES learners(learner_id) ON DELETE CASCADE,
      run_id TEXT NOT NULL REFERENCES intake_triage_runs(run_id) ON DELETE CASCADE,
      word_id TEXT NOT NULL REFERENCES lexical_words(id),
      content_fingerprint TEXT NOT NULL,
      judgment TEXT NOT NULL CHECK (
        judgment IN ('full_study', 'recognition_only', 'defer_active_study', 'uncertain')
      ),
      rationale TEXT NOT NULL CHECK (length(trim(rationale)) BETWEEN 1 AND 400),
      created_at TEXT NOT NULL,
      UNIQUE(run_id, word_id)
    );

    CREATE TABLE intake_triage_assessment_dispositions (
      learner_id TEXT NOT NULL DEFAULT (current_learner_id()) REFERENCES learners(learner_id) ON DELETE CASCADE,
      assessment_id TEXT PRIMARY KEY REFERENCES intake_triage_assessments(assessment_id) ON DELETE CASCADE,
      disposition TEXT NOT NULL CHECK (disposition IN ('accepted', 'dismissed')),
      effect_kind TEXT,
      effect_state TEXT,
      effect_ref TEXT,
      created_at TEXT NOT NULL,
      CHECK (
        (disposition = 'accepted' AND effect_kind IS NOT NULL AND effect_state IS NOT NULL AND effect_ref IS NOT NULL)
        OR (disposition = 'dismissed' AND effect_kind IS NULL AND effect_state IS NULL AND effect_ref IS NULL)
      )
    );

    CREATE TRIGGER intake_triage_runs_no_update
    BEFORE UPDATE ON intake_triage_runs
    BEGIN
      SELECT RAISE(ABORT, 'intake triage runs are immutable');
    END;

    CREATE TRIGGER intake_triage_assessments_no_update
    BEFORE UPDATE ON intake_triage_assessments
    BEGIN
      SELECT RAISE(ABORT, 'intake triage assessments are immutable');
    END;

    CREATE TRIGGER intake_triage_dispositions_no_update
    BEFORE UPDATE ON intake_triage_assessment_dispositions
    BEGIN
      SELECT RAISE(ABORT, 'intake triage dispositions are immutable');
    END;
  `);
}

export function createIntakeTriageIndexes(): void {
  getDb().exec(`
    CREATE INDEX idx_intake_triage_runs_completed
      ON ${learnerScopedStorageTableName('intake_triage_runs')}(completed_at DESC, run_id ASC);
    CREATE INDEX idx_intake_triage_assessments_word
      ON ${learnerScopedStorageTableName('intake_triage_assessments')}(word_id, created_at DESC, assessment_id ASC);
  `);
}

export function validateIntakeTriageSchema(): void {
  assertColumns('intake_triage_runs', [
    'run_id', 'started_at', 'completed_at', 'state', 'provider', 'model_config',
    'provider_model', 'prompt_version', 'included_word_count', 'failure_code',
    'client_request_id', 'response_id', 'finish_reason', 'token_usage_json',
    'pricing_snapshot_id', 'pricing_as_of', 'pricing_basis_json', 'estimated_cost_usd',
  ]);
  assertColumns('intake_triage_assessments', [
    'assessment_id', 'run_id', 'word_id', 'content_fingerprint', 'judgment',
    'rationale', 'created_at',
  ]);
  assertColumns('intake_triage_assessment_dispositions', [
    'assessment_id', 'disposition', 'effect_kind', 'effect_state', 'effect_ref', 'created_at',
  ]);
}

function assertColumns(tableName: string, expected: string[]): void {
  const rows = getDb().prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  const actual = rows.map((row) => row.name);
  if (actual.length !== expected.length || expected.some((name) => !actual.includes(name))) {
    throw new Error(`Invalid ${tableName} schema. Expected columns: ${expected.join(', ')}`);
  }
}
