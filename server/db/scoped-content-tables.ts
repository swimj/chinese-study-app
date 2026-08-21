import { getDb } from './connection.ts';

export function installScopedContentCompatibilityViews(): void {
  installContrastContentViews();
  installProductionContentViews();
}

export function scopedContentStorageTableName(logicalName: string): string {
  const storageName = `scoped_${logicalName}`;
  return objectType(storageName) === 'table' ? storageName : logicalName;
}

function installContrastContentViews(): void {
  renameTable('contrast_clusters', 'scoped_contrast_clusters');
  renameTable('contrast_cluster_members', 'scoped_contrast_cluster_members');
  renameTable('contrast_prompts', 'scoped_contrast_prompts');

  getDb().exec(`
    CREATE VIEW IF NOT EXISTS contrast_clusters AS
    SELECT id, title, note
    FROM scoped_contrast_clusters
    WHERE content_scope = 'shared' OR owner_learner_id = current_learner_id();

    CREATE VIEW IF NOT EXISTS contrast_cluster_members AS
    SELECT member.cluster_id, member.word_id, member.nuance_note, member.display_order
    FROM scoped_contrast_cluster_members AS member
    JOIN scoped_contrast_clusters AS cluster ON cluster.id = member.cluster_id
    WHERE cluster.content_scope = 'shared' OR cluster.owner_learner_id = current_learner_id();

    CREATE VIEW IF NOT EXISTS contrast_prompts AS
    SELECT prompt.id, prompt.cluster_id, prompt.target_word_id, prompt.prompt_text, prompt.explanation
    FROM scoped_contrast_prompts AS prompt
    JOIN scoped_contrast_clusters AS cluster ON cluster.id = prompt.cluster_id
    WHERE cluster.content_scope = 'shared' OR cluster.owner_learner_id = current_learner_id();

    CREATE TRIGGER IF NOT EXISTS contrast_clusters_scoped_insert
    INSTEAD OF INSERT ON contrast_clusters
    BEGIN
      INSERT INTO scoped_contrast_clusters (id, title, note, content_scope, owner_learner_id)
      VALUES (NEW.id, NEW.title, COALESCE(NEW.note, ''), 'learner', current_learner_id());
    END;

    CREATE TRIGGER IF NOT EXISTS contrast_clusters_scoped_update
    INSTEAD OF UPDATE ON contrast_clusters
    BEGIN
      SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM scoped_contrast_clusters
        WHERE id = OLD.id AND content_scope = 'learner' AND owner_learner_id = current_learner_id()
      ) THEN RAISE(ABORT, 'shared contrast clusters are immutable') END;
      UPDATE scoped_contrast_clusters SET title = NEW.title, note = NEW.note
      WHERE id = OLD.id AND owner_learner_id = current_learner_id();
    END;

    CREATE TRIGGER IF NOT EXISTS contrast_clusters_scoped_delete
    INSTEAD OF DELETE ON contrast_clusters
    BEGIN
      SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM scoped_contrast_clusters
        WHERE id = OLD.id AND content_scope = 'learner' AND owner_learner_id = current_learner_id()
      ) THEN RAISE(ABORT, 'shared contrast clusters cannot be deleted') END;
      DELETE FROM scoped_contrast_clusters WHERE id = OLD.id AND owner_learner_id = current_learner_id();
    END;

    CREATE TRIGGER IF NOT EXISTS contrast_cluster_members_scoped_insert
    INSTEAD OF INSERT ON contrast_cluster_members
    BEGIN
      SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM scoped_contrast_clusters
        WHERE id = NEW.cluster_id AND content_scope = 'learner' AND owner_learner_id = current_learner_id()
      ) THEN RAISE(ABORT, 'contrast cluster is not writable by the current learner') END;
      INSERT INTO scoped_contrast_cluster_members (cluster_id, word_id, nuance_note, display_order)
      VALUES (NEW.cluster_id, NEW.word_id, COALESCE(NEW.nuance_note, ''), NEW.display_order);
    END;

    CREATE TRIGGER IF NOT EXISTS contrast_cluster_members_scoped_update
    INSTEAD OF UPDATE ON contrast_cluster_members
    BEGIN
      SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM scoped_contrast_clusters
        WHERE id = OLD.cluster_id AND content_scope = 'learner' AND owner_learner_id = current_learner_id()
      ) THEN RAISE(ABORT, 'contrast cluster is not writable by the current learner') END;
      UPDATE scoped_contrast_cluster_members
      SET nuance_note = NEW.nuance_note, display_order = NEW.display_order
      WHERE cluster_id = OLD.cluster_id AND word_id = OLD.word_id;
    END;

    CREATE TRIGGER IF NOT EXISTS contrast_cluster_members_scoped_delete
    INSTEAD OF DELETE ON contrast_cluster_members
    BEGIN
      SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM scoped_contrast_clusters
        WHERE id = OLD.cluster_id AND content_scope = 'learner' AND owner_learner_id = current_learner_id()
      ) THEN RAISE(ABORT, 'contrast cluster is not writable by the current learner') END;
      DELETE FROM scoped_contrast_cluster_members
      WHERE cluster_id = OLD.cluster_id AND word_id = OLD.word_id;
    END;

    CREATE TRIGGER IF NOT EXISTS contrast_prompts_scoped_insert
    INSTEAD OF INSERT ON contrast_prompts
    BEGIN
      SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM scoped_contrast_clusters
        WHERE id = NEW.cluster_id AND content_scope = 'learner' AND owner_learner_id = current_learner_id()
      ) THEN RAISE(ABORT, 'contrast cluster is not writable by the current learner') END;
      INSERT INTO scoped_contrast_prompts (id, cluster_id, target_word_id, prompt_text, explanation)
      VALUES (NEW.id, NEW.cluster_id, NEW.target_word_id, NEW.prompt_text, COALESCE(NEW.explanation, ''));
    END;

    CREATE TRIGGER IF NOT EXISTS contrast_prompts_scoped_update
    INSTEAD OF UPDATE ON contrast_prompts
    BEGIN
      SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM scoped_contrast_clusters
        WHERE id = OLD.cluster_id AND content_scope = 'learner' AND owner_learner_id = current_learner_id()
      ) THEN RAISE(ABORT, 'contrast cluster is not writable by the current learner') END;
      UPDATE scoped_contrast_prompts
      SET prompt_text = NEW.prompt_text, explanation = NEW.explanation
      WHERE id = OLD.id;
    END;

    CREATE TRIGGER IF NOT EXISTS contrast_prompts_scoped_delete
    INSTEAD OF DELETE ON contrast_prompts
    BEGIN
      SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM scoped_contrast_clusters
        WHERE id = OLD.cluster_id AND content_scope = 'learner' AND owner_learner_id = current_learner_id()
      ) THEN RAISE(ABORT, 'contrast cluster is not writable by the current learner') END;
      DELETE FROM scoped_contrast_prompts WHERE id = OLD.id;
    END;
  `);
}

