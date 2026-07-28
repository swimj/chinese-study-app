import type { WordSkillRelevance } from './types.ts';
import { getDb } from './connection.ts';

export type SuppressDefinitionProductionResult =
  | {
      kind: 'applied';
      relevance: WordSkillRelevance;
    }
  | {
      kind: 'already_satisfied';
      relevance: WordSkillRelevance;
    };

/**
 * Shared production-suppression command for callers that already own a
 * transaction. An existing suppression is intentionally left untouched so
 * its original timestamp and source-event provenance remain truthful.
 */
export function suppressDefinitionProductionWithoutTransaction({
  wordId,
  updatedAt,
  sourceEventId,
}: {
  wordId: string;
  updatedAt: string;
  sourceEventId: string | null;
}): SuppressDefinitionProductionResult {
  const existing = getDb().prepare(`
    SELECT
      word_id,
      relevance_state,
      updated_at,
      source_event_id
    FROM word_skill_relevance
    WHERE word_id = ?
      AND skill_id = 'production'
  `).get(wordId) as {
    word_id: string;
    relevance_state: WordSkillRelevance['relevanceState'];
    updated_at: string;
    source_event_id: string | null;
  } | undefined;

  if (existing?.relevance_state === 'suppressed') {
    return {
      kind: 'already_satisfied',
      relevance: {
        wordId: existing.word_id,
        skillId: 'production',
        relevanceState: existing.relevance_state,
        updatedAt: existing.updated_at,
        sourceEventId: existing.source_event_id,
      },
    };
  }

  const word = getDb().prepare(`
    SELECT id
    FROM words
    WHERE id = ?
  `).get(wordId) as { id: string } | undefined;
  if (!word) {
    throw new Error('Word not found');
  }

  const relevance: WordSkillRelevance = {
    wordId,
    skillId: 'production',
    relevanceState: 'suppressed',
    updatedAt,
    sourceEventId,
  };
  getDb().prepare(`
    INSERT INTO word_skill_relevance (
      word_id,
      skill_id,
      relevance_state,
      updated_at,
      source_event_id
    ) VALUES (?, 'production', 'suppressed', ?, ?)
    ON CONFLICT(word_id, skill_id) DO UPDATE SET
      relevance_state = excluded.relevance_state,
      updated_at = excluded.updated_at,
      source_event_id = excluded.source_event_id
  `).run(wordId, updatedAt, sourceEventId);

  return { kind: 'applied', relevance };
}
