
import { getDb } from './connection.ts';
import { physicalLearnerTableName } from './learner-scoped-tables.ts';

const PRODUCTION_TASKS_BACKFILL_MIGRATION_ID = 'production_tasks_backfill_v0';

export type ProductionCueSupplementEntryV1 = {
  supplementId: string;
  taskId: string;
  cueId: string | null;
  englishFrame: string;
  exampleSentence: string;
  exampleTranslation: string;
  createdAt: string;
  invocationId: string | null;
};

function scopedStorageTable(logicalName: string): string {
  const candidateNames = [physicalLearnerTableName(logicalName), `scoped_${logicalName}`];
  const row = getDb().prepare(`
    SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (?, ?)
    ORDER BY CASE WHEN name = ? THEN 0 ELSE 1 END
    LIMIT 1
  `).get(candidateNames[0], candidateNames[1], candidateNames[0]) as { name: string } | undefined;
  return row?.name ?? logicalName;
}

export type ProductionCueSupplementRow = {
  supplement_id: string;
  task_id: string;
  cue_id: string | null;
  english_frame: string;
  example_sentence: string;
  example_translation: string;
  created_at: string;
  origin_invocation_id: string | null;
};

export function createProductionCueSchema(): void {
  getDb().exec(`
    CREATE TABLE production_tasks (
      task_id TEXT PRIMARY KEY,
      word_id TEXT NOT NULL REFERENCES lexical_words(id) ON DELETE CASCADE,
      task_kind TEXT NOT NULL CHECK (task_kind = 'default_production'),
      created_at TEXT NOT NULL,
      UNIQUE (word_id, task_kind)
    );

    CREATE TRIGGER words_create_default_production_task
    AFTER INSERT ON lexical_words
    BEGIN
      INSERT OR IGNORE INTO production_tasks (task_id, word_id, task_kind, created_at)
      VALUES ('production-task:' || NEW.id || ':default_production', NEW.id, 'default_production', NEW.created_at);
    END;

    CREATE TABLE production_cues (
      cue_id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES production_tasks(task_id) ON DELETE CASCADE,
      cue_type TEXT NOT NULL
        CHECK (cue_type IN ('definition_gloss', 'minimal_context', 'circumstance')),
      cue_text TEXT NOT NULL CHECK (length(trim(cue_text)) > 0),
      created_at TEXT NOT NULL,
      origin_kind TEXT NOT NULL CHECK (origin_kind IN ('reflection', 'manual')),
      origin_invocation_id TEXT
        REFERENCES reflection_operation_invocations(invocation_id) ON DELETE RESTRICT,
      content_scope TEXT NOT NULL DEFAULT 'learner' CHECK (content_scope IN ('learner', 'shared')),
      owner_learner_id TEXT DEFAULT (current_learner_id()) REFERENCES learners(learner_id) ON DELETE RESTRICT,
      CHECK (
        (origin_kind = 'reflection' AND origin_invocation_id IS NOT NULL)
        OR (origin_kind = 'manual' AND origin_invocation_id IS NULL)
      ),
      CHECK (
        (content_scope = 'learner' AND owner_learner_id IS NOT NULL)
        OR (content_scope = 'shared' AND owner_learner_id IS NULL AND origin_invocation_id IS NULL)
      )
    );

    CREATE TRIGGER production_cues_no_delete
    BEFORE DELETE ON ${scopedStorageTable('production_cues')}
    BEGIN
      SELECT RAISE(ABORT, 'production cues cannot be deleted');
    END;

    CREATE TABLE production_cue_supplements (
      supplement_id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES production_tasks(task_id) ON DELETE CASCADE,
      cue_id TEXT REFERENCES production_cues(cue_id) ON DELETE RESTRICT,
      english_frame TEXT NOT NULL CHECK (length(trim(english_frame)) > 0),
      example_sentence TEXT NOT NULL CHECK (length(trim(example_sentence)) > 0),
      example_translation TEXT NOT NULL CHECK (length(trim(example_translation)) > 0),
      created_at TEXT NOT NULL,
      origin_invocation_id TEXT
        REFERENCES reflection_operation_invocations(invocation_id) ON DELETE RESTRICT,
      content_scope TEXT NOT NULL DEFAULT 'learner' CHECK (content_scope IN ('learner', 'shared')),
      owner_learner_id TEXT DEFAULT (current_learner_id()) REFERENCES learners(learner_id) ON DELETE RESTRICT,
      CHECK (
        (content_scope = 'learner' AND owner_learner_id IS NOT NULL)
        OR (content_scope = 'shared' AND owner_learner_id IS NULL AND origin_invocation_id IS NULL)
      )
    );

    CREATE TRIGGER production_cue_supplements_no_delete
    BEFORE DELETE ON ${scopedStorageTable('production_cue_supplements')}
    BEGIN
      SELECT RAISE(ABORT, 'production cue supplements cannot be deleted');
    END;

    CREATE TABLE production_cue_accepted_words (
      cue_id TEXT NOT NULL REFERENCES production_cues(cue_id) ON DELETE CASCADE,
      word_id TEXT NOT NULL REFERENCES lexical_words(id) ON DELETE RESTRICT,
      position INTEGER NOT NULL CHECK (position >= 0),
      PRIMARY KEY (cue_id, word_id),
      UNIQUE (cue_id, position)
    );

    CREATE TRIGGER production_cue_accepted_words_immutable
    BEFORE UPDATE ON ${scopedStorageTable('production_cue_accepted_words')}
    BEGIN
      SELECT RAISE(ABORT, 'production cue accepted words are immutable');
    END;

    CREATE TRIGGER production_cue_accepted_words_no_delete
    BEFORE DELETE ON ${scopedStorageTable('production_cue_accepted_words')}
    BEGIN
      SELECT RAISE(ABORT, 'production cue accepted words cannot be deleted');
    END;

    CREATE TABLE production_cue_lifecycle_events (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      learner_id TEXT NOT NULL DEFAULT (current_learner_id()) REFERENCES learners(learner_id) ON DELETE CASCADE,
      event_id TEXT NOT NULL UNIQUE,
      cue_id TEXT NOT NULL REFERENCES production_cues(cue_id) ON DELETE RESTRICT,
      task_id TEXT NOT NULL REFERENCES production_tasks(task_id) ON DELETE CASCADE,
      lifecycle_kind TEXT NOT NULL CHECK (lifecycle_kind IN ('activated', 'deactivated')),
      occurred_at TEXT NOT NULL,
      invocation_id TEXT
        REFERENCES reflection_operation_invocations(invocation_id) ON DELETE RESTRICT
    );

    CREATE TRIGGER production_cue_lifecycle_events_immutable
    BEFORE UPDATE ON ${scopedStorageTable('production_cue_lifecycle_events')}
    BEGIN
      SELECT RAISE(ABORT, 'production cue lifecycle events are immutable');
    END;

    CREATE TRIGGER production_cue_lifecycle_events_no_delete
    BEFORE DELETE ON ${scopedStorageTable('production_cue_lifecycle_events')}
    BEGIN
      SELECT RAISE(ABORT, 'production cue lifecycle events cannot be deleted');
    END;

    CREATE TABLE production_cue_activation_state (
      learner_id TEXT NOT NULL DEFAULT (current_learner_id()) REFERENCES learners(learner_id) ON DELETE CASCADE,
      cue_id TEXT NOT NULL REFERENCES production_cues(cue_id) ON DELETE RESTRICT,
      active INTEGER NOT NULL CHECK (active IN (0, 1)),
      latest_lifecycle_event_id TEXT NOT NULL UNIQUE
        REFERENCES production_cue_lifecycle_events(event_id) ON DELETE RESTRICT,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (learner_id, cue_id)
    );

    CREATE TABLE production_cue_evidence_records (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      learner_id TEXT NOT NULL DEFAULT (current_learner_id()) REFERENCES learners(learner_id) ON DELETE CASCADE,
      evidence_id TEXT NOT NULL UNIQUE,
      occurred_at TEXT NOT NULL,
      record_kind TEXT NOT NULL CHECK (record_kind IN ('attempt', 'judgment', 'compensation')),
      task_id TEXT NOT NULL REFERENCES production_tasks(task_id) ON DELETE CASCADE,
      cue_id TEXT REFERENCES production_cues(cue_id) ON DELETE RESTRICT,
      source_attempt_id TEXT,
      attempt_result TEXT
        CHECK (
          attempt_result IS NULL
          OR attempt_result IN (
            'accepted_anchor',
            'accepted_non_anchor',
            'rejected'
          )
        ),
      judgment_kind TEXT
        CHECK (
          judgment_kind IS NULL
          OR judgment_kind IN (
            'accepted_answer_space_omission',
            'misleading_or_overloaded_cue'
          )
        ),
      submitted_word_id TEXT REFERENCES lexical_words(id) ON DELETE RESTRICT,
      source_evidence_id TEXT
        REFERENCES production_cue_evidence_records(evidence_id) ON DELETE RESTRICT,
      invocation_id TEXT
        REFERENCES reflection_operation_invocations(invocation_id) ON DELETE RESTRICT,
      compensation_reason TEXT,
      projected_at TEXT,
      CHECK (
        (
          record_kind = 'attempt'
          AND source_attempt_id IS NOT NULL
          AND attempt_result IS NOT NULL
          AND judgment_kind IS NULL
          AND source_evidence_id IS NULL
          AND invocation_id IS NULL
          AND compensation_reason IS NULL
        )
        OR (
          record_kind = 'judgment'
          AND source_attempt_id IS NOT NULL
          AND attempt_result IS NULL
          AND judgment_kind IS NOT NULL
          AND source_evidence_id IS NULL
          AND invocation_id IS NOT NULL
          AND compensation_reason IS NULL
        )
        OR (
          record_kind = 'compensation'
          AND source_attempt_id IS NULL
          AND attempt_result IS NULL
          AND judgment_kind IS NULL
          AND submitted_word_id IS NULL
          AND source_evidence_id IS NOT NULL
          AND compensation_reason IS NOT NULL
        )
      )
    );

    CREATE TRIGGER production_cue_evidence_records_content_immutable
    BEFORE UPDATE OF
      evidence_id,
      occurred_at,
      record_kind,
      task_id,
      cue_id,
      source_attempt_id,
      attempt_result,
      judgment_kind,
      submitted_word_id,
      source_evidence_id,
      invocation_id,
      compensation_reason
    ON ${scopedStorageTable('production_cue_evidence_records')}
    BEGIN
      SELECT RAISE(ABORT, 'production cue evidence is append-only');
    END;

    CREATE TRIGGER production_cue_evidence_records_no_delete
    BEFORE DELETE ON ${scopedStorageTable('production_cue_evidence_records')}
    BEGIN
      SELECT RAISE(ABORT, 'production cue evidence cannot be deleted');
    END;

    CREATE TABLE production_cue_evidence_projection (
      learner_id TEXT NOT NULL DEFAULT (current_learner_id()) REFERENCES learners(learner_id) ON DELETE CASCADE,
      cue_id TEXT NOT NULL REFERENCES production_cues(cue_id) ON DELETE RESTRICT,
      attempt_count INTEGER NOT NULL,
      accepted_anchor_count INTEGER NOT NULL,
      accepted_non_anchor_count INTEGER NOT NULL,
      rejected_count INTEGER NOT NULL,
      active_judgment_count INTEGER NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (learner_id, cue_id)
    );

    CREATE TABLE production_recheck_demands (
      demand_id TEXT PRIMARY KEY,
      learner_id TEXT NOT NULL DEFAULT (current_learner_id()) REFERENCES learners(learner_id) ON DELETE CASCADE,
      task_id TEXT NOT NULL REFERENCES production_tasks(task_id) ON DELETE CASCADE,
      source_attempt_id TEXT NOT NULL,
      scheduled_at TEXT NOT NULL,
      due_at TEXT NOT NULL,
      consumed_at TEXT,
      consumed_by_attempt_id TEXT,
      replacement_demand_id TEXT,
      UNIQUE (learner_id, source_attempt_id),
      UNIQUE (learner_id, consumed_by_attempt_id),
      UNIQUE (learner_id, replacement_demand_id),
      CHECK (
        (consumed_at IS NULL AND consumed_by_attempt_id IS NULL AND replacement_demand_id IS NULL)
        OR (consumed_at IS NOT NULL AND consumed_by_attempt_id IS NOT NULL)
      )
    );

    CREATE TRIGGER production_recheck_demands_content_immutable
    BEFORE UPDATE OF demand_id, task_id, source_attempt_id, scheduled_at, due_at
    ON ${scopedStorageTable('production_recheck_demands')}
    BEGIN
      SELECT RAISE(ABORT, 'production recheck demand content is immutable');
    END;

    CREATE TRIGGER production_recheck_demands_no_delete
    BEFORE DELETE ON ${scopedStorageTable('production_recheck_demands')}
    BEGIN
      SELECT RAISE(ABORT, 'production recheck demands cannot be deleted');
    END;
  `);

  // Preserve the historical marker; new words receive tasks through the insert trigger.
  getDb().prepare(`
    INSERT INTO schema_migrations (migration_id, applied_at, details_json)
    VALUES (?, ?, '{"status":"complete"}')
  `).run(PRODUCTION_TASKS_BACKFILL_MIGRATION_ID, new Date().toISOString());
}

