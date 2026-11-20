import { dbPath, getDb } from './connection.ts';
import { learnerScopedStorageTableName } from './learner-scoped-tables.ts';
import { createReflectionQualitySchema, validateReflectionQualitySchema } from './reflection-quality.ts';
import { createReflectionHelpInboxSchema, validateReflectionHelpInboxSchema } from './reflection-help-inbox.ts';

const artifactColumns = [
  'artifact_id',
  'source_session_id',
  'source_run_id',
  'reflection_flow_version',
  'generated_at',
  'provider',
  'model',
  'prompt_version',
  'bundle_schema_version',
  'result_schema_version',
  'evidence_bundle_json',
  'result_json',
] as const;

const reflectionGenerationRunColumns = [
  'run_id',
  'source_session_id',
  'reflection_flow_version',
  'started_at',
  'completed_at',
  'provider',
  'model',
  'provider_model',
  'prompt_version',
  'response_id',
  'client_request_id',
  'finish_reason',
  'bundle_schema_version',
  'result_schema_version',
  'state',
  'failure_code',
  'eligible_item_count',
  'included_item_count',
  'input_tokens',
  'cached_input_tokens',
  'cache_write_input_tokens',
  'output_tokens',
  'reasoning_tokens',
  'total_tokens',
  'pricing_snapshot_id',
  'pricing_as_of',
  'pricing_basis_json',
  'estimated_cost_usd',
  'evidence_bundle_json',
  'source_proposal_ids_json',
  'diagnostic_json',
] as const;

const proposalReviewColumns = [
  'proposal_id',
  'artifact_id',
  'item_id',
  'proposal_index',
  'disposition',
  'updated_at',
  'acceptance_mode',
  'accepted_invocation_id',
  'dismissal_reason',
  'supersession_source',
  'supersession_actor',
  'supersession_reason',
  'replacement_proposal_id',
  'replacement_invocation_id',
  'satisfying_effect_refs_json',
] as const;

const invocationColumns = [
  'invocation_id',
  'created_at',
  'origin_kind',
  'origin_proposal_id',
  'origin_superseded_proposal_id',
  'operation_kind',
  'operation_version',
  'operation_json',
  'application_state',
  'application_updated_at',
  'unsupported_reason',
  'applied_at',
  'application_error',
  'stale_reason',
  'effect_refs_json',
  'satisfying_effect_refs_json',
] as const;

