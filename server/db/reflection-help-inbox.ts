import { randomUUID } from 'node:crypto';
import type {
  MarkReflectionHelpInboxDoneRequest,
  ReflectionHelpInboxEntry,
} from '../../src/domain/reflection.ts';
import { getDb } from './connection.ts';

const helpInboxColumns = [
  'inbox_id',
  'artifact_id',
  'item_id',
  'opened_at',
] as const;

type HelpInboxRow = {
  inbox_id: string;
  artifact_id: string;
  item_id: string;
  opened_at: string;
};

/**
 * Open explanation-only Help inbox membership.
 *
 * Presence of a row means the item is still in Help. Done is an immediate
 * physical DELETE of that row. Learner-facing undo is not offered; if undo is
 * wanted later, Done would become a tombstone rather than a physical delete.
 *
 * This is not proposal disposition and does not invent a synthetic operation
 * lifecycle for empty proposal lists. Items with proposals are not seeded here
 * (`reflection_proposal_reviews` remains load-bearing for those).
 *
 * Artifacts materialized before this table existed have no inbox rows, so
 * explanation-only items from those artifacts stay out of Help. Historical
 * backfill is intentionally not performed.
 */
export function ensureReflectionHelpInboxSchema(): void {
  getDb().exec(`
    DROP TABLE IF EXISTS reflection_item_presentation;

    CREATE TABLE IF NOT EXISTS reflection_help_inbox (
      inbox_id TEXT PRIMARY KEY,
      artifact_id TEXT NOT NULL
        REFERENCES reflection_artifacts(artifact_id) ON DELETE RESTRICT,
      item_id TEXT NOT NULL,
      opened_at TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_reflection_help_inbox_item
      ON reflection_help_inbox(artifact_id, item_id);

    CREATE INDEX IF NOT EXISTS idx_reflection_help_inbox_artifact
      ON reflection_help_inbox(artifact_id);
  `);
}

export function validateReflectionHelpInboxSchema(): void {
  assertTableColumns('reflection_help_inbox', helpInboxColumns);
  assertNamedIndex(
    'idx_reflection_help_inbox_item',
    'reflection_help_inbox',
    true,
    ['artifact_id', 'item_id'],
  );
  assertNamedIndex(
    'idx_reflection_help_inbox_artifact',
    'reflection_help_inbox',
    false,
    ['artifact_id'],
  );
  assertForeignKey(
    'reflection_help_inbox',
    'artifact_id',
    'reflection_artifacts',
    'artifact_id',
    'RESTRICT',
  );
}

/**
 * Seed open inbox rows for explanation-only items inside a caller-owned
 * transaction. Call this in the same transaction as artifact insert and
 * proposal-review inserts. Artifacts are generate-once, so this inserts once
 * and does not resurrect membership after a later Done delete.
 */
export function seedReflectionHelpInboxWithoutTransaction(
  artifactId: string,
  itemIds: readonly string[],
  openedAt: string,
): void {
  assertNonEmpty(artifactId, 'artifact id');
  assertIsoTimestamp(openedAt, 'help inbox opened timestamp');
  const insert = getDb().prepare(`
    INSERT INTO reflection_help_inbox (
      inbox_id, artifact_id, item_id, opened_at
    ) VALUES (?, ?, ?, ?)
  `);
  for (const itemId of itemIds) {
    assertNonEmpty(itemId, 'item id');
    insert.run(randomUUID(), artifactId, itemId, openedAt);
  }
}

/**
 * Done removes the open inbox row. No tombstone and no learner-facing undo.
 */
export function markReflectionHelpInboxDone(
  request: MarkReflectionHelpInboxDoneRequest,
): { done: boolean } {
  resolveItem(request.artifactId, request.itemId);
  const existing = findInboxRow(request.artifactId, request.itemId);
  if (!existing) {
    return { done: false };
  }
  getDb().prepare(`
    DELETE FROM reflection_help_inbox
    WHERE inbox_id = ?
  `).run(existing.inbox_id);
  return { done: true };
}

export function listReflectionHelpInbox(): ReflectionHelpInboxEntry[] {
  const rows = getDb().prepare(`
    SELECT ${helpInboxColumns.join(', ')}
    FROM reflection_help_inbox
    ORDER BY opened_at ASC, inbox_id ASC
  `).all() as unknown as HelpInboxRow[];
  return rows.map(mapInboxRow);
}

export function listReflectionHelpInboxForArtifact(
  artifactId: string,
): ReflectionHelpInboxEntry[] {
  assertNonEmpty(artifactId, 'artifact id');
  const rows = getDb().prepare(`
    SELECT ${helpInboxColumns.join(', ')}
    FROM reflection_help_inbox
    WHERE artifact_id = ?
    ORDER BY opened_at ASC, inbox_id ASC
  `).all(artifactId) as unknown as HelpInboxRow[];
  return rows.map(mapInboxRow);
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

function findInboxRow(
  artifactId: string,
  itemId: string,
): HelpInboxRow | null {
  const row = getDb().prepare(`
    SELECT ${helpInboxColumns.join(', ')}
    FROM reflection_help_inbox
    WHERE artifact_id = ?
      AND item_id = ?
  `).get(artifactId, itemId) as HelpInboxRow | undefined;
  return row ?? null;
}

function mapInboxRow(row: HelpInboxRow): ReflectionHelpInboxEntry {
  return {
    inboxId: row.inbox_id,
    artifactId: row.artifact_id,
    itemId: row.item_id,
    openedAt: row.opened_at,
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
