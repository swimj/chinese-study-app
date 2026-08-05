import { randomUUID } from 'node:crypto';
import type {
  CueEvidenceJudgmentV2,
  EffectRef,
  OperationApplicationState,
  ProductionCueDraftV2,
  ProductionCueTypeV0,
  RepairProductionCueOperationV2,
} from '../../src/domain/reflection.ts';
import { getDb } from './connection.ts';

export const DEFAULT_PRODUCTION_TASK_KIND = 'default_production' as const;

const PRODUCTION_TASKS_BACKFILL_MARKER_KEY = 'production_tasks_backfill_v0';

export type ProductionTaskV0 = {
  taskId: string;
  wordId: string;
  kind: typeof DEFAULT_PRODUCTION_TASK_KIND;
  createdAt: string;
};

export type ProductionCueEntryV0 = {
  cueId: string;
  taskId: string;
  cueType: ProductionCueTypeV0;
  text: string;
  acceptedWordIds: string[];
  createdAt: string;
  attribution: {
    origin: 'reflection' | 'manual';
    invocationId: string | null;
  };
  active: boolean;
};

export type ProductionCueAttemptResultV0 =
  | 'accepted_anchor'
  | 'accepted_non_anchor'
  | 'rejected';

export type AppendProductionCueAttemptEvidenceInput = {
  evidenceId?: string;
  occurredAt: string;
  taskId: string;
  cueId: string | null;
  sourceAttemptId: string;
  attemptResult: ProductionCueAttemptResultV0;
  submittedWordId: string | null;
};

export type ProductionCueEvidenceProjectionV0 = {
  cueId: string;
  attemptCount: number;
  acceptedAnchorCount: number;
  acceptedNonAnchorCount: number;
  rejectedCount: number;
  activeJudgmentCount: number;
  updatedAt: string;
};

type ProductionTaskRow = {
  task_id: string;
  word_id: string;
  task_kind: string;
  created_at: string;
};

type ProductionCueRow = {
  cue_id: string;
  task_id: string;
  cue_type: string;
  cue_text: string;
  created_at: string;
  origin_kind: string;
  origin_invocation_id: string | null;
  active: number;
};

type CueStateRow = {
  event_id: string;
  lifecycle_kind: 'activated' | 'deactivated';
};

type CueAttemptEvidenceRow = {
  evidence_id: string;
  task_id: string;
  cue_id: string | null;
  source_attempt_id: string;
  attempt_result: ProductionCueAttemptResultV0;
  submitted_word_id: string | null;
};

type SourceAttemptRow = {
  action_kind: string;
  target_word_id: string;
  response: string | null;
  content_ref_json: string | null;
  metadata_json: string;
};

export function defaultProductionTaskId(wordId: string): string {
  if (wordId.length === 0) throw new Error('Expected non-empty production task word id.');
  return `production-task:${wordId}:default_production`;
}

