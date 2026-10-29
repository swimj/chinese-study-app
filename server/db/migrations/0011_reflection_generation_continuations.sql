-- Exact staged-reflection continuation evidence and provider-call membership.
-- Legacy generation rows remain untouched and have no continuation link.
CREATE TABLE reflection_generation_continuations (
  learner_id TEXT NOT NULL REFERENCES learners(learner_id) ON DELETE CASCADE,
  continuation_id TEXT NOT NULL,
  source_session_id TEXT,
  reflection_flow_version TEXT NOT NULL,
  created_at TEXT NOT NULL,
  eligible_item_count INTEGER NOT NULL CHECK (eligible_item_count >= 0),
  overlap_omitted_item_count INTEGER NOT NULL DEFAULT 0 CHECK (overlap_omitted_item_count >= 0),
  included_item_count INTEGER NOT NULL CHECK (
    included_item_count >= 0 AND included_item_count <= eligible_item_count
  ),
  diagnosis_bundle_json TEXT NOT NULL,
  source_proposal_ids_json TEXT,
  diagnosis_result_json TEXT,
  final_evidence_bundle_json TEXT,
  promotion_bundle_json TEXT,
  artifact_id TEXT,
  PRIMARY KEY (learner_id, continuation_id),
  FOREIGN KEY (learner_id, source_session_id)
    REFERENCES learner_owned_study_sessions(learner_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (artifact_id)
    REFERENCES learner_owned_reflection_artifacts(artifact_id) ON DELETE RESTRICT,
  CHECK (
    (diagnosis_result_json IS NULL AND final_evidence_bundle_json IS NULL AND promotion_bundle_json IS NULL)
    OR (diagnosis_result_json IS NOT NULL AND final_evidence_bundle_json IS NOT NULL AND promotion_bundle_json IS NOT NULL)
  ),
  CHECK (artifact_id IS NULL OR diagnosis_result_json IS NOT NULL),
  CHECK (included_item_count + overlap_omitted_item_count <= eligible_item_count)
);

CREATE TABLE reflection_generation_continuation_runs (
  learner_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  continuation_id TEXT NOT NULL,
  stage TEXT NOT NULL CHECK (stage IN ('diagnosis', 'promotion')),
  created_at TEXT NOT NULL,
  PRIMARY KEY (learner_id, run_id),
  FOREIGN KEY (learner_id, continuation_id)
    REFERENCES reflection_generation_continuations(learner_id, continuation_id) ON DELETE CASCADE
);

CREATE INDEX idx_reflection_generation_continuations_session
  ON reflection_generation_continuations(
    learner_id, source_session_id, reflection_flow_version, created_at DESC
  );
CREATE INDEX idx_reflection_generation_continuation_runs_continuation
  ON reflection_generation_continuation_runs(learner_id, continuation_id, created_at, run_id);

CREATE TRIGGER reflection_generation_continuations_identity_immutable
BEFORE UPDATE OF
  learner_id, continuation_id, source_session_id, reflection_flow_version,
  created_at, eligible_item_count, included_item_count, overlap_omitted_item_count, diagnosis_bundle_json,
  source_proposal_ids_json
ON reflection_generation_continuations
BEGIN
  SELECT RAISE(ABORT, 'reflection generation continuation identity and diagnosis input are immutable');
END;

CREATE TRIGGER reflection_generation_continuation_runs_immutable
BEFORE UPDATE ON reflection_generation_continuation_runs
BEGIN
  SELECT RAISE(ABORT, 'reflection generation continuation run links are immutable');
END;
