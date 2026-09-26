import { randomUUID } from 'node:crypto';
import { STAGED_REFLECTION_DIAGNOSIS_PROMPT_VERSION } from '../../src/domain/reflection-contracts.ts';
import {
  isReflectionQualityTag,
  REFLECTION_QUALITY_TAGS,
  type ClearReflectionQualityRequest,
  type ReflectionQualityItemTags,
  type ReflectionQualityTag,
  type UpsertReflectionQualityRequest,
} from '../../src/domain/reflection.ts';
import { getDb } from './connection.ts';
import { learnerScopedStorageTableName } from './learner-scoped-tables.ts';

const qualityAnnotationColumns = [
  'annotation_id',
  'artifact_id',
  'item_id',
  'tags_json',
  'note',
  'created_at',
  'updated_at',
] as const;

type QualityAnnotationRow = {
  annotation_id: string;
  artifact_id: string;
  item_id: string;
  tags_json: string;
  note: string | null;
  created_at: string;
  updated_at: string;
};

export type ReflectionQualityArmStats = {
  modelArm: string;
  promptVersion: string;
  terminalReviewCount: number;
  exactAcceptCount: number;
  revisedAcceptCount: number;
  userReplaceCount: number;
  dismissCount: number;
  taggedItemCount: number;
  tagCounts: Record<ReflectionQualityTag, number>;
  failedRunCount: number;
  totalCostUsd: number | null;
  avgCostPerExactAcceptUsd: number | null;
};

export type ReflectionQualityStats = {
  arms: ReflectionQualityArmStats[];
};

export function createReflectionQualitySchema(): void {
  getDb().exec(`
    CREATE TABLE reflection_quality_annotations (
      annotation_id TEXT PRIMARY KEY,
      learner_id TEXT NOT NULL DEFAULT (current_learner_id()) REFERENCES learners(learner_id) ON DELETE CASCADE,
      artifact_id TEXT NOT NULL
        REFERENCES reflection_artifacts(artifact_id) ON DELETE RESTRICT,
      item_id TEXT NOT NULL,
      tags_json TEXT NOT NULL,
      note TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE UNIQUE INDEX idx_reflection_quality_item
      ON reflection_quality_annotations(artifact_id, item_id);

    CREATE INDEX idx_reflection_quality_artifact
      ON reflection_quality_annotations(artifact_id);
  `);
}