export function createReflectionSchema(): void {
  createReflectionGenerationRunStartSchema();
  getDb().exec(`
    CREATE TABLE reflection_artifacts (
      artifact_id TEXT PRIMARY KEY,
      learner_id TEXT NOT NULL DEFAULT (current_learner_id()) REFERENCES learners(learner_id) ON DELETE CASCADE,
      source_session_id TEXT,
      source_run_id TEXT,
      reflection_flow_version TEXT NOT NULL,
      generated_at TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      prompt_version TEXT NOT NULL,
      bundle_schema_version TEXT NOT NULL,
      result_schema_version TEXT NOT NULL,
      evidence_bundle_json TEXT NOT NULL,
      result_json TEXT NOT NULL
    );

    CREATE TABLE reflection_generation_runs (
      run_id TEXT PRIMARY KEY,
      learner_id TEXT NOT NULL DEFAULT (current_learner_id()) REFERENCES learners(learner_id) ON DELETE CASCADE,
      source_session_id TEXT,
      reflection_flow_version TEXT NOT NULL,
      started_at TEXT NOT NULL,
      completed_at TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      provider_model TEXT NOT NULL,
      prompt_version TEXT NOT NULL,
      response_id TEXT,
      finish_reason TEXT,
      client_request_id TEXT,
      bundle_schema_version TEXT,
      result_schema_version TEXT,
      diagnostic_json TEXT,
      state TEXT NOT NULL CHECK (state IN ('succeeded', 'failed')),
      failure_code TEXT,
      eligible_item_count INTEGER NOT NULL CHECK (eligible_item_count >= 0),
      included_item_count INTEGER NOT NULL CHECK (
        included_item_count >= 0 AND included_item_count <= eligible_item_count
      ),
      input_tokens INTEGER CHECK (input_tokens IS NULL OR input_tokens >= 0),
      cached_input_tokens INTEGER CHECK (
        cached_input_tokens IS NULL OR cached_input_tokens >= 0
      ),
      cache_write_input_tokens INTEGER CHECK (
        cache_write_input_tokens IS NULL OR cache_write_input_tokens >= 0
      ),
      output_tokens INTEGER CHECK (output_tokens IS NULL OR output_tokens >= 0),
      reasoning_tokens INTEGER CHECK (reasoning_tokens IS NULL OR reasoning_tokens >= 0),
      total_tokens INTEGER CHECK (total_tokens IS NULL OR total_tokens >= 0),
      pricing_snapshot_id TEXT,
      pricing_as_of TEXT,
      pricing_basis_json TEXT,
      estimated_cost_usd REAL CHECK (
        estimated_cost_usd IS NULL OR estimated_cost_usd >= 0
      ),
      evidence_bundle_json TEXT,
      CHECK (
        (state = 'succeeded' AND failure_code IS NULL)
        OR (state = 'failed' AND failure_code IS NOT NULL)
      ),
      CHECK (
        (estimated_cost_usd IS NULL AND pricing_snapshot_id IS NULL
          AND pricing_as_of IS NULL AND pricing_basis_json IS NULL)
        OR (estimated_cost_usd IS NOT NULL AND pricing_snapshot_id IS NOT NULL
          AND pricing_as_of IS NOT NULL AND pricing_basis_json IS NOT NULL)
      )
    );

    CREATE TABLE reflection_proposal_reviews (
      proposal_id TEXT PRIMARY KEY,
      learner_id TEXT NOT NULL DEFAULT (current_learner_id()) REFERENCES learners(learner_id) ON DELETE CASCADE,
      artifact_id TEXT NOT NULL
        REFERENCES reflection_artifacts(artifact_id) ON DELETE RESTRICT,
      item_id TEXT NOT NULL,
      proposal_index INTEGER NOT NULL CHECK (proposal_index >= 0),
      disposition TEXT NOT NULL
        CHECK (disposition IN ('pending', 'deferred', 'accepted', 'dismissed', 'superseded')),
      updated_at TEXT NOT NULL,
      acceptance_mode TEXT
        CHECK (acceptance_mode IS NULL OR acceptance_mode IN ('exact', 'revised')),
      accepted_invocation_id TEXT
        REFERENCES reflection_operation_invocations(invocation_id) ON DELETE RESTRICT,
      dismissal_reason TEXT,
      supersession_source TEXT
        CHECK (
          supersession_source IS NULL
          OR supersession_source IN ('competing_proposal', 'user_replacement', 'external_state')
        ),
      supersession_actor TEXT
        CHECK (supersession_actor IS NULL OR supersession_actor IN ('user', 'system')),
      supersession_reason TEXT,
      replacement_proposal_id TEXT
        REFERENCES reflection_proposal_reviews(proposal_id) ON DELETE RESTRICT,
      replacement_invocation_id TEXT
        REFERENCES reflection_operation_invocations(invocation_id) ON DELETE RESTRICT,
      satisfying_effect_refs_json TEXT NOT NULL DEFAULT '[]',
      UNIQUE (artifact_id, item_id, proposal_index),
      CHECK (
        (
          disposition IN ('pending', 'deferred')
          AND acceptance_mode IS NULL
          AND accepted_invocation_id IS NULL
          AND dismissal_reason IS NULL
          AND supersession_source IS NULL
          AND supersession_actor IS NULL
          AND supersession_reason IS NULL
          AND replacement_proposal_id IS NULL
          AND replacement_invocation_id IS NULL
          AND satisfying_effect_refs_json = '[]'
        )
        OR (
          disposition = 'accepted'
          AND acceptance_mode IS NOT NULL
          AND accepted_invocation_id IS NOT NULL
          AND dismissal_reason IS NULL
          AND supersession_source IS NULL
          AND supersession_actor IS NULL
          AND supersession_reason IS NULL
          AND replacement_proposal_id IS NULL
          AND replacement_invocation_id IS NULL
          AND satisfying_effect_refs_json = '[]'
        )
        OR (
          disposition = 'dismissed'
          AND acceptance_mode IS NULL
          AND accepted_invocation_id IS NULL
          AND supersession_source IS NULL
          AND supersession_actor IS NULL
          AND supersession_reason IS NULL
          AND replacement_proposal_id IS NULL
          AND replacement_invocation_id IS NULL
          AND satisfying_effect_refs_json = '[]'
        )
        OR (
          disposition = 'superseded'
          AND acceptance_mode IS NULL
          AND accepted_invocation_id IS NULL
          AND dismissal_reason IS NULL
          AND supersession_source IS NOT NULL
          AND supersession_actor IS NOT NULL
          AND supersession_reason IS NOT NULL
          AND (
            (
              supersession_source = 'competing_proposal'
              AND replacement_proposal_id IS NOT NULL
              AND replacement_invocation_id IS NULL
              AND satisfying_effect_refs_json = '[]'
            )
            OR (
              supersession_source = 'user_replacement'
              AND replacement_proposal_id IS NULL
              AND replacement_invocation_id IS NOT NULL
              AND satisfying_effect_refs_json = '[]'
            )
            OR (
              supersession_source = 'external_state'
              AND replacement_proposal_id IS NULL
              AND replacement_invocation_id IS NULL
              AND satisfying_effect_refs_json != '[]'
            )
          )
        )
      )
    );

    CREATE TABLE reflection_operation_invocations (
      invocation_id TEXT PRIMARY KEY,
      learner_id TEXT NOT NULL DEFAULT (current_learner_id()) REFERENCES learners(learner_id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      origin_kind TEXT NOT NULL
        CHECK (origin_kind IN ('proposal_acceptance', 'user_replacement', 'manual')),
      origin_proposal_id TEXT
        REFERENCES reflection_proposal_reviews(proposal_id) ON DELETE RESTRICT,
      origin_superseded_proposal_id TEXT
        REFERENCES reflection_proposal_reviews(proposal_id) ON DELETE RESTRICT,
      operation_kind TEXT NOT NULL,
      operation_version INTEGER NOT NULL,
      operation_json TEXT NOT NULL,
      application_state TEXT NOT NULL
        CHECK (
          application_state IN (
            'unsupported',
            'pending',
            'applied',
            'failed',
            'stale',
            'already_satisfied',
            'authorization_withdrawn'
          )
        ),
      application_updated_at TEXT NOT NULL,
      unsupported_reason TEXT,
      applied_at TEXT,
      application_error TEXT,
      stale_reason TEXT,
      effect_refs_json TEXT NOT NULL DEFAULT '[]',
      satisfying_effect_refs_json TEXT NOT NULL DEFAULT '[]',
      CHECK (
        (
          origin_kind = 'proposal_acceptance'
          AND origin_proposal_id IS NOT NULL
          AND origin_superseded_proposal_id IS NULL
        )
        OR (
          origin_kind = 'user_replacement'
          AND origin_proposal_id IS NULL
          AND origin_superseded_proposal_id IS NOT NULL
        )
        OR (
          origin_kind = 'manual'
          AND origin_proposal_id IS NULL
          AND origin_superseded_proposal_id IS NULL
        )
      ),
      CHECK (
        (
          application_state = 'unsupported'
          AND unsupported_reason IS NOT NULL
          AND applied_at IS NULL
          AND application_error IS NULL
          AND stale_reason IS NULL
          AND effect_refs_json = '[]'
          AND satisfying_effect_refs_json = '[]'
        )
        OR (
          application_state IN ('pending', 'authorization_withdrawn')
          AND unsupported_reason IS NULL
          AND applied_at IS NULL
          AND application_error IS NULL
          AND stale_reason IS NULL
          AND effect_refs_json = '[]'
          AND satisfying_effect_refs_json = '[]'
        )
        OR (
          application_state = 'applied'
          AND unsupported_reason IS NULL
          AND applied_at IS NOT NULL
          AND application_error IS NULL
          AND stale_reason IS NULL
          AND effect_refs_json != '[]'
          AND satisfying_effect_refs_json = '[]'
        )
        OR (
          application_state = 'failed'
          AND unsupported_reason IS NULL
          AND applied_at IS NULL
          AND application_error IS NOT NULL
          AND stale_reason IS NULL
          AND effect_refs_json = '[]'
          AND satisfying_effect_refs_json = '[]'
        )
        OR (
          application_state = 'stale'
          AND unsupported_reason IS NULL
          AND applied_at IS NULL
          AND application_error IS NULL
          AND stale_reason IS NOT NULL
          AND effect_refs_json = '[]'
          AND satisfying_effect_refs_json = '[]'
        )
        OR (
          application_state = 'already_satisfied'
          AND unsupported_reason IS NULL
          AND applied_at IS NULL
          AND application_error IS NULL
          AND stale_reason IS NULL
          AND effect_refs_json = '[]'
          AND satisfying_effect_refs_json != '[]'
        )
      )
    );

    CREATE TRIGGER reflection_proposal_identity_immutable
    BEFORE UPDATE OF proposal_id, artifact_id, item_id, proposal_index
    ON reflection_proposal_reviews
    BEGIN
      SELECT RAISE(ABORT, 'reflection proposal identity is immutable');
    END;

    CREATE TRIGGER reflection_invocation_authorization_immutable
    BEFORE UPDATE OF
      invocation_id,
      created_at,
      origin_kind,
      origin_proposal_id,
      origin_superseded_proposal_id,
      operation_kind,
      operation_version,
      operation_json
    ON reflection_operation_invocations
    BEGIN
      SELECT RAISE(ABORT, 'reflection invocation authorization is immutable');
    END;
  `);

  createReflectionQualitySchema();
  createReflectionHelpInboxSchema();
}