export function createProductionCueIndexes(): void {
  getDb().exec(`
    CREATE INDEX idx_production_tasks_word
      ON production_tasks(word_id, task_kind);
    CREATE INDEX idx_production_cues_task
      ON ${scopedStorageTable('production_cues')}(task_id, created_at, cue_id);
    CREATE UNIQUE INDEX idx_production_cue_supplements_cue
      ON ${scopedStorageTable('production_cue_supplements')}(cue_id)
      WHERE cue_id IS NOT NULL;
    CREATE UNIQUE INDEX idx_production_cue_supplements_fallback
      ON ${scopedStorageTable('production_cue_supplements')}(task_id)
      WHERE cue_id IS NULL;
    CREATE INDEX idx_production_cue_accepted_words_word
      ON ${scopedStorageTable('production_cue_accepted_words')}(word_id, cue_id);
    CREATE INDEX idx_production_cue_lifecycle_latest
      ON ${scopedStorageTable('production_cue_lifecycle_events')}(cue_id, sequence DESC);
    CREATE INDEX idx_production_cue_activation_active
      ON ${scopedStorageTable('production_cue_activation_state')}(active, cue_id);
    CREATE INDEX idx_production_cue_evidence_unprojected
      ON ${scopedStorageTable('production_cue_evidence_records')}(projected_at, cue_id, sequence);
    CREATE UNIQUE INDEX idx_production_cue_attempt_evidence_source
      ON ${scopedStorageTable('production_cue_evidence_records')}(learner_id, source_attempt_id)
      WHERE record_kind = 'attempt';
    CREATE UNIQUE INDEX idx_production_cue_judgment_invocation
      ON ${scopedStorageTable('production_cue_evidence_records')}(learner_id, invocation_id, source_attempt_id, judgment_kind)
      WHERE record_kind = 'judgment';
    CREATE UNIQUE INDEX idx_production_cue_compensation_source
      ON ${scopedStorageTable('production_cue_evidence_records')}(learner_id, source_evidence_id)
      WHERE record_kind = 'compensation';
    CREATE UNIQUE INDEX idx_production_recheck_pending_task
      ON ${scopedStorageTable('production_recheck_demands')}(learner_id, task_id)
      WHERE consumed_at IS NULL;
    CREATE INDEX idx_production_recheck_due
      ON ${scopedStorageTable('production_recheck_demands')}(due_at, task_id)
      WHERE consumed_at IS NULL;
  `);
}

