import fs from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';

/** Reproduce Fly's observed schema using schema-only overrides, never learner data. */
export function createDeployedSchemaFixture(source: DatabaseSync, target: DatabaseSync): void {
  const overrides = JSON.parse(fs.readFileSync(new URL('../fixtures/fly-3ad618b-schema-overrides.json', import.meta.url), 'utf8')) as Record<string, string | null>;
  const objects = source.prepare(`SELECT type, name, sql FROM sqlite_schema
    WHERE name NOT LIKE 'sqlite_%'
    ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'view' THEN 1 WHEN 'index' THEN 2 ELSE 3 END, name`).all() as Array<{ type: string; name: string; sql: string }>;
  for (const object of objects) {
    const key = `${object.type}:${object.name}`;
    const sql = Object.hasOwn(overrides, key) ? overrides[key] : object.sql;
    if (sql !== null) target.exec(sql);
  }
}
