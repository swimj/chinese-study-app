import type { WordSkillRelevance, WordSkillState, WordSkillStateRow } from './types.ts';
import { INITIAL_CONTEXTUAL_SELECTION_INTERVAL_HOURS, INITIAL_REVIEW_EASE_FACTOR } from './types.ts';
import { getDb } from './connection.ts';

export type EnableContextualSelectionResult = {
  relevance: WordSkillRelevance;
  relevanceChanged: boolean;
  schedulerState: WordSkillState;
  schedulerStateChanged: boolean;
};

/**
 * Shared contextual-selection eligibility command for callers that already
 * own a transaction. Existing normal relevance and enabled scheduler history
 * are preserved. Missing state is made immediately due, while disabled state
 * is re-enabled without resetting its scheduler history.
 */
export function enableContextualSelectionWithoutTransaction({
  wordId,
  updatedAt,
  sourceEventId,
}: {
  wordId: string;
  updatedAt: string;
  sourceEventId: string | null;
}): EnableContextualSelectionResult {
  const word = getDb().prepare(`
    SELECT id
    FROM words
    WHERE id = ?
  `).get(wordId) as { id: string } | undefined;
  if (!word) {
    throw new Error('Word not found');
  }

  const existingRelevance = getDb().prepare(`
    SELECT
      word_id,
      relevance_state,
      updated_at,
      source_event_id
    FROM word_skill_relevance
    WHERE word_id = ?
      AND skill_id = 'contextual_selection'
  `).get(wordId) as {
    word_id: string;
    relevance_state: WordSkillRelevance['relevanceState'];
    updated_at: string;
    source_event_id: string | null;
  } | undefined;
  const relevanceChanged = existingRelevance?.relevance_state !== 'normal';
  const relevance: WordSkillRelevance = relevanceChanged
    ? {
        wordId,
        skillId: 'contextual_selection',
        relevanceState: 'normal',
        updatedAt,
        sourceEventId,
      }
    : {
        wordId: existingRelevance.word_id,
        skillId: 'contextual_selection',
        relevanceState: 'normal',
        updatedAt: existingRelevance.updated_at,
        sourceEventId: existingRelevance.source_event_id,
      };
  if (relevanceChanged) {
    getDb().prepare(`
      INSERT INTO learner_owned_word_skill_relevance (
        word_id,
        skill_id,
        relevance_state,
        updated_at,
        source_event_id
      ) VALUES (?, 'contextual_selection', 'normal', ?, ?)
      ON CONFLICT(learner_id, word_id, skill_id) DO UPDATE SET
        relevance_state = excluded.relevance_state,
        updated_at = excluded.updated_at,
        source_event_id = excluded.source_event_id
    `).run(wordId, updatedAt, sourceEventId);
  }

  const existingSchedulerState = getDb().prepare(`
    SELECT
      word_id,
      skill_id,
      enabled,
      interval_hours,
      last_studied_at,
      next_due_at,
      ease_factor
    FROM word_skill_state
    WHERE word_id = ?
      AND skill_id = 'contextual_selection'
  `).get(wordId) as WordSkillStateRow | undefined;
  const schedulerStateChanged = existingSchedulerState === undefined || existingSchedulerState.enabled === 0;

  if (existingSchedulerState === undefined) {
    const schedulerState: WordSkillState = {
      wordId,
      skillId: 'contextual_selection',
      enabled: true,
      intervalHours: INITIAL_CONTEXTUAL_SELECTION_INTERVAL_HOURS,
      lastStudiedAt: addHours(updatedAt, -INITIAL_CONTEXTUAL_SELECTION_INTERVAL_HOURS),
      nextDueAt: updatedAt,
      easeFactor: INITIAL_REVIEW_EASE_FACTOR,
    };
    getDb().prepare(`
      INSERT INTO word_skill_state (
        word_id,
        skill_id,
        enabled,
        interval_hours,
        last_studied_at,
        next_due_at,
        ease_factor
      ) VALUES (?, 'contextual_selection', 1, ?, ?, ?, ?)
    `).run(
      wordId,
      schedulerState.intervalHours,
      schedulerState.lastStudiedAt,
      schedulerState.nextDueAt,
      schedulerState.easeFactor,
    );
    return {
      relevance,
      relevanceChanged,
      schedulerState,
      schedulerStateChanged,
    };
  }

  if (existingSchedulerState.enabled === 0) {
    getDb().prepare(`
      UPDATE word_skill_state
      SET enabled = 1
      WHERE word_id = ?
        AND skill_id = 'contextual_selection'
    `).run(wordId);
  }

  return {
    relevance,
    relevanceChanged,
    schedulerState: {
      wordId: existingSchedulerState.word_id,
      skillId: 'contextual_selection',
      enabled: true,
      intervalHours: existingSchedulerState.interval_hours,
      lastStudiedAt: existingSchedulerState.last_studied_at,
      nextDueAt: existingSchedulerState.next_due_at,
      easeFactor: existingSchedulerState.ease_factor,
    },
    schedulerStateChanged,
  };
}

function addHours(isoTimestamp: string, hours: number): string {
  const date = new Date(isoTimestamp);
  if (Number.isNaN(date.getTime())) {
    throw new Error('Expected valid contextual-selection eligibility timestamp');
  }
  date.setUTCHours(date.getUTCHours() + hours);
  return date.toISOString();
}
