-- Explicit successors preserve immutable content identities and historical joins.
CREATE TABLE content_improvement_replacements (
  kind TEXT NOT NULL CHECK (kind IN ('production_cue','contrast_prompt','supplement','teaching_package')),
  source_id TEXT NOT NULL,
  replacement_source_id TEXT NOT NULL,
  case_id TEXT NOT NULL REFERENCES content_improvement_cases(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (kind,source_id),
  UNIQUE (kind,replacement_source_id),
  CHECK (source_id != replacement_source_id)
);
CREATE TRIGGER content_improvement_replacements_immutable BEFORE UPDATE ON content_improvement_replacements
BEGIN SELECT RAISE(ABORT,'Content successors are immutable'); END;
CREATE TRIGGER content_improvement_replacements_no_delete BEFORE DELETE ON content_improvement_replacements
BEGIN SELECT RAISE(ABORT,'Content successors cannot be deleted'); END;

-- Keep one live supplement per existing attachment slot, while retaining its predecessors.
DROP INDEX idx_production_cue_supplements_cue;
DROP INDEX idx_production_cue_supplements_fallback;
CREATE INDEX idx_production_cue_supplements_cue ON scoped_production_cue_supplements(cue_id) WHERE cue_id IS NOT NULL;
CREATE INDEX idx_production_cue_supplements_fallback ON scoped_production_cue_supplements(task_id) WHERE cue_id IS NULL;
CREATE TRIGGER production_cue_supplements_live_slot BEFORE INSERT ON scoped_production_cue_supplements
WHEN EXISTS (
  SELECT 1 FROM scoped_production_cue_supplements old
  WHERE ((NEW.cue_id IS NOT NULL AND old.cue_id = NEW.cue_id)
    OR (NEW.cue_id IS NULL AND old.cue_id IS NULL AND old.task_id = NEW.task_id))
    AND NOT EXISTS (SELECT 1 FROM content_improvement_replacements r WHERE r.kind='supplement' AND r.source_id=old.supplement_id)
)
BEGIN SELECT RAISE(ABORT,'Supplement attachment already has live content'); END;

CREATE TABLE operator_pure_cue_repairs (
  case_id TEXT PRIMARY KEY REFERENCES content_improvement_cases(id) ON DELETE RESTRICT,
  pure_cue_id TEXT NOT NULL REFERENCES pure_cues(id) ON DELETE RESTRICT,
  previous_stimulus TEXT NOT NULL,
  stimulus TEXT NOT NULL,
  previous_teaching_note TEXT NOT NULL,
  teaching_note TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  repaired_at TEXT NOT NULL
);
CREATE TRIGGER operator_pure_cue_repairs_immutable BEFORE UPDATE ON operator_pure_cue_repairs
BEGIN SELECT RAISE(ABORT,'Operator pure cue repair evidence is immutable'); END;
CREATE TRIGGER operator_pure_cue_repairs_no_delete BEFORE DELETE ON operator_pure_cue_repairs
BEGIN SELECT RAISE(ABORT,'Operator pure cue repair evidence cannot be deleted'); END;
CREATE TRIGGER operator_pure_cue_repairs_case_guard BEFORE INSERT ON operator_pure_cue_repairs
WHEN NOT EXISTS (
  SELECT 1 FROM content_improvement_cases c JOIN pure_cues p ON p.id=NEW.pure_cue_id
  WHERE c.id=NEW.case_id AND c.status='draft' AND c.source_kind='pure_cue' AND c.source_id=NEW.pure_cue_id
    AND p.stimulus=NEW.previous_stimulus AND p.teaching_note=NEW.previous_teaching_note
    AND trim(json_extract(c.case_json,'$.proposed.stimulus'))=NEW.stimulus
    AND trim(json_extract(c.case_json,'$.proposed.teachingNote'))=NEW.teaching_note
)
BEGIN SELECT RAISE(ABORT,'Operator repair must match its saved draft and current cue'); END;

DROP TRIGGER pure_cues_stimulus_repair_guard;
CREATE TRIGGER pure_cues_stimulus_repair_guard BEFORE UPDATE OF stimulus ON pure_cues
WHEN NOT EXISTS (
  SELECT 1 FROM pure_cue_stimulus_revisions revision
  JOIN learner_owned_reflection_operation_invocations invocation
    ON invocation.invocation_id=revision.invocation_id AND invocation.learner_id=revision.learner_id
  WHERE revision.pure_cue_id=OLD.id AND revision.previous_stimulus=OLD.stimulus
    AND revision.stimulus=NEW.stimulus AND invocation.application_state='pending'
    AND invocation.operation_kind='repair_pure_cue_stimulus' AND invocation.operation_version=1
) AND NOT EXISTS (
  SELECT 1 FROM operator_pure_cue_repairs r JOIN content_improvement_cases c ON c.id=r.case_id
  WHERE c.status='draft' AND r.pure_cue_id=OLD.id AND r.previous_stimulus=OLD.stimulus
    AND r.stimulus=NEW.stimulus AND r.previous_teaching_note=OLD.teaching_note AND r.teaching_note=NEW.teaching_note
)
BEGIN SELECT RAISE(ABORT,'Pure cue stimulus change requires an authorized revision'); END;
