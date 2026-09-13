import type { DatabaseSync } from 'node:sqlite';
import { getDb } from './connection.ts';
import type { WordRow } from './types.ts';
import { deckAssignmentKey, type DeckManifest } from '../decks/manifest.ts';

export type DeckWordRow = WordRow & { personal_updated_at: string | null };
type DeckWordPurpose = 'diet' | 'browse';
type ResolvedIds = ReadonlyMap<string, readonly string[]>;
type CachedIds = { dataVersion: number; ids: ResolvedIds };
const resolvedIds = new WeakMap<DatabaseSync, WeakMap<DeckManifest, CachedIds>>();

/** Call before same-connection lexical imports; learner state never enters this cache. */
export function invalidateDeckWordIds(): void {
  resolvedIds.delete(getDb());
}

/** Resolve the manifest's lexical identities once, independently of learner state. */
export function getResolvedDeckWordIds(manifest: DeckManifest): ResolvedIds {
  const database = getDb();
  const dataVersion = (database.prepare('PRAGMA data_version').get() as { data_version: number }).data_version;
  let byManifest = resolvedIds.get(database);
  const cached = byManifest?.get(manifest);
  // External import/test connections can change lexical identities. Never retain
  // transaction-local identities that could disappear on rollback.
  if (!database.isTransaction && cached?.dataVersion === dataVersion) return cached.ids;
  const ids = new Map<string, string[]>();
  const hanzi = [...new Set(Object.keys(manifest.assignments).map((key) => key.split('|')[0]))];
  for (let offset = 0; offset < hanzi.length; offset += 400) {
    const chunk = hanzi.slice(offset, offset + 400);
    const candidates = database.prepare(deckIdentityProbeSql(chunk.length)).all(...chunk) as Array<{ id: string; hanzi: string; pinyin: string }>;
    for (const word of candidates) {
      const deckId = manifest.assignments[deckAssignmentKey(word.hanzi, word.pinyin)];
      if (!deckId) continue;
      const members = ids.get(deckId) ?? [];
      members.push(word.id);
      ids.set(deckId, members);
    }
  }
  if (!database.isTransaction) {
    if (!byManifest) { byManifest = new WeakMap(); resolvedIds.set(database, byManifest); }
    byManifest.set(manifest, { dataVersion, ids });
  }
  return ids;
}

/** Shared by composition and browsing: hydrate current learner state by cached IDs. */
export function queryManifestDeckWords(manifest: DeckManifest, deckIds: readonly string[], purpose: DeckWordPurpose): DeckWordRow[] {
  const byDeck = getResolvedDeckWordIds(manifest);
  const ids = [...new Set(deckIds.flatMap((id) => byDeck.get(id) ?? []))];
  const rows: DeckWordRow[] = [];
  for (let offset = 0; offset < ids.length; offset += 400) {
    const chunk = ids.slice(offset, offset + 400);
    rows.push(...getDb().prepare(deckWordProbeSql(chunk.length, purpose)).all(...chunk) as DeckWordRow[]);
  }
  return rows;
}

function placeholders(count: number): string {
  if (!Number.isInteger(count) || count < 1 || count > 400) throw new Error('Expected 1–400 deck probes');
  return Array.from({ length: count }, () => '?').join(', ');
}

/** Exported SQL builders let regression tests explain the actual production queries. */
export function deckIdentityProbeSql(count: number): string {
  return `SELECT id, hanzi, pinyin FROM lexical_words WHERE hanzi IN (${placeholders(count)})`;
}

export function deckWordProbeSql(count: number, purpose: DeckWordPurpose): string {
  return `SELECT words.*, personal.updated_at AS personal_updated_at
    FROM words
    LEFT JOIN user_word_priority personal ON personal.word_id = words.id
    WHERE words.id IN (${placeholders(count)})
      AND ${purpose === 'diet'
        ? "words.status = 'unstudied' AND personal.word_id IS NULL"
        : '(personal.priority_tier IS NULL OR personal.priority_tier >= 0)'}`;
}

// One learner-history pass for the entire result set, rather than one per word
// or parameter chunk. Keep events: some accepted attempts do not move the scheduler.
export const DECK_WORD_STUDY_DATES_SQL = `
  WITH requested AS (SELECT value AS id FROM json_each(?)), study_dates AS (
    SELECT target_word_id AS word_id, substr(occurred_at, 1, 10) AS studied_on
    FROM study_attempt_events
    WHERE projected_at IS NOT NULL AND target_word_id IN (SELECT id FROM requested)
    UNION ALL
    SELECT word_id, substr(last_studied_at, 1, 10) FROM word_skill_state
    WHERE word_id IN (SELECT id FROM requested)
    UNION ALL
    SELECT id, last_learning_covered_on FROM words WHERE id IN (SELECT id FROM requested)
  )
  SELECT word_id, MAX(studied_on) AS last_studied_on FROM study_dates GROUP BY word_id
`;

export function queryDeckWordStudyDates(ids: readonly string[]): ReadonlyMap<string, string | null> {
  if (!ids.length) return new Map();
  const rows = getDb().prepare(DECK_WORD_STUDY_DATES_SQL).all(JSON.stringify(ids)) as Array<{
    word_id: string; last_studied_on: string | null;
  }>;
  return new Map(rows.map((row) => [row.word_id, row.last_studied_on]));
}
