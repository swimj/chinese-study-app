import { getDb } from './connection.ts';

const PHYSICAL_PREFIX = 'learner_owned_';

const mutableColumnsByTable: Readonly<Record<string, readonly string[]>> = {
  reflection_artifacts: [],
  reflection_generation_runs: [],
  reflection_proposal_reviews: [
    'disposition', 'updated_at', 'acceptance_mode', 'accepted_invocation_id',
    'dismissal_reason', 'supersession_source', 'supersession_actor',
    'supersession_reason', 'replacement_proposal_id', 'replacement_invocation_id',
    'satisfying_effect_refs_json',
  ],
  reflection_operation_invocations: [
    'application_state', 'application_updated_at', 'unsupported_reason', 'applied_at',
    'application_error', 'stale_reason', 'effect_refs_json', 'satisfying_effect_refs_json',
  ],
  reflection_quality_annotations: ['tags_json', 'note', 'updated_at'],
  reflection_help_inbox: [],
  production_cue_lifecycle_events: [],
  production_cue_activation_state: ['active', 'latest_lifecycle_event_id', 'updated_at'],
  production_cue_evidence_records: ['projected_at'],
  production_cue_evidence_projection: [
    'attempt_count', 'accepted_anchor_count', 'accepted_non_anchor_count',
    'rejected_count', 'active_judgment_count', 'updated_at',
  ],
  production_recheck_demands: ['consumed_at', 'consumed_by_attempt_id', 'replacement_demand_id'],
  shared_content_publication_provenance: [],
  shared_content_reports: [
    'resolution', 'resolved_at', 'resolved_by_operator_id',
  ],
  intake_triage_runs: [],
  intake_triage_assessments: [],
  intake_triage_assessment_dispositions: [],
};

const immutableErrorByTable: Readonly<Record<string, string>> = {
  reflection_artifacts: 'reflection artifacts are immutable',
  reflection_generation_runs: 'reflection generation runs are immutable',
  reflection_proposal_reviews: 'reflection proposal identity is immutable',
  reflection_operation_invocations: 'reflection invocation authorization is immutable',
  reflection_help_inbox: 'reflection help inbox entries are immutable',
  production_cue_lifecycle_events: 'production cue lifecycle events are immutable',
  shared_content_publication_provenance: 'shared content publication provenance is immutable',
  intake_triage_runs: 'intake triage runs are immutable',
  intake_triage_assessments: 'intake triage assessments are immutable',
  intake_triage_assessment_dispositions: 'intake triage dispositions are immutable',
};

export const learnerScopedCompatibilityTables = [
  'user_word_priority',
  'word_study_admission_state',
  'word_skill_state',
  'daily_new_word_intake',
  'review_session_summaries',
  'study_sessions',
  'study_attempt_events',
  'study_events',
  'word_skill_relevance',
  'reflection_artifacts',
  'reflection_generation_runs',
  'reflection_proposal_reviews',
  'reflection_operation_invocations',
  'reflection_quality_annotations',
  'reflection_help_inbox',
  'production_cue_lifecycle_events',
  'production_cue_activation_state',
  'production_cue_evidence_records',
  'production_cue_evidence_projection',
  'production_recheck_demands',
  'shared_content_publication_provenance',
  'shared_content_reports',
  'intake_triage_runs',
  'intake_triage_assessments',
  'intake_triage_assessment_dispositions',
] as const;

export function physicalLearnerTableName(logicalTableName: string): string {
  return `${PHYSICAL_PREFIX}${logicalTableName}`;
}

export function learnerScopedStorageTableName(logicalTableName: string): string {
  const physicalName = physicalLearnerTableName(logicalTableName);
  return objectType(physicalName) === 'table' ? physicalName : logicalTableName;
}

export function installLearnerScopedCompatibilityViews(): void {
  for (const logicalName of learnerScopedCompatibilityTables) {
    installLearnerScopedCompatibilityView(logicalName);
  }
}

