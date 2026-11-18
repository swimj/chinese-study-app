import { readFileSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import { stageImprovementPromptReferences } from '../../server/db/improvement-stage-prompt-archive.ts';

/** These fixtures use the real stage table and a stub invocation ledger. */
export function migrateStagePrompts(db: DatabaseSync): void {
  const sql = readFileSync(new URL('../../server/db/migrations/0080_retain_invocation_prompts.sql', import.meta.url), 'utf8');
  stageImprovementPromptReferences(db);
  db.exec(sql.split('-- Improvement stage prompt retention')[1]!);
}