function installProductionContentViews(): void {
  renameTable('production_cues', 'scoped_production_cues');
  renameTable('production_cue_supplements', 'scoped_production_cue_supplements');
  renameTable('production_cue_accepted_words', 'scoped_production_cue_accepted_words');

  getDb().exec(`
    CREATE VIEW IF NOT EXISTS production_cues AS
    SELECT cue_id, task_id, cue_type, cue_text, created_at, origin_kind, origin_invocation_id
    FROM scoped_production_cues
    WHERE content_scope = 'shared' OR owner_learner_id = current_learner_id();

    CREATE VIEW IF NOT EXISTS production_cue_supplements AS
    SELECT supplement_id, task_id, cue_id, english_frame, example_sentence,
      example_translation, created_at, origin_invocation_id
    FROM scoped_production_cue_supplements
    WHERE content_scope = 'shared' OR owner_learner_id = current_learner_id();

    CREATE VIEW IF NOT EXISTS production_cue_accepted_words AS
    SELECT accepted.cue_id, accepted.word_id, accepted.position
    FROM scoped_production_cue_accepted_words AS accepted
    JOIN scoped_production_cues AS cue ON cue.cue_id = accepted.cue_id
    WHERE cue.content_scope = 'shared' OR cue.owner_learner_id = current_learner_id();

    CREATE TRIGGER IF NOT EXISTS production_cues_scoped_insert
    INSTEAD OF INSERT ON production_cues
    BEGIN
      INSERT INTO scoped_production_cues (
        cue_id, task_id, cue_type, cue_text, created_at, origin_kind, origin_invocation_id,
        content_scope, owner_learner_id
      ) VALUES (
        NEW.cue_id, NEW.task_id, NEW.cue_type, NEW.cue_text, NEW.created_at,
        NEW.origin_kind, NEW.origin_invocation_id, 'learner', current_learner_id()
      );
    END;

    CREATE TRIGGER IF NOT EXISTS production_cue_supplements_scoped_insert
    INSTEAD OF INSERT ON production_cue_supplements
    BEGIN
      INSERT INTO scoped_production_cue_supplements (
        supplement_id, task_id, cue_id, english_frame, example_sentence,
        example_translation, created_at, origin_invocation_id, content_scope, owner_learner_id
      ) VALUES (
        NEW.supplement_id, NEW.task_id, NEW.cue_id, NEW.english_frame, NEW.example_sentence,
        NEW.example_translation, NEW.created_at, NEW.origin_invocation_id, 'learner', current_learner_id()
      );
    END;

    CREATE TRIGGER IF NOT EXISTS production_cue_accepted_words_scoped_insert
    INSTEAD OF INSERT ON production_cue_accepted_words
    BEGIN
      SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM scoped_production_cues
        WHERE cue_id = NEW.cue_id AND content_scope = 'learner' AND owner_learner_id = current_learner_id()
      ) THEN RAISE(ABORT, 'production cue is not writable by the current learner') END;
      INSERT INTO scoped_production_cue_accepted_words (cue_id, word_id, position)
      VALUES (NEW.cue_id, NEW.word_id, NEW.position);
    END;

    CREATE TRIGGER IF NOT EXISTS production_cues_scoped_update
    INSTEAD OF UPDATE ON production_cues
    BEGIN SELECT RAISE(ABORT, 'production cues are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS production_cues_scoped_delete
    INSTEAD OF DELETE ON production_cues
    BEGIN SELECT RAISE(ABORT, 'production cues cannot be deleted'); END;
    CREATE TRIGGER IF NOT EXISTS production_cue_supplements_scoped_update
    INSTEAD OF UPDATE ON production_cue_supplements
    BEGIN SELECT RAISE(ABORT, 'production cue supplements are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS production_cue_supplements_scoped_delete
    INSTEAD OF DELETE ON production_cue_supplements
    BEGIN SELECT RAISE(ABORT, 'production cue supplements cannot be deleted'); END;
    CREATE TRIGGER IF NOT EXISTS production_cue_accepted_words_scoped_update
    INSTEAD OF UPDATE ON production_cue_accepted_words
    BEGIN SELECT RAISE(ABORT, 'production cue accepted words are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS production_cue_accepted_words_scoped_delete
    INSTEAD OF DELETE ON production_cue_accepted_words
    BEGIN SELECT RAISE(ABORT, 'production cue accepted words cannot be deleted'); END;
  `);
}

function renameTable(logicalName: string, storageName: string): void {
  if (objectType(storageName) === 'table') return;
  if (objectType(logicalName) !== 'table') {
    throw new Error(`Expected scoped content table "${logicalName}" before installing its view`);
  }
  getDb().exec(`ALTER TABLE ${logicalName} RENAME TO ${storageName}`);
}

function objectType(name: string): 'table' | 'view' | null {
  const row = getDb().prepare(`
    SELECT type FROM sqlite_master WHERE name = ? AND type IN ('table', 'view')
  `).get(name) as { type: 'table' | 'view' } | undefined;
  return row?.type ?? null;
}
