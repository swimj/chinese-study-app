
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
