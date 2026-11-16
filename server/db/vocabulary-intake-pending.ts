import { getDb } from './connection.ts';
import { requireLearnerId } from './learner-context.ts';

export const VOCABULARY_INTAKE_SURFACE = 'vocabulary-intake';

/** Only an unresolved match for the current enrollment can hold back new-word teaching. */
export function hasPendingVocabularyIntakeMatch(wordId: string): boolean {
  return !!getDb().prepare(`SELECT 1 FROM learner_chat_cards c
    JOIN learner_chat_conversations v ON v.learner_id=c.learner_id AND v.id=c.conversation_id
    JOIN learner_words w ON w.learner_id=c.learner_id AND w.word_id=?
    WHERE c.learner_id=? AND v.surface=? AND w.in_stash=1 AND w.dismissed_at IS NULL
      AND json_extract(c.body_json,'$.wordId')=w.word_id
      AND json_extract(c.body_json,'$.pending.expectedLearnerVersion')=w.state_version LIMIT 1`)
    .get(wordId, requireLearnerId(), VOCABULARY_INTAKE_SURFACE);
}