function createReflectionGenerationRunStartSchema(): void {
  getDb().exec(`
    CREATE TABLE reflection_generation_run_starts (
      run_id TEXT PRIMARY KEY,
      learner_id TEXT NOT NULL DEFAULT (current_learner_id()) REFERENCES learners(learner_id) ON DELETE CASCADE,
      source_session_id TEXT,
      reflection_flow_version TEXT NOT NULL,
      started_at TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      provider_model TEXT NOT NULL,
      prompt_version TEXT NOT NULL,
      client_request_id TEXT NOT NULL,
      eligible_item_count INTEGER NOT NULL CHECK (eligible_item_count >= 0),
      included_item_count INTEGER NOT NULL CHECK (included_item_count >= 0 AND included_item_count <= eligible_item_count),
      evidence_bundle_json TEXT NOT NULL
    );
    CREATE INDEX idx_reflection_generation_run_starts_started
      ON ${learnerScopedStorageTableName('reflection_generation_run_starts')}(started_at DESC, run_id ASC);
  `);
}

export function createReflectionIndexes(): void {
  getDb().exec(`
    CREATE INDEX idx_reflection_artifacts_generated
      ON ${learnerScopedStorageTableName('reflection_artifacts')}(generated_at DESC, artifact_id ASC);
    CREATE INDEX idx_reflection_generation_runs_completed
      ON ${learnerScopedStorageTableName('reflection_generation_runs')}(completed_at DESC, run_id ASC);
    CREATE INDEX idx_reflection_proposal_reviews_open
      ON ${learnerScopedStorageTableName('reflection_proposal_reviews')}(disposition, artifact_id);
    CREATE INDEX idx_reflection_invocations_application
      ON ${learnerScopedStorageTableName('reflection_operation_invocations')}(application_state, application_updated_at ASC);
    CREATE UNIQUE INDEX idx_reflection_invocations_proposal_origin
      ON ${learnerScopedStorageTableName('reflection_operation_invocations')}(origin_proposal_id)
      WHERE origin_kind = 'proposal_acceptance';
    CREATE UNIQUE INDEX idx_reflection_proposal_reviews_accepted_invocation
      ON ${learnerScopedStorageTableName('reflection_proposal_reviews')}(accepted_invocation_id)
      WHERE accepted_invocation_id IS NOT NULL;
  `);
}