export function ensureProductionCueSchema(): void {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS production_tasks (
      task_id TEXT PRIMARY KEY,
      word_id TEXT NOT NULL REFERENCES words(id) ON DELETE CASCADE,
      task_kind TEXT NOT NULL CHECK (task_kind = 'default_production'),
      created_at TEXT NOT NULL,
      UNIQUE (word_id, task_kind)
    );

    CREATE TRIGGER IF NOT EXISTS words_create_default_production_task
    AFTER INSERT ON words
    BEGIN
      INSERT OR IGNORE INTO production_tasks (task_id, word_id, task_kind, created_at)
      VALUES ('production-task:' || NEW.id || ':default_production', NEW.id, 'default_production', NEW.created_at);
    END;

    CREATE TABLE IF NOT EXISTS production_cues (
      cue_id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES production_tasks(task_id) ON DELETE CASCADE,
      cue_type TEXT NOT NULL
        CHECK (cue_type IN ('definition_gloss', 'minimal_context', 'circumstance')),
      cue_text TEXT NOT NULL CHECK (length(trim(cue_text)) > 0),
      created_at TEXT NOT NULL,
      origin_kind TEXT NOT NULL CHECK (origin_kind IN ('reflection', 'manual')),
      origin_invocation_id TEXT
        REFERENCES reflection_operation_invocations(invocation_id) ON DELETE RESTRICT,
      CHECK (
        (origin_kind = 'reflection' AND origin_invocation_id IS NOT NULL)
        OR (origin_kind = 'manual' AND origin_invocation_id IS NULL)
      )
    );

    CREATE TRIGGER IF NOT EXISTS production_cues_immutable
    BEFORE UPDATE ON production_cues
    BEGIN
      SELECT RAISE(ABORT, 'production cues are immutable');
    END;

    CREATE TRIGGER IF NOT EXISTS production_cues_no_delete
    BEFORE DELETE ON production_cues
    BEGIN
      SELECT RAISE(ABORT, 'production cues cannot be deleted');
    END;

    CREATE TABLE IF NOT EXISTS production_cue_accepted_words (
      cue_id TEXT NOT NULL REFERENCES production_cues(cue_id) ON DELETE CASCADE,
      word_id TEXT NOT NULL REFERENCES words(id) ON DELETE RESTRICT,
      position INTEGER NOT NULL CHECK (position >= 0),
      PRIMARY KEY (cue_id, word_id),
      UNIQUE (cue_id, position)
    );

    CREATE TRIGGER IF NOT EXISTS production_cue_accepted_words_immutable
    BEFORE UPDATE ON production_cue_accepted_words
    BEGIN
      SELECT RAISE(ABORT, 'production cue accepted words are immutable');
    END;

    CREATE TRIGGER IF NOT EXISTS production_cue_accepted_words_no_delete
    BEFORE DELETE ON production_cue_accepted_words
    BEGIN
      SELECT RAISE(ABORT, 'production cue accepted words cannot be deleted');
    END;

    CREATE TABLE IF NOT EXISTS production_cue_lifecycle_events (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id TEXT NOT NULL UNIQUE,
      cue_id TEXT NOT NULL REFERENCES production_cues(cue_id) ON DELETE RESTRICT,
      task_id TEXT NOT NULL REFERENCES production_tasks(task_id) ON DELETE CASCADE,
      lifecycle_kind TEXT NOT NULL CHECK (lifecycle_kind IN ('activated', 'deactivated')),
      occurred_at TEXT NOT NULL,
      invocation_id TEXT
        REFERENCES reflection_operation_invocations(invocation_id) ON DELETE RESTRICT
    );

    CREATE TRIGGER IF NOT EXISTS production_cue_lifecycle_events_immutable
    BEFORE UPDATE ON production_cue_lifecycle_events
    BEGIN
      SELECT RAISE(ABORT, 'production cue lifecycle events are immutable');
    END;

    CREATE TRIGGER IF NOT EXISTS production_cue_lifecycle_events_no_delete
    BEFORE DELETE ON production_cue_lifecycle_events
    BEGIN
      SELECT RAISE(ABORT, 'production cue lifecycle events cannot be deleted');
    END;

    CREATE TABLE IF NOT EXISTS production_cue_activation_state (
      cue_id TEXT PRIMARY KEY REFERENCES production_cues(cue_id) ON DELETE RESTRICT,
      active INTEGER NOT NULL CHECK (active IN (0, 1)),
      latest_lifecycle_event_id TEXT NOT NULL UNIQUE
        REFERENCES production_cue_lifecycle_events(event_id) ON DELETE RESTRICT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS production_cue_evidence_records (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      evidence_id TEXT NOT NULL UNIQUE,
      occurred_at TEXT NOT NULL,
      record_kind TEXT NOT NULL CHECK (record_kind IN ('attempt', 'judgment', 'compensation')),
      task_id TEXT NOT NULL REFERENCES production_tasks(task_id) ON DELETE CASCADE,
      cue_id TEXT REFERENCES production_cues(cue_id) ON DELETE RESTRICT,
      source_attempt_id TEXT REFERENCES study_attempt_events(id) ON DELETE RESTRICT,
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
      submitted_word_id TEXT REFERENCES words(id) ON DELETE RESTRICT,
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

    CREATE TRIGGER IF NOT EXISTS production_cue_evidence_records_content_immutable
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
    ON production_cue_evidence_records
    BEGIN
      SELECT RAISE(ABORT, 'production cue evidence is append-only');
    END;


    CREATE TRIGGER IF NOT EXISTS production_cue_evidence_records_no_delete
    BEFORE DELETE ON production_cue_evidence_records
    BEGIN
      SELECT RAISE(ABORT, 'production cue evidence cannot be deleted');
    END;

    CREATE TABLE IF NOT EXISTS production_cue_evidence_projection (
      cue_id TEXT PRIMARY KEY REFERENCES production_cues(cue_id) ON DELETE RESTRICT,
      attempt_count INTEGER NOT NULL,
      accepted_anchor_count INTEGER NOT NULL,
      accepted_non_anchor_count INTEGER NOT NULL,
      rejected_count INTEGER NOT NULL,
      active_judgment_count INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  backfillDefaultProductionTasksOnce();
}

function backfillDefaultProductionTasksOnce(): void {
  const marker = getDb().prepare(`
    SELECT 1
    FROM app_metadata
    WHERE key = ?
  `).get(PRODUCTION_TASKS_BACKFILL_MARKER_KEY);
  if (marker) return;

  getDb().exec(`
    INSERT OR IGNORE INTO production_tasks (task_id, word_id, task_kind, created_at)
    SELECT
      'production-task:' || words.id || ':default_production',
      words.id,
      'default_production',
      words.created_at
    FROM words;
  `);
  getDb().prepare(`
    INSERT OR IGNORE INTO app_metadata (key, value, updated_at)
    VALUES (?, 'complete', ?)
  `).run(PRODUCTION_TASKS_BACKFILL_MARKER_KEY, new Date().toISOString());
}

export function ensureProductionCueIndexes(): void {
  getDb().exec(`
    CREATE INDEX IF NOT EXISTS idx_production_tasks_word
      ON production_tasks(word_id, task_kind);
    CREATE INDEX IF NOT EXISTS idx_production_cues_task
      ON production_cues(task_id, created_at, cue_id);
    CREATE INDEX IF NOT EXISTS idx_production_cue_accepted_words_word
      ON production_cue_accepted_words(word_id, cue_id);
    CREATE INDEX IF NOT EXISTS idx_production_cue_lifecycle_latest
      ON production_cue_lifecycle_events(cue_id, sequence DESC);
    CREATE INDEX IF NOT EXISTS idx_production_cue_activation_active
      ON production_cue_activation_state(active, cue_id);
    CREATE INDEX IF NOT EXISTS idx_production_cue_evidence_unprojected
      ON production_cue_evidence_records(projected_at, cue_id, sequence);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_production_cue_attempt_evidence_source
      ON production_cue_evidence_records(source_attempt_id)
      WHERE record_kind = 'attempt';
    CREATE UNIQUE INDEX IF NOT EXISTS idx_production_cue_judgment_invocation
      ON production_cue_evidence_records(invocation_id, source_attempt_id, judgment_kind)
      WHERE record_kind = 'judgment';
    CREATE UNIQUE INDEX IF NOT EXISTS idx_production_cue_compensation_source
      ON production_cue_evidence_records(source_evidence_id)
      WHERE record_kind = 'compensation';
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

export function getDefaultProductionTask(wordId: string): ProductionTaskV0 | null {
  const row = getDb().prepare(`
    SELECT task_id, word_id, task_kind, created_at
    FROM production_tasks
    WHERE word_id = ? AND task_kind = 'default_production'
  `).get(wordId) as ProductionTaskRow | undefined;
  return row ? mapTaskRow(row) : null;
}

export function getProductionCue(cueId: string): ProductionCueEntryV0 | null {
  const row = getDb().prepare(`${productionCueSelect()} WHERE production_cues.cue_id = ?`)
    .get(cueId) as ProductionCueRow | undefined;
  return row ? mapCueRow(row) : null;
}

export function getProductionCuesForTask(taskId: string): ProductionCueEntryV0[] {
  const rows = getDb().prepare(`
    ${productionCueSelect()}
    WHERE production_cues.task_id = ?
    ORDER BY production_cues.created_at ASC, production_cues.cue_id ASC
  `).all(taskId) as ProductionCueRow[];
  return rows.map(mapCueRow);
}

export function getActiveProductionCuesForWord(wordId: string): ProductionCueEntryV0[] {
  return getProductionCuesForTask(defaultProductionTaskId(wordId)).filter((cue) => cue.active);
}

export function applyProductionCueRepairWithoutTransaction(
  operation: RepairProductionCueOperationV2,
  invocationId: string,
  appliedAt: string,
): OperationApplicationState {
  const task = getDb().prepare(`
    SELECT task_id, word_id, task_kind, created_at
    FROM production_tasks
    WHERE task_id = ?
  `).get(operation.taskId) as ProductionTaskRow | undefined;
  if (!task || task.word_id !== operation.wordId || task.task_kind !== DEFAULT_PRODUCTION_TASK_KIND) {
    return {
      kind: 'stale',
      reason: `Default production task ${operation.taskId} no longer belongs to word ${operation.wordId}.`,
    };
  }

  const referencedCues = new Map<string, ProductionCueEntryV0>();
  for (const change of operation.changes) {
    if (change.kind === 'create') continue;
    const cue = getProductionCue(change.cueId);
    if (!cue || cue.taskId !== operation.taskId) {
      return {
        kind: 'stale',
        reason: `Production cue ${change.cueId} no longer belongs to task ${operation.taskId}.`,
      };
    }
    referencedCues.set(change.cueId, cue);
    if (change.kind === 'replace' && !cue.active) {
      return {
        kind: 'stale',
        reason: `Production cue ${change.cueId} is no longer active for replacement.`,
      };
    }
  }

  const draftWordIds = operation.changes.flatMap((change) => {
    switch (change.kind) {
      case 'create':
        return change.cue.acceptedWordIds;
      case 'replace':
        return change.replacements.flatMap((replacement) => replacement.acceptedWordIds);
      case 'deactivate':
        return [];
    }
  });
  for (const wordId of new Set(draftWordIds)) {
    if (!wordExists(wordId)) {
      return { kind: 'stale', reason: `Accepted production word ${wordId} no longer exists.` };
    }
  }

  for (const judgment of operation.sourceAttemptJudgments) {
    const validationError = validateJudgmentAgainstEvidence(operation, judgment);
    if (validationError !== null) return { kind: 'stale', reason: validationError };
  }

  const causedEffectRefs: EffectRef[] = [];
  const satisfyingEffectRefs: EffectRef[] = [];
  for (const change of operation.changes) {
    switch (change.kind) {
      case 'create':
        causedEffectRefs.push(...createCue(change.cue, operation.taskId, invocationId, appliedAt));
        break;
      case 'replace': {
        causedEffectRefs.push(appendLifecycleEvent(
          change.cueId,
          operation.taskId,
          'deactivated',
          invocationId,
          appliedAt,
        ));
        for (const replacement of change.replacements) {
          causedEffectRefs.push(...createCue(
            replacement,
            operation.taskId,
            invocationId,
            appliedAt,
          ));
        }
        break;
      }
      case 'deactivate': {
        const cue = referencedCues.get(change.cueId)!;
        if (!cue.active) {
          satisfyingEffectRefs.push(currentLifecycleEffectRef(change.cueId));
        } else {
          causedEffectRefs.push(appendLifecycleEvent(
            change.cueId,
            operation.taskId,
            'deactivated',
            invocationId,
            appliedAt,
          ));
        }
        break;
      }
    }
  }

  for (const judgment of operation.sourceAttemptJudgments) {
    const attempt = getAttemptEvidence(judgment.sourceAttemptId)!;
    const evidenceId = randomUUID();
    getDb().prepare(`
      INSERT INTO production_cue_evidence_records (
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
        compensation_reason,
        projected_at
      ) VALUES (?, ?, 'judgment', ?, ?, ?, NULL, ?, ?, NULL, ?, NULL, NULL)
    `).run(
      evidenceId,
      appliedAt,
      operation.taskId,
      attempt.cue_id,
      judgment.sourceAttemptId,
      judgment.kind,
      judgment.kind === 'accepted_answer_space_omission'
        ? judgment.submittedWordId
        : attempt.submitted_word_id,
      invocationId,
    );
    causedEffectRefs.push({ type: 'production_cue_evidence_judgment', id: evidenceId });
  }

  return causedEffectRefs.length > 0
    ? { kind: 'applied', appliedAt, effectRefs: causedEffectRefs }
    : { kind: 'already_satisfied', satisfyingEffectRefs };
}

export function appendProductionCueAttemptEvidenceWithoutTransaction(
  input: AppendProductionCueAttemptEvidenceInput,
): string {
  const evidenceId = input.evidenceId ?? randomUUID();
  const task = getDb().prepare(`SELECT word_id FROM production_tasks WHERE task_id = ?`)
    .get(input.taskId) as { word_id: string } | undefined;
  if (!task) throw new Error(`Unknown production task ${input.taskId}.`);
  const cue = input.cueId === null ? null : getProductionCue(input.cueId);
  if (input.cueId !== null) {
    if (!cue || cue.taskId !== input.taskId) {
      throw new Error(`Production cue ${input.cueId} does not belong to task ${input.taskId}.`);
    }
  }
  const sourceAttempt = getDb().prepare(`
    SELECT action_kind, target_word_id, response, content_ref_json, metadata_json
    FROM study_attempt_events
    WHERE id = ?
  `).get(input.sourceAttemptId) as SourceAttemptRow | undefined;
  if (!sourceAttempt) throw new Error(`Unknown study attempt ${input.sourceAttemptId}.`);
  validateSourceAttemptSnapshot(sourceAttempt, task.word_id, cue, input);
  getDb().prepare(`
    INSERT INTO production_cue_evidence_records (
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
      compensation_reason,
      projected_at
    ) VALUES (?, ?, 'attempt', ?, ?, ?, ?, NULL, ?, NULL, NULL, NULL, NULL)
  `).run(
    evidenceId,
    input.occurredAt,
    input.taskId,
    input.cueId,
    input.sourceAttemptId,
    input.attemptResult,
    input.submittedWordId,
  );
  return evidenceId;
}

export function appendProductionCueEvidenceCompensationWithoutTransaction(input: {
  evidenceId?: string;
  occurredAt: string;
  sourceJudgmentEvidenceId: string;
  reason: string;
  sourceInvocationId?: string | null;
}): string {
  const source = getDb().prepare(`
    SELECT task_id, cue_id
    FROM production_cue_evidence_records
    WHERE evidence_id = ? AND record_kind = 'judgment'
  `).get(input.sourceJudgmentEvidenceId) as {
    task_id: string;
    cue_id: string | null;
  } | undefined;
  if (!source) throw new Error(`Unknown production cue judgment ${input.sourceJudgmentEvidenceId}.`);
  const evidenceId = input.evidenceId ?? randomUUID();
  getDb().prepare(`
    INSERT INTO production_cue_evidence_records (
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
      compensation_reason,
      projected_at
    ) VALUES (?, ?, 'compensation', ?, ?, NULL, NULL, NULL, NULL, ?, ?, ?, NULL)
  `).run(
    evidenceId,
    input.occurredAt,
    source.task_id,
    source.cue_id,
    input.sourceJudgmentEvidenceId,
    input.sourceInvocationId ?? null,
    input.reason,
  );
  return evidenceId;
}

export function projectProductionCueEvidence(projectedAt = new Date().toISOString()): void {
  const cueWatermarks = getDb().prepare(`
    SELECT cue_id, MAX(sequence) AS max_sequence
    FROM production_cue_evidence_records
    WHERE projected_at IS NULL AND cue_id IS NOT NULL
    GROUP BY cue_id
    ORDER BY cue_id ASC
  `).all() as Array<{ cue_id: string; max_sequence: number }>;

  const upsert = getDb().prepare(`
    INSERT INTO production_cue_evidence_projection (
      cue_id,
      attempt_count,
      accepted_anchor_count,
      accepted_non_anchor_count,
      rejected_count,
      active_judgment_count,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(cue_id) DO UPDATE SET
      attempt_count = excluded.attempt_count,
      accepted_anchor_count = excluded.accepted_anchor_count,
      accepted_non_anchor_count = excluded.accepted_non_anchor_count,
      rejected_count = excluded.rejected_count,
      active_judgment_count = excluded.active_judgment_count,
      updated_at = excluded.updated_at
  `);
  const markProjected = getDb().prepare(`
    UPDATE production_cue_evidence_records
    SET projected_at = ?
    WHERE cue_id = ? AND sequence <= ? AND projected_at IS NULL
  `);

  for (const { cue_id: cueId, max_sequence: maxSequence } of cueWatermarks) {
    const counts = getDb().prepare(`
      SELECT
        SUM(CASE WHEN record_kind = 'attempt' THEN 1 ELSE 0 END) AS attempt_count,
        SUM(CASE WHEN attempt_result = 'accepted_anchor' THEN 1 ELSE 0 END) AS accepted_anchor_count,
        SUM(CASE WHEN attempt_result = 'accepted_non_anchor' THEN 1 ELSE 0 END) AS accepted_non_anchor_count,
        SUM(CASE WHEN attempt_result = 'rejected' THEN 1 ELSE 0 END) AS rejected_count,
        SUM(CASE
          WHEN record_kind = 'judgment' AND NOT EXISTS (
            SELECT 1
            FROM production_cue_evidence_records AS compensation
            WHERE compensation.record_kind = 'compensation'
              AND compensation.source_evidence_id = production_cue_evidence_records.evidence_id
          ) THEN 1
          ELSE 0
        END) AS active_judgment_count
      FROM production_cue_evidence_records
      WHERE cue_id = ? AND sequence <= ?
    `).get(cueId, maxSequence) as Record<string, number | null>;
    upsert.run(
      cueId,
      counts.attempt_count ?? 0,
      counts.accepted_anchor_count ?? 0,
      counts.accepted_non_anchor_count ?? 0,
      counts.rejected_count ?? 0,
      counts.active_judgment_count ?? 0,
      projectedAt,
    );
    markProjected.run(projectedAt, cueId, maxSequence);
  }


  const fallbackWatermark = getDb().prepare(`
    SELECT MAX(sequence) AS max_sequence
    FROM production_cue_evidence_records
    WHERE projected_at IS NULL AND cue_id IS NULL
  `).get() as { max_sequence: number | null };
  if (fallbackWatermark.max_sequence !== null) {
    getDb().prepare(`
      UPDATE production_cue_evidence_records
      SET projected_at = ?
      WHERE cue_id IS NULL AND sequence <= ? AND projected_at IS NULL
    `).run(projectedAt, fallbackWatermark.max_sequence);
  }
}

export function getProductionCueEvidenceProjection(
  cueId: string,
): ProductionCueEvidenceProjectionV0 | null {
  const row = getDb().prepare(`
    SELECT
      cue_id,
      attempt_count,
      accepted_anchor_count,
      accepted_non_anchor_count,
      rejected_count,
      active_judgment_count,
      updated_at
    FROM production_cue_evidence_projection
    WHERE cue_id = ?
  `).get(cueId) as {
    cue_id: string;
    attempt_count: number;
    accepted_anchor_count: number;
    accepted_non_anchor_count: number;
    rejected_count: number;
    active_judgment_count: number;
    updated_at: string;
  } | undefined;
  return row ? {
    cueId: row.cue_id,
    attemptCount: row.attempt_count,
    acceptedAnchorCount: row.accepted_anchor_count,
    acceptedNonAnchorCount: row.accepted_non_anchor_count,
    rejectedCount: row.rejected_count,
    activeJudgmentCount: row.active_judgment_count,
    updatedAt: row.updated_at,
  } : null;
}

function createCue(
  draft: ProductionCueDraftV2,
  taskId: string,
  invocationId: string,
  appliedAt: string,
): EffectRef[] {
  const cueId = randomUUID();
  getDb().prepare(`
    INSERT INTO production_cues (
      cue_id,
      task_id,
      cue_type,
      cue_text,
      created_at,
      origin_kind,
      origin_invocation_id
    ) VALUES (?, ?, ?, ?, ?, 'reflection', ?)
  `).run(
    cueId,
    taskId,
    draft.cueType,
    draft.text,
    appliedAt,
    invocationId,
  );
  const insertAcceptedWord = getDb().prepare(`
    INSERT INTO production_cue_accepted_words (cue_id, word_id, position)
    VALUES (?, ?, ?)
  `);
  draft.acceptedWordIds.forEach((wordId, position) => {
    insertAcceptedWord.run(cueId, wordId, position);
  });
  const lifecycleRef = appendLifecycleEvent(
    cueId,
    taskId,
    'activated',
    invocationId,
    appliedAt,
  );
  return [{ type: 'production_cue', id: cueId }, lifecycleRef];
}

function appendLifecycleEvent(
  cueId: string,
  taskId: string,
  lifecycleKind: CueStateRow['lifecycle_kind'],
  invocationId: string,
  occurredAt: string,
): EffectRef {
  const eventId = randomUUID();
  getDb().prepare(`
    INSERT INTO production_cue_lifecycle_events (
      event_id,
      cue_id,
      task_id,
      lifecycle_kind,
      occurred_at,
      invocation_id
    ) VALUES (?, ?, ?, ?, ?, ?)
  `).run(eventId, cueId, taskId, lifecycleKind, occurredAt, invocationId);
  getDb().prepare(`
    INSERT INTO production_cue_activation_state (
      cue_id,
      active,
      latest_lifecycle_event_id,
      updated_at
    ) VALUES (?, ?, ?, ?)
    ON CONFLICT(cue_id) DO UPDATE SET
      active = excluded.active,
      latest_lifecycle_event_id = excluded.latest_lifecycle_event_id,
      updated_at = excluded.updated_at
  `).run(cueId, lifecycleKind === 'activated' ? 1 : 0, eventId, occurredAt);
  return { type: 'production_cue_lifecycle_event', id: eventId };
}

function currentLifecycleEffectRef(cueId: string): EffectRef {
  const row = getDb().prepare(`
    SELECT event_id, lifecycle_kind
    FROM production_cue_lifecycle_events
    WHERE cue_id = ?
    ORDER BY sequence DESC
    LIMIT 1
  `).get(cueId) as CueStateRow | undefined;
  if (!row) throw new Error(`Production cue ${cueId} has no lifecycle state.`);
  return { type: 'production_cue_lifecycle_event', id: row.event_id };
}

function validateJudgmentAgainstEvidence(
  operation: RepairProductionCueOperationV2,
  judgment: CueEvidenceJudgmentV2,
): string | null {
  const attempt = getAttemptEvidence(judgment.sourceAttemptId);
  if (!attempt || attempt.task_id !== operation.taskId) {
    return `Source production attempt ${judgment.sourceAttemptId} is unavailable for task ${operation.taskId}.`;
  }
  if (judgment.kind === 'accepted_answer_space_omission') {
    if (
      attempt.attempt_result !== 'rejected'
      || attempt.submitted_word_id !== judgment.submittedWordId
    ) {
      return `Source production attempt ${judgment.sourceAttemptId} does not support the accepted-answer judgment.`;
    }
    const matchingRepair = operation.changes.some((change) => {
      const drafts = attempt.cue_id === null && change.kind === 'create'
        ? [change.cue]
        : attempt.cue_id !== null
          && change.kind === 'replace'
          && change.cueId === attempt.cue_id
          ? change.replacements
          : [];
      return drafts.some((draft) => draft.acceptedWordIds.includes(judgment.submittedWordId));
    });
    if (!matchingRepair) {
      return `Accepted-answer judgment for ${judgment.sourceAttemptId} is not reflected in the cue changes.`;
    }
  }
  if (judgment.kind === 'misleading_or_overloaded_cue') {
    const matchingRepair = operation.changes.some((change) => (
      attempt.cue_id === null
        ? change.kind === 'create'
        : change.kind !== 'create' && change.cueId === attempt.cue_id
    ));
    if (!matchingRepair) {
      return `Misleading-cue judgment for ${judgment.sourceAttemptId} is not reflected in the cue changes.`;
    }
  }
  return null;
}

function validateSourceAttemptSnapshot(
  sourceAttempt: SourceAttemptRow,
  taskWordId: string,
  cue: ProductionCueEntryV0 | null,
  input: AppendProductionCueAttemptEvidenceInput,
): void {
  if (sourceAttempt.action_kind !== 'production' || sourceAttempt.target_word_id !== taskWordId) {
    throw new Error(
      `Study attempt ${input.sourceAttemptId} does not target production task ${input.taskId}.`,
    );
  }

  const contentRef = parseObjectJson(sourceAttempt.content_ref_json);
  if (input.cueId === null) {
    if (contentRef !== null) {
      throw new Error(`Fallback production attempt ${input.sourceAttemptId} has a cue reference.`);
    }
  } else if (
    contentRef?.type !== 'production_cue'
    || contentRef.taskId !== input.taskId
    || contentRef.cueId !== input.cueId
  ) {
    throw new Error(
      `Study attempt ${input.sourceAttemptId} does not identify production cue ${input.cueId}.`,
    );
  }

  const metadata = parseObjectJson(sourceAttempt.metadata_json);
  const production = isRecord(metadata?.production) ? metadata.production : null;
  if (
    production === null
    || production.taskId !== input.taskId
    || production.cueId !== input.cueId
    || production.anchorWordId !== taskWordId
    || production.submittedText !== sourceAttempt.response
    || production.submittedWordId !== input.submittedWordId
    || production.result !== input.attemptResult
    || !Array.isArray(production.acceptedWordIds)
    || production.acceptedWordIds.some((wordId) => typeof wordId !== 'string')
    || new Set(production.acceptedWordIds).size !== production.acceptedWordIds.length
    || !production.acceptedWordIds.includes(taskWordId)
    || (cue === null && production.cueType !== 'definition_gloss')
    || (cue !== null && (
      production.cueType !== cue.cueType
      || production.text !== cue.text
      || production.acceptedWordIds.length !== cue.acceptedWordIds.length
      || production.acceptedWordIds.some((wordId, index) => wordId !== cue.acceptedWordIds[index])
    ))
    || !isProductionAttemptResultCoherent(
      input.attemptResult,
      input.submittedWordId,
      taskWordId,
      production.acceptedWordIds,
    )
  ) {
    throw new Error(
      `Study attempt ${input.sourceAttemptId} has inconsistent production evidence metadata.`,
    );
  }
}

function isProductionAttemptResultCoherent(
  result: ProductionCueAttemptResultV0,
  submittedWordId: string | null,
  anchorWordId: string,
  acceptedWordIds: unknown[],
): boolean {
  switch (result) {
    case 'accepted_anchor':
      return submittedWordId === anchorWordId;
    case 'accepted_non_anchor':
      return submittedWordId !== null
        && submittedWordId !== anchorWordId
        && acceptedWordIds.includes(submittedWordId);
    case 'rejected':
      return submittedWordId === null || !acceptedWordIds.includes(submittedWordId);
  }
}

function parseObjectJson(value: string | null): Record<string, unknown> | null {
  if (value === null) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getAttemptEvidence(sourceAttemptId: string): CueAttemptEvidenceRow | null {
  const row = getDb().prepare(`
    SELECT
      evidence_id,
      task_id,
      cue_id,
      source_attempt_id,
      attempt_result,
      submitted_word_id
    FROM production_cue_evidence_records
    WHERE record_kind = 'attempt' AND source_attempt_id = ?
  `).get(sourceAttemptId) as CueAttemptEvidenceRow | undefined;
  return row ?? null;
}

function productionCueSelect(): string {
  return `
    SELECT
      production_cues.cue_id,
      production_cues.task_id,
      production_cues.cue_type,
      production_cues.cue_text,
      production_cues.created_at,
      production_cues.origin_kind,
      production_cues.origin_invocation_id,
      production_cue_activation_state.active
    FROM production_cues
    INNER JOIN production_cue_activation_state
      ON production_cue_activation_state.cue_id = production_cues.cue_id
  `;
}

function mapTaskRow(row: ProductionTaskRow): ProductionTaskV0 {
  if (row.task_kind !== DEFAULT_PRODUCTION_TASK_KIND) {
    throw new Error(`Unknown production task kind ${row.task_kind}.`);
  }
  return {
    taskId: row.task_id,
    wordId: row.word_id,
    kind: DEFAULT_PRODUCTION_TASK_KIND,
    createdAt: row.created_at,
  };
}

function mapCueRow(row: ProductionCueRow): ProductionCueEntryV0 {
  if (!isProductionCueType(row.cue_type)) {
    throw new Error(`Unknown production cue type ${row.cue_type}.`);
  }
  const acceptedWordIds = (getDb().prepare(`
    SELECT word_id
    FROM production_cue_accepted_words
    WHERE cue_id = ?
    ORDER BY position ASC
  `).all(row.cue_id) as Array<{ word_id: string }>).map(({ word_id: wordId }) => wordId);
  if (acceptedWordIds.length === 0) {
    throw new Error(`Production cue ${row.cue_id} has invalid accepted words.`);
  }
  if (row.origin_kind !== 'reflection' && row.origin_kind !== 'manual') {
    throw new Error(`Production cue ${row.cue_id} has unknown origin ${row.origin_kind}.`);
  }
  return {
    cueId: row.cue_id,
    taskId: row.task_id,
    cueType: row.cue_type,
    text: row.cue_text,
    acceptedWordIds,
    createdAt: row.created_at,
    attribution: {
      origin: row.origin_kind,
      invocationId: row.origin_invocation_id,
    },
    active: row.active !== 0,
  };
}

function isProductionCueType(value: string): value is ProductionCueTypeV0 {
  return value === 'definition_gloss' || value === 'minimal_context' || value === 'circumstance';
}

function wordExists(wordId: string): boolean {
  return getDb().prepare(`SELECT 1 FROM words WHERE id = ?`).get(wordId) !== undefined;
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
