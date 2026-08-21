import { getDb } from './connection.ts';

type SameOwnerReference = {
  childTable: string;
  childReferenceColumn: string;
  parentTable: string;
  parentIdColumn: string;
};

const sameOwnerReferences: readonly SameOwnerReference[] = [
  reference('learner_owned_reflection_artifacts', 'source_session_id', 'learner_owned_study_sessions', 'id'),
  reference('learner_owned_reflection_artifacts', 'source_run_id', 'learner_owned_reflection_generation_runs', 'run_id'),
  reference('learner_owned_reflection_generation_runs', 'source_session_id', 'learner_owned_study_sessions', 'id'),
  reference('learner_owned_reflection_proposal_reviews', 'artifact_id', 'learner_owned_reflection_artifacts', 'artifact_id'),
  reference('learner_owned_reflection_proposal_reviews', 'accepted_invocation_id', 'learner_owned_reflection_operation_invocations', 'invocation_id'),
  reference('learner_owned_reflection_proposal_reviews', 'replacement_proposal_id', 'learner_owned_reflection_proposal_reviews', 'proposal_id'),
  reference('learner_owned_reflection_proposal_reviews', 'replacement_invocation_id', 'learner_owned_reflection_operation_invocations', 'invocation_id'),
  reference('learner_owned_reflection_operation_invocations', 'origin_proposal_id', 'learner_owned_reflection_proposal_reviews', 'proposal_id'),
  reference('learner_owned_reflection_operation_invocations', 'origin_superseded_proposal_id', 'learner_owned_reflection_proposal_reviews', 'proposal_id'),
  reference('learner_owned_reflection_quality_annotations', 'artifact_id', 'learner_owned_reflection_artifacts', 'artifact_id'),
  reference('learner_owned_reflection_help_inbox', 'artifact_id', 'learner_owned_reflection_artifacts', 'artifact_id'),
  reference('learner_owned_production_cue_lifecycle_events', 'invocation_id', 'learner_owned_reflection_operation_invocations', 'invocation_id'),
  reference('learner_owned_production_cue_activation_state', 'latest_lifecycle_event_id', 'learner_owned_production_cue_lifecycle_events', 'event_id'),
  reference('learner_owned_production_cue_evidence_records', 'source_attempt_id', 'learner_owned_study_attempt_events', 'id'),
  reference('learner_owned_production_cue_evidence_records', 'invocation_id', 'learner_owned_reflection_operation_invocations', 'invocation_id'),
  reference('learner_owned_production_cue_evidence_records', 'source_evidence_id', 'learner_owned_production_cue_evidence_records', 'evidence_id'),
  reference('learner_owned_production_recheck_demands', 'source_attempt_id', 'learner_owned_study_attempt_events', 'id'),
  reference('learner_owned_production_recheck_demands', 'consumed_by_attempt_id', 'learner_owned_study_attempt_events', 'id'),
  reference('learner_owned_production_recheck_demands', 'replacement_demand_id', 'learner_owned_production_recheck_demands', 'demand_id'),
  reference('learner_owned_intake_triage_assessments', 'run_id', 'learner_owned_intake_triage_runs', 'run_id'),
  reference('learner_owned_intake_triage_assessment_dispositions', 'assessment_id', 'learner_owned_intake_triage_assessments', 'assessment_id'),
];

export function installLearnerOwnershipGuards(): void {
  for (const item of sameOwnerReferences) installSameOwnerReference(item);
  installScopedCueAccessGuards();
  installPrivateProductionProvenanceGuards();
}

function installSameOwnerReference(item: SameOwnerReference): void {
  const baseName = `${item.childTable}_${item.childReferenceColumn}_same_owner`;
  const predicate = `NEW.${item.childReferenceColumn} IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM ${item.parentTable} AS parent
    WHERE parent.${item.parentIdColumn} = NEW.${item.childReferenceColumn}
      AND parent.learner_id = NEW.learner_id
  )`;
  getDb().exec(`
    CREATE TRIGGER IF NOT EXISTS ${baseName}_insert
    BEFORE INSERT ON ${item.childTable}
    WHEN ${predicate}
    BEGIN
      SELECT RAISE(ABORT, 'cross-learner private reference');
    END;
    CREATE TRIGGER IF NOT EXISTS ${baseName}_update
    BEFORE UPDATE OF learner_id, ${item.childReferenceColumn} ON ${item.childTable}
    WHEN ${predicate}
    BEGIN
      SELECT RAISE(ABORT, 'cross-learner private reference');
    END;
  `);
}

function installScopedCueAccessGuards(): void {
  const childTables = [
    'learner_owned_production_cue_lifecycle_events',
    'learner_owned_production_cue_activation_state',
    'learner_owned_production_cue_evidence_records',
    'learner_owned_production_cue_evidence_projection',
  ];
  for (const childTable of childTables) {
    const triggerBase = `${childTable}_cue_access`;
    const predicate = `NEW.cue_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM scoped_production_cues AS cue
      WHERE cue.cue_id = NEW.cue_id
        AND (cue.content_scope = 'shared' OR cue.owner_learner_id = NEW.learner_id)
    )`;
    getDb().exec(`
      CREATE TRIGGER IF NOT EXISTS ${triggerBase}_insert
      BEFORE INSERT ON ${childTable}
      WHEN ${predicate}
      BEGIN SELECT RAISE(ABORT, 'production cue is not accessible to learner'); END;
      CREATE TRIGGER IF NOT EXISTS ${triggerBase}_update
      BEFORE UPDATE OF learner_id, cue_id ON ${childTable}
      WHEN ${predicate}
      BEGIN SELECT RAISE(ABORT, 'production cue is not accessible to learner'); END;
    `);
  }
}

function installPrivateProductionProvenanceGuards(): void {
  getDb().exec(`
    CREATE TRIGGER IF NOT EXISTS scoped_production_cues_invocation_owner_insert
    BEFORE INSERT ON scoped_production_cues
    WHEN NEW.origin_invocation_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM learner_owned_reflection_operation_invocations AS invocation
      WHERE invocation.invocation_id = NEW.origin_invocation_id
        AND invocation.learner_id = NEW.owner_learner_id
    )
    BEGIN SELECT RAISE(ABORT, 'production cue provenance crosses learner boundary'); END;

    CREATE TRIGGER IF NOT EXISTS scoped_production_supplements_invocation_owner_insert
    BEFORE INSERT ON scoped_production_cue_supplements
    WHEN NEW.origin_invocation_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM learner_owned_reflection_operation_invocations AS invocation
      WHERE invocation.invocation_id = NEW.origin_invocation_id
        AND invocation.learner_id = NEW.owner_learner_id
    )
    BEGIN SELECT RAISE(ABORT, 'production supplement provenance crosses learner boundary'); END;
  `);
}

function reference(
  childTable: string,
  childReferenceColumn: string,
  parentTable: string,
  parentIdColumn: string,
): SameOwnerReference {
  return { childTable, childReferenceColumn, parentTable, parentIdColumn };
}
