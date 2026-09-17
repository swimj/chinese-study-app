import type { DatabaseSync } from 'node:sqlite';
import { normalizeProductionAnswerForProfile } from '../../src/study-profile.ts';

export function normalizeMandarinHanziLookup(value: string): string {
  return normalizeProductionAnswerForProfile(value, 'mandarin');
}

export function fillMissingNormalizedHanzi(database: DatabaseSync): void {
  const rows = database.prepare(`
    SELECT id, hanzi
    FROM lexical_words
    WHERE normalized_hanzi = ''
  `).all() as Array<{ id: string; hanzi: string }>;
  if (rows.length === 0) {
    return;
  }

  const update = database.prepare(`
    UPDATE lexical_words
    SET normalized_hanzi = ?
    WHERE id = ?
  `);
  for (const row of rows) {
    update.run(normalizeMandarinHanziLookup(row.hanzi), row.id);
  }
}