export function validateReflectionQualitySchema(): void {
  assertTableColumns('reflection_quality_annotations', qualityAnnotationColumns);
  assertNamedIndex(
    'idx_reflection_quality_item',
    'reflection_quality_annotations',
    true,
    ['artifact_id', 'item_id'],
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
}

export function upsertReflectionQualityAnnotation(
  request: UpsertReflectionQualityRequest,
  updatedAt = new Date().toISOString(),
): ReflectionQualityItemTags {
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
 * Upserts inside a caller-owned transaction.
 */
export function upsertReflectionQualityAnnotationWithoutTransaction(
  request: UpsertReflectionQualityRequest,
  updatedAt = new Date().toISOString(),
): ReflectionQualityItemTags {
  assertIsoTimestamp(updatedAt, 'quality annotation update timestamp');
  resolveItem(request.artifactId, request.itemId);
  const tags = normalizeTags(request.tags);
  const note = normalizeNote(request.note ?? null);
  validateTagSet(tags, note);

  const existing = findAnnotationRow(request.artifactId, request.itemId);
  if (existing) {
    getDb().prepare(`
      UPDATE reflection_quality_annotations
      SET tags_json = ?,
          note = ?,
          updated_at = ?
      WHERE annotation_id = ?
    `).run(JSON.stringify(tags), note, updatedAt, existing.annotation_id);
    return mapAnnotationRow(requireAnnotationRow(existing.annotation_id));
  }

  const annotationId = randomUUID();
  getDb().prepare(`
    INSERT INTO reflection_quality_annotations (
      annotation_id, artifact_id, item_id, tags_json, note, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    annotationId,
    request.artifactId,
    request.itemId,
    JSON.stringify(tags),
    note,
    updatedAt,
    updatedAt,
  );
  return mapAnnotationRow(requireAnnotationRow(annotationId));
}

export function clearReflectionQualityAnnotation(
  request: ClearReflectionQualityRequest,
): { cleared: boolean } {
  resolveItem(request.artifactId, request.itemId);
  const existing = findAnnotationRow(request.artifactId, request.itemId);
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
): ReflectionQualityItemTags[] {
  assertNonEmpty(artifactId, 'artifact id');
  const rows = getDb().prepare(`
    SELECT ${qualityAnnotationColumns.join(', ')}
    FROM reflection_quality_annotations
    WHERE artifact_id = ?
    ORDER BY updated_at ASC, annotation_id ASC
  `).all(artifactId) as unknown as QualityAnnotationRow[];
  return rows.map(mapAnnotationRow);
}

type QualityArmIdentity = {
  modelArm: string;
  promptVersion: string;
};

type ContinuationStageRun = {
  stage: string;
  model: string;
  createdAt: string;
};

export function stagedContinuationQualityIdentity(
  runs: ContinuationStageRun[],
): QualityArmIdentity {
  const ordered = [...runs].sort((left, right) => (
    left.createdAt.localeCompare(right.createdAt) || left.stage.localeCompare(right.stage)
  ));
  const diagnosis = uniqueModels(ordered.filter((run) => run.stage === 'diagnosis'));
  const promotion = uniqueModels(ordered.filter((run) => run.stage === 'promotion'));
  if (diagnosis.length === 0) {
    throw new Error('A staged continuation requires a diagnosis stage before promotion.');
  }
  const allModels = uniqueModels(ordered);
  const modelArm = allModels.length === 1
    ? allModels[0]!
    : promotion.length === 0
      ? diagnosis.join(' + ')
      : `${diagnosis.join(' + ')} → ${promotion.join(' + ')}`;
  return {
    modelArm,
    promptVersion: STAGED_REFLECTION_DIAGNOSIS_PROMPT_VERSION,
  };
}

function uniqueModels(runs: Array<{ model: string }>): string[] {
  const models: string[] = [];
  for (const run of runs) {
    if (!models.includes(run.model)) models.push(run.model);
  }
  return models;
}

export function getReflectionQualityStats(): ReflectionQualityStats {
  const reviewRows = getDb().prepare(`
    SELECT
      artifacts.model AS model_arm,
      artifacts.prompt_version AS prompt_version,
      artifacts.source_run_id AS source_run_id,
      reviews.disposition AS disposition,
      reviews.acceptance_mode AS acceptance_mode,
      reviews.supersession_source AS supersession_source
    FROM reflection_proposal_reviews AS reviews
    JOIN reflection_artifacts AS artifacts
      ON artifacts.artifact_id = reviews.artifact_id
  `).all() as Array<{
    model_arm: string;
    prompt_version: string;
    source_run_id: string | null;
    disposition: string;
    acceptance_mode: string | null;
    supersession_source: string | null;
  }>;

  const annotationRows = getDb().prepare(`
    SELECT
      artifacts.model AS model_arm,
      artifacts.prompt_version AS prompt_version,
      artifacts.source_run_id AS source_run_id,
      annotations.tags_json AS tags_json
    FROM reflection_quality_annotations AS annotations
    JOIN reflection_artifacts AS artifacts
      ON artifacts.artifact_id = annotations.artifact_id
  `).all() as Array<{
    model_arm: string;
    prompt_version: string;
    source_run_id: string | null;
    tags_json: string;
  }>;

  const runRows = getDb().prepare(`
    SELECT
      runs.run_id AS run_id,
      runs.model AS model_arm,
      runs.prompt_version AS prompt_version,
      runs.state AS state,
      runs.estimated_cost_usd AS estimated_cost_usd,
      links.continuation_id AS continuation_id,
      links.stage AS stage,
      links.created_at AS link_created_at
    FROM reflection_generation_runs AS runs
    LEFT JOIN reflection_generation_continuation_runs AS links
      ON links.run_id = runs.run_id
      AND links.learner_id = current_learner_id()
  `).all() as Array<{
    run_id: string;
    model_arm: string;
    prompt_version: string;
    state: string;
    estimated_cost_usd: number | null;
    continuation_id: string | null;
    stage: string | null;
    link_created_at: string | null;
  }>;

  const continuationRuns = new Map<string, ContinuationStageRun[]>();
  for (const row of runRows) {
    if (row.continuation_id === null || row.stage === null || row.link_created_at === null) continue;
    const runs = continuationRuns.get(row.continuation_id) ?? [];
    runs.push({ stage: row.stage, model: row.model_arm, createdAt: row.link_created_at });
    continuationRuns.set(row.continuation_id, runs);
  }
  const continuationIdentity = new Map<string, QualityArmIdentity>();
  for (const [continuationId, runs] of continuationRuns) {
    continuationIdentity.set(continuationId, stagedContinuationQualityIdentity(runs));
  }
  const runIdentity = new Map<string, QualityArmIdentity>();
  for (const row of runRows) {
    if (row.continuation_id === null) continue;
    const identity = continuationIdentity.get(row.continuation_id);
    if (identity !== undefined) runIdentity.set(row.run_id, identity);
  }

  function identityForSource(sourceRunId: string | null, fallback: QualityArmIdentity): QualityArmIdentity {
    if (sourceRunId === null) return fallback;
    return runIdentity.get(sourceRunId) ?? fallback;
  }

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
      taggedItemCount: 0,
      tagCounts: emptyTagCounts(),
      failedRunCount: 0,
      totalCostUsd: null,
      avgCostPerExactAcceptUsd: null,
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
    const identity = identityForSource(row.source_run_id, {
      modelArm: row.model_arm,
      promptVersion: row.prompt_version,
    });
    const arm = ensureArm(identity.modelArm, identity.promptVersion);
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

  for (const row of annotationRows) {
    const tags = parseTagsJson(row.tags_json, 'stats');
    const identity = identityForSource(row.source_run_id, {
      modelArm: row.model_arm,
      promptVersion: row.prompt_version,
    });
    const arm = ensureArm(identity.modelArm, identity.promptVersion);
    arm.taggedItemCount += 1;
    for (const tag of tags) {
      arm.tagCounts[tag] += 1;
    }
  }

  for (const row of runRows) {
    const identity = row.continuation_id === null
      ? { modelArm: row.model_arm, promptVersion: row.prompt_version }
      : continuationIdentity.get(row.continuation_id) ?? {
        modelArm: row.model_arm,
        promptVersion: row.prompt_version,
      };
    const arm = ensureArm(identity.modelArm, identity.promptVersion);
    if (row.state === 'failed') {
      arm.failedRunCount += 1;
    }
    if (row.estimated_cost_usd !== null) {
      arm.totalCostUsd = (arm.totalCostUsd ?? 0) + row.estimated_cost_usd;
    }
  }

  for (const arm of arms.values()) {
    arm.avgCostPerExactAcceptUsd = arm.exactAcceptCount > 0 && arm.totalCostUsd !== null
      ? arm.totalCostUsd / arm.exactAcceptCount
      : null;
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

function emptyTagCounts(): Record<ReflectionQualityTag, number> {
  return {
    praise: 0,
    wrong_diagnosis: 0,
    wrong_intervention: 0,
    missed_intervention: 0,
    low_quality_content: 0,
    inconsistent: 0,
    other: 0,
  };
}

function resolveItem(artifactId: string, itemId: string): void {
  assertNonEmpty(artifactId, 'artifact id');
  assertNonEmpty(itemId, 'item id');
  const artifact = getDb().prepare(`
    SELECT result_json
    FROM reflection_artifacts
    WHERE artifact_id = ?
  `).get(artifactId) as { result_json: string } | undefined;
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
      .filter((entry): entry is string => typeof entry === 'string');
  } catch {
    throw new Error(`artifact ${artifactId} contains an invalid reflection result`);
  }
  if (!itemIds.includes(itemId)) {
    throw new Error('Reflection item not found.');
  }
}

function normalizeTags(tags: ReflectionQualityTag[]): ReflectionQualityTag[] {
  if (!Array.isArray(tags)) {
    throw new Error('Expected quality tags to be an array.');
  }
  if (tags.length === 0) {
    throw new Error('Expected a non-empty quality tag set.');
  }
  const unique = new Set<ReflectionQualityTag>();
  for (const tag of tags) {
    if (!isReflectionQualityTag(tag)) {
      throw new Error('Expected a valid reflection quality tag.');
    }
    unique.add(tag);
  }
  return REFLECTION_QUALITY_TAGS.filter((tag) => unique.has(tag));
}

function validateTagSet(tags: ReflectionQualityTag[], note: string | null): void {
  if (tags.includes('other') && (note === null || note.trim().length === 0)) {
    throw new Error('other tag requires a non-empty note.');
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

function findAnnotationRow(
  artifactId: string,
  itemId: string,
): QualityAnnotationRow | null {
  const row = getDb().prepare(`
    SELECT ${qualityAnnotationColumns.join(', ')}
    FROM reflection_quality_annotations
    WHERE artifact_id = ?
      AND item_id = ?
  `).get(artifactId, itemId) as QualityAnnotationRow | undefined;
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

function mapAnnotationRow(row: QualityAnnotationRow): ReflectionQualityItemTags {
  return {
    annotationId: row.annotation_id,
    artifactId: row.artifact_id,
    itemId: row.item_id,
    tags: parseTagsJson(row.tags_json, row.annotation_id),
    note: row.note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function parseTagsJson(raw: string, label: string): ReflectionQualityTag[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`quality annotation ${label} has invalid tags_json`);
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error(`quality annotation ${label} has empty tags_json`);
  }
  const unique = new Set<ReflectionQualityTag>();
  for (const entry of parsed) {
    if (!isReflectionQualityTag(entry)) {
      throw new Error(`quality annotation ${label} has invalid tag`);
    }
    unique.add(entry);
  }
  return REFLECTION_QUALITY_TAGS.filter((tag) => unique.has(tag));
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
  const storageTableName = learnerScopedStorageTableName(tableName);
  const present = getDb().prepare(`PRAGMA table_info(${storageTableName})`).all() as Array<{ name: string }>;
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
  const storageTableName = learnerScopedStorageTableName(tableName);
  const index = getDb().prepare(`
    SELECT name, "unique", origin, partial
    FROM pragma_index_list(?)
    WHERE name = ?
  `).get(storageTableName, indexName) as {
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
      `Missing foreign key ${fromColumn} -> ${targetTable}(${targetColumn}) `
      + `ON DELETE ${onDelete} on ${tableName}.`,
    );
  }
}
