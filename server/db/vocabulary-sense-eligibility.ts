import { getDb } from './connection.ts';

/** Only an established inventory can rule a word out; unknown inventories still need preparation. */
export function vocabularySessionWordEligibleSql(wordIdExpression: string): string {
  return `NOT EXISTS (
    SELECT 1 FROM vocabulary_word_catalogs eligibility_catalog
    WHERE eligibility_catalog.word_id=${wordIdExpression}
      AND eligibility_catalog.senses_established_at IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM senses eligibility_sense
        WHERE eligibility_sense.word_id=eligibility_catalog.word_id AND eligibility_sense.status='active')
  )`;
}

/** Read-only admission policy; it never changes stash membership or retained session evidence. */
export function isVocabularySessionWordEligible(wordId: string): boolean {
  return Boolean(getDb().prepare(`SELECT ${vocabularySessionWordEligibleSql('?')} AS eligible`).get(wordId)?.eligible);
}

/** A cue cannot introduce an ineligible word through any accepted answer. */
export function vocabularyExerciseAnswersEligibleSql(exerciseIdExpression: string): string {
  return `NOT EXISTS (SELECT 1 FROM exercise_answer_words eligibility_answer
    WHERE eligibility_answer.exercise_id=${exerciseIdExpression}
      AND NOT (${vocabularySessionWordEligibleSql('eligibility_answer.word_id')}))`;
}
