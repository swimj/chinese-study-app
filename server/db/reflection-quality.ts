import { randomUUID } from 'node:crypto';
import {
  isReflectionQualityCritiqueReason,
  type ClearReflectionQualityRequest,
  type ReflectionQualityAnnotation,
  type ReflectionQualityCritiqueReason,
  type ReflectionQualitySubject,
  type UpsertReflectionQualityRequest,
} from '../../src/domain/reflection.ts';
import { getDb } from './connection.ts';

const qualityAnnotationColumns = [
  'annotation_id',
  'subject_kind',
  'proposal_id',
  'artifact_id',
  'item_id',
  'polarity',
  'reason_code',
  'note',
  'created_at',
  'updated_at',
] as const;

type QualityAnnotationRow = {
  annotation_id: string;
  subject_kind: 'proposal' | 'item';
  proposal_id: string | null;
  artifact_id: string;
  item_id: string | null;
  polarity: 'praise' | 'critique';
  reason_code: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
};

export type ReflectionQualityStatsDismissalBreakdown = Record<
  ReflectionQualityCritiqueReason | 'unspecified',
  number
>;

export type ReflectionQualityArmStats = {
  modelArm: string;
  promptVersion: string;
  terminalReviewCount: number;
  exactAcceptCount: number;
  revisedAcceptCount: number;
  userReplaceCount: number;
  dismissCount: number;
  dismissalReasons: ReflectionQualityStatsDismissalBreakdown;
  annotatedSubjectCount: number;
  praiseCount: number;
  critiqueCount: number;
  proposalCritiqueCount: number;
  itemCritiqueCount: number;
  missedInterventionCount: number;
};

export type ReflectionQualityStats = {
  arms: ReflectionQualityArmStats[];
};