export function validateReflectionSchema(): void {
  assertTableColumns('reflection_artifacts', artifactColumns);
  assertTableColumns('reflection_generation_runs', reflectionGenerationRunColumns);
  assertTableColumns('reflection_proposal_reviews', proposalReviewColumns);
  assertTableColumns('reflection_operation_invocations', invocationColumns);
  validateReflectionQualitySchema();
  validateReflectionHelpInboxSchema();
  assertUniqueIndex(
    'reflection_proposal_reviews',
    ['artifact_id', 'item_id', 'proposal_index'],
  );
  assertNamedIndex(
    'idx_reflection_artifacts_generated',
    'reflection_artifacts',
    false,
    ['generated_at', 'artifact_id'],
  );
  assertNamedIndex(
    'idx_reflection_generation_runs_completed',
    'reflection_generation_runs',
    false,
    ['completed_at', 'run_id'],
  );
  assertNamedIndex(
    'idx_reflection_proposal_reviews_open',
    'reflection_proposal_reviews',
    false,
    ['disposition', 'artifact_id'],
  );
  assertNamedIndex(
    'idx_reflection_invocations_application',
    'reflection_operation_invocations',
    false,
    ['application_state', 'application_updated_at'],
  );
  assertNamedIndex(
    'idx_reflection_invocations_proposal_origin',
    'reflection_operation_invocations',
    true,
    ['origin_proposal_id'],
    true,
  );
  assertNamedIndex(
    'idx_reflection_proposal_reviews_accepted_invocation',
    'reflection_proposal_reviews',
    true,
    ['accepted_invocation_id'],
    true,
  );
  assertForeignKey(
    'reflection_proposal_reviews',
    'artifact_id',
    'reflection_artifacts',
    'artifact_id',
    'RESTRICT',
  );
  assertForeignKey(
    'reflection_proposal_reviews',
    'accepted_invocation_id',
    'reflection_operation_invocations',
    'invocation_id',
    'RESTRICT',
  );
  assertForeignKey(
    'reflection_operation_invocations',
    'origin_proposal_id',
    'reflection_proposal_reviews',
    'proposal_id',
    'RESTRICT',
  );
}