export function validateProductionCueSchema(): void {
  assertColumns('production_tasks', ['task_id', 'word_id', 'task_kind', 'created_at']);
  assertColumns('production_cues', [
    'cue_id',
    'task_id',
    'cue_type',
    'cue_text',
    'created_at',
    'origin_kind',
    'origin_invocation_id',
  ]);
  assertColumns('production_cue_supplements', [
    'supplement_id',
    'task_id',
    'cue_id',
    'english_frame',
    'example_sentence',
    'example_translation',
    'created_at',
    'origin_invocation_id',
  ]);
  assertColumns('production_cue_accepted_words', ['cue_id', 'word_id', 'position']);
  assertColumns('production_cue_lifecycle_events', [
    'sequence',
    'event_id',
    'cue_id',
    'task_id',
    'lifecycle_kind',
    'occurred_at',
    'invocation_id',
  ]);
  assertColumns('production_cue_activation_state', [
    'cue_id',
    'active',
    'latest_lifecycle_event_id',
    'updated_at',
  ]);
  assertColumns('production_cue_evidence_records', [
    'sequence',
    'evidence_id',
    'occurred_at',
    'record_kind',
    'task_id',
    'cue_id',
    'source_attempt_id',
    'attempt_result',
    'judgment_kind',
    'submitted_word_id',
    'source_evidence_id',
    'invocation_id',
    'compensation_reason',
    'projected_at',
  ]);
  assertColumns('production_cue_evidence_projection', [
    'cue_id',
    'attempt_count',
    'accepted_anchor_count',
    'accepted_non_anchor_count',
    'rejected_count',
    'active_judgment_count',
    'updated_at',
  ]);
}

export function mapProductionCueSupplementRow(
  row: ProductionCueSupplementRow,
): ProductionCueSupplementEntryV1 {
  return {
    supplementId: row.supplement_id,
    taskId: row.task_id,
    cueId: row.cue_id,
    englishFrame: row.english_frame,
    exampleSentence: row.example_sentence,
    exampleTranslation: row.example_translation,
    createdAt: row.created_at,
    invocationId: row.origin_invocation_id,
  };
}

function assertColumns(table: string, expected: string[]): void {
  const actual = getDb().prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  const actualNames = actual.map((column) => column.name);
  if (
    actualNames.length !== expected.length
    || actualNames.some((column, index) => column !== expected[index])
  ) {
    throw new Error(
      `Database production cue table ${table} has columns ${actualNames.join(', ')}; expected ${expected.join(', ')}.`,
    );
  }
}
