import { getDb } from './connection.ts';

/** Compatibility lane: its existing source is retained when shared defaults change. */
export const DEFAULT_TEACHING_SET = 'default';

/** Identity is the sorted set itself, independent of learner, ordering and defaults. */
export function teachingSenseSetKey(senseIds: readonly string[]): string {
  if (!senseIds.length || senseIds.some(id => typeof id !== 'string' || !id.trim())) {
    throw new Error('A teaching sense set requires nonempty sense IDs');
  }
  return JSON.stringify([...new Set(senseIds)].sort());
}

export function teachingSenseIds(key: string): string[] | null {
  if (key === DEFAULT_TEACHING_SET) return null;
  const value: unknown = JSON.parse(key);
  if (!Array.isArray(value) || value.some(id => typeof id !== 'string')
    || teachingSenseSetKey(value) !== key) throw new Error('Teaching set key must be a canonical nonempty sense set');
  return value as string[];
}

export function assertTeachingSenseSet(wordId: string, key: string): void {
  const ids = teachingSenseIds(key);
  if (ids === null) return;
  const active = new Set((getDb().prepare("SELECT sense_id FROM senses WHERE word_id=? AND status='active'")
    .all(wordId) as Array<{sense_id:string}>).map(row => row.sense_id));
  if (ids.some(id => !active.has(id))) throw new Error('Teaching set contains an inactive sense or a sense of another word');
}