function installLearnerScopedCompatibilityView(logicalName: string): void {
  const physicalName = physicalLearnerTableName(logicalName);
  if (objectType(physicalName) !== 'table') {
    if (objectType(logicalName) !== 'table') {
      throw new Error(`Expected learner-owned table "${logicalName}" before installing its scoped view`);
    }
    getDb().exec(`ALTER TABLE ${logicalName} RENAME TO ${physicalName}`);
  }

  const columns = getDb().prepare(`PRAGMA table_info(${physicalName})`).all() as Array<{
    name: string;
    pk: number;
    dflt_value: string | null;
  }>;
  const publicColumns = columns.filter((column) => column.name !== 'learner_id');
  const primaryKeyColumns = columns
    .filter((column) => column.pk > 0 && column.name !== 'learner_id')
    .sort((left, right) => left.pk - right.pk);
  if (!columns.some((column) => column.name === 'learner_id') || primaryKeyColumns.length === 0) {
    throw new Error(`Learner-owned table "${physicalName}" requires learner_id and a row key`);
  }

  const columnList = publicColumns.map((column) => column.name).join(', ');
  const newValues = publicColumns.map((column) => (
    column.dflt_value === null ? `NEW.${column.name}` : `COALESCE(NEW.${column.name}, ${column.dflt_value})`
  )).join(', ');
  const mutableColumnNames = mutableColumnsByTable[logicalName];
  const updateColumns = mutableColumnNames === undefined
    ? publicColumns
    : publicColumns.filter((column) => mutableColumnNames.includes(column.name));
  const immutableColumns = mutableColumnNames === undefined
    ? []
    : publicColumns.filter((column) => !mutableColumnNames.includes(column.name));
  const rowMatch = primaryKeyColumns.map((column) => `${column.name} = OLD.${column.name}`).join(' AND ');
  const immutableError = immutableErrorByTable[logicalName] ?? `${logicalName} immutable columns cannot change`;
  const immutableGuards = immutableColumns.map((column) => (
    `SELECT CASE WHEN NEW.${column.name} IS NOT OLD.${column.name} THEN RAISE(ABORT, '${immutableError}') END;`
  )).join('\n      ');
  const updateBody = updateColumns.length === 0
    ? `SELECT RAISE(ABORT, '${immutableError}');`
    : `${immutableGuards}
      UPDATE ${physicalName}
      SET ${updateColumns.map((column) => `${column.name} = NEW.${column.name}`).join(', ')}
      WHERE learner_id = current_learner_id() AND ${rowMatch};`;

  getDb().exec(`
    CREATE VIEW IF NOT EXISTS ${logicalName} AS
    SELECT ${columnList}
    FROM ${physicalName}
    WHERE learner_id = current_learner_id();

    CREATE TRIGGER IF NOT EXISTS ${logicalName}_scoped_insert
    INSTEAD OF INSERT ON ${logicalName}
    BEGIN
      INSERT INTO ${physicalName} (learner_id, ${columnList})
      VALUES (current_learner_id(), ${newValues});
    END;

    CREATE TRIGGER IF NOT EXISTS ${logicalName}_scoped_update
    INSTEAD OF UPDATE ON ${logicalName}
    BEGIN
      ${updateBody}
    END;

    CREATE TRIGGER IF NOT EXISTS ${logicalName}_scoped_delete
    INSTEAD OF DELETE ON ${logicalName}
    BEGIN
      DELETE FROM ${physicalName}
      WHERE learner_id = current_learner_id() AND ${rowMatch};
    END;
  `);
}

function objectType(name: string): 'table' | 'view' | null {
  const row = getDb().prepare(`
    SELECT type FROM sqlite_master WHERE name = ? AND type IN ('table', 'view')
  `).get(name) as { type: 'table' | 'view' } | undefined;
  return row?.type ?? null;
}
