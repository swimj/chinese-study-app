import { getDb } from './connection.ts';
import type { WordRow } from './types.ts';
import { deckAssignmentKey, getManifestAssignmentsByDeck, type DeckManifest } from '../decks/manifest.ts';

export type DeckWordRow = WordRow & { personal_updated_at: string | null };
type DeckWordPurpose = 'diet' | 'browse';

/** Shared by composition and browsing: probe only the explicit manifest members. */
export function queryManifestDeckWords(manifest: DeckManifest, deckIds: readonly string[], purpose: DeckWordPurpose): DeckWordRow[] {
  const assignmentsByDeck = getManifestAssignmentsByDeck(manifest);
  const keys = new Set<string>();
  for (const id of deckIds) {
    for (const key of assignmentsByDeck.get(id)?.keys() ?? []) keys.add(key);
  }
  const hanzi = [...new Set([...keys].map((key) => key.split('|')[0]))];
  const rows: DeckWordRow[] = [];
  // Bound SQL parameters even when the current mix spans many explicit decks.
  for (let offset = 0; offset < hanzi.length; offset += 400) {
    const chunk = hanzi.slice(offset, offset + 400);
    const candidates = getDb().prepare(deckWordProbeSql(chunk.length, purpose)).all(...chunk) as DeckWordRow[];
    for (const row of candidates) {
      if (keys.has(deckAssignmentKey(row.hanzi, row.pinyin))) rows.push(row);
    }
  }
  return rows;
}

/** Exposed for query-plan regression tests against the exact production query. */
export function deckWordProbeSql(count: number, purpose: DeckWordPurpose): string {
  if (!Number.isInteger(count) || count < 1 || count > 400) throw new Error('Expected 1–400 deck spelling probes');
  return `SELECT words.*, personal.updated_at AS personal_updated_at
    FROM words
    LEFT JOIN user_word_priority personal ON personal.word_id = words.id
    WHERE words.hanzi IN (${Array.from({ length: count }, () => '?').join(', ')})
      AND ${purpose === 'diet'
        ? "words.status = 'unstudied' AND personal.word_id IS NULL"
        : '(personal.priority_tier IS NULL OR personal.priority_tier >= 0)'}`;
}

export const DECK_WORD_STUDY_DATE_SQL = `SELECT MAX(studied_on) AS last_studied_on FROM (
  SELECT ? AS studied_on
  UNION ALL
  SELECT substr(MAX(last_studied_at), 1, 10) FROM word_skill_state WHERE word_id = ?
  UNION ALL
  SELECT substr(MAX(occurred_at), 1, 10) FROM study_attempt_events
    WHERE target_word_id = ? AND projected_at IS NOT NULL
)`;