function assertTableColumns(tableName: string, expectedColumns: readonly string[]): void {
  const storageTableName = learnerScopedStorageTableName(tableName);
  const rows = getDb().prepare(`PRAGMA table_info(${storageTableName})`).all() as Array<{
    name: string;
  }>;
  const actualColumns = new Set(rows.map((row) => row.name));
  if (actualColumns.size === 0) {
    throw new Error(`Database at ${dbPath} is missing the required "${tableName}" table.`);
  }
  for (const column of expectedColumns) {
    if (!actualColumns.has(column)) {
      throw new Error(
        `Database at ${dbPath} has an incompatible "${tableName}" table. Missing column "${column}".`,
      );
    }
  }
}

function assertUniqueIndex(tableName: string, expectedColumns: readonly string[]): void {
  const storageTableName = learnerScopedStorageTableName(tableName);
  const indexes = getDb().prepare(`PRAGMA index_list(${storageTableName})`).all() as Array<{
    name: string;
    unique: number;
  }>;
  const hasExpectedIndex = indexes.some((index) => {
    if (index.unique !== 1) return false;
    const columns = getDb().prepare(`PRAGMA index_info(${index.name})`).all() as Array<{
      name: string;
    }>;
    return columns.map((column) => column.name).join('\u0000')
      === expectedColumns.join('\u0000');
  });
  if (!hasExpectedIndex) {
    throw new Error(
      `Database at ${dbPath} has an incompatible "${tableName}" table. `
      + `Missing unique key (${expectedColumns.join(', ')}).`,
    );
  }
}

function assertNamedIndex(
  indexName: string,
  tableName: string,
  unique: boolean,
  expectedColumns: readonly string[],
  partial = false,
): void {
  const storageTableName = learnerScopedStorageTableName(tableName);
  const indexes = getDb().prepare(`PRAGMA index_list(${storageTableName})`).all() as Array<{
    name: string;
    unique: number;
    partial: number;
  }>;
  const index = indexes.find((candidate) => candidate.name === indexName);
  if (!index || index.unique !== (unique ? 1 : 0) || index.partial !== (partial ? 1 : 0)) {
    throw new Error(
      `Database at ${dbPath} is missing the required "${indexName}" index on "${tableName}".`,
    );
  }
  const columns = getDb().prepare(`PRAGMA index_info(${indexName})`).all() as Array<{
    name: string;
  }>;
  if (columns.map((column) => column.name).join('\u0000') !== expectedColumns.join('\u0000')) {
    throw new Error(
      `Database at ${dbPath} has an incompatible "${indexName}" index on "${tableName}".`,
    );
  }
}

function assertForeignKey(
  tableName: string,
  fromColumn: string,
  targetTable: string,
  targetColumn: string,
  onDelete: string,
): void {
  const storageTableName = learnerScopedStorageTableName(tableName);
  const storageTargetTable = learnerScopedStorageTableName(targetTable);
  const foreignKeys = getDb().prepare(`PRAGMA foreign_key_list(${storageTableName})`).all() as Array<{
    table: string;
    from: string;
    to: string;
    on_delete: string;
  }>;
  const present = foreignKeys.some((foreignKey) => (
    foreignKey.table === storageTargetTable
    && foreignKey.from === fromColumn
    && foreignKey.to === targetColumn
    && foreignKey.on_delete === onDelete
  ));
  if (!present) {
    throw new Error(
      `Database at ${dbPath} has an incompatible "${tableName}" table. `
      + `Missing foreign key ${fromColumn} -> ${targetTable}(${targetColumn}) ON DELETE ${onDelete}.`,
    );
  }
}
