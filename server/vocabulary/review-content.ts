import type { VocabularyContent, VocabularyJson } from '../../src/domain/vocabulary-content.ts';
import { getDb } from '../db/connection.ts';
import { requireLearnerId } from '../db/learner-context.ts';
import { isSenseContentReconciliationPending } from '../db/sense-content-reconciliation-state.ts';
import { listVocabularyExercises } from '../db/vocabulary-content.ts';
import { getVocabularyLearnerWord } from '../db/vocabulary-learners.ts';
import { isVocabularySessionWordEligible } from '../db/vocabulary-sense-eligibility.ts';
import { eligible, skillEnabled } from './teaching-readiness.ts';
import type { VocabularyReviewSkill } from './review-selection.ts';

function object(value: VocabularyJson): Record<string, VocabularyJson> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

export function isContrast(content: VocabularyContent): boolean {
  return content.kind === 'exercise' && (content.exerciseType === 'contrast'
    || content.skill === 'contextual_selection' || object(content.assessment).responseMode === 'word_choice');
}

export function contrastEligible(content: VocabularyContent, wordId: string, now = new Date().toISOString()): boolean {
  if (!isContrast(content) || !skillEnabled(wordId, 'contextual_selection')) return false;
  const state = getDb().prepare(`SELECT 1 FROM learner_owned_word_skill_state
    WHERE learner_id=? AND word_id=? AND skill_id='contextual_selection' AND enabled=1
      AND (next_due_at IS NULL OR next_due_at<=?)`).get(requireLearnerId(), wordId, now);
  if (!state) return false;
  const choices = object(content.body).choices;
  return Array.isArray(choices) && choices.length >= 2 && choices.every(choice => {
    const id = object(choice).wordId;
    if (typeof id !== 'string' || !isVocabularySessionWordEligible(id) || isSenseContentReconciliationPending(id)) return false;
    const member = getVocabularyLearnerWord(id);
    return member !== null && member.dismissedAt === null && member.mode !== 'unstudied';
  });
}

export function reviewContentUsable(wordId: string, skill: VocabularyReviewSkill, now = new Date().toISOString()): boolean {
  if (isSenseContentReconciliationPending(wordId)) return false;
  if (skill !== 'contextual_selection') return true;
  const mode = getVocabularyLearnerWord(wordId)?.mode;
  return mode !== undefined && mode !== 'unstudied' && listVocabularyExercises({ wordId, mode })
    .some(entry => eligible(entry) && contrastEligible(entry, wordId, now));
}