export function ensureReflectionQualitySchema(): void {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS reflection_quality_annotations (
      annotation_id TEXT PRIMARY KEY,
      subject_kind TEXT NOT NULL CHECK (subject_kind IN ('proposal', 'item')),
      proposal_id TEXT REFERENCES reflection_proposal_reviews(proposal_id) ON DELETE RESTRICT,
      artifact_id TEXT NOT NULL
        REFERENCES reflection_artifacts(artifact_id) ON DELETE RESTRICT,
      item_id TEXT,
      polarity TEXT NOT NULL CHECK (polarity IN ('praise', 'critique')),
      reason_code TEXT CHECK (
        reason_code IS NULL
        OR reason_code IN (
          'wrong_diagnosis',
          'wrong_intervention',
          'missed_intervention',
          'low_quality_content',
          'inconsistent',
          'other'
        )
      ),
      note TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      CHECK (
        (
          subject_kind = 'proposal'
          AND proposal_id IS NOT NULL
          AND item_id IS NULL
        )
        OR (
          subject_kind = 'item'
          AND proposal_id IS NULL
          AND item_id IS NOT NULL
        )
      ),
      CHECK (
        (
          polarity = 'praise'
          AND reason_code IS NULL
        )
        OR (
          polarity = 'critique'
          AND reason_code IS NOT NULL
        )
      )
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_reflection_quality_proposal_subject
      ON reflection_quality_annotations(proposal_id)
      WHERE subject_kind = 'proposal';

    CREATE UNIQUE INDEX IF NOT EXISTS idx_reflection_quality_item_subject
      ON reflection_quality_annotations(artifact_id, item_id)
      WHERE subject_kind = 'item';

    CREATE INDEX IF NOT EXISTS idx_reflection_quality_artifact
      ON reflection_quality_annotations(artifact_id);
  `);
}

export function validateReflectionQualitySchema(): void {
  assertTableColumns('reflection_quality_annotations', qualityAnnotationColumns);
  assertNamedIndex(
    'idx_reflection_quality_proposal_subject',
    'reflection_quality_annotations',
    true,
    ['proposal_id'],
    true,
  );
  assertNamedIndex(
    'idx_reflection_quality_item_subject',
    'reflection_quality_annotations',
    true,
    ['artifact_id', 'item_id'],
    true,
  );
  assertNamedIndex(
    'idx_reflection_quality_artifact',
    'reflection_quality_annotations',
    false,
    ['artifact_id'],
  );
  assertForeignKey(
    'reflection_quality_annotations',
    'artifact_id',
    'reflection_artifacts',
    'artifact_id',
    'RESTRICT',
  );
  assertForeignKey(
    'reflection_quality_annotations',
    'proposal_id',
    'reflection_proposal_reviews',
    'proposal_id',
    'RESTRICT',
  );
}

export function upsertReflectionQualityAnnotation(
  request: UpsertReflectionQualityRequest,
  updatedAt = new Date().toISOString(),
): ReflectionQualityAnnotation {
  const database = getDb();
  database.exec('BEGIN IMMEDIATE');
  try {
    const annotation = upsertReflectionQualityAnnotationWithoutTransaction(request, updatedAt);
    database.exec('COMMIT');
    return annotation;
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

/**
 * Upserts inside a caller-owned transaction (e.g. dismiss + critique).
 */
export function upsertReflectionQualityAnnotationWithoutTransaction(
  request: UpsertReflectionQualityRequest,
  updatedAt = new Date().toISOString(),
): ReflectionQualityAnnotation {
  assertIsoTimestamp(updatedAt, 'quality annotation update timestamp');
  const resolved = resolveSubject(request.subject);
  const note = normalizeNote(request.note ?? null);
  let reasonCode: ReflectionQualityCritiqueReason | null = null;

  if (request.polarity === 'critique') {
    reasonCode = request.reasonCode;
    validateCritique(request.subject, reasonCode, note, resolved);
  } else if (note !== null && note.length === 0) {
    throw new Error('Expected quality annotation note to be null or non-empty.');
  }

  const existing = findAnnotationRow(request.subject);
  if (existing) {
    getDb().prepare(`
      UPDATE reflection_quality_annotations
      SET polarity = ?,
          reason_code = ?,
          note = ?,
          updated_at = ?
      WHERE annotation_id = ?
    `).run(request.polarity, reasonCode, note, updatedAt, existing.annotation_id);
    return mapAnnotationRow(requireAnnotationRow(existing.annotation_id));
  }

  const annotationId = randomUUID();
  getDb().prepare(`
    INSERT INTO reflection_quality_annotations (
      annotation_id, subject_kind, proposal_id, artifact_id, item_id,
      polarity, reason_code, note, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    annotationId,
    request.subject.kind,
    request.subject.kind === 'proposal' ? request.subject.proposalId : null,
    resolved.artifactId,
    request.subject.kind === 'item' ? request.subject.itemId : null,
    request.polarity,
    reasonCode,
    note,
    updatedAt,
    updatedAt,
  );
  return mapAnnotationRow(requireAnnotationRow(annotationId));
}

export function clearReflectionQualityAnnotation(
  request: ClearReflectionQualityRequest,
): { cleared: boolean } {
  resolveSubject(request.subject);
  const existing = findAnnotationRow(request.subject);
  if (!existing) {
    return { cleared: false };
  }
  getDb().prepare(`
    DELETE FROM reflection_quality_annotations
    WHERE annotation_id = ?
  `).run(existing.annotation_id);
  return { cleared: true };
}

export function listReflectionQualityAnnotationsForArtifact(
  artifactId: string,
): ReflectionQualityAnnotation[] {
  assertNonEmpty(artifactId, 'artifact id');
  const rows = getDb().prepare(`
    SELECT ${qualityAnnotationColumns.join(', ')}
    FROM reflection_quality_annotations
    WHERE artifact_id = ?
    ORDER BY updated_at ASC, annotation_id ASC
  `).all(artifactId) as unknown as QualityAnnotationRow[];
  return rows.map(mapAnnotationRow);
}

export function getReflectionQualityStats(): ReflectionQualityStats {
  const reviewRows = getDb().prepare(`
    SELECT
      artifacts.model AS model_arm,
      artifacts.prompt_version AS prompt_version,
      reviews.proposal_id AS proposal_id,
      reviews.disposition AS disposition,
      reviews.acceptance_mode AS acceptance_mode,
      reviews.supersession_source AS supersession_source
    FROM reflection_proposal_reviews AS reviews
    JOIN reflection_artifacts AS artifacts
      ON artifacts.artifact_id = reviews.artifact_id
  `).all() as Array<{
    model_arm: string;
    prompt_version: string;
    proposal_id: string;
    disposition: string;
    acceptance_mode: string | null;
    supersession_source: string | null;
  }>;

  const annotationRows = getDb().prepare(`
    SELECT
      artifacts.model AS model_arm,
      artifacts.prompt_version AS prompt_version,
      annotations.subject_kind AS subject_kind,
      annotations.polarity AS polarity,
      annotations.reason_code AS reason_code,
      annotations.proposal_id AS proposal_id
    FROM reflection_quality_annotations AS annotations
    JOIN reflection_artifacts AS artifacts
      ON artifacts.artifact_id = annotations.artifact_id
  `).all() as Array<{
    model_arm: string;
    prompt_version: string;
    subject_kind: 'proposal' | 'item';
    polarity: 'praise' | 'critique';
    reason_code: string | null;
    proposal_id: string | null;
  }>;

  const arms = new Map<string, ReflectionQualityArmStats>();

  function armKey(modelArm: string, promptVersion: string): string {
    return `${modelArm}\0${promptVersion}`;
  }

  function ensureArm(modelArm: string, promptVersion: string): ReflectionQualityArmStats {
    const key = armKey(modelArm, promptVersion);
    const existing = arms.get(key);
    if (existing) return existing;
    const created: ReflectionQualityArmStats = {
      modelArm,
      promptVersion,
      terminalReviewCount: 0,
      exactAcceptCount: 0,
      revisedAcceptCount: 0,
      userReplaceCount: 0,
      dismissCount: 0,
      dismissalReasons: emptyDismissalBreakdown(),
      annotatedSubjectCount: 0,
      praiseCount: 0,
      critiqueCount: 0,
      proposalCritiqueCount: 0,
      itemCritiqueCount: 0,
      missedInterventionCount: 0,
    };
    arms.set(key, created);
    return created;
  }

  for (const row of reviewRows) {
    if (row.disposition === 'pending' || row.disposition === 'deferred') {
      continue;
    }
    if (row.disposition === 'superseded' && row.supersession_source !== 'user_replacement') {
      continue;
    }
    const arm = ensureArm(row.model_arm, row.prompt_version);
    arm.terminalReviewCount += 1;
    if (row.disposition === 'accepted' && row.acceptance_mode === 'exact') {
      arm.exactAcceptCount += 1;
    } else if (row.disposition === 'accepted' && row.acceptance_mode === 'revised') {
      arm.revisedAcceptCount += 1;
    } else if (row.disposition === 'superseded' && row.supersession_source === 'user_replacement') {
      arm.userReplaceCount += 1;
    } else if (row.disposition === 'dismissed') {
      arm.dismissCount += 1;
    }
  }

  const proposalCritiqueByProposal = new Map<string, ReflectionQualityCritiqueReason>();
  for (const row of annotationRows) {
    const arm = ensureArm(row.model_arm, row.prompt_version);
    arm.annotatedSubjectCount += 1;
    if (row.polarity === 'praise') {
      arm.praiseCount += 1;
      continue;
    }
    arm.critiqueCount += 1;
    if (row.subject_kind === 'proposal') {
      arm.proposalCritiqueCount += 1;
      if (row.proposal_id !== null && isReflectionQualityCritiqueReason(row.reason_code)) {
        proposalCritiqueByProposal.set(row.proposal_id, row.reason_code);
      }
    } else {
      arm.itemCritiqueCount += 1;
      if (row.reason_code === 'missed_intervention') {
        arm.missedInterventionCount += 1;
      }
    }
  }

  for (const row of reviewRows) {
    if (row.disposition !== 'dismissed') continue;
    const arm = ensureArm(row.model_arm, row.prompt_version);
    const code = proposalCritiqueByProposal.get(row.proposal_id);
    if (code === undefined) {
      arm.dismissalReasons.unspecified += 1;
    } else {
      arm.dismissalReasons[code] += 1;
    }
  }

  return {
    arms: [...arms.values()].sort((left, right) => {
      if (left.modelArm !== right.modelArm) {
        return left.modelArm.localeCompare(right.modelArm);
      }
      return left.promptVersion.localeCompare(right.promptVersion);
    }),
  };
}

function emptyDismissalBreakdown(): ReflectionQualityStatsDismissalBreakdown {
  return {
    wrong_diagnosis: 0,
    wrong_intervention: 0,
    missed_intervention: 0,
    low_quality_content: 0,
    inconsistent: 0,
    other: 0,
    unspecified: 0,
  };
}

function resolveSubject(subject: ReflectionQualitySubject): { artifactId: string } {
  if (subject.kind === 'proposal') {
    assertNonEmpty(subject.proposalId, 'proposal id');
    const row = getDb().prepare(`
      SELECT artifact_id
      FROM reflection_proposal_reviews
      WHERE proposal_id = ?
    `).get(subject.proposalId) as { artifact_id: string } | undefined;
    if (!row) {
      throw new Error('Reflection proposal not found.');
    }
    return { artifactId: row.artifact_id };
  }

  assertNonEmpty(subject.artifactId, 'artifact id');
  assertNonEmpty(subject.itemId, 'item id');
  const artifact = getDb().prepare(`
    SELECT result_json
    FROM reflection_artifacts
    WHERE artifact_id = ?
  `).get(subject.artifactId) as { result_json: string } | undefined;
  if (!artifact) {
    throw new Error('Reflection artifact not found.');
  }
  let itemIds: string[];
  try {
    const parsed = JSON.parse(artifact.result_json) as {
      itemResults?: Array<{ itemId?: string }>;
    };
    itemIds = (parsed.itemResults ?? [])
      .map((item) => item.itemId)
      .filter((itemId): itemId is string => typeof itemId === 'string');
  } catch {
    throw new Error(`artifact ${subject.artifactId} contains an invalid reflection result`);
  }
  if (!itemIds.includes(subject.itemId)) {
    throw new Error('Reflection item not found.');
  }
  return { artifactId: subject.artifactId };
}

function validateCritique(
  subject: ReflectionQualitySubject,
  reasonCode: ReflectionQualityCritiqueReason,
  note: string | null,
  resolved: { artifactId: string },
): void {
  if (!isReflectionQualityCritiqueReason(reasonCode)) {
    throw new Error('Expected a valid reflection quality critique reason.');
  }
  if (reasonCode === 'missed_intervention' && subject.kind !== 'item') {
    throw new Error('missed_intervention is valid only for item quality subjects.');
  }
  if (reasonCode === 'other' && (note === null || note.trim().length === 0)) {
    throw new Error('other critique requires a non-empty note.');
  }
  if (reasonCode === 'missed_intervention' && subject.kind === 'item') {
    const proposalCount = getDb().prepare(`
      SELECT COUNT(*) AS count
      FROM reflection_proposal_reviews
      WHERE artifact_id = ?
        AND item_id = ?
    `).get(resolved.artifactId, subject.itemId) as { count: number };
    if (proposalCount.count > 0) {
      throw new Error(
        'missed_intervention is valid only for items with no durable proposals.',
      );
    }
  }
}

function normalizeNote(note: string | null): string | null {
  if (note === null) return null;
  if (typeof note !== 'string') {
    throw new Error('Expected quality annotation note to be a string or null.');
  }
  const trimmed = note.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function findAnnotationRow(subject: ReflectionQualitySubject): QualityAnnotationRow | null {
  if (subject.kind === 'proposal') {
    const row = getDb().prepare(`
      SELECT ${qualityAnnotationColumns.join(', ')}
      FROM reflection_quality_annotations
      WHERE subject_kind = 'proposal'
        AND proposal_id = ?
    `).get(subject.proposalId) as QualityAnnotationRow | undefined;
    return row ?? null;
  }
  const row = getDb().prepare(`
    SELECT ${qualityAnnotationColumns.join(', ')}
    FROM reflection_quality_annotations
    WHERE subject_kind = 'item'
      AND artifact_id = ?
      AND item_id = ?
  `).get(subject.artifactId, subject.itemId) as QualityAnnotationRow | undefined;
  return row ?? null;
}

function requireAnnotationRow(annotationId: string): QualityAnnotationRow {
  const row = getDb().prepare(`
    SELECT ${qualityAnnotationColumns.join(', ')}
    FROM reflection_quality_annotations
    WHERE annotation_id = ?
  `).get(annotationId) as QualityAnnotationRow | undefined;
  if (!row) {
    throw new Error(`quality annotation ${annotationId} is missing after write`);
  }
  return row;
}

function mapAnnotationRow(row: QualityAnnotationRow): ReflectionQualityAnnotation {
  if (row.polarity === 'critique') {
    if (!isReflectionQualityCritiqueReason(row.reason_code)) {
      throw new Error(`quality annotation ${row.annotation_id} has invalid critique reason`);
    }
  } else if (row.reason_code !== null) {
    throw new Error(`quality annotation ${row.annotation_id} has unexpected praise reason`);
  }

  const subject: ReflectionQualitySubject = row.subject_kind === 'proposal'
    ? {
        kind: 'proposal',
        proposalId: row.proposal_id ?? (() => {
          throw new Error(`quality annotation ${row.annotation_id} lacks proposal id`);
        })(),
      }
    : {
        kind: 'item',
        artifactId: row.artifact_id,
        itemId: row.item_id ?? (() => {
          throw new Error(`quality annotation ${row.annotation_id} lacks item id`);
        })(),
      };

  return {
    annotationId: row.annotation_id,
    subject,
    artifactId: row.artifact_id,
    polarity: row.polarity,
    reasonCode: row.polarity === 'critique'
      ? row.reason_code as ReflectionQualityCritiqueReason
      : null,
    note: row.note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function assertNonEmpty(value: string, label: string): void {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Expected non-empty ${label}.`);
  }
}

function assertIsoTimestamp(value: string, label: string): void {
  assertNonEmpty(value, label);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString() !== value) {
    throw new Error(`Expected ${label} to be an ISO-8601 UTC timestamp.`);
  }
}

function assertTableColumns(tableName: string, columns: readonly string[]): void {
  const present = getDb().prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  const names = new Set(present.map((column) => column.name));
  for (const column of columns) {
    if (!names.has(column)) {
      throw new Error(`Missing column "${column}" on ${tableName}.`);
    }
  }
}

function assertNamedIndex(
  indexName: string,
  tableName: string,
  unique: boolean,
  columns: readonly string[],
  partial = false,
): void {
  const index = getDb().prepare(`
    SELECT name, "unique", origin, partial
    FROM pragma_index_list(?)
    WHERE name = ?
  `).get(tableName, indexName) as {
    name: string;
    unique: number;
    origin: string;
    partial: number;
  } | undefined;
  if (!index) {
    throw new Error(`Missing index ${indexName} on ${tableName}.`);
  }
  if (Boolean(index.unique) !== unique) {
    throw new Error(`Index ${indexName} unique flag mismatch.`);
  }
  if (Boolean(index.partial) !== partial) {
    throw new Error(`Index ${indexName} partial flag mismatch.`);
  }
  const indexColumns = getDb().prepare(`
    SELECT name
    FROM pragma_index_info(?)
    ORDER BY seqno ASC
  `).all(indexName) as Array<{ name: string }>;
  if (indexColumns.map((column) => column.name).join(',') !== columns.join(',')) {
    throw new Error(`Index ${indexName} column mismatch.`);
  }
}

function assertForeignKey(
  tableName: string,
  fromColumn: string,
  targetTable: string,
  targetColumn: string,
  onDelete: string,
): void {
  const foreignKeys = getDb().prepare(`PRAGMA foreign_key_list(${tableName})`).all() as Array<{
    table: string;
    from: string;
    to: string;
    on_delete: string;
  }>;
  const present = foreignKeys.some((foreignKey) => (
    foreignKey.table === targetTable
    && foreignKey.from === fromColumn
    && foreignKey.to === targetColumn
    && foreignKey.on_delete === onDelete
  ));
  if (!present) {
    throw new Error(
      `Missing foreign key ${fromColumn} -> ${targetTable}(${targetColumn}) `
      + `ON DELETE ${onDelete} on ${tableName}.`,
    );
  }
}
