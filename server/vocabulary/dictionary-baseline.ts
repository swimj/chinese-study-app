import { getVocabularyContent } from '../db/vocabulary-content.ts';
import { requireLearnerId } from '../db/learner-context.ts';

type BaselineSkill = 'recognition' | 'production';
type BaselineRole = 'teaching' | 'general';

export function sharedDictionaryBaselineId(wordId: string, skill: BaselineSkill, role: BaselineRole): string {
  return `vocabulary:baseline:v1:shared:${skill}:${role}:${wordId}`;
}

/** Keep migrated identities so a learner's existing deactivation or retirement still applies. */
export function getDictionaryBaseline(wordId: string, skill: BaselineSkill, role: BaselineRole) {
  return getVocabularyContent(`vocabulary:baseline:v1:${requireLearnerId()}:${skill}:${role}:${wordId}`)
    ?? getVocabularyContent(sharedDictionaryBaselineId(wordId, skill, role));
}
