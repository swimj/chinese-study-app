-- Existing pure schedules remain intact. Enforce subtype/access on every new reference,
-- and prevent later authored type edits from silently changing what a schedule names.
DROP TRIGGER vocabulary_pure_cue_schedule_kind;
CREATE TRIGGER vocabulary_pure_cue_schedule_kind BEFORE INSERT ON learner_pure_cue_schedules
WHEN NOT EXISTS (SELECT 1 FROM content_items c WHERE c.content_id=NEW.content_id
  AND c.kind='exercise' AND c.exercise_type='pure_cue' AND c.exercise_role='general'
  AND (c.access_scope='shared' OR c.owner_learner_id=NEW.learner_id))
BEGIN SELECT RAISE(ABORT,'pure cue schedule requires accessible general pure cue'); END;
CREATE TRIGGER vocabulary_pure_cue_schedule_update BEFORE UPDATE OF learner_id,content_id ON learner_pure_cue_schedules
WHEN NOT EXISTS (SELECT 1 FROM content_items c WHERE c.content_id=NEW.content_id
  AND c.kind='exercise' AND c.exercise_type='pure_cue' AND c.exercise_role='general'
  AND (c.access_scope='shared' OR c.owner_learner_id=NEW.learner_id))
BEGIN SELECT RAISE(ABORT,'pure cue schedule requires accessible general pure cue'); END;
CREATE TRIGGER vocabulary_scheduled_pure_cue_type BEFORE UPDATE OF exercise_type,kind,exercise_role,access_scope,owner_learner_id ON content_items
WHEN EXISTS (SELECT 1 FROM learner_pure_cue_schedules s WHERE s.content_id=OLD.content_id
  AND (NEW.kind!='exercise' OR NEW.exercise_type IS NOT 'pure_cue' OR NEW.exercise_role IS NOT 'general'
    OR (NEW.access_scope!='shared' AND NEW.owner_learner_id IS NOT s.learner_id)))
BEGIN SELECT RAISE(ABORT,'scheduled pure cue identity requires replacement'); END;
